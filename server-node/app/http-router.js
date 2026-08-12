import fs from 'node:fs';
import path from 'node:path';
import KoaRouter from '@koa/router';
import { koaBody } from 'koa-body';

import config from './config.js';
import { createAiConfigStore, normalizeAiConfig } from './ai/config-store.js';
import { getKnownModelContexts } from './ai/model-context.js';
import {
    buildCompletionsPayload,
    buildResponsesPayload,
    buildSummaryPayload,
    createStreamingCompletion,
    createStreamingResponse,
    createSummary,
    estimateMessagesTokens,
    listModels,
} from './ai/openai-client.js';
import {
    encodeSseEvent,
    normalizeOpenAiSseEvent,
    parseSseStream,
} from './ai/stream.js';
import messageQueue from './message.js';
import { createSubscriptionCache } from './subscription/cache.js';
import { createSubscriptionConfigStore } from './subscription/config-store.js';
import {
    convertSubscriptionSources,
    generateSubscriptionUrl,
} from './subscription/service.js';
import {
    UploadedFile,
    uploadFileMap,
    storageFolder,
} from './uploaded-file.js';
import {
    buildAccelRedirect,
    formatContentRange,
    parseByteRange,
    RangeNotSatisfiableError,
} from './file-transfer.js';
import {
    writeJSON,
    createThumbnail,
} from './util.js';

const historyPath = config.server.historyFile || path.join(process.cwd(), 'history.json');
const subscriptionConfigPath = config.server.subscriptionFile || path.join(process.cwd(), 'subscription.json');
const aiConfigPath = config.server.aiConfigFile || path.join(process.cwd(), 'ai-config.json');
const subscriptionStore = createSubscriptionConfigStore({
    filePath: subscriptionConfigPath,
});
const aiConfigStore = createAiConfigStore({
    filePath: aiConfigPath,
});

const waitForDrainOrClose = res => new Promise(resolve => {
    const cleanup = () => {
        res.off('drain', onDrain);
        res.off('close', onClose);
    };
    const onDrain = () => {
        cleanup();
        resolve();
    };
    const onClose = () => {
        cleanup();
        resolve();
    };
    res.once('drain', onDrain);
    res.once('close', onClose);
});
const subscriptionCache = createSubscriptionCache({
    ttlMs: 30 * 1000,
});

// 文件分享标记存储 Map<"room:messageId", expireTimestamp>
const shareTokens = new Map();
const SHARE_EXPIRE_MS = 12 * 60 * 60 * 1000; // 12小时

const getSubscriptionRequestContext = ctx => ({
    protocol: ctx.protocol,
    host: ctx.request.host,
    prefix: config.server.prefix || '',
});

const formatSubscriptionConfig = (ctx, value) => ({
    ...value,
    subscriptionUrl: generateSubscriptionUrl({
        ...getSubscriptionRequestContext(ctx),
        token: value.token,
    }),
});

const formatPreviewResult = result => ({
    summary: result.summary,
    proxyNames: result.proxies.map(item => item.name),
    errors: result.errors,
});

const sendStoredFile = async (ctx, file, {disposition = 'attachment'} = {}) => {
    const fileSize = (await fs.promises.stat(file.path)).size;
    let range;
    try {
        range = parseByteRange(ctx.get('range'), fileSize);
    } catch (error) {
        if (!(error instanceof RangeNotSatisfiableError)) throw error;
        ctx.status = 416;
        ctx.set('Content-Range', `bytes */${fileSize}`);
        return;
    }

    ctx.type = path.extname(file.name) || 'application/octet-stream';
    if (disposition === 'inline') {
        ctx.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    } else {
        ctx.attachment(file.name, {type: 'inline'});
    }
    ctx.compress = false;
    ctx.set('Cache-Control', 'no-transform');
    ctx.set('Accept-Ranges', 'bytes');
    if (range.status === 206) {
        ctx.status = 206;
        ctx.set('Content-Range', formatContentRange({
            start: range.start,
            end: range.end,
            fileSize,
        }));
    }
    ctx.set('Content-Length', `${range.length}`);

    if (config.server.nginx.enabled) {
        ctx.set('X-Accel-Redirect', buildAccelRedirect(config.server.nginx.internalPath, file.uuid));
        // Nginx takes over the response and performs the actual file read/sendfile.
        ctx.respond = false;
        ctx.res.end();
        return;
    }

    ctx.body = fs.createReadStream(file.path, range.status === 206
        ? {start: range.start, end: range.end}
        : undefined);
};

