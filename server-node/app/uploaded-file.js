import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Transform, Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

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
    constructor(name, size, chunkSize = config.file.chunk) {
        this.name = name;
        this.size = Number.isSafeInteger(size) ? size : 0;
        this.uuid = crypto.randomBytes(16).toString('hex');
        this.path = path.join(storageFolder, this.uuid);
        /** @type {Number} */
        this.uploadTime = Date.now() / 1000;
        this.writePromise = Promise.resolve();
        this.uploadedSize = 0;
        this.chunkSize = chunkSize;
        this.fileHandle = null; // 用于存储文件句柄
        this.uploadedChunks = new Set();
        this.chunkPromises = new Map();
        this.published = false;
        this.messageResult = null;
        this.publishPromise = null;
    }

    /**
     * 打开文件句柄并提前设置逻辑文件大小
     */
    async open() {
        // 'w' 模式会创建或清空文件
        this.fileHandle = await fs.promises.open(this.path, 'w+');
        // truncate 会提前设置逻辑大小，但不保证底层文件系统物理预分配。
        if (this.size > 0) {
            await this.fileHandle.truncate(this.size);
        }
    }

    getChunkInfo(chunkIndex, chunkSize = this.chunkSize) {
        if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || !Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
            throw new Error('分片索引无效');
        }
        if (!Number.isSafeInteger(this.size) || this.size <= 0) {
            throw new Error('文件大小无效');
        }

        const chunksCount = Math.ceil(this.size / chunkSize);
        if (chunkIndex >= chunksCount) {
            throw new Error('分片索引超出范围');
        }

        const offset = chunkIndex * chunkSize;
        return {
            offset,
            size: Math.min(chunkSize, this.size - offset),
            chunksCount,
        };
    }

    isUploadComplete(chunkSize = this.chunkSize) {
        if (this.size <= 0) return false;
        const {chunksCount} = this.getChunkInfo(0, chunkSize);
        return this.uploadedChunks.size === chunksCount && this.uploadedSize === this.size;
    }

    /**
     * Stream one request body into its fixed file offset. Repeated chunk
     * requests are idempotent so clients can safely retry after a timeout.
     */
    async writeStream(stream, chunkIndex, contentLength = null, chunkSize = this.chunkSize) {
        const info = this.getChunkInfo(chunkIndex, chunkSize);
        if (contentLength !== null && contentLength !== undefined && contentLength !== info.size) {
            throw new Error('分片长度与预期不符');
        }
        if (!this.fileHandle) {
            throw new Error('文件未打开，请先调用 open()');
        }

        const existing = this.chunkPromises.get(chunkIndex);
        if (this.uploadedChunks.has(chunkIndex)) {
            stream.resume();
            return {duplicate: true, bytes: info.size};
        }
        if (existing) {
            stream.resume();
            await existing;
            return {duplicate: true, bytes: info.size};
        }

        const writePromise = (async () => {
            let receivedBytes = 0;
            try {
                let pending = [];
                let pendingBytes = 0;
                const validateAndBatch = new Transform({
                    transform(data, _encoding, callback) {
                        receivedBytes += data.length;
                        if (receivedBytes > info.size) {
                            callback(new Error('分片大小超出预期'));
                            return;
                        }
                        pending.push(data);
                        pendingBytes += data.length;
                        if (pendingBytes < 512 * 1024) {
                            callback();
                            return;
                        }
                        const output = pending.length === 1 ? pending[0] : Buffer.concat(pending, pendingBytes);
                        pending = [];
                        pendingBytes = 0;
                        callback(null, output);
                    },
                    flush(callback) {
                        if (pendingBytes) this.push(pending.length === 1 ? pending[0] : Buffer.concat(pending, pendingBytes));
                        callback();
                    },
                });
                const fileHandle = this.fileHandle;
                let writePosition = info.offset;
                const output = new Writable({
                    highWaterMark: 512 * 1024,
                    write(data, _encoding, callback) {
                        const writeAll = async () => {
                            let offset = 0;
                            while (offset < data.length) {
                                const {bytesWritten} = await fileHandle.write(
                                    data,
                                    offset,
                                    data.length - offset,
                                    writePosition + offset,
                                );
                                if (!bytesWritten) throw new Error('文件写入未取得进展');
                                offset += bytesWritten;
                            }
                            writePosition += data.length;
                        };
                        writeAll().then(() => callback(), callback);
                    },
                });
                await pipeline(stream, validateAndBatch, output);
                if (receivedBytes !== info.size) {
                    throw new Error('分片大小与预期不符');
                }
                this.uploadedChunks.add(chunkIndex);
                this.uploadedSize += receivedBytes;
                return {duplicate: false, bytes: receivedBytes};
            } catch (error) {
                stream.destroy();
                throw error;
            }
        })();

        this.chunkPromises.set(chunkIndex, writePromise);
        try {
            return await writePromise;
        } finally {
            this.chunkPromises.delete(chunkIndex);
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

        if (this.uploadedChunks.has(chunkIndex)) {
            return {duplicate: true, bytes: data.length};
        }

        const {offset, size} = this.getChunkInfo(chunkIndex);
        if (data.length !== size) {
            throw new Error('分片长度与预期不符');
        }
        await this.fileHandle.write(data, 0, data.length, offset);
        this.uploadedChunks.add(chunkIndex);
        this.uploadedSize += data.length;
        return {duplicate: false, bytes: data.length};
    }

    /**
     * 关闭文件句柄
     */
    async close() {
        await Promise.allSettled(this.chunkPromises.values());
        if (this.fileHandle) {
            await this.fileHandle.close();
            this.fileHandle = null;
        }
    }

    finish() {
        this.writePromise = this.writePromise.then(async () => {
            await Promise.all(this.chunkPromises.values());
            this.uploadTime = Math.round(Date.now() / 1000);
        });
        return this.writePromise;
    }

    remove() {
        this.writePromise = this.writePromise
            .then(async () => {
                await Promise.allSettled(this.chunkPromises.values());
                await this.close();
                await fs.promises.rm(this.path, {force: true});
            })
            .catch(() => {});
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
