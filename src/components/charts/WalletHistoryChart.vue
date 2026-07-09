<script setup lang="ts">
import ECharts from 'vue-echarts';

import { use } from 'echarts/core';
import { format as echartsFormat } from 'echarts';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
  MarkLineComponent,
  TransformComponent,
} from 'echarts/components';

import type { WalletHistoryPerBot } from '@/types';
import type { EChartsOption, MarkLineComponentOption } from 'echarts';
import { useAgentsStore } from '@/stores/agents'

const agentsStore = useAgentsStore()
const wallet = computed(() => {
  if (agentsStore.loading) return null
  return agentsStore.currentAgentAddress || import.meta.env.VITE_WALLET
})

use([
  LineChart,
  CanvasRenderer,
  DatasetComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
  MarkLineComponent,
  TransformComponent,
]);

const colorStore = useColorStore();
// Define Column labels here to avoid typos
const CHART_WALLET_HISTORY = 'Wallet history';
const SERIES_COLORS = ['#1d4ed8', '#d931e5', '#059669', '#b45309', '#be123c', '#7c3aed', '#0f766e'];

const props = withDefaults(
  defineProps<{
    walletData: WalletHistoryPerBot;
    showTitle?: boolean;
  }>(),
  {
    showTitle: true,
  },
);

const settingsStore = useSettingsStore();
const legendSelection = ref<Record<string, boolean>>({});

const handleLegendSelectChanged = (params: { selected: Record<string, boolean> }) => {
  legendSelection.value = params.selected;
};

const hasWalletData = computed(() =>
  Object.values(props.walletData).some(
    (history) => Array.isArray(history.data) && history.data.length > 0,
  ),
);