const publishFileMessage = async (file, room) => {
    if (file.messageResult) return file.messageResult;
    if (!file.publishPromise) {
        file.publishPromise = (async () => {
            const message = {
                event: 'receive',
                data: {
                    id: -1,
                    type: 'file',
                    room,
                    name: file.name,
                    size: file.size,
                    cache: file.uuid,
                },
            };
            if (file.size <= 33554432) {
                try {
                    message.data.thumbnail = await createThumbnail(file.path);
                } catch {}
            }
            message.data.id = messageQueue.counter;
            messageQueue.enqueue(message);
            file.published = true;
            file.messageResult = message;
            return message;
        })();
    }
    return file.publishPromise;
};

const formatFileContentUrl = (ctx, message) => (
    `${ctx.protocol}://${ctx.request.host}${config.server.prefix}/content/${message.data.id}${message.data.room ? `?room=${encodeURIComponent(message.data.room)}` : ''}`
);

const findFileMessage = file => messageQueue.queue.find(e => (
    e.event === 'receive' &&
    e.data.type === 'file' &&
    e.data.cache === file.uuid
));

const getPublicSubscriptionYaml = async () => {
    const cacheKey = 'public-subscription-yaml';
    const cached = subscriptionCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const current = await subscriptionStore.read();
    const result = await convertSubscriptionSources({
        ...current,
        shanhai: config.server.shanhai,
    });
    return subscriptionCache.set(cacheKey, result.yaml);
};

const saveHistory = () => fs.promises.writeFile(historyPath, JSON.stringify({
    file: Array.from(uploadFileMap.values()).filter(e => e.published).map(e => ({
        name: e.name,
        uuid: e.uuid,
        size: e.size,
        uploadTime: e.uploadTime,
    })),
    receive: messageQueue.queue
        .filter(e => e.event === 'receive')
        .map(e => {
            const data = { ...e.data };
            delete data.expire;
            return data;
        }),
}));

/** @type {import('koa').Middleware} */
const authMiddleware = async (ctx, next) => {
    if (config.server.auth) {
        if (ctx.header.authorization !== `Bearer ${config.server.auth}`) {
            ctx.status = 403;
            const remoteAddress = ctx.request.header['x-real-ip']
                ?? ctx.request.header['x-forwarded-for']?.split(',').pop()?.trim()
                ?? ctx.req.socket.remoteAddress;
            console.log(new Date().toISOString(), '-', remoteAddress, "auth failed: ", ctx.header.authorization);
            return;
        }
    }
    await next();
};

const router = new KoaRouter({
    prefix: config.server.prefix,
});

router.get('/server', async ctx => {
    ctx.body = {
        'auth': !!config.server.auth,
    };
});

// 获取服务配置（HTTP 替代 WebSocket config 事件）
router.get('/config', authMiddleware, async ctx => {
    writeJSON(ctx, 200, {
        version: process.env.VERSION || 'unknown',
        text: config.text,
        file: config.file,
        prefix: config.server.prefix || '',
    });
});

router.get('/subscription/config', authMiddleware, async ctx => {
    const current = await subscriptionStore.read();
    writeJSON(ctx, 200, formatSubscriptionConfig(ctx, current));
});

router.put(
    '/subscription/config',
    authMiddleware,
    koaBody({
        multipart: false,
        urlencoded: false,
        text: false,
        json: true,
    }),
    async ctx => {
        try {
            const saved = await subscriptionStore.save(ctx.request.body || {});
            subscriptionCache.clear();
            writeJSON(ctx, 200, formatSubscriptionConfig(ctx, saved));
        } catch (error) {
            writeJSON(ctx, error.status || 400, {}, error.message || '保存订阅配置失败');
        }
    },
);

router.get('/ai/config', authMiddleware, async ctx => {
    writeJSON(ctx, 200, await aiConfigStore.readPublic());
});

