# Subscription Converter Implementation Plan

**Goal:** 为当前在线剪贴板项目新增一个全局订阅转换页面和一组后端接口，支持多上游订阅拉取、过滤、固定 token 地址输出 Clash YAML。

**Architecture:** 后端把订阅转换拆成独立模块：配置读写、上游拉取、格式识别与解析、节点归一化/去重/过滤、Clash YAML 生成、短时缓存；HTTP 路由只负责鉴权与入参/出参装配。前端新增一个独立 Vue 页面管理唯一一份全局配置，通过现有 Bearer 管理鉴权调用管理接口，并展示固定订阅地址、预览统计与 token 重置能力。

**Tech Stack:** Vue 2 + Vuetify、Node.js 18、Koa、Node 内置 `node:test`、`yaml`

---

### Task 1: 搭建后端测试入口与订阅核心测试

**Files:**
- Modify: `server-node/package.json`
- Create: `server-node/tests/subscription-service.test.mjs`
- Test: `server-node/tests/subscription-service.test.mjs`

- [ ] **Step 1: 写失败测试，覆盖解析、过滤、YAML 输出与错误分支**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSubscriptionContent,
  normalizeAndFilterProxies,
  buildClashYaml,
  validateSubscriptionConfig,
} from '../app/subscription/service.js';

test('parseSubscriptionContent 解析 Clash YAML', async () => {
  const proxies = await parseSubscriptionContent(`
proxies:
  - { name: HK-1, type: ss, server: 1.1.1.1, port: 443, cipher: aes-128-gcm, password: pass }
`);
  assert.equal(proxies.length, 1);
  assert.equal(proxies[0].name, 'HK-1');
});

test('parseSubscriptionContent 解析 Base64 URI 列表', async () => {
  const raw = Buffer.from('ss://YWVzLTEyOC1nY206cGFzc0AxLjEuMS4xOjQ0MyNISy0y').toString('base64');
  const proxies = await parseSubscriptionContent(raw);
  assert.equal(proxies.length, 1);
  assert.equal(proxies[0].name, 'HK-2');
});

test('normalizeAndFilterProxies 去重并按 include/exclude 过滤', () => {
  const result = normalizeAndFilterProxies([
    { name: 'HK-A', type: 'ss', server: '1.1.1.1', port: 443, cipher: 'aes-128-gcm', password: 'p' },
    { name: 'HK-A', type: 'ss', server: '1.1.1.1', port: 443, cipher: 'aes-128-gcm', password: 'p' },
    { name: 'US-B', type: 'ss', server: '2.2.2.2', port: 443, cipher: 'aes-128-gcm', password: 'p' },
  ], ['HK'], ['实验']);
  assert.equal(result.rawCount, 3);
  assert.equal(result.dedupedCount, 2);
  assert.deepEqual(result.proxies.map(item => item.name), ['HK-A']);
});

test('buildClashYaml 只输出预期代理组', () => {
  const yamlText = buildClashYaml([
    { name: 'HK-A', type: 'ss', server: '1.1.1.1', port: 443, cipher: 'aes-128-gcm', password: 'p' },
  ]);
  assert.match(yamlText, /分组选择/);
  assert.match(yamlText, /HYM/);
  assert.match(yamlText, /自动选择/);
  assert.match(yamlText, /故障转移/);
});

test('validateSubscriptionConfig 拒绝非法 URL 与非法正则', () => {
  assert.throws(() => validateSubscriptionConfig({
    sources: ['not-a-url'],
    includePatterns: ['('],
    excludePatterns: [],
  }));
});
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `cd server-node && node --test tests/subscription-service.test.mjs`

Expected: FAIL，报错指向 `../app/subscription/service.js` 不存在或导出缺失。

- [ ] **Step 3: 为依赖与脚本留入口**

```json
{
  "scripts": {
    "dev": "node --watch main.js",
    "start": "node main.js",
    "test": "node --test tests/*.test.mjs"
  },
  "dependencies": {
    "yaml": "^2.8.1"
  }
}
```

- [ ] **Step 4: 重新运行测试，确认仍为功能性失败**

Run: `cd server-node && node --test tests/subscription-service.test.mjs`

Expected: FAIL，错误从“模块不存在”推进到“函数行为未实现”。

- [ ] **Step 5: Commit**

```bash
git add server-node/package.json server-node/tests/subscription-service.test.mjs
git commit -m "test: add subscription converter service coverage"
```

### Task 2: 实现后端订阅转换核心模块

**Files:**
- Create: `server-node/app/subscription/config-store.js`
- Create: `server-node/app/subscription/service.js`
- Create: `server-node/app/subscription/cache.js`
- Test: `server-node/tests/subscription-service.test.mjs`

