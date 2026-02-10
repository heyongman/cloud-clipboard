<template>
    <v-app>
        <v-navigation-drawer
            v-model="drawer"
            temporary
            app
        >
            <v-list>
                <v-list-item link :href="`#/?room=${$root.room}`">
                    <v-list-item-action>
                        <v-icon>{{mdiContentPaste}}</v-icon>
                    </v-list-item-action>
                    <v-list-item-content>
                        <v-list-item-title>剪贴板</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>
              <v-list-item link href="#/ocr">
                <v-list-item-action>
                  <v-icon>{{mdiOcr}}</v-icon>
                </v-list-item-action>
                <v-list-item-content>
                  <v-list-item-title>图片识别</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
                <!-- 设备列表功能已暂时禁用（需要 WebSocket 支持）
                <v-list-item link href="#/device">
                    <v-list-item-action>
                        <v-icon>{{mdiDevices}}</v-icon>
                    </v-list-item-action>
                    <v-list-item-content>
                        <v-list-item-title>设备列表</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>
                -->
                <v-menu
                    offset-x
                    transition="slide-x-transition"
                    open-on-click
                    open-on-hover
                    :close-on-content-click="false"
                >
                    <template v-slot:activator="{on}">
                        <v-list-item link v-on="on">
                            <v-list-item-action>
                                <v-icon>{{mdiBrightness4}}</v-icon>
                            </v-list-item-action>
                            <v-list-item-content>
                                <v-list-item-title>深色模式</v-list-item-title>
                            </v-list-item-content>
                        </v-list-item>
                    </template>
                    <v-list two-line>
                        <v-list-item-group v-model="$root.dark" color="primary" mandatory>
                            <v-list-item link value="time">
                                <v-list-item-content>
                                    <v-list-item-title>根据时间切换</v-list-item-title>
                                    <v-list-item-subtitle>在 19:00 到次日 7:00 期间启用</v-list-item-subtitle>
                                </v-list-item-content>
                            </v-list-item>
                            <v-list-item link value="prefer">
                                <v-list-item-content>
                                    <v-list-item-title>根据系统设置切换</v-list-item-title>
                                    <v-list-item-subtitle>使用 <code>prefers-color-scheme</code> 检测</v-list-item-subtitle>
                                </v-list-item-content>
                            </v-list-item>
                            <v-list-item link value="enable">
                                <v-list-item-content>
                                    <v-list-item-title>保持启用</v-list-item-title>
                                </v-list-item-content>
                            </v-list-item>
                            <v-list-item link value="disable">
                                <v-list-item-content>
                                    <v-list-item-title>保持禁用</v-list-item-title>
                                </v-list-item-content>
                            </v-list-item>
                        </v-list-item-group>
                    </v-list>
                </v-menu>
            </v-list>
        </v-navigation-drawer>

        <v-app-bar
            app
            :color="$vuetify.theme.dark ? 'grey darken-4' : 'primary'"
            dark
        >
            <v-app-bar-nav-icon @click.stop="drawer = !drawer" />
            <v-toolbar-title>剪贴板<span class="d-none d-sm-inline" v-if="$root.room">（房间：<abbr title="点击复制" style="cursor:pointer" @click="copyRoomName">{{$root.room}}</abbr>）</span></v-toolbar-title>
            <v-spacer></v-spacer>
            <v-tooltip left>
                <template v-slot:activator="{ on }">
                    <v-btn icon v-on="on" @click="$root.roomInput = $root.room; $root.roomDialog = true">
                        <v-icon>{{mdiBulletinBoard}}</v-icon>
                    </v-btn>
                </template>
                <span>进入房间</span>
            </v-tooltip>
            <v-tooltip left>
                <template v-slot:activator="{ on }">
                    <v-btn icon v-on="on" @click="$root.refresh()" :loading="$root.loading">
                        <v-icon>{{mdiRefresh}}</v-icon>
                    </v-btn>
                </template>
                <span>刷新列表</span>
            </v-tooltip>
        </v-app-bar>

        <v-main>
            <template v-if="$route.meta.keepAlive">
                <keep-alive><router-view /></keep-alive>
            </template>
            <router-view v-else />
        </v-main>

        <v-dialog v-model="colorDialog" max-width="300" hide-overlay>
            <v-card>
                <v-card-title>选择主题颜色</v-card-title>
                <v-card-text>
                    <v-color-picker v-if="$vuetify.theme.dark" v-model="$vuetify.theme.themes.dark.primary " show-swatches hide-inputs></v-color-picker>
                    <v-color-picker v-else                     v-model="$vuetify.theme.themes.light.primary" show-swatches hide-inputs></v-color-picker>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn color="primary" text @click="colorDialog = false">确定</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <v-dialog v-model="$root.authCodeDialog" persistent max-width="360">
            <v-card>
                <v-card-title class="headline">需要认证</v-card-title>
                <v-card-text>
                    <p>这个剪贴板服务并不是公开的，请输入密码以继续连接。</p>
                    <v-text-field
                        v-model="$root.authCode"
                        label="密码"
                        :type="showPassword ? 'text' : 'password'"
                        :append-icon="showPassword ? mdiEye : mdiEyeOff"
                        @click:append="showPassword = !showPassword"
                        autocomplete="current-password"
                    ></v-text-field>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn
                        color="primary darken-1"
                        text
                        @click="
                            $root.authCodeDialog = false;
                            $root.connect();
                        "
                    >提交</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <v-dialog v-model="$root.roomDialog" persistent max-width="360">
            <v-card>
                <v-card-title class="headline">剪贴板房间</v-card-title>
                <v-card-text>
                    <p>输入任意名称创建新房间，或进入已有的房间。留空则表示使用默认的全局房间。</p>
                    <p>在房间中发送的内容仅限房间内可见，保存的历史记录数量仍然会受到全局设定的限制。</p>
                    <v-text-field
                        v-model="$root.roomInput"
                        label="房间名称"
                        :append-icon="mdiDiceMultiple"
                        @click:append="$root.roomInput = ['reimu', 'marisa', 'rumia', 'cirno', 'meiling', 'patchouli', 'sakuya', 'remilia', 'flandre', 'letty', 'chen', 'lyrica', 'lunasa', 'merlin', 'youmu', 'yuyuko', 'ran', 'yukari', 'suika', 'mystia', 'keine', 'tewi', 'reisen', 'eirin', 'kaguya', 'mokou'][Math.floor(Math.random() * 26)] + '-' + Math.random().toString(16).substring(2, 6)"
                    ></v-text-field>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn
                        color="primary darken-1"
                        text
                        @click="$root.roomDialog = false"
                    >取消</v-btn>
                    <v-btn
                        color="primary darken-1"
                        text
                        @click="
                            $router.push({ path: '/', query: { room: $root.roomInput }});
                            $root.roomDialog = false;
                        "
                    >进入房间</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <v-dialog v-model="clearAllDialog" max-width="360">
            <v-card>
                <v-card-title class="headline">清空剪贴板</v-card-title>
                <v-card-text>
                    <p>是否要清空当前房间的所有剪贴板内容？</p>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn
                        color="primary darken-1"
                        text
                        @click="clearAllDialog = false"
                    >取消</v-btn>
                    <v-btn
                        color="primary darken-1"
                        text
                        @click="clearAllDialog = false; clearAll()"
                    >确定</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </v-app>
