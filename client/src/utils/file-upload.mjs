const MIB = 1024 * 1024;

export const DEFAULT_UPLOAD_CONFIG = Object.freeze({
    chunk: 8 * MIB,
    minChunk: 2 * MIB,
    maxChunk: 16 * MIB,
    concurrency: 2,
    maxConcurrency: 6,
    adaptive: true,
});

const positiveInteger = (value, fallback) => (
    Number.isSafeInteger(value) && value > 0 ? value : fallback
);

export const normalizeUploadConfig = value => {
    const raw = value && typeof value === 'object' ? value : {};
    const chunk = positiveInteger(raw.chunk, DEFAULT_UPLOAD_CONFIG.chunk);
    const minChunk = positiveInteger(raw.minChunk, DEFAULT_UPLOAD_CONFIG.minChunk);
    const maxChunk = Math.max(minChunk, positiveInteger(raw.maxChunk, DEFAULT_UPLOAD_CONFIG.maxChunk));
    const concurrency = Math.min(8, positiveInteger(raw.concurrency, DEFAULT_UPLOAD_CONFIG.concurrency));
    return {
        chunk: Math.min(maxChunk, Math.max(minChunk, chunk)),
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

export const chooseUploadParameters = (
    fileSize,
    value,
    connection = typeof navigator === 'undefined' ? undefined : navigator.connection,
) => {
    const config = normalizeUploadConfig(value);
    if (!config.adaptive) {
        return {
            chunkSize: Math.min(fileSize, config.chunk),
            initialConcurrency: config.concurrency,
            maxConcurrency: config.concurrency,
        };
    }

    const effectiveType = connection?.effectiveType || '';
    const downlink = Number(connection?.downlink);
    let targetChunk = 8 * MIB;
    let initialConcurrency = config.concurrency;

    if (connection?.saveData || /(^|-)2g$/.test(effectiveType)) {
        targetChunk = 2 * MIB;
        initialConcurrency = 1;
    } else if (effectiveType === '3g' || (Number.isFinite(downlink) && downlink <= 3)) {
        targetChunk = 4 * MIB;
        initialConcurrency = Math.min(initialConcurrency, 2);
    } else if (Number.isFinite(downlink) && downlink >= 30) {
        targetChunk = 16 * MIB;
        initialConcurrency = Math.max(initialConcurrency, 3);
    }

    return {
        chunkSize: Math.min(
            fileSize,
            config.maxChunk,
            Math.max(config.minChunk, targetChunk),
        ),
        initialConcurrency: Math.min(config.maxConcurrency, initialConcurrency),
        maxConcurrency: config.maxConcurrency,
    };
};

export const isAbortError = error => (
    error?.name === 'AbortError'
    || error?.name === 'CanceledError'
    || error?.code === 'ERR_CANCELED'
);

export const isRetryableUploadError = error => {
    if (isAbortError(error)) return false;
    const status = error?.response?.status;
    return status === undefined || status === 408 || status === 425 || status === 429 || status >= 500;
};

export const waitForRetry = (milliseconds, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
        reject(signal.reason || new DOMException('上传已取消', 'AbortError'));
        return;
    }
    const timeoutId = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
    }, milliseconds);
    const abort = () => {
        clearTimeout(timeoutId);
        reject(signal.reason || new DOMException('上传已取消', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, {once: true});
});

/**
 * One adaptive pool is shared by every file in a batch. It uses additive
 * increase after sustained success and multiplicative decrease after a
 * retryable failure, keeping aggregate request concurrency bounded.
 */
export const createAdaptiveUploadPool = ({
    initialConcurrency,
    maxConcurrency,
    adaptive = true,
    signal,
}) => {
    let limit = Math.max(1, Math.min(maxConcurrency, initialConcurrency));
    let active = 0;
    let successCount = 0;
    const queue = [];

    const rejectQueued = reason => {
        while (queue.length) queue.shift().reject(reason);
    };
    const drain = () => {
        if (signal?.aborted) {
            rejectQueued(signal.reason || new DOMException('上传已取消', 'AbortError'));
            return;
        }
        while (active < limit && queue.length) {
            const entry = queue.shift();
            active++;
            Promise.resolve()
                .then(entry.task)
                .then(result => {
                    if (entry.adjust) successCount++;
                    if (adaptive && entry.adjust && limit < maxConcurrency && successCount >= limit * 2) {
                        limit++;
                        successCount = 0;
                    }
                    entry.resolve(result);
                }, error => {
                    if (adaptive && entry.adjust && isRetryableUploadError(error)) {
                        limit = Math.max(1, Math.ceil(limit / 2));
                        successCount = 0;
                    }
                    entry.reject(error);
                })
                .finally(() => {
                    active--;
                    drain();
                });
        }
    };

    const abortQueued = () => {
        rejectQueued(signal.reason || new DOMException('上传已取消', 'AbortError'));
    };
    signal?.addEventListener('abort', abortQueued, {once: true});

    return {
        run(task, {adjust = true} = {}) {
            return new Promise((resolve, reject) => {
                queue.push({task, resolve, reject, adjust});
                drain();
            });
        },
        get concurrency() {
            return limit;
        },
        dispose() {
            signal?.removeEventListener('abort', abortQueued);
        },
    };
};
