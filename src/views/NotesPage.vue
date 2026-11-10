<script setup lang="ts">
/**
 * 我的纪要：课堂纪要卡片管理
 * 查看（弹窗就地展示，不再跳转工作台）/ 追问 / 导出 Markdown / 删除（确认弹窗）/ 失败重试
 * 数据来自共享 store（工作台新生成的纪要实时出现在这里）
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import AppSelect from '@/components/AppSelect.vue'
import { classNotes, removeClassNote, updateNote, activeCourses, ensureNotesLoaded, noteFromApi } from '@/store/study'
import { notesApi } from '@/api'
import type { ClassNote } from '@/mock/data'
import { buildNoteMarkdown, downloadText } from '@/utils/exportNote'

const router = useRouter()

// 删除 / 重新处理失败提示（2.6 秒后自动消失）
const actionTip = ref('')
let tipTimer: number | undefined
function flashTip(msg: string) {
  actionTip.value = msg
  if (tipTimer) window.clearTimeout(tipTimer)
  tipTimer = window.setTimeout(() => (actionTip.value = ''), 2600)
}

// 处理中的纪要每 10s 静默补拉：后端生成完成后（或对超时僵尸处理态自愈翻转后），
// 卡片状态无需手动刷新即可收敛；全部收敛后停止轮询
let refreshTimer: number | undefined
onMounted(() => {
  void ensureNotesLoaded() // 直接进入本页时补拉纪要列表（已在加载中则自动去重）
  refreshTimer = window.setInterval(() => {
    if (classNotes.value.some((n) => n.status === 'processing')) void ensureNotesLoaded()
    else window.clearInterval(refreshTimer)
  }, 10000)
})
onUnmounted(() => window.clearInterval(refreshTimer))

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

// 查看纪要：弹窗就地展示完整内容（不再跳转课堂纪要工作台）
const viewTarget = ref<ClassNote | null>(null)
function viewNote(n: ClassNote) {
  viewTarget.value = n
}
function goQA(n: ClassNote) {
  viewTarget.value = null
  router.push({ path: '/qa', query: { note: n.id } })
}
function exportNote(n: ClassNote) {
  downloadText(n.title, buildNoteMarkdown(n))
}

// 删除确认弹窗（替代原生 confirm）：先调后端删除，成功后同步本地
const deleteTarget = ref<ClassNote | null>(null)
async function confirmDelete() {
  const t = deleteTarget.value
  deleteTarget.value = null
  if (!t) return
  try {
    await notesApi.remove(t.id)
    removeClassNote(t.id)
  } catch {
    flashTip('删除失败，请确认后端已启动')
  }
}

// 失败重试：调用后端重新处理（演示流水线立即完成占位生成）
async function retryNote(n: ClassNote) {
  updateNote(n.id, { status: 'processing' })
  try {
    const apiNote = await notesApi.reprocess(n.id)
    updateNote(n.id, noteFromApi(apiNote))
  } catch {
    updateNote(n.id, { status: 'failed' })
    flashTip('重新处理失败，请确认后端已启动')
  }
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

    <div v-if="actionTip" class="action-tip" role="alert">{{ actionTip }}</div>

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
        <p v-else-if="n.status === 'failed'" class="nc-theme" :class="{ muted: !n.failReason }">
          {{ n.failReason ? `生成失败：${n.failReason}` : '纪要内容尚未生成，可尝试重新处理。' }}
        </p>
        <p v-else class="nc-theme muted">纪要内容尚未生成。</p>

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

    <!-- 查看纪要弹窗：就地展示完整内容（课程主题 / 知识点 / 定义 / 重点 / 转写原文） -->
    <div v-if="viewTarget" class="modal-mask" @click.self="viewTarget = null">
      <div class="modal note-modal">
        <div class="nm-head">
          <div class="nm-tags">
            <span class="tag tag-purple">{{ viewTarget.course }}</span>
            <span class="tag" :class="statusTag[viewTarget.status]">{{ statusText[viewTarget.status] }}</span>
          </div>
          <button class="nm-close" type="button" aria-label="关闭纪要弹窗" @click="viewTarget = null">
            <AppIcon name="x" :size="16" />
          </button>
        </div>
        <div class="nm-title">{{ viewTarget.title }}</div>
        <div class="nm-body">
          <template v-if="viewTarget.status === 'done'">
            <p v-if="viewTarget.theme" class="nm-theme">{{ viewTarget.theme }}</p>
            <section v-if="viewTarget.points.length" class="nm-sec">
              <div class="nm-sec-head"><AppIcon name="book" :size="14" /> 核心知识点</div>
              <ul class="nm-list">
                <li v-for="(p, i) in viewTarget.points" :key="i" class="nm-item">
                  <span class="nm-bullet"></span>
                  <span class="flex-1">{{ p.text }}</span>
                  <span v-if="p.cite && p.cite.startsWith('录音')" class="nm-cite"><AppIcon name="headphones" :size="12" /> {{ p.cite }}</span>
                </li>
              </ul>
            </section>
            <section v-if="viewTarget.definitions.length" class="nm-sec">
              <div class="nm-sec-head"><AppIcon name="quote" :size="14" /> 重要定义与公式</div>
              <ul class="nm-list">
                <li v-for="(d, i) in viewTarget.definitions" :key="i" class="nm-item def">
                  <div class="flex-1">
                    <div class="nm-def-term">{{ d.term }}</div>
                    <div class="nm-def-detail">
                      {{ d.detail }}
                      <span v-if="d.cite && d.cite.startsWith('录音')" class="nm-cite"><AppIcon name="headphones" :size="12" /> {{ d.cite }}</span>
                    </div>
                  </div>
                </li>
              </ul>
            </section>
            <section v-if="viewTarget.emphasized.length" class="nm-sec">
              <div class="nm-sec-head"><AppIcon name="alert" :size="14" /> 重点问题</div>
              <ul class="nm-list">
                <li v-for="(e, i) in viewTarget.emphasized" :key="i" class="nm-item emph"><AppIcon name="alert" :size="13" class="emph-ico" /><span class="flex-1">{{ e }}</span></li>
              </ul>
            </section>
            <details v-if="viewTarget.transcript" class="nm-transcript">
              <summary>转写原文（{{ viewTarget.transcript.length }} 字）</summary>
              <pre>{{ viewTarget.transcript }}</pre>
            </details>
          </template>
          <p v-else-if="viewTarget.status === 'failed'" class="nm-state">
            生成失败：{{ viewTarget.failReason || '材料处理未成功，可回到卡片上点击「重新处理」再试。' }}
          </p>
          <p v-else class="nm-state muted">正在处理，完成后即可在这里查看完整内容。</p>
        </div>
        <div class="nm-foot">
          <template v-if="viewTarget.status === 'done'">
            <button class="btn btn-secondary btn-sm" @click="exportNote(viewTarget)"><AppIcon name="download" :size="13" /> 导出</button>
            <button class="btn btn-primary btn-sm" @click="goQA(viewTarget)"><AppIcon name="chat" :size="13" /> 去追问</button>
          </template>
          <button class="btn btn-ghost btn-sm nm-foot-close" @click="viewTarget = null">关闭</button>
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
/* 删除 / 重新处理失败提示 */
.action-tip {
  background: var(--tint-rose); color: var(--error);
  font-size: 12.5px; font-weight: 500; line-height: 1.5;
  border-radius: var(--radius-md); padding: 9px 14px; margin-bottom: 14px;
}
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

