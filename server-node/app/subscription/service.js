import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';

import { parse, Scalar, stringify } from 'yaml';

const URI_PROTOCOL_PATTERN = /^(ss|trojan|vmess|vless):\/\//i;

const createHttpError = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const sanitizeLines = value => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map(item => `${item ?? ''}`.trim())
        .filter(Boolean);
};

const sanitizeRuleLines = value => sanitizeLines(value).map(rule => {
    if (rule.length >= 2 && rule.startsWith('\'') && rule.endsWith('\'')) {
        return rule.slice(1, -1).trim();
    }

    return rule;
});

const sanitizeProxyGroups = value => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map(item => {
            if (!item || typeof item !== 'object') {
                return null;
            }

            const name = `${item.name ?? ''}`.trim();
            const type = `${item.type ?? ''}`.trim().toLowerCase();
            if (!name) {
                return null;
            }

            return {
                name,
                type,
            };
        })
        .filter(Boolean);
};

const compileRegexList = (patterns, label) => patterns.map((pattern, index) => {
    try {
        return new RegExp(pattern, 'i');
    } catch (error) {
        throw createHttpError(400, `${label}第 ${index + 1} 条规则无效: ${pattern}`);
    }
});

const assertHttpUrl = rawUrl => {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw createHttpError(400, `无效的订阅 URL: ${rawUrl}`);
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw createHttpError(400, `订阅 URL 仅支持 HTTP/HTTPS: ${rawUrl}`);
    }
};

const normalizeProxy = proxy => {
    if (!proxy || typeof proxy !== 'object') {
        return null;
    }

    const name = `${proxy.name ?? ''}`.trim();
    const type = `${proxy.type ?? ''}`.trim();
    const server = `${proxy.server ?? ''}`.trim();
    const port = Number(proxy.port);

    if (!name || !type || !server || !Number.isFinite(port) || port <= 0) {
        return null;
    }

    return {
        ...proxy,
        name,
        type,
        server,
        port,
    };
};

const parseClashSubscription = rawText => {
    try {
        const parsed = parse(rawText);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.proxies)) {
            return null;
        }

        const proxies = parsed.proxies
            .map(normalizeProxy)
            .filter(Boolean);

        if (!proxies.length) {
            return null;
        }

        return {
            proxies,
            dns: parsed.dns && typeof parsed.dns === 'object' ? parsed.dns : undefined,
            rules: sanitizeRuleLines(parsed.rules),
            proxyGroups: sanitizeProxyGroups(parsed['proxy-groups']),
        };
    } catch {
        return null;
    }
};

const tryDecodeBase64Text = rawText => {
    const compact = rawText.replace(/\s+/g, '');
    if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/=]+$/.test(compact)) {
        return null;
    }

    try {
        const decoded = Buffer.from(compact, 'base64').toString('utf8').trim();
        if (!decoded || !decoded.split(/\r?\n/).some(line => URI_PROTOCOL_PATTERN.test(line.trim()))) {
            return null;
        }
        return decoded;
    } catch {
        return null;
    }
};

