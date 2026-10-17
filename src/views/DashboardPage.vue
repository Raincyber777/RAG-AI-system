<script setup lang="ts">
/**
 * 数据看板：学习数据总览
 * - 指标卡：课堂总数 / 累计追问 / 练习题量 / 错题记录（来自后端个人统计）
 * - 每日追问趋势（折线）· 上传类型占比（环形）· 高频知识点 TOP10（条形）· 词云（演示数据）
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import AppIcon from '@/components/AppIcon.vue'
import { statsApi } from '@/api'
import { isGuest } from '@/store/auth'

// ---------- 指标卡（数值来自 /stats/summary/ 个人统计，未加载 / 加载失败时按 0 展示） ----------
const metrics = ref([
  { label: '课堂总数', value: '0', unit: '节', delta: '我的全部课堂纪要', tint: 'tint-sky', icon: 'book' },
  { label: '累计追问', value: '0', unit: '次', delta: '全部课堂问答记录', tint: 'tint-lavender', icon: 'headphones' },
  { label: '练习题量', value: '0', unit: '题', delta: '题库中的自创题总数', tint: 'tint-mint', icon: 'edit' },
  { label: '错题记录', value: '0', unit: '题', delta: '错题本中的待巩固题目', tint: 'tint-peach', icon: 'flag' },
])

// ---------- 词云（热门追问关键词，字号随热度变化） ----------
const cloudWords = [
  { t: '泰勒展开', s: 30, c: '#5645d4' },
  { t: '进程线程', s: 26, c: '#dd5b00' },
  { t: '拉格朗日余项', s: 24, c: '#1aae39' },
  { t: 'PV操作', s: 22, c: '#0075de' },
  { t: '麦克劳林公式', s: 20, c: '#a02e6d' },
  { t: '死锁条件', s: 18, c: '#7b3ff2' },
  { t: '收敛半径', s: 16, c: '#2a9d99' },
  { t: '二叉树遍历', s: 17, c: '#793400' },
  { t: '信号量', s: 15, c: '#5645d4' },
  { t: '展开阶数', s: 14, c: '#dd5b00' },
  { t: '傅里叶级数', s: 13, c: '#1aae39' },
  { t: '页面置换', s: 15, c: '#0075de' },
  { t: '期末考点', s: 19, c: '#391c57' },
  { t: '作业习题', s: 21, c: '#5645d4' },
  { t: '板书推导', s: 12, c: '#a02e6d' },
  { t: '时间戳回听', s: 13, c: '#2a9d99' },
]

// ---------- ECharts ----------
const trendRef = ref<HTMLDivElement>()
const pieRef = ref<HTMLDivElement>()
const barRef = ref<HTMLDivElement>()
let charts: echarts.ECharts[] = []

const NOTION_PALETTE = ['#5645d4', '#7b3ff2', '#0075de', '#2a9d99', '#dd5b00', '#ff64c8']

function initCharts() {
  // 折线：每日处理课堂数与追问量趋势
  if (trendRef.value) {
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - 13 + i)
      return `${d.getMonth() + 1}/${d.getDate()}`
    })
    const values = [42, 56, 48, 62, 74, 68, 82, 76, 90, 84, 98, 92, 104, 96]
    const c = echarts.init(trendRef.value)
    c.setOption({
      grid: { top: 36, left: 44, right: 16, bottom: 28 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: days, axisLine: { lineStyle: { color: '#c8c4be' } }, axisLabel: { color: '#787671' } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#ede9e4' } }, axisLabel: { color: '#787671' } },
      series: [
        {
          name: '追问量',
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

  // 环形：上传材料类型占比
  if (pieRef.value) {
    const c = echarts.init(pieRef.value)
    c.setOption({
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
          data: [
            { name: '音频', value: 38 },
            { name: '图片', value: 27 },
            { name: '视频', value: 18 },
            { name: 'PPT', value: 12 },
            { name: '其他', value: 5 },
          ],
        },
      ],
    })
    charts.push(c)
  }

  // 条形：高频知识点 TOP10（被追问最多的知识点）
  if (barRef.value) {
    const words = ['泰勒展开', '进程与线程', '拉格朗日余项', 'PV操作', '二叉树遍历', '麦克劳林公式', '死锁条件', '收敛半径', '信号量', '傅里叶级数']
    const counts = [86, 72, 64, 55, 49, 43, 38, 31, 27, 22]
    const c = echarts.init(barRef.value)
    c.setOption({
      grid: { top: 8, left: 104, right: 30, bottom: 8 },
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

onMounted(async () => {
  initCharts()
  window.addEventListener('resize', handleResize)
  // 指标卡接入后端个人统计
  if (isGuest.value) return
  try {
    const s = await statsApi.summary()
    if (s.scope !== 'personal') return
    metrics.value[0]!.value = String(s.notes)
    metrics.value[1]!.value = String(s.qa_records)
    metrics.value[2]!.value = String(s.quiz_items)
    metrics.value[3]!.value = String(s.wrong_records)
  } catch {
    // 后端不可达时保持 0
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
        <p class="text-sm">课堂处理量与追问活跃情况的宏观展示</p>
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
          <span class="tag tag-purple">近7日 +18%</span>
        </div>
        <div ref="trendRef" class="chart trend"></div>
      </div>

      <div class="card chart-card">
        <div class="chart-head">
          <div>
            <div class="h4">上传材料类型占比</div>
            <div class="text-caption">音频 / 图片 / 视频 / PPT / 其他 的分布</div>
          </div>
        </div>
        <div ref="pieRef" class="chart pie"></div>
      </div>

      <div class="card chart-card span-2">
        <div class="chart-head">
          <div>
            <div class="h4">高频知识点 TOP10</div>
            <div class="text-caption">课堂追问中被检索最多的知识点</div>
          </div>
        </div>
        <div ref="barRef" class="chart bar"></div>
      </div>

      <div class="card chart-card tint-cream">
        <div class="chart-head">
          <div>
            <div class="h4">热门追问词云</div>
            <div class="text-caption">字号代表追问热度</div>
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
