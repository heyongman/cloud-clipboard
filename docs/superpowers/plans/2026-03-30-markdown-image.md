# Markdown 长图功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有 Vue 2 在线剪贴板项目新增一个按需加载的 Markdown 长图页面，支持实时预览并导出整篇 PNG 长图，且可切换当前设备、移动端、PC 端三种版式。

**Architecture:** 新功能以独立视图页接入现有前端，通过路由级懒加载隔离页面体积。Markdown 解析与导出图片能力进一步在页面内部动态加载；与尺寸、缩放、文件名相关的规则下沉到可单测的纯函数模块，页面只负责状态管理、交互和 DOM 导出。

**Tech Stack:** Vue 2, Vuetify 2, Vue Router 3, markdown-it, html-to-image, Node built-in `node:test`

---

### Task 1: 建立可测试的导出策略模块

**Files:**
- Create: `client/src/utils/markdown-export.mjs`
- Create: `client/tests/markdown-export.test.mjs`
- Modify: `client/package.json`

- [ ] **Step 1: 写失败测试，覆盖版式宽度、像素比上限、文件名输出**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPreviewWidth,
  getExportPixelRatio,
  createExportFileName,
} from '../src/utils/markdown-export.mjs';
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/markdown-export.test.mjs`
Expected: FAIL，提示模块或导出函数不存在

- [ ] **Step 3: 实现最小纯函数模块**

实现以下能力：
- `getPreviewWidth(mode, containerWidth)`
- `getExportPixelRatio(devicePixelRatio)`
- `createExportFileName(mode, now)`

- [ ] **Step 4: 再次运行测试并确认通过**

Run: `node --test tests/markdown-export.test.mjs`
Expected: PASS

- [ ] **Step 5: 在 `client/package.json` 中增加轻量测试脚本**

Run: `npm pkg set scripts.test=\"node --test tests/markdown-export.test.mjs\"`
Expected: `package.json` 新增 `test` 脚本，保持与当前工程兼容

### Task 2: 引入依赖并接入路由懒加载

**Files:**
- Modify: `client/package.json`
- Modify: `client/package-lock.json`
- Modify: `client/src/router/index.js`
- Modify: `client/src/App.vue`

- [ ] **Step 1: 安装 `markdown-it` 与 `html-to-image`**

Run: `npm install markdown-it html-to-image`
Expected: `package.json` 与 `package-lock.json` 更新

- [ ] **Step 2: 将路由改为懒加载并新增 Markdown 路由**

要求：
- 保持现有页面行为不变
- 新增 `/markdown` 路由
- Markdown 页面独立 chunk

- [ ] **Step 3: 在侧边菜单加入 Markdown 长图入口**

要求：
- 风格与现有菜单一致
- 使用现有 `@mdi/js` 图标体系

- [ ] **Step 4: 运行构建确认路由和依赖改动不破坏打包**

Run: `npm run build`
Expected: 构建成功，生成新异步 chunk

### Task 3: 实现 Markdown 页面基础交互

**Files:**
- Create: `client/src/views/Markdown.vue`

- [ ] **Step 1: 搭建页面骨架**

要求：
- 桌面端双栏、移动端上下布局
- 包含编辑区、控制区、预览区
- 提供默认示例 Markdown

- [ ] **Step 2: 在页面内部按需加载 `markdown-it`**

要求：
- 首次进入页面时加载
- 加载期间提供明确状态
- 解析失败时 toast 提示

- [ ] **Step 3: 连接输入、轻量防抖渲染与预览 HTML**

要求：
- 输入变化后刷新预览
- 支持标题、列表、引用、代码块、链接、图片等常见元素

- [ ] **Step 4: 补齐 Markdown 文章样式**

要求：
- 代码块可横向滚动
- 图片不超宽
- 深浅主题页面可用，导出底色统一浅色

### Task 4: 实现整篇长图导出

**Files:**
- Modify: `client/src/views/Markdown.vue`
- Use: `client/src/utils/markdown-export.mjs`

- [ ] **Step 1: 接入导出模式选择**

要求：
- 模式为 `current`、`mobile`、`desktop`
- 预览区宽度随模式变化

- [ ] **Step 2: 在首次导出时按需加载 `html-to-image`**

要求：
- 不进入页面就加载
- 导出期间禁用重复点击

- [ ] **Step 3: 基于完整预览节点导出 PNG**

要求：
- 导出整篇内容，不是当前视口
- 使用纯函数模块统一决定宽度、像素比、文件名
- 导出后自动下载文件

- [ ] **Step 4: 处理异常与边界情况**

要求：
- 目标节点不存在时阻止导出
- 导库加载失败或生成失败时 toast 提示
- 超长内容场景下限制像素比，避免内存炸掉

### Task 5: 全量验证

**Files:**
- Verify only

- [ ] **Step 1: 运行纯函数测试**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: 运行生产构建**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: 检查打包结果符合懒加载预期**

Run: `Get-ChildItem dist\\js`
Expected: 出现新增的异步 chunk，而不是把 Markdown 依赖并入首页主包

- [ ] **Step 4: 汇总未覆盖风险**

重点记录：
- 远程跨域图片导致 canvas 污染
- 极端超长文档在低内存设备上仍可能较慢
