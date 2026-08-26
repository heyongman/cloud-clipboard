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
                        class="mr-3 flex-grow-0"
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
                            <template v-if="downloading && downloadedSize">
                                {{downloadedSize | prettyFileSize}} / {{meta.size | prettyFileSize}}
                            </template>
                            <template v-else>
                                {{meta.size | prettyFileSize}}
                            </template>
                            <v-progress-linear
                                v-if="downloading && downloadedSize"
                                :value="downloadProgress * 100"
                                height="3"
                                class="mt-1"
                            ></v-progress-linear>
                        </div>
                    </div>

                    <div class="align-self-center text-no-wrap">
                        <v-tooltip bottom>
                            <template v-slot:activator="{ on }">
                                <v-btn
                                    v-on="on"
                                    icon
                                    color="grey"
                                    :loading="downloading"
                                    :disabled="downloading"
                                    @click="downloadFile"
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
                                <v-btn
                                    v-on="on"
                                    icon
                                    color="grey"
                                    @click="copyLink"
                                    :loading="sharingLoading"
                                    :disabled="sharingLoading"
                                >
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
import {
    DEFAULT_DOWNLOAD_CONFIG,
    downloadRangesToFile,
    normalizeDownloadConfig,
} from '@/utils/file-download.mjs';

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
            sharingLoading: false,
            downloading: false,
            downloadedSize: 0,
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
        downloadProgress() {
            return this.meta.size > 0 ? Math.min(this.downloadedSize / this.meta.size, 1) : 0;
        },
    },
    methods: {
        removeFromList() {
            this.$root.received = this.$root.received.filter(item => item.id !== this.meta.id);
        },

        // 构建分享内容链接，带上部署 prefix 与房间参数
        buildContentUrl(id) {
            const roomQuery = this.$root.room ? `?room=${encodeURIComponent(this.$root.room)}` : '';
            return `${location.protocol}//${location.host}${this.$root.config.prefix || ''}/content/${id}${roomQuery}`;
        },

        triggerNativeDownload(url) {
            const link = document.createElement('a');
            link.href = url;
            link.download = this.meta.name;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        },

        async downloadFile() {
            if (this.downloading) return;

            this.downloading = true;
            this.downloadedSize = 0;
            let writable = null;
            let fileHandle = null;
            let downloadUrl = null;
            let streamingAttempted = false;
            // 进度回调可能在一次 read 中触发几十次，直接赋值响应式数据会引发
            // 频繁重渲染并阻塞 fetch 管线（请求之间出现 ~100ms 间隔）。
            // 用 rAF 合并为每帧最多更新一次，结束后 flush 保证最终值准确。
            let pendingDelta = 0;
            let rafId = null;
            const flushProgress = () => {
                rafId = null;
                if (pendingDelta) {
                    this.downloadedSize = Math.max(0, this.downloadedSize + pendingDelta);
                    pendingDelta = 0;
                }
            };
            const scheduleProgress = delta => {
                pendingDelta += delta;
                if (rafId === null) {
                    rafId = requestAnimationFrame(flushProgress);
                }
            };
            try {
                const downloadConfig = normalizeDownloadConfig(
                    this.$root.config.file?.download || DEFAULT_DOWNLOAD_CONFIG,
                );

                const useStreamingDownload = this.meta.size >= downloadConfig.threshold
                    && typeof window.showSaveFilePicker === 'function';

                if (useStreamingDownload) {
                    try {
                        fileHandle = await window.showSaveFilePicker({
                            suggestedName: this.meta.name,
                        });
                    } catch (error) {
                        if (error?.name === 'AbortError' || /user aborted/i.test(error?.message)) return;
                        // Permission/security errors fall back to the browser's native download.
                        fileHandle = null;
                    }
                }

                await this.$http.post(`share/${this.meta.id}`, null, {
                    params: { room: this.$root.room },
                });

                const url = this.buildContentUrl(this.meta.id);
                downloadUrl = url;

                if (fileHandle) {
                    streamingAttempted = true;
                    writable = await fileHandle.createWritable();
                    await downloadRangesToFile({
                        url,
                        fileSize: this.meta.size,
                        chunkSize: downloadConfig.chunk,
                        concurrency: downloadConfig.concurrency,
                        writable,
                        onProgress: bytes => {
                            if (bytes > 0) scheduleProgress(bytes);
                            else if (bytes < 0) {
                                // 重试时回滚已上报的进度，立即 flush 避免显示倒退滞后
                                pendingDelta += bytes;
                                flushProgress();
                            }
                        },
                    });
                    await writable.close();
                    writable = null;
                    this.$toast('文件下载完成');
                } else {
                    this.triggerNativeDownload(url);
                }
            } catch (error) {
                // Some Android browsers expose showSaveFilePicker but do not
                // fully support writable streams or streamed range responses.
                // Keep the old browser download as a compatibility fallback.
                if (downloadUrl && (streamingAttempted || error?.fallback)) {
                    this.triggerNativeDownload(downloadUrl);
                    return;
                }
                if (error.response && error.response.data.msg) {
                    this.$toast(`File download failed: ${error.response.data.msg}`);
                } else {
                    this.$toast('File download failed');
                }
            } finally {
                if (rafId !== null) {
                    cancelAnimationFrame(rafId);
                    flushProgress();
                }
                if (writable) {
                    try {
                        await writable.abort();
                    } catch {}
                }
                this.downloading = false;
            }
        },
        async previewFile() {
            if (this.expand) {
                this.expand = false;
                return;
            } else if (this.srcPreview) {
                this.expand = true;
                return;
            }
            this.expand = true;
            if (this.isPreviewableVideo || this.isPreviewableAudio) {
                this.loadingPreview = true;
                try {
                    await this.$http.post(`share/${this.meta.id}`, null, {
                        params: { room: this.$root.room },
                    });
                    this.srcPreview = this.buildContentUrl(this.meta.id);
                } catch (error) {
                    if (error.response && error.response.data.msg) {
                        this.$toast(`Preview failed: ${error.response.data.msg}`);
                    } else {
                        this.$toast('Preview failed');
                    }
                    this.expand = false;
                } finally {
                    this.loadingPreview = false;
                }
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
                        this.$toast(`Preview failed: ${error.response.data.msg}`);
                    } else {
                        this.$toast('Preview failed');
                    }
                }).finally(() => {
                    this.loadingPreview = false;
                });
            }
        },
        async copyLink() {
            if (this.sharingLoading) return;

            this.sharingLoading = true;
            try {
                const response = await this.$http.post(`share/${this.meta.id}`, null, {
                    params: { room: this.$root.room },
                });

                const url = this.buildContentUrl(this.meta.id);
                const result = await copyToClipboard(url);

                if (result.success) {
                    const hours = Math.max(1, Math.round((response.data.result.expireTime - Date.now()) / 3600000));
                    this.$toast(`链接已复制，${hours}小时内有效`);
                } else {
                    this.$toast.error('链接已启用，但复制失败，请手动复制');
                }
            } catch (error) {
                if (error.response?.data?.msg) {
                    this.$toast.error(`分享失败：${error.response.data.msg}`);
                } else {
                    this.$toast.error('分享失败，请重试');
                }
            } finally {
                this.sharingLoading = false;
            }
        },
        deleteItem() {
            this.$http.delete(`revoke/${this.meta.id}`, {
                params: new URLSearchParams([['room', this.$root.room]]),
            }).then(() => {
                this.removeFromList();
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
