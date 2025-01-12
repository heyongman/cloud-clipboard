<template>
  <v-container fluid fill-height>
    <v-row align="center" justify="center">
      <v-col
          v-for="(site, index) in sites"
          :key="index"
          cols="auto"
          align="center"
      >
        <v-card class="icon-card" @click="navigateTo(site.link)">
            <v-img
                :src="site.icon"
                max-width="40"
                max-height="40"
                style="border-radius: 0"
            ></v-img>
        </v-card>
        <div class="mt-2">{{ site.label }}</div>
      </v-col>
    </v-row>
  </v-container>
</template>

<script>
export default {
  name: "HeHome",
  data() {
    return {
      sites: [],
      serverConfig: null
    };
  },
  created() {
    this.fetchNavigationData()
  },
  methods: {
    async navigateTo(link) {
      let routePath = link
      if (link.startsWith('/cloud-cp') && this.serverConfig.host) {
        const hostAndPort = this.serverConfig.host[0] + ':' + this.serverConfig.port
        const checkCon = await this.checkWebSocket('wss://' + hostAndPort)
        if (checkCon === true) {
          window.open('http://' + hostAndPort + '/#/cloud-cp', '_blank');
          return;
        }
      }
      if (link.startsWith('/')) {
        routePath = this.$router.resolve({path: link}).href
      }
      window.open(routePath, '_blank');

    },
    async fetchNavigationData() {
      await this.$http.get('nav').then(response => {
        if (response.data.code !== 200){
          throw response.data.msg
        }
        this.sites = response.data.result.nav
        this.serverConfig = response.data.result.server
      }).catch(error => {
          this.$toast('发送失败:'+error);
      });
    },
    async checkWebSocket(url) {
      return await new Promise((resolve, reject) => {
        const socket = new WebSocket(url);

        const timer = setTimeout(() => {
          socket.close();
          reject(false);
        }, 500);

        socket.onopen = () => {
          clearTimeout(timer);
          socket.close();
          resolve(true);
        };
      }).catch(err => {
        return false
      })
    }

  }
};
</script>


<style scoped>
.icon-card {
  cursor: pointer;
  transition: transform 0.3s ease;
  background-color: white;
  border-radius: 10px;
  box-shadow: 0 2px 2px rgba(0, 0, 0, 0.2);
  width: 55px;
  height: 55px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  will-change: transform;
}
.icon-card:hover {
  transform: scale(1.2);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
}
</style>