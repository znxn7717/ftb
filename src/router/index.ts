// src/router/index.ts
import type { RouteRecordRaw } from 'vue-router';
import { createRouter, createWebHistory } from 'vue-router';
import { useLoginInfo } from '@/composables/loginInfo';

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/HomeView.vue'),
    meta: {
      allowAnonymous: true,
    },
  },
  {
    path: '/trade',
    name: 'ftb Trading',
    component: () => import('@/views/TradingView.vue'),
  },
  {
    path: '/graph',
    name: 'Freqtrade Graph',
    component: () => import('@/views/ChartsView.vue'),
  },
  {
    path: '/logs',
    name: 'Freqtrade Logs',
    component: () => import('@/views/LogView.vue'),
  },
  {
    path: '/backtest',
    name: 'Freqtrade Backtest',
    component: () => import('@/views/BacktestingView.vue'),
  },
  {
    path: '/dashboard',
    name: 'ftb Dashboard',
    component: () => import('@/views/DashboardView.vue'),
  },
  {
    path: '/balance',
    name: 'Freqtrade Balance',
    component: () => import('@/components/ftbot/BotBalance.vue'),
  },
  {
    path: '/open_trades',
    component: () => import('@/views/MobileTradesListView.vue'),
  },

  {
    path: '/trade_history',
    component: () => import('@/views/MobileTradesListView.vue'),
    props: { history: true },
  },
  {
    path: '/pairlist',
    component: () => import('@/components/ftbot/PairListLive.vue'),
  },
  {
    path: '/cloning',
    name: 'ftb Cloning',
    component: () => import('@/views/CloningView.vue'),
  },
  {
    path: '/settings',
    name: 'ftb Settings',
    component: () => import('@/views/SettingsView.vue'),
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/LoginView.vue'),
    meta: {
      allowAnonymous: true,
    },
  },
  {
    path: '/pairlist_config',
    name: 'Pairlist Configuration',
    component: () => import('@/views/PairlistConfigView.vue'),
  },
  {
    path: '/download_data',
    name: 'Download Data',
    component: () => import('@/views/DownloadDataView.vue'),
  },
  {
    path: '/(.*)*',
    name: '404',
    component: () => import('@/views/Error404View.vue'),
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});


router.beforeEach(async (to) => {
  // Init bots here...
  initBots();
  const botStore = useBotStore();
  const agentsStore = useAgentsStore();

  // Auto-login if enabled
  const isAutoLogin = import.meta.env.VITE_AUTO_LOGIN === 'true';

  if (isAutoLogin && !botStore.hasBots) {

    if (agentsStore.agents.length === 0) {
      try {
        await agentsStore.fetchAgents();
      } catch (e) {
        console.error('Failed to fetch agents:', e);
      }
    }

    const defaultApiUrl = import.meta.env.VITE_DEFAULT_API_URL || window.location.origin;
    const apiUrl = agentsStore.currentSubdomain
      ? defaultApiUrl.replace('://', `://${agentsStore.currentSubdomain}-`)
      : defaultApiUrl;

    const { login } = useLoginInfo(botStore.nextBotId);
    await login({
      botName: import.meta.env.VITE_DEFAULT_BOT_NAME || 'ftb',
      url: apiUrl,
      username: import.meta.env.VITE_DEFAULT_USERNAME || 'ft',
      password: import.meta.env.VITE_DEFAULT_PASSWORD || '',
    });
    botStore.addBot({
      botName: import.meta.env.VITE_DEFAULT_BOT_NAME || 'ftb',
      botId: botStore.nextBotId,
      botUrl: apiUrl,
      sortId: 1,
    });
    botStore.selectBot(botStore.nextBotId);
  }

  if (isAutoLogin && to.path === '/') {
    return { path: '/dashboard', query: to.query };
  }

  if (isAutoLogin && (to.path === '/graph' || to.path === '/logs' || to.path === '/backtest' || to.path === '/balance' || to.path === '/open_trades' || to.path === '/trade_history' || to.path === '/pairlist' || to.path === '/login' || to.path === '/pairlist_config' || to.path === '/download_data')) {
    return { name: '404' };
  }

  if (!to.meta?.allowAnonymous && !botStore.hasBots) {
    // Forward to login if login is required
    return {
      path: '/login',
      query: { redirect: to.fullPath },
    };
  } else {
    return true;
  }
});

export default router;
