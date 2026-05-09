import { getModelContextWindow } from './model-context.js';

const IMAGE_TOKEN_ESTIMATE = 1200;

const trimSlash = value => `${value || ''}`.replace(/\/+$/, '');

export const buildOpenAiUrl = (apiBase, pathname) => {
    const base = trimSlash(apiBase || 'https://api.openai.com/v1');
    const path = `${pathname || ''}`.replace(/^\/+/, '');
    return `${base}/${path}`;
};

const requireApiKey = config => {
    if (!config?.apiKey) {
        const error = new Error('请先在 AI 设置中填写 API Key');
        error.status = 400;
        throw error;
    }
};

export const createOpenAiHeaders = config => {
    requireApiKey(config);
    return {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
    };
};

const normalizeContentItem = item => {
    if (item?.type === 'image') {
        return {
            type: 'input_image',
            image_url: item.dataUrl || item.imageUrl || '',
        };
    }

    return {
        type: 'input_text',
        text: `${item?.text ?? ''}`,
    };
};

const normalizeMessage = message => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: Array.isArray(message.content)
        ? message.content.map(normalizeContentItem).filter(item => item.text || item.image_url)
        : [{ type: 'input_text', text: `${message.content ?? ''}` }],
});

export const buildResponsesPayload = ({
    model,
    reasoningEffort,
    rolePrompt,
    messages = [],
    tools = {},
    stream = true,
}) => {
    const payload = {
        model,
        stream,
        input: messages.map(normalizeMessage),
    };

    if (rolePrompt) {
        payload.instructions = rolePrompt;
    }

    if (reasoningEffort) {
        payload.reasoning = { effort: reasoningEffort };
    }

    const enabledTools = [];
    if (tools.webSearch) {
        enabledTools.push({ type: 'web_search' });
    }
    if (tools.imageGeneration) {
        enabledTools.push({ type: 'image_generation' });
    }
    if (enabledTools.length) {
        payload.tools = enabledTools;
    }

    return payload;
};

const parseOpenAiJsonResponse = async response => {
    const text = await response.text();
    let body = {};
    if (text) {
        try {
            body = JSON.parse(text);
        } catch {
            body = { message: text };
        }
    }

    if (!response.ok) {
        const error = new Error(body?.error?.message || body?.message || `OpenAI API 请求失败：${response.status}`);
        error.status = response.status;
        error.body = body;
        throw error;
    }

    return body;
};

export const listModels = async config => {
    const response = await fetch(buildOpenAiUrl(config.apiBase, '/models'), {
        headers: createOpenAiHeaders(config),
    });
    const body = await parseOpenAiJsonResponse(response);
    return (body.data || [])
        .map(item => ({
            id: item.id,
            contextWindow: getModelContextWindow(item.id),
        }))
        .filter(item => item.id)
        .sort((a, b) => a.id.localeCompare(b.id));
};

export const createStreamingResponse = async (config, payload, options = {}) => {
    const response = await fetch(buildOpenAiUrl(config.apiBase, '/responses'), {
        method: 'POST',
        headers: createOpenAiHeaders(config),
        body: JSON.stringify(payload),
        signal: options.signal,
    });

    if (!response.ok) {
        await parseOpenAiJsonResponse(response);
    }

    return response;
};

const collectTextFromResponse = body => {
    if (typeof body.output_text === 'string') {
        return body.output_text;
    }

    const parts = [];
    for (const item of body.output || []) {
        for (const content of item.content || []) {
            if (content.type === 'output_text' && content.text) {
                parts.push(content.text);
            }
        }
    }
    return parts.join('');
};

export const createSummary = async (config, payload) => {
    const response = await fetch(buildOpenAiUrl(config.apiBase, '/responses'), {
        method: 'POST',
        headers: createOpenAiHeaders(config),
        body: JSON.stringify(payload),
    });
    const body = await parseOpenAiJsonResponse(response);
    return {
        summary: collectTextFromResponse(body).trim(),
        usage: normalizeUsage(body.usage),
    };
};

export const normalizeUsage = usage => ({
    inputTokens: usage?.input_tokens || 0,
    outputTokens: usage?.output_tokens || 0,
    totalTokens: usage?.total_tokens || 0,
});

const estimateTextTokens = text => {
    const value = `${text ?? ''}`;
    const cjkCount = (value.match(/[\u3400-\u9fff\u3040-\u30ff\uff00-\uffef]/g) || []).length;
    const asciiText = value.replace(/[\u3400-\u9fff\u3040-\u30ff\uff00-\uffef]/g, '');
    return cjkCount + Math.ceil(asciiText.length / 4);
};

export const estimateMessagesTokens = messages => {
    let total = 0;
    for (const message of messages || []) {
        total += 4;
        const content = Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }];
        for (const item of content) {
            if (item.type === 'image') {
                total += IMAGE_TOKEN_ESTIMATE;
            } else {
                total += estimateTextTokens(item.text);
            }
        }
    }
    return total;
};

export const buildSummaryPayload = ({ model, rolePrompt, messages = [] }) => buildResponsesPayload({
    model,
    stream: false,
    rolePrompt: [
        rolePrompt,
        '请用简洁中文总结当前对话，保留用户目标、关键结论、待办事项和重要约束。不要添加对话中没有的信息。',
    ].filter(Boolean).join('\n\n'),
    messages,
    tools: {},
});
