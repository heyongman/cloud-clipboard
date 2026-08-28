<template>
    <div>
        <div class="headline text--primary mb-4">发送文件</div>
        <v-card
            outlined
            class="pa-3 mb-6 d-flex flex-row align-center"
            @dragenter="$event.preventDefault()"
            @dragover="$event.preventDefault()"
            @dragleave="$event.preventDefault()"
            @drop="$event.preventDefault(); handleSelectFiles(Array.from($event.dataTransfer.files))"
        >
            <template v-if="$root.send.files.length">
                <template v-if="progress">
                    <div class="flex-grow-1">
                        <small class="d-block text-right text--secondary">
                            {{Math.min(uploadedSize, fileSize) | prettyFileSize}} / {{fileSize | prettyFileSize}} ({{uploadProgress | percentage}})
                        </small>
                        <v-progress-linear :value="uploadProgress * 100"></v-progress-linear>
                    </div>
                </template>
                <template v-else>
                    <v-img
                        v-if="isUploadingImage"
                        :src="imagePreview"
                        class="mr-3 flex-grow-0"
                        width="2.5rem"
                        height="2.5rem"
                        style="border-radius: 3px"
                    ></v-img>
                    <div class="flex-grow-1 mr-2" style="min-width: 0">
                        <div
                            class="text-truncate"
                            :title="$root.send.files[0].name + ' ' + ($root.send.files.length > 1 ? `等 ${$root.send.files.length} 个文件` : '')"
                        >{{$root.send.files[0].name}} {{$root.send.files.length > 1 ? `等 ${$root.send.files.length} 个文件` : ''}}
                        </div>
                        <div class="caption">{{fileSize | prettyFileSize}}</div>
                    </div>
                    <div class="align-self-center">
                        <v-btn icon color="grey" @click="$root.send.files.splice(0)">
                            <v-icon>{{mdiClose}}</v-icon>
                        </v-btn>
                    </div>
                </template>
            </template>
            <template v-else>
                <v-btn
                    text
                    color="primary"
                    large
                    class="d-block mx-auto"
                    @click="focus"
                >
                    <div title="支持拖拽和 Ctrl+V 粘贴截图">
                        选择要发送的文件<span class="d-none d-xl-inline">（支持拖拽和 Ctrl+V 粘贴截图）</span>
                        <br>
                        <small class="text--secondary">文件大小限制：{{$root.config.file.limit | prettyFileSize}}</small>
                    </div>
                </v-btn>
                <input
                    ref="selectFile"
                    type="file"
                    class="d-none"
                    multiple
                    @change="handleSelectFiles(Array.from($event.target.files))"
                >
            </template>
        </v-card>
        <div class="text-right">
            <v-btn
                color="primary"
                :block="$vuetify.breakpoint.smAndDown"
                :disabled="!$root.send.files.length || !$root.connected || progress"
                @click="send"
            >发送</v-btn>
        </div>
    </div>
</template>

<script>
import {
    prettyFileSize,
}from '@/util.js';
import {
    mdiClose,
} from '@mdi/js';
import {
    chooseUploadParameters,
    createAdaptiveUploadPool,
    isAbortError,
    isRetryableUploadError,
    normalizeUploadConfig,
    waitForRetry,
} from '@/utils/file-upload.mjs';

