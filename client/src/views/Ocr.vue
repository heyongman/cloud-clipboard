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
              <template v-if="['accurate', 'accurate_basic', 'handwriting'].includes(item.scene)">
                <v-card-text class="text-content">
                  {{ item.parsed.text }}
                </v-card-text>
              </template>

              <template v-else-if="item.scene === 'table'">
                <!-- 为表格识别结果提供一个占位符UI -->
                <v-card-text class="text-content d-flex flex-column justify-center align-center fill-height">
                  <v-icon size="50" color="green darken-1">mdi-file-excel</v-icon>
                  <div class="mt-3 text-subtitle-1">表格识别成功</div>
                  <div class="text-caption">点击下方按钮下载Excel文件</div>
                </v-card-text>
              </template>

            </v-sheet>
            <div class="d-flex justify-center mb-4">
              <template v-if="['accurate', 'accurate_basic', 'handwriting'].includes(item.scene)">
                <v-btn
                    color="primary"
                    text
                    @click="copyText(item)"
                    class="mt-2"
                >
                  <v-icon left>mdi-content-copy</v-icon>
                  复制文本
                </v-btn>
              </template>

              <template v-else-if="item.scene === 'table'">
                <!-- 下载Excel按钮 -->
                <v-btn
                    color="primary"
                    text
                    @click="downloadExcel(item)"
                    class="mt-2"
                >
                  <v-icon left>mdi-download</v-icon>
                  下载 Excel
                </v-btn>
              </template>
              <v-btn
                  color="error"
                  text
                  @click="removeItem(index)"
                  class="mt-2"
              >
                移除
              </v-btn>
            </div>
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
import {copyToClipboard} from "@/util";

export default {
  name: 'Ocr',
  data() {
    return {
      apiKey: 'AnF5jK73VFG7H7Fat68H8Cnk',
      secretKey: 'NM6Ky9vH1OO8sQu92pX0Bv6nC5Vfpm7B',
      accessToken: '',
      loading: false,
      isDragging: false,
      selectedScene: 'accurate',
      ocrResults: [],
      snackbar: {
        show: false,
        text: '',
        color: 'success'
      },
      scenes: [
        // {text: '通用文字识别高精度', value: 'accurate_basic'},
        {text: '通用文字识别高精度含位置版', value: 'accurate'},
        {text: '表格文字识别v2', value: 'table'},
        {text: '手写文字识别', value: 'handwriting'}
      ]
    }
  },
  computed: {
    apiUrls() {
      return {
        accurate_basic: '/ocr/rest/2.0/ocr/v1/accurate_basic',
        accurate: '/ocr/rest/2.0/ocr/v1/accurate',
        table: '/ocr/rest/2.0/ocr/v1/table',
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
              method: 'POST',
              redirect: "error"
            }
        )
        const data = await response.json()

        if (data.access_token) {
          this.accessToken = data.access_token
          return data.access_token
        } else {
          this.showMessage('获取access_token失败')
          return null
        }
      } catch (error) {
        this.showMessage('获取access_token失败: ' + error, 'error')
        return null
      }
    },

    // 调用百度OCR API
    async callOcrApi(base64Image) {
      const url = `${this.apiUrls[this.selectedScene]}?access_token=${this.accessToken}`

      const formData = new FormData();
      formData.append('image', base64Image);
      formData.append('return_excel', 'true');
      return await this.$http.post(url,
          formData,
          {headers: {'Content-Type': 'application/x-www-form-urlencoded'}},
      ).then(res => {
        if (res.data.error_code) {
          this.showMessage(res.data.error_msg || '识别失败');
          return null;
        }
        console.log(res.data)
        return res.data
      }).catch(err => {
        this.showMessage('API调用失败: ' + err, 'error')
      })
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
          if (!await this.getAccessToken()) {
            return
          }
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
              scene: this.selectedScene,
              parsed: this.parseOCRResult(this.selectedScene, result),
              // result: result
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

    // 解析识别结果
    parseOCRResult(scene, result) {
      if (scene === 'handwriting') {
        return {text: result.words_result.map(item => item.words).join('\n')}
      }

      if (scene === 'accurate') {
        const wordsResult = result.words_result
        // 处理空结果
        if (!wordsResult || wordsResult.length === 0) {
          return '未识别到文字';
        }

        let res = '';
        // 获取第一个元素的高度作为行高参考
        const height = wordsResult[0].location.height;
        let lastTop = null;

        // 遍历所有识别结果
        for (const word of wordsResult) {
          const currentTop = word.location.top;

          // 判断是否与上一行同一行（Y轴距离小于行高）
          if (lastTop !== null && Math.abs(lastTop - currentTop) < height) {
            // 同一行，用制表符分隔
            res += '\t' + word.words;
          } else {
            // 新行，用换行符分隔
            if (lastTop) {
              res += '\n' + word.words;
            } else {
              res += word.words;
            }
          }

          // 更新上一行位置
          lastTop = currentTop;
        }

        return {text: res, data: null}
      }

      if (scene === 'table') {
        if (!result?.excel_file) {
          return { text: '表格识别失败或无数据返回', data: null };
        }
        return {text: null, data: result.excel_file}
      }
      return {}
    },
// 2. 添加 downloadExcel 方法 (核心功能)
    downloadExcel(item) {
      const base64Data = item.parsed.data;

      if (!base64Data) {
        // 可以添加一个用户提示，例如使用 snackbar
        this.showMessage('没有可供下载的 Excel 数据！');
        return;
      }

      try {
        // Step 1: 将 Base64 字符串解码为二进制字符串
        const byteCharacters = atob(base64Data);

        // Step 2: 创建一个 Uint8Array 类型的数组来存储二进制数据
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);

        // Step 3: 使用二进制数据创建一个 Blob 对象，并指定MIME类型
        // .xlsx 文件的 MIME 类型
        const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        // Step 4: 创建一个临时的 a 标签来触发下载
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);

        // 设置下载文件的名称
        const fileName = `ocr_${new Date().getTime()}.xlsx`;
        link.setAttribute('download', fileName);

        // 将 a 标签添加到文档中，模拟点击，然后移除
        document.body.appendChild(link);
        link.click();

        // 清理：移除 a 标签并释放创建的 URL 对象
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

      } catch (error) {
        this.showMessage('下载失败，Base64数据可能已损坏。');
        console.error('Failed to download Excel file:', error);
      }
    },

    // 复制文本
    async copyText(item) {
      const result = await copyToClipboard(this.decodedContent);
      if (result.success) {
        this.$toast('复制成功');
      } else {
        this.$toast.error('复制失败');
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