const parseSsUri = rawUri => {
    const hashIndex = rawUri.indexOf('#');
    let name = hashIndex >= 0 ? decodeURIComponent(rawUri.slice(hashIndex + 1)) : 'SS 节点';
    const body = hashIndex >= 0 ? rawUri.slice(0, hashIndex) : rawUri;
    const payload = body.slice('ss://'.length);

    let userInfo = payload;
    let plugin = '';
    const pluginIndex = payload.indexOf('/?');
    if (pluginIndex >= 0) {
        userInfo = payload.slice(0, pluginIndex);
        plugin = payload.slice(pluginIndex + 2);
    }

    if (!userInfo.includes('@')) {
        userInfo = Buffer.from(userInfo, 'base64').toString('utf8');
    }

    const decodedHashIndex = userInfo.indexOf('#');
    if (decodedHashIndex >= 0) {
        if (name === 'SS 节点') {
            name = decodeURIComponent(userInfo.slice(decodedHashIndex + 1)) || name;
        }
        userInfo = userInfo.slice(0, decodedHashIndex);
    }

    const atIndex = userInfo.lastIndexOf('@');
    if (atIndex === -1) {
        throw new Error(`无法解析 SS 节点: ${rawUri}`);
    }

    const auth = userInfo.slice(0, atIndex);
    const host = userInfo.slice(atIndex + 1);
    const authSeparatorIndex = auth.indexOf(':');
    const hostSeparatorIndex = host.lastIndexOf(':');

    if (authSeparatorIndex === -1 || hostSeparatorIndex === -1) {
        throw new Error(`无法解析 SS 节点: ${rawUri}`);
    }

    const cipher = auth.slice(0, authSeparatorIndex);
    const password = auth.slice(authSeparatorIndex + 1);
    const server = host.slice(0, hostSeparatorIndex);
    const port = Number(host.slice(hostSeparatorIndex + 1));

    const proxy = normalizeProxy({
        name,
        type: 'ss',
        server,
        port,
        cipher,
        password,
        udp: true,
    });

    if (!proxy || !proxy.cipher || !proxy.password) {
        throw new Error(`无法解析 SS 节点: ${rawUri}`);
    }

    if (plugin) {
        proxy.plugin = plugin;
    }

    return proxy;
};

