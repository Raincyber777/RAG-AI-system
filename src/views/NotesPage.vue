<script setup lang="ts">
/**
 * 我的纪要：课堂纪要卡片管理
 * 查看（工作台回看）/ 追问 / 导出 Markdown / 删除（确认弹窗）/ 失败重试
 * 数据来自共享 store（工作台新生成的纪要实时出现在这里）
 */
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import AppSelect from '@/components/AppSelect.vue'
import { classNotes, removeClassNote, updateNote, activeCourses } from '@/store/study'
import type { ClassNote } from '@/mock/data'
import { buildNoteMarkdown, downloadText } from '@/utils/exportNote'

const router = useRouter()

const search = ref('')
const filter = ref<'all' | 'done' | 'failed'>('all')
const courseFilter = ref('')
// 课程筛选 = 名下已有纪要的课程：工作台新课程须成功生成纪要后才出现在这里；删除 / 重命名自动同步
const courseOptions = computed(() => [
  { label: '全部课程', value: '' },
  ...activeCourses.value.map((c) => ({ label: c, value: c })),
])
// 当前筛选的课程被删除后自动复位为「全部课程」
watch(courseOptions, (opts) => {
  if (courseFilter.value && !opts.some((o) => o.value === courseFilter.value)) courseFilter.value = ''
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return classNotes.value.filter((n) => {
    if (filter.value === 'done' && n.status !== 'done') return false
    if (filter.value === 'failed' && n.status !== 'failed') return false
    if (courseFilter.value && n.course !== courseFilter.value) return false
    if (!q) return true
    return n.title.toLowerCase().includes(q) || n.course.toLowerCase().includes(q)
  })
})

const doneCount = computed(() => classNotes.value.filter((n) => n.status === 'done').length)
const failedCount = computed(() => classNotes.value.filter((n) => n.status === 'failed').length)
const totalChunks = computed(() => classNotes.value.reduce((s, n) => s + n.chunkCount, 0))

watch([search, filter], () => { /* 预留：真实接口下此处重新拉取 */ })

const statusTag: Record<ClassNote['status'], string> = {
  done: 'tag-green',
  processing: 'tag-blue',
  failed: 'tag-red',
}
const statusText: Record<ClassNote['status'], string> = {
  done: '已完成',
  processing: '处理中',
  failed: '处理失败',
}

function viewNote(n: ClassNote) {
  router.push({ path: '/studio', query: { note: n.id } })
}
function goQA(n: ClassNote) {
  router.push({ path: '/qa', query: { note: n.id } })
}
function exportNote(n: ClassNote) {
  downloadText(n.title, buildNoteMarkdown(n))
}

// 删除确认弹窗（替代原生 confirm）
const deleteTarget = ref<ClassNote | null>(null)
function confirmDelete() {
  if (deleteTarget.value) removeClassNote(deleteTarget.value.id)
  deleteTarget.value = null
}

