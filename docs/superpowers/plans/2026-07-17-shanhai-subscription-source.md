# 山海 ShanHai 固定订阅源 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在订阅转换功能中新增山海 ShanHai 固定订阅源，启用时作为第一个订阅源，自动登录、缓存 token、获取并 AES 解密订阅，与用户源合并生成 Clash YAML。

**Architecture:** 新增 `shanhai-source.js` 封装山海全部逻辑（OSS 解密 / 登录 / token 缓存 / GCM 解密），主入口 `fetchShanhaiSubscription(options)` 返回明文 YAML。`service.js` 把 source 类型从纯字符串扩展为「字符串 | 对象」，对象 `{type:'shanhai'}` 走山海分支；入口处按 shanhai 配置前置注入山海源。`config.js` 与默认 config.json 新增 `server.shanhai` 配置块。`http-router.js` 把 shanhai 配置透传给 `convertSubscriptionSources`（含 public clash、preview 两处）。

**Tech Stack:** Node.js 18+ ESM、Koa、`node:crypto`（AES-128-CBC / AES-256-GCM / SHA256）、`node:https`/`node:http`（关闭 TLS 校验的 Agent）、`node:zlib`（gunzip）、`node:test` 测试框架。

## Global Constraints

- 后端 ESM，新模块用 `import`/`export`，文件扩展名显式写 `.js`。
- 默认写文件编码 UTF-8，换行符 CRLF（AGENTS.MD 约定）。
- 不引入新 npm 依赖（只用 Node 内置模块）。`undici` 独立包在当前环境不可 import，HTTP 用 `node:https`/`node:http` + `https.Agent({rejectUnauthorized:false})`。
- 山海相关请求一律关闭 TLS 证书校验。
- 山海账号只在 `config.json` 的 `server.shanhai` 配置，不写入 `subscription.json`，不暴露前端。
- token 缓存失败驱动重登：遇 401/鉴权失败丢弃 token、重新完整登录、重试一次。
- 测试用 `node --test tests/*.test.mjs`，无外部 mock 框架。真实网络请求不写自动化测试。
- AGENTS.MD 约定：使用 Inline Execution，不创建 worktrees，不执行红灯测试（实现阶段直接写代码+测试，跑通即可，无需严格 TDD 红绿循环）。

---

## File Structure

- **Create** `server-node/app/subscription/shanhai-source.js`
  山海全部逻辑。导出纯函数（`b64decodeAny`、`looksLikeJson`、`isPlainClashYaml`、`normalizeSubscription`、`decodeOssPayload`、`decryptSubscription`）+ 主入口 `fetchShanhaiSubscription(options)`。常量 `OSS_AES_KEY`/`OSS_AES_IV`/`SUB_PASSWORD`/`SUB_UA`/`DEFAULT_OSS_URLS` 内部常量。
- **Create** `server-node/tests/shanhai-source.test.mjs`
  纯算法/逻辑单测，不打网络。
- **Modify** `server-node/app/subscription/service.js`
  source 类型扩展（字符串 | 对象）；`validateSubscriptionConfig` 用 sources 专用清洗；`convertSubscriptionSources` 入口注入山海源、循环内分发对象 source；新增 `resolveTypedSource`。
- **Modify** `server-node/tests/subscription-service.test.mjs`
  新增对象 source、注入、错误上报用例。
- **Modify** `server-node/app/config.js`
  默认 config.json 的 server 块加 `shanhai`；JSDoc 补字段；运行时归一化 `config.server.shanhai`。
- **Modify** `server-node/app/http-router.js`
  把 `config.server.shanhai` 透传给 `convertSubscriptionSources`（public clash + preview 两处）。

---

### Task 1: shanhai-source.js 纯函数（base64 / JSON / normalize）

**Files:**
- Create: `server-node/app/subscription/shanhai-source.js`
- Test: `server-node/tests/shanhai-source.test.mjs`

**Interfaces:**
- Produces（本任务导出，供后续任务与测试用）:
  - `b64decodeAny(input: string | Buffer): Buffer`
  - `looksLikeJson(input: Buffer | string): boolean`
  - `isPlainClashYaml(input: Buffer | string): boolean`
  - `normalizeSubscription(input: Buffer | string): Buffer`

- [ ] **Step 1: 写失败测试**

创建 `server-node/tests/shanhai-source.test.mjs`：

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';

import {
    b64decodeAny,
    looksLikeJson,
    isPlainClashYaml,
    normalizeSubscription,
} from '../app/subscription/shanhai-source.js';

test('b64decodeAny 去非表字符并补齐 =', () => {
    // 'hello' 的 base64 是 'aGVsbG8='，去掉末尾 '=' 仍应正确解码
    const out = b64decodeAny('aGVsbG8');
    assert.equal(out.toString('utf8'), 'hello');
});

test('b64decodeAny 容忍空白与非表字符', () => {
    const out = b64decodeAny('aG Vs\nbG8=');
    assert.equal(out.toString('utf8'), 'hello');
});

test('looksLikeJson 识别 JSON', () => {
    assert.equal(looksLikeJson(Buffer.from('  {"a":1}')), true);
    assert.equal(looksLikeJson(Buffer.from('  [1,2]')), true);
    assert.equal(looksLikeJson(Buffer.from('proxies:')), false);
});

test('isPlainClashYaml 识别明文 clash 配置', () => {
    assert.equal(isPlainClashYaml(Buffer.from('proxies:\n  - {name: a}')), true);
    assert.equal(isPlainClashYaml(Buffer.from('mixed-port: 7890')), true);
    assert.equal(isPlainClashYaml(Buffer.from('abcdef')), false);
});

test('normalizeSubscription 去除 BOM', () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('proxies:')]);
    assert.equal(normalizeSubscription(bom).toString('utf8'), 'proxies:');
});

test('normalizeSubscription 解压 gzip', () => {
    const gz = zlib.gzipSync(Buffer.from('proxies:\n  - {name: a}'));
    assert.equal(normalizeSubscription(gz).toString('utf8'), 'proxies:\n  - {name: a}');
});

