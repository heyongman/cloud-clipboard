export const CHAT_STORAGE_KEY = 'cloudClipboard.aiChat.v1';

export const DEFAULT_ROLES = [
    {
        id: 'audit-us-stocks',
        name: '美股审计专家',
        prompt: '你是美股审计专家，擅长分析美国上市公司财报、10-K/10-Q、审计风险、会计政策、内控缺陷和证据链。回答必须区分事实、推断与待核实事项。',
    },
    {
        id: 'programming',
        name: '编程专家',
        prompt: '你是编程专家，擅长软件设计、代码审查、调试和工程落地。回答应直接、可执行，并说明关键取舍。',
    },
    {
        id: 'doctor',
        name: '医生',
        prompt: '你提供通用医学信息、风险分层和就医建议，但不能替代医生诊断。遇到急症、危险信号或用药风险时应明确建议线下就医。',
    },
    {
        id: 'general',
        name: '通用助手',
        prompt: '你是通用 AI 助手，回答应清晰、准确、结构化。',
    },
];

export const createChatId = (now = new Date(), random = Math.random) => (
    `chat_${now.getTime().toString(36)}_${Math.floor(random() * 0xffffff).toString(36)}`
);

export const deriveConversationTitle = text => {
    const value = `${text ?? ''}`.replace(/\s+/g, ' ').trim();
    if (!value) return '新对话';
    return value.length > 24 ? `${value.slice(0, 24)}...` : value;
};

export const createDefaultConversation = ({
    role = DEFAULT_ROLES[0],
    defaults = {},
    now = new Date(),
    random = Math.random,
} = {}) => ({
    id: createChatId(now, random),
    title: '新对话',
    roleId: role.id,
    roleName: role.name,
    rolePrompt: role.prompt,
    model: defaults.defaultModel || 'gpt-5',
    apiType: defaults.apiType || 'responses',
    reasoningEffort: defaults.defaultReasoningEffort ?? '',
    webSearch: false,
    imageGeneration: false,
    summary: '',
    usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
    },
    messages: [],
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
});

export const createDefaultChatState = ({
    defaults = {},
    now = new Date(),
    random = Math.random,
    initialConversation = true,
} = {}) => {
    if (!initialConversation) {
        return {
            version: 1,
            activeId: '',
            conversations: [],
        };
    }

    const activeConversation = createDefaultConversation({
        role: DEFAULT_ROLES[0],
        defaults,
        now,
        random,
    });

    return {
        version: 1,
        activeId: activeConversation.id,
        conversations: [activeConversation],
    };
};

const normalizeState = value => {
    if (!value || !Array.isArray(value.conversations)) {
        return null;
    }

    const conversations = value.conversations.filter(item => item && item.id);

    return {
        version: 1,
        activeId: conversations.length && conversations.some(item => item.id === value.activeId)
            ? value.activeId
            : conversations[0]?.id || '',
        conversations,
    };
};

export const loadChatState = (storage, options = {}) => {
    try {
        const raw = storage?.getItem(CHAT_STORAGE_KEY);
        const parsed = raw ? normalizeState(JSON.parse(raw)) : null;
        return parsed || createDefaultChatState(options);
    } catch {
        return createDefaultChatState(options);
    }
};

export const saveChatState = (storage, state) => {
    const normalized = normalizeState(state);
    if (!normalized) {
        throw new Error('聊天状态无效');
    }
    storage?.setItem(CHAT_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
};

export const getActiveConversation = state => (
    state.conversations.find(item => item.id === state.activeId) || state.conversations[0] || null
);
