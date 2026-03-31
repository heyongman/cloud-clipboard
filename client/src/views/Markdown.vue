<template>
    <v-container fluid class="markdown-page pa-4 pa-md-6">
        <v-row>
            <v-col cols="12" md="5">
                <v-card outlined class="fill-height">
                    <v-card-title class="d-flex flex-wrap align-center">
                        <span class="text-h6">Markdown 编辑</span>
                        <v-spacer></v-spacer>
                        <v-btn small text color="primary" @click="resetSample">
                            重置示例
                        </v-btn>
                    </v-card-title>
                    <v-card-text>
                        <v-textarea
                            v-model="markdownText"
                            outlined
                            auto-grow
                            rows="18"
                            row-height="22"
                            spellcheck="false"
                            class="markdown-editor"
                            label="输入 Markdown"
                            :loading="loadingParser"
                            :disabled="loadingParser && !parserReady"
                        ></v-textarea>
                    </v-card-text>
                </v-card>
            </v-col>

            <v-col cols="12" md="7">
                <v-card outlined>
                    <v-card-title class="d-flex flex-wrap align-center">
                        <span class="text-h6">长图预览</span>
                        <v-spacer></v-spacer>
                        <v-chip small outlined color="primary" class="mr-3">
                            宽度 {{ previewWidth }}px
                        </v-chip>
                        <v-select
                            v-model="previewMode"
                            :items="previewModes"
                            item-text="text"
                            item-value="value"
                            dense
                            outlined
                            hide-details
                            class="markdown-mode-select mr-3"
                            label="版式"
                        ></v-select>
                        <v-btn
                            color="primary"
                            :loading="exportingImage"
                            :disabled="loadingParser || !parserReady || exportingImage"
                            @click="exportImage"
                        >
                            导出图片
                        </v-btn>
                    </v-card-title>

                    <v-card-text>
                        <v-alert
                            v-if="loadError"
                            type="error"
                            dense
                            text
                            class="mb-4"
                        >
                            Markdown 解析库加载失败，请刷新后重试。
                        </v-alert>

                        <div
                            ref="previewHost"
                            class="markdown-preview-host"
                        >
                            <div
                                class="markdown-preview-frame"
                                :style="previewFrameStyle"
                            >
                                <div
                                    ref="exportSurface"
                                    class="markdown-export-surface"
                                    :style="{ width: previewWidth + 'px' }"
                                >
                                    <div
                                        v-if="parserReady"
                                        class="markdown-preview-body"
                                        v-html="renderedHtml"
                                    ></div>
                                    <div v-else class="markdown-preview-loading">
                                        <v-progress-circular indeterminate color="primary" size="28"></v-progress-circular>
                                        <span class="ml-3">正在加载 Markdown 解析器...</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="caption text--secondary mt-4">
                            导出为整篇 PNG 长图。远程跨域图片可能因浏览器安全限制导致导出失败，优先使用同源或本地图片。
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>
    </v-container>
</template>

<script>
import {
    getPreviewWidth,
    getPreviewFrameLayout,
    getExportMountStyle,
    getExportPixelRatio,
    getExportNodeStyle,
    createExportFileName,
} from '@/utils/markdown-export.mjs';

const DEFAULT_MARKDOWN = `# Markdown 长图

这是一个用于导出长图的在线编辑页面。

## 功能特点

- 实时预览 Markdown
- 支持当前设备、移动端、PC 端版式
- 一键导出整篇 PNG 长图

> 适合写公告、说明、活动海报文案和临时笔记。

\`\`\`js
function exportAsImage(mode) {
  return \`ready: \${mode}\`;
}
\`\`\`

访问项目主页：[Cloud Clipboard](#/)
`;

