# 非 FSA 浏览器内存并行下载实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 不支持 File System Access 的浏览器上，`threshold ≤ 文件大小 ≤ memoryThreshold` 的文件用并行 Range 请求下载到内存，拼 Blob 后触发保存，进度条与流式下载一致。

**Architecture:** 新增 `createMemoryWritable(fileSize)` 内存适配器满足 `downloadRangesToFile` 的 writable 接口约定（`write({position, data})` + `truncate()`），完整复用现有分片校验/重试/自适应并发/进度逻辑；`File.vue` 在未获得 fileHandle 且大小落在区间内时走该路径，失败回退 `triggerNativeDownload`。配置项 `memoryThreshold` 经服务端归一化后由 `/config` 接口下发。

**Tech Stack:** Vue 2（组件层）、原生 Fetch/Range 请求、`node --test` 测试框架。

**Spec:** `docs/superpowers/specs/2026-09-07-memory-parallel-download-design.md`

## Global Constraints

- `memoryThreshold` 默认值 `100 * 1024 * 1024`（100MB），归一化用 positive-integer 模式（非法值回退默认）
- 适用范围：`size >= threshold && size <= memoryThreshold` 且未获得 fileHandle（不支持 FSA，或 FSA 支持但用户取消保存对话框）
- 小于 `threshold` 或大于 `memoryThreshold` 的非流式文件仍走 `triggerNativeDownload`
- 内存并行下载失败时回退 `triggerNativeDownload(downloadUrl)`
- 不改动 `downloadRangesToFile` 本身
- 服务端与客户端各维护一份 `DEFAULT_DOWNLOAD_CONFIG` / `normalizeDownloadConfig` 镜像（`server-node/app/file-transfer.js` 与 `client/src/utils/file-download.mjs`），两处同步修改
- 测试命令：客户端 `node --test tests/file-download.test.mjs`（在 `client/` 下），服务端 `node --test tests/file-transfer.test.mjs`（在 `server-node/` 下）

---

### Task 1: 服务端 memoryThreshold 配置归一化

**Files:**
- Modify: `server-node/app/file-transfer.js:92-132`
- Modify: `server-node/app/config.js:97-105`（JSDoc 类型注释）
- Test: `server-node/tests/file-transfer.test.mjs`

**Interfaces:**
- Produces: `normalizeDownloadConfig` 返回对象新增 `memoryThreshold: Number`（正整数，默认 `100 * 1024 * 1024`）。`DEFAULT_DOWNLOAD_CONFIG` 新增同名字段。后续 `/config` 接口自动下发（`http-router.js` 已返回整个 `config.file`，无需改动）。

- [ ] **Step 1: 写失败测试**

在 `server-node/tests/file-transfer.test.mjs` 的 `normalizeDownloadConfig 为缺失或非法配置提供安全默认值` 测试后追加：

```js
test('normalizeDownloadConfig 归一化 memoryThreshold 并对非法值回退默认', () => {
    assert.equal(
        normalizeDownloadConfig({memoryThreshold: 64 * 1024 * 1024}).memoryThreshold,
        64 * 1024 * 1024,
    );
    assert.equal(normalizeDownloadConfig({memoryThreshold: -1}).memoryThreshold, 100 * 1024 * 1024);
    assert.equal(normalizeDownloadConfig({memoryThreshold: 1.5}).memoryThreshold, 100 * 1024 * 1024);
    assert.equal(
        normalizeDownloadConfig().memoryThreshold,
        DEFAULT_DOWNLOAD_CONFIG.memoryThreshold,
    );
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard/server-node && node --test tests/file-transfer.test.mjs
```

预期：新测试 FAIL（`memoryThreshold` 为 `undefined`），其余 PASS。

- [ ] **Step 3: 实现**

`server-node/app/file-transfer.js` 的 `DEFAULT_DOWNLOAD_CONFIG` 增加 `memoryThreshold`：

```js
export const DEFAULT_DOWNLOAD_CONFIG = Object.freeze({
    threshold: 32 * 1024 * 1024,
    memoryThreshold: 100 * 1024 * 1024,
    chunk: 8 * 1024 * 1024,
    minChunk: 4 * 1024 * 1024,
    maxChunk: 16 * 1024 * 1024,
    concurrency: 2,
    maxConcurrency: 8,
    adaptive: true,
});
```