router.put(
    '/ai/config',
    authMiddleware,
    koaBody({
        multipart: false,
        urlencoded: false,
        text: false,
        json: true,
    }),
    async ctx => {
        try {
            const saved = await aiConfigStore.save(ctx.request.body || {});
            writeJSON(ctx, 200, {
                ...saved,
                apiKey: undefined,
                hasApiKey: !!saved.apiKey,
            });
        } catch (error) {
            writeJSON(ctx, error.status || 400, {}, error.message || '保存 AI 配置失败');
        }
    },
);

const queryModelsWithConfig = async ({ body = {}, cache = true } = {}) => {
    const savedConfig = await aiConfigStore.read();
    const apiKey = `${body.apiKey ?? ''}`.trim();
    const queryConfig = apiKey
        ? normalizeAiConfig({
            ...savedConfig,
            apiBase: body.apiBase ?? savedConfig.apiBase,
            apiKey,
            keepApiKey: false,
        }, savedConfig)
        : savedConfig;
    const items = await listModels(queryConfig);
    if (cache && !apiKey) {
        await aiConfigStore.saveCachedModels(items);
    }
    return items;
};

router.get('/ai/models', authMiddleware, async ctx => {
    try {
        const items = await queryModelsWithConfig();
        writeJSON(ctx, 200, {
            items,
        });
    } catch (error) {
        writeJSON(ctx, error.status || 502, {}, error.message || '查询模型失败');
    }
});

router.post(
    '/ai/models',
    authMiddleware,
    koaBody({
        multipart: false,
        urlencoded: false,
        text: false,
        json: true,
    }),
    async ctx => {
        try {
            const items = await queryModelsWithConfig({
                body: ctx.request.body || {},
                cache: false,
            });
            writeJSON(ctx, 200, {
                items,
            });
        } catch (error) {
            writeJSON(ctx, error.status || 502, {}, error.message || '查询模型失败');
        }
    },
);

router.get('/ai/models/context', authMiddleware, async ctx => {
    writeJSON(ctx, 200, {
        items: getKnownModelContexts(),
    });
});

router.post(
    '/ai/token-estimate',
    authMiddleware,
    koaBody({
        multipart: false,
        urlencoded: false,
        text: false,
        json: true,
        jsonLimit: '25mb',
    }),
    async ctx => {
        const messages = ctx.request.body?.messages || [];
        writeJSON(ctx, 200, {
            inputTokens: estimateMessagesTokens(messages),
            estimated: true,
        });
    },
);

router.post(
    '/ai/summary',
    authMiddleware,
    koaBody({
        multipart: false,
        urlencoded: false,
        text: false,
        json: true,
        jsonLimit: '25mb',
    }),
    async ctx => {
        try {
            const aiConfig = await aiConfigStore.read();
            const body = ctx.request.body || {};
            const payload = buildSummaryPayload({
                model: body.model || aiConfig.summaryModel,
                rolePrompt: body.rolePrompt || '',
                messages: body.messages || [],
            });
            writeJSON(ctx, 200, await createSummary(aiConfig, payload));
        } catch (error) {
            writeJSON(ctx, error.status || 502, {}, error.message || '生成摘要失败');
        }
    },
);

