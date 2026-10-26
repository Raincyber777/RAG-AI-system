<script setup lang="ts">
/**
 * 数据看板：学习数据总览（全部实时数据）
 * - 指标卡：课堂总数 / 累计追问 / 练习题量 / 错题记录
 * - 每日追问趋势（近 14 天折线）· 上传类型占比（环形）· 高频知识点 TOP10（条形）· 热门追问词云
 * 以上均来自 /stats/summary/ 个人统计的实时聚合，无数据时展示空态提示
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import AppIcon from '@/components/AppIcon.vue'
import { statsApi, type DashboardCharts } from '@/api'
import { isGuest } from '@/store/auth'

// ---------- 指标卡（数值来自 /stats/summary/ 个人统计，未加载 / 加载失败时按 0 展示） ----------
const metrics = ref([
  { label: '课堂总数', value: '0', unit: '节', delta: '我的全部课堂纪要', tint: 'tint-sky', icon: 'book' },
  { label: '累计追问', value: '0', unit: '次', delta: '全部课堂问答记录', tint: 'tint-lavender', icon: 'headphones' },
  { label: '练习题量', value: '0', unit: '题', delta: '题库中的自创题总数', tint: 'tint-mint', icon: 'edit' },
  { label: '错题记录', value: '0', unit: '题', delta: '错题本中的待巩固题目', tint: 'tint-peach', icon: 'flag' },
])

// ---------- 图表实时数据（summary 返回的 charts 聚合；null = 未加载 / 加载失败 → 空态） ----------
const chartsData = ref<DashboardCharts | null>(null)
const trendDelta = computed(() => chartsData.value?.trend_delta ?? null)
const trendEmpty = computed(() => !chartsData.value || chartsData.value.daily.every((d) => !d.count))
const pieEmpty = computed(() => !chartsData.value || chartsData.value.materials.every((m) => !m.value))
const barEmpty = computed(() => !chartsData.value || !chartsData.value.top_points.length)
const cloudEmpty = computed(() => !chartsData.value || !chartsData.value.cloud.length)

const NOTION_PALETTE = ['#5645d4', '#7b3ff2', '#0075de', '#2a9d99', '#dd5b00', '#ff64c8']

// 词云：字号按命中次数在 13~28px 线性缩放，颜色循环主题色板
const cloudWords = computed(() => {
  const list = chartsData.value?.cloud ?? []
  const max = Math.max(...list.map((w) => w.count), 1)
  return list.map((w, i) => ({
    t: w.text,
    s: Math.round(13 + (w.count / max) * 15),
    c: NOTION_PALETTE[i % NOTION_PALETTE.length]!,
  }))
})

// ---------- ECharts：先建空实例保证布局，真实数据由 applyCharts 灌入 ----------
const trendRef = ref<HTMLDivElement>()
const pieRef = ref<HTMLDivElement>()
const barRef = ref<HTMLDivElement>()
let charts: echarts.ECharts[] = []

function initCharts() {
  if (trendRef.value) charts.push(echarts.init(trendRef.value))
  if (pieRef.value) charts.push(echarts.init(pieRef.value))
  if (barRef.value) charts.push(echarts.init(barRef.value))
}

function applyCharts(d: DashboardCharts) {
  const [trend, pie, bar] = charts

  // 折线：每日追问量趋势（近 14 天，缺的日子已由后端补 0）
  trend?.setOption({
    grid: { top: 36, left: 44, right: 16, bottom: 28 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: d.daily.map((p) => p.date), axisLine: { lineStyle: { color: '#c8c4be' } }, axisLabel: { color: '#787671' } },
    yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#ede9e4' } }, axisLabel: { color: '#787671' } },
    series: [
      {
        name: '追问量',
        type: 'line',
        data: d.daily.map((p) => p.count),
        smooth: true,
        symbolSize: 7,
        lineStyle: { width: 3, color: '#5645d4' },
        itemStyle: { color: '#5645d4' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(86,69,212,0.25)' },
            { offset: 1, color: 'rgba(86,69,212,0.02)' },
          ]),
        },
      },
    ],
  })

  // 环形：上传材料类型占比（0 值类不进图，避免空扇区与图例噪音）
  pie?.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} 份 ({d}%)' },
    legend: { bottom: 0, icon: 'circle', textStyle: { color: '#5d5b54', fontSize: 12 } },
    color: NOTION_PALETTE,
    series: [
      {
        type: 'pie',
        radius: ['52%', '74%'],
        center: ['50%', '44%'],
        itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 6 },
        label: { show: false },
        data: d.materials.filter((m) => m.value > 0),
      },
    ],
  })

  // 条形：高频知识点 TOP10（标签超长截短，完整名看 tooltip）
  bar?.setOption({
    grid: { top: 8, left: 104, right: 30, bottom: 8 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category',
      data: d.top_points.map((p) => p.label),
      inverse: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#37352f', fontSize: 12.5, formatter: (v: string) => (v.length > 8 ? v.slice(0, 8) + '…' : v) },
    },
    series: [
      {
        type: 'bar',
        data: d.top_points.map((p) => p.count),
        barWidth: 14,
        itemStyle: { borderRadius: 7, color: '#5645d4' },
        showBackground: true,
        backgroundStyle: { color: '#ede9e4', borderRadius: 7 },
      },
    ],
  })
}

function handleResize() {
  charts.forEach((c) => c.resize())
}

onMounted(async () => {
  initCharts()
  window.addEventListener('resize', handleResize)
  // 指标卡与四张图表均接入后端个人统计
  if (isGuest.value) return
  try {
    const s = await statsApi.summary()
    if (s.scope !== 'personal') return
    metrics.value[0]!.value = String(s.notes)
    metrics.value[1]!.value = String(s.qa_records)
    metrics.value[2]!.value = String(s.quiz_items)
    metrics.value[3]!.value = String(s.wrong_records)
    if (s.charts) {
      chartsData.value = s.charts
      applyCharts(s.charts)
    }
  } catch {
    // 后端不可达时保持空态
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  charts.forEach((c) => c.dispose())
  charts = []
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1 class="h2">数据看板</h1>
        <p class="text-sm">课堂处理量与追问活跃情况的实时展示</p>
      </div>
    </header>

    <!-- 指标卡 -->
    <div class="metric-grid">
      <div v-for="m in metrics" :key="m.label" class="metric-card card-hover" :class="m.tint">
        <div class="metric-icon"><AppIcon :name="m.icon" :size="20" /></div>
        <div class="metric-num">{{ m.value }}<span class="metric-unit">{{ m.unit }}</span></div>
        <div class="metric-label">{{ m.label }}</div>
        <div class="metric-delta">{{ m.delta }}</div>
      </div>
    </div>

    <!-- 图表区 -->
    <div class="chart-grid">
      <div class="card chart-card span-2">
        <div class="chart-head">
          <div>
            <div class="h4">每日追问量趋势</div>
            <div class="text-caption">近 14 天课堂追问次数</div>
          </div>
          <span v-if="trendDelta !== null" class="tag tag-purple">近7日 {{ trendDelta > 0 ? '+' : '' }}{{ trendDelta }}%</span>
        </div>
        <div class="chart-wrap">
          <div ref="trendRef" class="chart trend"></div>
          <div v-if="trendEmpty" class="chart-empty">{{ isGuest ? '登录后查看你的追问趋势' : '暂无追问数据，去「智能问答」提第一个问题吧' }}</div>
        </div>
      </div>

      <div class="card chart-card">
        <div class="chart-head">
          <div>
            <div class="h4">上传材料类型占比</div>
            <div class="text-caption">音频 / 视频 / 图片 / PPT / 其他 的分布</div>
          </div>
        </div>
        <div class="chart-wrap">
          <div ref="pieRef" class="chart pie"></div>
          <div v-if="pieEmpty" class="chart-empty">{{ isGuest ? '登录后查看材料分布' : '暂无材料，先到工作台上传生成一份纪要吧' }}</div>
        </div>
      </div>

      <div class="card chart-card span-2">
        <div class="chart-head">
          <div>
            <div class="h4">高频知识点 TOP10</div>
            <div class="text-caption">课堂追问中被检索最多的知识点</div>
          </div>
        </div>
        <div class="chart-wrap">
          <div ref="barRef" class="chart bar"></div>
          <div v-if="barEmpty" class="chart-empty">{{ isGuest ? '登录后查看高频知识点' : '暂无知识点命中，围绕纪要提问后自动统计' }}</div>
        </div>
      </div>

      <div class="card chart-card tint-cream">
        <div class="chart-head">
          <div>
            <div class="h4">热门追问词云</div>
            <div class="text-caption">字号代表追问热度</div>
          </div>
          <AppIcon name="spark" :size="18" class="muted" />
        </div>
        <div class="chart-wrap cloud-wrap">
          <div v-if="cloudEmpty" class="chart-empty">{{ isGuest ? '登录后查看热门追问' : '暂无追问记录，词云将随提问自动生成' }}</div>
          <div v-else class="cloud">
            <span
              v-for="w in cloudWords"
              :key="w.t"
              class="cloud-word"
              :style="{ fontSize: w.s + 'px', color: w.c, fontWeight: w.s > 20 ? 700 : 500 }"
            >{{ w.t }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 28px 32px 40px; max-width: 1200px; width: 100%; margin: 0 auto; }
.page-head { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 22px; }

.metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 18px; }
.metric-card { border-radius: var(--radius-lg); padding: 20px; transition: all 0.15s ease; }
.metric-icon {
  width: 40px; height: 40px; border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.65); display: flex; align-items: center; justify-content: center;
  color: var(--charcoal); margin-bottom: 14px;
}
.metric-num { font-size: 30px; font-weight: 700; letter-spacing: -1px; line-height: 1; }
.metric-unit { font-size: 13px; font-weight: 500; margin-left: 4px; color: var(--slate); }
.metric-label { font-size: 13px; font-weight: 600; margin-top: 8px; }
.metric-delta { font-size: 11.5px; color: var(--slate); opacity: 0.8; margin-top: 2px; }

.chart-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.chart-card { display: flex; flex-direction: column; }
.span-2 { grid-column: span 2; }
.chart-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
.chart-wrap { position: relative; }
.chart { width: 100%; }
.chart.trend { height: 260px; }
.chart.pie { height: 260px; }
.chart.bar { height: 260px; }
/* 无数据空态：盖在图表区上层的居中提示 */
.chart-empty {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  padding: 0 16px; text-align: center; line-height: 1.6;
  font-size: 13px; color: var(--stone);
}
.cloud-wrap { flex: 1; display: flex; }
.cloud {
  flex: 1; display: flex; flex-wrap: wrap; align-items: center; justify-content: center;
  gap: 8px 18px; padding: 18px 6px; line-height: 1.4; min-height: 230px;
}
.cloud-word { transition: opacity 0.15s ease; cursor: default; }
.cloud-word:hover { opacity: 0.65; }

@media (max-width: 1024px) {
  .metric-grid { grid-template-columns: repeat(2, 1fr); }
  .chart-grid { grid-template-columns: 1fr; }
  .span-2 { grid-column: span 1; }
}
@media (max-width: 600px) {
  .page { padding: 20px 16px; }
  .metric-grid { grid-template-columns: 1fr; }
}
</style>
