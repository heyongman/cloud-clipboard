import path from 'node:path';

export class RangeNotSatisfiableError extends Error {
    constructor(fileSize) {
        super('请求的文件范围不可满足');
        this.name = 'RangeNotSatisfiableError';
        this.fileSize = fileSize;
    }
}

const parseInteger = value => {
    if (!/^\d+$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
};

/**
 * Parse a single HTTP byte range.
 *
 * @param {string|undefined} header
 * @param {number} fileSize
 * @returns {{status: number, start: number, end: number, length: number}}
 */
export const parseByteRange = (header, fileSize) => {
    if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
        throw new Error('文件大小无效');
    }

    if (!header) {
        return {
            status: 200,
            start: 0,
            end: Math.max(fileSize - 1, -1),
            length: fileSize,
        };
    }

    if (fileSize === 0) {
        throw new RangeNotSatisfiableError(fileSize);
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match || (match[1] === '' && match[2] === '')) {
        throw new RangeNotSatisfiableError(fileSize);
    }

    let start = match[1] === '' ? null : parseInteger(match[1]);
    let end = match[2] === '' ? null : parseInteger(match[2]);

    if ((match[1] !== '' && start === null) || (match[2] !== '' && end === null)) {
        throw new RangeNotSatisfiableError(fileSize);
    }

    if (start === null) {
        if (end === null || end <= 0) {
            throw new RangeNotSatisfiableError(fileSize);
        }
        start = Math.max(fileSize - end, 0);
        end = fileSize - 1;
    } else {
        if (start >= fileSize || (end !== null && end < start)) {
            throw new RangeNotSatisfiableError(fileSize);
        }
        if (end === null || end >= fileSize) {
            end = fileSize - 1;
        }
    }

    return {
        status: 206,
        start,
        end,
        length: end - start + 1,
    };
};

export const formatContentRange = ({start, end, fileSize}) => (
    `bytes ${start}-${end}/${fileSize}`
);

export const normalizeInternalPath = value => {
    const normalized = `${value || '/_cloud_clipboard_files'}`
        .replaceAll('\\', '/')
        .replace(/^\/+|\/+$/g, '');
    return normalized ? `/${normalized}` : '/_cloud_clipboard_files';
};

export const buildAccelRedirect = (internalPath, uuid) => (
    `${normalizeInternalPath(internalPath)}/${path.posix.basename(uuid)}`
);

export const DEFAULT_DOWNLOAD_CONFIG = Object.freeze({
    threshold: 32 * 1024 * 1024,
    chunk: 8 * 1024 * 1024,
    minChunk: 4 * 1024 * 1024,
    maxChunk: 16 * 1024 * 1024,
    concurrency: 2,
    maxConcurrency: 6,
    adaptive: true,
});

export const DEFAULT_UPLOAD_CONFIG = Object.freeze({
    chunk: 8 * 1024 * 1024,
    minChunk: 2 * 1024 * 1024,
    maxChunk: 16 * 1024 * 1024,
    concurrency: 2,
    maxConcurrency: 6,
    adaptive: true,
});

const positiveInteger = (value, fallback) => (
    Number.isSafeInteger(value) && value > 0 ? value : fallback
);

export const normalizeDownloadConfig = value => {
    const raw = value && typeof value === 'object' ? value : {};
    const minChunk = positiveInteger(raw.minChunk, DEFAULT_DOWNLOAD_CONFIG.minChunk);
    const maxChunk = Math.max(minChunk, positiveInteger(raw.maxChunk, DEFAULT_DOWNLOAD_CONFIG.maxChunk));
    const concurrency = Math.min(8, positiveInteger(raw.concurrency, DEFAULT_DOWNLOAD_CONFIG.concurrency));
    return {
        threshold: positiveInteger(raw.threshold, DEFAULT_DOWNLOAD_CONFIG.threshold),
        chunk: Math.min(maxChunk, Math.max(minChunk, positiveInteger(raw.chunk, DEFAULT_DOWNLOAD_CONFIG.chunk))),
        minChunk,
        maxChunk,
        concurrency,
        maxConcurrency: Math.min(8, Math.max(
            concurrency,
            positiveInteger(raw.maxConcurrency, DEFAULT_DOWNLOAD_CONFIG.maxConcurrency),
        )),
        adaptive: raw.adaptive !== false,
    };
};

export const normalizeUploadConfig = value => {
    const raw = value && typeof value === 'object' ? value : {};
    const minChunk = positiveInteger(raw.minChunk, DEFAULT_UPLOAD_CONFIG.minChunk);
    const maxChunk = Math.max(minChunk, positiveInteger(raw.maxChunk, DEFAULT_UPLOAD_CONFIG.maxChunk));
    const concurrency = Math.min(8, positiveInteger(raw.concurrency, DEFAULT_UPLOAD_CONFIG.concurrency));
    return {
        chunk: Math.min(maxChunk, Math.max(
            minChunk,
            positiveInteger(raw.chunk, DEFAULT_UPLOAD_CONFIG.chunk),
        )),
        minChunk,
        maxChunk,
        concurrency,
        maxConcurrency: Math.min(8, Math.max(
            concurrency,
            positiveInteger(raw.maxConcurrency, DEFAULT_UPLOAD_CONFIG.maxConcurrency),
        )),
        adaptive: raw.adaptive !== false,
    };
};