router.post(
    '/ai/responses/stream',
    authMiddleware,
    koaBody({
        multipart: false,
        urlencoded: false,
        text: false,
        json: true,
        jsonLimit: '25mb',
    }),
    async ctx => {
        ctx.respond = false;
        ctx.compress = false;
        ctx.res.statusCode = 200;
        ctx.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        ctx.res.setHeader('Cache-Control', 'no-cache, no-transform');
        ctx.res.setHeader('Connection', 'keep-alive');
        ctx.res.setHeader('X-Accel-Buffering', 'no');
        ctx.res.flushHeaders?.();

        const abortController = new AbortController();
        const abortUpstream = () => abortController.abort();
        ctx.res.on('close', abortUpstream);
        const writeSse = async (event, data) => {
            if (ctx.res.destroyed) return;
            if (ctx.res.write(encodeSseEvent(event, data))) return;
            await waitForDrainOrClose(ctx.res);
        };

        try {
            const aiConfig = await aiConfigStore.read();
            const body = ctx.request.body || {};
            const apiType = body.apiType || aiConfig.apiType || 'responses';
            const requestOptions = {
                model: body.model || aiConfig.defaultModel,
                reasoningEffort: body.reasoningEffort ?? aiConfig.defaultReasoningEffort,
                rolePrompt: body.rolePrompt || '',
                messages: body.messages || [],
                tools: body.tools || {},
                stream: true,
            };
            const payload = apiType === 'completions'
                ? buildCompletionsPayload(requestOptions)
                : buildResponsesPayload(requestOptions);
            let upstream;
            if (apiType === 'completions') {
                upstream = await createStreamingCompletion(aiConfig, payload, {
                    signal: abortController.signal,
                });
            } else {
                upstream = await createStreamingResponse(aiConfig, payload, {
                    signal: abortController.signal,
                });
            }

            for await (const upstreamEvent of parseSseStream(upstream.body)) {
                for (const downstreamEvent of normalizeOpenAiSseEvent(upstreamEvent)) {
                    await writeSse(downstreamEvent.event, downstreamEvent.data);
                }
            }
        } catch (error) {
            if (error.name !== 'AbortError' && !ctx.res.destroyed) {
                await writeSse('error', {
                    message: error.message || 'AI 请求失败',
                });
            }
        } finally {
            ctx.res.off('close', abortUpstream);
            if (!ctx.res.destroyed) {
                ctx.res.end();
            }
        }
    },
);

router.post(
    '/subscription/preview',
    authMiddleware,
    koaBody({
        multipart: false,
        urlencoded: false,
        text: false,
        json: true,
    }),
    async ctx => {
        try {
            const result = await convertSubscriptionSources({
                ...(ctx.request.body || {}),
                shanhai: config.server.shanhai,
            });
            writeJSON(ctx, 200, formatPreviewResult(result));
        } catch (error) {
            writeJSON(ctx, error.status || 400, {}, error.message || '预览失败');
        }
    },
);

router.post('/subscription/token/reset', authMiddleware, async ctx => {
    try {
        const saved = await subscriptionStore.resetToken();
        subscriptionCache.clear();
        writeJSON(ctx, 200, formatSubscriptionConfig(ctx, saved));
    } catch (error) {
        writeJSON(ctx, error.status || 500, {}, error.message || '重置订阅 token 失败');
    }
});

router.get('/subscription/clash', async ctx => {
    const token = `${ctx.query.token || ''}`.trim();
    const current = await subscriptionStore.read();
    if (!token || token !== current.token) {
        ctx.status = 403;
        ctx.body = 'Forbidden';
        return;
    }

    try {
        const yamlText = await getPublicSubscriptionYaml();
        ctx.set('Content-Type', 'text/yaml; charset=utf-8');
        ctx.body = yamlText;
    } catch (error) {
        console.error(error.message);
        console.error(error.stack);
        ctx.status = error.status || 502;
        ctx.set('Content-Type', 'text/plain; charset=utf-8');
        ctx.body = error.message || '订阅生成失败';
    }
});

// 分页获取消息列表（HTTP 替代 WebSocket receiveMulti 事件）
// 参数: room, limit, beforeId(向下翻页获取更旧消息), afterId(拉取新增消息)
router.get('/messages', authMiddleware, async ctx => {
    const room = ctx.query.room || '';
    const limit = Math.min(parseInt(ctx.query.limit) || 20, 100);
    const beforeId = ctx.query.beforeId ? parseInt(ctx.query.beforeId) : null;
    const afterId = ctx.query.afterId ? parseInt(ctx.query.afterId) : null;

    // 过滤当前房间的消息，按 id 降序排列（最新的在前）
    let items = messageQueue.queue
        .filter(e => e.event === 'receive' && e.data.room === room)
        .map(e => e.data)
        .sort((a, b) => b.id - a.id);

    if (afterId !== null) {
        // 拉取比 afterId 更新的消息（id 更大）
        items = items.filter(e => e.id > afterId);
    } else if (beforeId !== null) {
        // 拉取比 beforeId 更旧的消息（id 更小）
        items = items.filter(e => e.id < beforeId);
    }

    const hasMore = items.length > limit;
    items = items.slice(0, limit);

    writeJSON(ctx, 200, {
        items,
        hasMore,
        nextCursor: items.length ? items[items.length - 1].id : null,
    });
});

