<template>
    <v-container fluid class="ai-chat-page pa-0">
        <div class="ai-chat-shell">
            <aside class="chat-sidebar">
                <div class="sidebar-toolbar">
                    <v-btn
                        v-bind="newChatButtonProps"
                        block
                        @click="newChatDialog = true"
                    >
                        <v-icon left>{{ mdiPlus }}</v-icon>
                        新建聊天
                    </v-btn>
                </div>
                <v-list dense class="conversation-list">
                    <v-list-item
                        v-for="conversation in chatState.conversations"
                        :key="conversation.id"
                        :class="{ 'v-list-item--active': conversation.id === chatState.activeId }"
                        @click="selectConversation(conversation.id)"
                    >
                        <v-list-item-content>
                            <v-list-item-title>{{ conversation.title }}</v-list-item-title>
                            <v-list-item-subtitle>{{ conversation.roleName }}</v-list-item-subtitle>
                        </v-list-item-content>
                        <v-list-item-action>
                            <v-btn icon small @click.stop="deleteConversation(conversation.id)">
                                <v-icon small>{{ mdiDelete }}</v-icon>
                            </v-btn>
                        </v-list-item-action>
                    </v-list-item>
                </v-list>
                <div class="sidebar-advanced">
                    <v-btn text block class="advanced-toggle" @click="advancedOpen = !advancedOpen">
                        <v-icon left small>{{ mdiTune }}</v-icon>
                        参数
                        <v-spacer></v-spacer>
                        <v-icon small>{{ advancedOpen ? mdiChevronDown : mdiChevronRight }}</v-icon>
                    </v-btn>
                    <div v-if="advancedOpen" class="advanced-panel">
                        <v-btn text block class="justify-start" @click="settingsDialog = true">
                            <v-icon left small>{{ mdiCog }}</v-icon>
                            AI设置
                        </v-btn>
                        <v-combobox
                            v-model="currentModel"
                            :items="modelOptions"
                            dense
                            outlined
                            hide-details
                            label="模型"
                            class="mt-2"
                        ></v-combobox>
                        <v-select
                            v-model="currentReasoningEffort"
                            :items="reasoningOptions"
                            dense
                            outlined
                            hide-details
                            label="思考"
                            class="mt-2"
                        ></v-select>
                    </div>
                </div>
            </aside>

            <section class="chat-main" v-if="activeConversation">
                <div ref="messageScroller" class="message-list" @scroll="handleMessageScroll">
                    <div
                        v-for="message in activeConversation.messages"
                        :key="message.id"
                        :class="['message-row', `message-${message.role}`]"
                    >
                        <div class="message-avatar">
                            <v-icon small>{{ message.role === 'user' ? mdiAccountCircle : mdiRobot }}</v-icon>
                        </div>
                        <div class="message-bubble">
                            <div v-if="message.streaming || message.failed" class="message-meta">
                                <span v-if="message.streaming">正在输出...</span>
                                <span v-if="message.failed" class="error--text">输出异常</span>
                            </div>
                            <div
                                v-if="message.text"
                                class="markdown-body"
                                v-html="renderMarkdown(message.text)"
                            ></div>
                            <div v-if="message.attachments && message.attachments.length" class="attachment-grid mt-2">
                                <div
                                    v-for="attachment in message.attachments"
                                    :key="attachment.id"
                                    class="attachment-item"
                                >
                                    <img
                                        v-if="attachment.kind === 'image'"
                                        :src="attachment.dataUrl"
                                        :alt="attachment.name"
                                    >
                                    <v-icon v-else>{{ mdiFile }}</v-icon>
                                    <div class="caption text-truncate">{{ attachment.name }}</div>
                                    <div v-if="!attachment.sentToAi" class="caption text--secondary">未发送给AI</div>
                                </div>
                            </div>
                            <div v-if="message.images && message.images.length" class="generated-images mt-2">
                                <img
                                    v-for="image in message.images"
                                    :key="image.id"
                                    :src="image.dataUrl"
                                    alt="AI生成图片"
                                >
                            </div>
                            <div class="message-actions">
                                <v-btn icon x-small title="复制文本" @click="copyMessageText(message)">
                                    <v-icon x-small>{{ mdiContentCopy }}</v-icon>
                                </v-btn>
                                <v-btn icon x-small title="复制Markdown" @click="copyMessageMarkdown(message)">
                                    <v-icon x-small>{{ mdiCodeTags }}</v-icon>
                                </v-btn>
                                <v-btn
                                    v-if="message.role === 'assistant'"
                                    icon
                                    x-small
                                    title="重试"
                                    :disabled="sending"
                                    @click="retryMessage(message)"
                                >
                                    <v-icon x-small>{{ mdiRefresh }}</v-icon>
                                </v-btn>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="composer">
                    <div v-if="draftAttachments.length" class="draft-attachments">
                        <v-chip
                            v-for="attachment in draftAttachments"
                            :key="attachment.id"
                            close
                            small
                            @click:close="removeDraftAttachment(attachment.id)"
                        >
                            <v-avatar left v-if="attachment.kind === 'image'">
                                <img :src="attachment.dataUrl" :alt="attachment.name">
                            </v-avatar>
                            {{ attachment.name }}
                        </v-chip>
                    </div>
                    <v-textarea
                        ref="composerInput"
                        v-model="draftText"
                        outlined
                        auto-grow
                        rows="3"
                        row-height="22"
                        hide-details
                        placeholder="Enter 换行，Ctrl+Enter 发送。可直接粘贴图片。"
                        @keydown.ctrl.enter.prevent="sendMessage"
                        @paste="handlePaste"
                    ></v-textarea>
                    <input
                        ref="fileInput"
                        class="hidden-file-input"
                        type="file"
                        multiple
                        @change="handleFileInput"
                    >
                    <div class="composer-actions">
                        <div class="tool-switch-group">
                            <div class="tool-switch-item">
                                <button
                                    type="button"
                                    class="tool-switch-label"
                                    @click="toggleToolSwitch('webSearch')"
                                >联网</button>
                                <v-switch
                                    v-model="activeConversation.webSearch"
                                    dense
                                    inset
                                    hide-details
                                    aria-label="联网"
                                    class="tool-switch"
                                    @change="persist"
                                ></v-switch>
                            </div>
                            <div class="tool-switch-item">
                                <button
                                    type="button"
                                    class="tool-switch-label"
                                    @click="toggleToolSwitch('imageGeneration')"
                                >画图</button>
                                <v-switch
                                    v-model="activeConversation.imageGeneration"
                                    dense
                                    inset
                                    hide-details
                                    aria-label="画图"
                                    class="tool-switch"
                                    @change="persist"
                                ></v-switch>
                            </div>
                        </div>
                        <v-chip small outlined color="primary">
                            {{ tokenUsageText }}
                        </v-chip>
                        <v-spacer></v-spacer>
                        <v-btn text :disabled="sending" @click="$refs.fileInput.click()">
                            <v-icon left>{{ mdiImagePlus }}</v-icon>
                            附件
                        </v-btn>
                        <v-btn v-if="sending" color="error" @click="stopStreaming">
                            <v-icon left>{{ mdiStop }}</v-icon>
                            终止
                        </v-btn>
                        <v-btn v-else color="primary" :disabled="!canSend" @click="sendMessage">
                            <v-icon left>{{ mdiSend }}</v-icon>
                            发送
                        </v-btn>
                    </div>
                </div>
            </section>
            <section class="chat-empty" v-else>
                <v-icon size="56" color="primary">{{ mdiRobot }}</v-icon>
                <div class="text-subtitle-1 mt-4">选择角色后开始新对话</div>
                <v-btn
                    v-bind="newChatButtonProps"
                    class="mt-4"
                    @click="newChatDialog = true"
                >
                    <v-icon left>{{ mdiPlus }}</v-icon>
                    新建聊天
                </v-btn>
            </section>
        </div>

        <v-dialog v-model="newChatDialog" max-width="420">
            <v-card>
                <v-card-title>选择 AI 角色</v-card-title>
                <v-card-text>
                    <v-select
                        v-model="selectedRoleId"
                        :items="roles"
                        item-text="name"
                        item-value="id"
                        outlined
                        dense
                        label="AI角色"
                    ></v-select>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn text @click="newChatDialog = false">取消</v-btn>
                    <v-btn color="primary" @click="newChat">创建</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <v-dialog v-model="settingsDialog" max-width="620">
            <v-card>
                <v-card-title>AI设置</v-card-title>
                <v-card-text>
                    <v-text-field
                        v-model="settings.apiBase"
                        outlined
                        dense
                        label="API Base"
                        placeholder="https://api.openai.com/v1"
                    ></v-text-field>
                    <v-text-field
                        v-model="settings.apiKey"
                        outlined
                        dense
                        :type="showApiKey ? 'text' : 'password'"
                        :append-icon="showApiKey ? mdiEye : mdiEyeOff"
                        :placeholder="settings.hasApiKey ? '留空则保留已保存的Key' : '输入API Key'"
                        label="API Key"
                        @click:append="showApiKey = !showApiKey"
                    ></v-text-field>
                    <v-row>
                        <v-col cols="12" md="6">
                            <v-combobox
                                v-model="settings.defaultModel"
                                :items="modelOptions"
                                outlined
                                dense
                                label="默认模型"
                            ></v-combobox>
                        </v-col>
                        <v-col cols="12" md="6">
                            <v-combobox
                                v-model="settings.summaryModel"
                                :items="modelOptions"
                                outlined
                                dense
                                label="摘要模型"
                            ></v-combobox>
                        </v-col>
                    </v-row>
                    <v-select
                        v-model="settings.defaultReasoningEffort"
                        :items="reasoningOptions"
                        outlined
                        dense
                        label="默认思考程度"
                    ></v-select>
                    <v-alert v-if="settings.hasApiKey" dense text type="info">
                        后端已保存 API Key。保存时留空会继续沿用旧 Key。
                    </v-alert>
                </v-card-text>
                <v-card-actions>
                    <v-btn text :loading="modelLoading" @click="queryModels">查询模型</v-btn>
                    <v-spacer></v-spacer>
                    <v-btn text @click="settingsDialog = false">取消</v-btn>
                    <v-btn color="primary" :loading="settingsSaving" @click="saveSettings">保存</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </v-container>