export default {
    data() {
        return {
            markdownText: DEFAULT_MARKDOWN,
            renderedHtml: '',
            previewMode: 'current',
            previewModes: [
                { text: '当前设备', value: 'current' },
                { text: '移动端', value: 'mobile' },
                { text: 'PC 端', value: 'desktop' },
            ],
            previewHostWidth: 0,
            markdownParser: null,
            renderTimer: null,
            loadingParser: true,
            parserReady: false,
            loadError: false,
            exportingImage: false,
            htmlToImage: null,
        };
    },
    computed: {
        previewWidth() {
            const width = this.previewHostWidth > 0
                ? this.previewHostWidth
                : (this.$vuetify.breakpoint.mdAndUp ? 720 : window.innerWidth - 56);

            return getPreviewWidth(this.previewMode, width);
        },
        previewFrameStyle() {
            const { frameWidth, justifyContent } = getPreviewFrameLayout(
                this.previewWidth,
                this.previewHostWidth || this.previewWidth,
            );

            return {
                width: `${frameWidth}px`,
                justifyContent,
            };
        },
    },
    watch: {
        markdownText() {
            this.scheduleRender();
        },
    },
    mounted() {
        this.measurePreviewHost();
        this.initParser();
        window.addEventListener('resize', this.handleResize, { passive: true });
    },
    beforeDestroy() {
        window.removeEventListener('resize', this.handleResize);
        clearTimeout(this.renderTimer);
    },
    methods: {
        async initParser() {
            this.loadingParser = true;
            this.loadError = false;

            try {
                const module = await import(
                    /* webpackChunkName: "markdown-parser" */
                    'markdown-it'
                );
                const MarkdownIt = module.default || module;
                this.markdownParser = new MarkdownIt({
                    html: false,
                    breaks: true,
                    linkify: true,
                    typographer: true,
                });
                this.parserReady = true;
                this.renderMarkdown();
            } catch (error) {
                console.error(error);
                this.loadError = true;
                this.$toast.error('Markdown 解析器加载失败');
            } finally {
                this.loadingParser = false;
            }
        },
        scheduleRender() {
            clearTimeout(this.renderTimer);
            this.renderTimer = setTimeout(() => {
                this.renderMarkdown();
            }, 120);
        },
        renderMarkdown() {
            if (!this.markdownParser) {
                return;
            }

            try {
                this.renderedHtml = this.markdownParser.render(this.markdownText || '');
            } catch (error) {
                console.error(error);
                this.renderedHtml = '<p>Markdown 渲染失败。</p>';
                this.$toast.error('Markdown 渲染失败');
            }
        },
        handleResize() {
            this.measurePreviewHost();
        },
        measurePreviewHost() {
            this.$nextTick(() => {
                const host = this.$refs.previewHost;
                if (!host) {
                    return;
                }

                const hostWidth = host.clientWidth - 24;
                this.previewHostWidth = hostWidth > 0 ? hostWidth : 320;
            });
        },
        resetSample() {
            this.markdownText = DEFAULT_MARKDOWN;
        },
        async loadHtmlToImage() {
            if (this.htmlToImage) {
                return this.htmlToImage;
            }

            const module = await import(
                /* webpackChunkName: "markdown-exporter" */
                'html-to-image'
            );
            this.htmlToImage = module;
            return module;
        },
        async exportImage() {
            if (this.exportingImage) {
                return;
            }

            const target = this.$refs.exportSurface;
            if (!target) {
                this.$toast.error('预览区域尚未准备好');
                return;
            }

            this.exportingImage = true;
            const exportWidth = this.previewWidth;
            let exportNode = null;
            let exportMount = null;

            try {
                const htmlToImage = await this.loadHtmlToImage();
                exportMount = document.createElement('div');
                Object.assign(exportMount.style, getExportMountStyle());
                exportNode = target.cloneNode(true);
                Object.assign(exportNode.style, getExportNodeStyle(exportWidth));
                exportMount.appendChild(exportNode);
                document.body.appendChild(exportMount);

                const dataUrl = await htmlToImage.toPng(exportNode, {
                    backgroundColor: '#ffffff',
                    cacheBust: true,
                    pixelRatio: getExportPixelRatio(window.devicePixelRatio),
                    width: exportWidth,
                    canvasWidth: exportWidth,
                    style: {
                        ...getExportNodeStyle(exportWidth),
                    },
                });

                const link = document.createElement('a');
                link.download = createExportFileName(this.previewMode);
                link.href = dataUrl;
                link.click();
            } catch (error) {
                console.error(error);
                this.$toast.error('导出图片失败');
            } finally {
                if (exportMount && exportMount.parentNode) {
                    exportMount.parentNode.removeChild(exportMount);
                }
                this.exportingImage = false;
            }
        },
    },
};
</script>

