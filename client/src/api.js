// HTTP API 模块
export default {
    data() {
        return {
            // 保留原有的认证和房间相关状态
            authCode: localStorage.getItem('auth') || '',
            authCodeDialog: false,
            room: this.$router.currentRoute.query.room || '',
            roomInput: '',
            roomDialog: false,

            // HTTP 相关状态
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
        // 获取消息列表（支持分页）
        async fetchMessages(beforeId = null) {
            if (this.loading) return;
            this.loading = true;
            try {
                const params = { room: this.room, limit: 10 };
                if (beforeId) params.beforeId = beforeId;
                const response = await this.$http.get('messages', { params });
                const { items, hasMore } = response.data.result;

                if (beforeId) {
                    // 加载更多（追加到末尾）
                    this.$root.received.push(...items);
                } else {
                    // 首次加载（替换）
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

        // 连接（初始化）
        async connect() {
            this.connecting = true;
            this.$toast('正在加载数据……', {
                showClose: false,
                dismissable: false,
                timeout: 0,
            });

            // 硬编码默认配置
            this.$root.config = {
                version: 'local',
                text: { limit: 100000 },
                file: { limit: 10737418240, chunk: 2097152, expire: 86400 }
            };

            try {
                if (this.authCode) {
                    localStorage.setItem('auth', this.authCode);
                }

                // 获取消息列表
                this.hasMore = true;
                await this.fetchMessages();

                this.connected = true;
                this.connecting = false;
                this.$toast('加载完成');
            } catch (error) {
                this.connecting = false;
                this.connected = false;
                if (error.response && error.response.status === 403) {
                    // 认证失败
                    this.authCode = '';
                    localStorage.removeItem('auth');
                    this.authCodeDialog = true;
                    this.$toast.error('认证失败，请重新输入密码');
                } else {
                    this.$toast.error('加载失败，请点击刷新按钮重试');
                }
            }
        },

        // 断开连接
        disconnect() {
            this.connected = false;
            this.$root.received = [];
            this.$root.device = [];
        },

        // 手动刷新
        async refresh() {
            if (this.loading) return;
            this.$toast('正在刷新……', { timeout: 1000 });
            try {
                this.hasMore = true;
                await this.fetchMessages();
                this.$toast('刷新完成');
            } catch (error) {
                this.$toast.error('刷新失败');
            }
        },

        // 加载更多（触底加载）
        async loadMore() {
            if (!this.hasMore || this.loading) return;
            const lastId = this.$root.received[this.$root.received.length - 1]?.id;
            if (lastId) {
                await this.fetchMessages(lastId);
            }
        },
    },
    mounted() {
        this.connect();
    },
    beforeDestroy() {
        this.disconnect();
    },
}
