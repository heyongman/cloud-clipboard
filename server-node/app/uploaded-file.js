import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import config from './config.js';

const storageFolder = config.server.storageDir || path.join(os.tmpdir(), '.cloud-clipboard-storage');
if (!fs.existsSync(storageFolder)) {
    fs.mkdirSync(storageFolder);
}

class UploadedFile {
    /**
     * @param {String} name
     * @param {String} size
     */
    constructor(name, size) {
        this.name = name;
        this.size = size;
        this.uuid = crypto.randomBytes(16).toString('hex');
        this.path = path.join(storageFolder, this.uuid);
        /** @type {Number} */
        this.uploadTime = Date.now() / 1000;
        this.writePromise = Promise.resolve();
        this.uploadedSize = 0;
        this.fileHandle = null; // 用于存储文件句柄
    }

    /**
     * 打开文件句柄并预分配空间
     */
    async open() {
        // 'w' 模式会创建或清空文件
        this.fileHandle = await fs.promises.open(this.path, 'w');
        // 预分配文件大小，可以提高性能并减少磁盘碎片
        if (this.size > 0) {
            await this.fileHandle.truncate(this.size);
        }
    }

    /**
     * 并行写入分片
     * @param {Buffer} data 分片数据
     * @param {Number} chunkIndex 分片索引 (从 0 开始)
     */
    async write(data, chunkIndex) {
        if (!this.fileHandle) {
            throw new Error('文件未打开，请先调用 open()');
        }

        const offset = chunkIndex * config.file.chunk;

        if (offset + data.length > this.size) {
            throw new Error('写入数据超出文件总大小');
        }

        // 并行写入，无需 promise 链
        await this.fileHandle.write(data, 0, data.length, offset);
        this.uploadedSize += data.length;
    }

    /**
     * 关闭文件句柄
     */
    async close() {
        if (this.fileHandle) {
            await this.fileHandle.close();
            this.fileHandle = null;
        }
    }

    finish() {
        this.writePromise = this.writePromise.then(() => {
            console.log('消耗时间:', Date.now() / 1000 - this.uploadTime)
            this.uploadTime = Math.round(Date.now() / 1000);
        });
        return this.writePromise;
    }

    remove() {
        this.writePromise = this.writePromise.then(() => fs.promises.rm(this.path)).catch(() => {});
        return this.writePromise;
    }
}

/** @type {Map<String, UploadedFile>} */
const uploadFileMap = new Map;

export {
    UploadedFile,
    uploadFileMap,
    storageFolder,
};
