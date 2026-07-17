import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import {
    b64decodeAny,
    decodeOssPayload,
    decryptSubscription,
    fetchShanhaiSubscription,
    looksLikeJson,
    isPlainClashYaml,
    normalizeSubscription,
    SUB_PASSWORD,
    isAuthError,
    AuthError,
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

test('fetchShanhaiSubscription downloadSubscription 收到正确的 subscribeUrl', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shanhai-'));
    const tokenFile = path.join(tmpDir, 'token.json');
    let receivedUrl = '';
    const sub = await fetchShanhaiSubscription({
        email: 'a@b.com',
        password: 'pw',
        tokenFile,
        fetch: {
            fetchApiUrl: async () => ({ apiUrl: 'https://api.example.cn', cfg: {} }),
            v2boardLogin: async () => 'JWT-1',
            getSubscribeInfo: async () => 'https://sub.example.cn/real-sub',
            downloadSubscription: async (url) => { receivedUrl = url; return Buffer.from('proxies:\n  - {name: HK, type: ss, server: 1.1.1.1, port: 443, cipher: aes-128-gcm, password: p}'); },
        },
    });
    assert.equal(receivedUrl, 'https://sub.example.cn/real-sub');
    assert.ok(sub.toString('utf8').includes('proxies:'));
});