export default {
    name: 'send-file',
    data() {
        return {
            progress: false,
            uploadedSizes: [],
            imagePreview: '',
            uploadController: null,
            mdiClose,
        };
    },
    computed: {
        fileSize() {
            return this.$root.send.files.length ? this.$root.send.files.reduce((acc, cur) => acc += cur.size, 0) : 0;
        },
        uploadedSize() {
            return this.uploadedSizes.length ? this.uploadedSizes.reduce((acc, cur) => acc += cur, 0) : 0;
        },
        uploadProgress() {
            return Math.min(this.fileSize !== 0 ? (this.uploadedSize / this.fileSize) : 0, 1);
        },
        isUploadingImage() {
            return this.$root.send.files.length && this.$root.send.files[0].type.startsWith('image/');
        },
    },
    methods: {
        focus() {
            this.$refs.selectFile.click();
        },
        /**
         * @param {File[]} files
         */
        handleSelectFiles(files) {
            if (files.some(e => !e.size)) {
                this.$toast('不能发送空文件');
            } else if (files.some(e => e.size > this.$root.config.file.limit)) {
                this.$toast(`文件大小超过限制（${prettyFileSize(this.$root.config.file.limit)}）`);
            } else {
                this.$root.send.files.splice(0);
                this.$root.send.files.push(...files);
                if (this.isUploadingImage) {
                    URL.revokeObjectURL(this.imagePreview);
                    this.imagePreview = URL.createObjectURL(files[0]);
                }
            }
        },
      async send() {
        this.progress = true;
        const uploadConfig = normalizeUploadConfig(this.$root.config.file);
        const batchParameters = chooseUploadParameters(
          this.$root.send.files.reduce((largest, file) => Math.max(largest, file.size), 0),
          uploadConfig,
        );
        const controller = new AbortController();
        const pool = createAdaptiveUploadPool({
          initialConcurrency: batchParameters.initialConcurrency,
          maxConcurrency: batchParameters.maxConcurrency,
          adaptive: uploadConfig.adaptive,
          signal: controller.signal,
        });
        this.uploadController = controller;
        let rafId = null;
        const pendingProgress = Array(this.$root.send.files.length).fill(0);
        const flushProgress = () => {
          rafId = null;
          pendingProgress.forEach((delta, index) => {
            if (!delta) return;
            pendingProgress[index] = 0;
            this.$set(this.uploadedSizes, index, Math.max(0, this.uploadedSizes[index] + delta));
          });
        };
        const reportProgress = (fileIndex, delta, immediate = false) => {
          pendingProgress[fileIndex] += delta;
          if (immediate) {
            if (rafId !== null) cancelAnimationFrame(rafId);
            flushProgress();
          } else if (rafId === null) {
            rafId = requestAnimationFrame(flushProgress);
          }
        };
        try {
          this.uploadedSizes.splice(0);
          this.uploadedSizes.push(...Array(this.$root.send.files.length).fill(0));

          await Promise.all(this.$root.send.files.map((file, i) => this.uploadFile(
            file,
            i,
            {uploadConfig, pool, signal: controller.signal, reportProgress},
          )));

          this.$toast('所有文件发送成功');
          this.$root.send.files.splice(0);
          this.$root.refresh();
        } catch (error) {
          controller.abort(error);
          console.error("上传失败:", error);
          if (isAbortError(error)) return;
          if (error.response && error.response.data.msg) {
            this.$toast(`发送失败：${error.response.data.msg}`);
          } else {
            this.$toast(`发送失败: ${error.message || '未知错误'}`);
          }
        } finally {
          if (rafId !== null) cancelAnimationFrame(rafId);
          flushProgress();
          pool.dispose();
          if (this.uploadController === controller) this.uploadController = null;
          this.progress = false;
        }
      },

      async uploadFile(file, fileIndex, context) {
        const {uploadConfig, pool, signal, reportProgress} = context;
        const parameters = chooseUploadParameters(file.size, uploadConfig);

        // 对于小文件，直接上传
        if (file.size < uploadConfig.minChunk) {
          const fd = new FormData();
          fd.set('file', file);
          let reported = 0;
          return pool.run(() => this.$http.postForm('upload', fd, {
              params: new URLSearchParams([['room', this.$root.room]]),
              signal,
              onUploadProgress: e => {
                const loaded = Math.min(e.loaded, file.size);
                const delta = loaded - reported;
                if (delta > 0) {
                  reported = loaded;
                  reportProgress(fileIndex, delta);
                }
              },
            }), {adjust: false})
            .then(result => {
              const tail = file.size - reported;
              if (tail) reportProgress(fileIndex, tail);
              return result;
            })
            .catch(error => {
              if (reported) reportProgress(fileIndex, -reported, true);
              throw error;
            });
        }

        // --- 大文件分片上传逻辑 ---

        // 1. 请求创建上传任务，获取 uuid
        const response = await pool.run(() => this.$http.post('upload/chunk', {
            filename: file.name,
            size: file.size,
            chunkSize: parameters.chunkSize,
        }, {signal}), {adjust: false});
        const { uuid, chunkSize = parameters.chunkSize } = response.data.result;
        let finished = false;
        try {
          // 2. 每个文件只创建少量 worker，分片在执行时才 slice，避免大文件
          // 提前创建数千个任务；所有文件共同使用同一个自适应并发池。
          const chunksCount = Math.ceil(file.size / chunkSize);
          let nextChunkIndex = 0;
          const uploadChunk = async i => {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const chunk = file.slice(start, end);
            let lastError;
            let reported = 0;
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                await pool.run(() => this.$http.post(`upload/chunk/${uuid}/${i}`, chunk, {
                    headers: {
                      'Content-Type': 'application/octet-stream',
                    },
                    signal,
                    onUploadProgress: e => {
                      const delta = e.loaded - reported;
                      if (delta > 0) {
                        reported = e.loaded;
                        reportProgress(fileIndex, delta);
                      }
                    },
                  }));
                const tail = chunk.size - reported;
                if (tail) {
                  reported = chunk.size;
                  reportProgress(fileIndex, tail);
                }
                return;
              } catch (error) {
                lastError = error;
                if (reported) {
                  reportProgress(fileIndex, -reported, true);
                  reported = 0;
                }
                if (attempt === 2 || !isRetryableUploadError(error)) break;
                await waitForRetry(250 * 2 ** attempt, signal);
              }
            }
            if (isAbortError(lastError)) throw lastError;
            const uploadError = new Error(`分片 ${i} 上传失败: ${lastError?.message || '网络错误'}`);
            uploadError.cause = lastError;
            throw uploadError;
          };
          const worker = async () => {
            while (!signal.aborted) {
              const chunkIndex = nextChunkIndex++;
              if (chunkIndex >= chunksCount) return;
              await uploadChunk(chunkIndex);
            }
          };
          await Promise.all(Array(Math.min(parameters.maxConcurrency, chunksCount))
            .fill(null)
            .map(worker));

          // 3. 通知后端所有分片已上传完毕
          await pool.run(() => this.$http.post(`upload/finish/${uuid}`, null, {
              params: new URLSearchParams([['room', this.$root.room]]),
              signal,
            }), {adjust: false});
          finished = true;
        } finally {
          if (!finished) {
            try {
              await this.$http.delete(`upload/chunk/${uuid}`);
            } catch {}
          }
        }
      }
    },
    mounted() {
        document.onpaste = e => {
            if (!(e && e.clipboardData)) return;
            console.log(e.clipboardData);
            const items = Array.from(e.clipboardData.items);
            if (!(items.length && items.every(e => e.kind === 'file'))) return;
            this.handleSelectFiles(items.map(e => e.getAsFile()));
        };
    },
    beforeDestroy() {
        this.uploadController?.abort();
        document.onpaste = null;
        URL.revokeObjectURL(this.imagePreview);
    },
}
</script>
