<template>
  <v-container>
    <!-- 上传区域 -->
    <v-card
        class="upload-area mb-6"
        outlined
        :class="{ 'dragover': isDragging }"
        @paste="handlePaste"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="handleDrop"
    >
      <input
          type="file"
          ref="fileInput"
          multiple
          accept="image/*"
          style="display: none"
          @change="handleFileChange"
      >
      <v-card-text
          class="text-center pa-12"
          style="cursor: pointer"
          @click="triggerFileInput"
      >
        <v-icon size="64" color="primary">mdi-cloud-upload</v-icon>
        <div class="text-h6 mt-4">
          点击上传或拖拽图片到此处
        </div>
        <div class="text-subtitle-1 text-medium-emphasis">
          支持Ctrl + V粘贴
        </div>
      </v-card-text>
    </v-card>

    <!-- 处理中提示 -->
    <v-overlay :value="isProcessing">
      <v-progress-circular
          indeterminate
          size="64"
          color="primary"
      ></v-progress-circular>
    </v-overlay>

    <!-- 结果展示区域 -->
    <template v-if="ocrResults.length">
      <v-card
          v-for="(result, index) in ocrResults"
          :key="index"
          class="mb-4"
          outlined
      >
        <v-card-title class="d-flex justify-space-between">
          <span>识别结果 #{{ index + 1 }}</span>
          <v-btn
              text
              color="primary"
              @click="copyText(result.text)"
              :loading="copying === index"
          >
            <v-icon left>mdi-content-copy</v-icon>
            复制
          </v-btn>
        </v-card-title>

        <v-divider></v-divider>

        <v-card-text>
          <template v-if="result.type === 'text'">
            <pre class="result-text">{{ result.text }}</pre>
          </template>
          <template v-else-if="result.type === 'table'">
            <v-data-table
                :headers="result.tableHeader"
                :items="result.tableData"
                :items-per-page="10"
                class="elevation-1"
            ></v-data-table>
          </template>
        </v-card-text>
      </v-card>
    </template>

    <!-- 提示信息 -->
    <v-snackbar
        v-model="snackbar.show"
        :color="snackbar.color"
        :timeout="3000"
    >
      {{ snackbar.text }}
      <template v-slot:action="{ attrs }">
        <v-btn
            text
            v-bind="attrs"
            @click="snackbar.show = false"
        >
          关闭
        </v-btn>
      </template>
    </v-snackbar>
    <v-btn @click="callBaiduOCR('aa')">test</v-btn>
  </v-container>
</template>

<script>
export default {
  name: 'OCR',
  data: () => ({
    API_KEY: 'AnF5jK73VFG7H7Fat68H8Cnk',
    SECRET_KEY: 'NM6Ky9vH1OO8sQu92pX0Bv6nC5Vfpm7B',
    access_token: '',
    ocrResults: [],
    isProcessing: false,
    isDragging: false,
    copying: null,
    snackbar: {
      show: false,
      text: '',
      color: 'success'
    }
  }),

  methods: {
    showMessage(text, color = 'success') {
      this.snackbar = {
        show: true,
        text,
        color
      }
    },

    triggerFileInput() {
      this.$refs.fileInput.click()
    },

    async handleFileChange(event) {
      const files = Array.from(event.target.files)
      await this.processFiles(files)
      event.target.value = ''
    },

    async handlePaste(event) {
      const items = (event.clipboardData || event.originalEvent.clipboardData).items
      const files = []

      for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
          const file = item.getAsFile()
          files.push(file)
        }
      }

      if (files.length > 0) {
        await this.processFiles(files)
      }
    },

    async handleDrop(event) {
      this.isDragging = false
      const files = Array.from(event.dataTransfer.files).filter(file =>
          file.type.startsWith('image/')
      )
      await this.processFiles(files)
    },

    async processFiles(files) {
      if (this.isProcessing) return

      if (!files.length) {
        this.showMessage('请选择图片文件', 'warning')
        return
      }

      this.isProcessing = true

      try {
        for (const file of files) {
          // 文件大小检查（例如最大10MB）
          if (file.size > 10 * 1024 * 1024) {
            throw new Error(`文件 ${file.name} 过大，请限制在10MB以内`)
          }

          const base64 = await this.fileToBase64(file)
          const result = await this.callBaiduOCR(base64)
          this.processOCRResult(result)
        }
        this.showMessage('识别完成')
      } catch (error) {
        this.showMessage(error.message, 'error')
      } finally {
        this.isProcessing = false
      }
    },

    fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result.split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
    },

    async callBaiduOCR(base64Image) {
      // 这里需要替换为您的百度OCR接口调用逻辑
      try {
        const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${this.API_KEY}&client_secret=${this.SECRET_KEY}`
        const service = this.$http.create({
          baseURL: 'https://aip.baidubce.com/',
          timeout: 5000,
          headers: {
            'Access-Control-Allow-Origin': '*'
          }
        });

        const res = await service({
          url: url,
          method: 'POST',
        })
        console.log(res)
        // 获取access_token
        // await this.$http.post()
        //   .then(res => {
        //     this.access_token = res.data.access_token
        //   }).catch(err => {
        //     this.$toast('获取token失败:'+err);
        //   })

        // 调用OCR接口
        // const response = await this.$http.post(`https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=${this.access_token}`,
        //     {'image': encodeURIComponent(base64Image)},
        //     {'Content-Type': 'application/x-www-form-urlencoded'},
        // ).catch(err => {
        //   this.$toast('识别失败:'+err);
        // })

        // return await response.data
        return ''
      } catch (error) {
        throw new Error(`OCR识别失败: ${error.message}`)
      }
    },

    processOCRResult(result) {
      if (result.words_result) {
        const text = result.words_result.map(item => item.words).join('\n')
        this.ocrResults.push({
          type: 'text',
          text
        })
      }
    },

    async copyText(text) {
      try {
        await navigator.clipboard.writeText(text)
        this.showMessage('复制成功')
      } catch (err) {
        // 降级处理
        const textarea = document.createElement('textarea')
        textarea.value = text
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
        this.showMessage('复制成功')
      }
    }
  }
}
</script>

<style scoped>
.upload-area {
  border: 2px dashed rgba(0, 0, 0, 0.12);
  transition: all 0.3s ease;
}

.upload-area:hover, .upload-area.dragover {
  border-color: var(--v-primary-base);
}

.result-text {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: monospace;
  background-color: #f5f5f5;
  padding: 16px;
  border-radius: 4px;
}
</style>