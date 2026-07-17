# 山海 ShanHai 固定订阅源设计

日期：2026-07-17

## 背景

订阅转换功能当前只支持用户填写的 HTTP 订阅 URL（字符串列表）。需要新增一个固定订阅源「山海 ShanHai」，作为第一个订阅源，自动获取并解密节点，与用户填写的源合并后生成最终 Clash YAML。

来源参考：`/data/home/yongman.he/proj/shanhai/shanhai_decode.py`（逆向自 netflow 二进制 v3.1.2-202606191556）。本设计将其核心逻辑改写为 Node.js，集成进 `server-node/app/subscription`。

## 目标

- 新增山海固定订阅源，启用时总是作为第一个订阅源拼接。
- 登录后 token 存本地文件，登录可复用；请求失败自动重新登录并重试。
- 访问订阅时直接获取订阅并解密，返回明文 YAML，交给现有合并/过滤流程。
- 不引入新依赖，仅用 Node 内置模块（`node:crypto`、内置 `undici`）。

## 非目标

- 不在前端暴露山海账号编辑 UI；凭据只在 config.json 配置。
- 不改变现有 sources 字符串语义与前端 Subscription.vue 表单。
- 不为真实网络请求编写自动化测试（涉及凭据、不稳定）。

## 模块结构

新增 `server-node/app/subscription/shanhai-source.js`，封装全部山海逻辑。对外暴露：

```js
fetchShanhaiSubscription(options): Promise<string>
// 返回解密后的 clash/mihomo 明文 YAML 文本
// 失败时抛 Error（由上层当作单个 source 的错误上报）
```

内部私有函数（平移自 Python 版）：

- `b64decodeAny(s)` — 容错 base64 解码（去非表字符 + 补 `=`）。
- `looksLikeJson(b)` / `isPlainClashYaml(b)` — JSON / 明文 YAML 判定。
- `normalizeSubscription(body)` — 去 BOM、尝试 gunzip。
- `decodeOssPayload(body)` — OSS payload 三路解码（JSON → AES-128-CBC → plain base64 → 兜底）。
- `fetchApiUrl(ossUrls)` — 遍历 OSS 镜像，解密得 api host。
- `v2boardLogin(apiUrl, email, password)` — POST /passport/auth/login，返回 auth_data(JWT)。
- `getSubscribeInfo(apiUrl, authData)` — GET /user/getSubscribe，返回 subscribe_url。
- `downloadSubscription(subscribeUrl)` — GET subscribe_url，返回密文。
- `decryptSubscription(body, password)` — AES-256-GCM 解密，返回明文。
- token 缓存读写：`shanhai-token.json`。

硬编码常量从 Python 版平移，不进 config：

```
OSS_AES_KEY = '4422a60e08c97f30'
OSS_AES_IV  = '8c97f304422a60e0'
SUB_PASSWORD = '86f2e72ead6e985e'
SUB_UA = 'securitynet/3.1.2,clash-verge,OpenWrtAPP'
DEFAULT_OSS_URLS = [ 4 个内置镜像 ]
```

为便于单测，上述纯函数（`b64decodeAny`、`decodeOssPayload`、`decryptSubscription`、`normalizeSubscription`、`looksLikeJson`、`isPlainClashYaml`）以命名导出暴露，主入口仍为 `fetchShanhaiSubscription`。

## token 缓存与自动重登录

token 文件：`shanhai-token.json`，路径优先 `config.server.shanhai.tokenFile`，否则 `path.join(config.server.storageDir || cwd, 'shanhai-token.json')`。存：

```json
{ "authData": "<JWT>", "subscribeUrl": "<url>", "apiUrl": "<host>" }
```

缓存 `subscribeUrl`/`apiUrl` 是为了避免每次都遍历 OSS 镜像解密（api_url 基本不变）。

`fetchShanhaiSubscription()` 主流程：

1. 读 token 文件；若无 → 完整登录流程（`fetchApiUrl` → `v2boardLogin` → `getSubscribeInfo` → 存 token）。
2. 用缓存 authData 调 `getSubscribeInfo` 取 subscribe_url（subscribe_url 可能变动，每次取）。
3. 下载密文 → `normalizeSubscription` → 若已是明文 YAML 直接返回；否则 `decryptSubscription` 返回明文。
4. 步骤 2/3 返回 401 或鉴权失败 → 丢弃 token → 重新完整登录 → 重试一次步骤 2-3。
5. 重试仍失败 → 抛最终错误（上层作为该 source 的 error 上报，不阻断其他源）。

鉴权失败判定：HTTP 401，或 v2board 返回 JSON 含 `message` 且无 `data`（复用 Python 版判定）。

并发保护：模块内维护 `pendingPromise`，进行中的请求后续调用复用同一 Promise，避免缓存击穿时多次登录。

## 接入 convertSubscriptionSources（sources 类型扩展）

`service.js` 中 source 从「纯字符串」扩展为「字符串 | 对象」：

- 字符串：原逻辑，HTTP fetch 明文。
- 对象 `{ type: 'shanhai' }`：调用 `fetchShanhaiSubscription()` 拿明文。

改动点：

- `convertSubscriptionSources` 循环内：`typeof source === 'string' ? await fetchSource(source) : await resolveTypedSource(source)`。后续 `parseClashSubscription` / `parseProxyUriList` 不变。
- 新增 `resolveTypedSource(source)` 分发器（service 内），按 `source.type` 路由；shanhai 类型把错误 message 加 `[山海]` 前缀便于 errors 摘要区分。
- `validateSubscriptionConfig`：sources 清洗需保留对象条目（不能复用会把对象转成 `"[object Object]"` 的 `sanitizeLines`）。新增 sources 专用清洗：字符串 trim 后保留、对象原样保留；`assertHttpUrl` 仅对字符串条目调用，对象 source 跳过 URL 校验。include/exclude/customRules 仍用 `sanitizeLines`（始终是字符串）。