`normalizeDownloadConfig` 返回对象增加一行（`threshold` 行之后）：

```js
        threshold: positiveInteger(raw.threshold, DEFAULT_DOWNLOAD_CONFIG.threshold),
        memoryThreshold: positiveInteger(raw.memoryThreshold, DEFAULT_DOWNLOAD_CONFIG.memoryThreshold),
```

`server-node/app/config.js` JSDoc 注释中 `file.download` 类型块（约 97-105 行）的 `threshold: Number,` 后补一行：

```js
 *          threshold: Number,
 *          memoryThreshold: Number,
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard/server-node && node --test tests/file-transfer.test.mjs
```

预期：全部 PASS（原有测试用 `deepEqual(..., DEFAULT_DOWNLOAD_CONFIG)` 比较，新增字段两处同步，不会破坏）。

- [ ] **Step 5: 提交**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard
git add server-node/app/file-transfer.js server-node/app/config.js server-node/tests/file-transfer.test.mjs
git commit -m "服务端下载配置新增 memoryThreshold"
```

---

### Task 2: 客户端 memoryThreshold 配置归一化

**Files:**
- Modify: `client/src/utils/file-download.mjs:1-87`
- Test: `client/tests/file-download.test.mjs`

**Interfaces:**
- Produces: 客户端 `DEFAULT_DOWNLOAD_CONFIG` 与 `normalizeDownloadConfig` 输出新增 `memoryThreshold`（正整数，默认 `100 * 1024 * 1024`）。`chooseDownloadParameters` 返回对象（含 `...config` 展开）随之带上该字段——Task 4 的 `File.vue` 依赖 `downloadConfig.memoryThreshold`。

- [ ] **Step 1: 写失败测试**

`client/tests/file-download.test.mjs` 顶部 import 中加入 `normalizeDownloadConfig`：

```js
import {
    chooseDownloadParameters,
    createDownloadRanges,
    downloadRangesToFile,
    normalizeDownloadConfig,
    parseContentRange,
    selectDownloadChunkSize,
    selectDownloadConcurrency,
    supportsFileSystemAccessDownload,
} from '../src/utils/file-download.mjs';
```

现有测试 `chooseDownloadParameters 根据网络信息选择任务级参数` 的 `deepEqual` 期望对象中，在 `threshold: 32 * MIB,` 后补 `memoryThreshold: 100 * MIB,`（否则 Task 2 实现后该测试因多出字段而失败）：

```js
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
```

并在该测试后追加新测试：

```js
test('normalizeDownloadConfig 归一化 memoryThreshold 并对非法值回退默认', () => {
    assert.equal(normalizeDownloadConfig({memoryThreshold: 64 * MIB}).memoryThreshold, 64 * MIB);
    assert.equal(normalizeDownloadConfig({memoryThreshold: -1}).memoryThreshold, 100 * MIB);
    assert.equal(normalizeDownloadConfig({memoryThreshold: 1.5}).memoryThreshold, 100 * MIB);
    assert.equal(
        normalizeDownloadConfig().memoryThreshold,
        DEFAULT_DOWNLOAD_CONFIG.memoryThreshold,
    );
});
```

同时把 `DEFAULT_DOWNLOAD_CONFIG` 加入顶部 import。

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard/client && node --test tests/file-download.test.mjs
```

预期：新测试 FAIL（`memoryThreshold` 为 `undefined`）；修改后的 `chooseDownloadParameters` 测试 FAIL（实际对象无 `memoryThreshold`）。其余 PASS。

- [ ] **Step 3: 实现**

`client/src/utils/file-download.mjs` 的 `DEFAULT_DOWNLOAD_CONFIG` 增加 `memoryThreshold`：

```js
export const DEFAULT_DOWNLOAD_CONFIG = Object.freeze({
    threshold: 32 * 1024 * 1024,
    memoryThreshold: 100 * 1024 * 1024,
    chunk: 8 * 1024 * 1024,
    minChunk: 4 * 1024 * 1024,
    maxChunk: 16 * 1024 * 1024,
    concurrency: 2,
    maxConcurrency: 8,
    adaptive: true,
});
```

`normalizeDownloadConfig`（客户端版）返回对象在 `threshold` 行后增加：

