import assert from 'node:assert/strict';
import test from 'node:test';

import {
    chooseUploadParameters,
    createAdaptiveUploadPool,
    isRetryableUploadError,
    normalizeUploadConfig,
} from '../src/utils/file-upload.mjs';

const MIB = 1024 * 1024;

test('normalizeUploadConfig 补齐自适应上传默认值并限制并发', () => {
    assert.deepEqual(normalizeUploadConfig({chunk: 4 * MIB, concurrency: 100}), {
        chunk: 4 * MIB,
        minChunk: 2 * MIB,
        maxChunk: 16 * MIB,
        concurrency: 8,
        maxConcurrency: 8,
        adaptive: true,
    });
});

test('chooseUploadParameters 根据网络信息选择固定到单文件的分片大小', () => {
    const config = {chunk: 8 * MIB, concurrency: 2, maxConcurrency: 6};
    assert.deepEqual(chooseUploadParameters(100 * MIB, config, {effectiveType: '3g'}), {
        chunkSize: 4 * MIB,
        initialConcurrency: 2,
        maxConcurrency: 6,
    });
    assert.deepEqual(chooseUploadParameters(100 * MIB, config, {effectiveType: '4g', downlink: 50}), {
        chunkSize: 16 * MIB,
        initialConcurrency: 3,
        maxConcurrency: 6,
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

test('createAdaptiveUploadPool 限制总并发并在连续成功后逐步增加', async () => {
    const pool = createAdaptiveUploadPool({initialConcurrency: 1, maxConcurrency: 3});
    let active = 0;
    let peak = 0;
    let release;
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const first = Array.from({length: 2}, () => pool.run(async () => {
        active++;
        peak = Math.max(peak, active);
        markStarted();
        await gate;
        active--;
    }));
    await started;
    assert.equal(peak, 1);
    release();
    await Promise.all(first);
    assert.equal(pool.concurrency, 2);

    let releaseSecond;
    let markSecondStarted;
    const secondStarted = new Promise(resolve => { markSecondStarted = resolve; });
    const secondGate = new Promise(resolve => { releaseSecond = resolve; });
    const second = Array.from({length: 3}, () => pool.run(async () => {
        active++;
        peak = Math.max(peak, active);
        if (active === 2) markSecondStarted();
        await secondGate;
        active--;
    }));
    await secondStarted;
    assert.equal(peak, 2);
    releaseSecond();
    await Promise.all(second);
    pool.dispose();
});

test('createAdaptiveUploadPool 遇到可重试错误后将并发减半', async () => {
    const pool = createAdaptiveUploadPool({initialConcurrency: 4, maxConcurrency: 6});
    await assert.rejects(pool.run(async () => {
        throw {response: {status: 503}};
    }));
    assert.equal(pool.concurrency, 2);
    pool.dispose();
});
