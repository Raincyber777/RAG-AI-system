<script setup lang="ts">
/**
 * 板块三：数据统计仪表盘
 * - 系统指标卡：文档总数 / 向量总数 / 今日提问 / 系统健康度
 * - 每日提问量趋势（折线）· 知识空间文档占比（环形）
 * - 知识库高频词 TOP10（条形）· 热门问题词云（CSS）
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import AppIcon from '@/components/AppIcon.vue'

// ---------- 指标卡 ----------
const metrics = [
  { label: '知识库总文档', value: '108', unit: '篇', delta: '+12 本周', tint: 'tint-sky', icon: 'book' },
  { label: '向量总数', value: '2.9', unit: '万条', delta: '+0.3 万本周', tint: 'tint-lavender', icon: 'database' },
  { label: '今日提问量', value: '326', unit: '次', delta: '+18% 较昨日', tint: 'tint-mint', icon: 'chat' },
  { label: '系统健康度', value: '98.6', unit: '%', delta: '服务运行正常', tint: 'tint-peach', icon: 'activity' },
]

// ---------- 词云（热门问题关键词，字号随热度变化） ----------
const cloudWords = [
  { t: '报销流程', s: 30, c: '#5645d4' },
  { t: 'RAG原理', s: 26, c: '#dd5b00' },
  { t: '年假规则', s: 24, c: '#1aae39' },
  { t: '向量检索', s: 22, c: '#0075de' },
  { t: '切片策略', s: 18, c: '#a02e6d' },
  { t: 'Embedding', s: 20, c: '#7b3ff2' },
  { t: '权限管理', s: 16, c: '#2a9d99' },
  { t: '考勤', s: 15, c: '#793400' },
  { t: 'Milvus', s: 17, c: '#5645d4' },
  { t: '重排序', s: 14, c: '#dd5b00' },
  { t: 'API密钥', s: 13, c: '#1aae39' },
  { t: '知识库上传', s: 15, c: '#0075de' },
  { t: '幻觉', s: 19, c: '#391c57' },
  { t: '引用溯源', s: 21, c: '#5645d4' },
  { t: '解析失败', s: 12, c: '#a02e6d' },
  { t: 'Prompt模板', s: 13, c: '#2a9d99' },
]

// ---------- ECharts ----------
const trendRef = ref<HTMLDivElement>()
const pieRef = ref<HTMLDivElement>()
const barRef = ref<HTMLDivElement>()
let charts: echarts.ECharts[] = []

const NOTION_PALETTE = ['#5645d4', '#7b3ff2', '#0075de', '#2a9d99', '#dd5b00', '#ff64c8']

function initCharts() {
  // 折线：每日提问量趋势
  if (trendRef.value) {
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - 13 + i)
      return `${d.getMonth() + 1}/${d.getDate()}`
    })
    const values = [186, 204, 232, 210, 265, 298, 276, 312, 340, 305, 356, 388, 352, 326]
    const c = echarts.init(trendRef.value)
    c.setOption({
      grid: { top: 36, left: 44, right: 16, bottom: 28 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: days, axisLine: { lineStyle: { color: '#c8c4be' } }, axisLabel: { color: '#787671' } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#ede9e4' } }, axisLabel: { color: '#787671' } },
      series: [
        {
          name: '提问量',
          type: 'line',
          data: values,
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
    charts.push(c)
  }

  // 环形：各知识空间文档占比
  if (pieRef.value) {
    const c = echarts.init(pieRef.value)
    c.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} 篇 ({d}%)' },
      legend: { bottom: 0, icon: 'circle', textStyle: { color: '#5d5b54', fontSize: 12 } },
      color: NOTION_PALETTE,
      series: [
        {
          type: 'pie',
          radius: ['52%', '74%'],
          center: ['50%', '44%'],
          itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 6 },
          label: { show: false },
          data: [
            { name: '技术文档', value: 46 },
            { name: '产品手册', value: 32 },
            { name: '公司规章', value: 18 },
            { name: '项目资料', value: 12 },
          ],
        },
      ],
    })
    charts.push(c)
  }

  // 条形：知识库高频词 TOP10
  if (barRef.value) {
    const words = ['报销流程', 'RAG原理', '年假规则', '向量检索', '引用溯源', '切片策略', 'Embedding', '幻觉', 'Milvus', '权限管理']
    const counts = [286, 254, 221, 198, 176, 154, 132, 118, 97, 85]
    const c = echarts.init(barRef.value)
    c.setOption({
      grid: { top: 8, left: 88, right: 30, bottom: 8 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', show: false },
      yAxis: {
        type: 'category',
        data: words,
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#37352f', fontSize: 12.5 },
      },
      series: [
        {
          type: 'bar',
          data: counts,
          barWidth: 14,
          itemStyle: { borderRadius: 7, color: '#5645d4' },
          showBackground: true,
          backgroundStyle: { color: '#ede9e4', borderRadius: 7 },
        },
      ],
    })
    charts.push(c)
  }
}

function handleResize() {
  charts.forEach((c) => c.resize())
}

onMounted(() => {
  initCharts()
  window.addEventListener('resize', handleResize)
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
        <p class="text-sm">系统运行状态与用户活跃情况的宏观展示</p>
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
            <div class="h4">每日提问量趋势</div>
            <div class="text-caption">近 14 天用户提问次数</div>
          </div>
          <span class="tag tag-purple">近7日 +18%</span>
        </div>
        <div ref="trendRef" class="chart trend"></div>
      </div>

      <div class="card chart-card">
        <div class="chart-head">
          <div>
            <div class="h4">知识空间文档占比</div>
            <div class="text-caption">各空间文档数量分布</div>
          </div>
        </div>
        <div ref="pieRef" class="chart pie"></div>
      </div>

      <div class="card chart-card span-2">
        <div class="chart-head">
          <div>
            <div class="h4">知识库高频词 TOP10</div>
            <div class="text-caption">用户提问中被检索最多的关键词</div>
          </div>
        </div>
        <div ref="barRef" class="chart bar"></div>
      </div>

      <div class="card chart-card tint-cream">
        <div class="chart-head">
          <div>
            <div class="h4">热门问题词云</div>
            <div class="text-caption">字号代表提问热度</div>
          </div>
          <AppIcon name="spark" :size="18" class="muted" />
        </div>
        <div class="cloud">
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
.chart { width: 100%; }
.chart.trend { height: 260px; }
.chart.pie { height: 260px; }
.chart.bar { height: 260px; }

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
