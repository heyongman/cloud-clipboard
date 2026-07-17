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
