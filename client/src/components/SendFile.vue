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
                :disabled="!$root.send.files.length || !$root.websocket || progress"
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

export default {
    name: 'send-file',
    data() {
        return {
            progress: false,
            uploadedSizes: [],
            imagePreview: '',
            uploading: false,
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
        try {
          this.uploadedSizes.splice(0);
          this.uploadedSizes.push(...Array(this.$root.send.files.length).fill(0));

          // 对每个文件执行上传逻辑
          await Promise.all(this.$root.send.files.map((file, i) => this.uploadFile(file, i)));

          this.$toast('所有文件发送成功');
          this.$root.send.files.splice(0);
        } catch (error) {
          console.error("上传失败:", error);
          if (error.response && error.response.data.msg) {
            this.$toast(`发送失败：${error.response.data.msg}`);
          } else {
            this.$toast(`发送失败: ${error.message || '未知错误'}`);
          }
        } finally {
          this.progress = false;
        }
      },

      async uploadFile(file, fileIndex) {
        const chunkSize = this.$root.config.file.chunk; // 假设从全局配置获取

        // 对于小文件，直接上传
        if (file.size < chunkSize) {
          const fd = new FormData();
          fd.set('file', file);
          return this.$http.postForm('upload', fd, {
            params: new URLSearchParams([['room', this.$root.room]]),
            onUploadProgress: e => this.$set(this.uploadedSizes, fileIndex, e.loaded),
          });
        }

        // --- 大文件分片上传逻辑 ---

        // 1. 请求创建上传任务，获取 uuid
        const response = await this.$http.post('upload/chunk', {
          filename: file.name,
          size: file.size
        });
        const { uuid } = response.data.result;

        // 2. 创建所有分片的上传任务
        const chunksCount = Math.ceil(file.size / chunkSize);
        const uploadPromises = [];
        let uploadedSize = 0;

        for (let i = 0; i < chunksCount; i++) {
          const start = i * chunkSize;
          const end = Math.min(start + chunkSize, file.size);
          const chunk = file.slice(start, end);

          // 创建一个 promise 函数，以便并发池调用
          const task = () => this.$http.post(`upload/chunk/${uuid}/${i}`, chunk, {
            headers: { 'Content-Type': 'application/octet-stream' },
            onUploadProgress: e => {
              // 这个进度是单个分片的，需要转换成总进度
              // 注意：由于并行，这里需要更复杂的进度计算
              // 一个简单的方式是上传成功后再加上分片大小
            },
          }).then(() => {
            // 更新已上传的总大小
            // 使用 this.$set 保证视图更新
            const currentTotal = this.uploadedSizes[fileIndex] + chunk.size;
            this.$set(this.uploadedSizes, fileIndex, currentTotal);
          });

          uploadPromises.push(task);
        }

        // 3. 使用并发池执行上传任务
        await this.runInConcurrentPool(uploadPromises, 5); // 设置并发数为 5

        // 4. 通知后端所有分片已上传完毕
        await this.$http.post(`upload/finish/${uuid}`, null, {
          params: new URLSearchParams([['room', this.$root.room]]),
        });
      },

      /**
       * 并发池执行器
       * @param {Array<Function>} tasks - 一个返回 Promise 的函数数组
       * @param {Number} concurrency - 并发数量
       */
      async runInConcurrentPool(tasks, concurrency) {
        const results = [];
        let currentIndex = 0;

        // 执行器，从任务数组中取一个任务并执行
        const run = async () => {
          while (currentIndex < tasks.length) {
            const taskIndex = currentIndex++;
            const task = tasks[taskIndex];
            try {
              results[taskIndex] = await task();
            } catch (error) {
              // 如果一个分片失败，则抛出错误，中断整个上传
              throw new Error(`分片 ${taskIndex} 上传失败: ${error.message}`);
            }
          }
        };

        // 创建并发的 workers
        const workers = Array(concurrency).fill(null).map(() => run());
        await Promise.all(workers);
        return results;
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
}
</script>