// 失败重试（演示：2 秒后标记完成）
function retryNote(n: ClassNote) {
  updateNote(n.id, { status: 'processing' })
  window.setTimeout(() => {
    updateNote(n.id, {
      status: 'done',
      keyframes: 6,
      chunkCount: 26,
      theme:
        '本节课围绕泰勒公式与泰勒级数展开。教师首先回顾了麦克劳林公式，推导了常用函数（e^x、sin x、cos x）的展开式，随后讲解了拉格朗日余项与佩亚诺余项的区别与选用场景。',
      points: [
        { text: '泰勒公式：f(x) 在 x₀ 处 n 阶可导，可用多项式逼近，余项刻画逼近误差', cite: '录音 03:24' },
        { text: '麦克劳林公式是 x₀ = 0 的特殊情形，e^x = 1 + x + x²/2! + …', cite: 'PPT 第2页' },
        { text: '拉格朗日余项适合定性估计误差，佩亚诺余项适合求极限时的局部展开', cite: '录音 11:47' },
      ],
      definitions: [
        { term: '泰勒公式', detail: 'f(x) = Σ f⁽ⁿ⁾(x₀)/n! · (x-x₀)ⁿ + Rₙ(x)，其中 Rₙ 为余项', cite: 'PPT 第3页' },
      ],
      emphasized: ['期末必考：用泰勒展开求 undefined 型极限，至少展开到分母的最高阶'],
    })
  }, 2000)
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1 class="h2">我的纪要</h1>
        <p class="text-sm">管理所有课堂纪要：回看原文、继续追问、一键导出</p>
      </div>
      <div class="stat-chips">
        <div class="chip tint-lavender"><b>{{ classNotes.length }}</b> 节课堂</div>
        <div class="chip tint-mint"><b>{{ doneCount }}</b> 已完成</div>
        <div class="chip tint-sky"><b>{{ totalChunks }}</b> 知识片段</div>
        <div v-if="failedCount" class="chip tint-rose"><b>{{ failedCount }}</b> 失败</div>
      </div>
    </header>

    <!-- 筛选行 -->
    <div class="filter-row">
      <div class="pill-tabs">
        <button class="pill-tab" :class="{ active: filter === 'all' }" @click="filter = 'all'">全部 · {{ classNotes.length }}</button>
        <button class="pill-tab" :class="{ active: filter === 'done' }" @click="filter = 'done'">已完成 · {{ doneCount }}</button>
        <button class="pill-tab" :class="{ active: filter === 'failed' }" @click="filter = 'failed'">失败 · {{ failedCount }}</button>
      </div>
      <div class="filter-right">
        <AppSelect v-model="courseFilter" :options="courseOptions" class="course-select" aria-label="按课程筛选纪要" />
        <div class="search-box">
          <AppIcon name="search" :size="15" />
          <input v-model="search" class="search-input" placeholder="搜索课堂主题 / 课程名" />
        </div>
      </div>
    </div>

    <!-- 卡片列表 -->
    <div v-if="filtered.length" class="note-grid">
      <div v-for="n in filtered" :key="n.id" class="card note-card card-hover">
        <div class="nc-top">
          <span class="tag tag-purple">{{ n.course }}</span>
          <span class="tag" :class="statusTag[n.status]">
            <span v-if="n.status === 'processing'" class="spinner" style="width:11px;height:11px;border-width:1.5px"></span>
            <span v-else class="dot" :class="n.status === 'done' ? 'dot-green' : 'dot-red'"></span>
            {{ statusText[n.status] }}
          </span>
        </div>
        <div class="nc-title" role="button" tabindex="0" @click="viewNote(n)" @keydown.enter.prevent="viewNote(n)">{{ n.title }}</div>
        <p v-if="n.theme" class="nc-theme">{{ n.theme }}</p>
        <p v-else class="nc-theme muted">纪要内容尚未生成{{ n.status === 'failed' ? '，可尝试重新处理' : '' }}。</p>

        <div class="nc-meta">
          <span class="meta-item"><AppIcon name="calendar" :size="13" /> {{ n.date }}</span>
          <span class="meta-item"><AppIcon name="headphones" :size="13" /> {{ n.duration }}</span>
          <span class="meta-item" v-if="n.keyframes"><AppIcon name="image" :size="13" /> {{ n.keyframes }} 关键帧</span>
          <span class="meta-item" v-if="n.chunkCount"><AppIcon name="database" :size="13" /> {{ n.chunkCount }} 片段</span>
        </div>

        <div class="nc-actions">
          <template v-if="n.status === 'done'">
            <button class="btn btn-primary btn-sm" @click="viewNote(n)"><AppIcon name="eye" :size="13" /> 查看</button>
            <button class="btn btn-secondary btn-sm" @click="goQA(n)"><AppIcon name="chat" :size="13" /> 追问</button>
            <button class="btn btn-secondary btn-sm" @click="exportNote(n)"><AppIcon name="download" :size="13" /> 导出</button>
          </template>
          <button v-else-if="n.status === 'failed'" class="btn btn-secondary btn-sm" @click="retryNote(n)">
            <AppIcon name="refresh" :size="13" /> 重新处理
          </button>
          <span v-else class="text-caption">正在处理，请稍候…</span>
          <button class="icon-btn danger ml-auto" title="删除纪要" :aria-label="'删除纪要 ' + n.title" @click="deleteTarget = n">
            <AppIcon name="trash" :size="14" />
          </button>
        </div>
      </div>
    </div>

    <!-- 空态 -->
    <div v-else class="empty-state">
      <div class="empty-ico"><AppIcon name="book" :size="26" /></div>
      <p class="h4">没有匹配的纪要</p>
      <p class="text-sm muted">到「课堂纪要」工作台上传材料，生成第一份课堂纪要吧</p>
      <router-link to="/studio" class="btn btn-primary" style="margin-top: 14px"><AppIcon name="spark" :size="14" /> 前往工作台</router-link>
    </div>

    <!-- 删除确认弹窗 -->
    <div v-if="deleteTarget" class="modal-mask" @click.self="deleteTarget = null">
      <div class="modal modal-sm">
        <div class="modal-title">删除课堂纪要</div>
        <p class="modal-sub">确定删除「{{ deleteTarget.title }}」吗？其转写稿、关键帧与知识片段将一并清除，此操作不可恢复。</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="deleteTarget = null">取消</button>
          <button class="btn btn-danger" @click="confirmDelete">确认删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 28px 32px 48px; max-width: 1200px; width: 100%; margin: 0 auto; }