// 更新文本消息
router.put(
    '/text/:id(\\d+)',
    authMiddleware,
    koaBody({
        multipart: false,
        urlencoded: false,
        text: true,
        json: false,
        textLimit: 1048576,
    }),
    async ctx => {
        const id = parseInt(ctx.params.id);
        const room = ctx.query.room || '';
        const message = messageQueue.queue.find(
            e => e.event === 'receive' &&
                 e.data.id === id &&
                 e.data.room === room &&
                 e.data.type === 'text'
        );

        if (!message) {
            writeJSON(ctx, 404, {}, '消息不存在');
            return;
        }

        let body = ctx.request.body;
        if (body.length > config.text.limit) {
            writeJSON(ctx, 400, {}, `文本长度不能超过 ${config.text.limit} 字`);
            return;
        }

        // HTML 转义
        body = body
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll('\'', '&#039;');

        message.data.content = body;
        message.data.updatedAt = Date.now();

        writeJSON(ctx, 200, { updatedAt: message.data.updatedAt });
        saveHistory();
    }
);

router.post(
    '/text',
    authMiddleware,
    koaBody({
        multipart: false,
        urlencoded: false,
        text: true,
        json: false,
        textLimit: 1048576,
    }),
    async ctx => {
        /** @type {String} */
        let body = ctx.request.body;
        if (body.length > config.text.limit) {
            writeJSON(ctx, 400, {}, `文本长度不能超过 ${config.text.limit} 字`);
            return;
        }
        body = body
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll('\'', '&#039;');
        const message = {
            event: 'receive',
            data: {
                id: messageQueue.counter,
                type: 'text',
                room: ctx.query.room || '',
                content: body,
            },
        };
        messageQueue.enqueue(message);
        writeJSON(ctx, 200, {
            url: `${ctx.protocol}://${ctx.request.host}${config.server.prefix}/content/${message.data.id}${ctx.query.room ? `?room=${encodeURIComponent(ctx.query.room)}` : ''}`,
        });
        saveHistory();
    }
);

// 标记文件为可分享（12小时有效期）
router.post('/share/:id(\\d+)', authMiddleware, async ctx => {
    const id = parseInt(ctx.params.id);
    const room = ctx.query.room || '';

    const message = messageQueue.queue.find(e => (
        e.event === 'receive' &&
        e.data.room === room &&
        e.data.id === id &&
        e.data.type === 'file'
    ));

    if (!message) {
        return writeJSON(ctx, 404, {}, 'file not found');
    }

    const expireTime = Date.now() + SHARE_EXPIRE_MS;
    shareTokens.set(`${room}:${id}`, expireTime);

    writeJSON(ctx, 200, { expireTime });
});

router.delete('/revoke/:id(\\d+)', authMiddleware, async ctx => {
    const id = parseInt(ctx.params.id);
    if (!messageQueue.queue.some(e => e.data.id === id)) {
        return writeJSON(ctx, 400, {}, '不存在的消息 ID');
    }
    messageQueue.queue.splice(messageQueue.queue.findIndex(e => e.data.id === id), 1);
    writeJSON(ctx);
    saveHistory();
});

router.delete('/revoke/all', authMiddleware, async ctx => {
    messageQueue.queue = messageQueue.queue.filter(e => e.data.room !== (ctx.query.room || ''));
    writeJSON(ctx);
    saveHistory();
});

router.post(
    '/upload',
    authMiddleware,
    koaBody({
        multipart: true,
        urlencoded: false,
        text: false,
        json: false,
        formLimit: config.file.limit,
        formidable: {
            maxFields: 1,
            multiples: false,
        },
    }),
    async ctx => {
        let file;
        try {
            const formfile = ctx.request.files.file;
            if (!formfile) throw new Error('没有上传的文件');
            file = new UploadedFile(formfile.originalFilename);
            uploadFileMap.set(file.uuid, file);
            file.size = formfile.size;
            await fs.promises.copyFile(formfile.filepath, file.path);
            await fs.promises.unlink(formfile.filepath);
            await file.finish();
            const message = await publishFileMessage(file, ctx.query.room || '');

            writeJSON(ctx, 200, {
                url: formatFileContentUrl(ctx, message),
            });
            saveHistory();
        } catch (error) {
            if (file && !file.published) {
                await file.remove();
                uploadFileMap.delete(file.uuid);
            }
            writeJSON(ctx, 400, {}, error.message || `${error}`);
        }
    }
);

