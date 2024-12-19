<template>
  <div id="app">
    <router-view></router-view>
  </div>
</template>

<style scoped>
.v-navigation-drawer >>> .v-navigation-drawer__border {
    pointer-events: none;
}
</style>

<script>
export default {
  name: 'App'
};
</script>