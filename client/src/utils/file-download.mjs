export const DEFAULT_DOWNLOAD_CONFIG = Object.freeze({
    threshold: 32 * 1024 * 1024,
    chunk: 8 * 1024 * 1024,
    concurrency: 4,
});

export class RangeDownloadError extends Error {
    constructor(message, {fallback = false} = {}) {
        super(message);
        this.name = 'RangeDownloadError';
        this.fallback = fallback;
    }
}

export const normalizeDownloadConfig = value => {
    const raw = value && typeof value === 'object' ? value : {};
    const positive = (candidate, fallback) => Number.isSafeInteger(candidate) && candidate > 0
        ? candidate
        : fallback;
    return {
        threshold: positive(raw.threshold, DEFAULT_DOWNLOAD_CONFIG.threshold),
        chunk: positive(raw.chunk, DEFAULT_DOWNLOAD_CONFIG.chunk),
        concurrency: Math.min(16, positive(raw.concurrency, DEFAULT_DOWNLOAD_CONFIG.concurrency)),
    };
};

export const createDownloadRanges = (fileSize, chunkSize) => {
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
        throw new RangeDownloadError('文件大小无效');
    }
    if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
        throw new RangeDownloadError('下载分片大小无效');
    }

    const ranges = [];
    for (let start = 0; start < fileSize; start += chunkSize) {
        const end = Math.min(fileSize - 1, start + chunkSize - 1);
        ranges.push({start, end, length: end - start + 1});
    }
    return ranges;
};

export const parseContentRange = value => {
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(`${value || ''}`.trim());
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2]);
    const total = Number(match[3]);
    if (![start, end, total].every(Number.isSafeInteger) || start > end || total <= end) {
        return null;
    }
    return {start, end, total, length: end - start + 1};
};

const getHeader = (response, name) => response.headers?.get?.(name) || '';

const validateRangeResponse = (response, range, fileSize) => {
    if (response?.status === 200) {
        throw new RangeDownloadError('服务端未返回有效的分片响应', {fallback: true});
    }
    if (!response || response.status !== 206) {
        throw new RangeDownloadError('分片下载请求失败');
    }
    const contentRange = parseContentRange(getHeader(response, 'Content-Range'));
    if (!contentRange || contentRange.start !== range.start || contentRange.end !== range.end || contentRange.total !== fileSize) {
        throw new RangeDownloadError('服务端返回的文件范围不匹配', {fallback: true});
    }
    const contentLength = Number(getHeader(response, 'Content-Length'));
    if (getHeader(response, 'Content-Length') && contentLength !== range.length) {
        throw new RangeDownloadError('服务端返回的文件长度不匹配', {fallback: true});
    }
};

const readResponse = async (response, range, write, onBytes) => {
    if (!response.body || typeof response.body.getReader !== 'function') {
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.byteLength !== range.length) {
            throw new RangeDownloadError('下载分片长度不匹配', {fallback: true});
        }
        await write(data, range.start);
        onBytes(data.byteLength);
        return;
    }

    const reader = response.body.getReader();
    let position = range.start;
    let received = 0;
    try {
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            if (!value || !value.byteLength || received + value.byteLength > range.length) {
                throw new RangeDownloadError('下载分片长度超出预期');
            }
            await write(value, position);
            position += value.byteLength;
            received += value.byteLength;
            onBytes(value.byteLength);
        }
    } finally {
        reader.releaseLock?.();
    }
    if (received !== range.length) {
        throw new RangeDownloadError('下载分片长度不完整');
    }
};

const createWriteQueue = writable => {
    let tail = Promise.resolve();
    return (data, position) => {
        const operation = tail.then(() => writable.write({
            type: 'write',
            position,
            data,
        }));
        tail = operation.catch(() => {});
        return operation;
    };
};

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const downloadOneRange = async ({
    url,
    range,
    rangeIndex,
    fileSize,
    fetchImpl,
    write,
    onProgress,
    signal,
    retries,
}) => {
    let previousBytes = 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (signal?.aborted) throw new DOMException('下载已取消', 'AbortError');
        if (previousBytes) {
            onProgress(-previousBytes, rangeIndex);
            previousBytes = 0;
        }
        try {
            const response = await fetchImpl(url, {
                method: 'GET',
                headers: {Range: `bytes=${range.start}-${range.end}`},
                credentials: 'same-origin',
                cache: 'no-store',
                signal,
            });
            validateRangeResponse(response, range, fileSize);
            await readResponse(
                response,
                range,
                write,
                bytes => {
                    previousBytes += bytes;
                    onProgress(bytes, rangeIndex);
                },
            );
            return;
        } catch (error) {
            if (error?.name === 'AbortError' || signal?.aborted) throw error;
            if (error?.fallback) throw error;
            if (attempt === retries) {
                throw error;
            }
            await sleep(250 * 2 ** attempt);
        }
    }
};

/**
 * Download disjoint byte ranges concurrently and write them to one file.
 * The writable stream is serialized while network requests remain parallel.
 */
export const downloadRangesToFile = async ({
    url,
    fileSize,
    chunkSize,
    concurrency,
    writable,
    fetchImpl = globalThis.fetch,
    onProgress = () => {},
    retries = 2,
    signal,
}) => {
    if (typeof fetchImpl !== 'function') {
        throw new RangeDownloadError('当前浏览器不支持 Fetch');
    }
    if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
        throw new RangeDownloadError('下载并发数无效');
    }
    const ranges = createDownloadRanges(fileSize, chunkSize);
    const write = createWriteQueue(writable);
    const controller = new AbortController();
    const combinedSignal = controller.signal;
    const abortController = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abortController, {once: true});
    if (signal?.aborted) controller.abort(signal.reason);
    const progress = Array(ranges.length).fill(0);
    let nextIndex = 0;

    const updateProgress = (bytes, rangeIndex) => {
        progress[rangeIndex] += bytes;
        onProgress(bytes, progress[rangeIndex], ranges[rangeIndex]);
    };
    const worker = async () => {
        while (true) {
            const rangeIndex = nextIndex++;
            if (rangeIndex >= ranges.length) return;
            await downloadOneRange({
                url,
                range: ranges[rangeIndex],
                rangeIndex,
                fileSize,
                fetchImpl,
                write,
                onProgress: updateProgress,
                signal: combinedSignal,
                retries,
            });
        }
    };

    try {
        await Promise.all(Array(Math.min(concurrency, ranges.length)).fill(null).map(worker));
        await writable.truncate(fileSize);
    } catch (error) {
        controller.abort();
        throw error;
    } finally {
        signal?.removeEventListener('abort', abortController);
    }
};