.page-head { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 20px; }
.stat-chips { display: flex; gap: 10px; flex-wrap: wrap; }
.chip { font-size: 13px; padding: 8px 14px; border-radius: var(--radius-md); font-weight: 500; }
.chip b { font-weight: 700; margin-right: 2px; }

.filter-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 18px; }
.filter-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.course-select { width: 180px; }
.search-box {
  display: flex; align-items: center; gap: 8px; width: 260px; padding: 0 12px; height: 38px;
  background: var(--canvas); border: 1px solid var(--hairline); border-radius: var(--radius-md);
  color: var(--stone);
}
.search-input { border: none; outline: none; flex: 1; font-size: 13px; background: transparent; }

.note-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 14px; }
.note-card { padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; }
.nc-top { display: flex; align-items: center; justify-content: space-between; }
.nc-title { font-size: 15.5px; font-weight: 700; cursor: pointer; line-height: 1.45; }
.nc-title:hover { color: var(--primary); }
.nc-title:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 4px; }
.nc-theme {
  font-size: 12.5px; line-height: 1.7; color: var(--slate);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  min-height: 42px;
}
.nc-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.meta-item { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--stone); }
.nc-actions { display: flex; align-items: center; gap: 8px; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--hairline-soft); }
.icon-btn {
  border: none; background: transparent; color: var(--stone);
  padding: 6px; border-radius: var(--radius-sm); display: flex; cursor: pointer;
}
.icon-btn:hover { background: var(--surface); color: var(--ink); }
.icon-btn.danger:hover { color: var(--error); background: #fdecec; }
.ml-auto { margin-left: auto; }

.empty-state { text-align: center; padding: 72px 20px; color: var(--slate); }
.empty-ico {
  width: 60px; height: 60px; margin: 0 auto 14px; border-radius: var(--radius-lg);
  background: var(--tint-lavender); color: var(--primary);
  display: flex; align-items: center; justify-content: center;
}
.empty-state p + p { margin-top: 6px; }

.modal-sm { max-width: 440px; }
.modal-sub { color: var(--slate); line-height: 1.7; }

@media (max-width: 720px) {
  .page { padding: 20px 16px 40px; }
  .filter-row { align-items: stretch; flex-direction: column; }
  .filter-right { flex-direction: column; align-items: stretch; }
  .course-select { width: 100%; }
  .search-box { width: 100%; }
}
</style>
