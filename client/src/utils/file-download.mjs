export const DEFAULT_DOWNLOAD_CONFIG = Object.freeze({
    threshold: 32 * 1024 * 1024,
    chunk: 8 * 1024 * 1024,
    minChunk: 4 * 1024 * 1024,
    maxChunk: 16 * 1024 * 1024,
    concurrency: 2,
    maxConcurrency: 6,
    adaptive: true,
});

const CHROMIUM_BROWSER_PATTERN = /\b(?:Chrome|Chromium|EdgA?|OPR|Vivaldi)\/\d/i;

/**
 * File System Access is available in supported Chromium browsers on both
 * desktop and mobile. Keep a Chromium check in addition to API detection to
 * avoid entering this path in embedded browsers with incomplete shims.
 */
export const supportsFileSystemAccessDownload = ({
    windowObject = typeof window === 'undefined' ? undefined : window,
    navigatorObject = typeof navigator === 'undefined' ? undefined : navigator,
} = {}) => {
    if (!windowObject
        || windowObject.isSecureContext === false
        || typeof windowObject.showSaveFilePicker !== 'function'
        || typeof windowObject.FileSystemFileHandle?.prototype?.createWritable !== 'function') {
        return false;
    }

    const userAgentData = navigatorObject?.userAgentData;
    if (userAgentData) {
        return (userAgentData.brands || []).some(({brand = ''}) => (
            /Chromium|Google Chrome|Microsoft Edge|Opera|Brave|Vivaldi/i.test(brand)
        ));
    }

    const userAgent = navigatorObject?.userAgent || '';
    return CHROMIUM_BROWSER_PATTERN.test(userAgent);
};

export class RangeDownloadError extends Error {
    constructor(message, {fallback = false, retryable = true} = {}) {
        super(message);
        this.name = 'RangeDownloadError';
        this.fallback = fallback;
        this.retryable = retryable;
    }
}

export const normalizeDownloadConfig = value => {
    const raw = value && typeof value === 'object' ? value : {};
    const positive = (candidate, fallback) => Number.isSafeInteger(candidate) && candidate > 0
        ? candidate
        : fallback;
    const minChunk = positive(raw.minChunk, DEFAULT_DOWNLOAD_CONFIG.minChunk);
    const maxChunk = Math.max(minChunk, positive(raw.maxChunk, DEFAULT_DOWNLOAD_CONFIG.maxChunk));
    const concurrency = Math.min(8, positive(raw.concurrency, DEFAULT_DOWNLOAD_CONFIG.concurrency));
    return {
        threshold: positive(raw.threshold, DEFAULT_DOWNLOAD_CONFIG.threshold),
        chunk: Math.min(maxChunk, Math.max(minChunk, positive(raw.chunk, DEFAULT_DOWNLOAD_CONFIG.chunk))),
        minChunk,
        maxChunk,
        concurrency,
        maxConcurrency: Math.min(8, Math.max(
            concurrency,
            positive(raw.maxConcurrency, DEFAULT_DOWNLOAD_CONFIG.maxConcurrency),
        )),
        adaptive: raw.adaptive !== false,
    };
};

