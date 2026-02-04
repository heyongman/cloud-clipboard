// HTTP API 模块（替代原 WebSocket 实现）
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
            pollTimer: null,
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
        // 获取服务配置
        async fetchConfig() {
            try {
                const response = await this.$http.get('config');
                this.$root.config = response.data.result;
                console.log(
                    `%c Cloud Clipboard ${response.data.result.version} by TransparentLC %c https://github.com/TransparentLC/cloud-clipboard `,
                    'color:#fff;background-color:#1e88e5',
                    'color:#fff;background-color:#64b5f6'
                );
            } catch (error) {
                console.error('Failed to fetch config:', error);
                throw error;
            }
        },

        // 获取消息列表（支持分页）
        async fetchMessages(beforeId = null) {
            if (this.loading) return;
            this.loading = true;
            try {
                const params = { room: this.room, limit: 20 };
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

        // 轮询拉取新消息
        async pollNewMessages() {
            if (!this.$root.received.length || this.loading) return;
            try {
                const latestId = this.$root.received[0].id;
                const response = await this.$http.get('messages', {
                    params: { room: this.room, afterId: latestId, limit: 50 }
                });
                const { items } = response.data.result;
                if (items.length) {
                    // 新消息插入到开头
                    this.$root.received.unshift(...items);
                }
            } catch (error) {
                console.error('Failed to poll new messages:', error);
            }
        },

        // 启动轮询
        startPolling(interval = 5000) {
            this.stopPolling();
            this.pollTimer = setInterval(() => this.pollNewMessages(), interval);
        },

        // 停止轮询
        stopPolling() {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = null;
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

            try {
                // 检查是否需要认证
                const serverResponse = await this.$http.get('server');
                if (serverResponse.data.auth && !this.authCode) {
                    this.authCodeDialog = true;
                    this.connecting = false;
                    return;
                }

                if (this.authCode) {
                    localStorage.setItem('auth', this.authCode);
                }

                // 获取配置
                await this.fetchConfig();

                // 获取消息列表
                this.hasMore = true;
                await this.fetchMessages();

                // 启动轮询
                this.startPolling();

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
            this.stopPolling();
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
