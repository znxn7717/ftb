<script setup lang="ts">
import '@/plugins/walletconnect'

const settingsStore = useSettingsStore();
const colorStore = useColorStore();
onMounted(() => {
  setTimezone(settingsStore.timezone);
  colorStore.updateProfitLossColor();
});
watch(
  () => settingsStore.timezone,
  (tz) => {
    console.log('timezone changed', tz);
    setTimezone(tz);
  },
);

const isAutoLogin = import.meta.env.VITE_AUTO_LOGIN === 'true';
</script>

<template>
  <UApp>
    <div id="app" class="flex flex-col h-dvh" :style="colorStore.cssVars">
      <NavBar />
      <BodyLayout class="grow overflow-auto" />
      <NavFooter v-if="!isAutoLogin"/>
    </div>
  </UApp>
</template>

<style scoped>
#app {
  font-family: monospace ,Avenir, Helvetica, Arial, sans-serif;
  font-weight: bolder;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
}

/* * {
  outline: 1px solid #f00 !important;
} */
</style>
