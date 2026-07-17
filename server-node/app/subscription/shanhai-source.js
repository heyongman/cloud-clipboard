import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
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
