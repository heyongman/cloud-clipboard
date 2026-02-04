<template>
    <v-hover
        v-slot:default="{ hover }"
    >
        <v-card :elevation="hover ? 6 : 2" class="mb-2 transition-swing">
            <v-card-text>
                <div class="d-flex flex-row align-center">
                    <v-img
                        v-if="meta.thumbnail"
                        :src="meta.thumbnail"
                        class="mr-3 flex-grow-0 hidden-sm-and-down"
                        width="2.5rem"
                        height="2.5rem"
                        style="border-radius: 3px"
                    ></v-img>
                    <div class="flex-grow-1 mr-2" style="min-width: 0">
                        <div
                            class="title text-truncate text--primary"
                            :title="meta.name"
                        >{{meta.name}}</div>
                        <div class="caption">
                            {{meta.size | prettyFileSize}}
                        </div>
                    </div>

                    <div class="align-self-center text-no-wrap">
                        <v-tooltip bottom>
                            <template v-slot:activator="{ on }">
                                <v-btn
                                    v-on="on"
                                    icon
                                    color="grey"
                                    :href="`file/${meta.cache}/${encodeURIComponent(meta.name)}`"
                                    :download="meta.name"
                                >
                                    <v-icon>{{mdiDownload}}</v-icon>
                                </v-btn>
                            </template>
                            <span>下载</span>
                        </v-tooltip>
                        <template v-if="meta.thumbnail || isPreviewableVideo || isPreviewableAudio">
                            <v-progress-circular
                                v-if="loadingPreview"
                                indeterminate
                                color="grey"
                            >{{loadedPreview / meta.size | percentage(0)}}</v-progress-circular>
                            <v-tooltip bottom>
                                <template v-slot:activator="{ on }">
                                    <v-btn v-on="on" icon color="grey" @click="previewFile()">
                                        <v-icon>{{(isPreviewableVideo || isPreviewableAudio) ? mdiMovieSearchOutline : mdiImageSearchOutline}}</v-icon>
                                    </v-btn>
                                </template>
                                <span>预览</span>
                            </v-tooltip>
                        </template>
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
                                <v-btn v-on="on" icon color="grey" @click="deleteItem" :disabled="loadingPreview">
                                    <v-icon>{{mdiClose}}</v-icon>
                                </v-btn>
                            </template>
                            <span>删除</span>
                        </v-tooltip>
                    </div>
                </div>
                <v-expand-transition v-if="meta.thumbnail || isPreviewableVideo || isPreviewableAudio">
                    <div v-show="expand">
                        <v-divider class="my-2"></v-divider>
                        <video
                            v-if="isPreviewableVideo"
                            :src="srcPreview"
                            style="max-height:480px;max-width:100%;"
                            class="rounded d-block mx-auto"
                            controls
                            preload="metadata"
                        ></video>
                        <audio
                            v-else-if="isPreviewableAudio"
                            :src="srcPreview"
                            style="width:100%"
                            class="rounded d-block mx-auto"
                            controls
                            preload="metadata"
                        ></audio>
                        <img
                            v-else
                            :src="srcPreview"
                            style="max-height:480px;max-width:100%;"
                            class="rounded d-block mx-auto"
                        >
                    </div>
                </v-expand-transition>
            </v-card-text>
        </v-card>
    </v-hover>
</template>

<script>
import {
    mdiContentCopy,
    mdiDownload,
    mdiClose,
    mdiImageSearchOutline,
    mdiLinkVariant,
    mdiMovieSearchOutline,
} from '@mdi/js';
import { copyToClipboard } from '@/util.js';

export default {
    name: 'received-file',
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
            loadingPreview: false,
            loadedPreview: 0,
            expand: false,
            srcPreview: null,
            mdiContentCopy,
            mdiDownload,
            mdiClose,
            mdiImageSearchOutline,
            mdiLinkVariant,
            mdiMovieSearchOutline,
        };
    },
    computed: {
        isPreviewableVideo() {
            return this.meta.name.match(/\.(mp4|webm|ogv)$/gi);
        },
        isPreviewableAudio() {
            return this.meta.name.match(/\.(wav|ogg|opus|m4a|flac)$/gi);
        },
    },
    methods: {
        previewFile() {
            if (this.expand) {
                this.expand = false;
                return;
            } else if (this.srcPreview) {
                this.expand = true;
                return;
            }
            this.expand = true;
            if (this.isPreviewableVideo || this.isPreviewableAudio) {
                this.srcPreview = `file/${this.meta.cache}/${encodeURIComponent(this.meta.name)}`;
            } else {
                this.loadingPreview = true;
                this.loadedPreview = 0;
                this.$http.get(`file/${this.meta.cache}/${encodeURIComponent(this.meta.name)}`, {
                    responseType: 'arraybuffer',
                    onDownloadProgress: e => {this.loadedPreview = e.loaded},
                }).then(response => {
                    this.srcPreview = URL.createObjectURL(new Blob([response.data]));
                }).catch(error => {
                    if (error.response && error.response.data.msg) {
                        this.$toast(`文件获取失败：${error.response.data.msg}`);
                    } else {
                        this.$toast('文件获取失败');
                    }
                }).finally(() => {
                    this.loadingPreview = false;
                });
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
                this.$http.delete(`file/${this.meta.cache}`).then(() => {
                    this.$toast(`已删除文件 ${this.meta.name}`);
                }).catch(error => {
                    if (error.response && error.response.data.msg) {
                        this.$toast(`文件删除失败：${error.response.data.msg}`);
                    } else {
                        this.$toast('文件删除失败');
                    }
                });
            }).catch(error => {
                if (error.response && error.response.data.msg) {
                    this.$toast(`消息删除失败：${error.response.data.msg}`);
                } else {
                    this.$toast('消息删除失败');
                }
            });
        },
    },
}
</script>