</template>

<script>
import {
    mdiAccountCircle,
    mdiChevronDown,
    mdiChevronRight,
    mdiCodeTags,
    mdiCog,
    mdiContentCopy,
    mdiDelete,
    mdiEye,
    mdiEyeOff,
    mdiFile,
    mdiImagePlus,
    mdiPlus,
    mdiRefresh,
    mdiRobot,
    mdiSend,
    mdiStop,
    mdiTune,
} from '@mdi/js';
import {
    DEFAULT_ROLES,
    createDefaultConversation,
    deriveConversationTitle,
    getActiveConversation,
    loadChatState,
    saveChatState,
} from '@/utils/chat-storage.mjs';
import {
    formatTokenUsage,
    sumTokenUsage,
} from '@/utils/chat-tokens.mjs';
import { copyToClipboard } from '@/util.js';

const createMessageId = () => `msg_${Date.now().toString(36)}_${Math.floor(Math.random() * 0xffffff).toString(36)}`;
const createAttachmentId = () => `att_${Date.now().toString(36)}_${Math.floor(Math.random() * 0xffffff).toString(36)}`;
const STREAM_FLUSH_INTERVAL_MS = 120;
const STREAM_IDLE_TIMEOUT_MS = 90000;
const SCROLL_FOLLOW_THRESHOLD_PX = 80;

