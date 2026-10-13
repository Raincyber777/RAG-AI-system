<script setup lang="ts">
/**
 * 板块二：知识库与文档管理区（后台支撑）
 * - 知识空间切换 / 新建
 * - 文档上传（拖拽 / 点击）、下载、重命名、删除
 * - 解析状态实时反馈：排队中 → 切片 → 向量化 → 完成 / 失败
 */
import { ref, computed, reactive, watch } from 'vue'
import { ElSelect, ElOption, ElPagination, ElConfigProvider } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/es/components/select/style/css'
import 'element-plus/es/components/option/style/css'
import 'element-plus/es/components/pagination/style/css'
import AppIcon from '@/components/AppIcon.vue'
import {
  spaces as mockSpaces,
  docs as mockDocs,
  statusText,
  type Doc,
  type Space,
} from '@/mock/data'

// ---------- 知识空间 ----------
const spaces = ref<Space[]>([...mockSpaces])
const activeSpace = ref<'all' | string>('all')
const showNewSpace = ref(false)
const newSpaceForm = reactive({ name: '' })

function createSpace() {
  if (!newSpaceForm.name.trim()) return
  spaces.value.push({
    id: 'sp' + Date.now(),
    name: newSpaceForm.name.trim(),
    desc: '暂无描述',
    docCount: 0,
    vectorCount: 0,
  })
  newSpaceForm.name = ''
  showNewSpace.value = false
}

// ---------- 文档 ----------
const allDocs = ref<Doc[]>([...mockDocs])
const docSearch = ref('')
const filteredDocs = computed(() =>
  allDocs.value.filter(
    (d) =>
      (activeSpace.value === 'all' || d.space === activeSpace.value) &&
      d.name.toLowerCase().includes(docSearch.value.trim().toLowerCase())
  )
)

// ---------- 分页（10 / 20 / 30 每页） ----------
const page = ref(1)
const pageSize = ref(10)
const pagedDocs = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredDocs.value.slice(start, start + pageSize.value)
})
const totalPages = computed(() => Math.max(1, Math.ceil(filteredDocs.value.length / pageSize.value)))
// 切换筛选条件 / 每页条数时回到第一页；删除后若当前页超界则回退
watch([docSearch, activeSpace, pageSize], () => { page.value = 1 })
watch(totalPages, () => { if (page.value > totalPages.value) page.value = totalPages.value })

// 统计
const totalChunks = computed(() => allDocs.value.reduce((s, d) => s + d.chunks, 0))

// ---------- 上传（模拟解析状态流转） ----------
const dragging = ref(false)
const fileInput = ref<HTMLInputElement>()
const targetSpace = ref(activeSpace.value === 'all' ? '技术文档' : activeSpace.value)

function pickFiles() {
  fileInput.value?.click()
}
function onDrop(e: DragEvent) {
  dragging.value = false
  handleFiles(e.dataTransfer?.files)
}
function onFileChange(e: Event) {
  handleFiles((e.target as HTMLInputElement).files)
  ;(e.target as HTMLInputElement).value = ''
}

function handleFiles(list: FileList | null | undefined) {
  if (!list) return
  for (const f of Array.from(list)) {
    const doc: Doc = {
      id: 'd' + Date.now() + Math.random().toString(36).slice(2, 6),
      name: f.name,
      space: targetSpace.value,
      type: (f.name.split('.').pop() || 'file').toUpperCase(),
      size: formatSize(f.size),
      chunks: 0,
      status: 'queued',
      time: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'),
    }
    allDocs.value.unshift(doc)
    simulateParse(doc)
  }
}

// 排队中 → 切片 → 向量化 → 完成（演示用定时器）
function simulateParse(doc: Doc) {
  setTimeout(() => { doc.status = 'parsing' }, 1500)
  setTimeout(() => { doc.status = 'vectorizing'; doc.chunks = 20 + Math.floor(Math.random() * 120) }, 4200)
  setTimeout(() => {
    doc.status = Math.random() > 0.12 ? 'done' : 'failed'
    if (doc.status === 'done') {
      const sp = spaces.value.find((s) => s.name === doc.space)
      if (sp) { sp.docCount += 1; sp.vectorCount += doc.chunks * 100 }
    }
  }, 7000)
}

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

// ---------- 操作：重命名 / 删除 / 下载 ----------
const renameTarget = ref<Doc | null>(null)
const renameValue = ref('')

