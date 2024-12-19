const Koa = require('koa');
const httpProxy = require('koa-http-proxy');
const Router = require('koa-router');
const http = require('http');

const app = new Koa();
const router = new Router();

// 创建 HTTP 服务器
const server = http.createServer(app.callback());

// 创建代理中间件
const proxy = httpProxy('http://192.168.2.13:8123', {
    proxyReqPathResolver: (ctx) => {
        // 修改请求路径，去掉/ha前缀
        return ctx.path.replace(/^\/ha/, '');
    },
    changeOrigin: true,
    ws: true, // 允许 WebSocket 代理
});

// 使用路由进行代理
router.all('/ha/*',/^\/ha/, proxy);

// 加载路由中间件
app.use(router.routes()).use(router.allowedMethods());

// 处理 WebSocket 连接
server.on('upgrade', (req, socket, head) => {
    // 代理 WebSocket 连接
    proxy.ws(req, socket, head);
});

// 启动服务器
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`代理服务器正在运行，监听端口 ${PORT}`);
});