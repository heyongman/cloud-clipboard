const MODEL_CONTEXTS = {
    'gpt-5': 400000,
    'gpt-5-mini': 400000,
    'gpt-5-nano': 400000,
    'gpt-4.1': 1000000,
    'gpt-4.1-mini': 1000000,
    'gpt-4.1-nano': 1000000,
    'gpt-4o': 128000,
    'gpt-4o-mini': 128000,
    'o3': 200000,
    'o3-mini': 200000,
    'o4-mini': 200000,
};

export const getKnownModelContexts = () => ({ ...MODEL_CONTEXTS });

export const getModelContextWindow = modelId => {
    const normalized = `${modelId ?? ''}`.trim();
    if (!normalized) return null;
    if (MODEL_CONTEXTS[normalized]) return MODEL_CONTEXTS[normalized];

    const family = Object.keys(MODEL_CONTEXTS)
        .filter(key => normalized === key || normalized.startsWith(`${key}-`))
        .sort((a, b) => b.length - a.length)[0];

    return family ? MODEL_CONTEXTS[family] : null;
};