function openRename(doc: Doc) {
  renameTarget.value = doc
  renameValue.value = doc.name
}
function confirmRename() {
  if (renameTarget.value && renameValue.value.trim()) {
    renameTarget.value.name = renameValue.value.trim()
  }
  renameTarget.value = null
}
// 删除改为确认弹窗（替代原生 confirm）
const deleteTarget = ref<Doc | null>(null)
function removeDoc(doc: Doc) {
  deleteTarget.value = doc
}
function confirmDelete() {
  const t = deleteTarget.value
  if (t) allDocs.value = allDocs.value.filter((d) => d.id !== t.id)
  deleteTarget.value = null
}
function downloadDoc(doc: Doc) {
  // 演示：生成文本文件下载
  const blob = new Blob([`这是「${doc.name}」的演示文件内容`], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = doc.name
  a.click()
  URL.revokeObjectURL(a.href)
}
function retryParse(doc: Doc) {
  doc.status = 'queued'
  simulateParse(doc)
}

const statusTag: Record<Doc['status'], string> = {
  queued: 'tag-yellow',
  parsing: 'tag-purple',
  vectorizing: 'tag-blue',
  done: 'tag-green',
  failed: 'tag-red',
}
const statusDot: Record<Doc['status'], string> = {
  queued: 'dot-yellow',
  parsing: 'dot-purple',
  vectorizing: 'dot-purple',
  done: 'dot-green',
  failed: 'dot-red',
}
</script>

<template>
  <ElConfigProvider :locale="zhCn">
    <div class="page">
    <!-- 页头 -->
    <header class="page-head">
      <div>
        <h1 class="h2">知识库管理</h1>
        <p class="text-sm">上传文档并自动完成「切片 → 向量化 → 入库」，让 AI 学会你的业务知识</p>
      </div>
      <div class="stat-chips">
        <div class="chip tint-sky"><b>{{ allDocs.length }}</b> 篇文档</div>
        <div class="chip tint-lavender"><b>{{ totalChunks }}</b> 个切片</div>
        <div class="chip tint-mint"><b>{{ spaces.length }}</b> 个知识空间</div>
      </div>
    </header>

    <!-- 上传区（点击任意处或拖拽均可上传） -->
    <div
      class="upload-zone"
      :class="{ dragging }"
      role="button"
      tabindex="0"
      aria-label="上传文档：点击选择文件或拖拽到此处"
      @click="pickFiles"
      @keydown.enter.prevent="pickFiles"
      @dragover.prevent="dragging = true"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
    >
      <div class="upload-icon"><AppIcon name="upload" :size="30" /></div>
      <div>
        <div class="h4">拖拽文件到此处，或 <span class="link-text">点击上传</span></div>
        <p class="text-sm mt-xs">支持 PDF / Word / Markdown / TXT / PPT，单文件不超过 20MB</p>
      </div>
      <div class="upload-target" @click.stop>
        <span class="upload-target-label">上传到：</span>
        <ElSelect v-model="targetSpace" class="upload-select" size="large" popper-class="kb-select-popper">
          <ElOption v-for="sp in spaces" :key="sp.id" :label="sp.name" :value="sp.name" />
        </ElSelect>
      </div>
      <input ref="fileInput" type="file" multiple hidden accept=".pdf,.doc,.docx,.md,.txt,.xlsx,.pptx" @change="onFileChange" />
    </div>

    <!-- 空间切换 -->
    <div class="flex items-center justify-between flex-wrap gap-sm mb-md">
      <div class="pill-tabs">
        <button class="pill-tab" :class="{ active: activeSpace === 'all' }" @click="activeSpace = 'all'">
          全部 · {{ allDocs.length }}
        </button>
        <button
          v-for="sp in spaces"
          :key="sp.id"
          class="pill-tab"
          :class="{ active: activeSpace === sp.name }"
          @click="activeSpace = sp.name"
        >
          {{ sp.name }} · {{ allDocs.filter((d) => d.space === sp.name).length }}
        </button>
      </div>
      <button class="btn btn-secondary btn-sm" @click="showNewSpace = true">
        <AppIcon name="plus" :size="14" /> 新建知识空间
      </button>
    </div>

    <!-- 搜索 -->
    <div class="search-row">
      <div class="search-box">
        <AppIcon name="search" :size="15" />
        <input v-model="docSearch" class="search-input" placeholder="搜索文档名称" />
      </div>
    </div>

    <!-- 文档表格 -->
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>文档名称</th>
            <th>知识空间</th>
            <th>类型 / 大小</th>
            <th>切片数</th>
            <th>解析状态</th>
            <th>上传时间</th>
            <th style="width: 150px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="doc in pagedDocs" :key="doc.id">
            <td>
              <div class="flex items-center gap-sm">
                <span class="file-ico"><AppIcon name="file" :size="15" /></span>
                <span class="doc-name ellipsis">{{ doc.name }}</span>
              </div>
            </td>
            <td><span class="tag tag-purple">{{ doc.space }}</span></td>
            <td class="muted">{{ doc.type }} · {{ doc.size }}</td>
            <td>{{ doc.chunks || '—' }}</td>
            <td>
              <span class="tag" :class="statusTag[doc.status]">
                <span v-if="doc.status === 'parsing' || doc.status === 'vectorizing'" class="spinner" style="width:11px;height:11px;border-width:1.5px"></span>
                <span v-else class="dot" :class="statusDot[doc.status]"></span>
                {{ statusText[doc.status] }}
              </span>
            </td>
            <td class="muted">{{ doc.time }}</td>
            <td>
              <div class="flex gap-xs">
                <button class="action-btn" title="下载" @click="downloadDoc(doc)"><AppIcon name="download" :size="15" /></button>
                <button class="action-btn" title="重命名" @click="openRename(doc)"><AppIcon name="edit" :size="15" /></button>
                <button class="action-btn" title="重新解析" @click="retryParse(doc)"><AppIcon name="refresh" :size="15" /></button>
                <button class="action-btn danger" title="删除" @click="removeDoc(doc)"><AppIcon name="trash" :size="15" /></button>
              </div>
            </td>
          </tr>
          <tr v-if="!filteredDocs.length">
            <td colspan="7" class="empty-cell">
              <AppIcon name="inbox" :size="28" />
              <p>暂无文档，先上传一份试试吧</p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 分页：10 / 20 / 30 每页 -->
    <div v-if="filteredDocs.length" class="pagination-row">
      <ElPagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 30]"
        :total="filteredDocs.length"
        layout="total, sizes, prev, pager, next"
        background
      />
    </div>

    <!-- 新建知识空间弹窗 -->
    <div v-if="showNewSpace" class="modal-mask" @click.self="showNewSpace = false">
      <div class="modal">
        <div class="modal-title">新建知识空间</div>
        <p class="modal-sub">知识空间用于按业务归类文档，如「技术文档」「公司规章」</p>
        <div class="field">
          <label class="field-label">空间名称</label>
          <input v-model="newSpaceForm.name" class="input" placeholder="例如：市场物料" @keydown.enter="createSpace" />
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="showNewSpace = false">取消</button>
          <button class="btn btn-primary" @click="createSpace">创建</button>
        </div>
      </div>
    </div>

    <!-- 重命名弹窗 -->
    <div v-if="renameTarget" class="modal-mask" @click.self="renameTarget = null">
      <div class="modal">
        <div class="modal-title">重命名文档</div>
        <p class="modal-sub">修改后不影响已生成的向量数据</p>
        <div class="field">
          <label class="field-label">文档名称</label>
          <input v-model="renameValue" class="input" @keydown.enter="confirmRename" />
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="renameTarget = null">取消</button>
          <button class="btn btn-primary" @click="confirmRename">保存</button>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <div v-if="deleteTarget" class="modal-mask" @click.self="deleteTarget = null">
      <div class="modal modal-sm">
        <div class="modal-title">删除文档</div>
        <p class="modal-sub">确定删除「{{ deleteTarget.name }}」吗？其向量数据将一并清除，此操作不可恢复。</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="deleteTarget = null">取消</button>
          <button class="btn btn-del" @click="confirmDelete">确认删除</button>
        </div>
      </div>
    </div>
  </div>
  </ElConfigProvider>