const walletHistoryOptions: ComputedRef<EChartsOption> = computed(() => {
  const walletEntries = Object.entries(props.walletData).filter(
    ([, history]) => Array.isArray(history?.data) && history.data.length > 0,
  );

  if (walletEntries.length === 0) {
    return {};
  }

  const dataset: EChartsOption['dataset'] = [];
  const series: EChartsOption['series'] = [];
  const visualMap: EChartsOption['visualMap'] = [];
  const legendData: string[] = [];
  const selectedBotIds = walletEntries
    .map(([botId]) => botId)
    .filter((botId) => legendSelection.value[botId] ?? true);
  const useProfitLossVisualMap = selectedBotIds.length === 1;
  const selectedBotId = selectedBotIds[0];
  const captureLineColor = settingsStore.chartTheme === 'dark' ? '#c2c2c2' : '#4b5563';

  walletEntries.forEach(([botId, history], botIndex) => {
    // const botName = history.botName ?? botId;
    const botName = import.meta.env.VITE_DEFAULT_BOT_NAME || history.botName;
    const colDate = history.columns.findIndex((el) => el === '__date_ts');
    const colTotal = history.columns.findIndex((el) => el === 'total_quote');
    const startingField = history.data[0];
    if (!startingField || colDate < 0 || colTotal < 0) {
      return;
    }

    const startingValue = startingField[colTotal] as number;
    const captureStartTs = history.capture_start_ts ?? 0;
    const firstTimestamp = Number(startingField[colDate]);
    const shouldShowCaptureLine =
      captureStartTs > 0 && Number.isFinite(firstTimestamp) && captureStartTs !== firstTimestamp;

    const sourceDatasetIndex = dataset.length;
    const postCaptureDatasetIndex = sourceDatasetIndex + 1;
    const preCaptureDatasetIndex = sourceDatasetIndex + 2;
    const seriesStartIndex = series.length + 1; // +1 to account for the dummy series inserted below
    const seriesColor = SERIES_COLORS[botIndex % SERIES_COLORS.length];

    dataset.push(
      { source: history.data },
      {
        fromDatasetIndex: sourceDatasetIndex,
        transform: {
          // post capture start
          type: 'filter',
          config: { dimension: colDate, gte: captureStartTs - 1 },
        },
      },
      {
        fromDatasetIndex: sourceDatasetIndex,
        transform: {
          // pre capture start
          type: 'filter',
          config: { dimension: colDate, lte: captureStartTs + 1 },
        },
      },
    );

    const markLineData: MarkLineComponentOption['data'] = [
      {
        name: 'Starting balance',
        yAxis: startingValue,
        emphasis: { disabled: true },
        label: {
          show: true,
          position: 'insideStartTop',
          formatter: `Starting balance ${botName}`,
          color: captureLineColor,
        },
      },
      {
        name: 'Zero',
        label: {
          show: false,
        },
        emphasis: { disabled: true },
        lineStyle: {
          type: 'solid',
        },
        yAxis: 0,
      },
    ];

    if (shouldShowCaptureLine) {
      markLineData.push({
        name: 'Capture start',
        xAxis: captureStartTs,
        emphasis: { disabled: true },
        label: {
          show: true,
          position: 'insideEndTop',
          formatter: `Capture start ${botName}`,
          color: captureLineColor,
        },
        lineStyle: {
          type: 'dotted',
          color: captureLineColor,
          width: 1,
        },
      });
    }

    legendData.push(botName);

    if (useProfitLossVisualMap && selectedBotId === botId) {
      visualMap.push({
        show: false,
        seriesIndex: [seriesStartIndex, seriesStartIndex + 1],
        dimension: colTotal,
        pieces: [
          {
            gte: startingValue,
            color: colorStore.colorProfit,
          },
          {
            gt: startingValue - 0.01,
            lt: startingValue + 0.01,
            color: colorStore.colorProfit,
          },
          {
            lt: startingValue - 0.01,
            color: colorStore.colorLoss,
          },
        ],
      });
    }

    series.push(
      { type: 'line', data: [] },
      // Empty, hidden series to stabilize data zoom
      // https://github.com/apache/echarts/issues/21245
      {
        type: 'line',
        name: botName,
        showSymbol: false,
        color: seriesColor,
        datasetIndex: postCaptureDatasetIndex,
        encode: {
          x: colDate,
          y: colTotal,
        },
        lineStyle: {
          type: 'solid',
        },
        markLine: {
          symbol: 'none',
          animation: false,
          data: markLineData,
        },
      },
      {
        type: 'line',
        name: botName,
        showSymbol: false,
        lineStyle: {
          type: 'dashed',
        },
        color: seriesColor,
        datasetIndex: preCaptureDatasetIndex,
        encode: {
          x: colDate,
          y: colTotal,
        },
      },
    );
  });

  if (series.length === 0) {
    return {};
  }

  const option: EChartsOption = {
    title: {
      text: 'Wallet Balance',
      left: 'center',
      show: props.showTitle,
    },
    backgroundColor: 'rgba(0, 0, 0, 0)',
    dataset,
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'line',
        label: {
          backgroundColor: '#6a7985',
        },
      },
      formatter: (params) => {
        const seriesParams = Array.isArray(params) ? params : [params];
        if (seriesParams.length === 0) {
          return '';
        }

        const firstPoint = seriesParams[0] as { data: unknown[]; encode?: { x?: number[] } };
        const xIdx = firstPoint.encode?.x?.[0] ?? 0;
        const label = `${timestampms(Number(firstPoint.data[xIdx]))}`;
        const lines = seriesParams.map((seriesPoint) => {
          const typedPoint = seriesPoint as {
            marker: string;
            seriesName: string;
            data: unknown[];
            encode?: { y?: number[] };
          };
          const yIdx = typedPoint.encode?.y?.[0] ?? 0;
          const walletHistory = Number(typedPoint.data[yIdx]);
          return `${typedPoint.marker}${echartsFormat.encodeHTML(typedPoint.seriesName)}: ${echartsFormat.encodeHTML(formatPrice(walletHistory, 3))}`;
        });

        return `${label}<br />${lines.join('<br />')}`;
      },
    },
    grid: {
      ...echartsGridDefault,
    },
    legend: {
      data: legendData,
      right: '5%',
      top: 0,
      show: walletEntries.length > 1,
      selectedMode: true,
      selected: legendSelection.value,
    },
    xAxis: [
      {
        type: 'time',
        axisLine: { onZero: false },
        axisPointer: {
          label: { show: false },
        },
        // position: 'top',
      },
    ],
    yAxis: [
      {
        type: 'value',
        name: CHART_WALLET_HISTORY,
        splitLine: {
          show: false,
        },
        nameRotate: 90,
        nameLocation: 'middle',
        axisLabel: {
          formatter: (value) => {
            return formatPrice(value, 2);
          },
        },
        nameGap: 35,
        min: 'dataMin',
        max: 'dataMax',
      },
    ],
    dataZoom: [
      {
        type: 'inside',
        start: 0,
        end: 100,
      },
      {
        bottom: 10,
        start: 0,
        end: 100,
        ...dataZoomPartial,
      },
    ],
    visualMap,
    series,
  };
  // console.log('Wallet balance chart options', option);
  return option;
});



