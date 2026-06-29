import { createAppKit } from '@reown/appkit/vue'
import { arbitrum, type AppKitNetwork } from '@reown/appkit/networks'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'

// 1. Get projectId from https://dashboard.reown.com
const projectId = import.meta.env.VITE_REOWN_PROJECT_ID

// 2. Create a metadata object
const metadata = {
  name: 'ftb',
  description: 'Cloning FTB – DeFi Manager',
  url: window.location.origin, // origin must match your domain & subdomain
  icons: ['https://i.ibb.co/kVMyC93X/ftb-logo-mask.png']
}

// 3. Set the networks
const networks: [AppKitNetwork, ...AppKitNetwork[]] = [arbitrum]

// 4. Create Wagmi Adapter
const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId
})

// 5. Create the modal
const modal = createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata,
  enableWallets: true,
  enableNetworkSwitch: false,
  enableReconnect: false,
  enableMobileFullScreen: false,
  enableWalletGuide: false,
  features: {
    analytics: false,
    swaps: false,
    onramp: false,
    connectMethodsOrder: ["wallet"],
  },
  themeVariables: {
    "--apkt-font-family": "monospace",
    "--apkt-accent": "primary",
    "--apkt-border-radius-master": "4px",
  },
})

export { modal, wagmiAdapter }
