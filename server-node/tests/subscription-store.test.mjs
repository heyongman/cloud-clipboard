import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createSubscriptionConfigStore } from '../app/subscription/config-store.js';

test('createSubscriptionConfigStore 在文件不存在时生成默认配置', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subscription-store-'));
    const filePath = path.join(tempDir, 'subscription.json');
    const store = createSubscriptionConfigStore({ filePath });

    const result = await store.read();

    assert.deepEqual(result.sources, []);
    assert.deepEqual(result.includePatterns, []);
    assert.deepEqual(result.excludePatterns, []);
    assert.deepEqual(result.customRules, []);
    assert.ok(result.token);
    assert.ok(result.updatedAt);
});

test('createSubscriptionConfigStore 保存配置时保留原 token', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subscription-store-'));
    const filePath = path.join(tempDir, 'subscription.json');
    const store = createSubscriptionConfigStore({ filePath });
    const initial = await store.read();

    const saved = await store.save({
        sources: ['https://a.example/sub'],
        includePatterns: ['HK'],
        excludePatterns: ['实验'],
        customRules: ['DOMAIN-SUFFIX,example.com,HYM'],
    });

    assert.equal(saved.token, initial.token);
    assert.deepEqual(saved.sources, ['https://a.example/sub']);
    assert.deepEqual(saved.includePatterns, ['HK']);
    assert.deepEqual(saved.excludePatterns, ['实验']);
    assert.deepEqual(saved.customRules, ['DOMAIN-SUFFIX,example.com,HYM']);
});

test('createSubscriptionConfigStore resetToken 仅重置 token', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subscription-store-'));
    const filePath = path.join(tempDir, 'subscription.json');
    const store = createSubscriptionConfigStore({ filePath });
    const saved = await store.save({
        sources: ['https://a.example/sub'],
        includePatterns: ['HK'],
        excludePatterns: ['实验'],
        customRules: ['DOMAIN-SUFFIX,example.com,HYM'],
    });

    const reset = await store.resetToken();

    assert.notEqual(reset.token, saved.token);
    assert.deepEqual(reset.sources, saved.sources);
    assert.deepEqual(reset.includePatterns, saved.includePatterns);
    assert.deepEqual(reset.excludePatterns, saved.excludePatterns);
    assert.deepEqual(reset.customRules, saved.customRules);
});
