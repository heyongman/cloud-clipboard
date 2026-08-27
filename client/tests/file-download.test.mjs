import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDownloadRanges,
    downloadRangesToFile,
    parseContentRange,
    supportsFileSystemAccessDownload,
} from '../src/utils/file-download.mjs';

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

test('createDownloadRanges 覆盖所有字节且最后一片可变长', () => {
    assert.deepEqual(createDownloadRanges(25, 10), [
        {start: 0, end: 9, length: 10},
        {start: 10, end: 19, length: 10},
        {start: 20, end: 24, length: 5},
    ]);
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

    assert.deepEqual([...target], [...source]);
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
