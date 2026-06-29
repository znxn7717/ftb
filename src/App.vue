<!-- src/App.vue -->
<script setup lang="ts">
const settingsStore = useSettingsStore();
const colorStore = useColorStore();
const router = useRouter();
const currentPath = window.location.pathname;

onMounted(async () => {
  setTimezone(settingsStore.timezone);
  colorStore.updateProfitLossColor();
  
  // When reloading on other routes, first go to / > /dashboard for auto-login and bot initialization, then redirect to the actual route
  await router.replace(router.currentRoute.value.fullPath);
  if (currentPath === "/trade" || currentPath === "/cloning" || currentPath === "/settings") {
    await router.replace(currentPath);
  }
});

watch(
  () => settingsStore.timezone,
  (tz) => {
    console.log('timezone changed', tz);
    setTimezone(tz);
  },
);


import { modal } from '@/plugins/walletconnect'
// Map app theme to AppKit theme mode
function getAppKitThemeMode(theme: string): 'light' | 'dark' {
  const t = theme.toLowerCase()
  return (t === 'dark' || t === 'bootstrap_dark') ? 'dark' : 'light'
}
// Sync AppKit modal theme with the active app theme
watch(
  () => settingsStore.currentTheme,
  (newTheme) => {
    if (newTheme) {
      modal.setThemeMode?.(getAppKitThemeMode(newTheme))
    }
  },
  { immediate: true } // Run immediately on mount to apply saved theme
)

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