- [ ] **Step 1: 先实现配置模型与默认值**

```js
export const createDefaultSubscriptionConfig = () => ({
  sources: [],
  includePatterns: [],
  excludePatterns: [],
  token: randomBytes(18).toString('hex'),
  updatedAt: Date.now(),
});
```

- [ ] **Step 2: 实现配置校验与正则编译**

```js
export const validateSubscriptionConfig = input => {
  const sources = sanitizeLines(input.sources);
  if (!sources.length) {
    throw createHttpError(400, '至少需要一个上游订阅 URL');
  }
  sources.forEach(assertHttpUrl);
  const includePatterns = sanitizeLines(input.includePatterns);
  const excludePatterns = sanitizeLines(input.excludePatterns);
  return {
    sources,
    includePatterns,
    excludePatterns,
    includeRegexes: compileRegexList(includePatterns, '包含正则'),
    excludeRegexes: compileRegexList(excludePatterns, '屏蔽正则'),
  };
};
```

- [ ] **Step 3: 实现多格式解析、去重、过滤与 YAML 输出的最小可用逻辑**

```js
export async function parseSubscriptionContent(rawText) {
  const clashParsed = tryParseClashYaml(rawText);
  if (clashParsed) return clashParsed;
  const decodedText = tryDecodeBase64Text(rawText) || rawText;
  return parseProxyUriList(decodedText);
}

export function normalizeAndFilterProxies(proxies, includePatterns, excludePatterns) {
  const includeRegexes = compileRegexList(includePatterns, '包含正则');
  const excludeRegexes = compileRegexList(excludePatterns, '屏蔽正则');
  const unique = dedupeProxies(proxies);
  const filtered = unique.filter(proxy => matchesInclude(proxy.name, includeRegexes) && !matchesExclude(proxy.name, excludeRegexes));
  if (!filtered.length) {
    throw createHttpError(400, '过滤后无可用节点');
  }
  return { rawCount: proxies.length, dedupedCount: unique.length, filteredCount: filtered.length, proxies: filtered };
}

export function buildClashYaml(proxies) {
  return stringify({
    'mixed-port': 7890,
    'allow-lan': false,
    mode: 'rule',
    proxies,
    'proxy-groups': [
      { name: '分组选择', type: 'select', proxies: ['HYM', '自动选择', '故障转移'] },
      { name: 'HYM', type: 'url-test', url: 'https://www.gstatic.com/generate_204', interval: 300, proxies: proxies.map(item => item.name) },
      { name: '自动选择', type: 'url-test', url: 'https://www.gstatic.com/generate_204', interval: 300, proxies: proxies.map(item => item.name) },
      { name: '故障转移', type: 'fallback', url: 'https://www.gstatic.com/generate_204', interval: 300, proxies: proxies.map(item => item.name) },
    ],
    rules: ['MATCH,分组选择'],
  });
}
```

- [ ] **Step 4: 跑测试直到全部通过**

Run: `cd server-node && node --test tests/subscription-service.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server-node/app/subscription server-node/tests/subscription-service.test.mjs
git commit -m "feat: add subscription conversion core service"
```

### Task 3: 接入后端路由、持久化与公开订阅接口

**Files:**
- Modify: `server-node/app/http-router.js`
- Modify: `server-node/main.js`
- Test: `server-node/tests/subscription-service.test.mjs`

- [ ] **Step 1: 写一个针对路由层最小失败用例，覆盖 token 校验或配置保存入口**

```js
test('generateSubscriptionUrl 生成固定公开地址', () => {
  const url = generateSubscriptionUrl({
    protocol: 'http',
    host: '127.0.0.1:8080',
    prefix: '/api',
    token: 'abc',
  });
  assert.equal(url, 'http://127.0.0.1:8080/api/subscription/clash?token=abc');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server-node && node --test tests/subscription-service.test.mjs`

Expected: FAIL，提示 `generateSubscriptionUrl` 未实现。

- [ ] **Step 3: 最小实现管理接口、预览接口、token 重置与公开接口**

