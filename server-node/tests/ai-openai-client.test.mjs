import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildCompletionsPayload,
    buildResponsesPayload,
    buildSummaryPayload,
    estimateMessagesTokens,
    isPreviousResponseMissingError,
} from '../app/ai/openai-client.js';
import {
    getKnownModelContexts,
    getModelContextWindow,
} from '../app/ai/model-context.js';

test('buildResponsesPayload 转换文本、图片、工具和 reasoning', () => {
    const payload = buildResponsesPayload({
        model: 'gpt-5',
        reasoningEffort: 'medium',
        rolePrompt: 'You are helpful.',
        tools: {
            webSearch: true,
            imageGeneration: true,
        },
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: '看图' },
                    { type: 'image', dataUrl: 'data:image/png;base64,abc' },
                ],
            },
        ],
    });

    assert.equal(payload.model, 'gpt-5');
    assert.equal(payload.stream, true);
    assert.equal(payload.instructions, 'You are helpful.');
    assert.deepEqual(payload.reasoning, { effort: 'medium' });
    assert.deepEqual(payload.tools, [
        { type: 'web_search' },
        { type: 'image_generation' },
    ]);
    assert.deepEqual(payload.input[0].content, [
        { type: 'input_text', text: '看图' },
        { type: 'input_image', image_url: 'data:image/png;base64,abc' },
    ]);
});

test('buildResponsesPayload 省略空可选字段', () => {
    const payload = buildResponsesPayload({
        model: 'gpt-5-mini',
        messages: [],
        tools: {},
        stream: false,
    });

    assert.equal(payload.stream, false);
    assert.equal(payload.instructions, undefined);
    assert.equal(payload.reasoning, undefined);
    assert.equal(payload.tools, undefined);
});

test('buildResponsesPayload 支持 previous_response_id', () => {
    const payload = buildResponsesPayload({
        model: 'gpt-5',
        previousResponseId: 'resp_123',
        messages: [{ role: 'user', content: '继续' }],
    });

    assert.equal(payload.previous_response_id, 'resp_123');
    assert.equal(payload.input.length, 1);
});

test('buildCompletionsPayload 转换系统提示、文本、图片和 reasoning_effort', () => {
    const payload = buildCompletionsPayload({
        model: 'gpt-4o',
        reasoningEffort: 'low',
        rolePrompt: 'You are helpful.',
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: '看图' },
                    { type: 'image', dataUrl: 'data:image/png;base64,abc' },
                ],
            },
        ],
    });

    assert.equal(payload.model, 'gpt-4o');
    assert.equal(payload.stream, true);
    assert.equal(payload.reasoning_effort, 'low');
    assert.deepEqual(payload.messages[0], { role: 'system', content: 'You are helpful.' });
    assert.deepEqual(payload.messages[1].content, [
        { type: 'text', text: '看图' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
    ]);
});

test('isPreviousResponseMissingError 只识别上游找不到 previous response 的错误', () => {
    const missing = new Error('No response found for previous_response_id resp_missing');
    missing.status = 404;
    missing.body = {
        error: {
            message: 'No response found for previous_response_id resp_missing',
        },
    };

    const other = new Error('model not found');
    other.status = 404;

    assert.equal(isPreviousResponseMissingError(missing), true);
    assert.equal(isPreviousResponseMissingError(other), false);
});

test('buildSummaryPayload 使用非流式请求', () => {
    const payload = buildSummaryPayload({
        model: 'gpt-5-mini',
        rolePrompt: 'role',
        messages: [{ role: 'user', content: 'hello' }],
    });

    assert.equal(payload.stream, false);
    assert.match(payload.instructions, /简洁中文总结/);
});

test('estimateMessagesTokens 对文本和图片给出估算', () => {
    const tokens = estimateMessagesTokens([
        {
            role: 'user',
            content: [
                { type: 'text', text: 'hello world' },
                { type: 'text', text: '你好' },
                { type: 'image', dataUrl: 'data:image/png;base64,abc' },
            ],
        },
    ]);

    assert.ok(tokens >= 1200);
});

test('getModelContextWindow 支持已知模型和版本后缀', () => {
    assert.equal(getModelContextWindow('gpt-4o'), 128000);
    assert.equal(getModelContextWindow('gpt-4o-2024-08-06'), 128000);
    assert.equal(getModelContextWindow('unknown-model'), null);
    assert.ok(getKnownModelContexts()['gpt-5']);
});
