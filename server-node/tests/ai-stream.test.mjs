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

test('encodeSseEvent 输出 SSE 格式', () => {
    assert.equal(encodeSseEvent('text_delta', { delta: 'a' }), 'event: text_delta\ndata: {"delta":"a"}\n\n');
});
