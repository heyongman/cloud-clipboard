import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Readable} from 'node:stream';
import test from 'node:test';

import {UploadedFile} from '../app/uploaded-file.js';

test('UploadedFile 将并行分片流写入各自固定偏移', async t => {
    const first = Buffer.alloc(1024 * 1024, 0x11);
    const second = Buffer.alloc(1024 * 1024, 0x22);
    const file = new UploadedFile('parallel.bin', first.length + second.length, first.length);
    t.after(async () => file.remove());
    await file.open();

    await Promise.all([
        file.writeStream(Readable.from([first.subarray(0, 300000), first.subarray(300000)]), 0, first.length),
        file.writeStream(Readable.from([second.subarray(0, 400000), second.subarray(400000)]), 1, second.length),
    ]);

    assert.equal(file.isUploadComplete(), true);
    await file.close();
    const result = await fs.promises.readFile(file.path);
    assert.deepEqual(result.subarray(0, first.length), first);
    assert.deepEqual(result.subarray(first.length), second);
});

test('UploadedFile 拒绝长度不完整的分片且不计入完成进度', async t => {
    const file = new UploadedFile('short.bin', 1024, 1024);
    t.after(async () => file.remove());
    await file.open();

    await assert.rejects(
        file.writeStream(Readable.from([Buffer.alloc(512)]), 0, null),
        /分片大小与预期不符/,
    );
    assert.equal(file.uploadedSize, 0);
    assert.equal(file.isUploadComplete(), false);
});
