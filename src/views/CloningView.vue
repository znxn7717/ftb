<script setup lang="ts">
import { useAppKit } from '@reown/appkit/vue'
import { useAppKitAccount } from "@reown/appkit/vue";
import { useDisconnect } from "@reown/appkit/vue";

const { open } = useAppKit()
const { disconnect } = useDisconnect();
const eip155Account = useAppKitAccount({ namespace: "eip155" });
const balance = ref('')

const isConnected = computed(() => eip155Account.value?.isConnected ?? false)
const connectedAddress = computed(() => eip155Account.value?.address ?? '')

const fetchBalance = async (addr: string) => {
  try {
    const res = await fetch(`https://api.hyperliquid.xyz/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clearinghouseState',
        user: addr
      })
    })
    const data = await res.json()
    balance.value = data.marginSummary.accountValue || '0'
  } catch (e) {
    balance.value = 'Error'
  }
}

watch(connectedAddress, (addr) => {
  if (addr) fetchBalance(addr)
  else balance.value = ''
})

onBeforeUnmount(async () => {
  await disconnect()
})
</script>

<template>
  <UCard class="mx-auto mt-3 p-4 max-w-4xl">
    <template #header><span class="text-2xl font-bold">this part is developing... don't try...</span></template>
    <div class="flex flex-col gap-4 text-start dark:text-neutral-300">
      <div class="border border-neutral-400 rounded-sm p-4 space-y-4">
        <h4 class="text-xl font-semibold">1.Start > 2.Connect Wallet > 3.Approve API Wallet > 4.Approve Builder Fee</h4>
        <div class="flex justify-center flex-col items-center gap-2">
          <UButton color="primary" @click="open()">
            Start
          </UButton>
          <div v-if="isConnected" class="text-sm mt-2">
            <p>Address: {{ connectedAddress.slice(0, 6) }}...{{ connectedAddress.slice(-4) }}</p>
            <p>USDC Balance: {{ balance }}</p>
          </div>
        </div>
      </div>
    </div>
  </UCard>
</template>