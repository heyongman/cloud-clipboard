import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
    encodeSseEvent,
    normalizeOpenAiSseEvent,
    parseSseStream,
} from '../app/ai/stream.js';

test('parseSseStream 解析事件和数据', async () => {
    const source = Readable.from([
        'event: response.output_text.delta\n',
        'data: {"delta":"你"}\n\n',
        'event: response.completed\n',
        'data: {"response":{"id":"resp_1","usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}}\n\n',
    ]);

    const events = [];
    for await (const event of parseSseStream(source)) {
        events.push(event);
    }

    assert.deepEqual(events, [
        { event: 'response.output_text.delta', data: '{"delta":"你"}' },
        { event: 'response.completed', data: '{"response":{"id":"resp_1","usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}}' },
    ]);
});

test('normalizeOpenAiSseEvent 规范化文本和完成事件', () => {
    const textEvents = normalizeOpenAiSseEvent({
        event: 'response.output_text.delta',
        data: '{"delta":"hello"}',
    });
    const doneEvents = normalizeOpenAiSseEvent({
        event: 'response.completed',
        data: '{"response":{"id":"resp_1","usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}}',
    });

    assert.deepEqual(textEvents, [{ event: 'text_delta', data: { delta: 'hello' } }]);
    assert.deepEqual(doneEvents, [
        { event: 'usage', data: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
        { event: 'complete', data: { responseId: 'resp_1' } },
    ]);
});

test('normalizeOpenAiSseEvent 规范化 chat completions 流式事件', () => {
    const textEvents = normalizeOpenAiSseEvent({
        event: 'message',
        data: '{"id":"chatcmpl_1","object":"chat.completion.chunk","choices":[{"delta":{"content":"hi"}}]}',
    });
    const doneEvents = normalizeOpenAiSseEvent({
        event: 'message',
        data: '{"id":"chatcmpl_1","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"input_tokens":3,"output_tokens":4,"total_tokens":7}}',
    });

    assert.deepEqual(textEvents, [{ event: 'text_delta', data: { delta: 'hi' } }]);
    assert.deepEqual(doneEvents, [
        { event: 'usage', data: { inputTokens: 3, outputTokens: 4, totalTokens: 7 } },
        { event: 'complete', data: { responseId: 'chatcmpl_1' } },
    ]);
});

test('normalizeOpenAiSseEvent 规范化图片生成结果', () => {
    const events = normalizeOpenAiSseEvent({
        event: 'response.output_item.done',
        data: '{"item":{"type":"image_generation_call","result":"abc"}}',
    });

    assert.deepEqual(events, [
        {
            event: 'image',
            data: {
                mimeType: 'image/png',
                dataUrl: 'data:image/png;base64,abc',
            },
        },
    ]);
});

test('normalizeOpenAiSseEvent 规范化联网搜索进度和关键词', () => {
    const progressEvents = normalizeOpenAiSseEvent({
        event: 'response.web_search_call.searching',
        data: '{"type":"response.web_search_call.searching","item_id":"ws_1","output_index":1}',
    });
    const doneEvents = normalizeOpenAiSseEvent({
        event: 'response.output_item.done',
        data: '{"item":{"id":"ws_1","type":"web_search_call","status":"completed","action":{"type":"search","query":"AI news","queries":["AI news","OpenAI news"]}},"output_index":1}',
    });

    assert.deepEqual(progressEvents, [{
        event: 'web_search',
        data: {
            id: 'ws_1',
            status: 'searching',
            query: '',
            queries: [],
            outputIndex: 1,
        },
    }]);
    assert.deepEqual(doneEvents, [{
        event: 'web_search',
        data: {
            id: 'ws_1',
            status: 'completed',
            query: 'AI news',
            queries: ['AI news', 'OpenAI news'],
            outputIndex: 1,
        },
    }]);
});

test('normalizeOpenAiSseEvent 规范化联网引用来源', () => {
    const events = normalizeOpenAiSseEvent({
        event: 'response.completed',
        data: '{"response":{"id":"resp_1","output":[{"content":[{"type":"output_text","text":"内容","annotations":[{"type":"url_citation","title":"Example","url":"https://example.com/news"}]}]}],"usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}}',
    });

    assert.deepEqual(events, [
        {
            event: 'web_source',
            data: {
                title: 'Example',
                url: 'https://example.com/news',
            },
        },
        { event: 'usage', data: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
        { event: 'complete', data: { responseId: 'resp_1' } },
    ]);
});

test('encodeSseEvent 输出 SSE 格式', () => {
    assert.equal(encodeSseEvent('text_delta', { delta: 'a' }), 'event: text_delta\ndata: {"delta":"a"}\n\n');
});
