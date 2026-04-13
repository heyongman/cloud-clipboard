<template>
    <v-container fluid class="subscription-page pa-4 pa-md-6">
        <v-row>
            <v-col cols="12">
                <v-card outlined class="mb-6">
                    <v-card-title class="d-flex flex-wrap align-center">
                        <span class="text-h6">固定订阅地址</span>
                        <v-spacer></v-spacer>
                        <v-chip v-if="config && config.updatedAt" small outlined color="primary">
                            最近更新 {{ formatUpdatedAt(config.updatedAt) }}
                        </v-chip>
                    </v-card-title>
                    <v-card-text>
                        <v-text-field
                            :value="config ? config.subscriptionUrl : ''"
                            outlined
                            readonly
                            hide-details="auto"
                            label="Clash 订阅地址"
                            class="mb-4"
                        ></v-text-field>
                        <div class="d-flex flex-wrap subscription-actions">
                            <v-btn
                                color="primary"
                                class="mr-3 mb-3"
                                :disabled="!config || !config.subscriptionUrl"
                                @click="copySubscriptionUrl"
                            >
                                复制地址
                            </v-btn>
                            <v-btn
                                outlined
                                color="primary"
                                class="mb-3"
                                :loading="resettingToken"
                                @click="resetToken"
                            >
                                重置 token
                            </v-btn>
                        </div>
                        <div class="caption text--secondary">
                            修改订阅源或过滤规则后，固定地址保持不变；只有主动重置 token 时地址才会变化。
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>

            <v-col cols="12" md="7">
                <v-card outlined>
                    <v-card-title>上游订阅与过滤规则</v-card-title>
                    <v-card-text>
                        <v-textarea
                            v-model="form.sourcesText"
                            outlined
                            auto-grow
                            rows="8"
                            row-height="22"
                            label="上游订阅 URL，每行一个"
                            placeholder="https://example.com/subscription-a&#10;https://example.com/subscription-b"
                            class="mb-4"
                        ></v-textarea>
                        <v-textarea
                            v-model="form.includePatternsText"
                            outlined
                            auto-grow
                            rows="5"
                            row-height="22"
                            label="包含正则，每行一条"
                            placeholder="HK&#10;TW|JP"
                            class="mb-4"
                        ></v-textarea>
                        <v-textarea
                            v-model="form.excludePatternsText"
                            outlined
                            auto-grow
                            rows="5"
                            row-height="22"
                            label="屏蔽正则，每行一条"
                            placeholder="实验&#10;过期"
                            class="mb-4"
                        ></v-textarea>
                        <v-textarea
                            v-model="form.customRulesText"
                            outlined
                            auto-grow
                            rows="6"
                            row-height="22"
                            label="自定义规则，每行一条"
                            placeholder="DOMAIN-SUFFIX,example.com,HYM&#10;GEOIP,CN,DIRECT"
                        ></v-textarea>
                        <div class="caption text--secondary mt-2">
                            这些规则会加到最终订阅配置的 rules 最前面，并优先于首个成功订阅继承过来的 rules。
                        </div>
                    </v-card-text>
                    <v-divider></v-divider>
                    <v-card-actions class="px-4 py-4">
                        <v-btn
                            color="primary"
                            class="mr-3"
                            :loading="previewing"
                            @click="previewConfig"
                        >
                            预览
                        </v-btn>
                        <v-btn
                            outlined
                            color="primary"
                            :loading="saving"
                            @click="saveConfig"
                        >
                            保存配置
                        </v-btn>
                    </v-card-actions>
                </v-card>
            </v-col>

            <v-col cols="12" md="5">
                <v-card outlined class="fill-height">
                    <v-card-title>预览结果</v-card-title>
                    <v-card-text v-if="preview">
                        <v-row dense class="mb-3">
                            <v-col cols="6">
                                <v-sheet outlined rounded class="pa-3 text-center">
                                    <div class="caption text--secondary">成功上游</div>
                                    <div class="text-h5">{{ preview.summary.successSourceCount }}</div>
                                </v-sheet>
                            </v-col>
                            <v-col cols="6">
                                <v-sheet outlined rounded class="pa-3 text-center">
                                    <div class="caption text--secondary">失败上游</div>
                                    <div class="text-h5">{{ preview.summary.failedSourceCount }}</div>
                                </v-sheet>
                            </v-col>
                            <v-col cols="4">
                                <v-sheet outlined rounded class="pa-3 text-center">
                                    <div class="caption text--secondary">原始节点</div>
                                    <div class="text-h6">{{ preview.summary.rawProxyCount }}</div>
                                </v-sheet>
                            </v-col>
                            <v-col cols="4">
                                <v-sheet outlined rounded class="pa-3 text-center">
                                    <div class="caption text--secondary">去重后</div>
                                    <div class="text-h6">{{ preview.summary.dedupedProxyCount }}</div>
                                </v-sheet>
                            </v-col>
                            <v-col cols="4">
                                <v-sheet outlined rounded class="pa-3 text-center">
                                    <div class="caption text--secondary">保留节点</div>
                                    <div class="text-h6">{{ preview.summary.filteredProxyCount }}</div>
                                </v-sheet>
                            </v-col>
                        </v-row>

                        <div class="text-subtitle-2 mb-2">保留节点</div>
                        <div v-if="preview.proxyNames.length" class="mb-4">
                            <v-chip
                                v-for="item in preview.proxyNames"
                                :key="item"
                                small
                                class="mr-2 mb-2"
                                outlined
                                color="primary"
                            >
                                {{ item }}
                            </v-chip>
                        </div>
                        <div v-else class="caption text--secondary mb-4">
                            当前没有保留节点。
                        </div>

                        <div class="text-subtitle-2 mb-2">错误摘要</div>
                        <v-alert
                            v-if="preview.errors.length"
                            dense
                            text
                            type="warning"
                        >
                            <div
                                v-for="item in preview.errors"
                                :key="`${item.source}-${item.message}`"
                                class="mb-1"
                            >
                                {{ item.source }}：{{ item.message }}
                            </div>
                        </v-alert>
                        <div v-else class="caption text--secondary">
                            没有上游错误。
                        </div>
                    </v-card-text>
                    <v-card-text v-else class="text--secondary">
                        填写订阅源和过滤规则后点击“预览”，这里会显示节点统计、保留结果和错误摘要。
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <v-overlay :value="loading" absolute>
            <v-progress-circular indeterminate size="48" color="primary"></v-progress-circular>
        </v-overlay>
    </v-container>