const hyperliquidWalletData = ref<WalletHistoryPerBot>({});

// Find the earliest timestamp from the original walletData
const earliestWalletDataTs = computed(() => {
  let minTs = Infinity;
  Object.values(props.walletData).forEach((history) => {
    if (Array.isArray(history?.data)) {
      history.data.forEach((row) => {
        const tsIndex = history.columns.indexOf('__date_ts');
        if (tsIndex >= 0 && row[tsIndex] < minTs) {
          minTs = Number(row[tsIndex]);
        }
      });
    }
  });
  return minTs === Infinity ? 0 : minTs - (72 * 60 * 60 * 1000);
});

const fetchHyperliquidWalletHistory = async (address: string) => {
  try {
    const response = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'portfolio', user: address }),
    });

    if (!response.ok) {
      throw new Error(`Hyperliquid API responded with HTTP ${response.status}`);
    }

    const portfolio = (await response.json()) as [
      string,
      { accountValueHistory: [number, string][]; pnlHistory: [number, string][]; vlm: string },
    ][];

    const perpAllTimeEntry = Array.isArray(portfolio)
      ? portfolio.find(([periodName]) => periodName === 'perpAllTime')
      : undefined;

    const accountValueHistory: [number, string][] = perpAllTimeEntry?.[1]?.accountValueHistory ?? [];

    // Reshape into the same [date, __date_ts, total_quote] row format as props.walletData
    const transformedData = accountValueHistory
      .slice()
      .sort((a, b) => a[0] - b[0]) // ensure ascending order by timestamp, just in case
      .filter(([tsMs]) => tsMs >= earliestWalletDataTs.value) // Filter out data before original walletData start
      .map(([tsMs, value]) => {
        const isoDate = new Date(tsMs).toISOString().slice(0, 19); // '2026-06-03T00:00:00' style
        return [isoDate, tsMs, Number(value)];
      });

    hyperliquidWalletData.value = {
      [address]: {
        botName: `Hyperliquid ${address.slice(0, 6)}...${address.slice(-4)}`,
        capture_start_ts: 0,
        columns: ['date', '__date_ts', 'total_quote'],
        data: transformedData,
      },
    };

  } catch (error) {
    hyperliquidWalletData.value = {};
  }
};

watch([wallet, earliestWalletDataTs], ([address, earliestTs]) => {
  if (address && earliestTs > 0) {
    fetchHyperliquidWalletHistory(address);
  }
}, { immediate: true });

const hasWalletData2 = computed(() =>
  Object.values(hyperliquidWalletData.value).some(
    (history) => Array.isArray(history.data) && history.data.length > 0,
  ),
);

