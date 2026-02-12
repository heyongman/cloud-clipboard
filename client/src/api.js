const AUTH_STORAGE_KEY = 'auth';
const MESSAGE_PAGE_SIZE = 10;

const createDefaultConfig = () => ({
    version: 'local',
    text: { limit: 100000 },
    file: { limit: 10737418240, chunk: 2097152 },
});

export default {
    data() {
        return {
            authCode: localStorage.getItem(AUTH_STORAGE_KEY) || '',
            authCodeDialog: false,
            room: this.$router.currentRoute.query.room || '',
            roomInput: '',
            roomDialog: false,
            loading: false,
            hasMore: true,
            connected: false,
            connecting: false,
        };
    },
    watch: {
        room() {
            this.disconnect();
            this.connect();
        },
    },
    methods: {
        persistAuthCode() {
            if (!this.authCode) return;
            if (localStorage.getItem(AUTH_STORAGE_KEY) === this.authCode) return;
            localStorage.setItem(AUTH_STORAGE_KEY, this.authCode);
        },

        async fetchMessages(beforeId = null) {
            if (this.loading) return;

            this.loading = true;
            try {
                const { data: { result } } = await this.$http.get('messages', {
                    params: {
                        room: this.room,
                        limit: MESSAGE_PAGE_SIZE,
                        ...(beforeId ? { beforeId } : {}),
                    },
                });
                const { items = [], hasMore = false } = result || {};

                if (beforeId) {
                    this.$root.received.push(...items);
                } else {
                    this.$root.received = items;
                }
                this.hasMore = hasMore;
            } catch (error) {
                console.error('Failed to fetch messages:', error);
                throw error;
            } finally {
                this.loading = false;
            }
        },

        handleAuthError() {
            this.authCode = '';
            localStorage.removeItem(AUTH_STORAGE_KEY);
            this.authCodeDialog = true;
            this.$toast.error('认证失败，请输入密码');
        },

        async connect() {
            if (this.connecting) return;
            if (!this.authCode) {
                this.authCodeDialog = true;
                return;
            }

            this.connecting = true;
            this.$toast('正在加载数据……', {
                showClose: false,
                dismissable: false,
                timeout: 0,
            });

            this.hasMore = true;
            try {
                await this.fetchMessages();
                this.connected = true;
                this.persistAuthCode();
                this.$toast('加载完成');
            } catch (error) {
                this.connected = false;
                if (error?.response?.status === 403) {
                    this.handleAuthError();
                } else {
                    this.$toast.error('加载失败，请点击刷新按钮重试');
                }
            } finally {
                this.connecting = false;
            }
        },

        disconnect() {
            this.connected = false;
            this.$root.received = [];
            this.$root.device = [];
        },

        async refresh() {
            if (this.loading) return;

            this.hasMore = true;
            try {
                await this.fetchMessages();
            } catch (error) {
                this.$toast.error('刷新失败');
            }
        },

        async loadMore() {
            if (!this.hasMore || this.loading || !this.$root.received.length) return; 

            const lastId = this.$root.received[this.$root.received.length - 1]?.id;
            if (lastId) {
                await this.fetchMessages(lastId);
            }
        },
    },
    mounted() {
        this.$root.config = createDefaultConfig();
        this.connect();
    },
    beforeDestroy() {
        this.disconnect();
    },
};
