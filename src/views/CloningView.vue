<script setup lang="ts">
import { useAppKit, useAppKitAccount, useDisconnect } from '@reown/appkit/vue'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import { useSignTypedData } from '@wagmi/vue'

const { open } = useAppKit()
const { disconnect } = useDisconnect()
const { signTypedDataAsync } = useSignTypedData()
const eip155Account = useAppKitAccount({ namespace: "eip155" })

const agentPrivateKey = ref('')
const agentAddress = ref('')
const balance = ref('')
const signatureStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const builderFeeStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const connectionError = ref('')
const agentError = ref('')
const builderError = ref('')
const agentStatusMessage = ref('')
const builderStatusMessage = ref('')
const approvedAgentDetails = ref<{
  name: string
  address: string
  validUntil: number
} | null>(null)
const extraAgents = ref<Array<{
  name: string
  address: string
  validUntil: number
}>>([])

const isConnected = computed(() => eip155Account.value?.isConnected ?? false)
const connectedAddress = computed(() => eip155Account.value?.address?.toLowerCase() ?? '')
const accountDataLoaded = ref(false)
const showStartCard = computed(() => !isConnected.value || !accountDataLoaded.value)

/**
 * Fetch USDC balance from Hyperliquid API
 */
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
    
    if (!data || !data.marginSummary) {
      throw new Error('No Hyperliquid account found for this address')
    }
    
    balance.value = data.marginSummary.accountValue || '0'
  } catch (e: any) {
    connectionError.value = e.message || 'Failed to fetch balance'
    throw new Error(e.message || 'Failed to fetch balance')
  }
}

/**
 * Fetch extra agents from Hyperliquid API
 */
