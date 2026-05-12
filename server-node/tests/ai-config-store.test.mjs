import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    createAiConfigStore,
    DEFAULT_AI_CONFIG,
} from '../app/ai/config-store.js';

test('createAiConfigStore 在文件不存在时生成默认配置', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-config-'));
    const filePath = path.join(tempDir, 'ai-config.json');
    const store = createAiConfigStore({ filePath });

    const result = await store.read();

    assert.deepEqual(result, DEFAULT_AI_CONFIG);
});

test('readPublic 不暴露 API Key 明文', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-config-'));
    const filePath = path.join(tempDir, 'ai-config.json');
    const store = createAiConfigStore({ filePath });

    await store.save({
        apiKey: 'sk-test',
        apiBase: 'https://api.openai.com/v1/',
        apiType: 'completions',
        defaultModel: 'gpt-5',
        defaultReasoningEffort: '',
        summaryModel: 'gpt-5-mini',
    });
    const result = await store.readPublic();

    assert.equal(result.apiKey, undefined);
    assert.equal(result.hasApiKey, true);
    assert.equal(result.apiBase, 'https://api.openai.com/v1');
    assert.equal(result.apiType, 'completions');
    assert.equal(result.defaultReasoningEffort, '');
});

test('save 支持保留已有 API Key', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-config-'));
    const filePath = path.join(tempDir, 'ai-config.json');
    const store = createAiConfigStore({ filePath });

    await store.save({ apiKey: 'sk-old' });
    const saved = await store.save({
        keepApiKey: true,
        apiKey: '',
        defaultModel: 'gpt-4.1',
    });

    assert.equal(saved.apiKey, 'sk-old');
    assert.equal(saved.defaultModel, 'gpt-4.1');
});

test('saveCachedModels 缓存模型列表且不影响已有配置', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-config-'));
    const filePath = path.join(tempDir, 'ai-config.json');
    const store = createAiConfigStore({ filePath });

    await store.save({
        apiKey: 'sk-old',
        defaultModel: 'gpt-5',
        defaultReasoningEffort: 'high',
    });
    const saved = await store.saveCachedModels([
        { id: 'gpt-5-mini', contextWindow: 400000 },
        { id: 'gpt-5', contextWindow: 400000 },
        { id: 'gpt-5' },
        { id: '' },
    ]);
    const publicConfig = await store.readPublic();

    assert.equal(saved.apiKey, 'sk-old');
    assert.equal(saved.defaultReasoningEffort, 'high');
    assert.deepEqual(publicConfig.cachedModels, [
        { id: 'gpt-5', contextWindow: 400000 },
        { id: 'gpt-5-mini', contextWindow: 400000 },
    ]);
});

test('save 拒绝非法 API 地址与非法思考程度', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-config-'));
    const filePath = path.join(tempDir, 'ai-config.json');
    const store = createAiConfigStore({ filePath });

    await assert.rejects(() => store.save({ apiBase: 'not-a-url' }), /有效 URL/);
    await assert.rejects(() => store.save({ defaultReasoningEffort: 'extreme' }), /思考程度/);
    await assert.rejects(() => store.save({ apiType: 'legacy' }), /接口类型/);
});
