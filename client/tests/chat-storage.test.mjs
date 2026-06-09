import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHAT_STORAGE_KEY,
  DEFAULT_ROLES,
  createDefaultConversation,
  collectChatImageAssets,
  createSerializableChatState,
  deriveConversationTitle,
  loadChatState,
  saveChatState,
} from '../src/utils/chat-storage.mjs';
import {
  formatTokenUsage,
  sumTokenUsage,
} from '../src/utils/chat-tokens.mjs';

const createMemoryStorage = initial => {
  const values = new Map(Object.entries(initial || {}));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
};

test('createDefaultConversation 使用角色和默认模型', () => {
  const now = new Date('2026-05-08T00:00:00Z');
  const conversation = createDefaultConversation({
    role: DEFAULT_ROLES[1],
    defaults: {
      defaultModel: 'gpt-4.1',
      apiType: 'completions',
      defaultReasoningEffort: '',
    },
    now,
    random: () => 0,
  });

  assert.equal(conversation.roleId, 'programming');
  assert.equal(conversation.model, 'gpt-4.1');
  assert.equal(conversation.apiType, 'completions');
  assert.equal(conversation.reasoningEffort, '');
  assert.equal(conversation.createdAt, now.getTime());
});

test('deriveConversationTitle 从首条消息生成短标题', () => {
  assert.equal(deriveConversationTitle(''), '新对话');
  assert.equal(deriveConversationTitle('  hello   world  '), 'hello world');
  assert.equal(deriveConversationTitle('abcdefghijklmnopqrstuvwxyz'), 'abcdefghijklmnopqrstuvwx...');
});

test('loadChatState 在存储损坏时返回默认状态', () => {
  const storage = createMemoryStorage({
    [CHAT_STORAGE_KEY]: '{bad json',
  });
  const state = loadChatState(storage, {
    random: () => 0,
    now: new Date('2026-05-08T00:00:00Z'),
  });

  assert.equal(state.conversations.length, 1);
  assert.equal(state.activeId, state.conversations[0].id);
});

test('loadChatState 支持不自动创建默认对话', () => {
  const storage = createMemoryStorage();
  const state = loadChatState(storage, {
    initialConversation: false,
  });

  assert.equal(state.conversations.length, 0);
  assert.equal(state.activeId, '');
});

test('saveChatState 保存可恢复状态', () => {
  const storage = createMemoryStorage();
  const state = loadChatState(storage, {
    random: () => 0,
    now: new Date('2026-05-08T00:00:00Z'),
  });

  saveChatState(storage, state);
  const restored = loadChatState(storage);

  assert.deepEqual(restored, state);
});

test('saveChatState 将图片内容从 localStorage 状态中剥离', () => {
  const storage = createMemoryStorage();
  const state = loadChatState(storage, {
    random: () => 0,
    now: new Date('2026-05-08T00:00:00Z'),
  });
  state.conversations[0].messages.push(
    {
      id: 'msg_user',
      role: 'user',
      text: '看图',
      attachments: [
        {
          id: 'att_image',
          kind: 'image',
          name: 'image.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,abc',
          sentToAi: true,
        },
      ],
    },
    {
      id: 'msg_assistant',
      role: 'assistant',
      text: '图片里有文字。',
      images: [
        {
          id: 'img_generated',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,generated',
        },
      ],
      completed: true,
      responseId: 'resp_123',
    },
  );

  saveChatState(storage, state);
  const restored = loadChatState(storage);

  assert.equal(restored.conversations[0].messages[0].attachments[0].dataUrl, undefined);
  assert.equal(restored.conversations[0].messages[0].attachments[0].hasData, true);
  assert.match(restored.conversations[0].messages[0].attachments[0].assetId, /^attachment:/);
  assert.equal(restored.conversations[0].messages[0].attachments[0].sentToAi, true);
  assert.equal(restored.conversations[0].messages[1].images[0].dataUrl, undefined);
  assert.equal(restored.conversations[0].messages[1].images[0].hasData, true);
  assert.match(restored.conversations[0].messages[1].images[0].assetId, /^generated:/);
  assert.equal(restored.conversations[0].messages[1].responseId, 'resp_123');

  const raw = storage.getItem(CHAT_STORAGE_KEY);
  assert.equal(raw.includes('data:image/png;base64'), false);
});

test('collectChatImageAssets 收集用户图片和生成图片用于 IndexedDB', () => {
  const state = loadChatState(createMemoryStorage(), {
    random: () => 0,
    now: new Date('2026-05-08T00:00:00Z'),
  });
  state.conversations[0].messages.push(
    {
      id: 'msg_user',
      role: 'user',
      text: '看图',
      attachments: [
        {
          id: 'att_image',
          kind: 'image',
          name: 'image.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,abc',
          sentToAi: true,
        },
      ],
    },
    {
      id: 'msg_assistant',
      role: 'assistant',
      text: '完成。',
      images: [
        {
          id: 'img_generated',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,generated',
        },
      ],
    },
  );

  const assets = collectChatImageAssets(state);
  const serializable = createSerializableChatState(state);

  assert.equal(assets.length, 2);
  assert.deepEqual(assets.map(item => item.dataUrl), [
    'data:image/png;base64,abc',
    'data:image/png;base64,generated',
  ]);
  assert.equal(JSON.stringify(serializable).includes('data:image/png;base64'), false);
});

test('token 展示累计当前对话所有 input 和 output', () => {
  const usage = sumTokenUsage([
    { role: 'user', text: 'hello' },
    { role: 'assistant', usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 } },
    { role: 'assistant', usage: { inputTokens: 210, outputTokens: 90, totalTokens: 300 } },
  ]);

  assert.deepEqual(usage, { inputTokens: 310, outputTokens: 130, totalTokens: 440 });
  assert.equal(formatTokenUsage(usage), '440 tokens');
});

test('token 统计兼容只有会话级 usage 的旧数据', () => {
  const usage = sumTokenUsage([], { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 });

  assert.deepEqual(usage, { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 });
  assert.equal(formatTokenUsage(usage), '1,500 tokens');
});