test('normalizeSubscription 原样返回普通内容', () => {
    const raw = Buffer.from('proxies:');
    assert.equal(normalizeSubscription(raw).toString('utf8'), 'proxies:');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server-node && node --test tests/shanhai-source.test.mjs`
Expected: FAIL（模块不存在 / 导入失败）

- [ ] **Step 3: 写最小实现**

创建 `server-node/app/subscription/shanhai-source.js`，先只放本任务的纯函数与常量声明（后续任务追加）：

```js
import { Buffer } from 'node:buffer';
import zlib from 'node:zlib';

// ─── 硬编码常量（来自二进制反汇编，平移自 shanhai_decode.py）─────────
export const OSS_AES_KEY = Buffer.from('4422a60e08c97f30', 'utf8');
export const OSS_AES_IV = Buffer.from('8c97f304422a60e0', 'utf8');
export const SUB_PASSWORD = '86f2e72ead6e985e';
export const SUB_UA = 'securitynet/3.1.2,clash-verge,OpenWrtAPP';

export const DEFAULT_OSS_URLS = [
    'https://raw.giteeusercontent.com/liilo123/4399/raw/master/ConFigOss.json',
    'https://osnc3.s3.ap-northeast-3.amazonaws.com/opnew/store_oss/2026/06/06/9b42dffe-ec7e-455c-b19a-57ea87884b0f.json',
    'https://osnc4.s3.ap-east-1.amazonaws.com/opnew/store_oss/2026/06/06/9b42dffe-ec7e-455c-b19a-57ea87884b0f.json',
    'https://oss-1350701856.cos.ap-guangzhou.myqcloud.com/opnew/store_oss/2026/06/06/9b42dffe-ec7e-455c-b19a-57ea87884b0f.json',
];

const reBase64 = /[^A-Za-z0-9+/=]/g;

// decodeBase64Any: 容错 base64（去空白/非表字符后补齐 = 再标准解码）
export const b64decodeAny = input => {
    const text = Buffer.isBuffer(input) ? input.toString('utf8') : `${input ?? ''}`;
    let clean = text.replace(reBase64, '');
    clean += '='.repeat(-clean.length % 4);
    return Buffer.from(clean, 'base64');
};

export const looksLikeJson = input => {
    try {
        const text = (Buffer.isBuffer(input) ? input : Buffer.from(`${input ?? ''}`))
            .toString('utf8')
            .replace(/^\s+/, '');
        return text.startsWith('{') || text.startsWith('[');
    } catch {
        return false;
    }
};

export const isPlainClashYaml = input => {
    try {
        const text = (Buffer.isBuffer(input) ? input : Buffer.from(`${input ?? ''}`)).toString('utf8');
        return ['proxies:', 'proxy-groups:', 'proxy-providers:', 'mixed-port:'].some(key => text.includes(key));
    } catch {
        return false;
    }
};

// NormalizeSubscriptionBody: 去 BOM / 尝试 gunzip
export const normalizeSubscription = input => {
    let body = Buffer.isBuffer(input) ? input : Buffer.from(`${input ?? ''}`);
    if (body.slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
        body = body.slice(3);
    }
    // tryGunzip
    if (body.slice(0, 2).equals(Buffer.from([0x1f, 0x8b]))) {
        body = zlib.gunzipSync(body);
    }
    return body;
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server-node && node --test tests/shanhai-source.test.mjs`
Expected: PASS（7 个用例全过）

- [ ] **Step 5: 提交**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard
git add server-node/app/subscription/shanhai-source.js server-node/tests/shanhai-source.test.mjs
git commit -m "新增山海源纯函数：base64/JSON/normalize"
```

---

### Task 2: OSS payload 解密（AES-128-CBC）+ decodeOssPayload 三路解码

**Files:**
- Modify: `server-node/app/subscription/shanhai-source.js`（追加 `decodeOssPayload`）
- Test: `server-node/tests/shanhai-source.test.mjs`（追加用例）

**Interfaces:**
- Consumes: Task 1 的 `b64decodeAny`、`looksLikeJson`
- Produces: `decodeOssPayload(rawBody: Buffer | string): object` —— 返回 OSS 配置对象（含 `hosts` 数组）

- [ ] **Step 1: 写失败测试**

在 `server-node/tests/shanhai-source.test.mjs` 顶部 import 追加 `decodeOssPayload`，文件末尾追加用例：

```js
import {
    // ... 已有导入
    decodeOssPayload,
} from '../app/subscription/shanhai-source.js';

import crypto from 'node:crypto';

// 构造 AES-128-CBC 密文：内层是 base64(JSON)，外层再 base64
const buildOssCiphertext = (json) => {
    const innerJson = JSON.stringify(json);
    const innerB64 = Buffer.from(innerJson, 'utf8').toString('base64');
    const cipher = crypto.createCipheriv(
        'aes-128-cbc',
        Buffer.from('4422a60e08c97f30', 'utf8'),
        Buffer.from('8c97f304422a60e0', 'utf8'),
    );
    const enc = Buffer.concat([cipher.update(innerB64, 'utf8'), cipher.final()]);
    return enc.toString('base64');
};

test('decodeOssPayload 路径1：已是 JSON 直接返回', () => {
    const obj = { hosts: ['https://api.example.cn'] };
    const out = decodeOssPayload(Buffer.from(JSON.stringify(obj)));
    assert.deepEqual(out, obj);
});

test('decodeOssPayload 路径2：AES-128-CBC 解密后是 JSON', () => {
    const obj = { hosts: ['https://api.example.cn', 'https://api2.example.cn'] };
    const ct = buildOssCiphertext(obj);
    const out = decodeOssPayload(ct);
    assert.deepEqual(out, obj);
});

test('decodeOssPayload 路径3：plain base64 解码后是 JSON', () => {
    const obj = { hosts: ['https://api.example.cn'] };
    const plainB64 = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
    const out = decodeOssPayload(plainB64);
    assert.deepEqual(out, obj);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server-node && node --test tests/shanhai-source.test.mjs`
Expected: FAIL（`decodeOssPayload` 未导出）

- [ ] **Step 3: 写最小实现**

在 `shanhai-source.js` 顶部 import 区追加 `import crypto from 'node:crypto';`，并在 `normalizeSubscription` 之后追加：

```js
// decodeOssPayload: 三路解码（JSON → AES-128-CBC → plain base64 → 兜底）
export const decodeOssPayload = rawBody => {
    const body = Buffer.isBuffer(rawBody)
        ? rawBody.toString('utf8')
        : `${rawBody ?? ''}`;

    // 路径1：已是 JSON
    if (looksLikeJson(body)) {
        return JSON.parse(body);
    }

    // 路径2：AES-128-CBC 解密（解密结果是 base64 文本，需再 base64decode）
    try {
        const enc = b64decodeAny(body);
        if (enc.length >= 16 && enc.length % 16 === 0) {
            const decipher = crypto.createDecipheriv('aes-128-cbc', OSS_AES_KEY, OSS_AES_IV);
            const pt = Buffer.concat([decipher.update(enc), decipher.final()]);
            const inner = b64decodeAny(pt);
            if (looksLikeJson(inner)) {
                return JSON.parse(inner.toString('utf8'));
            }
        }
    } catch {
        // 落到下一条路径
    }

    // 路径3：plain base64
    try {
        const dec = b64decodeAny(body);
        if (looksLikeJson(dec)) {
            return JSON.parse(dec.toString('utf8'));
        }
    } catch {
        // 落到兜底
    }

    // 兜底
    return JSON.parse(body);
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server-node && node --test tests/shanhai-source.test.mjs`
Expected: PASS（新增 3 个用例 + 既有 7 个全过）

- [ ] **Step 5: 提交**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard
git add server-node/app/subscription/shanhai-source.js server-node/tests/shanhai-source.test.mjs
git commit -m "新增山海 OSS payload AES-128-CBC 解密与三路解码"
```

---

### Task 3: 订阅密文 AES-256-GCM 解密 decryptSubscription

**Files:**
- Modify: `server-node/app/subscription/shanhai-source.js`（追加 `securityNetAesKey`、`decryptSubscription`）
- Test: `server-node/tests/shanhai-source.test.mjs`（追加用例）

**Interfaces:**
- Consumes: Task 1 的 `b64decodeAny`、`normalizeSubscription`、`isPlainClashYaml`；常量 `SUB_PASSWORD`
- Produces: `decryptSubscription(body: Buffer | string, password?: string): Buffer` —— 返回明文 YAML bytes。tag 校验失败抛错。

- [ ] **Step 1: 写失败测试**

在测试文件 import 追加 `decryptSubscription`，末尾追加用例：

```js
import {
    // ... 已有导入
    decryptSubscription,
    SUB_PASSWORD,
} from '../app/subscription/shanhai-source.js';

// 构造合法 GCM 密文：与 Python 版格式一致 raw = nonce(12) + ct + tag(16)
const buildGcmCiphertext = (plain, password) => {
    const key = crypto.createHash('sha256').update(password).digest();
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([nonce, ct, tag]).toString('base64');
};

test('decryptSubscription 正确解密合法密文', () => {
    const plain = 'proxies:\n  - {name: HK, type: ss, server: 1.1.1.1, port: 443, cipher: aes-128-gcm, password: p}';
    const ct = buildGcmCiphertext(plain, SUB_PASSWORD);
    const out = decryptSubscription(ct);
    assert.equal(out.toString('utf8'), plain);
});

test('decryptSubscription 篡改 tag 抛错', () => {
    const plain = 'proxies:\n  - {name: HK}';
    const ct = buildGcmCiphertext(plain, SUB_PASSWORD);
    // 翻转最后一字节（tag 末位）
    const raw = Buffer.from(ct, 'base64');
    raw[raw.length - 1] ^= 0xff;
    const tampered = raw.toString('base64');
    assert.throws(() => decryptSubscription(tampered));
});

test('decryptSubscription 密文太短抛错', () => {
    const short = Buffer.alloc(10).toString('base64');
    assert.throws(() => decryptSubscription(short));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server-node && node --test tests/shanhai-source.test.mjs`
Expected: FAIL（`decryptSubscription` 未导出）

- [ ] **Step 3: 写最小实现**

在 `decodeOssPayload` 之后追加：

```js
// securityNetAESKey: key = SHA256(password)（32 字节）
const securityNetAesKey = password => crypto.createHash('sha256').update(password).digest();

// tryDecryptSecurityNetSubscription:
//   raw = base64decode(trim(body)); nonce=raw[:12]; ctWithTag=raw[12:]
//   Go crypto/cipher gcm: tag 附在 ciphertext 末尾（最后 16 字节）
export const decryptSubscription = (body, password = SUB_PASSWORD) => {
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : `${body ?? ''}`;
    const raw = b64decodeAny(text.trim());
    if (raw.length < 28) {
        throw new Error(`密文太短 (${raw.length} < 28)`);
    }
    const key = securityNetAesKey(password);
    const nonce = raw.subarray(0, 12);
    const ctWithTag = raw.subarray(12);
    const ct = ctWithTag.subarray(0, ctWithTag.length - 16);
    const tag = ctWithTag.subarray(ctWithTag.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server-node && node --test tests/shanhai-source.test.mjs`
Expected: PASS（新增 3 个 + 既有全过）

- [ ] **Step 5: 提交**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard
git add server-node/app/subscription/shanhai-source.js server-node/tests/shanhai-source.test.mjs
git commit -m "新增山海订阅 AES-256-GCM 解密"
```

---

### Task 4: HTTP 工具（httpGet / httpPostJson，关闭 TLS 校验）

**Files:**
- Modify: `server-node/app/subscription/shanhai-source.js`（追加 HTTP 工具，不导出，模块内私有）

**Interfaces:**
- Produces（模块内私有，不导出）:
  - `httpGet(url: string, headers?: object, timeoutMs?: number): Promise<Buffer>`
  - `httpPostJson(url: string, payload: object, headers?: object, timeoutMs?: number): Promise<{status:number, body:Buffer}>` —— 返回 status 与 body，即使 HTTP 错误也返回（用于读取 v2board 登录失败 body）

注：本任务无独立单测（涉及网络），靠 Task 5/6 间接覆盖；实现后用一次手动 `node -e` 验证 `httpGet` 对一个 https 地址返回非空 buffer。

- [ ] **Step 1: 写实现**

在 `shanhai-source.js` 顶部 import 区追加：

```js
import http from 'node:http';
import https from 'node:https';
```

在 `decryptSubscription` 之后追加（模块内私有，不 export）：

```js
// 订阅服务器可能用非常规证书/自签，统一关闭校验
const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

const httpRequest = (url, { method = 'GET', headers = {}, body = null, timeoutMs = 30000 } = {}) => new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'http:' ? http : https;
    const options = {
        method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: `${parsed.pathname}${parsed.search}`,
        headers,
        agent: transport === https ? insecureHttpsAgent : undefined,
    };
    const req = transport.request(options, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`请求超时 (${timeoutMs}ms): ${url}`));
    });
    if (body) {
        req.write(body);
    }
    req.end();
});

const httpGet = (url, headers = {}, timeoutMs = 30000) => httpRequest(url, { headers, timeoutMs })
    .then(({ status, body }) => {
        if (status < 200 || status >= 300) {
            throw new Error(`HTTP ${status}: ${url}`);
        }
        return body;
    });

// POST JSON，即使 HTTP 错误也返回 status+body（v2board 登录失败返回 500 + JSON message）
const httpPostJson = (url, payload, headers = {}, timeoutMs = 30000) => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const mergedHeaders = { 'Content-Type': 'application/json', ...headers };
    return httpRequest(url, { method: 'POST', headers: mergedHeaders, body, timeoutMs })
        .then(({ status, body: respBody }) => ({ status, body: respBody }));
};
```

- [ ] **Step 2: 手动冒烟验证 httpGet**

Run:
```bash
cd server-node && node --input-type=module -e "
import { } from './app/subscription/shanhai-source.js';
" 2>&1 | head
```
Expected: 无语法/导入错误（模块可加载）

再验证语法（不真正发请求）：
Run: `cd server-node && node --check app/subscription/shanhai-source.js`
Expected: 无输出（语法正确）

- [ ] **Step 3: 跑全部既有测试确认无回归**

Run: `cd server-node && node --test tests/shanhai-source.test.mjs`
Expected: PASS（13 个用例全过，HTTP 工具未影响纯函数）

- [ ] **Step 4: 提交**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard
git add server-node/app/subscription/shanhai-source.js
git commit -m "新增山海 HTTP 工具（关闭 TLS 校验）"
```

---

### Task 5: 登录 / 获取订阅信息 / 下载订阅 + 鉴权失败判定

**Files:**
- Modify: `server-node/app/subscription/shanhai-source.js`（追加 `fetchApiUrl`、`v2boardLogin`、`getSubscribeInfo`、`downloadSubscription`、错误类型辅助）

**Interfaces:**
- Consumes: Task 2 的 `decodeOssPayload`、Task 4 的 `httpGet`/`httpPostJson`；常量 `DEFAULT_OSS_URLS`/`SUB_UA`
- Produces（模块内私有）:
  - `fetchApiUrl(ossUrls: string[]): Promise<{apiUrl:string, cfg:object}>`
  - `v2boardLogin(apiUrl, email, password): Promise<string>` —— 返回 auth_data(JWT)
  - `getSubscribeInfo(apiUrl, authData): Promise<string>` —— 返回 subscribe_url
  - `downloadSubscription(subscribeUrl): Promise<Buffer>` —— 返回密文 bytes
  - `isAuthError({status, body}): boolean` —— 鉴权失败判定（401 或 v2board message 无 data），供 Task 6 重登判定用，导出供测试
  - 自定义错误 `AuthError`（导出供 Task 6 判定），`class AuthError extends Error`

注：网络函数不打单测。`isAuthError`/`AuthError` 是纯逻辑，可单测。

- [ ] **Step 1: 写失败测试（仅 isAuthError / AuthError 纯逻辑）**

测试文件 import 追加：

```js
import {
    // ... 已有导入
    isAuthError,
    AuthError,
} from '../app/subscription/shanhai-source.js';
```

末尾追加用例：

```js
test('isAuthError 识别 401', () => {
    assert.equal(isAuthError({ status: 401, body: Buffer.from('') }), true);
});

test('isAuthError 识别 v2board 鉴权类 message 且无 data', () => {
    const body = Buffer.from(JSON.stringify({ message: '请先登录' }));
    assert.equal(isAuthError({ status: 500, body }), true);
});

test('isAuthError 不误判正常响应', () => {
    const body = Buffer.from(JSON.stringify({ data: { token: 'x' } }));
    assert.equal(isAuthError({ status: 200, body }), false);
});

test('AuthError 是 Error 子类', () => {
    const e = new AuthError('请先登录');
    assert.ok(e instanceof Error);
    assert.equal(e.message, '请先登录');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server-node && node --test tests/shanhai-source.test.mjs`
Expected: FAIL（`isAuthError`/`AuthError` 未导出）

- [ ] **Step 3: 写实现**

在 `httpPostJson` 之后追加：

```js
// v2board 鉴权失败：401，或返回 JSON 含 message 且无 data
export class AuthError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AuthError';
    }
}

export const isAuthError = ({ status, body }) => {
    if (status === 401) {
        return true;
    }
    try {
        const text = body.toString('utf8').trim();
        if (!text.startsWith('{') && !text.startsWith('[')) {
            return false;
        }
        const data = JSON.parse(text);
        return !!data && typeof data === 'object' && 'message' in data && !('data' in data);
    } catch {
        return false;
    }
};

const parseJsonBody = body => JSON.parse(body.toString('utf8'));

// 从 OSS 镜像拉取并解密，返回 { apiUrl, cfg }
const fetchApiUrl = async (ossUrls) => {
    let lastErr;
    for (const url of ossUrls) {
        try {
            const body = await httpGet(url, {}, 20000);
            const cfg = decodeOssPayload(body);
            const hosts = cfg.hosts || [];
            if (hosts.length) {
                return { apiUrl: `${hosts[0]}`.replace(/\/+$/, ''), cfg };
            }
            throw new Error('hosts 字段为空');
        } catch (err) {
            lastErr = err;
        }
    }
    throw new Error(`所有 OSS 镜像均失败: ${lastErr?.message || lastErr}`);
};

// POST /passport/auth/login → auth_data(JWT)，用于后续 /user/getSubscribe 鉴权
const v2boardLogin = async (apiUrl, email, password) => {
    const url = `${apiUrl}/api/v1/passport/auth/login`;
    const { status, body } = await httpPostJson(url, { email, password }, { 'User-Agent': SUB_UA });
    const data = parseJsonBody(body);
    if (isAuthError({ status, body })) {
        throw new AuthError(`登录失败: ${data.message || '未知鉴权错误'} (raw=${JSON.stringify(data)})`);
    }
    const d = data.data || data;
    const authData = d.auth_data;
    if (!authData) {
        throw new Error(`登录响应无 auth_data: ${JSON.stringify(data)}`);
    }
    return authData;
};

// GET /user/getSubscribe Authorization: <auth_data JWT> → subscribe_url
const getSubscribeInfo = async (apiUrl, authData) => {
    const url = `${apiUrl}/api/v1/user/getSubscribe`;
    const body = await httpGet(url, { Authorization: authData, 'User-Agent': SUB_UA });
    const data = parseJsonBody(body);
    const subUrl = (data.data || {}).subscribe_url || data.subscribe_url;
    if (!subUrl) {
        throw new Error(`订阅信息无 subscribe_url: ${JSON.stringify(data)}`);
    }
    return subUrl;
};

// GET subscribe_url UA=securitynet/... → 订阅密文
const downloadSubscription = async (subscribeUrl) => httpGet(subscribeUrl, { 'User-Agent': SUB_UA });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server-node && node --test tests/shanhai-source.test.mjs`
Expected: PASS（新增 4 个 + 既有全过）

- [ ] **Step 5: 语法检查**

Run: `cd server-node && node --check app/subscription/shanhai-source.js`
Expected: 无输出

- [ ] **Step 6: 提交**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard
git add server-node/app/subscription/shanhai-source.js server-node/tests/shanhai-source.test.mjs
git commit -m "新增山海登录/订阅信息/下载与鉴权失败判定"
```

---

### Task 6: token 缓存 + 主入口 fetchShanhaiSubscription（失败驱动重登 + 并发保护）

**Files:**
- Modify: `server-node/app/subscription/shanhai-source.js`（追加 token 读写 + 主入口）

**Interfaces:**
- Consumes: Task 5 的全部网络函数 + `isAuthError`/`AuthError`；Task 3 的 `decryptSubscription`；Task 1 的 `normalizeSubscription`/`isPlainClashYaml`；常量 `DEFAULT_OSS_URLS`
- Produces: `fetchShanhaiSubscription(options): Promise<Buffer>` —— 返回明文 YAML bytes
  - `options`:
    - `email: string`（必填）
    - `password: string`（必填）
    - `tokenFile?: string` —— token 缓存路径，默认 `path.join(cwd, 'shanhai-token.json')`
    - `ossUrls?: string[]` —— 默认 `DEFAULT_OSS_URLS`
    - `fetch?: object` —— 可选注入网络函数（测试用），结构 `{ fetchApiUrl, v2boardLogin, getSubscribeInfo, downloadSubscription }`，默认用模块内真实实现

主流程：
1. 读 token 文件 `{authData, subscribeUrl, apiUrl}`；若无 → 完整登录（fetchApiUrl→v2boardLogin→getSubscribeInfo）并写 token。
2. 用缓存 authData 调 getSubscribeInfo 取 subscribe_url；下载密文 → normalize → 明文 YAML 直接返回，否则 decryptSubscription 返回。
3. 步骤 2 抛 AuthError 或 isAuthError → 丢弃 token → 重新完整登录 → 重试一次。
4. 重试仍失败 → 抛最终错误。
5. 并发保护：模块级 `pendingPromise`，进行中复用同一 Promise。

- [ ] **Step 1: 写失败测试（注入 mock 网络函数，验证重登与并发）**

测试文件 import 追加：

```js
import {
    // ... 已有导入
    fetchShanhaiSubscription,
} from '../app/subscription/shanhai-source.js';
```

末尾追加用例（用 mock 注入，不打真实网络）：

```js
test('fetchShanhaiSubscription 首次无 token → 完整登录并返回解密明文', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shanhai-'));
    const tokenFile = path.join(tmpDir, 'token.json');
    let loginCount = 0;
    const sub = await fetchShanhaiSubscription({
        email: 'a@b.com',
        password: 'pw',
        tokenFile,
        fetch: {
            fetchApiUrl: async () => ({ apiUrl: 'https://api.example.cn', cfg: {} }),
            v2boardLogin: async () => { loginCount += 1; return 'JWT-1'; },
            getSubscribeInfo: async () => 'https://sub.example.cn/sub',
            downloadSubscription: async () => {
                // 返回明文 YAML，走 isPlainClashYaml 分支
                return Buffer.from('proxies:\n  - {name: HK, type: ss, server: 1.1.1.1, port: 443, cipher: aes-128-gcm, password: p}');
            },
        },
    });
    assert.equal(sub.toString('utf8').includes('proxies:'), true);
    assert.equal(loginCount, 1);
    // token 已落盘
    const saved = JSON.parse(await fs.readFile(tokenFile, 'utf8'));
    assert.equal(saved.authData, 'JWT-1');
});

test('fetchShanhaiSubscription 有 token → 复用，不重新登录', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shanhai-'));
    const tokenFile = path.join(tmpDir, 'token.json');
    await fs.writeFile(tokenFile, JSON.stringify({
        authData: 'JWT-CACHED',
        subscribeUrl: 'https://sub.example.cn/sub',
        apiUrl: 'https://api.example.cn',
    }));
    let loginCount = 0;
    const sub = await fetchShanhaiSubscription({
        email: 'a@b.com',
        password: 'pw',
        tokenFile,
        fetch: {
            fetchApiUrl: async () => { throw new Error('不该调用'); },
            v2boardLogin: async () => { loginCount += 1; return 'JWT-NEW'; },
            getSubscribeInfo: async () => 'https://sub.example.cn/sub',
            downloadSubscription: async () => Buffer.from('mixed-port: 7890'),
        },
    });
    assert.equal(sub.toString('utf8'), 'mixed-port: 7890');
    assert.equal(loginCount, 0);
});

test('fetchShanhaiSubscription 鉴权失败 → 自动重登重试一次', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shanhai-'));
    const tokenFile = path.join(tmpDir, 'token.json');
    await fs.writeFile(tokenFile, JSON.stringify({
        authData: 'JWT-OLD',
        subscribeUrl: 'https://sub.example.cn/sub',
        apiUrl: 'https://api.example.cn',
    }));
    let loginCount = 0;
    let getSubCount = 0;
    const sub = await fetchShanhaiSubscription({
        email: 'a@b.com',
        password: 'pw',
        tokenFile,
        fetch: {
            fetchApiUrl: async () => ({ apiUrl: 'https://api.example.cn', cfg: {} }),
            v2boardLogin: async () => { loginCount += 1; return `JWT-${loginCount}`; },
            getSubscribeInfo: async (apiUrl, authData) => {
                getSubCount += 1;
                if (authData === 'JWT-OLD') {
                    const err = new AuthError('请先登录');
                    throw err;
                }
                return 'https://sub.example.cn/sub';
            },
            downloadSubscription: async () => Buffer.from('mixed-port: 7890'),
        },
    });
    assert.equal(sub.toString('utf8'), 'mixed-port: 7890');
    assert.equal(loginCount, 1); // 重登一次
    assert.equal(getSubCount, 2); // 失败1次 + 重试1次
    // token 已更新为新的
    const saved = JSON.parse(await fs.readFile(tokenFile, 'utf8'));
    assert.equal(saved.authData, 'JWT-1');
});

test('fetchShanhaiSubscription 重登后仍失败 → 抛最终错误', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shanhai-'));
    const tokenFile = path.join(tmpDir, 'token.json');
    await fs.writeFile(tokenFile, JSON.stringify({
        authData: 'JWT-OLD',
        subscribeUrl: 'https://sub.example.cn/sub',
        apiUrl: 'https://api.example.cn',
    }));
    await assert.rejects(fetchShanhaiSubscription({
        email: 'a@b.com',
        password: 'pw',
        tokenFile,
        fetch: {
            fetchApiUrl: async () => ({ apiUrl: 'https://api.example.cn', cfg: {} }),
            v2boardLogin: async () => 'JWT-NEW',
            getSubscribeInfo: async () => { throw new AuthError('请先登录'); },
            downloadSubscription: async () => Buffer.from(''),
        },
    }), /请先登录/);
});

test('fetchShanhaiSubscription 并发调用复用同一请求', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shanhai-'));
    const tokenFile = path.join(tmpDir, 'token.json');
    let loginCount = 0;
    const slowLogin = async () => {
        loginCount += 1;
        await new Promise(r => setTimeout(r, 20));
        return 'JWT-1';
    };
    const opts = {
        email: 'a@b.com',
        password: 'pw',
        tokenFile,
        fetch: {
            fetchApiUrl: async () => ({ apiUrl: 'https://api.example.cn', cfg: {} }),
            v2boardLogin: slowLogin,
            getSubscribeInfo: async () => 'https://sub.example.cn/sub',
            downloadSubscription: async () => Buffer.from('mixed-port: 7890'),
        },
    };
    const [a, b] = await Promise.all([
        fetchShanhaiSubscription(opts),
        fetchShanhaiSubscription(opts),
    ]);
    assert.equal(a.toString('utf8'), 'mixed-port: 7890');
    assert.equal(b.toString('utf8'), 'mixed-port: 7890');
    assert.equal(loginCount, 1); // 并发只登录一次
});
```

（测试文件顶部需补 `import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';` —— 若 Task 1 已有则跳过；当前 Task 1 测试文件未引入这三个，需补。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server-node && node --test tests/shanhai-source.test.mjs`
Expected: FAIL（`fetchShanhaiSubscription` 未导出）

- [ ] **Step 3: 写实现**

顶部 import 区追加 `import fs from 'node:fs/promises'; import path from 'node:path';`。

在 `downloadSubscription` 之后追加 token 读写与主入口：

```js
const readTokenFile = async (tokenFile) => {
    try {
        const raw = await fs.readFile(tokenFile, 'utf8');
        const data = JSON.parse(raw);
        if (data && data.authData) {
            return data;
        }
    } catch (err) {
        if (err.code !== 'ENOENT') {
            // 损坏的 token 文件忽略，走重新登录
        }
    }
    return null;
};

const writeTokenFile = async (tokenFile, token) => {
    await fs.mkdir(path.dirname(tokenFile), { recursive: true });
    await fs.writeFile(tokenFile, JSON.stringify(token, null, 4));
};

// 完整登录流程，返回 token + subscribeUrl
const fullLogin = async (deps, email, password, ossUrls) => {
    const { apiUrl } = await deps.fetchApiUrl(ossUrls);
    const authData = await deps.v2boardLogin(apiUrl, email, password);
    const subscribeUrl = await deps.getSubscribeInfo(apiUrl, authData);
    return { apiUrl, authData, subscribeUrl };
};

// 用 authData 取订阅明文：getSubscribe → download → normalize → 解密/直接返回
const fetchPlainWithAuth = async (deps, apiUrl, authData) => {
    const subscribeUrl = await deps.getSubscribeInfo(apiUrl, authData);
    const cipherBody = await deps.downloadSubscription(subscribeUrl);
    const normalized = normalizeSubscription(cipherBody);
    if (isPlainClashYaml(normalized)) {
        return normalized;
    }
    return decryptSubscription(normalized);
};

// 模块级并发保护：相同 tokenFile 的进行中请求复用同一 Promise
const pendingMap = new Map();

export const fetchShanhaiSubscription = async ({
    email,
    password,
    tokenFile = path.join(process.cwd(), 'shanhai-token.json'),
    ossUrls = DEFAULT_OSS_URLS,
    fetch,
} = {}) => {
    if (!email || !password) {
        throw new Error('山海源缺少 email/password 配置');
    }
    const deps = fetch || {
        fetchApiUrl,
        v2boardLogin,
        getSubscribeInfo,
        downloadSubscription,
    };

    const key = tokenFile;
    if (pendingMap.has(key)) {
        return pendingMap.get(key);
    }

    const promise = (async () => {
        try {
            const cached = await readTokenFile(tokenFile);
            if (cached) {
                try {
                    return await fetchPlainWithAuth(deps, cached.apiUrl, cached.authData);
                } catch (err) {
                    if (!(err instanceof AuthError)) {
                        throw err;
                    }
                    // 鉴权失败 → 重新登录重试
                }
            }
            // 无 token 或鉴权失败重登
            const token = await fullLogin(deps, email, password, ossUrls);
            await writeTokenFile(tokenFile, token);
            try {
                return await fetchPlainWithAuth(deps, token.apiUrl, token.authData);
            } catch (err) {
                if (err instanceof AuthError) {
                    throw new AuthError(`重登后仍鉴权失败: ${err.message}`);
                }
                throw err;
            }
        } finally {
            pendingMap.delete(key);
        }
    })();

    pendingMap.set(key, promise);
    return promise;
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server-node && node --test tests/shanhai-source.test.mjs`
Expected: PASS（新增 5 个 + 既有全过）

- [ ] **Step 5: 提交**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard
git add server-node/app/subscription/shanhai-source.js server-node/tests/shanhai-source.test.mjs
git commit -m "新增山海 token 缓存与主入口 fetchShanhaiSubscription"
```

---

### Task 7: service.js sources 类型扩展（对象 source + 专用清洗 + resolveTypedSource）

**Files:**
- Modify: `server-node/app/subscription/service.js`
- Test: `server-node/tests/subscription-service.test.mjs`（追加用例）

**Interfaces:**
- Consumes: Task 6 的 `fetchShanhaiSubscription`
- Produces（service.js 导出，供 Task 9 透传）:
  - `convertSubscriptionSources({ sources, includePatterns, excludePatterns, customRules, fetchSource, shanhai })` 新增 `shanhai` 参数（可选 `{enabled, email, password, tokenFile, ossUrls}`）
  - `validateSubscriptionConfig(input)` 现在保留对象 source（仅对字符串 URL 校验）
  - 新增内部 `resolveTypedSource(source, shanhai)` —— 按 `source.type` 分发；`{type:'shanhai'}` → 调 `fetchShanhaiSubscription`；未知 type 抛错

变更要点：
1. 新增 `sanitizeSources(value)`：字符串 trim 保留、对象原样保留、过滤空/非法。
2. `validateSubscriptionConfig` 用 `sanitizeSources` 替代 `sanitizeLines(input.sources)`；`assertHttpUrl` 仅对字符串条目调用；空 sources 判断改为「无任何有效 source」。
3. `convertSubscriptionSources` 入口：若 `shanhai?.enabled && shanhai?.email && shanhai?.password`，把 `{type:'shanhai'}` 注入到 sources 最前。
4. 循环内：`typeof source === 'string' ? await fetchSource(source) : await resolveTypedSource(source, shanhai)`；error 的 `source` 字段对对象用 `JSON.stringify(source)` 或 `[山海]` 标识。

- [ ] **Step 1: 写失败测试**

在 `server-node/tests/subscription-service.test.mjs` 顶部 import 追加：

```js
import {
    // ... 已有导入
    validateSubscriptionConfig,
    // 已导入 convertSubscriptionSources
} from '../app/subscription/service.js';
```

末尾追加用例：

```js
test('validateSubscriptionConfig 接受对象 source 并跳过 URL 校验', () => {
    const result = validateSubscriptionConfig({
        sources: [{ type: 'shanhai' }, 'https://a.example/sub'],
        includePatterns: [],
        excludePatterns: [],
        customRules: [],
    });
    assert.deepEqual(result.sources, [{ type: 'shanhai' }, 'https://a.example/sub']);
});

test('validateSubscriptionConfig 仍拒绝非法字符串 URL', () => {
    assert.throws(() => validateSubscriptionConfig({
        sources: [{ type: 'shanhai' }, 'not-a-url'],
        includePatterns: [],
        excludePatterns: [],
        customRules: [],
    }));
});

test('convertSubscriptionSources 山海源作为第一个成功 source 成为 template', async () => {
    const fetchSource = async url => 'ss://YWVzLTEyOC1nY206cGFzc0AyLjIuMi4yOjQ0MyNVUy0x';
    const shanhai = {
        enabled: true,
        email: 'a@b.com',
        password: 'pw',
        tokenFile: '/tmp/unused',
    };
    // 注入 fetchShanhaiSubscription mock：通过 fetchSource 无法注入对象源，
    // 故本用例直接验证 sources 注入与对象源分发——用 resolveTypedSource 路径。
    // 这里通过让 shanhai 返回明文 YAML 的方式 mock：将 fetchShanhaiSubscription
    // 替换为本地实现。由于 service.js 直接 import，本用例改用「关闭 shanhai + 手动传对象 source」验证分发。
    const result = await convertSubscriptionSources({
        sources: [{ type: 'shanhai' }, 'https://a.example/good'],
        includePatterns: [],
        excludePatterns: [],
        customRules: ['GEOIP,CN,DIRECT'],
        fetchSource,
        // 通过 shanhai 配置 + 注入 fetch（见下文 service 设计：fetch 字段透传）
        shanhai: {
            enabled: false, // 关闭注入，手动传对象 source 验证分发
            fetch: async () => `
dns:
  enable: true
  nameserver:
    - 223.5.5.5
proxies:
  - { name: SH-1, type: ss, server: 3.3.3.3, port: 443, cipher: aes-128-gcm, password: p }
`,
        },
    });
    assert.equal(result.summary.successSourceCount, 2);
    assert.equal(result.summary.failedSourceCount, 0);
    assert.deepEqual(result.proxies.map(i => i.name), ['SH-1', 'US-1']);
    const parsed = parseYaml(result.yaml);
    // 山海是第一个成功 source → 继承其 dns
    assert.deepEqual(parsed.dns, { enable: true, nameserver: ['223.5.5.5'] });
});

test('convertSubscriptionSources 山海源失败时作为单个 source error 上报，不阻断其他源', async () => {
    const fetchSource = async url => 'ss://YWVzLTEyOC1nY206cGFzc0AyLjIuMi4yOjQ0MyNVUy0x';
    const result = await convertSubscriptionSources({
        sources: [{ type: 'shanhai' }, 'https://a.example/good'],
        includePatterns: [],
        excludePatterns: [],
        customRules: [],
        fetchSource,
        shanhai: {
            enabled: false,
            fetch: async () => { throw new Error('OSS 不可达'); },
        },
    });
    assert.equal(result.summary.successSourceCount, 1);
    assert.equal(result.summary.failedSourceCount, 1);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /山海/);
    assert.deepEqual(result.proxies.map(i => i.name), ['US-1']);
});

test('convertSubscriptionSources shanhai.enabled 时自动注入山海源到最前', async () => {
    const fetchSource = async url => 'ss://YWVzLTEyOC1nY206cGFzc0AyLjIuMi4yOjQ0MyNVUy0x';
    let shanhaiCalled = false;
    const result = await convertSubscriptionSources({
        sources: ['https://a.example/good'],
        includePatterns: [],
        excludePatterns: [],
        customRules: [],
        fetchSource,
        shanhai: {
            enabled: true,
            email: 'a@b.com',
            password: 'pw',
            fetch: async () => {
                shanhaiCalled = true;
                return 'proxies:\n  - { name: SH-INJ, type: ss, server: 3.3.3.3, port: 443, cipher: aes-128-gcm, password: p }';
            },
        },
    });
    assert.equal(shanhaiCalled, true);
    assert.equal(result.summary.successSourceCount, 2);
    assert.deepEqual(result.proxies.map(i => i.name), ['SH-INJ', 'US-1']);
});
```

注：为支持上述 `shanhai.fetch` 注入，`resolveTypedSource` 在调 `fetchShanhaiSubscription` 时把 `shanhai.fetch` 作为 `fetch` 参数透传（测试即可注入）。这与 Task 6 的 `fetch` 选项一致。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server-node && node --test tests/subscription-service.test.mjs`
Expected: FAIL（对象 source 被 `sanitizeLines` 转成字符串 / `shanhai` 参数未支持）

- [ ] **Step 3: 写实现**

修改 `server-node/app/subscription/service.js`：

3a. 顶部 import 区追加：

```js
import { fetchShanhaiSubscription } from './shanhai-source.js';
```

3b. 在 `sanitizeLines` 之后新增 `sanitizeSources`：

```js
const sanitizeSources = value => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map(item => {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
                return item;
            }
            return `${item ?? ''}`.trim();
        })
        .filter(item => {
            if (item && typeof item === 'object') {
                return true;
            }
            return Boolean(item);
        });
};
```

3c. 修改 `validateSubscriptionConfig`，用 `sanitizeSources`，并对字符串才校验 URL：

```js
export const validateSubscriptionConfig = input => {
    const sources = sanitizeSources(input?.sources);
    if (!sources.length) {
        throw createHttpError(400, '至少需要一个上游订阅 URL');
    }

    sources.forEach(source => {
        if (typeof source === 'string') {
            assertHttpUrl(source);
        }
    });

    const includePatterns = sanitizeLines(input?.includePatterns);
    const excludePatterns = sanitizeLines(input?.excludePatterns);
    const customRules = sanitizeLines(input?.customRules);

    compileRegexList(includePatterns, '包含正则');
    compileRegexList(excludePatterns, '屏蔽正则');

    return {
        sources,
        includePatterns,
        excludePatterns,
        customRules,
    };
};
```

3d. 在 `defaultFetchSource` 之后新增 `resolveTypedSource`：

```js
const resolveTypedSource = async (source, shanhai) => {
    const type = `${source?.type ?? ''}`.toLowerCase();
    if (type === 'shanhai') {
        const cfg = shanhai && typeof shanhai === 'object' ? shanhai : {};
        try {
            const buf = await fetchShanhaiSubscription({
                email: cfg.email,
                password: cfg.password,
                tokenFile: cfg.tokenFile,
                ossUrls: cfg.ossUrls,
                fetch: cfg.fetch,
            });
            return buf.toString('utf8');
        } catch (err) {
            throw new Error(`[山海] ${err.message || '获取订阅失败'}`);
        }
    }
    throw new Error(`未知的订阅源类型: ${type || '(空)'}`);
};
```

3e. 修改 `convertSubscriptionSources`：签名加 `shanhai`，入口注入，循环内分发，error 标识。

把函数签名与开头改为：

```js
export const convertSubscriptionSources = async ({
    sources,
    includePatterns = [],
    excludePatterns = [],
    customRules = [],
    fetchSource = defaultFetchSource,
    shanhai,
}) => {
    const shanhaiEnabled = shanhai?.enabled && shanhai?.email && shanhai?.password;
    const injectedSources = shanhaiEnabled
        ? [{ type: 'shanhai' }, ...(Array.isArray(sources) ? sources : [])]
        : sources;

    const {
        sources: validSources,
        includePatterns: validIncludePatterns,
        excludePatterns: validExcludePatterns,
        customRules: validCustomRules,
    } = validateSubscriptionConfig({
        sources: injectedSources,
        includePatterns,
        excludePatterns,
        customRules,
    });
    const proxies = [];
    const errors = [];
    let successSourceCount = 0;
    let failedSourceCount = 0;
    let inheritedDns;
    let inheritedRules = [];
    let templateSelected = false;

    for (const source of validSources) {
        const sourceLabel = typeof source === 'string' ? source : `[${source.type || 'typed'}]`;
        try {
            const rawText = typeof source === 'string'
                ? await fetchSource(source)
                : await resolveTypedSource(source, shanhai);
            const text = `${rawText ?? ''}`.trim();
            const clashSubscription = parseClashSubscription(text);
            const parsedProxies = clashSubscription
                ? clashSubscription.proxies
                : parseProxyUriList(tryDecodeBase64Text(text) || text);

            if (!parsedProxies.length) {
                throw new Error('未解析到节点');
            }

            proxies.push(...parsedProxies);
            successSourceCount += 1;

            if (!templateSelected) {
                inheritedDns = clashSubscription?.dns;
                inheritedRules = rewriteInheritedRules(
                    clashSubscription?.rules,
                    clashSubscription?.proxyGroups,
                );
                templateSelected = true;
            }
        } catch (error) {
            failedSourceCount += 1;
            errors.push({
                source: sourceLabel,
                message: error.message || '未知错误',
            });
        }
    }

    if (!proxies.length) {
        throw createHttpError(502, errors[0]?.message || '全部上游订阅均不可用');
    }

    const filteredResult = normalizeAndFilterProxies(
        proxies,
        validIncludePatterns,
        validExcludePatterns,
    );

    return {
        allProxies: filteredResult.allProxies,
        proxies: filteredResult.proxies,
        errors,
        summary: {
            successSourceCount,
            failedSourceCount,
            rawProxyCount: filteredResult.rawCount,
            dedupedProxyCount: filteredResult.dedupedCount,
            filteredProxyCount: filteredResult.filteredCount,
        },
        yaml: buildClashYaml(
            filteredResult.allProxies,
            filteredResult.proxies,
            validCustomRules,
            inheritedDns,
            inheritedRules,
        ),
    };
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server-node && node --test tests/subscription-service.test.mjs`
Expected: PASS（新增 5 个 + 既有 6 个全过）

- [ ] **Step 5: 跑全部测试确认无回归**

Run: `cd server-node && npm test`
Expected: PASS（subscription-service + subscription-store + shanhai-source 全过）

- [ ] **Step 6: 提交**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard
git add server-node/app/subscription/service.js server-node/tests/subscription-service.test.mjs
git commit -m "订阅源支持对象类型与山海源注入分发"
```

---

### Task 8: config.js 新增 server.shanhai 配置

**Files:**
- Modify: `server-node/app/config.js`

**Interfaces:**
- Produces: `config.server.shanhai` 归一化为 `{enabled:boolean, email:string, password:string, tokenFile:string|null, ossUrls:string[]|null}`；缺失时 `{enabled:false,...}`。默认 config.json 模板加入 shanhai 块；JSDoc 补字段。

- [ ] **Step 1: 修改默认 config.json 模板**

在 `config.js` 的 `fs.writeFileSync(defaultConfigPath, JSON.stringify({...}, null, 4))` 的 `server` 对象里，在 `storageDir: null,` 之后加入：

```js
            shanhai: {
                enabled: false,
                email: '',
                password: '',
                tokenFile: null,
                ossUrls: null,
            },
```

- [ ] **Step 2: 修改 JSDoc 类型**

在 JSDoc 的 `server` 类型块里，`storageDir: [String],` 之后加：

```js
 *      shanhai: {
 *          enabled: Boolean,
 *          email: [String],
 *          password: [String],
 *          tokenFile: [String],
 *          ossUrls: [String[]],
 *      },
```

- [ ] **Step 3: 末尾归一化 shanhai 字段**

在 `config.js` 文件末尾（`module.exports = config;` 之前）追加：

```js
// 归一化 shanhai 配置（向后兼容：缺失时按禁用处理）
const rawShanhai = config.server.shanhai && typeof config.server.shanhai === 'object'
    ? config.server.shanhai
    : {};
config.server.shanhai = {
    enabled: rawShanhai.enabled === true,
    email: typeof rawShanhai.email === 'string' ? rawShanhai.email : '',
    password: typeof rawShanhai.password === 'string' ? rawShanhai.password : '',
    tokenFile: typeof rawShanhai.tokenFile === 'string' ? rawShanhai.tokenFile : null,
    ossUrls: Array.isArray(rawShanhai.ossUrls) ? rawShanhai.ossUrls : null,
};
```

- [ ] **Step 4: 验证配置加载（不依赖真实账号）**

Run:
```bash
cd server-node && node --input-type=module -e "
import config from './app/config.js';
console.log(JSON.stringify(config.server.shanhai));
"
```
Expected: 输出形如 `{"enabled":false,"email":"","password":"","tokenFile":null,"ossUrls":null}`（若你本地 config.json 已有 server 字段但无 shanhai，归一化后同样得到此结果）。

- [ ] **Step 5: 跑全部测试确认无回归**

Run: `cd server-node && npm test`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard
git add server-node/app/config.js
git commit -m "config 新增 server.shanhai 配置与归一化"
```

---

### Task 9: http-router.js 透传 shanhai 配置（public clash + preview）

**Files:**
- Modify: `server-node/app/http-router.js`

**Interfaces:**
- Consumes: Task 8 的 `config.server.shanhai`；Task 7 的 `convertSubscriptionSources({...,shanhai})`
- 修改 `getPublicSubscriptionYaml` 与 `/subscription/preview` 两处调用，把 `config.server.shanhai` 作为 `shanhai` 传入。

注意：透传时剔除 `shanhai.fetch`（那是测试注入用的，生产环境不传）。即 `{...config.server.shanhai, fetch: undefined}`。

- [ ] **Step 1: 修改 getPublicSubscriptionYaml**

把：
```js
    const current = await subscriptionStore.read();
    const result = await convertSubscriptionSources(current);
    return subscriptionCache.set(cacheKey, result.yaml);
```
改为：
```js
    const current = await subscriptionStore.read();
    const result = await convertSubscriptionSources({
        ...current,
        shanhai: config.server.shanhai,
    });
    return subscriptionCache.set(cacheKey, result.yaml);
```

- [ ] **Step 2: 修改 /subscription/preview**

把：
```js
            const result = await convertSubscriptionSources(ctx.request.body || {});
```
改为：
```js
            const result = await convertSubscriptionSources({
                ...(ctx.request.body || {}),
                shanhai: config.server.shanhai,
            });
```

- [ ] **Step 3: 语法检查**

Run: `cd server-node && node --check app/http-router.js`
Expected: 无输出

- [ ] **Step 4: 跑全部测试确认无回归**

Run: `cd server-node && npm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard
git add server-node/app/http-router.js
git commit -m "http-router 透传 shanhai 配置给订阅转换与预览"
```

---

### Task 10: README / AGENTS.MD 文档同步 + 手动联调指引

**Files:**
- Modify: `README.md`（订阅转换章节补山海配置说明）
- Modify: `AGENTS.MD`（订阅转换关键路径补 shanhai-source.js）

- [ ] **Step 1: README 补山海配置**

在 README 订阅转换相关章节（搜索 `subscription` 或 `订阅` 定位）追加一段：

```markdown
### 山海固定订阅源（可选）

在 `config.json` 的 `server.shanhai` 中配置山海（ShanHai）账号后，启用时该源会作为第一个订阅源自动获取并解密节点，与用户填写的上游源合并：

```json
{
  "server": {
    "shanhai": {
      "enabled": true,
      "email": "your-email",
      "password": "your-password",
      "tokenFile": null,
      "ossUrls": null
    }
  }
}
```

- `enabled`：是否启用山海源，默认 `false`。
- `email` / `password`：山海 v2board 账号。
- `tokenFile`：登录 token 缓存文件路径，`null` 时默认存于上传存储目录下的 `shanhai-token.json`，登录可复用；鉴权失败会自动重新登录并重试一次。
- `ossUrls`：自定义 OSS 镜像列表，`null` 用内置列表。

山海源对前端透明，仅在订阅转换的错误摘要中可能看到 `[山海]` 标记。
```

- [ ] **Step 2: AGENTS.MD 关键路径补 shanhai-source.js**

在 AGENTS.MD「关键路径」中 `订阅转换后端模块：server-node/app/subscription。` 之后补一行：

```markdown
- 山海固定订阅源模块：`server-node/app/subscription/shanhai-source.js`，配置项 `server.shanhai`（在 `server-node/app/config.js`）。
```

并在「配置与运行数据」的运行数据列表中追加 `shanhai-token.json`（默认在上传存储目录下，可由 `server.shanhai.tokenFile` 覆盖）。

- [ ] **Step 3: 跑全部测试最终确认**

Run: `cd server-node && npm test`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
cd /data/home/yongman.he/proj/node/cloud-clipboard
git add README.md AGENTS.MD
git commit -m "文档同步山海固定订阅源配置说明"
```

- [ ] **Step 5: 手动联调（用户执行，需真实账号）**

提示用户：
1. 在 `server-node/config.json` 的 `server.shanhai` 填入真实 email/password 并设 `enabled: true`。
2. `cd server-node && node main.js` 启动后端。
3. 浏览器/Clash 访问 `/subscription/clash?token=<subscription.json 里的 token>`，确认返回 YAML 中包含山海节点。
4. 首次成功后查看 `shanhai-token.json` 已生成；重启后端再访问，应复用 token（不重新登录，日志无登录请求）。
5. 手动改坏 `shanhai-token.json` 中的 authData 再访问，应自动重登重试成功。

---

## Self-Review

**1. Spec coverage:**
- 模块结构（shanhai-source.js + 纯函数导出）→ Task 1-6 ✓
- token 缓存 + 失败驱动重登 + 并发保护 → Task 6 ✓
- sources 类型扩展 + 注入 + resolveTypedSource → Task 7 ✓
- preview 也注入山海 → Task 9（preview 透传 shanhai）✓
- config.json shanhai 配置 + config.js 归一化 + 默认模板 + JSDoc → Task 8 ✓
- HTTP/TLS node:https Agent 关闭校验 → Task 4 ✓
- AES-128-CBC OSS 解密 + 三路解码 → Task 2 ✓
- AES-256-GCM 订阅解密 → Task 3 ✓
- 明文判定 + normalize（BOM/gunzip）→ Task 1 ✓
- 错误处理（OSS 全失败/登录失败/无 subscribe_url/GCM 失败/401 重登）→ Task 5/6 ✓
- 测试（纯算法 + service 扩展）→ Task 1-7 ✓
- 文档同步 → Task 10 ✓

**2. Placeholder scan:** 无 TBD/TODO；每个代码步骤含完整代码。

**3. Type consistency:**
- `fetchShanhaiSubscription(options)` 签名在 Task 6 定义、Task 7 的 `resolveTypedSource` 调用一致（email/password/tokenFile/ossUrls/fetch）✓
- `convertSubscriptionSources({...,shanhai})` 在 Task 7 定义、Task 9 透传一致 ✓
- `shanhai.fetch` 注入：Task 6 支持 `fetch` 选项，Task 7 透传 `cfg.fetch`，Task 9 生产环境传 `config.server.shanhai`（无 fetch 字段，归一化后为 undefined，`resolveTypedSource` 传 `fetch: undefined` → `fetchShanhaiSubscription` 用默认真实实现）✓
- `isAuthError`/`AuthError` 在 Task 5 定义、Task 6 使用一致 ✓
- `sanitizeSources` Task 7 新增，`validateSubscriptionConfig` 改用它 ✓
