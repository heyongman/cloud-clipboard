import assert from 'node:assert/strict';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';

import {
    parseSubscriptionContent,
    normalizeAndFilterProxies,
    buildClashYaml,
    validateSubscriptionConfig,
    convertSubscriptionSources,
    generateSubscriptionUrl,
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

test('buildClashYaml 使用分组选择并默认指向 HYM，自定义规则排在默认规则之前', () => {
    const yamlText = buildClashYaml(
        [
            { name: 'HK-A', type: 'ss', server: '1.1.1.1', port: 443, cipher: 'aes-128-gcm', password: 'p' },
            { name: 'US-B', type: 'ss', server: '2.2.2.2', port: 443, cipher: 'aes-128-gcm', password: 'p' },
        ],
        [
            { name: 'HK-A', type: 'ss', server: '1.1.1.1', port: 443, cipher: 'aes-128-gcm', password: 'p' },
        ],
        [
            'DOMAIN-SUFFIX,example.com,HYM',
            'GEOIP,CN,DIRECT',
        ],
    );
    const parsed = parseYaml(yamlText);
    const groupMap = Object.fromEntries(parsed['proxy-groups'].map(item => [item.name, item]));

    assert.match(yamlText, /HYM/);
    assert.match(yamlText, /分组选择/);
    assert.match(yamlText, /自动选择/);
    assert.match(yamlText, /故障转移/);
    assert.match(yamlText, /MATCH,分组选择/);
    assert.deepEqual(parsed.proxies.map(item => item.name), ['HK-A', 'US-B']);
    assert.equal(groupMap['分组选择'].type, 'select');
    assert.deepEqual(groupMap['分组选择'].proxies, ['HYM', '自动选择', '故障转移']);
    assert.equal(groupMap.HYM.type, 'url-test');
    assert.deepEqual(groupMap.HYM.proxies, ['HK-A']);
    assert.deepEqual(groupMap['自动选择'].proxies, ['HK-A', 'US-B']);
    assert.deepEqual(groupMap['故障转移'].proxies, ['HK-A', 'US-B']);
    assert.deepEqual(parsed.rules, [
        'DOMAIN-SUFFIX,example.com,HYM',
        'GEOIP,CN,DIRECT',
        'MATCH,分组选择',
    ]);
});

test('validateSubscriptionConfig 拒绝非法 URL 与非法正则', () => {
    assert.throws(() => validateSubscriptionConfig({
        sources: ['not-a-url'],
        includePatterns: ['('],
        excludePatterns: [],
        customRules: [],
    }));
});

test('convertSubscriptionSources 汇总节点统计与错误摘要', async () => {
    const fetchSource = async url => {
        if (url.endsWith('/bad')) {
            throw new Error('upstream failed');
        }

        return 'ss://YWVzLTEyOC1nY206cGFzc0AxLjEuMS4xOjQ0MyNISy0y';
    };

    const result = await convertSubscriptionSources({
        sources: ['https://a.example/good', 'https://a.example/bad'],
        includePatterns: [],
        excludePatterns: [],
        customRules: ['DOMAIN-SUFFIX,example.com,HYM'],
        fetchSource,
    });

    assert.equal(result.summary.successSourceCount, 1);
    assert.equal(result.summary.failedSourceCount, 1);
    assert.equal(result.summary.rawProxyCount, 1);
    assert.equal(result.summary.filteredProxyCount, 1);
    assert.deepEqual(result.proxies.map(item => item.name), ['HK-2']);
    assert.deepEqual(result.allProxies.map(item => item.name), ['HK-2']);
    assert.deepEqual(parseYaml(result.yaml).rules, ['DOMAIN-SUFFIX,example.com,HYM', 'MATCH,分组选择']);
    assert.equal(result.errors.length, 1);
});

test('generateSubscriptionUrl 生成固定公开地址', () => {
    const url = generateSubscriptionUrl({
        protocol: 'http',
        host: '127.0.0.1:8080',
        prefix: '/api',
        token: 'abc',
    });

    assert.equal(url, 'http://127.0.0.1:8080/api/subscription/clash?token=abc');
});