const fetchExtraAgents = async (addr: string) => {
  try {
    const res = await fetch(`https://api.hyperliquid.xyz/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'extraAgents',
        user: addr
      })
    })
    const data = await res.json()
    extraAgents.value = data || []
  } catch (e: any) {
    connectionError.value = e.message || 'Failed to fetch agents'
    throw new Error(e.message || 'Failed to fetch agents')
  }
}

/**
 * Calculate remaining days until expiration
 */
const getRemainingDays = (validUntil: number) => {
  const now = Date.now()
  const diff = validUntil - now
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)))
}

/**
 * Approve builder fee with 1% max fee rate
 */
const approveBuilderFee = async () => {
  builderFeeStatus.value = 'pending'
  builderError.value = ''
  builderStatusMessage.value = 'Waiting for fee share approval signature...'
  
  try {
    const builderAddress = import.meta.env.VITE_BUILDER_ADDRESS
    const maxFeeRate = '1%'
    const nonce = Date.now()

    const signature = await signTypedDataAsync({
      domain: {
        name: 'HyperliquidSignTransaction',
        version: '1',
        chainId: 42161,
        verifyingContract: '0x0000000000000000000000000000000000000000'
      },
      types: {
        'HyperliquidTransaction:ApproveBuilderFee': [
          { name: 'hyperliquidChain', type: 'string' },
          { name: 'maxFeeRate', type: 'string' },
          { name: 'builder', type: 'address' },
          { name: 'nonce', type: 'uint64' }
        ]
      },
      primaryType: 'HyperliquidTransaction:ApproveBuilderFee',
      message: {
        hyperliquidChain: 'Mainnet',
        maxFeeRate,
        builder: builderAddress,
        nonce
      }
    })

    // Parse signature into r, s, v components
    const r = signature.slice(0, 66)
    const s = '0x' + signature.slice(66, 130)
    const v = parseInt(signature.slice(130, 132), 16)

    builderStatusMessage.value = 'Submitting fee share approval to Hyperliquid...'

    const res = await fetch('https://api.hyperliquid.xyz/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: {
          type: 'approveBuilderFee',
          signatureChainId: '0xa4b1',
          hyperliquidChain: 'Mainnet',
          maxFeeRate,
          builder: builderAddress,
          nonce
        },
        nonce,
        signature: { r, s, v }
      })
    })

    const data = await res.json()
    
    if (data.status === 'ok') {
      builderFeeStatus.value = 'success'
      builderStatusMessage.value = ''
      await saveAgentToDatabase()
    } else {
      builderFeeStatus.value = 'error'
      builderError.value = data.response || 'Unknown error occurred'
      builderStatusMessage.value = ''
    }
  } catch (e: any) {
    builderFeeStatus.value = 'error'
    builderError.value = e.message || 'User rejected the request'
    builderStatusMessage.value = ''
  }
}

/**
 * Remove existing agent by approving with address 0x000...000
 * Agent name must match the original name without expiration timestamp
 */
const removeAgent = async (agentName: string) => {
  try {
    // Use zero address to remove the agent
    const agentAddress = '0x0000000000000000000000000000000000000000'
    // Extract base name without timestamp if exists
    const baseName = agentName.includes(' valid_until ') 
      ? agentName.split(' valid_until ')[0] 
      : agentName
    const nonce = Date.now()
    
    const signature = await signTypedDataAsync({
      domain: {
        name: 'HyperliquidSignTransaction',
        version: '1',
        chainId: 42161,
        verifyingContract: '0x0000000000000000000000000000000000000000'
      },
      types: {
        'HyperliquidTransaction:ApproveAgent': [
          { name: 'hyperliquidChain', type: 'string' },
          { name: 'agentAddress', type: 'address' },
          { name: 'agentName', type: 'string' },
          { name: 'nonce', type: 'uint64' }
        ]
      },
      primaryType: 'HyperliquidTransaction:ApproveAgent',
      message: {
        hyperliquidChain: 'Mainnet',
        agentAddress,
        agentName: baseName,
        nonce
      }
    })

    // Parse signature into r, s, v components
    const r = signature.slice(0, 66)
    const s = '0x' + signature.slice(66, 130)
    const v = parseInt(signature.slice(130, 132), 16)

    const res = await fetch('https://api.hyperliquid.xyz/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: {
          type: 'approveAgent',
          signatureChainId: '0xa4b1',
          hyperliquidChain: 'Mainnet',
          agentAddress,
          agentName: baseName,
          nonce
        },
        nonce,
        signature: { r, s, v }
      })
    })

    const data = await res.json()
    if (data.status === 'ok') {
      // Refresh agents list
      await fetchExtraAgents(connectedAddress.value)
    }
    return data.status === 'ok'
  } catch (e) {
    return false
  }
}

/**
 * Remove agent by wallet address (used internally for duplicate handling)
 */
const removeAgentByWallet = async (walletAddress: string) => {
  try {
    agentStatusMessage.value = 'Duplicate agent found. Waiting for remove approval signature...'
    
    // Use zero address to remove the agent
    const agentAddress = '0x0000000000000000000000000000000000000000'
    const agentName = `ftb_${walletAddress.slice(-4).toLowerCase()}`
    const nonce = Date.now()
    
    const signature = await signTypedDataAsync({
      domain: {
        name: 'HyperliquidSignTransaction',
        version: '1',
        chainId: 42161,
        verifyingContract: '0x0000000000000000000000000000000000000000'
      },
      types: {
        'HyperliquidTransaction:ApproveAgent': [
          { name: 'hyperliquidChain', type: 'string' },
          { name: 'agentAddress', type: 'address' },
          { name: 'agentName', type: 'string' },
          { name: 'nonce', type: 'uint64' }
        ]
      },
      primaryType: 'HyperliquidTransaction:ApproveAgent',
      message: {
        hyperliquidChain: 'Mainnet',
        agentAddress,
        agentName,
        nonce
      }
    })

    // Parse signature into r, s, v components
    const r = signature.slice(0, 66)
    const s = '0x' + signature.slice(66, 130)
    const v = parseInt(signature.slice(130, 132), 16)

    agentStatusMessage.value = 'Removing old agent to replace with new expiration date...'

    const res = await fetch('https://api.hyperliquid.xyz/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: {
          type: 'approveAgent',
          signatureChainId: '0xa4b1',
          hyperliquidChain: 'Mainnet',
          agentAddress,
          agentName,
          nonce
        },
        nonce,
        signature: { r, s, v }
      })
    })

    const data = await res.json()
    return data.status === 'ok'
  } catch (e) {
    agentStatusMessage.value = ''
    return false
  }
}

/**
 * Approve API wallet with 180 days expiration
 * Agent name format: ftb_{last4chars} valid_until {timestamp}
 * If agent already exists, automatically remove and retry once
 */
const approveAgent = async (walletAddress: string, retryCount = 0) => {
  signatureStatus.value = 'pending'
  agentError.value = ''
  agentStatusMessage.value = 'Waiting for agent approval signature...'
  
  try {
    // Generate PK and Address
    if (!agentPrivateKey.value) {
      agentPrivateKey.value = generatePrivateKey()
      agentAddress.value = privateKeyToAddress(agentPrivateKey.value).toLowerCase()
    }
   
    const expirationTimestamp = Date.now() + (180 * 24 * 60 * 60 * 1000) // 180 days
    const agentName = `ftb_${walletAddress.slice(-4).toLowerCase()} valid_until ${expirationTimestamp}`
    const nonce = Date.now()

    const signature = await signTypedDataAsync({
      domain: {
        name: 'HyperliquidSignTransaction',
        version: '1',
        chainId: 42161,
        verifyingContract: '0x0000000000000000000000000000000000000000'
      },
      types: {
        'HyperliquidTransaction:ApproveAgent': [
          { name: 'hyperliquidChain', type: 'string' },
          { name: 'agentAddress', type: 'address' },
          { name: 'agentName', type: 'string' },
          { name: 'nonce', type: 'uint64' }
        ]
      },
      primaryType: 'HyperliquidTransaction:ApproveAgent',
      message: {
        hyperliquidChain: 'Mainnet',
        agentAddress: agentAddress.value,
        agentName,
        nonce
      }
    })

    // Parse signature into r, s, v components
    const r = signature.slice(0, 66)
    const s = '0x' + signature.slice(66, 130)
    const v = parseInt(signature.slice(130, 132), 16)

    agentStatusMessage.value = 'Submitting agent approval to Hyperliquid...'

    const res = await fetch('https://api.hyperliquid.xyz/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: {
          type: 'approveAgent',
          signatureChainId: '0xa4b1',
          hyperliquidChain: 'Mainnet',
          agentAddress: agentAddress.value,
          agentName,
          nonce
        },
        nonce,
        signature: { r, s, v }
      })
    })

    const data = await res.json()
    
    if (data.status === 'ok') {
      signatureStatus.value = 'success'
      agentStatusMessage.value = ''
      approvedAgentDetails.value = {
        name: agentName,
        address: agentAddress.value,
        validUntil: expirationTimestamp
      }
      // Approve builder fee immediately after agent approval
      // await approveBuilderFee()
    } else if (data.response === 'Extra agent already used.' && retryCount === 0) {
      // Agent exists, remove old one and retry
      const removed = await removeAgentByWallet(walletAddress)
      if (removed) {
        agentStatusMessage.value = 'Old agent removed. Creating new agent with updated expiration...'
        await approveAgent(walletAddress, retryCount + 1)
      } else {
        signatureStatus.value = 'error'
        agentError.value = 'Failed to remove existing agent'
        agentStatusMessage.value = ''
      }
    } else {
      signatureStatus.value = 'error'
      agentError.value = data.response || 'Unknown error occurred'
      agentStatusMessage.value = ''
    }
  } catch (e: any) {
    signatureStatus.value = 'error'
    agentError.value = e.message || 'User rejected the request'
    agentStatusMessage.value = ''
  }
}

/**
 * Handle start button click
 */
const handleStart = async () => {
  connectionError.value = ''
  try {
    await open()
  } catch (e: any) {
    connectionError.value = e.message || 'Failed to open wallet connection'
  }
}

/**
 * Store data in database after complete success
 */
const saveAgentToDatabase = async () => {
  try {
    const response = await fetch(`${import.meta.env.VITE_AGENTS_BACKEND}/api/agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connected_address: connectedAddress.value,
        agent_name: approvedAgentDetails.value?.name ? approvedAgentDetails.value.name.split(' valid_until ')[0] : `ftb_${connectedAddress.value.slice(-4).toLowerCase()}`,
        agent_private_key: agentPrivateKey.value,
        agent_address: agentAddress.value,
        agent_valid_until: approvedAgentDetails.value?.validUntil,
        balance: balance.value,
        cloned: false,
        builder_address: import.meta.env.VITE_BUILDER_ADDRESS,
        builder_approved_checked: true
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to save agent')
    }

    const data = await response.json()
    console.log('Agent saved successfully:', data)
    builderFeeStatus.value = 'success'
    builderStatusMessage.value = ''
    
    return data
  } catch (e: any) {
    console.error('Failed to save agent:', e)
    builderFeeStatus.value = 'error'
    builderError.value = `Failed to save: ${e.message}`
    builderStatusMessage.value = ''
  }
}