const parseTrojanUri = rawUri => {
    const url = new URL(rawUri);
    const proxy = normalizeProxy({
        name: decodeURIComponent(url.hash.replace(/^#/, '')) || 'Trojan 节点',
        type: 'trojan',
        server: url.hostname,
        port: Number(url.port),
        password: decodeURIComponent(url.username),
        sni: url.searchParams.get('sni') || undefined,
        skipCertVerify: url.searchParams.get('allowInsecure') === '1',
        udp: true,
    });

    if (!proxy || !proxy.password) {
        throw new Error(`无法解析 Trojan 节点: ${rawUri}`);
    }

    return proxy;
};

const parseVmessUri = rawUri => {
    const payload = rawUri.slice('vmess://'.length).trim();
    const decoded = Buffer.from(payload, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    const proxy = normalizeProxy({
        name: parsed.ps || 'VMess 节点',
        type: 'vmess',
        server: parsed.add,
        port: Number(parsed.port),
        uuid: parsed.id,
        alterId: Number(parsed.aid ?? 0),
        cipher: parsed.scy || 'auto',
        tls: `${parsed.tls ?? ''}`.toLowerCase() === 'tls',
        network: parsed.net || 'tcp',
        wsPath: parsed.path || undefined,
        wsHeaders: parsed.host ? { Host: parsed.host } : undefined,
        servername: parsed.sni || undefined,
        udp: true,
    });

    if (!proxy || !proxy.uuid) {
        throw new Error(`无法解析 VMess 节点: ${rawUri}`);
    }

    return proxy;
};

const parseVlessUri = rawUri => {
    const url = new URL(rawUri);
    const proxy = normalizeProxy({
        name: decodeURIComponent(url.hash.replace(/^#/, '')) || 'VLESS 节点',
        type: 'vless',
        server: url.hostname,
        port: Number(url.port),
        uuid: decodeURIComponent(url.username),
        tls: ['tls', 'reality'].includes((url.searchParams.get('security') || '').toLowerCase()),
        network: url.searchParams.get('type') || 'tcp',
        servername: url.searchParams.get('sni') || undefined,
        udp: true,
    });

    if (!proxy || !proxy.uuid) {
        throw new Error(`无法解析 VLESS 节点: ${rawUri}`);
    }

    return proxy;
};

const parseProxyUri = rawUri => {
    const line = rawUri.trim();
    if (!line) {
        return null;
    }

    if (/^ss:\/\//i.test(line)) {
        return parseSsUri(line);
    }
    if (/^trojan:\/\//i.test(line)) {
        return parseTrojanUri(line);
    }
    if (/^vmess:\/\//i.test(line)) {
        return parseVmessUri(line);
    }
    if (/^vless:\/\//i.test(line)) {
        return parseVlessUri(line);
    }

    return null;
};

const parseProxyUriList = rawText => rawText
    .split(/\r?\n/)
    .map(line => parseProxyUri(line))
    .filter(Boolean);

const dedupeProxies = proxies => {
    const seen = new Set();

    return proxies.filter(proxy => {
        const key = `${proxy.type}\u0000${proxy.server}\u0000${proxy.port}\u0000${proxy.name}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
};

const matchesInclude = (name, includeRegexes) => (
    includeRegexes.length === 0 || includeRegexes.some(regex => regex.test(name))
);

const matchesExclude = (name, excludeRegexes) => excludeRegexes.some(regex => regex.test(name));

const buildInheritedRuleGroupMap = proxyGroups => {
    const groups = sanitizeProxyGroups(proxyGroups);
    const mapped = new Map();
    const urlTestGroups = groups.filter(group => group.type === 'url-test');
    const fallbackGroup = groups.find(group => group.type === 'fallback');

    if (urlTestGroups[1]?.name) {
        mapped.set(urlTestGroups[1].name, 'HYM');
    }

    if (fallbackGroup?.name) {
        mapped.set(fallbackGroup.name, '分组选择');
    }

    if (urlTestGroups[0]?.name && !mapped.has(urlTestGroups[0].name)) {
        mapped.set(urlTestGroups[0].name, '分组选择');
    }

    if (groups[0]?.name) {
        mapped.set(groups[0].name, '分组选择');
    }

    return {
        mapped,
        upstreamGroupNames: new Set(groups.map(group => group.name)),
    };
};

const rewriteInheritedRules = (rules, proxyGroups) => {
    const normalizedRules = sanitizeRuleLines(rules);
    if (!normalizedRules.length) {
        return [];
    }

    const {
        mapped,
        upstreamGroupNames,
    } = buildInheritedRuleGroupMap(proxyGroups);

    return normalizedRules.map(rule => rule
        .split(',')
        .map(segment => {
            const trimmed = segment.trim();
            if (!trimmed) {
                return trimmed;
            }

            if (mapped.has(trimmed)) {
                return mapped.get(trimmed);
            }

            if (upstreamGroupNames.has(trimmed)) {
                return '分组选择';
            }

            return trimmed;
        })
        .join(','));
};

const defaultFetchSource = async url => {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Clash.Meta',
        },
    });
    if (!response.ok) {
        throw new Error(`上游请求失败: ${response.status}`);
    }

    return response.text();
};

export const createDefaultSubscriptionConfig = () => ({
    sources: [],
    includePatterns: [],
    excludePatterns: [],
    customRules: [],
    token: crypto.randomBytes(18).toString('hex'),
    updatedAt: Date.now(),
});

export const validateSubscriptionConfig = input => {
    const sources = sanitizeLines(input?.sources);
    if (!sources.length) {
        throw createHttpError(400, '至少需要一个上游订阅 URL');
    }

    sources.forEach(assertHttpUrl);

    const includePatterns = sanitizeLines(input?.includePatterns);
    const excludePatterns = sanitizeLines(input?.excludePatterns);
    const customRules = sanitizeLines(input?.customRules);

    compileRegexList(includePatterns, '包含正则');
    compileRegexList(excludePatterns, '屏蔽正则');

    return {
        sources,
        includePatterns,
        excludePatterns,
        customRules,
    };
};

export const parseSubscriptionContent = async rawText => {
    const text = `${rawText ?? ''}`.trim();
    if (!text) {
        return [];
    }

    const clashSubscription = parseClashSubscription(text);
    if (clashSubscription) {
        return clashSubscription.proxies;
    }

    const decodedText = tryDecodeBase64Text(text) || text;
    return parseProxyUriList(decodedText);
};

export const normalizeAndFilterProxies = (proxies, includePatterns = [], excludePatterns = []) => {
    const includeRegexes = compileRegexList(sanitizeLines(includePatterns), '包含正则');
    const excludeRegexes = compileRegexList(sanitizeLines(excludePatterns), '屏蔽正则');
    const normalized = proxies
        .map(normalizeProxy)
        .filter(Boolean);
    const deduped = dedupeProxies(normalized);
    const filtered = deduped.filter(proxy => matchesInclude(proxy.name, includeRegexes) && !matchesExclude(proxy.name, excludeRegexes));

    if (!filtered.length) {
        throw createHttpError(400, '过滤后无可用节点');
    }

    return {
        rawCount: normalized.length,
        dedupedCount: deduped.length,
        filteredCount: filtered.length,
        allProxies: deduped,
        proxies: filtered,
    };
};

const createSingleQuotedRule = rule => {
    const scalar = new Scalar(rule);
    scalar.type = Scalar.QUOTE_SINGLE;
    return scalar;
};

export const buildClashYaml = (
    allProxies,
    filteredProxies = allProxies,
    customRules = [],
    dns,
    inheritedRules = [],
) => {
    const selectProxyNames = Array.from(new Set([
        'HYM',
        ...allProxies.map(item => item.name),
    ]));
    const normalizedRules = [
        ...sanitizeRuleLines(customRules),
        ...sanitizeRuleLines(inheritedRules),
    ];

    if (!normalizedRules.length) {
        normalizedRules.push('MATCH,分组选择');
    }

    return stringify({
        'mixed-port': 7890,
        'allow-lan': false,
        mode: 'rule',
        ...(dns ? { dns } : {}),
        proxies: allProxies,
        'proxy-groups': [
            {
                name: '分组选择',
                type: 'select',
                proxies: selectProxyNames,
            },
            {
                name: 'HYM',
                type: 'url-test',
                url: 'https://www.gstatic.com/generate_204',
                interval: 300,
                proxies: filteredProxies.map(item => item.name),
            },
        ],
        rules: normalizedRules.map(createSingleQuotedRule),
    });
};

export const convertSubscriptionSources = async ({
    sources,
    includePatterns = [],
    excludePatterns = [],
    customRules = [],
    fetchSource = defaultFetchSource,
}) => {
    const {
        sources: validSources,
        includePatterns: validIncludePatterns,
        excludePatterns: validExcludePatterns,
        customRules: validCustomRules,
    } = validateSubscriptionConfig({
        sources,
        includePatterns,
        excludePatterns,
        customRules,
    });
    const proxies = [];
    const errors = [];
    let successSourceCount = 0;
    let failedSourceCount = 0;
    let inheritedDns;
    let inheritedRules = [];
    let templateSelected = false;

    for (const source of validSources) {
        try {
            const rawText = await fetchSource(source);
            const text = `${rawText ?? ''}`.trim();
            const clashSubscription = parseClashSubscription(text);
            const parsedProxies = clashSubscription
                ? clashSubscription.proxies
                : parseProxyUriList(tryDecodeBase64Text(text) || text);

            if (!parsedProxies.length) {
                throw new Error('未解析到节点');
            }

            proxies.push(...parsedProxies);
            successSourceCount += 1;

            if (!templateSelected) {
                inheritedDns = clashSubscription?.dns;
                inheritedRules = rewriteInheritedRules(
                    clashSubscription?.rules,
                    clashSubscription?.proxyGroups,
                );
                templateSelected = true;
            }
        } catch (error) {
            failedSourceCount += 1;
            errors.push({
                source,
                message: error.message || '未知错误',
            });
        }
    }

    if (!proxies.length) {
        throw createHttpError(502, errors[0]?.message || '全部上游订阅均不可用');
    }

    const filteredResult = normalizeAndFilterProxies(
        proxies,
        validIncludePatterns,
        validExcludePatterns,
    );

    return {
        allProxies: filteredResult.allProxies,
        proxies: filteredResult.proxies,
        errors,
        summary: {
            successSourceCount,
            failedSourceCount,
            rawProxyCount: filteredResult.rawCount,
            dedupedProxyCount: filteredResult.dedupedCount,
            filteredProxyCount: filteredResult.filteredCount,
        },
        yaml: buildClashYaml(
            filteredResult.allProxies,
            filteredResult.proxies,
            validCustomRules,
            inheritedDns,
            inheritedRules,
        ),
    };
};

export const generateSubscriptionUrl = ({
    protocol,
    host,
    prefix = '',
    token,
}) => `${protocol}://${host}${prefix || ''}/subscription/clash?token=${encodeURIComponent(token)}`;
