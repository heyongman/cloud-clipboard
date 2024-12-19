<template>
  <v-container fluid>
    <v-row style="height: 80vh; display: flex; justify-content: center; align-items: center;">
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
  name: "Home",
  data() {
    return {
      sites: [],
    };
  },
  created() {
    this.fetchNavigationData()
  },
  methods: {
    navigateTo(link) {
      // window.location.href = link;
      const routePath = this.$router.resolve({path: link}).href
      window.open(routePath, '_blank')

    },
    async fetchNavigationData() {
      await this.$http.get('nav').then(response => {
        if (response.data.code !== 200){
          throw response.data.msg
        }
        this.sites = response.data.result
      }).catch(error => {
          this.$toast('发送失败:'+error);
      });
    },
  }
};
</script>


<style scoped>
.icon-card {
  cursor: pointer;
  transition: transform 0.3s ease, box-shadow 0.3s;
  background-color: white;
  border-radius: 12px;
  box-shadow: 0 2px 2px rgba(0, 0, 0, 0.2);
  //transition: transform 0.3s ease;
  width: 50px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.icon-card:hover {
  transform: scale(1.1);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}
</style>