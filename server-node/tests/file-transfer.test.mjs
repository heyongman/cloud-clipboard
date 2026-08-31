import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildAccelRedirect,
    DEFAULT_DOWNLOAD_CONFIG,
    DEFAULT_UPLOAD_CONFIG,
    normalizeDownloadConfig,
    normalizeUploadConfig,
    parseByteRange,
    RangeNotSatisfiableError,
} from '../app/file-transfer.js';

test('parseByteRange 支持完整范围、开放范围和后缀范围', () => {
    assert.deepEqual(parseByteRange(undefined, 100), {
        status: 200,
        start: 0,
        end: 99,
        length: 100,
    });
    assert.deepEqual(parseByteRange('bytes=10-19', 100), {
        status: 206,
        start: 10,
        end: 19,
        length: 10,
    });
    assert.deepEqual(parseByteRange('bytes=90-', 100), {
        status: 206,
        start: 90,
        end: 99,
        length: 10,
    });
    assert.deepEqual(parseByteRange('bytes=-10', 100), {
        status: 206,
        start: 90,
        end: 99,
        length: 10,
    });
});

test('parseByteRange 拒绝多范围和越界范围', () => {
    assert.throws(() => parseByteRange('bytes=1-2,4-5', 100), RangeNotSatisfiableError);
    assert.throws(() => parseByteRange('bytes=100-', 100), RangeNotSatisfiableError);
    assert.throws(() => parseByteRange('bytes=-0', 100), RangeNotSatisfiableError);
    assert.throws(() => parseByteRange('bytes=0-', 0), RangeNotSatisfiableError);
});

test('Nginx 内部路径只拼接 UUID 的 basename', () => {
    assert.equal(
        buildAccelRedirect('/_cloud_clipboard_files/', '../unsafe'),
        '/_cloud_clipboard_files/unsafe',
    );
});

test('normalizeDownloadConfig 为缺失或非法配置提供安全默认值', () => {
    assert.deepEqual(normalizeDownloadConfig(), DEFAULT_DOWNLOAD_CONFIG);
    assert.deepEqual(normalizeDownloadConfig({
        threshold: -1,
        chunk: 4 * 1024 * 1024,
        concurrency: 100,
    }), {
        ...DEFAULT_DOWNLOAD_CONFIG,
        chunk: 4 * 1024 * 1024,
        concurrency: 8,
        maxConcurrency: 8,
    });
});

test('normalizeUploadConfig 补齐上传参数并限制自适应并发', () => {
    assert.deepEqual(normalizeUploadConfig({chunk: 4 * 1024 * 1024, concurrency: 100}), {
        ...DEFAULT_UPLOAD_CONFIG,
        chunk: 4 * 1024 * 1024,
        concurrency: 8,
        maxConcurrency: 8,
    });
    assert.equal(normalizeUploadConfig({limit: -1}).limit, DEFAULT_UPLOAD_CONFIG.limit);
});
