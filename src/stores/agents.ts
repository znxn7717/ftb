// stores/agents.ts
import { defineStore } from 'pinia'

export const useAgentsStore = defineStore('agents', () => {
  const agents = ref([])
  const loading = ref(false)
  const error = ref(null)

  const hostname = window.location.hostname
  const parts = hostname.toLowerCase().split('.')
  const currentSubdomain = computed(() => {
    if (parts.length !== 4) return null
    const subdomain = parts[0]
    const exists = agents.value.some(a => a.agent_name === subdomain)
    return exists ? subdomain : null
  })
  const currentAgentAddress = computed(() => {
    if (!currentSubdomain.value) return null
    const agent = agents.value.find(a => a.agent_name === currentSubdomain.value)
    return agent?.connected_address || null
  })

  async function fetchAgents() {
    loading.value = true
    error.value = null

    try {      
      const response = await fetch(`${import.meta.env.VITE_AGENTS_BACKEND}/api/get_agents`, {headers: {'X-API-Key': import.meta.env.VITE_AGENTS_BACKEND_API_KEY}})
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      agents.value = data.map(agent => ({
      ...agent,
      agent_name: agent.agent_name.replace('ftb_', '')
      }))
            
    } catch (e) {
      error.value = e.message || 'Failed to fetch agents'
      throw e
    } finally {
      loading.value = false
    }
  }

  return {
    agents,
    loading,
    currentSubdomain,
    currentAgentAddress,
    fetchAgents
  }
})