</template>

<script>
import { copyToClipboard, joinLines, splitLines } from '@/util.js';

export default {
    name: 'Subscription',
    data() {
        return {
            loading: false,
            saving: false,
            previewing: false,
            resettingToken: false,
            config: null,
            preview: null,
            form: {
                sourcesText: '',
                includePatternsText: '',
                excludePatternsText: '',
                customRulesText: '',
            },
        };
    },
    mounted() {
        this.loadConfig();
    },
    methods: {
        formatUpdatedAt(timestamp) {
            if (!timestamp) {
                return '-';
            }

            return new Date(timestamp).toLocaleString('zh-CN', {
                hour12: false,
            });
        },
        applyConfig(config) {
            this.config = config;
            this.form.sourcesText = joinLines(config.sources);
            this.form.includePatternsText = joinLines(config.includePatterns);
            this.form.excludePatternsText = joinLines(config.excludePatterns);
            this.form.customRulesText = joinLines(config.customRules);
        },
        buildPayload() {
            return {
                sources: splitLines(this.form.sourcesText),
                includePatterns: splitLines(this.form.includePatternsText),
                excludePatterns: splitLines(this.form.excludePatternsText),
                customRules: splitLines(this.form.customRulesText),
            };
        },
        handleRequestError(error, fallbackMessage) {
            if (error?.response?.status === 403 && this.$root.handleAuthError) {
                this.$root.handleAuthError();
                return;
            }

            const message = error?.response?.data?.msg || error?.message || fallbackMessage;
            this.$toast.error(message || fallbackMessage);
        },
        async loadConfig() {
            this.loading = true;

            try {
                const { data: { result } } = await this.$http.get('subscription/config');
                this.applyConfig(result);
            } catch (error) {
                this.handleRequestError(error, '加载订阅配置失败');
            } finally {
                this.loading = false;
            }
        },
        async previewConfig() {
            this.previewing = true;

            try {
                const { data: { result } } = await this.$http.post('subscription/preview', this.buildPayload());
                this.preview = result;
                this.$toast('预览完成');
            } catch (error) {
                this.preview = null;
                this.handleRequestError(error, '预览失败');
            } finally {
                this.previewing = false;
            }
        },
        async saveConfig() {
            this.saving = true;

            try {
                const { data: { result } } = await this.$http.put('subscription/config', this.buildPayload());
                this.applyConfig(result);
                this.$toast('保存成功');
            } catch (error) {
                this.handleRequestError(error, '保存失败');
            } finally {
                this.saving = false;
            }
        },
        async resetToken() {
            this.resettingToken = true;

            try {
                const { data: { result } } = await this.$http.post('subscription/token/reset');
                this.applyConfig(result);
                this.$toast('token 已重置');
            } catch (error) {
                this.handleRequestError(error, '重置 token 失败');
            } finally {
                this.resettingToken = false;
            }
        },
        async copySubscriptionUrl() {
            if (!this.config?.subscriptionUrl) {
                return;
            }

            const result = await copyToClipboard(this.config.subscriptionUrl);
            if (result.success) {
                this.$toast('订阅地址已复制');
            } else {
                this.$toast.error('复制失败');
            }
        },
    },
};
</script>

<style scoped>
.subscription-page {
    position: relative;
    min-height: 100%;
}

.subscription-actions {
    align-items: center;
}

@media (max-width: 960px) {
    .subscription-actions .v-btn {
        width: 100%;
        margin-right: 0 !important;
    }
}
</style>
