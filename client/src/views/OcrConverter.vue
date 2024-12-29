<template>
  <v-container @paste="handlePaste">
    <v-card class="mb-6">
      <v-card-title>OCR文字识别</v-card-title>
      <v-card-text>
        <!-- 场景选择 -->
        <v-select
            v-model="selectedScene"
            :items="scenes"
            item-text="text"
            item-value="value"
            label="选择识别场景"
            class="mb-4"
        ></v-select>

        <!-- 上传区域 -->
        <v-sheet
            class="upload-area pa-6"
            :class="{ 'dragover': isDragging }"
            @dragenter.prevent="isDragging = true"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="isDragging = false"
            @drop.prevent="handleDrop"
            height="200"
        >
          <input
              type="file"
              ref="fileInput"
              multiple
              accept="image/*"
              @change="handleFileChange"
              style="display: none"
          >
          <v-row justify="center" align="center" class="fill-height">
            <v-col class="text-center">
              <v-btn
                  color="primary"
                  @click="$refs.fileInput.click()"
              >
                选择图片
              </v-btn>
              <div class="mt-2 grey--text">
                或将图片拖拽到此处，也可以使用Ctrl + V粘贴
              </div>
            </v-col>
          </v-row>
        </v-sheet>
      </v-card-text>
    </v-card>

    <!-- 结果展示区域 -->
    <v-card v-for="(item, index) in ocrResults" :key="index" class="mb-4">
      <v-card-text>
        <v-row>
          <!-- 原图展示 -->
          <v-col cols="12" md="6">
            <v-img
                :src="item.imageUrl"
                contain
                max-height="400"
                class="grey lighten-2"
            ></v-img>
          </v-col>

          <!-- 识别结果展示 -->
          <v-col cols="12" md="6">
            <v-sheet
                class="position-relative"
                outlined
            >
              <!-- 普通识别结果 -->
              <template v-if="!item.hasPosition">
                <v-card-text class="text-content">
                  {{ item.text }}
                </v-card-text>
              </template>

              <!-- 带位置的识别结果 -->
              <template v-else>
                <div
                    v-for="(block, bIndex) in item.textBlocks"
                    :key="bIndex"
                    class="text-block-with-position"
                    :style="getPositionStyle(block)"
                >
                  {{ block.text }}
                </div>
              </template>
            </v-sheet>
            <v-btn
                color="primary"
                text
                block
                @click="copyText(item)"
                class="mt-2"
            >
              复制文本
            </v-btn>
            <v-btn
                color="error"
                text
                block
                @click="removeItem(index)"
                class="mt-2"
            >
              移除
            </v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Loading遮罩 -->
    <v-overlay :value="loading">
      <v-progress-circular indeterminate size="64"></v-progress-circular>
    </v-overlay>

    <!-- 提示消息 -->
    <v-snackbar
        v-model="snackbar.show"
        :color="snackbar.color"
        timeout="3000"
    >
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>