</template>

<style scoped>
.page { padding: 28px 32px; max-width: 1200px; width: 100%; margin: 0 auto; }
.page-head { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 22px; }
.stat-chips { display: flex; gap: 10px; }
.chip { font-size: 13px; padding: 8px 14px; border-radius: var(--radius-md); font-weight: 500; }
.chip b { font-weight: 700; margin-right: 2px; }

.upload-zone {
  display: flex; align-items: center; gap: 22px; flex-wrap: wrap;
  border: 2px dashed var(--hairline-strong); border-radius: var(--radius-lg);
  padding: 42px 40px; margin-bottom: 14px; background: var(--surface-soft);
  min-height: 190px; cursor: pointer;
  transition: all 0.15s ease;
}
.upload-zone:hover { border-color: var(--brand-purple-300); }
.upload-zone:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.upload-zone.dragging { border-color: var(--primary); background: var(--tint-lavender); }
.upload-icon {
  width: 72px; height: 72px; border-radius: var(--radius-lg);
  background: var(--tint-sky); color: var(--link-blue);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.link-text { color: var(--link-blue); font-weight: 500; }
/* 上传目标空间选择（Element Plus） */
.upload-target { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.upload-target-label { font-size: 13px; color: var(--slate); font-weight: 500; white-space: nowrap; }
.upload-select {
  --el-color-primary: #5645d4;
  --el-border-radius-base: 8px;
  --el-border-color: var(--hairline-strong);
  --el-border-color-hover: var(--primary);
  --el-fill-color-blank: var(--canvas);
  --el-font-family: inherit;
  --el-text-color-regular: var(--ink);
  width: 180px;
}
.search-row { margin-bottom: 14px; }
.search-box {
  display: flex; align-items: center; gap: 8px; width: 280px; padding: 0 12px; height: 40px;
  background: var(--canvas); border: 1px solid var(--hairline); border-radius: var(--radius-md);
  color: var(--stone);
}
.search-input { border: none; outline: none; flex: 1; font-size: 13px; background: transparent; }

.file-ico {
  width: 34px; height: 34px; border-radius: var(--radius-md);
  background: var(--tint-cream); color: var(--brand-brown);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: all 0.15s ease;
}
.doc-name { max-width: 300px; font-weight: 500; color: var(--ink); }

/* 文档表格柔化：更大行距、浅分隔线、行悬浮着色、圆角卡片化 */
.table-wrap { border-radius: var(--radius-lg); overflow: hidden; }
.table :is(th, td) { padding: 15px 18px; }
.table tbody tr { transition: background 0.15s ease; }
.table tbody tr:hover { background: var(--surface-soft); }
.table tbody tr:hover .file-ico { background: var(--tint-sky); color: var(--link-blue); }
.table tbody td { border-bottom: 1px solid var(--hairline-soft); }
.table tbody tr:last-child td { border-bottom: none; }
.table thead th { background: var(--surface-soft); }

/* 分页 */
.pagination-row { display: flex; justify-content: flex-end; margin-top: 16px; }
.pagination-row :deep(.el-pagination) {
  --el-color-primary: #5645d4;
  --el-pagination-button-color: var(--slate);
  --el-pagination-hover-color: var(--primary);
  font-family: inherit;
}

/* 删除确认弹窗 */
.modal-sm { max-width: 420px; }
.modal-sub { color: var(--slate); }
.btn-del { background: var(--error); color: #fff; }
.btn-del:hover { background: #b42318; }
.action-btn {
  border: none; background: transparent; color: var(--steel);
  padding: 6px; border-radius: var(--radius-sm); display: flex;
}
.action-btn:hover { background: var(--surface); color: var(--ink); }
.action-btn.danger:hover { color: var(--error); background: #fdecec; }
.empty-cell { text-align: center; padding: 44px 0 !important; color: var(--stone); }
.empty-cell p { margin-top: 8px; font-size: 13px; }

@media (max-width: 720px) {
  .page { padding: 20px 16px; }
  .upload-target { margin-left: 0; }
}
</style>

<style>
/* Element Plus 下拉弹层挂在 body 下，需用全局样式适配 Notion 主题 */
.kb-select-popper {
  --el-color-primary: #5645d4;
  --el-border-radius-base: 8px;
  --el-font-family: inherit;
  --el-text-color-regular: var(--ink, #37352f);
  --el-border-color-light: #ede9e4;
  --el-box-shadow-light: 0 10px 32px rgba(10, 21, 48, 0.12);
}
.kb-select-popper .el-select-dropdown__item.is-selected { color: #5645d4; font-weight: 600; }
.kb-select-popper .el-select-dropdown__item.is-hovering { background: #f4f2fc; }
/* 分页内部的“每页条数”选择弹层同样挂 body，统一主题 */
.el-select-dropdown .el-select-dropdown__item.is-selected { color: #5645d4; font-weight: 600; }
</style>