<style scoped>
.markdown-page {
    min-height: 100%;
}

.markdown-editor >>> textarea {
    font-family: Consolas, Monaco, monospace;
    line-height: 1.65;
}

.markdown-mode-select {
    width: 150px;
    max-width: 100%;
}

.markdown-preview-host {
    overflow-x: auto;
    padding-bottom: 8px;
}

.markdown-preview-frame {
    display: flex;
    min-width: 100%;
}

.markdown-export-surface {
    flex: 0 0 auto;
    background: #ffffff;
    color: #1f2937;
    border: 1px solid rgba(15, 23, 42, 0.08);
    border-radius: 16px;
    box-shadow: 0 14px 40px rgba(15, 23, 42, 0.08);
}

.markdown-preview-loading {
    min-height: 240px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
    color: #475569;
}

.markdown-preview-body {
    padding: 40px 32px 48px;
    line-height: 1.8;
    font-size: 16px;
    word-break: break-word;
}

.markdown-preview-body >>> h1,
.markdown-preview-body >>> h2,
.markdown-preview-body >>> h3,
.markdown-preview-body >>> h4,
.markdown-preview-body >>> h5,
.markdown-preview-body >>> h6 {
    margin-top: 1.6em;
    margin-bottom: 0.75em;
    line-height: 1.3;
    color: #0f172a;
}

.markdown-preview-body >>> h1 {
    margin-top: 0;
    font-size: 2rem;
}

.markdown-preview-body >>> h2 {
    font-size: 1.55rem;
}

.markdown-preview-body >>> h3 {
    font-size: 1.25rem;
}

.markdown-preview-body >>> p,
.markdown-preview-body >>> ul,
.markdown-preview-body >>> ol,
.markdown-preview-body >>> blockquote,
.markdown-preview-body >>> pre {
    margin-top: 0;
    margin-bottom: 1em;
}

.markdown-preview-body >>> ul,
.markdown-preview-body >>> ol {
    padding-left: 1.5em;
}

.markdown-preview-body >>> a {
    color: #1565c0;
}

.markdown-preview-body >>> blockquote {
    padding: 12px 16px;
    border-left: 4px solid #42a5f5;
    background: #f8fafc;
    color: #334155;
}

.markdown-preview-body >>> code {
    padding: 0.15em 0.4em;
    border-radius: 6px;
    background: #eef2ff;
    color: #1e3a8a;
    font-family: Consolas, Monaco, monospace;
    font-size: 0.9em;
}

.markdown-preview-body >>> pre {
    overflow-x: auto;
    padding: 16px 18px;
    border-radius: 12px;
    background: #0f172a;
    color: #e2e8f0;
}

.markdown-preview-body >>> pre code {
    padding: 0;
    background: transparent;
    color: inherit;
}

.markdown-preview-body >>> hr {
    margin: 2em 0;
    border: 0;
    border-top: 1px solid #dbe4ee;
}

.markdown-preview-body >>> img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 1em auto;
    border-radius: 12px;
}

@media (max-width: 960px) {
    .markdown-preview-body {
        padding: 28px 20px 36px;
    }

    .markdown-mode-select {
        width: 100%;
        margin-top: 12px;
        margin-right: 0 !important;
    }
}
</style>