router.post(
    '/upload/chunk',
    authMiddleware,
    koaBody({multipart: false, text: false, json: true,}),
    async ctx => {
        try {
            const { filename, size } = ctx.request.body;
            if (!filename || typeof size !== 'number') {
                return writeJSON(ctx, 400, {}, '需要提供 filename 和 size');
            }
            if (!Number.isSafeInteger(size) || size <= 0) {
                return writeJSON(ctx, 400, {}, '文件大小必须为正整数');
            }
            if (size > config.file.limit) {
                return writeJSON(ctx, 400, {}, '文件大小超过限制');
            }

            const file = new UploadedFile(filename, size);
            await file.open(); // 打开文件并预分配空间

            uploadFileMap.set(file.uuid, file);

            writeJSON(ctx, 200, {
                uuid: file.uuid,
                chunkSize: config.file.chunk
            });
        } catch (error) {
            writeJSON(ctx, 500, error.message || '创建上传任务失败');
        }
    }
);

// 2. 上传分片的接口
// URL 中增加 chunkIndex 来标识分片顺序
router.post('/upload/chunk/:uuid([0-9a-f]{32})/:chunkIndex(\\d+)', authMiddleware, async ctx => {
    try {
        const { uuid, chunkIndex } = ctx.params;
        const file = uploadFileMap.get(uuid);

        if (!file) {
            throw new Error('无效的 UUID');
        }

        const contentLength = ctx.get('content-length');
        const declaredLength = contentLength ? Number.parseInt(contentLength, 10) : null;
        await file.writeStream(
            ctx.req,
            Number.parseInt(chunkIndex, 10),
            Number.isSafeInteger(declaredLength) ? declaredLength : null,
            config.file.chunk,
        );
        writeJSON(ctx);
    } catch (error) {
        ctx.req.resume();
        writeJSON(ctx, 400, {}, error.message || `${error}`);
    }
});

router.post('/upload/finish/:uuid([0-9a-f]{32})', authMiddleware, async ctx => {
    let file;
    let preserveIncompleteUpload = false;
    try {
        file = uploadFileMap.get(ctx.params.uuid);
        if (!file) {
            throw new Error('无效的 UUID');
        }
        if (file.published) {
            const message = file.messageResult || findFileMessage(file);
            if (!message) {
                throw new Error('文件消息不存在');
            }
            return writeJSON(ctx, 200, {
                url: formatFileContentUrl(ctx, message),
            });
        }
        if (!file.isUploadComplete(config.file.chunk)) {
            preserveIncompleteUpload = true;
            throw new Error('文件分片尚未全部上传');
        }
        await file.finish();
        await file.close(); // 关闭文件句柄
        const message = await publishFileMessage(file, ctx.query.room || '');

        writeJSON(ctx, 200, {
            url: formatFileContentUrl(ctx, message),
        });
        saveHistory();
    } catch (error) {
        if (file && !file.published && !preserveIncompleteUpload) {
            await file.remove();
            uploadFileMap.delete(file.uuid);
        }
        writeJSON(ctx, 400, {}, error.message || `${error}`);
    }
});

router.get(['/file/:uuid([0-9a-f]{32})', '/file/:uuid([0-9a-f]{32})/:filename'], authMiddleware, async ctx => {
    const file = uploadFileMap.get(ctx.params.uuid);
    if (!file || !file.published || !fs.existsSync(file.path)) {
        return ctx.status = 404;
    }
    try {
        await sendStoredFile(ctx, file);
    } catch (error) {
        if (error instanceof RangeNotSatisfiableError) {
            ctx.status = 416;
            ctx.set('Content-Range', `bytes */${error.fileSize}`);
            return;
        }
        throw error;
    }
});

router.delete('/file/:uuid([0-9a-f]{32})', authMiddleware, async ctx => {
    const file = uploadFileMap.get(ctx.params.uuid);
    if (!file) {
        return writeJSON(ctx, 404);
    }
    file.remove();
    uploadFileMap.delete(ctx.params.uuid);
    writeJSON(ctx);
    saveHistory();
});

