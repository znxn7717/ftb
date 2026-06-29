<script setup lang="ts">
import { useAppKit, useAppKitAccount, useDisconnect } from '@reown/appkit/vue'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import { useSignTypedData } from '@wagmi/vue'
import { useAgentsStore } from '@/stores/agents'

const agentsStore = useAgentsStore()
const wallet = computed(() => {
  if (agentsStore.loading) return null
  return agentsStore.currentAgentAddress || import.meta.env.VITE_WALLET
})
const { open } = useAppKit()
const { disconnect } = useDisconnect()
const { signTypedDataAsync } = useSignTypedData()
const eip155Account = useAppKitAccount({ namespace: "eip155" })

const agentPrivateKey = ref('')
const agentAddress = ref('')
const balance = ref('')
const signatureStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const builderFeeStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const uncloneStatus = ref<'idle' | 'pending' | 'success'>('idle')
const connectionError = ref('')
const agentError = ref('')
const builderError = ref('')
const agentStatusMessage = ref('')
const builderStatusMessage = ref('')
const uncloneStatusMessage = ref('')
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

// DB agent record
const dbAgent = ref<{
  connected_address: string
  agent_name: string
  agent_private_key: string
  agent_address: string
  agent_valid_until: number
  balance: string
  cloned: boolean
  builder_address: string
  builder_approved_status: boolean
  updated_at: string
} | null>(null)

const isConnected = computed(() => eip155Account.value?.isConnected ?? false)
const connectedAddress = computed(() => eip155Account.value?.address?.toLowerCase() ?? '')
const accountDataLoaded = ref(false)
const showStartCard = computed(() => !isConnected.value || !accountDataLoaded.value)

// Dashboard subdomain URL
const dashboardUrl = computed(() => {
  if (!connectedAddress.value) return ''
  const last4 = connectedAddress.value.slice(-4).toLowerCase()
  const hostname = window.location.hostname
  // Remove existing subdomain if any, to get base domain
  const parts = hostname.split('.')
  const baseDomain = parts.length > 3 ? parts.slice(1).join('.') : hostname
  return `https://${last4}.${baseDomain}`
})

/**
 * Determine display mode based on DB record
 * Returns: 'new' | 'cloned_done' | 'cloning_in_progress' | 'needs_reapprove'
 */
const dbDisplayMode = computed(() => {
  if (!dbAgent.value) return 'new'

  const now = Date.now()
  // Add Z if no timezone to parse as UTC
  const updatedAtStr = dbAgent.value.updated_at.endsWith('Z') || dbAgent.value.updated_at.includes('+')
  ? dbAgent.value.updated_at
  : dbAgent.value.updated_at + 'Z'
  const updatedAt = new Date(updatedAtStr).getTime()
  const minutesSinceUpdate = (now - updatedAt) / (1000 * 60)
  const daysUntilExpiry = (dbAgent.value.agent_valid_until - now) / (1000 * 60 * 60 * 24)

  // Check if the agent_address from the database exists in the extraAgents list
  const agentExistsOnChain = extraAgents.value.some(a => a.address === dbAgent.value!.agent_address)

  // Case 3: cloned but builder not approved, or expiring soon (< 15 days)
  if (dbAgent.value.cloned && (!dbAgent.value.builder_approved_status || daysUntilExpiry < 15 || !agentExistsOnChain)) {
    return 'needs_reapprove'
  }

  // Case 1: cloned successfully
  if (dbAgent.value.cloned) {
    return 'cloned_done'
  }

  // Case 2: not cloned yet but updated recently (< 15 min)
  if (!dbAgent.value.cloned && minutesSinceUpdate < 15) {
    return 'cloning_in_progress'
  }

  // Case 4: not cloned and updated long ago (> 15 min)
  return 'needs_reapprove'
})

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
 * Fetch agent from database
 * Only throws (causing accountDataLoaded = false) if error is NOT 404 not found
 */