```js
router.get('/subscription/config', authMiddleware, async ctx => {
  const current = await subscriptionStore.read();
  writeJSON(ctx, 200, withSubscriptionUrl(ctx, current));
});

router.put('/subscription/config', authMiddleware, koaBody({ json: true }), async ctx => {
  const saved = await subscriptionStore.save(ctx.request.body || {});
  subscriptionCache.clear();
  writeJSON(ctx, 200, withSubscriptionUrl(ctx, saved));
});

router.post('/subscription/preview', authMiddleware, koaBody({ json: true }), async ctx => {
  const preview = await previewSubscriptionConfig(ctx.request.body || {});
  writeJSON(ctx, 200, preview);
});

router.post('/subscription/token/reset', authMiddleware, async ctx => {
  const saved = await subscriptionStore.resetToken();
  subscriptionCache.clear();
  writeJSON(ctx, 200, withSubscriptionUrl(ctx, saved));
});

router.get('/subscription/clash', async ctx => {
  const text = await getSubscriptionYamlByToken(ctx.query.token, ctx);
  ctx.type = 'text/yaml; charset=utf-8';
  ctx.body = text;
});
```

- [ ] **Step 4: 运行测试并做一次本地启动验证**

Run: `cd server-node && node --test tests/subscription-service.test.mjs`

Expected: PASS

Run: `cd server-node && node main.js`

Expected: 服务成功启动，日志包含 `GET /subscription/...` 的访问能力。

- [ ] **Step 5: Commit**

```bash
git add server-node/app/http-router.js server-node/main.js
git commit -m "feat: expose subscription converter http endpoints"
```

### Task 4: 实现前端订阅转换页面与管理交互

**Files:**
- Modify: `client/src/App.vue`
- Modify: `client/src/router/index.js`
- Create: `client/src/views/Subscription.vue`
- Modify: `client/src/util.js`

- [ ] **Step 1: 先为页面状态与数据映射写出最小交互草稿**

```js
data() {
  return {
    loading: false,
    saving: false,
    previewing: false,
    resettingToken: false,
    form: {
      sourcesText: '',
      includePatternsText: '',
      excludePatternsText: '',
    },
    config: null,
    preview: null,
  };
}
```

- [ ] **Step 2: 补菜单入口和路由**

```js
const Subscription = () => import(/* webpackChunkName: "view-subscription" */ '@/views/Subscription.vue');

{
  path: '/subscription',
  component: Subscription,
}
```

- [ ] **Step 3: 最小实现页面，支持加载配置、预览、保存、复制地址、重置 token**

```js
async saveConfig() {
  this.saving = true;
  try {
    const { data: { result } } = await this.$http.put('subscription/config', this.buildPayload());
    this.applyConfig(result);
    this.$toast('保存成功');
  } catch (error) {
    this.handleRequestError(error, '保存失败');
  } finally {
    this.saving = false;
  }
}
```

- [ ] **Step 4: 本地构建前端确认页面能编译**

Run: `cd client && npm run build`

Expected: BUILD SUCCESS，无新增 Vue 模板错误。

- [ ] **Step 5: Commit**

```bash
git add client/src/App.vue client/src/router/index.js client/src/views/Subscription.vue client/src/util.js
git commit -m "feat: add subscription converter management page"
```

### Task 5: 联调与回归验证

**Files:**
- Modify: `server-node/tests/subscription-service.test.mjs`
- Test: `server-node/tests/subscription-service.test.mjs`

- [ ] **Step 1: 增补一个端到端级别的核心逻辑用例，覆盖多源合并与部分失败摘要**

```js
test('convertSubscriptionSources 汇总节点统计与错误摘要', async () => {
  const fetchSource = async url => {
    if (url.endsWith('/bad')) throw new Error('upstream failed');
    return 'ss://YWVzLTEyOC1nY206cGFzc0AxLjEuMS4xOjQ0MyNISy0y';
  };
  const result = await convertSubscriptionSources({
    sources: ['https://a.example/good', 'https://a.example/bad'],
    includePatterns: [],
    excludePatterns: [],
    fetchSource,
  });
  assert.equal(result.summary.successSourceCount, 1);
  assert.equal(result.summary.failedSourceCount, 1);
  assert.equal(result.proxies.length, 1);
});
```

- [ ] **Step 2: 跑后端测试**

Run: `cd server-node && node --test tests/subscription-service.test.mjs`

Expected: PASS

- [ ] **Step 3: 跑前端构建**

Run: `cd client && npm run build`

Expected: BUILD SUCCESS

- [ ] **Step 4: 手动联调**

Run: `cd server-node && node main.js`

Expected: 访问管理页后可完成以下操作：
- 加载现有配置
- 保存多个上游 URL
- 非法正则返回明确错误
- 预览展示统计和节点名称
- 重置 token 后固定订阅地址更新
- 公开接口返回包含 `分组选择`、`HYM`、`自动选择`、`故障转移` 的 Clash YAML，且默认选中 `HYM`

- [ ] **Step 5: Commit**

```bash
git add server-node/tests/subscription-service.test.mjs
git commit -m "test: cover subscription converter integration flow"
```
