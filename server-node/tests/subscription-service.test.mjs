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

test('buildClashYaml 继承 dns 与 rules，自定义规则排在最前并统一补单引号', () => {
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
        {
            enable: true,
            ipv6: false,
            nameserver: ['223.5.5.5', '119.29.29.29'],
        },
        [
            "'DOMAIN,clash.dev,HYM'",
            'MATCH,分组选择',
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
    assert.deepEqual(parsed.dns, {
        enable: true,
        ipv6: false,
        nameserver: ['223.5.5.5', '119.29.29.29'],
    });
    assert.deepEqual(parsed.rules, [
        'DOMAIN-SUFFIX,example.com,HYM',
        'GEOIP,CN,DIRECT',
        'DOMAIN,clash.dev,HYM',
        'MATCH,分组选择',
    ]);
    assert.match(yamlText, /- 'DOMAIN-SUFFIX,example\.com,HYM'/);
    assert.match(yamlText, /- 'GEOIP,CN,DIRECT'/);
    assert.match(yamlText, /- 'DOMAIN,clash\.dev,HYM'/);
    assert.match(yamlText, /- 'MATCH,分组选择'/);
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

        if (url.endsWith('/yaml')) {
            return `
dns:
  enable: true
  nameserver:
    - 223.5.5.5
proxy-groups:
  - { name: 代理策略, type: select, proxies: [自动测速, 备用策略] }
  - { name: 自动测速, type: url-test, proxies: [HK-2] }
  - { name: 手动测速, type: url-test, proxies: [HK-2] }
  - { name: 备用策略, type: fallback, proxies: [HK-2] }
rules:
  - DOMAIN-SUFFIX,example.com,代理策略
  - DOMAIN-KEYWORD,stream,自动测速
  - DOMAIN,manual.example,手动测速
  - GEOIP,US,备用策略
  - MATCH,DIRECT
proxies:
  - { name: HK-2, type: ss, server: 1.1.1.1, port: 443, cipher: aes-128-gcm, password: pass }
`;
        }

        return 'ss://YWVzLTEyOC1nY206cGFzc0AyLjIuMi4yOjQ0MyNVUy0x';
    };

    const result = await convertSubscriptionSources({
        sources: ['https://a.example/yaml', 'https://a.example/good', 'https://a.example/bad'],
        includePatterns: [],
        excludePatterns: [],
        customRules: ['GEOIP,CN,DIRECT'],
        fetchSource,
    });

    assert.equal(result.summary.successSourceCount, 2);
    assert.equal(result.summary.failedSourceCount, 1);
    assert.equal(result.summary.rawProxyCount, 2);
    assert.equal(result.summary.filteredProxyCount, 2);
    assert.deepEqual(result.proxies.map(item => item.name), ['HK-2', 'US-1']);
    assert.deepEqual(result.allProxies.map(item => item.name), ['HK-2', 'US-1']);
    const parsed = parseYaml(result.yaml);
    assert.deepEqual(parsed.dns, {
        enable: true,
        nameserver: ['223.5.5.5'],
    });
    assert.deepEqual(parsed.rules, [
        'GEOIP,CN,DIRECT',
        'DOMAIN-SUFFIX,example.com,分组选择',
        'DOMAIN-KEYWORD,stream,自动选择',
        'DOMAIN,manual.example,HYM',
        'GEOIP,US,故障转移',
        'MATCH,DIRECT',
    ]);
    assert.match(result.yaml, /- 'GEOIP,CN,DIRECT'/);
    assert.match(result.yaml, /- 'DOMAIN-SUFFIX,example\.com,分组选择'/);
    assert.match(result.yaml, /- 'DOMAIN-KEYWORD,stream,自动选择'/);
    assert.match(result.yaml, /- 'DOMAIN,manual\.example,HYM'/);
    assert.match(result.yaml, /- 'GEOIP,US,故障转移'/);
    assert.match(result.yaml, /- 'MATCH,DIRECT'/);
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
