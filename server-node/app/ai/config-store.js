import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_AI_CONFIG = {
    apiBase: 'https://api.openai.com/v1',
    apiKey: '',
    apiType: 'responses',
    defaultModel: 'gpt-5',
    defaultReasoningEffort: 'medium',
    summaryModel: 'gpt-5-mini',
    cachedModels: [],
};

const REASONING_EFFORTS = new Set(['', 'low', 'medium', 'high']);
const API_TYPES = new Set(['responses', 'completions']);

const normalizeString = value => `${value ?? ''}`.trim();

const normalizeApiBase = value => {
    const apiBase = normalizeString(value) || DEFAULT_AI_CONFIG.apiBase;
    let url;

    try {
        url = new URL(apiBase);
    } catch {
        const error = new Error('API 地址不是有效 URL');
        error.status = 400;
        throw error;
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
        const error = new Error('API 地址只支持 HTTP 或 HTTPS');
        error.status = 400;
        throw error;
    }

    return url.toString().replace(/\/+$/, '');
};

const normalizeCachedModels = value => {
    if (!Array.isArray(value)) {
        return [];
    }

    const seen = new Set();
    return value
        .map(item => {
            const id = normalizeString(typeof item === 'string' ? item : item?.id);
            if (!id || seen.has(id)) {
                return null;
            }
            seen.add(id);
            const contextWindow = Number.isFinite(item?.contextWindow)
                ? item.contextWindow
                : null;
            return {
                id,
                contextWindow,
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.id.localeCompare(b.id));
};

export const normalizeAiConfig = (input = {}, previous = DEFAULT_AI_CONFIG) => {
    const defaultReasoningEffort = normalizeString(input.defaultReasoningEffort ?? previous.defaultReasoningEffort);
    const apiType = normalizeString(input.apiType ?? previous.apiType) || DEFAULT_AI_CONFIG.apiType;

    if (!REASONING_EFFORTS.has(defaultReasoningEffort)) {
        const error = new Error('思考程度只能为空、low、medium 或 high');
        error.status = 400;
        throw error;
    }

    if (!API_TYPES.has(apiType)) {
        const error = new Error('接口类型只能是 responses 或 completions');
        error.status = 400;
        throw error;
    }

    const nextApiKey = normalizeString(input.apiKey);
    const apiKey = nextApiKey || (input.keepApiKey ? previous.apiKey || '' : '');

    return {
        apiBase: normalizeApiBase(input.apiBase ?? previous.apiBase),
        apiKey,
        apiType,
        defaultModel: normalizeString(input.defaultModel ?? previous.defaultModel) || DEFAULT_AI_CONFIG.defaultModel,
        defaultReasoningEffort,
        summaryModel: normalizeString(input.summaryModel ?? previous.summaryModel) || DEFAULT_AI_CONFIG.summaryModel,
        cachedModels: normalizeCachedModels(input.cachedModels ?? previous.cachedModels),
    };
};

export const toPublicAiConfig = config => {
    const { apiKey, ...rest } = config;
    return {
        ...rest,
        hasApiKey: !!apiKey,
    };
};

export const createAiConfigStore = ({ filePath }) => {
    if (!filePath) {
        throw new Error('filePath is required');
    }

    const read = async () => {
        try {
            const raw = await fs.readFile(filePath, 'utf-8');
            return normalizeAiConfig(JSON.parse(raw), DEFAULT_AI_CONFIG);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }

            const initial = normalizeAiConfig(DEFAULT_AI_CONFIG, DEFAULT_AI_CONFIG);
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, JSON.stringify(initial, null, 4));
            return initial;
        }
    };

    const write = async config => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(config, null, 4));
        return config;
    };

    return {
        read,
        async readPublic() {
            return toPublicAiConfig(await read());
        },
        async save(input = {}) {
            const previous = await read();
            const next = normalizeAiConfig(input, previous);
            return write(next);
        },
        async saveCachedModels(models = []) {
            const previous = await read();
            const next = normalizeAiConfig({
                ...previous,
                cachedModels: models,
                keepApiKey: true,
            }, previous);
            return write(next);
        },
    };
};
