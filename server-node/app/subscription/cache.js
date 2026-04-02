export const createSubscriptionCache = ({ ttlMs = 30_000 } = {}) => {
    const cache = new Map();

    return {
        get(key) {
            const entry = cache.get(key);
            if (!entry) {
                return null;
            }

            if (entry.expireAt <= Date.now()) {
                cache.delete(key);
                return null;
            }

            return entry.value;
        },
        set(key, value) {
            cache.set(key, {
                value,
                expireAt: Date.now() + ttlMs,
            });
            return value;
        },
        clear() {
            cache.clear();
        },
    };
};