```js
        threshold: positive(raw.threshold, DEFAULT_DOWNLOAD_CONFIG.threshold),
        memoryThreshold: positive(raw.memoryThreshold, DEFAULT_DOWNLOAD_CONFIG.memoryThreshold),
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard/client && node --test tests/file-download.test.mjs
```

预期：全部 PASS。

- [ ] **Step 5: 提交**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard
git add client/src/utils/file-download.mjs client/tests/file-download.test.mjs
git commit -m "客户端下载配置新增 memoryThreshold"
```

---

### Task 3: createMemoryWritable 内存适配器

**Files:**
- Modify: `client/src/utils/file-download.mjs`（在 `createWriteQueue` 附近新增导出）
- Test: `client/tests/file-download.test.mjs`

**Interfaces:**
- Consumes: `RangeDownloadError`（同文件已定义）。
- Produces: `createMemoryWritable(fileSize)` → `{ buffer: Uint8Array, write({position, data}): Promise<void>, truncate(size): Promise<void> }`。`buffer` 按 `fileSize` 预分配；`write` 执行 `buffer.set(data, position)`；`truncate` 为 no-op。`fileSize` 非正整数时抛 `RangeDownloadError('文件大小无效')`。接口满足 `downloadRangesToFile` 的 `writable` 约定。Task 4 依赖 `createMemoryWritable` 与 `.buffer` 属性。

- [ ] **Step 1: 写失败测试**

`client/tests/file-download.test.mjs` 顶部 import 加入 `createMemoryWritable`，文件末尾追加：

```js
test('createMemoryWritable 乱序按偏移写入并保持缓冲完整', async () => {
    const writable = createMemoryWritable(25);
    await writable.write({position: 10, data: Uint8Array.from([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])});
    await writable.write({position: 0, data: Uint8Array.from({length: 10}, (_, index) => index)});
    await writable.write({position: 20, data: Uint8Array.from([20, 21, 22, 23, 24])});
    await writable.truncate(25);
    assert.deepEqual(
        [...writable.buffer],
        [...Uint8Array.from({length: 25}, (_, index) => index)],
    );
});

test('createMemoryWritable 拒绝非法文件大小', () => {
    assert.throws(() => createMemoryWritable(-1), /文件大小无效/);
    assert.throws(() => createMemoryWritable(1.5), /文件大小无效/);
});