export const chooseDownloadParameters = (
    fileSize,
    value,
    connection = typeof navigator === 'undefined' ? undefined : navigator.connection,
) => {
    const config = normalizeDownloadConfig(value);
    if (!config.adaptive) {
        return {
            ...config,
            chunk: Math.min(fileSize, config.chunk),
            maxConcurrency: config.concurrency,
        };
    }
    const effectiveType = connection?.effectiveType || '';
    const downlink = Number(connection?.downlink);
    let chunk = 8 * 1024 * 1024;
    let concurrency = config.concurrency;
    if (connection?.saveData || /(^|-)2g$/.test(effectiveType)) {
        chunk = 4 * 1024 * 1024;
        concurrency = 1;
    } else if (effectiveType === '3g' || (Number.isFinite(downlink) && downlink <= 3)) {
        chunk = 4 * 1024 * 1024;
        concurrency = Math.min(concurrency, 2);
    } else if (Number.isFinite(downlink) && downlink >= 30) {
        chunk = 16 * 1024 * 1024;
        concurrency = Math.max(concurrency, 3);
    }
    return {
        ...config,
        chunk: Math.min(fileSize, config.maxChunk, Math.max(config.minChunk, chunk)),
        concurrency: Math.min(config.maxConcurrency, concurrency),
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
const WRITE_BATCH_SIZE = 512 * 1024;

const validateRangeResponse = (response, range, fileSize) => {
    if (response?.status === 200) {
        throw new RangeDownloadError('服务端未返回有效的分片响应', {fallback: true});
    }
    if (!response || response.status !== 206) {
        const retryable = !response
            || response.status === 408
            || response.status === 425
            || response.status === 429
            || response.status >= 500;
        throw new RangeDownloadError('分片下载请求失败', {retryable});
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
    let pending = [];
    let pendingBytes = 0;
    const flush = async () => {
        if (!pendingBytes) return;
        let data;
        if (pending.length === 1) {
            [data] = pending;
        } else {
            data = new Uint8Array(pendingBytes);
            let offset = 0;
            pending.forEach(value => {
                data.set(value, offset);
                offset += value.byteLength;
            });
        }
        const writePosition = position;
        position += pendingBytes;
        received += pendingBytes;
        pending = [];
        pendingBytes = 0;
        await write(data, writePosition);
        onBytes(data.byteLength);
    };
    try {
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            if (!value || !value.byteLength || received + pendingBytes + value.byteLength > range.length) {
                throw new RangeDownloadError('下载分片长度超出预期');
            }
            pending.push(value);
            pendingBytes += value.byteLength;
            if (pendingBytes >= WRITE_BATCH_SIZE) await flush();
        }
        await flush();
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

const sleep = (milliseconds, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
        reject(signal.reason || new DOMException('下载已取消', 'AbortError'));
        return;
    }
    const timeoutId = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
    }, milliseconds);
    const abort = () => {
        clearTimeout(timeoutId);
        reject(signal.reason || new DOMException('下载已取消', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, {once: true});
});

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
    onRetry,
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
            if (error?.retryable === false) throw error;
            if (attempt === retries) {
                throw error;
            }
            onRetry(error, attempt);
            await sleep(250 * 2 ** attempt, signal);
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
    adaptive = false,
    maxConcurrency = concurrency,
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
    try {
        let active = 0;
        let limit = Math.min(maxConcurrency, concurrency);
        let successes = 0;
        await new Promise((resolve, reject) => {
            let settled = false;
            const launch = () => {
                if (settled) return;
                if (nextIndex >= ranges.length && active === 0) {
                    settled = true;
                    resolve();
                    return;
                }
                while (active < limit && nextIndex < ranges.length) {
                    const rangeIndex = nextIndex++;
                    active++;
                    downloadOneRange({
                        url,
                        range: ranges[rangeIndex],
                        rangeIndex,
                        fileSize,
                        fetchImpl,
                        write,
                        onProgress: updateProgress,
                        signal: combinedSignal,
                        retries,
                        onRetry: () => {
                            if (!adaptive) return;
                            limit = Math.max(1, Math.ceil(limit / 2));
                            successes = 0;
                        },
                    }).then(() => {
                        active--;
                        successes++;
                        if (adaptive && limit < maxConcurrency && successes >= limit * 2) {
                            limit++;
                            successes = 0;
                        }
                        launch();
                    }, error => {
                        active--;
                        if (settled) return;
                        settled = true;
                        reject(error);
                    });
                }
            };
            launch();
        });
        await writable.truncate(fileSize);
    } catch (error) {
        controller.abort();
        throw error;
    } finally {
        signal?.removeEventListener('abort', abortController);
    }
};
