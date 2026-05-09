const normalizeTokenCount = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

export const sumTokenUsage = (messages = [], fallbackUsage = {}) => {
    const total = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let hasMessageUsage = false;

    for (const message of messages || []) {
        if (!message?.usage) continue;
        hasMessageUsage = true;
        total.inputTokens += normalizeTokenCount(message.usage.inputTokens);
        total.outputTokens += normalizeTokenCount(message.usage.outputTokens);
        total.totalTokens += normalizeTokenCount(message.usage.totalTokens);
    }

    if (!hasMessageUsage && fallbackUsage) {
        total.inputTokens = normalizeTokenCount(fallbackUsage.inputTokens);
        total.outputTokens = normalizeTokenCount(fallbackUsage.outputTokens);
        total.totalTokens = normalizeTokenCount(fallbackUsage.totalTokens);
    }

    if (!total.totalTokens) {
        total.totalTokens = total.inputTokens + total.outputTokens;
    }

    return total;
};

export const formatTokenUsage = (usage = {}) => {
    const input = normalizeTokenCount(usage.inputTokens);
    const output = normalizeTokenCount(usage.outputTokens);
    const total = normalizeTokenCount(usage.totalTokens) || input + output;
    return `输入 ${input.toLocaleString()} / 输出 ${output.toLocaleString()} / 合计 ${total.toLocaleString()}`;
};