/* 查看纪要弹窗：宽幅、正文滚动、底部操作固定 */
.note-modal { max-width: 760px; width: calc(100vw - 48px); max-height: 84vh; display: flex; flex-direction: column; padding: 0; }
.nm-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 20px 0; }
.nm-tags { display: flex; align-items: center; gap: 8px; }
.nm-close { border: none; background: transparent; color: var(--stone); padding: 6px; border-radius: var(--radius-sm); display: flex; cursor: pointer; }
.nm-close:hover { background: var(--surface); color: var(--ink); }
.nm-title { font-size: 17px; font-weight: 700; letter-spacing: -0.2px; padding: 10px 20px 0; }
.nm-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 20px 18px; }
.nm-theme { font-size: 13.5px; line-height: 1.8; color: var(--ink); padding: 4px 0 6px; border-bottom: 1px solid var(--hairline-soft); }
.nm-sec { padding: 12px 0 4px; border-bottom: 1px solid var(--hairline-soft); }
.nm-sec:last-of-type { border-bottom: none; }
.nm-sec-head { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; margin-bottom: 9px; color: var(--ink); }
.nm-sec-head :deep(svg) { color: var(--primary); }
.nm-list { list-style: none; display: flex; flex-direction: column; gap: 9px; }
.nm-item { display: flex; align-items: flex-start; gap: 9px; font-size: 13.5px; line-height: 1.65; }
.nm-bullet { width: 6px; height: 6px; border-radius: 50%; background: var(--primary); margin-top: 8px; flex-shrink: 0; }
.nm-cite {
  display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; margin-left: 6px;
  font-size: 11.5px; font-weight: 600; color: var(--steel); background: var(--surface);
  border-radius: var(--radius-full); padding: 2.5px 9px;
}
.nm-def-term { font-size: 13.5px; font-weight: 700; color: var(--brand-purple-800); }
.nm-def-detail { font-size: 13px; color: var(--slate); line-height: 1.65; margin-top: 3px; }
.nm-item.emph { background: var(--tint-yellow-bold); border-radius: var(--radius-sm); padding: 7px 11px; font-size: 13px; }
.emph-ico { color: var(--brand-brown); margin-top: 3px; flex-shrink: 0; }
.nm-state { font-size: 13px; line-height: 1.7; color: var(--error); padding: 10px 0; }
.nm-state.muted { color: var(--stone); }
.nm-transcript { margin-top: 12px; font-size: 12.5px; }
.nm-transcript summary { cursor: pointer; font-weight: 600; color: var(--slate); user-select: none; }
.nm-transcript pre {
  margin-top: 8px; padding: 12px; white-space: pre-wrap; word-break: break-word;
  background: var(--surface); border-radius: var(--radius-md); color: var(--slate);
  line-height: 1.7; max-height: 300px; overflow-y: auto;
}
.nm-foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--hairline-soft); }

@media (max-width: 720px) {
  .page { padding: 20px 16px 40px; }
  .filter-row { align-items: stretch; flex-direction: column; }
  .filter-right { flex-direction: column; align-items: stretch; }
  .course-select { width: 100%; }
  .search-box { width: 100%; }
}
</style>