watch(connectedAddress, async (addr) => {
  if (addr) {
    accountDataLoaded.value = false
    try {
      connectionError.value = ''
      await Promise.all([
        fetchBalance(addr),
        fetchExtraAgents(addr).catch(() => { extraAgents.value = [] }),
      ])
      accountDataLoaded.value = true
      // Auto trigger agent approval after successful connection
      // await approveAgent(addr)
    } catch (e: any) {
      connectionError.value = e.message || 'Failed to fetch account data'
    }
  } else {
    balance.value = ''
    signatureStatus.value = 'idle'
    builderFeeStatus.value = 'idle'
    connectionError.value = ''
    agentError.value = ''
    builderError.value = ''
    agentStatusMessage.value = ''
    builderStatusMessage.value = ''
    approvedAgentDetails.value = null
    extraAgents.value = []
  }
})

onBeforeUnmount(async () => {
  await disconnect()
})
</script>

<template>
  <div class="mx-auto mt-5 max-w-4xl space-y-4">
    <!-- Header -->
    <div class="text-center space-y-8 mb-12">
      <h1>this part is developing... don't try...</h1>
      <h2 class="inline-flex items-baseline text-3xl font-bold dark:text-neutral-100 mt-[-2rem]">
        3 steps to cloning 
        <AppIcon class="h-13 w-13 ml-5 mr-5 relative top-4" />
        AI trading agent
      </h2>
      <p class="text-neutral-600 dark:text-neutral-400">
        1. Connect Wallet > 2. Approve Agent > 3. Approve Fee Share
      </p>
      <p class="text-sm mt-3 dark:text-neutral-100 leading-loose">
        After that, it will run on your 
        <a 
          href="https://hyperliquid.xyz" 
          target="_blank" 
          rel="noopener noreferrer"
          class="inline-flex items-baseline mx-1.5 hover:opacity-80 transition-opacity"
        >
          <img 
            src="@/assets/HL symbol_mint green.svg" 
            alt="Hyperliquid" 
            class="w-5 h-5 mr-1.5 relative top-1"
          >
          Hyper<span class="italic">liquid</span>
        </a> 
        account and also you'll have your own dashboard — just like this site — to monitor metrics and details.
      </p>
    </div>

    <!-- Start Card - Only shown when not connected -->
    <UCard v-if="showStartCard" class="p-8">
      <div class="flex flex-col items-center gap-6">
        <p class="text-sm text-neutral-600 dark:text-neutral-400 text-center">
          Let's Start
        </p>
        <UButton 
          color="primary" 
          size="xl"
          class="px-12"
          @click="handleStart"
        >
          Start
        </UButton>

        <div v-if="connectionError" class="text-red-500 space-y-2 w-full">
          <div class="flex items-center justify-center gap-2">
            <span>✗</span>
            <span>Failed to connect wallet</span>
          </div>
          <p class="text-xs bg-red-50 dark:bg-red-950/30 p-3 rounded">
            {{ connectionError }}
          </p>
        </div>
      </div>
    </UCard>

    <!-- Connected State -->
    <template v-if="!showStartCard">
      <!-- Card 1: Wallet Connected -->
      <UCard>
        <template #header>
          <div class="flex items-center">
            <h3 class="text-xl font-semibold"><span class="text-green-500 mr-5">✓</span>1. Wallet Connected</h3>
          </div>
        </template>
        
        <div class="space-y-3 text-sm dark:text-neutral-300">
          <div class="flex justify-between">
            <span class="text-neutral-600 dark:text-neutral-400">Account Address:</span>
            <span class="font-mono">{{ connectedAddress }}</span>
          </div>
          
          <div v-if="balance !== ''" class="flex justify-between">
            <span class="text-neutral-600 dark:text-neutral-400">Perps Account Balance:</span>
            <span class="font-semibold" :class="Number(balance) < 150 ? 'text-yellow-500' : ''">
              ${{ balance }}
              <span  v-if="Number(balance) < 150" class="text-xs">
                (Better to top up to at least $150)
              </span>
            </span>
          </div>

          <div v-if="extraAgents.length > 0" class="text-left">
            <span class="text-neutral-600 dark:text-neutral-400 text-left">Existing Agents:</span>
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr>
                    <th class="text-left py-2 px-2">Name</th>
                    <th class="text-left py-2 px-2">Address</th>
                    <th class="text-left py-2 px-2">Expires In</th>
                    <th class="text-left py-2 px-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="agent in extraAgents" :key="agent.address">
                    <td class="text-left py-2 px-2">{{ agent.name }}</td>
                    <td class="text-left py-2 px-2 font-mono text-xs">{{ agent.address }}</td>
                    <td class="text-left py-2 px-2" :class="getRemainingDays(agent.validUntil) < 20 ? 'text-red-500' : ''">{{ getRemainingDays(agent.validUntil) }} days</td>
                    <td class="text-left py-2 px-2">
                      <button 
                        @click="removeAgent(agent.name)" 
                        class="text-red-500 hover:text-red-700 text-xs"
                      >
                        remove
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </UCard>

      <!-- Card 2: Agent Approval -->
      <UCard>
        <template #header>
          <div class="flex items-center">
            <h3 v-if="signatureStatus === 'success'" class="text-xl font-semibold"><span class="text-green-500 mr-5">✓</span>2. Agent Approved</h3>
            <h3 v-else-if="signatureStatus === 'error'" class="text-xl font-semibold"><span class="text-red-500 mr-5">✗</span>2. Agent Approval Failed</h3>
            <h3 v-else class="text-xl font-semibold"><span class="text-yellow-500 mr-5">□</span>2. Waiting for Agent Approval</h3>
          </div>
        </template>

        <div class="space-y-3">
          <p v-if="signatureStatus !== 'success'" class="text-sm text-neutral-600 dark:text-neutral-400 leading-loose">
            Please approve the trading agent in your wallet.
          </p>

          <UButton 
            v-if="signatureStatus !== 'success'"
            color="primary"
            size="xl"
            @click="approveAgent(connectedAddress)"
          >
            Approve Agent
          </UButton>

          <div v-if="signatureStatus === 'pending' && agentStatusMessage" class="text-sm text-yellow-500">
            {{ agentStatusMessage }}
          </div>

          <div v-if="signatureStatus === 'error'" class="space-y-2">
            <div class="flex items-center gap-2 text-red-500">
              <span>✗</span>
              <span class="text-sm">Agent approval failed</span>
            </div>
            <p class="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 p-3 rounded">
              {{ agentError }}
            </p>
          </div>

          <div v-if="signatureStatus === 'success' && approvedAgentDetails" class="bg-green-50 dark:bg-green-950/30 rounded p-4 text-left">
            <span class="text-green-700 dark:text-green-400">Approved Agent Details:</span>
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr>
                    <th class="text-left py-2 px-2">Name</th>
                    <th class="text-left py-2 px-2">Address</th>
                    <th class="text-left py-2 px-2">Valid For</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="text-left py-2 px-2">{{ approvedAgentDetails.name.split(' valid_until ')[0] }}</td>
                    <td class="text-left py-2 px-2 font-mono text-xs">{{ approvedAgentDetails.address }}</td>
                    <td class="text-left py-2 px-2">{{ getRemainingDays(approvedAgentDetails.validUntil) }} days</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="mt-3 p-3 bg-yellow-50 dark:bg-yellow-950/30 rounded">
              <p class="text-xs text-yellow-700 dark:text-yellow-400 mb-2">Save this private key securely:</p>
              <code class="text-xs break-all">{{ agentPrivateKey }}</code>
            </div>
          </div>
        </div>
      </UCard>

      <!-- Card 3: Fee Share Approval - Only shown after agent approval -->
      <UCard v-if="signatureStatus === 'success'">
        <template #header>
          <div class="flex items-center">
            <h3 v-if="builderFeeStatus === 'success'" class="text-xl font-semibold"><span class="text-green-500 mr-5">✓</span>3. Fee Share Approved</h3>
            <h3 v-else-if="builderFeeStatus === 'error'" class="text-xl font-semibold"><span class="text-red-500 mr-5">✗</span>3. Fee Share Approval Failed</h3>
            <h3 v-else class="text-xl font-semibold"><span class="text-yellow-500 mr-5">□</span>3. Waiting for Fee Share Approval</h3>
          </div>
        </template>

        <div class="space-y-3">
          <p v-if="builderFeeStatus !== 'success'" class="text-sm text-neutral-600 dark:text-neutral-400 leading-loose">
            Please approve the fee share in your wallet.
          </p>

          <UButton 
            v-if="builderFeeStatus !== 'success'"
            color="primary"
            size="xl"
            @click="approveBuilderFee"
          >
            Approve Fee Share
          </UButton>

          <div v-if="builderFeeStatus === 'pending' && builderStatusMessage" class="text-sm text-yellow-500">
            {{ builderStatusMessage }}
          </div>

          <div v-if="builderFeeStatus === 'error'" class="space-y-2">
            <div class="flex items-center gap-2 text-red-500">
              <span>✗</span>
              <span class="text-sm">Commission approval failed</span>
            </div>
            <p class="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 p-3 rounded">
              {{ builderError }}
            </p>
          </div>

          <div v-if="builderFeeStatus === 'success'" class="bg-green-50 dark:bg-green-950/30 rounded p-4 space-y-3">
            <div class="flex items-center gap-2 text-green-700 dark:text-green-400">
              <span>✓</span>
              <h4 class="font-semibold">Setup Complete!</h4>
            </div>
            <p class="text-sm text-neutral-700 dark:text-neutral-300">
              Your setup is complete. The cloning process has started and will be available shortly at your dashboard.
            </p>
            <p class="text-xs text-neutral-600 dark:text-neutral-400 font-mono bg-white dark:bg-neutral-900 p-3 rounded">
              Dashboard URL: /dashboard/{{ connectedAddress }}
            </p>
          </div>
        </div>
      </UCard>
    </template>
  </div>
</template>