</template>

<style scoped>
.v-navigation-drawer >>> .v-navigation-drawer__border {
    pointer-events: none;
}
</style>

<script>
import {
  mdiContentPaste,
  mdiDevices,
  mdiInformation,
  mdiRefresh,
  mdiBrightness4,
  mdiBulletinBoard,
  mdiDiceMultiple,
  mdiPalette,
  mdiNotificationClearAll,
  mdiOcr,
  mdiEye,
  mdiEyeOff,
} from '@mdi/js';
import { copyToClipboard } from '@/util.js';

export default {
    data() {
        return {
            drawer: false,
            colorDialog: false,
            clearAllDialog: false,
            showPassword: false,
            mdiContentPaste,
            mdiDevices,
            mdiOcr,
            mdiInformation,
            mdiRefresh,
            mdiBrightness4,
            mdiBulletinBoard,
            mdiDiceMultiple,
            mdiPalette,
            mdiNotificationClearAll,
            mdiEye,
            mdiEyeOff,
        };
    },
    methods: {
        async copyRoomName() {
            const result = await copyToClipboard(this.$root.room);
            if (result.success) {
                this.$toast(`已复制房间名称：${this.$root.room}`);
            } else {
                this.$toast.error('复制失败');
            }
        },
        async clearAll() {
            try {
                const files = this.$root.received.filter(e => e.type === 'file');
                await this.$http.delete('revoke/all', {
                    params: { room: this.$root.room },
                });
                for (const file of files) {
                    await this.$http.delete(`file/${file.cache}`);
                }
            } catch (error) {
                console.log(error);
                if (error.response && error.response.data.msg) {
                    this.$toast(`清空剪贴板失败：${error.response.data.msg}`);
                } else {
                    this.$toast('清空剪贴板失败');
                }
            }
        },
    },
    mounted() {
        // primary color <==> localStorage
        // theme colors <== localStorage
        const darkPrimary = localStorage.getItem('darkPrimary');
        const lightPrimary = localStorage.getItem('lightPrimary');
        if (darkPrimary) {
            this.$vuetify.theme.themes.dark.primary = darkPrimary;
        }
        if (lightPrimary) {
            this.$vuetify.theme.themes.light.primary = lightPrimary;
        }

        // theme colors ==> localStorage
        this.$watch('$vuetify.theme.themes.dark.primary', (newVal) => {
            localStorage.setItem('darkPrimary', newVal);
        });
        this.$watch('$vuetify.theme.themes.light.primary', (newVal) => {
            localStorage.setItem('lightPrimary', newVal);
        });
    },
};


</script>