export default {
    data() {
        return {
            mdiAccountCircle,
            mdiChevronDown,
            mdiChevronRight,
            mdiCodeTags,
            mdiCog,
            mdiContentCopy,
            mdiDelete,
            mdiEye,
            mdiEyeOff,
            mdiFile,
            mdiImagePlus,
            mdiPlus,
            mdiRefresh,
            mdiRobot,
            mdiSend,
            mdiStop,
            mdiTune,
            roles: DEFAULT_ROLES,
            selectedRoleId: DEFAULT_ROLES[0].id,
            newChatDialog: false,
            advancedOpen: false,
            chatState: {
                version: 1,
                activeId: '',
                conversations: [],
            },
            settings: {
                apiBase: 'https://api.openai.com/v1',
                apiKey: '',
                hasApiKey: false,
                defaultModel: 'gpt-5',
                defaultReasoningEffort: 'medium',
                summaryModel: 'gpt-5-mini',
                cachedModels: [],
            },
            currentModel: 'gpt-5',
            currentReasoningEffort: 'medium',
            modelIds: [],
            reasoningOptions: [
                { text: '低', value: 'low' },
                { text: '中', value: 'medium' },
                { text: '高', value: 'high' },
            ],
            draftText: '',
            draftAttachments: [],
            sending: false,
            settingsDialog: false,
            settingsSaving: false,
            modelLoading: false,
            showApiKey: false,
            markdownParser: null,
            streamAbortController: null,
            streamStoppedByUser: false,
            streamShouldFollow: false,
        };
    },
    computed: {
        activeConversation() {
            return getActiveConversation(this.chatState);
        },
        activeRole() {
            return this.roles.find(item => item.id === this.selectedRoleId) || this.roles[0];
        },
        modelOptions() {
            const ids = new Set([
                ...this.modelIds,
                this.settings.defaultModel,
                this.settings.summaryModel,
                this.currentModel,
            ].filter(Boolean));
            return Array.from(ids).sort((a, b) => a.localeCompare(b));
        },
        canSend() {
            return !this.sending && (!!this.draftText.trim() || this.draftAttachments.length > 0);
        },
        tokenUsageText() {
            return formatTokenUsage(sumTokenUsage(
                this.activeConversation?.messages || [],
                this.activeConversation?.usage || {},
            ));
        },
        newChatButtonProps() {
            return this.$vuetify.theme.dark
                ? { color: 'primary', outlined: true }
                : { color: 'primary', depressed: true };
        },
    },
    watch: {
        settingsDialog(value) {
            if (value) {
                this.loadSettings();
            }
        },
    },
    mounted() {
        this.chatState = loadChatState(localStorage, {
            defaults: this.settings,
            initialConversation: false,
        });
        this.recoverInterruptedMessages();
        this.loadMarkdown();
        this.loadSettings({ resetRuntime: true });
    },
    beforeDestroy() {
        this.stopStreaming({ silent: true });
    },
    methods: {
        async loadMarkdown() {
            const module = await import(
                /* webpackChunkName: "markdown-parser" */
                'markdown-it'
            );
            const MarkdownIt = module.default || module;
            this.markdownParser = new MarkdownIt('default', {
                html: false,
                breaks: true,
                linkify: true,
                typographer: true,
            });
            this.markdownParser.enable(['table', 'strikethrough']);
        },
        toggleToolSwitch(key) {
            if (!this.activeConversation) return;
            this.$set(this.activeConversation, key, !this.activeConversation[key]);
            this.persist();
        },
        renderMarkdown(text) {
            if (!this.markdownParser) {
                return `${text || ''}`
                    .replaceAll('&', '&amp;')
                    .replaceAll('<', '&lt;')
                    .replaceAll('>', '&gt;')
                    .replace(/\n/g, '<br>');
            }
            return this.markdownParser.render(text || '');
        },
        renderPlainText(text) {
            const value = `${text || ''}`;
            if (!this.markdownParser || typeof document === 'undefined') {
                return value;
            }

            const container = document.createElement('div');
            container.innerHTML = this.markdownParser.render(value);
            return (container.textContent || '').trim();
        },
        persist() {
            if (this.activeConversation) {
                this.activeConversation.updatedAt = Date.now();
            }
            saveChatState(localStorage, this.chatState);
        },
        recoverInterruptedMessages() {
            let changed = false;
            for (const conversation of this.chatState.conversations) {
                for (const message of conversation.messages || []) {
                    if (!message.streaming) continue;
                    message.streaming = false;
                    message.failed = true;
                    message.error = message.error || '输出已中断，可能是页面刷新或连接意外结束。';
                    changed = true;
                }
            }
            if (changed) {
                saveChatState(localStorage, this.chatState);
            }
        },
        applyModelCache(models = []) {
            this.modelIds = (models || []).map(item => (typeof item === 'string' ? item : item.id)).filter(Boolean);
        },
        async loadSettings({ resetRuntime = false } = {}) {
            try {
                const { data: { result } } = await this.$http.get('ai/config');
                this.settings = {
                    ...this.settings,
                    ...result,
                    apiKey: '',
                };
                this.applyModelCache(result.cachedModels || []);
                if (resetRuntime) {
                    this.currentModel = result.defaultModel || this.currentModel;
                    this.currentReasoningEffort = result.defaultReasoningEffort || this.currentReasoningEffort;
                }
            } catch (error) {
                console.error(error);
            }
        },
        async saveSettings() {
            this.settingsSaving = true;
            try {
                const payload = {
                    ...this.settings,
                    keepApiKey: this.settings.hasApiKey && !this.settings.apiKey,
                };
                const { data: { result } } = await this.$http.put('ai/config', payload);
                this.settings = {
                    ...this.settings,
                    ...result,
                    apiKey: '',
                };
                this.applyModelCache(result.cachedModels || []);
                this.currentModel = result.defaultModel || this.currentModel;
                this.currentReasoningEffort = result.defaultReasoningEffort || this.currentReasoningEffort;
                this.settingsDialog = false;
                this.$toast('AI设置已保存');
            } catch (error) {
                this.$toast.error(error.response?.data?.msg || '保存AI设置失败');
            } finally {
                this.settingsSaving = false;
            }
        },
        async queryModels() {
            this.modelLoading = true;
            try {
                const { data: { result } } = await this.$http.get('ai/models');
                this.settings.cachedModels = result.items || [];
                this.applyModelCache(this.settings.cachedModels);
                this.$toast('模型列表已更新');
            } catch (error) {
                this.$toast.error(error.response?.data?.msg || '查询模型失败');
            } finally {
                this.modelLoading = false;
            }
        },
        newChat() {
            const conversation = createDefaultConversation({
                role: this.activeRole,
                defaults: this.settings,
            });
            this.chatState.conversations.unshift(conversation);
            this.chatState.activeId = conversation.id;
            this.clearDraft();
            this.newChatDialog = false;
            this.persist();
        },
        selectConversation(id) {
            this.chatState.activeId = id;
            this.clearDraft();
            this.persist();
        },
        deleteConversation(id) {
            if (this.chatState.conversations.length <= 1) {
                this.$toast.error('至少保留一个对话');
                return;
            }
            this.chatState.conversations = this.chatState.conversations.filter(item => item.id !== id);
            if (this.chatState.activeId === id) {
                this.chatState.activeId = this.chatState.conversations[0].id;
            }
            this.persist();
        },
        clearDraft() {
            this.draftText = '';
            this.draftAttachments = [];
        },
        removeDraftAttachment(id) {
            this.draftAttachments = this.draftAttachments.filter(item => item.id !== id);
        },
        async fileToAttachment(file) {
            const isImage = file.type.startsWith('image/');
            const attachment = {
                id: createAttachmentId(),
                kind: isImage ? 'image' : 'file',
                name: file.name || (isImage ? 'pasted-image.png' : 'pasted-file'),
                size: file.size,
                mimeType: file.type,
                sentToAi: isImage,
            };
            if (!isImage) {
                return attachment;
            }

            attachment.dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            return attachment;
        },
        async handlePaste(event) {
            const files = Array.from(event.clipboardData?.files || []);
            if (!files.length) return;

            const attachments = [];
            for (const file of files) {
                attachments.push(await this.fileToAttachment(file));
            }
            this.draftAttachments.push(...attachments);
        },
        async handleFileInput(event) {
            const files = Array.from(event.target.files || []);
            if (!files.length) return;

            const attachments = [];
            for (const file of files) {
                attachments.push(await this.fileToAttachment(file));
            }
            this.draftAttachments.push(...attachments);
            event.target.value = '';
        },
        buildRequestMessages() {
            const messages = [];
            if (this.activeConversation.summary) {
                messages.push({
                    role: 'user',
                    content: [{
                        type: 'text',
                        text: `以下是当前对话摘要，用于延续上下文：\n${this.activeConversation.summary}`,
                    }],
                });
            }

            for (const message of this.activeConversation.messages) {
                if (message.failed || message.streaming) continue;
                const content = [];
                if (message.text) {
                    content.push({ type: 'text', text: message.text });
                }
                for (const attachment of message.attachments || []) {
                    if (attachment.kind === 'image' && attachment.dataUrl && attachment.sentToAi) {
                        content.push({
                            type: 'image',
                            mimeType: attachment.mimeType,
                            dataUrl: attachment.dataUrl,
                        });
                    }
                }
                if (content.length) {
                    messages.push({
                        role: message.role === 'assistant' ? 'assistant' : 'user',
                        content,
                    });
                }
            }
            return messages;
        },
        buildLatestRequestMessages(assistantMessage) {
            const messages = [];
            const assistantIndex = this.activeConversation.messages.indexOf(assistantMessage);
            if (assistantIndex > 0) {
                const previousMessage = this.activeConversation.messages[assistantIndex - 1];
                if (previousMessage?.role === 'user' && !previousMessage.failed && !previousMessage.streaming) {
                    const content = [];
                    if (previousMessage.text) {
                        content.push({ type: 'text', text: previousMessage.text });
                    }
                    for (const attachment of previousMessage.attachments || []) {
                        if (attachment.kind === 'image' && attachment.dataUrl && attachment.sentToAi) {
                            content.push({
                                type: 'image',
                                mimeType: attachment.mimeType,
                                dataUrl: attachment.dataUrl,
                            });
                        }
                    }
                    if (content.length) {
                        messages.push({
                            role: 'user',
                            content,
                        });
                    }
                }
            }
            return messages;
        },
        getPreviousResponseId(assistantMessage) {
            const assistantIndex = this.activeConversation.messages.indexOf(assistantMessage);
            if (assistantIndex <= 0) return '';
            for (let index = assistantIndex - 1; index >= 0; index -= 1) {
                const message = this.activeConversation.messages[index];
                if (message.role === 'assistant' && message.responseId && message.completed && !message.failed) {
                    return message.responseId;
                }
            }
            return '';
        },
        async sendMessage() {
            if (!this.canSend || !this.activeConversation) return;
            if (!this.settings.hasApiKey && !this.settings.apiKey) {
                this.settingsDialog = true;
                this.$toast.error('请先设置 API Key');
                return;
            }

            const userMessage = {
                id: createMessageId(),
                role: 'user',
                text: this.draftText.trim(),
                attachments: this.draftAttachments,
                createdAt: Date.now(),
            };
            const assistantMessage = {
                id: createMessageId(),
                role: 'assistant',
                text: '',
                images: [],
                streaming: true,
                failed: false,
                error: '',
                completed: false,
                createdAt: Date.now(),
            };

            if (this.activeConversation.messages.length === 0 && userMessage.text) {
                this.activeConversation.title = deriveConversationTitle(userMessage.text);
            }
            this.activeConversation.messages.push(userMessage, assistantMessage);
            this.clearDraft();
            this.persist();
            this.scrollToBottom();

            await this.startAssistantStream(assistantMessage);
        },
        async retryMessage(message) {
            if (!this.activeConversation || this.sending || message.role !== 'assistant') return;
            message.text = '';
            message.images = [];
            message.streaming = true;
            message.failed = false;
            message.error = '';
            message.completed = false;
            this.$delete(message, 'usage');
            this.$delete(message, 'responseId');
            this.persist();
            this.scrollToBottom();
            await this.startAssistantStream(message);
        },
        async startAssistantStream(assistantMessage) {
            this.sending = true;
            this.streamStoppedByUser = false;
            this.streamAbortController = new AbortController();
            assistantMessage.completed = false;
            try {
                const response = await fetch('ai/responses/stream', {
                    method: 'POST',
                    signal: this.streamAbortController.signal,
                    headers: {
                        Authorization: `Bearer ${this.$root.authCode}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: this.currentModel || this.settings.defaultModel,
                        reasoningEffort: this.currentReasoningEffort || this.settings.defaultReasoningEffort,
                        rolePrompt: this.activeConversation.rolePrompt,
                        messages: this.buildRequestMessages(),
                        latestMessages: this.buildLatestRequestMessages(assistantMessage),
                        previousResponseId: this.getPreviousResponseId(assistantMessage),
                        tools: {
                            webSearch: this.activeConversation.webSearch,
                            imageGeneration: this.activeConversation.imageGeneration,
                        },
                    }),
                });

                if (!response.ok || !response.body) {
                    throw new Error(`AI 请求失败：${response.status}`);
                }

                await this.consumeSse(response.body, assistantMessage);
                if (!assistantMessage.completed && !this.streamStoppedByUser && !assistantMessage.failed) {
                    assistantMessage.failed = true;
                    assistantMessage.error = 'AI 输出意外结束，请重试。';
                }
            } catch (error) {
                if (error.name === 'AbortError' || this.streamStoppedByUser) {
                    assistantMessage.error = assistantMessage.text || assistantMessage.images?.length
                        ? '已终止输出'
                        : '已取消输出';
                } else {
                    assistantMessage.failed = true;
                    assistantMessage.error = error.message || 'AI请求失败';
                    this.$toast.error(error.message || 'AI请求失败');
                }
            } finally {
                assistantMessage.streaming = false;
                this.sending = false;
                this.streamAbortController = null;
                this.streamStoppedByUser = false;
                this.persist();
            }
        },
        stopStreaming({ silent = false } = {}) {
            if (!this.streamAbortController) return;
            this.streamStoppedByUser = true;
            this.streamAbortController.abort();
            if (!silent) {
                this.$toast('已终止输出');
            }
        },
        async consumeSse(body, assistantMessage) {
            const reader = body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let eventName = 'message';
            let dataLines = [];
            let pendingDelta = '';
            let flushTimer = null;
            let scrollTimer = null;
            this.streamShouldFollow = this.isMessageScrollerNearBottom();

            const scheduleScroll = () => {
                if (!this.streamShouldFollow) return;
                if (scrollTimer) return;
                scrollTimer = setTimeout(() => {
                    scrollTimer = null;
                    if (this.streamShouldFollow) {
                        this.scrollToBottom();
                    }
                }, STREAM_FLUSH_INTERVAL_MS);
            };

            const flushPending = () => {
                if (pendingDelta) {
                    assistantMessage.text += pendingDelta;
                    pendingDelta = '';
                }
                scheduleScroll();
            };

            const scheduleFlush = () => {
                if (flushTimer) return;
                flushTimer = setTimeout(() => {
                    flushTimer = null;
                    flushPending();
                }, STREAM_FLUSH_INTERVAL_MS);
            };

            const readNext = async () => {
                let timeoutId = null;
                try {
                    return await Promise.race([
                        reader.read(),
                        new Promise((resolve, reject) => {
                            timeoutId = setTimeout(() => {
                                this.streamAbortController?.abort();
                                const error = new Error('AI 输出超过 90 秒没有新内容，已自动终止。');
                                error.name = 'StreamIdleTimeout';
                                reject(error);
                            }, STREAM_IDLE_TIMEOUT_MS);
                        }),
                    ]);
                } finally {
                    clearTimeout(timeoutId);
                }
            };

            const flush = () => {
                if (!dataLines.length) return;
                const raw = dataLines.join('\n');
                dataLines = [];
                const currentEvent = eventName;
                eventName = 'message';
                this.applyStreamEvent(currentEvent, raw, assistantMessage, {
                    appendText: delta => {
                        pendingDelta += delta;
                        scheduleFlush();
                    },
                    flushNow: flushPending,
                });
            };

            try {
                while (true) {
                    const { value, done } = await readNext();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split(/\r?\n/);
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (!line) {
                            flush();
                        } else if (line.startsWith('event:')) {
                            eventName = line.slice(6).trim();
                        } else if (line.startsWith('data:')) {
                            dataLines.push(line.slice(5).trimStart());
                        }
                    }
                }
                buffer += decoder.decode();
                if (buffer) {
                    for (const line of buffer.split(/\r?\n/)) {
                        if (!line) {
                            flush();
                        } else if (line.startsWith('event:')) {
                            eventName = line.slice(6).trim();
                        } else if (line.startsWith('data:')) {
                            dataLines.push(line.slice(5).trimStart());
                        }
                    }
                }
                flush();
                flushPending();
            } finally {
                if (pendingDelta) {
                    assistantMessage.text += pendingDelta;
                    pendingDelta = '';
                }
                if (flushTimer) {
                    clearTimeout(flushTimer);
                }
                if (scrollTimer) {
                    clearTimeout(scrollTimer);
                }
            }
        },
        applyStreamEvent(eventName, raw, assistantMessage, stream = null) {
            let data;
            try {
                data = JSON.parse(raw);
            } catch {
                return;
            }

            if (eventName === 'text_delta') {
                stream?.appendText(data.delta || '');
            } else if (eventName === 'complete') {
                stream?.flushNow();
                if (data.responseId) {
                    this.$set(assistantMessage, 'responseId', data.responseId);
                }
                assistantMessage.completed = true;
            } else if (eventName === 'image') {
                stream?.flushNow();
                assistantMessage.images.push({
                    id: createAttachmentId(),
                    dataUrl: data.dataUrl,
                    mimeType: data.mimeType,
                });
            } else if (eventName === 'usage') {
                this.$set(assistantMessage, 'usage', data);
                this.$set(this.activeConversation, 'usage', sumTokenUsage(
                    this.activeConversation.messages || [],
                    this.activeConversation.usage || {},
                ));
            } else if (eventName === 'error') {
                stream?.flushNow();
                assistantMessage.failed = true;
                assistantMessage.error = data.message || 'AI请求失败';
                this.$toast.error(data.message || 'AI请求失败');
            }
        },
        async copyMessageText(message) {
            const result = await copyToClipboard(this.renderPlainText(message.text));
            this.$toast(result.success ? '已复制文本' : '复制失败');
        },
        async copyMessageMarkdown(message) {
            const result = await copyToClipboard(message.text || '');
            this.$toast(result.success ? '已复制Markdown' : '复制失败');
        },
        scrollToBottom() {
            this.$nextTick(() => {
                const scroller = this.$refs.messageScroller;
                if (scroller) {
                    scroller.scrollTop = scroller.scrollHeight;
                }
            });
        },
        isMessageScrollerNearBottom() {
            const scroller = this.$refs.messageScroller;
            if (!scroller) return true;
            const distance = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
            return distance <= SCROLL_FOLLOW_THRESHOLD_PX;
        },
        handleMessageScroll() {
            if (this.sending && !this.isMessageScrollerNearBottom()) {
                this.streamShouldFollow = false;
            }
        },
    },
};
</script>

<style scoped>
.ai-chat-page {
    height: calc(100vh - 64px);
}

.ai-chat-shell {
    display: grid;
    grid-template-columns: 280px minmax(0, 1fr);
    height: 100%;
    min-height: 0;
}

.chat-sidebar {
    border-right: 1px solid rgba(127, 127, 127, 0.22);
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.sidebar-toolbar {
    padding: 16px;
}

.conversation-list {
    overflow-y: auto;
    flex: 1 1 auto;
}

.sidebar-advanced {
    border-top: 1px solid rgba(127, 127, 127, 0.22);
    padding: 8px 12px 12px;
}

.advanced-toggle {
    justify-content: flex-start;
}

.advanced-panel {
    padding-top: 6px;
}

.chat-main {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    min-width: 0;
    min-height: 0;
}

.chat-empty {
    display: flex;
    min-height: 100%;
    align-items: center;
    justify-content: center;
    flex-direction: column;
}

.message-list {
    overflow-y: auto;
    padding: 24px 18px;
}

.message-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 16px;
}

.message-user {
    justify-content: flex-end;
}

.message-assistant {
    justify-content: flex-start;
}

.message-user .message-avatar {
    order: 2;
}

.message-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 28px;
    background: rgba(127, 127, 127, 0.14);
    color: currentColor;
}

.message-bubble {
    width: min(780px, 92%);
    border: 1px solid rgba(127, 127, 127, 0.22);
    border-radius: 8px;
    padding: 12px 14px;
    background: rgba(127, 127, 127, 0.06);
    color: inherit;
    font-size: 0.92rem;
}

.message-user .message-bubble {
    background: rgba(25, 118, 210, 0.08);
}

.message-meta {
    display: flex;
    gap: 10px;
    margin-bottom: 8px;
    font-size: 12px;
    color: rgba(127, 127, 127, 0.95);
}

.message-error {
    margin-bottom: 8px;
}

.markdown-body {
    line-height: 1.75;
    word-break: break-word;
    color: inherit;
    overflow-x: auto;
}

.markdown-body >>> p,
.markdown-body >>> ul,
.markdown-body >>> ol,
.markdown-body >>> pre,
.markdown-body >>> blockquote {
    margin-top: 0;
    margin-bottom: 0.8em;
}

.markdown-body >>> pre {
    overflow-x: auto;
    padding: 12px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.08);
}

.markdown-body >>> table {
    display: table;
    width: max-content;
    min-width: 100%;
    max-width: none;
    margin: 0 0 0.8em;
    border-collapse: collapse;
    border-spacing: 0;
    font-size: 0.9rem;
    line-height: 1.55;
}

.markdown-body >>> th,
.markdown-body >>> td {
    border: 1px solid rgba(127, 127, 127, 0.32);
    padding: 6px 10px;
    vertical-align: top;
    white-space: normal;
}

.markdown-body >>> th {
    font-weight: 600;
    background: rgba(127, 127, 127, 0.12);
}

.markdown-body >>> tbody tr:nth-child(even) {
    background: rgba(127, 127, 127, 0.05);
}

.markdown-body >>> code {
    font-family: Consolas, Monaco, monospace;
}

.attachment-grid,
.generated-images,
.draft-attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.attachment-item {
    width: 132px;
    border: 1px solid rgba(127, 127, 127, 0.22);
    border-radius: 8px;
    padding: 8px;
}

.attachment-item img {
    width: 100%;
    aspect-ratio: 1 / 1;
    object-fit: cover;
    border-radius: 6px;
}

.generated-images img {
    max-width: min(360px, 100%);
    border-radius: 8px;
    border: 1px solid rgba(127, 127, 127, 0.22);
}

.message-actions {
    margin-top: 8px;
    display: flex;
    gap: 6px;
    opacity: 0;
    transition: opacity 0.16s ease;
}

.message-row:hover .message-actions,
.message-row:focus-within .message-actions {
    opacity: 1;
}

.composer {
    border-top: 1px solid rgba(127, 127, 127, 0.22);
    padding: 12px 16px 16px;
}

.draft-attachments {
    margin-bottom: 10px;
}

.composer-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
}

.tool-switch-group {
    display: flex;
    align-items: center;
    gap: 12px;
}

.tool-switch {
    margin-top: 0;
    padding-top: 0;
    flex: 0 0 auto;
    width: auto;
}

.tool-switch-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.875rem;
    white-space: nowrap;
}

.tool-switch-label {
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    line-height: 1;
    padding: 0;
}

.tool-switch >>> .v-input__slot {
    margin-bottom: 0;
}

.hidden-file-input {
    display: none;
}

@media (max-width: 960px) {
    .ai-chat-page {
        height: auto;
        min-height: calc(100vh - 56px);
    }

    .ai-chat-shell {
        display: block;
    }

    .chat-sidebar {
        border-right: 0;
        border-bottom: 1px solid rgba(127, 127, 127, 0.22);
        max-height: 260px;
    }

    .chat-main {
        min-height: calc(100vh - 316px);
    }
}
</style>
