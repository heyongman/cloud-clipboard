import assert from 'node:assert/strict';
import test from 'node:test';

import {
    chooseUploadParameters,
    createUploadPool,
    isRetryableUploadError,
    normalizeUploadConfig,
} from '../src/utils/file-upload.mjs';

const MIB = 1024 * 1024;

test('normalizeUploadConfig 补齐上传默认值并限制固定并发', () => {
    assert.deepEqual(normalizeUploadConfig({chunk: 4 * MIB, concurrency: 100}), {
        chunk: 4 * MIB,
        minChunk: 2 * MIB,
        maxChunk: 16 * MIB,
        concurrency: 8,
        adaptive: true,
    });
});

test('chooseUploadParameters 根据网络信息选择固定到单文件的分片大小', () => {
    const config = {chunk: 8 * MIB, concurrency: 2};
    assert.deepEqual(chooseUploadParameters(100 * MIB, config, {effectiveType: '3g'}), {
        chunkSize: 4 * MIB,
        concurrency: 2,
    });
    assert.deepEqual(chooseUploadParameters(100 * MIB, config, {effectiveType: '4g', downlink: 50}), {
        chunkSize: 16 * MIB,
        concurrency: 2,
    });
    assert.equal(chooseUploadParameters(3 * MIB, config, {}).chunkSize, 3 * MIB);
});

test('isRetryableUploadError 只重试网络错误、限流和服务端错误', () => {
    assert.equal(isRetryableUploadError(new Error('network')), true);
    assert.equal(isRetryableUploadError({response: {status: 429}}), true);
    assert.equal(isRetryableUploadError({response: {status: 503}}), true);
    assert.equal(isRetryableUploadError({response: {status: 400}}), false);
    assert.equal(isRetryableUploadError({code: 'ERR_CANCELED'}), false);
});

test('createUploadPool 对整个上传批次保持固定总并发', async () => {
    const pool = createUploadPool({concurrency: 2});
    let active = 0;
    let peak = 0;
    let release;
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const tasks = Array.from({length: 4}, () => pool.run(async () => {
        active++;
        peak = Math.max(peak, active);
        if (active === 2) markStarted();
        await gate;
        active--;
    }));
    await started;
    assert.equal(peak, 2);
    assert.equal(pool.concurrency, 2);
    release();
    await Promise.all(tasks);
    assert.equal(peak, 2);
    pool.dispose();
});

test('createUploadPool 遇到请求错误也不改变固定并发', async () => {
    const pool = createUploadPool({concurrency: 4});
    await assert.rejects(pool.run(async () => {
        throw {response: {status: 503}};
    }));
    assert.equal(pool.concurrency, 4);
    pool.dispose();
});
