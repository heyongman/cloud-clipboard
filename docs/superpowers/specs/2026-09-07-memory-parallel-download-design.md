# 非 FSA 浏览器内存并行下载设计

日期：2026-09-07

## 背景与目标

当前剪贴板文件下载逻辑（`client/src/components/received-item/File.vue` 的 `downloadFile`）：

- 文件 ≥ `file.download.threshold`（默认 32MB）**且**浏览器支持
  File System Access API（`supportsFileSystemAccessDownload`）时，走
  `downloadRangesToFile` 分片流式下载（并行 Range 请求 + `showSaveFilePicker`
  写盘，带进度条、重试、自适应并发）。
- 其余情况走 `triggerNativeDownload`：`<a download>` 触发浏览器原生下载，
  单连接、无进度条。

问题：在不支持 File System Access 的浏览器（Firefox、Safari、iOS WebView 等）
上，中等大小文件只能单连接下载，慢且无进度反馈。

目标：非 FSA 浏览器下，`threshold ≤ 文件大小 ≤ memoryThreshold`（默认
100MB，可配置）的文件采用**内存并行下载**——复用现有分片下载设施并行拉取
到内存，拼成 Blob 后触发保存，并获得与流式下载一致的进度条。

## 需求决策

- **适用范围**：仅 `size >= threshold && size <= memoryThreshold` 且未走
  流式下载（不支持 FSA，或 FSA 支持但用户取消了保存对话框）的文件。小于
  `threshold` 的文件仍走浏览器原生下载；大于 `memoryThreshold` 的文件在非
  FSA 浏览器下仍走原生下载（避免过大内存占用）。
- **失败回退**：内存并行下载失败（重试耗尽、Range 响应异常等）时回退
  `triggerNativeDownload`，与现有流式下载的回退行为一致。
- **进度展示**：复用现有 `downloadedSize` + rAF 合并进度管线。

## 设计

### 1. 配置链路（服务端）

`file.download` 新增 `memoryThreshold` 字段，默认 `100 * 1024 * 1024`。

修改点：

- `server-node/app/file-transfer.js`
  - `DEFAULT_DOWNLOAD_CONFIG` 增加 `memoryThreshold: 100 * 1024 * 1024`
  - `normalizeDownloadConfig` 用现有 `positiveInteger` 模式归一化：
    `memoryThreshold: positiveInteger(raw.memoryThreshold, DEFAULT)`
- `client/src/utils/file-download.mjs`（客户端维护同一份镜像配置）
  - 同样新增 `DEFAULT_DOWNLOAD_CONFIG.memoryThreshold` 与
    `normalizeDownloadConfig` 的归一化处理
- `server-node/app/config.js` 顶部 JSDoc 类型注释的 `file.download` 补充
  `memoryThreshold` 字段
- 部署者的 `config.json` 无需改动——归一化后由现有 `/config` 接口自动下发

### 2. 前端下载决策（`File.vue` 的 `downloadFile`）

```
size >= threshold && supportsFSA             → 流式下载（不变）
size >= threshold && size <= memoryThreshold
  且未获得 fileHandle（不支持 FSA 或用户取消保存对话框）
                                             → 内存并行下载（新增）
其余（< threshold，或 > memoryThreshold 且非 FSA）
                                             → triggerNativeDownload（不变）
```

### 3. 内存适配器（`file-download.mjs`）

新增导出 `createMemoryWritable(fileSize)`：

- 预分配 `new Uint8Array(fileSize)`
- `write({ position, data })` 执行 `buffer.set(data, position)`
- `truncate()` 为 no-op（内存缓冲本身按 `fileSize` 预分配）

该适配器满足 `downloadRangesToFile` 对 `writable` 的全部接口约定
（`write({ type, position, data })` 经 `createWriteQueue` 串行化、
`truncate(fileSize)`），从而**完整复用** Range 校验、指数退避重试、自适应
测速/并发/分片、进度回调与 AbortController 逻辑，无需改动
`downloadRangesToFile` 本身。

下载完成后在 `File.vue` 中：

```js
const blob = new Blob([memoryWritable.buffer]);
const objectUrl = URL.createObjectURL(blob);
this.triggerNativeDownload(objectUrl);
URL.revokeObjectURL(objectUrl);
```

### 4. 错误处理与回退

- 内存并行下载失败：沿用现有 catch 逻辑，将“已尝试下载”标志置位后回退
  `triggerNativeDownload(downloadUrl)`（与流式下载的 `streamingAttempted`
  回退一致）。
- `fileSize` 非法时 `createDownloadRanges` 已抛错 → 同样回退原生下载。
- 用户中止（AbortError）与其他路径行为一致，不触发回退。

## 测试

- `client/tests/file-download.test.mjs`（`node --test`）新增：
  - `memoryThreshold` 归一化用例（非法值回退默认、合法值保留）
  - `createMemoryWritable` 用例：分片乱序写入后缓冲内容与预期一致、
    `truncate` 无副作用
  - `downloadRangesToFile` + `createMemoryWritable` 端到端用例：模拟多分片
    并行响应，校验最终缓冲内容
- `server-node/tests/file-transfer.test.mjs` 新增 `memoryThreshold`
  归一化用例
- `File.vue` 逻辑较薄，不新增组件测试

## 非目标

- 不改变 FSA 浏览器的流式下载路径
- 不为大于 `memoryThreshold` 的文件提供内存或流式替代（仍走原生下载）
- 不做下载暂停/取消 UI
