import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import http from 'node:http';
import https from 'node:https';

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
    clean += '='.repeat((4 - (clean.length % 4)) % 4);
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

// ─── HTTP 工具（模块内私有，不导出）────────────────────────────────────
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
        res.on('error', reject);
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
    const mergedHeaders = {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        ...headers,
    };
    return httpRequest(url, { method: 'POST', headers: mergedHeaders, body, timeoutMs });
};

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
    if (isAuthError({ status, body })) {
        let errData = {};
        try {
            errData = parseJsonBody(body);
        } catch {
            errData = {};
        }
        throw new AuthError(`登录失败: ${errData.message || '未知鉴权错误'} (raw=${JSON.stringify(errData)})`);
    }
    const data = parseJsonBody(body);
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
// subscribeUrl 可选：若调用方已持有（如 fullLogin 刚取到），传入以避免重复请求
const fetchPlainWithAuth = async (deps, apiUrl, authData, subscribeUrl) => {
    const subUrl = subscribeUrl || await deps.getSubscribeInfo(apiUrl, authData);
    const cipherBody = await deps.downloadSubscription(subUrl);
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
                // fullLogin 已取到 subscribeUrl，直接复用避免重复鉴权
                return await fetchPlainWithAuth(deps, token.apiUrl, token.authData, token.subscribeUrl);
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