test('downloadRangesToFile 配合 createMemoryWritable 在内存中完成并行下载', async () => {
    const source = Uint8Array.from({length: 25}, (_, index) => index);
    const writable = createMemoryWritable(source.length);
    const fetchImpl = async (_url, options) => {
        const [start, end] = options.headers.Range.slice(6).split('-').map(Number);
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

    assert.deepEqual([...writable.buffer], [...source]);
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard/client && node --test tests/file-download.test.mjs
```

预期：三个新测试 FAIL（`createMemoryWritable is not a function`），其余 PASS。

- [ ] **Step 3: 实现**

`client/src/utils/file-download.mjs` 在 `createWriteQueue` 定义之后新增：

```js
/**
 * In-memory writable implementing the subset of the
 * FileSystemWritableFileStream interface that downloadRangesToFile relies on,
 * so parallel Range downloads can target a pre-allocated buffer on browsers
 * without File System Access support.
 */
export const createMemoryWritable = fileSize => {
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
        throw new RangeDownloadError('文件大小无效');
    }
    const buffer = new Uint8Array(fileSize);
    return {
        buffer,
        async write({position, data}) {
            buffer.set(data, position);
        },
        async truncate() {},
    };
};
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard/client && node --test tests/file-download.test.mjs
```

预期：全部 PASS。

- [ ] **Step 5: 提交**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard
git add client/src/utils/file-download.mjs client/tests/file-download.test.mjs
git commit -m "新增 createMemoryWritable 内存下载适配器"
```

---

### Task 4: File.vue 集成内存并行下载分支

**Files:**
- Modify: `client/src/components/received-item/File.vue:126-310`（import 与 `downloadFile`）

**Interfaces:**
- Consumes: `createMemoryWritable(fileSize)`（Task 3）、`downloadConfig.memoryThreshold`（Task 2 经 `chooseDownloadParameters` 返回）、现有 `downloadRangesToFile` / `triggerNativeDownload`。
- Produces: 无（组件内部行为变更，无新对外接口）。

**说明:** 本任务不新增组件测试（`File.vue` 逻辑薄且项目无组件测试设施），以现有测试套件全量通过 + 手动验证兜底。

- [ ] **Step 1: 修改 import**

`client/src/components/received-item/File.vue` 的 import 块加入 `createMemoryWritable`：

```js
import {
    DEFAULT_DOWNLOAD_CONFIG,
    chooseDownloadParameters,
    createMemoryWritable,
    downloadRangesToFile,
    supportsFileSystemAccessDownload,
} from '@/utils/file-download.mjs';
```

- [ ] **Step 2: 修改 downloadFile 分支逻辑**

将 `downloadFile` 中 `if (fileHandle) { ... } else { this.triggerNativeDownload(url); }` 的 else 分支替换为 else-if + else。完整目标代码（`if (fileHandle)` 块保持不变，此处从其后开始）：

```js
                } else if (this.meta.size >= downloadConfig.threshold
                    && this.meta.size <= downloadConfig.memoryThreshold) {
                    // 非 FSA 浏览器（或用户取消保存对话框）且大小适中时，
                    // 并行 Range 请求下载到内存再触发保存，获得与流式下载一致的进度与速度。
                    streamingAttempted = true;
                    const memoryWritable = createMemoryWritable(this.meta.size);
                    await downloadRangesToFile({
                        url,
                        fileSize: this.meta.size,
                        chunkSize: downloadConfig.chunk,
                        concurrency: downloadConfig.concurrency,
                        maxConcurrency: downloadConfig.maxConcurrency,
                        minChunk: downloadConfig.minChunk,
                        maxChunk: downloadConfig.maxChunk,
                        adaptive: downloadConfig.adaptive,
                        writable: memoryWritable,
                        onProgress: bytes => {
                            if (bytes > 0) scheduleProgress(bytes);
                            else if (bytes < 0) {
                                // 重试时回滚已上报的进度，立即 flush 避免显示倒退滞后
                                pendingDelta += bytes;
                                flushProgress();
                            }
                        },
                    });
                    const objectUrl = URL.createObjectURL(new Blob([memoryWritable.buffer]));
                    try {
                        this.triggerNativeDownload(objectUrl);
                    } finally {
                        URL.revokeObjectURL(objectUrl);
                    }
                    this.$toast('文件下载完成');
                } else {
                    this.triggerNativeDownload(url);
                }
```

要点：

- `streamingAttempted = true` 复用现有 catch 回退逻辑：内存并行失败（重试耗尽、`error.fallback` 等）时走 `triggerNativeDownload(downloadUrl)`。
- 内存路径不触碰局部变量 `writable`（保持 null），`finally` 中的 `writable.abort()` 不会作用于内存缓冲。
- `onProgress` 与流式路径共用同一段回调（rAF 合并进度）。

- [ ] **Step 3: 运行全量客户端测试确认无回归**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard/client && npm test
```

预期：全部 PASS。

- [ ] **Step 4: 手动验证（可选，如环境允许）**

`cd client && npm run serve` 启动开发前端，用 Firefox/Safari（或 DevTools 覆写 `showSaveFilePicker` 为 undefined）下载一个 32MB–100MB 的文件：观察进度条推进、完成后浏览器保存对话框/下载项出现、文件内容完整。再验证 <32MB 文件仍走原生下载（无进度条、立即出现下载项）。

- [ ] **Step 5: 提交**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard
git add client/src/components/received-item/File.vue
git commit -m "非 FSA 浏览器中等大小文件改为内存并行下载"
```

---

### Task 5: 全量验证

- [ ] **Step 1: 运行客户端与服务端全部测试**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard/client && npm test
cd /data/home/yongman.he/proj/node/cloud-clipboard/server-node && npm test
```

预期：两边全部 PASS。

- [ ] **Step 2: 确认构建产物无语法问题（快速冒烟）**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard/client && npx vue-cli-service lint --no-fix src/components/received-item/File.vue src/utils/file-download.mjs 2>/dev/null || node --check src/utils/file-download.mjs
```

预期：无错误输出（lint 脚本不存在时退化为 `node --check` 语法检查）。
