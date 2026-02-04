<template>
    <v-hover
        v-slot:default="{ hover }"
    >
        <v-card :elevation="hover ? 6 : 2" class="mb-2 transition-swing">
            <v-card-text>
                <div class="d-flex flex-row align-center">
                    <div class="flex-grow-1 mr-2" style="min-width: 0">
                        <div class="title text-truncate text--primary" @click="expand = !expand">
                            文本消息<v-icon>{{expand ? mdiChevronUp : mdiChevronDown}}</v-icon>
                        </div>
                        <div class="text-truncate" @click="expand = !expand">{{decodedContent.substring(0, 100)}}</div>
                    </div>

                    <div class="align-self-center text-no-wrap">
                        <v-tooltip bottom>
                            <template v-slot:activator="{ on }">
                                <v-btn v-on="on" icon color="grey" @click="copyText">
                                    <v-icon>{{mdiContentCopy}}</v-icon>
                                </v-btn>
                            </template>
                            <span>复制文本</span>
                        </v-tooltip>
                        <v-tooltip bottom>
                            <template v-slot:activator="{ on }">
                                <v-btn v-on="on" icon color="grey" @click="copyLink">
                                    <v-icon>{{mdiLinkVariant}}</v-icon>
                                </v-btn>
                            </template>
                            <span>复制链接</span>
                        </v-tooltip>
                        <v-tooltip bottom>
                            <template v-slot:activator="{ on }">
                                <v-btn v-on="on" icon color="grey" @click="deleteItem">
                                    <v-icon>{{mdiClose}}</v-icon>
                                </v-btn>
                            </template>
                            <span>删除</span>
                        </v-tooltip>
                    </div>
                </div>
                <v-expand-transition>
                    <div v-show="expand">
                        <v-divider class="my-2"></v-divider>

                        <!-- 查看模式：原始格式展示 -->
                        <div v-if="!isEditing"
                             class="text-content"
                             style="white-space: pre-wrap; word-break: break-word; font-family: inherit;"
                        >{{decodedContent}}</div>

                        <!-- 编辑模式 -->
                        <v-textarea
                            v-else
                            v-model="editContent"
                            outlined
                            auto-grow
                            :counter="$root.config.text.limit"
                            :rules="[v => v.length <= $root.config.text.limit || `文本长度不能超过 ${$root.config.text.limit} 字`]"
                        ></v-textarea>

                        <!-- 操作按钮 -->
                        <div class="mt-2">
                            <template v-if="!isEditing">
                                <v-btn small text color="primary" @click="startEdit">
                                    <v-icon small left>{{mdiPencil}}</v-icon>编辑
                                </v-btn>
                            </template>
                            <template v-else>
                                <v-btn small color="primary" @click="saveEdit" :loading="saving" :disabled="editContent.length > $root.config.text.limit">
                                    <v-icon small left>{{mdiContentSave}}</v-icon>保存
                                </v-btn>
                                <v-btn small text @click="cancelEdit">取消</v-btn>
                            </template>
                        </div>
                    </div>
                </v-expand-transition>
            </v-card-text>
        </v-card>
    </v-hover>
</template>

<script>
import {
    mdiChevronUp,
    mdiChevronDown,
    mdiContentCopy,
    mdiClose,
    mdiLinkVariant,
    mdiPencil,
    mdiContentSave,
} from '@mdi/js';
import { copyToClipboard } from '@/util.js';

const dp = new DOMParser;

export default {
    name: 'received-text',
    props: {
        meta: {
            type: Object,
            default() {
                return {};
            },
        },
    },
    data() {
        return {
            expand: false,
            isEditing: false,
            editContent: '',
            saving: false,
            mdiChevronUp,
            mdiChevronDown,
            mdiContentCopy,
            mdiClose,
            mdiLinkVariant,
            mdiPencil,
            mdiContentSave,
        };
    },
    computed: {
        // 解码 HTML 实体，获取原始文本
        decodedContent() {
            return dp.parseFromString(this.meta.content, 'text/html').documentElement.textContent;
        },
    },
    methods: {
        async copyText() {
            const result = await copyToClipboard(this.decodedContent);
            if (result.success) {
                this.$toast('复制成功');
            } else {
                this.$toast.error('复制失败');
            }
        },
        async copyLink() {
            const url = `${location.protocol}//${location.host}/content/${this.meta.id}${this.$root.room ? `?room=${this.$root.room}` : ''}`;
            const result = await copyToClipboard(url);
            if (result.success) {
                this.$toast('复制成功');
            } else {
                this.$toast.error('复制失败，请手动复制链接');
            }
        },
        deleteItem() {
            this.$http.delete(`revoke/${this.meta.id}`, {
                params: new URLSearchParams([['room', this.$root.room]]),
            }).then(() => {
                this.$toast('已删除文本消息');
            }).catch(error => {
                if (error.response && error.response.data.msg) {
                    this.$toast(`消息删除失败：${error.response.data.msg}`);
                } else {
                    this.$toast('消息删除失败');
                }
            });
        },
        startEdit() {
            this.editContent = this.decodedContent;
            this.isEditing = true;
        },
        cancelEdit() {
            this.isEditing = false;
            this.editContent = '';
        },
        async saveEdit() {
            if (this.editContent.length > this.$root.config.text.limit) {
                this.$toast.error(`文本长度不能超过 ${this.$root.config.text.limit} 字`);
                return;
            }
            this.saving = true;
            try {
                await this.$http.put(`text/${this.meta.id}`, this.editContent, {
                    params: { room: this.$root.room },
                    headers: { 'Content-Type': 'text/plain' },
                });
                // 更新本地数据（HTML 转义）
                this.meta.content = this.editContent
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
                this.isEditing = false;
                this.$toast('保存成功');
            } catch (error) {
                if (error.response && error.response.data.msg) {
                    this.$toast.error(`保存失败：${error.response.data.msg}`);
                } else {
                    this.$toast.error('保存失败');
                }
            } finally {
                this.saving = false;
            }
        },
    },
}
</script>
