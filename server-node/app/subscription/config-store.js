import fs from 'node:fs/promises';
import path from 'node:path';

import {
    createDefaultSubscriptionConfig,
    validateSubscriptionConfig,
} from './service.js';

const normalizePersistedConfig = value => {
    const defaults = createDefaultSubscriptionConfig();

    return {
        ...defaults,
        ...(value && typeof value === 'object' ? value : {}),
        sources: Array.isArray(value?.sources) ? value.sources : defaults.sources,
        includePatterns: Array.isArray(value?.includePatterns) ? value.includePatterns : defaults.includePatterns,
        excludePatterns: Array.isArray(value?.excludePatterns) ? value.excludePatterns : defaults.excludePatterns,
        customRules: Array.isArray(value?.customRules) ? value.customRules : defaults.customRules,
        token: value?.token ? `${value.token}` : defaults.token,
        updatedAt: Number.isFinite(value?.updatedAt) ? value.updatedAt : defaults.updatedAt,
    };
};

export const createSubscriptionConfigStore = ({ filePath }) => {
    let cache = null;

    const writeConfig = async nextConfig => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(nextConfig, null, 4));
        cache = nextConfig;
        return nextConfig;
    };

    const ensureConfig = async () => {
        if (cache) {
            return cache;
        }

        try {
            const raw = await fs.readFile(filePath, 'utf8');
            cache = normalizePersistedConfig(JSON.parse(raw));
            return cache;
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }

        return writeConfig(createDefaultSubscriptionConfig());
    };

    return {
        async read() {
            return ensureConfig();
        },
        async save(input) {
            const current = await ensureConfig();
            const validated = validateSubscriptionConfig(input || {});

            return writeConfig({
                ...current,
                sources: validated.sources,
                includePatterns: validated.includePatterns,
                excludePatterns: validated.excludePatterns,
                customRules: validated.customRules,
                updatedAt: Date.now(),
            });
        },
        async resetToken() {
            const current = await ensureConfig();

            return writeConfig({
                ...current,
                ...createDefaultSubscriptionConfig(),
                sources: current.sources,
                includePatterns: current.includePatterns,
                excludePatterns: current.excludePatterns,
                customRules: current.customRules,
                updatedAt: Date.now(),
            });
        },
    };
};
