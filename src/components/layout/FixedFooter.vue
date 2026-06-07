<script setup lang="ts">
const botStore = useBotStore();
</script>

<template>
  <footer class="mt-auto pt-3">
    <!-- Only visible on xs (phone) viewport! -->
    <!-- <hr class="my-0 border-primary" /> -->
    <div class="flex gap-2 justify-center items-center p-2">
      <div class="text-left text-sm">
        Powered by 
      </div>
      <div class="flex justify-center">
        <a 
          href="https://github.com/znxn7717/ftb"
          target="_blank" 
          rel="noopener noreferrer"
          class="flex flex-row items-center gap-2 pb-0.5 hover:opacity-80"
        >
          <AppIcon class="h-9 w-9" />
          <AppText />
        </a>
      </div>
    </div>
  </footer>
</template>