**sources 构造（"总是前置拼接"）：**

- `convertSubscriptionSources` 入口处注入山海源：读取传入的 `shanhai` 配置（`enabled && email && password` 齐全），满足则 `sources = [{type:'shanhai'}, ...原 sources]`。
- 配置通过新参数 `shanhai` 传入 `convertSubscriptionSources`，由 http-router 从 `config.server.shanhai` 读出后透传。
- 山海作为第一个成功 source 时自动成为 template（继承 dns/rules），复用现有 `templateSelected` 逻辑，无需特殊处理。

**preview 接口**（`/subscription/preview`）：保持预览与最终产物一致，preview 也注入山海源。http-router 把同一 shanhai 配置透传给 preview 的 `convertSubscriptionSources` 调用。

## 配置与持久化

`server-node/config.json` 的 `server` 下新增 `shanhai`：

```json
"shanhai": {
  "enabled": false,
  "email": "",
  "password": "",
  "tokenFile": null,
  "ossUrls": null
}
```

- `enabled`：是否启用，默认 `false`（不影响现有行为）。
- `email`/`password`：v2board 账号。
- `tokenFile`：token 缓存文件路径，`null` 时默认 `path.join(storageDir || cwd, 'shanhai-token.json')`。
- `ossUrls`：`null` 用内置列表；数组则覆盖（便于镜像失效时临时更换，不进代码）。

- 山海配置只在 config.json，不写入 subscription.json，不在前端编辑。
- `config.js` 生成的默认 server 块加入 `shanhai` 默认值，并在 JSDoc 类型补字段。已有 config.json 缺失该字段时按 `{enabled:false}` 处理，向后兼容。

## HTTP / 解密实现细节

**HTTP 与 TLS：** Node 18 内置 `undici`。用 `undici.Agent({ connect: { rejectUnauthorized: false } })` 创建共享 agent，所有山海相关请求经 `dispatcher` 选项传入。`import { Agent } from 'undici'`（内置模块，无需加依赖）。请求用 `AbortSignal.timeout(30000)`，与 Python 版 30s 一致。

**AES-128-CBC（OSS payload）：**
- `b64decodeAny`：去非表字符 + 补 `=` + base64 解码。
- 解密：`crypto.createDecipheriv('aes-128-cbc', key, iv)`，`setAutoPadding(true)`，拼 update+final。
- 解密结果再 `b64decodeAny` 一次，JSON.parse 得 `{ hosts: [...] }`。

**AES-256-GCM（订阅密文）：**
- key = `crypto.createHash('sha256').update(password).digest()`（32 字节）。
- raw = `b64decodeAny(body.trim())`；nonce = raw[:12]，ctWithTag = raw[12:]。
- `crypto.createDecipheriv('aes-256-gcm', key, nonce)`，`setAuthTag(ctWithTag.slice(-16))`，明文 = update(ctWithTag.slice(0,-16)) + final。tag 校验失败抛错。

**OSS payload 三路解码**：JSON → AES-128-CBC → plain base64 → 兜底，按 Python 版顺序平移。

**明文判定与 normalize**：先 `normalizeSubscription`（去 BOM、gunzip），`isPlainClashYaml` 为真直接返回，否则尝试 GCM 解密。

**错误处理：**
- OSS 镜像遍历到第一个成功为止，全失败抛 `所有 OSS 镜像均失败`。
- 登录失败（v2board 返回 message 且无 data）抛 `登录失败: <message>`。
- getSubscribe 无 subscribe_url 抛错。
- GCM 解密失败抛 `AES-256-GCM 解密失败`。
- 所有错误经 `resolveTypedSource` 加 `[山海]` 前缀。
- 401/鉴权失败触发重登重试一次，重试仍失败抛最终错误。

## 测试

按现有约定（`node --test tests/*.test.mjs`，无外部 mock 框架）。

**1. `tests/shanhai-source.test.mjs`（新增）— 纯算法/逻辑，不打网络：**
- `b64decodeAny`：容错解码（含空白、缺 `=` 补齐）。
- `decodeOssPayload`：三路解码——已是 JSON 直接返回；AES-CBC 密文解密得 JSON；plain base64 解码得 JSON。
- `decryptSubscription`：用已知 password 自加密→解密验证往返一致；篡改 tag 验证抛错。
- 明文 YAML 判定 + normalize（去 BOM、gunzip）。

**2. `tests/subscription-service.test.mjs`（扩展）— sources 类型扩展：**
- `convertSubscriptionSources` 传入 `sources: [{type:'shanhai'}, 'https://...yaml']`，mock 字符串源 + 注入 shanhai mock 返回明文 YAML，验证山海作为第一个成功 source 成为 template、节点合并、errors 区分。
- 验证对象 source 跳过 URL 校验（`validateSubscriptionConfig` 不对 `{type:'shanhai'}` 报错）。
- 验证 `fetchShanhaiSubscription` 失败时作为单个 source error 上报，不阻断其他源。

**不测的部分：** 真实网络请求。token 缓存并发保护靠逻辑审查 + 主流程用例覆盖。

**手动验证：** 实现后用真实账号跑 `node main.js` + 访问 `/subscription/clash`，确认山海节点出现在最终 YAML，留给用户联调。
