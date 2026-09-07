import assert from 'node:assert/strict';
import test from 'node:test';

import {
    chooseDownloadParameters,
    createDownloadRanges,
    DEFAULT_DOWNLOAD_CONFIG,
    downloadRangesToFile,
    normalizeDownloadConfig,
    parseContentRange,
    selectDownloadChunkSize,
    selectDownloadConcurrency,
    supportsFileSystemAccessDownload,
} from '../src/utils/file-download.mjs';

const MIB = 1024 * 1024;

const createFileSystemAccessWindow = overrides => ({
    isSecureContext: true,
    showSaveFilePicker() {},
    FileSystemFileHandle: class {
        createWritable() {}
    },
    ...overrides,
});

test('supportsFileSystemAccessDownload 允许完整支持 API 的 Chromium 浏览器', () => {
    const windowObject = createFileSystemAccessWindow();

    assert.equal(supportsFileSystemAccessDownload({
        windowObject,
        navigatorObject: {
            userAgentData: {
                mobile: false,
                brands: [{brand: 'Chromium', version: '140'}],
            },
        },
    }), true);
    assert.equal(supportsFileSystemAccessDownload({
        windowObject,
        navigatorObject: {
            userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
        },
    }), true);
});

test('supportsFileSystemAccessDownload 允许新版移动端 Chrome 和 Edge', () => {
    const windowObject = createFileSystemAccessWindow();

    assert.equal(supportsFileSystemAccessDownload({
        windowObject,
        navigatorObject: {
            userAgentData: {
                mobile: true,
                brands: [{brand: 'Chromium', version: '140'}],
            },
        },
    }), true);
    assert.equal(supportsFileSystemAccessDownload({
        windowObject,
        navigatorObject: {
            userAgent: 'Mozilla/5.0 (Android 15; Mobile) Chrome/140.0.0.0 Mobile Safari/537.36',
        },
    }), true);
    assert.equal(supportsFileSystemAccessDownload({
        windowObject,
        navigatorObject: {
            userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0.0.0 Mobile Safari/537.36 EdgA/140.0.0.0',
        },
    }), true);
});

test('supportsFileSystemAccessDownload 对非 Chromium 浏览器直接回退', () => {
    const windowObject = createFileSystemAccessWindow();

    assert.equal(supportsFileSystemAccessDownload({
        windowObject,
        navigatorObject: {
            userAgent: 'Mozilla/5.0 Firefox/142.0',
        },
    }), false);
    assert.equal(supportsFileSystemAccessDownload({
        windowObject,
        navigatorObject: {
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
        },
    }), false);
});