const fetchAgentFromDB = async (addr: string) => {
  try {
    const res = await fetch(`${import.meta.env.VITE_AGENTS_BACKEND}/api/get_agent/${addr}`, {headers: {'X-API-Key': import.meta.env.VITE_AGENTS_BACKEND_API_KEY}})
    
    if (res.ok) {
      dbAgent.value = await res.json()
      return
    }

    const error = await res.json()

    // 404 not found = new user, not an error
    if (res.status === 404 && error.detail?.includes('not found')) {
      dbAgent.value = null
      return
    }

    // Any other error = real problem
    throw new Error(error.detail || 'Failed to fetch agent from database')
  } catch (e: any) {
    // If it's our own thrown error (non-404), re-throw to fail accountDataLoaded
    if (e.message !== 'Failed to fetch agent from database') {
      // Network error or unexpected
      throw new Error(e.message || 'Failed to connect to database')
    }
    throw e
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
    const maxFeeRate = '0.1%'
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
    const response = await fetch(`${import.meta.env.VITE_AGENTS_BACKEND}/api/add_agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': import.meta.env.VITE_AGENTS_BACKEND_API_KEY
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
        builder_approved_status: true
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to save agent')
    }

    const data = await response.json()
    // console.log('Agent saved successfully:', data)
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

const handleUnclone = async () => {
  uncloneStatus.value = 'pending'
  try {
    const res = await fetch(`${import.meta.env.VITE_AGENTS_BACKEND}/api/unclone_and_remove_agents?connected_address=${connectedAddress.value}`, {
      method: 'POST',
      headers: { 'X-API-Key': import.meta.env.VITE_AGENTS_BACKEND_API_KEY }
    })
    const data = await res.json()
    if (!res.ok) {
      uncloneStatus.value = 'idle'
      uncloneStatusMessage.value = data.detail || 'Failed to remove agent'
      return
    }
    uncloneStatus.value = 'success'
    uncloneStatusMessage.value = data.message || 'Agent removed successfully'
    setTimeout(async () => {
      uncloneStatusMessage.value = ''
      uncloneStatus.value = 'idle'
      await disconnect()
    }, 3000)
  } catch (e: any) {
    uncloneStatus.value = 'idle'
    uncloneStatusMessage.value = e.message || 'Failed to remove agent'
  }
}

watch(connectedAddress, async (addr) => {
  if (addr) {
    accountDataLoaded.value = false
    dbAgent.value = null
    try {
      connectionError.value = ''
      await Promise.all([
        fetchBalance(addr),
        fetchExtraAgents(addr).catch(() => { extraAgents.value = [] }),
        fetchAgentFromDB(addr).catch((e: any) => { throw e }), // fetchAgentFromDB: only throws on non-404 errors
      ])

      // After all (Promise.all) data loaded, now dbDisplayMode is correct (extraAgents is ready), If DB has agent data, pre-populate approvedAgentDetails and keys
      if (dbAgent.value && ['cloned_done', 'cloning_in_progress'].includes(dbDisplayMode.value)) {
        agentPrivateKey.value = dbAgent.value.agent_private_key
        agentAddress.value = dbAgent.value.agent_address
        approvedAgentDetails.value = {
          name: dbAgent.value.agent_name,
          address: dbAgent.value.agent_address,
          validUntil: dbAgent.value.agent_valid_until
        }
        signatureStatus.value = 'success'
        builderFeeStatus.value = 'success'
      }

      accountDataLoaded.value = true
      // Auto trigger agent approval after successful connection
      // await approveAgent(addr)
    } catch (e: any) {
      connectionError.value = e.message || 'Failed to fetch account data'
      await disconnect()
    }
  } else {
    balance.value = ''
    dbAgent.value = null
    signatureStatus.value = 'idle'
    builderFeeStatus.value = 'idle'
    uncloneStatus.value = 'idle'
    connectionError.value = ''
    agentError.value = ''
    builderError.value = ''
    agentStatusMessage.value = ''
    builderStatusMessage.value = ''
    uncloneStatusMessage.value = ''
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
    <div class="text-center space-y-8 mb-2">
      <h1>❢ this part is developing... don't try...</h1>
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
    <UCard v-if="showStartCard" class="p-1">
      <div class="flex flex-col items-center gap-6">
        <p class="text-sm text-neutral-600 dark:text-neutral-400 text-center">
          Let's Do It
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
              <span v-if="Number(balance) < 150" class="text-xs">
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
            <h3 v-if="signatureStatus === 'success'" class="text-xl font-semibold">
              <span class="text-green-500 mr-5">✓</span>2. Agent Approved
            </h3>
            <h3 v-else-if="signatureStatus === 'error'" class="text-xl font-semibold">
              <span class="text-red-500 mr-5">✗</span>2. Agent Approval Failed
            </h3>
            <h3 v-else class="text-xl font-semibold">
              <span class="text-yellow-500 mr-5">□</span>2. Waiting for Agent Approval
            </h3>
          </div>
        </template>

        <div class="space-y-3">
          <!-- Show button only when not success and mode is new/needs_reapprove -->
          <template v-if="signatureStatus !== 'success'">
            <p class="text-sm text-neutral-600 dark:text-neutral-400 leading-loose">
              Please approve the trading agent in your wallet.
            </p>
            <UButton 
              color="primary"
              size="xl"
              @click="approveAgent(connectedAddress)"
            >
              Approve Agent
            </UButton>
          </template>

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
            <h3 v-if="builderFeeStatus === 'success'" class="text-xl font-semibold">
              <span class="text-green-500 mr-5">✓</span>3. Fee Share Approved
            </h3>
            <h3 v-else-if="builderFeeStatus === 'error'" class="text-xl font-semibold">
              <span class="text-red-500 mr-5">✗</span>3. Fee Share Approval Failed
            </h3>
            <h3 v-else class="text-xl font-semibold">
              <span class="text-yellow-500 mr-5">□</span>3. Waiting for Fee Share Approval
            </h3>
          </div>
        </template>

        <div class="space-y-3">
          <!-- Show button only when not success and mode requires action -->
          <template v-if="builderFeeStatus !== 'success'">
            <p class="text-sm text-neutral-600 dark:text-neutral-400 leading-loose">
              Please approve the fee share in your wallet.
            </p>
            <UButton 
              color="primary"
              size="xl"
              @click="approveBuilderFee"
            >
              Approve Fee Share
            </UButton>
          </template>

          <div v-if="builderFeeStatus === 'pending' && builderStatusMessage" class="text-sm text-yellow-500">
            {{ builderStatusMessage }}
          </div>

          <div v-if="builderFeeStatus === 'error'" class="space-y-2">
            <div class="flex items-center gap-2 text-red-500">
              <span>✗</span>
              <span class="text-sm">Fee share approval failed</span>
            </div>
            <p class="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 p-3 rounded">
              {{ builderError }}
            </p>
          </div>

          <div v-if="builderFeeStatus === 'success'" class="bg-green-50 dark:bg-green-950/30 rounded p-4 space-y-3">
            <div class="flex items-center gap-2 text-green-700 dark:text-green-400">
              <span>✓</span>
              <h4 class="font-semibold">
                <!-- Case 1: fully cloned -->
                <template v-if="dbDisplayMode === 'cloned_done'">All set!</template>
                <!-- Case 2: cloning in progress -->
                <template v-else>Setup Complete!</template>
              </h4>
            </div>
            <p class="text-sm text-neutral-700 dark:text-neutral-300">
              <template v-if="dbDisplayMode === 'cloned_done'">
                The cloning process is finished. Your dashboard is live and ready.
              </template>
              <template v-else>
                Your setup is complete. The cloning process has started and will be available shortly at your dashboard.
              </template>
            </p>
            <p class="text-xs text-neutral-600 dark:text-neutral-400 font-mono bg-white dark:bg-neutral-900 p-3 rounded flex items-center justify-between">
              <span class="text-left">Dashboard URL: <a :href="dashboardUrl" target="_blank" rel="noopener noreferrer" class="underline hover:opacity-80">{{ dashboardUrl }}</a></span>
              <UButton
                v-if="dbDisplayMode === 'cloned_done'"
                color="error"
                size="xs"
                :loading="uncloneStatus === 'pending'"
                @click="handleUnclone"
              >
                Uncloning
              </UButton>
            </p>
            <p v-if="uncloneStatusMessage" :class="uncloneStatus === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-500'" class="text-xs">{{ uncloneStatusMessage }}</p>
          </div>
        </div>
      </UCard>

    </template>

    <!-- Readme -->
    <UCard class="mt-4 text-left">
      <template #header>
        <h3 class="text-xl font-semibold"><span class="mr-5">ⓘ</span>README</h3>
      </template>
      <ol class="space-y-4 text-sm text-neutral-600 dark:text-neutral-400 list-disc list-inside">
        <li><span class="text-neutral-800 dark:text-neutral-200 font-semibold text-md">Connect Wallet:</span> Your wallet address is used to identify your agent. No funds are transferred - your account is managed as <span class="text-yellow-500 font-semibold">non-custodial</span> by the agent.</li>
        <li><span class="text-neutral-800 dark:text-neutral-200 font-semibold text-md">Approve Agent:</span> A dedicated trading agent is approved on Hyperliquid to execute trades on your behalf. Valid for 180 days.</li>
        <li><span class="text-neutral-800 dark:text-neutral-200 font-semibold text-md">Approve Fee Share:</span> You approve a max 0.1% fee, which allows agent to operate. This is a native management fee mechanism - no extra charges.</li>
        <li><span class="text-neutral-800 dark:text-neutral-200 font-semibold text-md">Cloning:</span> After approvals, your personal ftb instance is cloned with its own dashboard to monitor trades and metrics. Cloning preparation takes less than 3 minutes.</li>
        <li><span class="text-neutral-800 dark:text-neutral-200 font-semibold text-md">Revoking either approval will trigger uncloning:</span> Your ftb instance will be uncloned automatically.</li>
        <li><span class="text-neutral-800 dark:text-neutral-200 font-semibold text-md">Agent expiry causes uncloning:</span> If you don't renew your agent before it expires, your instance will be shut down automatically.</li>
        <li><span class="text-neutral-800 dark:text-neutral-200 font-semibold text-md">Open positions are NOT managed or closed during uncloning:</span> Make sure to handle them manually.</li>
        <li><span class="text-neutral-800 dark:text-neutral-200 font-semibold text-md">You can reconnect wallet anytime:</span> Click the Start button and connect wallet to check approval status or renew your agent.</li>
        <li><span class="text-neutral-800 dark:text-neutral-200 font-semibold text-md">Minimum balance:</span> ftb can manage up to 12 trading pairs simultaneously for now. Assuming the minimum Hyperliquid futures trade is ~$12, a USDC Perp balance of at least <span class="text-yellow-500 font-semibold">$150</span> is recommended to allow full capacity operation.</li>
        <li><span class="text-neutral-800 dark:text-neutral-200 font-semibold text-md">Verify agent activity:</span> All trades executed by your agent are fully transparent and verifiable on-chain. You can audit your agent's performance and trade history via <a :href="`https://app.coinmarketman.com/hypertracker/wallet/${wallet}`" target="_blank" rel="noopener noreferrer" class="text-yellow-500 underline hover:opacity-80">Tracker</a>.</li>
      </ol>
    </UCard>
  </div>
</template>