<script>
export default {
  name: 'OcrConverter',
  data() {
    return {
      apiKey: 'AnF5jK73VFG7H7Fat68H8Cnk',
      secretKey: 'NM6Ky9vH1OO8sQu92pX0Bv6nC5Vfpm7B',
      accessToken: '',
      loading: false,
      isDragging: false,
      selectedScene: 'general',
      ocrResults: [],
      snackbar: {
        show: false,
        text: '',
        color: 'success'
      },
      scenes: [
        {text: '通用文字识别', value: 'general'},
        {text: '通用文字识别高精度含位置版', value: 'accurate'},
        {text: '表格文字识别v2', value: 'table'},
        {text: '手写文字识别', value: 'handwriting'}
      ]
    }
  },
  computed: {
    apiUrls() {
      return {
        general: '/ocr/rest/2.0/ocr/v1/general_basic',
        accurate: '/ocr/rest/2.0/ocr/v1/accurate',
        table: '/ocr/rest/2.0/ocr/v2/table',
        handwriting: '/ocr/rest/2.0/ocr/v1/handwriting'
      }
    }
  },
  methods: {
    // 获取Access Token
    async getAccessToken() {
      if (!this.apiKey || !this.secretKey) {
        this.showMessage('请输入API Key和Secret Key', 'error')
        return null
      }

      try {
        const response = await fetch(
            `/ocr/oauth/2.0/token?grant_type=client_credentials&client_id=${this.apiKey}&client_secret=${this.secretKey}`,
            {
              method: 'POST'
            }
        )
        const data = await response.json()

        if (data.access_token) {
          this.accessToken = data.access_token
          return data.access_token
        } else {
          throw new Error('获取access_token失败')
        }
      } catch (error) {
        this.showMessage('获取access_token失败: ' + error.message, 'error')
        return null
      }
    },

    // 显示消息提示
    showMessage(text, color = 'success') {
      this.snackbar.text = text
      this.snackbar.color = color
      this.snackbar.show = true
    },

    // 处理文件选择
    async handleFileChange(event) {
      const files = Array.from(event.target.files)
      await this.processFiles(files)
    },

    // 处理粘贴事件
    async handlePaste(event) {
      const items = (event.clipboardData || event.originalEvent.clipboardData).items
      const files = []

      for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
          const file = item.getAsFile()
          files.push(file)
        }
      }

      await this.processFiles(files)
    },

    // 处理拖放事件
    async handleDrop(event) {
      this.isDragging = false
      const files = Array.from(event.dataTransfer.files).filter(file =>
          file.type.startsWith('image/')
      )
      await this.processFiles(files)
    },

    // 处理文件
    async processFiles(files) {
      if (files.length === 0) return

      this.loading = true

      try {
        if (!this.accessToken) {
          await this.getAccessToken()
        }

        for (const file of files) {
          if (file.size > 4 * 1024 * 1024) {
            this.showMessage(`文件 ${file.name} 超过4MB限制`, 'error')
            continue
          }

          const imageUrl = URL.createObjectURL(file)
          const base64 = await this.fileToBase64(file)
          const result = await this.callOcrApi(base64)

          if (result) {
            this.ocrResults.push({
              imageUrl,
              text: this.extractText(result),
              hasPosition: this.selectedScene === 'accurate',
              textBlocks: this.selectedScene === 'accurate' ? this.extractTextBlocks(result) : null
            })
          }
        }
      } catch (error) {
        this.showMessage('处理文件失败: ' + error.message, 'error')
      } finally {
        this.loading = false
      }
    },

    // 文件转Base64
    fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const base64String = reader.result.split(',')[1]
          resolve(base64String)
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
    },

    // 调用百度OCR API
    async callOcrApi(base64Image) {
      const url = `${this.apiUrls[this.selectedScene]}?access_token=${this.accessToken}`

      return await this.$http.post(url,
          {'image': base64Image},
          {headers: {'Content-Type': 'application/x-www-form-urlencoded'}},
      ).then(res => {
        if (res.error_code) {
          this.showMessage(res.error_msg || '识别失败');
          return null;
        }
        return res.data
      }).catch(err => {
        this.showMessage('API调用失败: ' + err.message, 'error')
      })

    },

    // 提取文本内容
    extractText(result) {
      if (this.selectedScene === 'table') {
        return result.tables_result[0].body.map(row =>
            row.map(cell => cell.text).join('\t')
        ).join('\n')
      }

      return result.words_result.map(item => item.words).join('\n')
    },

    // 提取带位置的文本块
    extractTextBlocks(result) {
      return result.words_result.map(item => ({
        text: item.words,
        location: item.location
      }))
    },

    // 获取位置样式
    getPositionStyle(block) {
      const {location} = block
      return {
        position: 'relative',
        left: `${location.left}px`,
        top: `${location.top}px`,
        width: `${location.width}px`,
        // height: `${location.height}px`,
        backgroundColor: 'rgba(255, 255, 0, 0.2)',
        // border: '1px solid rgba(0, 0, 0, 0.1)',
        fontSize: '12px',
        // padding: '2px'
      }
    },

    // 复制文本
    async copyText(item) {
      const text = item.hasPosition
          ? item.textBlocks.map(block => block.text).join('\n')
          : item.text

      try {
        await navigator.clipboard.writeText(text)
        this.showMessage('复制成功')
      } catch (err) {
        this.showMessage('复制失败: ' + err.message, 'error')
      }
    },

    // 移除项目
    removeItem(index) {
      URL.revokeObjectURL(this.ocrResults[index].imageUrl)
      this.ocrResults.splice(index, 1)
    }
  }
}
</script>

<style scoped>
.upload-area {
  border: 2px dashed rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

.upload-area.dragover {
  border-color: primary;
  background-color: rgba(0, 0, 0, 0.05);
}

.text-content {
  white-space: pre-wrap;
  word-break: break-all;
}

.text-block-with-position {
  position: absolute;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>