test('supportsFileSystemAccessDownload 拒绝不完整或非安全上下文的实现', () => {
    assert.equal(supportsFileSystemAccessDownload({
        windowObject: createFileSystemAccessWindow({isSecureContext: false}),
        navigatorObject: {userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36'},
    }), false);
    assert.equal(supportsFileSystemAccessDownload({
        windowObject: {
            isSecureContext: true,
            showSaveFilePicker() {},
        },
        navigatorObject: {userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36'},
    }), false);
});

test('chooseDownloadParameters 根据网络信息选择任务级参数', () => {
    const config = {chunk: 8 * MIB, concurrency: 2, maxConcurrency: 6};
    assert.deepEqual(chooseDownloadParameters(100 * MIB, config, {effectiveType: '3g'}), {
        threshold: 32 * MIB,
        memoryThreshold: 100 * MIB,
        chunk: 4 * MIB,
        minChunk: 4 * MIB,
        maxChunk: 16 * MIB,
        concurrency: 2,
        maxConcurrency: 6,
        adaptive: true,
    });
    assert.equal(
        chooseDownloadParameters(100 * MIB, config, {effectiveType: '4g', downlink: 50}).chunk,
        16 * MIB,
    );
});

test('normalizeDownloadConfig 归一化 memoryThreshold 并对非法值回退默认', () => {
    assert.equal(normalizeDownloadConfig({memoryThreshold: 64 * MIB}).memoryThreshold, 64 * MIB);
    assert.equal(normalizeDownloadConfig({memoryThreshold: -1}).memoryThreshold, 100 * MIB);
    assert.equal(normalizeDownloadConfig({memoryThreshold: 1.5}).memoryThreshold, 100 * MIB);
    assert.equal(
        normalizeDownloadConfig().memoryThreshold,
        DEFAULT_DOWNLOAD_CONFIG.memoryThreshold,
    );
});

test('createDownloadRanges 覆盖所有字节且最后一片可变长', () => {
    assert.deepEqual(createDownloadRanges(25, 10), [
        {start: 0, end: 9, length: 10},
        {start: 10, end: 19, length: 10},
        {start: 20, end: 24, length: 5},
    ]);
    assert.deepEqual(createDownloadRanges(25, 10, 7), [
        {start: 7, end: 16, length: 10},
        {start: 17, end: 24, length: 8},
    ]);
});

test('selectDownloadConcurrency 对单连接慢速下载提高固定并发', () => {
    assert.equal(selectDownloadConcurrency(20 * MIB), 2);
    assert.equal(selectDownloadConcurrency(16 * MIB), 2);
    assert.equal(selectDownloadConcurrency(8 * MIB), 4);
    assert.equal(selectDownloadConcurrency(4 * MIB), 6);
    assert.equal(selectDownloadConcurrency(4 * MIB - 1), 8);
    assert.equal(selectDownloadConcurrency(1 * MIB, {maxConcurrency: 6}), 6);
    assert.equal(selectDownloadConcurrency(1 * MIB, {minConcurrency: 6, maxConcurrency: 4}), 4);
});

test('selectDownloadChunkSize 按约一秒传输量选择并限制分片大小', () => {
    assert.equal(selectDownloadChunkSize(2 * MIB), 4 * MIB);
    assert.equal(selectDownloadChunkSize(4.4 * MIB), 4 * MIB);
    assert.equal(selectDownloadChunkSize(4.6 * MIB), 5 * MIB);
    assert.equal(selectDownloadChunkSize(10 * MIB), 10 * MIB);
    assert.equal(selectDownloadChunkSize(40 * MIB), 16 * MIB);
    assert.equal(selectDownloadChunkSize(10 * MIB, {minChunk: 6 * MIB, maxChunk: 8 * MIB}), 8 * MIB);
});

test('parseContentRange 只接受合法的单范围', () => {
    assert.deepEqual(parseContentRange('bytes 10-19/100'), {
        start: 10,
        end: 19,
        total: 100,
        length: 10,
    });
    assert.equal(parseContentRange('bytes 10-19'), null);
    assert.equal(parseContentRange('bytes 20-19/100'), null);
});

test('downloadRangesToFile 并行请求后按绝对偏移写回文件', async () => {
    const source = Uint8Array.from({length: 25}, (_, index) => index);
    const target = new Uint8Array(25);
    const requests = [];
    const writable = {
        async write({position, data}) {
            target.set(data, position);
        },
        async truncate(size) {
            assert.equal(size, source.length);
        },
    };
    const fetchImpl = async (_url, options) => {
        const [start, end] = options.headers.Range.slice(6).split('-').map(Number);
        requests.push([start, end]);
        await new Promise(resolve => setTimeout(resolve, 1));
        return new Response(source.slice(start, end + 1), {
            status: 206,
            headers: {
                'Content-Range': `bytes ${start}-${end}/${source.length}`,
                'Content-Length': `${end - start + 1}`,
            },
        });
    };

    await downloadRangesToFile({
        url: '/file',
        fileSize: source.length,
        chunkSize: 10,
        concurrency: 3,
        writable,
        fetchImpl,
    });

    assert.deepEqual(target, source);
    assert.deepEqual(requests.sort((a, b) => a[0] - b[0]), [[0, 9], [10, 19], [20, 24]]);
});

test('downloadRangesToFile 对短暂错误重试并只累计最终进度', async () => {
    const target = new Uint8Array(4);
    let attempts = 0;
    let progress = 0;
    const writable = {
        async write({position, data}) {
            target.set(data, position);
        },
        async truncate() {},
    };
    const fetchImpl = async (_url, options) => {
        attempts++;
        if (attempts === 1) throw new Error('temporary');
        const data = new Uint8Array([1, 2, 3, 4]);
        return new Response(data, {
            status: 206,
            headers: {
                'Content-Range': 'bytes 0-3/4',
                'Content-Length': '4',
            },
        });
    };

    await downloadRangesToFile({
        url: '/file',
        fileSize: 4,
        chunkSize: 4,
        concurrency: 1,
        writable,
        fetchImpl,
        retries: 1,
        onProgress: bytes => { progress += bytes; },
    });

    assert.equal(attempts, 2);
    assert.equal(progress, 4);
    assert.deepEqual([...target], [1, 2, 3, 4]);
});

test('downloadRangesToFile 对客户端错误不进行无意义重试', async () => {
    let attempts = 0;
    await assert.rejects(downloadRangesToFile({
        url: '/file',
        fileSize: 4,
        chunkSize: 4,
        concurrency: 1,
        writable: {async write() {}, async truncate() {}},
        fetchImpl: async () => {
            attempts++;
            return new Response(null, {status: 403});
        },
        retries: 2,
    }), /分片下载请求失败/);
    assert.equal(attempts, 1);
});

test('downloadRangesToFile 复用首个 1 MiB 测速数据且不重复请求', async () => {
    const source = Uint8Array.from({length: 3 * MIB + 17}, (_, index) => index % 251);
    const target = new Uint8Array(source.length);
    const requests = [];
    let progress = 0;
    const writable = {
        async write({position, data}) {
            target.set(data, position);
        },
        async truncate(size) {
            assert.equal(size, source.length);
        },
    };
    const fetchImpl = async (_url, options) => {
        const [start, end] = options.headers.Range.slice(6).split('-').map(Number);
        requests.push([start, end]);
        return new Response(source.slice(start, end + 1), {
            status: 206,
            headers: {
                'Content-Range': `bytes ${start}-${end}/${source.length}`,
                'Content-Length': `${end - start + 1}`,
            },
        });
    };

    await downloadRangesToFile({
        url: '/file',
        fileSize: source.length,
        chunkSize: MIB,
        concurrency: 2,
        maxConcurrency: 8,
        adaptive: true,
        writable,
        fetchImpl,
        onProgress: bytes => { progress += bytes; },
    });

    assert.deepEqual([...target], [...source]);
    assert.equal(progress, source.length);
    assert.deepEqual(requests.sort((a, b) => a[0] - b[0]), [
        [0, MIB - 1],
        [MIB, 2 * MIB - 1],
        [2 * MIB, 3 * MIB - 1],
        [3 * MIB, source.length - 1],
    ]);
});
