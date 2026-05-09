# AGENTS.MD

## 基本约定

- 默认使用简体中文沟通和编写项目说明。
- 默认写文件编码为 `UTF-8`，换行符使用 `CRLF`。
- 在使用 superpowers 时，默认使用 Inline Execution 执行 task，不创建 worktrees，不执行红灯测试。
- 修改前先查看现有实现，优先沿用当前项目的 Vue2/Vuetify、Koa、ESM 写法和目录组织。
- 不要回滚用户已有改动；遇到无关变更时忽略，遇到相关变更时基于现状继续修改。

## 项目概览

- 本项目是在线剪贴板共享工具。
- 前端位于 `client`，技术栈为 Vue 2、Vue CLI、Vuetify 2、axios、vue-router。
- 当前主要后端位于 `server-node`，技术栈为 Node.js 18+、Koa、`@koa/router`，使用 ESM 模块。
- `server` 目录是 PHP/Swoole 版本后端，除非任务明确要求维护 PHP 版本，默认优先修改 `server-node`。
- `docs/superpowers` 保存历史规格和计划文档，可用于理解已有功能背景。

## 常用命令

### 前端

```powershell
cd client
npm install
npm run serve
npm run build
npm test
```

- 前端开发服务端口在 `client/vue.config.js` 中配置为 `1210`。
- 前端开发代理会把请求代理到 `http://localhost:9501/`。
- 构建命令为 `vue-cli-service build --modern && node after-build.js`。

### Node 后端

```powershell
cd server-node
npm install
npm run dev
npm start
npm test
```

- 直接启动方式也可以使用：`cd server-node && node main.js`。
- 后端要求 Node.js `>=18.0.0`。
- `npm run dev` 使用 `node --watch main.js`。
- 首次启动且未指定配置文件时，会在 `server-node/config.json` 生成默认配置。
- 默认配置中的 HTTP/HTTPS 端口来自 `server-node/app/config.js`，本地联调通常需要让 HTTP 端口与前端代理目标 `9501` 保持一致。

## 关键路径

- 前端入口：`client/src/main.js`、`client/src/App.vue`。
- 前端路由：`client/src/router/index.js`。
- 前端 API 和共享连接逻辑：`client/src/api.js`。
- 主要页面：`client/src/views`。
- 文件上传组件：`client/src/components/SendFile.vue`。
- 文本发送组件：`client/src/components/SendText.vue`。
- Markdown 图片导出工具：`client/src/utils/markdown-export.mjs`。
- Node 后端入口：`server-node/main.js`。
- Node 后端 HTTP 路由：`server-node/app/http-router.js`。
- Node 后端配置读取：`server-node/app/config.js`。
- Node 后端消息队列：`server-node/app/message.js`。
- Node 后端文件上传存储：`server-node/app/uploaded-file.js`。
- 订阅转换后端模块：`server-node/app/subscription`。

## 前端开发注意事项

- 保持 Vue 2 Options API 风格，优先沿用现有组件结构和 Vuetify 组件写法。
- 新增页面时同步更新 `client/src/router/index.js`，并检查 `client/src/App.vue` 中导航、标题或缓存逻辑是否需要调整。
- 与后端通信优先使用项目现有的 axios 实例和 `client/src/api.js` 里的认证、房间、分页等约定。
- 文件上传相关改动重点检查 `client/src/components/SendFile.vue` 与后端 `/upload`、`/file`、`/content` 相关接口是否一致。
- Markdown 转图片相关改动优先检查 `client/src/views/Markdown.vue`、`client/src/utils/markdown-export.mjs` 和 `client/tests/markdown-export.test.mjs`。
- 订阅转换页面相关改动优先检查 `client/src/views/Subscription.vue` 与后端 `server-node/app/subscription`。

## Node 后端开发注意事项

- 后端使用 ESM，新增模块使用 `import` / `export`，文件扩展名按现有代码显式写 `.js`。
- HTTP 接口主要集中在 `server-node/app/http-router.js`，新增或调整接口时同步检查前端调用和 README/API 说明。
- 认证通过 `Authorization: Bearer <auth>` 处理，复用 `authMiddleware`。
- JSON 响应优先使用 `server-node/app/util.js` 中的 `writeJSON`。
- 文件上传、缩略图、存储路径相关逻辑分布在 `server-node/app/uploaded-file.js`、`server-node/app/util.js` 和 `server-node/app/http-router.js`。
- 历史消息与上传文件持久化依赖 `history.json`，路径可由配置项 `server.historyFile` 覆盖。
- 订阅转换配置依赖 `subscription.json`，路径可由配置项 `server.subscriptionFile` 覆盖。
- 修改公开路径、静态资源回退或反向代理行为时，重点检查 `server-node/main.js` 中 `prefix`、SPA fallback、`apiFirstSegments`、OCR 代理和静态目录挂载。

## 测试与验证

- 前端单测：`cd client && npm test`。
- Node 后端单测：`cd server-node && npm test`。
- 修改前端构建链路、路由或公共组件后，优先运行 `cd client && npm run build`。
- 修改后端接口、配置、订阅转换或存储逻辑后，优先运行 `cd server-node && npm test`。
- 涉及前后端联调时，先启动后端，再启动前端开发服务，并确认前端代理端口与后端监听端口一致。

## 配置与运行数据

- `server-node/config.json`、`history.json`、`subscription.json`、上传文件目录属于本地运行数据，不应作为常规代码改动提交。
- 默认配置由 `server-node/app/config.js` 生成，包含 `server`、`text`、`file` 三组配置。
- `server.prefix` 会被规范化为以 `/` 开头且不以 `/` 结尾的路径；涉及部署子路径时要同时检查前端 `publicPath` 和后端 `prefix` 行为。

## 文档维护

- README 是用户面向文档，功能、配置或启动方式变化时应同步检查。
- AGENTS.MD 是协作代理面向文档，应记录实际项目结构、命令和开发约定，不写与当前代码不一致的假设。