// file消息需要分享标记才能访问
router.get('/content/:id([0-9]+)', async ctx => {
    const message = messageQueue.queue.find(e => (
        e.event === 'receive' &&
        e.data.room === (ctx.query.room || '') &&
        e.data.id === parseInt(ctx.params.id)
    ));
    if (!message) return ctx.status = 404;
    switch (message.data.type) {
        case 'text':
            if (config.server.auth) {
                if (ctx.header.authorization !== `Bearer ${config.server.auth}`) {
                    ctx.status = 403
                    return
                }
            }
            ctx.header['Content-Type'] = 'text/plain';
            ctx.body = message.data.content
                .replaceAll('&amp;', '&')
                .replaceAll('&lt;', '<')
                .replaceAll('&gt;', '>')
                .replaceAll('&quot;', '"')
                .replaceAll('&#039;', '\'');
            break;
        case 'file':
            const shareKey = `${ctx.query.room || ''}:${ctx.params.id}`;
            const expireTime = shareTokens.get(shareKey);

            if (!expireTime || Date.now() > expireTime) {
                if (expireTime) shareTokens.delete(shareKey);
                ctx.status = 403;
                ctx.body = { code: 403, msg: '链接已过期或未授权' };
                return;
            }

            const file = uploadFileMap.get(message.data.cache);
            if (!file || !file.published || !fs.existsSync(file.path)) {
                return ctx.status = 404;
            }
            try {
                await sendStoredFile(ctx, file, {disposition: 'inline'});
            } catch (error) {
                if (error instanceof RangeNotSatisfiableError) {
                    ctx.status = 416;
                    ctx.set('Content-Range', `bytes */${error.fileSize}`);
                    return;
                }
                throw error;
            }
            break;
    }
});

if (fs.existsSync(historyPath)) {
    /**
     * @type {{
     *  file: {
     *      name: String,
     *      uuid: String,
     *      size: Number,
     *      uploadTime: Number,
     *  }[],
     *  receive: ({
     *      type: 'text',
     *      room: String,
     *      content: String,
     *  }|{
     *      type: 'file',
     *      room: String,
     *      name: String,
     *      size: Number,
     *      cache: String,
     *  })[],
     * }}
     */
    const history = JSON.parse(fs.readFileSync(historyPath, {encoding: 'utf-8'}));
    (history.file || []).forEach(e => {
        if (!fs.existsSync(path.join(storageFolder, e.uuid))) return;
        const f = new UploadedFile(e.name);
        f.uuid = e.uuid;
        f.path = path.join(storageFolder, f.uuid);
        f.size = e.size;
        f.uploadTime = e.uploadTime;
        f.published = true;
        uploadFileMap.set(e.uuid, f);
    });
    (history.receive || []).forEach(e => {
        if (e.type === 'file' && !uploadFileMap.has(e.cache)) return;
        const data = { ...e };
        delete data.expire;
        messageQueue.enqueue({
            event: 'receive',
            data: {
                ...data,
                id: messageQueue.counter,
            },
        });
    });
}

const INCOMPLETE_UPLOAD_TTL_SECONDS = 60 * 60;
const cleanupIncompleteUploads = async () => {
    const now = Date.now() / 1000;
    let changed = false;
    for (const [uuid, file] of uploadFileMap) {
        if (file.published || !file.fileHandle || now - file.uploadTime <= INCOMPLETE_UPLOAD_TTL_SECONDS) {
            continue;
        }
        await file.remove();
        uploadFileMap.delete(uuid);
        changed = true;
    }
    if (changed) await saveHistory();
};

// Do not keep an incomplete upload open indefinitely after a process restart.
for (const [uuid, file] of uploadFileMap) {
    if (!file.published) {
        file.remove();
        uploadFileMap.delete(uuid);
    }
}

const incompleteUploadCleanupTimer = setInterval(() => {
    cleanupIncompleteUploads().catch(error => {
        console.error('清理未完成上传失败:', error.message);
    });
}, 10 * 60 * 1000);
incompleteUploadCleanupTimer.unref?.();

// 定期清理过期的分享标记（每小时执行一次）
setInterval(() => {
    const now = Date.now();
    for (const [key, expireTime] of shareTokens) {
        if (now > expireTime) {
            shareTokens.delete(key);
        }
    }
}, 60 * 60 * 1000);

export default router;
