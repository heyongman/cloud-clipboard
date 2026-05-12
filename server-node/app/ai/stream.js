import { normalizeUsage } from './openai-client.js';

export const encodeSseEvent = (event, data = {}) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export async function* parseSseStream(readable) {
    const decoder = new TextDecoder();
    let buffer = '';
    let event = 'message';
    let dataLines = [];
    const decodeChunk = chunk => typeof chunk === 'string'
        ? chunk
        : decoder.decode(chunk, { stream: true });

    const emit = function* () {
        if (!dataLines.length) return;
        const data = dataLines.join('\n');
        dataLines = [];
        const currentEvent = event;
        event = 'message';
        if (data === '[DONE]') return;
        yield { event: currentEvent, data };
    };

    for await (const chunk of readable) {
        buffer += decodeChunk(chunk);
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line) {
                yield* emit();
                continue;
            }
            if (line.startsWith('event:')) {
                event = line.slice(6).trim();
                continue;
            }
            if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trimStart());
            }
        }
    }

    buffer += decoder.decode();
    if (buffer) {
        for (const line of buffer.split(/\r?\n/)) {
            if (!line) {
                yield* emit();
            } else if (line.startsWith('event:')) {
                event = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trimStart());
            }
        }
    }
    yield* emit();
}

const parseJson = value => {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const extractImageEvents = body => {
    const events = [];
    const candidates = [
        body?.item,
        body?.output_item,
        body?.response,
        body,
    ].filter(Boolean);

    for (const candidate of candidates) {
        const result = candidate.result || candidate.image || candidate.image_base64;
        if (candidate.type === 'image_generation_call' && result) {
            events.push({
                event: 'image',
                data: {
                    mimeType: 'image/png',
                    dataUrl: result.startsWith('data:') ? result : `data:image/png;base64,${result}`,
                },
            });
        }

        for (const item of candidate.output || []) {
            if (item.type === 'image_generation_call' && item.result) {
                events.push({
                    event: 'image',
                    data: {
                        mimeType: 'image/png',
                        dataUrl: item.result.startsWith('data:') ? item.result : `data:image/png;base64,${item.result}`,
                    },
                });
            }
        }
    }

    return events;
};

export const normalizeOpenAiSseEvent = ({ event, data }) => {
    const body = parseJson(data);
    if (!body) return [];

    if (body.object === 'chat.completion.chunk') {
        const events = [];
        const delta = (body.choices || [])
            .map(choice => choice.delta?.content || '')
            .join('');
        if (delta) {
            events.push({ event: 'text_delta', data: { delta } });
        }
        if ((body.choices || []).some(choice => choice.finish_reason)) {
            events.push({ event: 'usage', data: normalizeUsage(body.usage) });
            events.push({ event: 'complete', data: { responseId: body.id || '' } });
        }
        return events;
    }

    if (event === 'response.output_text.delta' || body.type === 'response.output_text.delta') {
        return [{ event: 'text_delta', data: { delta: body.delta || '' } }];
    }

    if (event === 'response.completed' || body.type === 'response.completed') {
        const response = body.response || body;
        return [
            ...extractImageEvents(response),
            { event: 'usage', data: normalizeUsage(response.usage) },
            { event: 'complete', data: { responseId: response.id || '' } },
        ];
    }

    if (event === 'response.failed' || event === 'error' || body.type === 'error') {
        return [{
            event: 'error',
            data: {
                message: body.error?.message || body.message || 'AI 请求失败',
            },
        }];
    }

    return extractImageEvents(body);
};
