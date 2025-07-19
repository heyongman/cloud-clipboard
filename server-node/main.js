import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import url from 'node:url';
import Koa from 'koa';
import koaCompress from 'koa-compress';
import koaMount from 'koa-mount';
import koaStatic from 'koa-static';
import koaWebsocket from 'koa-websocket';
import proxy from 'koa-proxies';

import config from './app/config.js';
import httpRouter from './app/http-router.js';
import wsRouter from './app/ws-router.js';

process.env.VERSION = `node-${JSON.parse(fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'package.json'))).version}`;

const app = koaWebsocket(new Koa);
app.use(proxy('/ocr', {
    target: 'https://aip.baidubce.com',
    changeOrigin: true,
    rewrite: path => path.replace(/^\/ocr/, ''),
    logs: true,
}))
app.use(async (ctx, next) => {
    const startTime = performance.now();

    await next();

    const statusCode = ctx.status;
    const statusString = process.env.NO_COLOR
        ? statusCode.toString()
        : `\x1b[${[39, 94, 92, 96, 93, 91, 95][(statusCode / 100) | 0]}m${statusCode}\x1b[0m`;

    const remoteAddress = ctx.request.header['x-real-ip']
        ?? ctx.request.header['x-forwarded-for']?.split(',').pop()?.trim()
        ?? ctx.req.socket.remoteAddress;

    console.log(new Date().toISOString(), '-', remoteAddress, ctx.request.method, ctx.request.path, statusString, `${(performance.now() - startTime).toFixed(2)}ms`);
})
app.use(koaCompress());
app.use(koaMount(config.server.prefix + '/', koaStatic(path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'static'), {
    maxage: 30 * 24 * 60 * 60 * 1000,
})));
app.use(httpRouter.routes());
app.use(httpRouter.allowedMethods());
app.ws.use(wsRouter.routes());
app.ws.use(wsRouter.allowedMethods());

// WebSocket over HTTP2 · Issue #1458 · websockets/ws
// https://github.com/websockets/ws/issues/1458
const createServer = (isHttps) => isHttps
    ? https.createServer(
        {
            cert: fs.readFileSync(config.server.cert),
            key: fs.readFileSync(config.server.key),
            // allowHTTP1: true,
        },
        app.callback(),
    )
    : http.createServer(app.callback());

// How to create https server and support websocket or wss use koa2? · Issue #29 · kudos/koa-websocket
// https://github.com/kudos/koa-websocket/issues/29#issuecomment-341782858
if (config.server.uds) {
    const s = config.server.uds.split(':');
    const udsPath = s[0];
    const udsPerm = s[1] || '666';
    if (fs.existsSync(udsPath)) {
        fs.unlinkSync(udsPath);
    }
    const server = createServer(false);
    server.listen(udsPath, () => fs.chmodSync(udsPath, udsPerm));
    app.ws.listen({server});
}

app.ws.listen({ noServer: true })
const wss = app.ws.server; // 获取 koa-websocket 内部的 ws 实例

const server = createServer(false);
// 将 HTTP server 的 'upgrade' 事件代理到 wss
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});
server.listen(config.server.port);

const httpsServer = createServer(true);
httpsServer.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});
httpsServer.listen(config.server.httpsPort);

console.log([
    '',
    `Cloud Clipboard ${process.env.VERSION}`,
    'https://github.com/TransparentLC/cloud-clipboard',
    '',
    'Authorization code' + (config.server.auth ? `: ${config.server.auth}` : ' is disabled.'),
    ...(config.server.uds ? [`Server listening on UNIX domain socket ${config.server.uds} ...`] : []),
    'Server available at:',
    `http://${config.server.host}:${config.server.port}`,
    `https://${config.server.host}:${config.server.httpsPort}`,
    '',
].join('\n'));