const walletHistoryOptions2: ComputedRef<EChartsOption> = computed(() => {
  const walletEntries = Object.entries(hyperliquidWalletData.value).filter(
    ([, history]) => Array.isArray(history?.data) && history.data.length > 0,
  );

  if (walletEntries.length === 0) {
    return {};
  }

  const walletEntries2 = Object.entries(props.walletData).filter(
    ([, history]) => Array.isArray(history?.data) && history.data.length > 0,
  );

  if (walletEntries2.length === 0) {
    return {};
  }

  const dataset: EChartsOption['dataset'] = [];
  const series: EChartsOption['series'] = [];
  const visualMap: EChartsOption['visualMap'] = [];
  const legendData: string[] = [];
  const selectedBotIds = walletEntries
    .map(([botId]) => botId)
    .filter((botId) => legendSelection.value[botId] ?? true);
  const useProfitLossVisualMap = selectedBotIds.length === 1;
  const selectedBotId = selectedBotIds[0];
  const captureLineColor = settingsStore.chartTheme === 'dark' ? '#c2c2c2' : '#4b5563';

  // Map to store peak values per series for tooltip reference
  const peakValuesMap: Record<string, number> = {};

  walletEntries.forEach(([botId, history], botIndex) => {
    const botName = import.meta.env.VITE_DEFAULT_BOT_NAME || history.botName;
    const colDate = history.columns.findIndex((el) => el === '__date_ts');
    const colTotal = history.columns.findIndex((el) => el === 'total_quote');
    const walletEntry2 = walletEntries2[botIndex];
    const startingField = walletEntry2 ? walletEntry2[1].data[0] : history.data[0];
    if (!startingField || colDate < 0 || colTotal < 0) {
      return;
    }

    const startingValue = startingField[colTotal] as number;
    const captureStartTs = history.capture_start_ts ?? 0;
    const firstTimestamp = Number(startingField[colDate]);
    const shouldShowCaptureLine =
      captureStartTs > 0 && Number.isFinite(firstTimestamp) && captureStartTs !== firstTimestamp;

    const sourceDatasetIndex = dataset.length;
    const postCaptureDatasetIndex = sourceDatasetIndex + 1;
    const preCaptureDatasetIndex = sourceDatasetIndex + 2;
    const seriesStartIndex = series.length + 1; // +1 to account for the dummy series inserted below
    const seriesColor = SERIES_COLORS[botIndex % SERIES_COLORS.length];

    // Find the peak (max) value in the series and its timestamp
    let peakValue = startingValue;
    let peakTs = firstTimestamp;
    history.data.forEach((row) => {
      const val = row[colTotal] as number;
      if (val > peakValue) {
        peakValue = val;
        peakTs = Number(row[colDate]);
      }
    });
    const lastRow = history.data[history.data.length - 1];
    const lastValue = lastRow[colTotal] as number;
    const lastTs = Number(lastRow[colDate]);
    peakValuesMap[botName] = [peakValue, peakTs];

    dataset.push(
      { source: history.data },
      {
        fromDatasetIndex: sourceDatasetIndex,
        transform: {
          type: 'filter',
          config: { dimension: colDate, gte: captureStartTs - 1 },
        },
      },
      {
        fromDatasetIndex: sourceDatasetIndex,
        transform: {
          type: 'filter',
          config: { dimension: colDate, lte: captureStartTs + 1 },
        },
      },
    );

    const markLineData: MarkLineComponentOption['data'] = [
      {
        name: 'Starting balance',
        yAxis: startingValue,
        emphasis: { disabled: true },
        label: {
          show: true,
          position: 'insideStartTop',
          formatter: `Starting balance ${botName}`,
          color: captureLineColor,
        },
      },
      {
        name: 'Zero',
        label: { show: false },
        emphasis: { disabled: true },
        lineStyle: { type: 'solid' },
        yAxis: 0,
      },
    ];

    if (shouldShowCaptureLine) {
      markLineData.push({
        name: 'Capture start',
        xAxis: captureStartTs,
        emphasis: { disabled: true },
        label: {
          show: true,
          position: 'insideEndTop',
          formatter: `Capture start ${botName}`,
          color: captureLineColor,
        },
        lineStyle: {
          type: 'dotted',
          color: captureLineColor,
          width: 1,
        },
      });
    }

    // Peak-to-end horizontal line: extends horizontally from the peak value to the end of the chart to show drawdown
    if (peakTs !== lastTs) {
      markLineData.push([
        {
          name: 'Peak to end',
          xAxis: peakTs,
          yAxis: peakValue,
          symbol: 'circle',
          symbolSize: 6,
          emphasis: { disabled: true },
          label: {
            show: true,
            position: 'insideStartTop',
            formatter: `Peak balance ${botName}`,
            color: captureLineColor,
          },
          lineStyle: {
            type: 'dashed',
            color: colorStore.colorLoss,
            width: 1,
          },
        },
        {
          xAxis: 'max',
          yAxis: peakValue,
          symbol: 'none',
        },
      ]);
    }

    legendData.push(botName);

    if (useProfitLossVisualMap && selectedBotId === botId) {
      visualMap.push({
        show: false,
        seriesIndex: [seriesStartIndex, seriesStartIndex + 1],
        dimension: colTotal,
        pieces: [
          { gte: startingValue, color: colorStore.colorProfit },
          { gt: startingValue - 0.01, lt: startingValue + 0.01, color: colorStore.colorProfit },
          { lt: startingValue - 0.01, color: colorStore.colorLoss },
        ],
      });
    }

    series.push(
      { type: 'line', data: [] }, // Empty, hidden series to stabilize data zoom
      // https://github.com/apache/echarts/issues/21245
      {
        type: 'line',
        name: botName,
        showSymbol: false,
        color: seriesColor,
        datasetIndex: postCaptureDatasetIndex,
        encode: { x: colDate, y: colTotal },
        lineStyle: { type: 'solid' },
        markLine: {
          symbol: 'none',
          animation: false,
          data: markLineData,
        },
      },
      {
        type: 'line',
        name: botName,
        showSymbol: false,
        lineStyle: { type: 'dashed' },
        color: seriesColor,
        datasetIndex: preCaptureDatasetIndex,
        encode: { x: colDate, y: colTotal },
      },
    );
  });

  if (series.length === 0) {
    return {};
  }

  const option: EChartsOption = {
    title: {
      text: 'Wallet Balance (Hyperliquid Futures)',
      left: 'center',
      show: props.showTitle,
    },
    backgroundColor: 'rgba(0, 0, 0, 0)',
    dataset,
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'line',
        label: { backgroundColor: '#6a7985' },
      },
      formatter: (params) => {
        const seriesParams = Array.isArray(params) ? params : [params];
        if (seriesParams.length === 0) {
          return '';
        }
        const firstPoint = seriesParams[0] as { data: unknown[]; encode?: { x?: number[] } };
        const xIdx = firstPoint.encode?.x?.[0] ?? 0;
        const label = `${timestampms(Number(firstPoint.data[xIdx]))}`;
        const lines = seriesParams.map((seriesPoint) => {
          const typedPoint = seriesPoint as { marker: string; seriesName: string; data: unknown[]; encode?: { y?: number[] } };
          const yIdx = typedPoint.encode?.y?.[0] ?? 0;
          const walletHistory = Number(typedPoint.data[yIdx]);
          const seriesName = typedPoint.seriesName;
          
          // Calculate Drawdown from Peak for tooltip
          const [peak, peakTs] = peakValuesMap[seriesName] ?? [0, 0];
          const currentTs = Number(typedPoint.data[xIdx]);
          let drawdownStr = '';

          if (currentTs >= peakTs && peak > 0) {
            const dd = Math.max(0, peak - walletHistory);
            drawdownStr = `<br />dd from peak: ${formatPrice(dd, 2)} (${((dd / peak) * 100).toFixed(2)}%)`;
          }
          
          return `${typedPoint.marker}${echartsFormat.encodeHTML(seriesName)}: ${echartsFormat.encodeHTML(formatPrice(walletHistory, 3))}${drawdownStr}`;
        });
        return `${label}<br />${lines.join('<br />')}`;
      },
    },
    grid: { ...echartsGridDefault },
    legend: {
      data: legendData,
      right: '5%',
      top: 0,
      show: walletEntries.length > 1,
      selectedMode: true,
      selected: legendSelection.value,
    },
    xAxis: [
      {
        type: 'time',
        axisLine: { onZero: false },
        axisPointer: { label: { show: false } },
      },
    ],
    yAxis: [
      {
        type: 'value',
        name: CHART_WALLET_HISTORY,
        splitLine: { show: false },
        nameRotate: 90,
        nameLocation: 'middle',
        axisLabel: {
          formatter: (value) => formatPrice(value, 2),
        },
        nameGap: 35,
        min: 'dataMin',
        max: 'dataMax',
      },
    ],
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { bottom: 10, start: 0, end: 100, ...dataZoomPartial },
    ],
    visualMap,
    series,
  };

  return option;
});
</script>

<template>
  <!-- <ECharts
    v-if="hasWalletData"
    :option="walletHistoryOptions"
    :theme="settingsStore.chartTheme"
    @legendselectchanged="handleLegendSelectChanged"
    autoresize
  /> -->

  <ECharts
    v-if="hasWalletData2"
    :option="walletHistoryOptions2"
    :theme="settingsStore.chartTheme"
    @legendselectchanged="handleLegendSelectChanged"
    autoresize
  />
  <div v-else class="flex flex-col items-center justify-center h-full gap-2">
    <p class="text-gray-500">No historic wallet data available.</p>
    <!-- <p class="text-gray-500 text-sm">
      You may need to update your ftb version to have historic wallet balance data available.
    </p> -->
  </div>
</template>

<style lang="css" scoped>
.echarts {
  min-height: 150px;
  height: 100%;
  width: 100%;
}
</style>
