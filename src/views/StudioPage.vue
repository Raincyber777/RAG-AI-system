<script setup lang="ts">
/**
 * 课堂纪要工作台（核心页面）
 * 左：多模态上传（录音 / 图片 / 视频）+ Agent 处理步骤时间线
 * 右：结构化纪要流式渲染（主题逐字 → 其余章节逐条浮现）+ 引用溯源卡片
 * 处理流程为前端演示（定时器模拟），接入真实模型后仅需替换 runSteps / startStreaming 中的回调
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { addClassNote, findNote } from '@/store/study'
import type { ClassNote } from '@/mock/data'
import { buildNoteMarkdown, downloadText } from '@/utils/exportNote'

const route = useRoute()
const router = useRouter()

// ---------- 上传材料 ----------
type FileKind = 'audio' | 'image' | 'video' | 'ppt' | 'other'
interface InputFile {
  id: string
  name: string
  kind: FileKind
  size: string
  preview?: string
}

const KIND_META: Record<FileKind, { label: string; icon: string; tint: string }> = {
  audio: { label: '音频', icon: 'headphones', tint: 'tint-sky' },
  image: { label: '图片', icon: 'image', tint: 'tint-mint' },
  video: { label: '视频', icon: 'film', tint: 'tint-rose' },
  ppt: { label: 'PPT', icon: 'layers', tint: 'tint-yellow-bold' },
  other: { label: '其他', icon: 'file', tint: 'tint-peach' },
}

const inputFiles = ref<InputFile[]>([])
const dragging = ref(false)
const fileInput = ref<HTMLInputElement>()
const classTitle = ref('')
const courseName = ref('')
const MAX_FILES = 12

const ACCEPT_EXTS: Record<FileKind, string[]> = {
  audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'amr', 'wma'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'heic', 'heif'],
  video: ['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'wmv', 'flv', 'ts'],
  ppt: ['ppt', 'pptx', 'pps', 'ppsx'],
  other: ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'],
}
const acceptAttr = Object.values(ACCEPT_EXTS).flat().map((e) => '.' + e).join(',')

function detectKind(name: string, type: string): FileKind | null {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (ACCEPT_EXTS.ppt.includes(ext)) return 'ppt'
  if (type.startsWith('audio/') || ACCEPT_EXTS.audio.includes(ext)) return 'audio'
  if (type.startsWith('image/') || ACCEPT_EXTS.image.includes(ext)) return 'image'
  if (type.startsWith('video/') || ACCEPT_EXTS.video.includes(ext)) return 'video'
  if (type === 'application/pdf' || ACCEPT_EXTS.other.includes(ext)) return 'other'
  return null
}

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function pickFiles() {
  if (genState.value === 'running' || genState.value === 'streaming') return
  fileInput.value?.click()
}
function onFileChange(e: Event) {
  handleFiles((e.target as HTMLInputElement).files)
  ;(e.target as HTMLInputElement).value = ''
}
function onDrop(e: DragEvent) {
  dragging.value = false
  handleFiles(e.dataTransfer?.files)
}

function handleFiles(list: FileList | null | undefined) {
  if (!list) return
  for (const f of Array.from(list)) {
    const kind = detectKind(f.name, f.type)
    if (!kind) continue
    if (inputFiles.value.length >= MAX_FILES) break
    if (inputFiles.value.some((x) => x.name === f.name && x.size === formatSize(f.size))) continue
    const item: InputFile = {
      id: 'f' + Date.now() + Math.random().toString(36).slice(2, 5),
      name: f.name,
      kind,
      size: formatSize(f.size),
    }
    if (kind === 'image') item.preview = URL.createObjectURL(f)
    inputFiles.value.push(item)
  }
}

function removeFile(id: string) {
  const idx = inputFiles.value.findIndex((f) => f.id === id)
  if (idx >= 0) {
    const prev = inputFiles.value[idx]
    if (prev?.preview) URL.revokeObjectURL(prev.preview)
    inputFiles.value.splice(idx, 1)
  }
}

const kindCount = computed(() => {
  const c: Record<FileKind, number> = { audio: 0, image: 0, video: 0, ppt: 0, other: 0 }
  for (const f of inputFiles.value) c[f.kind]++
  return c
})
const canStart = computed(
  () => inputFiles.value.length > 0 && classTitle.value.trim() !== '' && (genState.value === 'idle' || genState.value === 'done' || genState.value === 'stopped')
)

// ---------- Agent 步骤时间线 ----------
type StepStatus = 'pending' | 'running' | 'done'
interface AgentStep {
  key: string
  label: string
  desc: string
  icon: string
  status: StepStatus
  dur?: string
}

function buildSteps(files: InputFile[]): AgentStep[] {
  const kinds = new Set(files.map((f) => f.kind))
  const steps: AgentStep[] = []
  if (kinds.has('video')) {
    steps.push({ key: 'extract', label: '提取音频', desc: 'ffmpeg.wasm 从视频中分离音轨', icon: 'film', status: 'pending' })
    steps.push({ key: 'frames', label: '抽取关键帧', desc: '每 5 秒抽帧 · 感知哈希去重 · 最多 15 帧', icon: 'image', status: 'pending' })
  }
  if (kinds.has('ppt')) {
    steps.push({ key: 'ppt', label: '演示文稿解析', desc: '逐页导出为图片 · 提取讲者备注', icon: 'layers', status: 'pending' })
  }
  if (kinds.has('video') || kinds.has('image') || kinds.has('ppt')) {
    steps.push({ key: 'vision', label: '图片理解', desc: '多模态大模型识别板书 / 幻灯片文字与公式', icon: 'image', status: 'pending' })
  }
  if (kinds.has('other')) {
    steps.push({ key: 'docs', label: '讲义文本抽取', desc: 'PDF / Word / 文本 · 段落切分与公式定位', icon: 'file', status: 'pending' })
  }
  if (kinds.has('audio') || kinds.has('video')) {
    steps.push({ key: 'asr', label: '语音转写', desc: 'Whisper 生成带时间戳的文字稿', icon: 'headphones', status: 'pending' })
  }
  steps.push({ key: 'fuse', label: '生成课堂纪要', desc: '多模态融合 · 流式输出结构化纪要', icon: 'spark', status: 'pending' })
  steps.push({ key: 'index', label: '纪要向量入库', desc: '切片并向量化，写入课堂知识库', icon: 'database', status: 'pending' })
  return steps
}

const steps = ref<AgentStep[]>([])
const currentStep = computed(() => steps.value.find((s) => s.status === 'running'))
const doneSteps = computed(() => steps.value.filter((s) => s.status === 'done').length)
const progress = computed(() => (steps.value.length ? Math.round((doneSteps.value / steps.value.length) * 100) : 0))

// ---------- 纪要流式状态 ----------
const genState = ref<'idle' | 'running' | 'streaming' | 'done' | 'stopped'>('idle')
const note = ref<ClassNote | null>(null)
const savedId = ref<string | null>(null)

const NOTE_SECTIONS = [
  { key: 'theme', title: '课程主题', icon: 'book' },
  { key: 'points', title: '核心知识点', icon: 'zap' },
  { key: 'definitions', title: '重要定义与公式', icon: 'file' },
  { key: 'emphasized', title: '教师强调重点', icon: 'alert' },
  { key: 'qa', title: '学生提问与解答', icon: 'chat' },
  { key: 'todos', title: '课后作业 / 待办', icon: 'check' },
] as const
type SectionKey = (typeof NOTE_SECTIONS)[number]['key']

const themeShown = ref('')
const headersShown = ref<string[]>([])
const itemsShown = reactive<Record<string, number>>({ points: 0, definitions: 0, emphasized: 0, qa: 0, todos: 0 })
const activeSection = ref<SectionKey | ''>('')

function shown(sec: string) {
  return itemsShown[sec] ?? 0
}
function sectionVisible(key: string) {
  if (key === 'theme') return themeShown.value !== ''
  return headersShown.value.includes(key)
}

// 演示纪要内容（接入真实模型后由融合生成接口返回）
function makeDemoNote(title: string, course: string, files: InputFile[]): ClassNote {
  const kinds = new Set(files.map((f) => f.kind))
  const visualCount = files.filter((f) => f.kind === 'image' || f.kind === 'ppt').length
  const duration = kinds.has('audio') ? '录音 45 分钟' : kinds.has('video') ? '视频 12 分钟' : visualCount > 0 ? `图片 ${visualCount} 张` : '讲义 2 份'
  const keyframes = kinds.has('video') ? 9 : visualCount > 0 ? Math.min(12, Math.max(4, visualCount * 2)) : 0
  return {
    id: 'n' + Date.now(),
    title,
    course: course || '未命名课程',
    date: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'),
    duration,
    keyframes,
    chunkCount: 18 + files.length * 5,
    questions: 0,
    status: 'done',
    theme:
      '本节课围绕泰勒公式与泰勒级数展开。教师首先回顾了麦克劳林公式，推导了常用函数（e^x、sin x、cos x）的展开式，随后讲解了拉格朗日余项与佩亚诺余项的区别与选用场景，最后通过三道例题演示了利用泰勒展开求极限与证明不等式的方法。',
    points: [
      { text: '泰勒公式：f(x) 在 x₀ 处 n 阶可导，可用多项式逼近，余项刻画逼近误差', cite: '录音 03:24' },
      { text: '麦克劳林公式是 x₀ = 0 的特殊情形，e^x = 1 + x + x²/2! + …', cite: 'PPT 第2页' },
      { text: '拉格朗日余项适合定性估计误差，佩亚诺余项适合求极限时的局部展开', cite: '录音 11:47' },
      { text: '利用泰勒展开求极限的关键：确定展开到几阶，让"余项 o(xⁿ)"可以忽略', cite: '录音 18:05' },
      { text: 'sin x 与 cos x 的展开只含奇/偶次幂，利用奇偶性可减少计算量', cite: 'PPT 第5页' },
    ],
    definitions: [
      { term: '泰勒公式', detail: 'f(x) = Σ f⁽ⁿ⁾(x₀)/n! · (x-x₀)ⁿ + Rₙ(x)，其中 Rₙ 为余项', cite: 'PPT 第3页' },
      { term: '拉格朗日余项', detail: 'Rₙ(x) = f⁽ⁿ⁺¹⁾(ξ)/(n+1)! · (x-x₀)ⁿ⁺¹，ξ 介于 x₀ 与 x 之间' },
    ],
    emphasized: [
      '期末必考：用泰勒展开求 undefined 型极限，至少展开到分母的最高阶',
      '记住 e^x、sin x、cos x、ln(1+x)、(1+x)^α 五个基础展开式即可推导其余',
    ],
    qa: [{ q: '展开到几阶才够？', a: '看分母：分母是 x³ 就至少展开到 3 阶，上下同阶时再高一阶保险。' }],
    todos: ['完成教材 P214 习题 4-3：第 1、3、7 题', '推导 cos x 的麦克劳林展开并记忆', '预习下一讲：傅里叶级数'],
  }
}

// ---------- 流程控制 ----------
const stepTimers: number[] = []
let typeTimer: number | null = null
let revealTimer: number | null = null

function clearAllTimers() {
  for (const t of stepTimers) window.clearTimeout(t)
  stepTimers.length = 0
  if (typeTimer) { window.clearInterval(typeTimer); typeTimer = null }
  if (revealTimer) { window.clearInterval(revealTimer); revealTimer = null }
}

function runSteps() {
  const list = steps.value
  // 最后两步（生成纪要 / 向量入库）由流式过程驱动，不进入通用步骤链
  const preCount = Math.max(0, list.length - 2)
  let i = 0
  const next = () => {
    if (i >= preCount) {
      const fuse = list[list.length - 2]
      if (fuse) fuse.status = 'running'
      startStreaming()
      return
    }
    const step = list[i]
    if (!step) return
    step.status = 'running'
    const dur = 1600 + Math.random() * 1200
    stepTimers.push(
      window.setTimeout(() => {
        step.status = 'done'
        step.dur = (dur / 1000).toFixed(1) + 's'
        i++
        next()
      }, dur)
    )
  }
  next()
}

// 逐条浮现计划：header → items 依序出现
type PlanItem = { sec: SectionKey; kind: 'header' | 'item'; idx: number }
let plan: PlanItem[] = []

function startStreaming() {
  const n = note.value
  if (!n) return
  genState.value = 'streaming'
  activeSection.value = 'theme'

  // 主题段落逐字输出
  const full = n.theme
  let i = 0
  typeTimer = window.setInterval(() => {
    i += 2
    if (i >= full.length) {
      if (typeTimer) { window.clearInterval(typeTimer); typeTimer = null }
      themeShown.value = full
      startRevealPlan()
    } else {
      themeShown.value = full.slice(0, i)
    }
  }, 26)
}

function startRevealPlan() {
  const n = note.value
  if (!n) return
  plan = []
  const secs: Array<[SectionKey, number]> = [
    ['points', n.points.length],
    ['definitions', n.definitions.length],
    ['emphasized', n.emphasized.length],
    ['qa', n.qa.length],
    ['todos', n.todos.length],
  ]
  for (const [sec, len] of secs) {
    if (len === 0) continue
    plan.push({ sec, kind: 'header', idx: 0 })
    for (let k = 0; k < len; k++) plan.push({ sec, kind: 'item', idx: k })
  }
  revealTimer = window.setInterval(() => {
    const item = plan.shift()
    if (!item) {
      if (revealTimer) { window.clearInterval(revealTimer); revealTimer = null }
      finishStreaming()
      return
    }
    activeSection.value = item.sec
    if (item.kind === 'header') {
      if (!headersShown.value.includes(item.sec)) headersShown.value.push(item.sec)
    } else {
      itemsShown[item.sec] = item.idx + 1
    }
  }, 260)
}

function finishStreaming() {
  // 融合步骤完成，最后走「向量入库」
  const list = steps.value
  const fuse = list[list.length - 2]
  const index = list[list.length - 1]
  if (fuse) { fuse.status = 'done'; fuse.dur = '8.4s' }
  if (index) { index.status = 'running' }
  stepTimers.push(
    window.setTimeout(() => {
      if (index) { index.status = 'done'; index.dur = '1.2s' }
      completeGeneration()
    }, 1400)
  )
}

function completeGeneration() {
  genState.value = 'done'
  activeSection.value = ''
  const n = note.value
  if (n) {
    // 保存到共享 store（我的纪要 / 追问侧边栏同步可见）
    const saved = addClassNote({ ...n, status: 'done' })
    savedId.value = saved.id
    updateNoteRef(saved.id)
  }
}

function updateNoteRef(id: string) {
  const saved = findNote(id)
  if (saved) note.value = saved
}

function startGenerate() {
  if (!canStart.value) return
  clearAllTimers()
  themeShown.value = ''
  headersShown.value = []
  for (const k of Object.keys(itemsShown)) itemsShown[k] = 0
  plan = []
  savedId.value = null
  note.value = makeDemoNote(classTitle.value.trim(), courseName.value.trim(), inputFiles.value)
  steps.value = buildSteps(inputFiles.value)
  genState.value = 'running'
  runSteps()
}

function stopGenerate() {
  clearAllTimers()
  const running = steps.value.find((s) => s.status === 'running')
  if (running) running.status = 'pending'
  genState.value = 'stopped'
  activeSection.value = ''
}

function resetAll() {
  clearAllTimers()
  genState.value = 'idle'
  note.value = null
  savedId.value = null
  steps.value = []
  themeShown.value = ''
  headersShown.value = []
  for (const k of Object.keys(itemsShown)) itemsShown[k] = 0
}

const stateTag: Record<typeof genState.value, { text: string; cls: string }> = {
  idle: { text: '待生成', cls: 'tag' },
  running: { text: 'Agent 处理中', cls: 'tag tag-yellow' },
  streaming: { text: '纪要生成中', cls: 'tag tag-blue' },
  done: { text: '已完成', cls: 'tag tag-green' },
  stopped: { text: '已停止', cls: 'tag tag-red' },
}

// ---------- 引用溯源卡片 ----------
const activeSource = ref<{ cite: string; snippet: string } | null>(null)

function citeIcon(cite: string) {
  return cite.startsWith('录音') ? 'headphones' : 'image'
}
function showSource(cite: string) {
  if (activeSource.value?.cite === cite) { activeSource.value = null; return }
  const n = note.value
  const snippet = cite.startsWith('录音')
    ? `「${n?.title ?? '本节课'}」录音 ${cite.replace('录音 ', '')} 处原文：老师正在讲解该知识点的完整推导过程……（演示片段，接入真实转写后显示原文）`
    : `「${n?.title ?? '本节课'}」${cite} 原图：${cite.startsWith('PPT') ? '幻灯片页面' : '板书照片'}，已由多模态模型识别出标题、公式与批注文字。`
  activeSource.value = { cite, snippet }
}

// ---------- 导出 / 追问 ----------
function exportNote() {
  if (!note.value) return
  downloadText(note.value.title, buildNoteMarkdown(note.value))
}
function goQA() {
  router.push(savedId.value ? { path: '/qa', query: { note: savedId.value } } : '/qa')
}

// ---------- 回看已有纪要（/studio?note=id） ----------
onMounted(() => {
  const id = route.query.note
  const exists = findNote(typeof id === 'string' ? id : null)
  if (exists) {
    note.value = exists
    savedId.value = exists.id
    classTitle.value = exists.title
    courseName.value = exists.course
    genState.value = 'done'
    themeShown.value = exists.theme
    headersShown.value = ['points', 'definitions', 'emphasized', 'qa', 'todos']
    for (const k of Object.keys(itemsShown)) itemsShown[k] = 999
    const fake: InputFile[] = []
    if (exists.duration.startsWith('录音')) fake.push({ id: 'f-a', name: '课堂录音.m4a', kind: 'audio', size: '38.2 MB' })
    if (exists.keyframes > 0) fake.push({ id: 'f-i', name: '板书照片 ×' + Math.max(1, Math.round(exists.keyframes / 2)), kind: 'image', size: '12.4 MB' })
    steps.value = buildSteps(fake.length ? fake : [{ id: 'f-i', name: '板书照片', kind: 'image', size: '' }])
    steps.value = steps.value.map((s) => ({ ...s, status: 'done' as StepStatus, dur: '2.0s' }))
  }
})

onBeforeUnmount(clearAllTimers)
</script>

<template>
  <div class="page">
    <!-- 页头 -->
    <header class="page-head">
      <div>
        <h1 class="h2">课堂纪要工作台</h1>
        <p class="text-sm">上传课堂音频、板书照片、PPT 或讲义，Agent 自动转写、理解并生成可追问的结构化纪要</p>
      </div>
      <div class="stat-chips">
        <div class="chip tint-sky"><b>{{ inputFiles.length }}</b> 个材料</div>
        <div class="chip tint-lavender"><b>{{ progress }}%</b> 处理进度</div>
      </div>
    </header>

    <div class="studio-grid">
      <!-- 左：上传 + Agent 步骤 -->
      <div class="left-col">
        <div
          class="upload-zone"
          :class="{ dragging, disabled: genState === 'running' || genState === 'streaming' }"
          role="button"
          tabindex="0"
          aria-label="上传课堂材料：点击选择或拖拽音频、图片、视频、PPT 或讲义文件"
          @click="pickFiles"
          @keydown.enter.prevent="pickFiles"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
        >
          <div class="upload-icon"><AppIcon name="upload" :size="26" /></div>
          <div class="h4">拖拽材料到此处，或 <span class="link-text">点击上传</span></div>
          <div class="kind-hints">
            <span class="kind-hint"><AppIcon name="headphones" :size="13" /> 音频 mp3 / wav / m4a 等</span>
            <span class="kind-hint"><AppIcon name="image" :size="13" /> 图片 jpg / png / webp 等</span>
            <span class="kind-hint"><AppIcon name="film" :size="13" /> 视频 mp4 / mov / webm 等</span>
            <span class="kind-hint"><AppIcon name="layers" :size="13" /> PPT ppt / pptx</span>
            <span class="kind-hint"><AppIcon name="file" :size="13" /> 其他 pdf / word / txt</span>
          </div>
          <input ref="fileInput" type="file" multiple hidden :accept="acceptAttr" @change="onFileChange" />
        </div>

        <!-- 材料清单 -->
        <div v-if="inputFiles.length" class="file-list">
          <div v-for="f in inputFiles" :key="f.id" class="file-item">
            <img v-if="f.preview" :src="f.preview" class="file-thumb" alt="图片预览" />
            <span v-else class="file-badge" :class="KIND_META[f.kind].tint">
              <AppIcon :name="KIND_META[f.kind].icon" :size="15" />
            </span>
            <div class="flex-1 min-w-0">
              <div class="file-name ellipsis">{{ f.name }}</div>
              <div class="file-meta">{{ KIND_META[f.kind].label }} · {{ f.size }}</div>
            </div>
            <button class="icon-btn" aria-label="移除该材料" @click="removeFile(f.id)"><AppIcon name="x" :size="15" /></button>
          </div>
        </div>

        <!-- 课堂信息 -->
        <div class="card info-card">
          <div class="field">
            <label class="field-label" for="class-title">课堂主题</label>
            <input id="class-title" v-model="classTitle" class="input" placeholder="例如：第12讲 泰勒展开与级数" />
          </div>
          <div class="field">
            <label class="field-label" for="course-name">所属课程（选填）</label>
            <input id="course-name" v-model="courseName" class="input" placeholder="例如：高等数学" />
          </div>
        </div>

        <!-- Agent 步骤时间线 -->
        <div class="card steps-card">
          <div class="steps-head">
            <div class="h4">Agent 工作流</div>
            <span v-if="currentStep" class="text-caption">正在执行：{{ currentStep.label }}</span>
            <span v-else-if="genState === 'done'" class="text-caption">全部步骤完成</span>
          </div>
          <div v-if="!steps.length" class="steps-empty">
            <AppIcon name="layers" :size="22" />
            <p>上传材料并填写课堂主题后，Agent 将按材料类型编排处理步骤</p>
          </div>
          <ol v-else class="steps-list">
            <li v-for="(s, i) in steps" :key="s.key" class="step" :class="s.status">
              <div class="step-rail">
                <div class="step-dot">
                  <AppIcon v-if="s.status === 'done'" name="check" :size="13" />
                  <span v-else-if="s.status === 'running'" class="spinner" style="width:14px;height:14px;border-width:2px"></span>
                  <template v-else>{{ i + 1 }}</template>
                </div>
                <div v-if="i < steps.length - 1" class="step-line"></div>
              </div>
              <div class="step-body">
                <div class="step-top">
                  <AppIcon :name="s.icon" :size="14" class="step-ico" />
                  <span class="step-label">{{ s.label }}</span>
                  <span v-if="s.dur" class="step-dur">{{ s.dur }}</span>
                </div>
                <div class="step-desc">{{ s.desc }}</div>
              </div>
            </li>
          </ol>

          <!-- 操作区 -->
          <div class="gen-actions">
            <button v-if="genState === 'running' || genState === 'streaming'" class="btn btn-del" @click="stopGenerate">
              <AppIcon name="stop" :size="14" /> 停止生成
            </button>
            <template v-else>
              <button class="btn btn-primary" :disabled="!canStart" @click="startGenerate">
                <AppIcon name="spark" :size="14" />
                {{ genState === 'done' || genState === 'stopped' ? '重新生成纪要' : '开始生成纪要' }}
              </button>
              <span v-if="!inputFiles.length || !classTitle.trim()" class="gen-hint">请先上传材料并填写课堂主题</span>
            </template>
          </div>
          <p v-if="genState === 'stopped'" class="stopped-tip">已中断生成，已完成的步骤会保留，可随时重新开始。</p>
        </div>
      </div>

      <!-- 右：结构化纪要 -->
      <div class="right-col">
        <div class="card note-panel">
          <div class="note-head">
            <div class="flex-1 min-w-0">
              <div class="note-title ellipsis">{{ note ? note.title : '课堂纪要' }}</div>
              <div class="note-meta">
                <span class="tag" :class="stateTag[genState].cls">
                  <span v-if="genState === 'running' || genState === 'streaming'" class="spinner" style="width:11px;height:11px;border-width:1.5px"></span>
                  {{ stateTag[genState].text }}
                </span>
                <span v-if="note" class="text-caption">{{ note.course }} · {{ note.duration }}</span>
              </div>
            </div>
            <div v-if="genState === 'done' && note" class="flex gap-xs">
              <button class="btn btn-secondary btn-sm" @click="exportNote"><AppIcon name="download" :size="14" /> 导出 Markdown</button>
              <button class="btn btn-primary btn-sm" @click="goQA"><AppIcon name="chat" :size="14" /> 课堂追问</button>
            </div>
          </div>

          <!-- 空态 -->
          <div v-if="genState === 'idle' && !note" class="note-empty">
            <div class="note-empty-icon"><AppIcon name="spark" :size="26" /></div>
            <div class="h4">纪要将在这里生成</div>
            <p class="text-sm">支持的结构：课程主题 / 核心知识点 / 重要定义与公式<br />教师强调重点 / 学生提问与解答 / 课后作业</p>
          </div>

          <!-- 纪要内容 -->
          <div v-else class="note-body">
            <section
              v-for="sec in NOTE_SECTIONS"
              :key="sec.key"
              v-show="sectionVisible(sec.key)"
              class="n-sec"
            >
              <div class="n-head">
                <span class="n-ico"><AppIcon :name="sec.icon" :size="14" /></span>
                <span class="n-title">{{ sec.title }}</span>
                <span v-if="activeSection === sec.key && genState === 'streaming'" class="n-typing">
                  <span class="spinner" style="width:11px;height:11px;border-width:1.5px"></span> 生成中
                </span>
              </div>

              <div v-if="sec.key === 'theme'" class="n-theme">
                {{ themeShown }}<span v-if="activeSection === 'theme' && genState === 'streaming'" class="caret"></span>
              </div>

              <ul v-else-if="sec.key === 'points'" class="n-list">
                <li v-for="(p, i) in note?.points || []" :key="i" v-show="i < shown('points')" class="n-item" :class="{ fresh: genState === 'streaming' }">
                  <span class="n-bullet"></span>
                  <span class="flex-1">{{ p.text }}</span>
                  <button class="cite-chip" :aria-label="'查看来源：' + p.cite" @click="showSource(p.cite)">
                    <AppIcon :name="citeIcon(p.cite)" :size="12" /> {{ p.cite }}
                  </button>
                </li>
              </ul>

              <ul v-else-if="sec.key === 'definitions'" class="n-list">
                <li v-for="(d, i) in note?.definitions || []" :key="i" v-show="i < shown('definitions')" class="n-item def" :class="{ fresh: genState === 'streaming' }">
                  <div class="def-term">{{ d.term }}</div>
                  <div class="def-detail">
                    {{ d.detail }}
                    <button v-if="d.cite" class="cite-chip" :aria-label="'查看来源：' + d.cite" @click="showSource(d.cite)">
                      <AppIcon :name="citeIcon(d.cite)" :size="12" /> {{ d.cite }}
                    </button>
                  </div>
                </li>
              </ul>

              <ul v-else-if="sec.key === 'emphasized'" class="n-list">
                <li v-for="(e, i) in note?.emphasized || []" :key="i" v-show="i < shown('emphasized')" class="n-item emph" :class="{ fresh: genState === 'streaming' }">
                  <AppIcon name="alert" :size="14" class="emph-ico" />
                  <span class="flex-1">{{ e }}</span>
                </li>
              </ul>

              <div v-else-if="sec.key === 'qa'" class="n-qa">
                <div v-for="(q, i) in note?.qa || []" :key="i" v-show="i < shown('qa')" class="qa-block" :class="{ fresh: genState === 'streaming' }">
                  <div class="qa-q"><span class="qa-tag">问</span>{{ q.q }}</div>
                  <div class="qa-a"><span class="qa-tag a">答</span>{{ q.a }}</div>
                </div>
              </div>

              <ul v-else-if="sec.key === 'todos'" class="n-list">
                <li v-for="(t, i) in note?.todos || []" :key="i" v-show="i < shown('todos')" class="n-item todo" :class="{ fresh: genState === 'streaming' }">
                  <span class="todo-box"></span>
                  <span class="flex-1">{{ t }}</span>
                </li>
              </ul>
            </section>
          </div>

          <p v-if="genState === 'done' && note" class="note-foot">已存入「我的纪要」，知识片段 {{ note.chunkCount }} 条 · 关键帧 {{ note.keyframes }} 张（演示数据）</p>
        </div>

        <!-- 引用溯源卡片 -->
        <Transition name="pop">
          <div v-if="activeSource" class="card source-card" role="dialog" aria-label="引用来源详情">
            <div class="source-head">
              <span class="source-ico"><AppIcon :name="citeIcon(activeSource.cite)" :size="14" /></span>
              <b>{{ activeSource.cite }}</b>
              <button class="icon-btn" aria-label="关闭来源卡片" @click="activeSource = null"><AppIcon name="x" :size="14" /></button>
            </div>
            <p class="source-snippet">{{ activeSource.snippet }}</p>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 28px 32px 48px; max-width: 1280px; width: 100%; margin: 0 auto; }
.page-head { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 22px; }
.stat-chips { display: flex; gap: 10px; }
.chip { font-size: 13px; padding: 8px 14px; border-radius: var(--radius-md); font-weight: 500; }
.chip b { font-weight: 700; margin-right: 2px; }

.studio-grid { display: grid; grid-template-columns: 420px 1fr; gap: 18px; align-items: start; }
.left-col { display: flex; flex-direction: column; gap: 14px; }
.right-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

/* 上传区 */
.upload-zone {
  display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center;
  border: 2px dashed var(--hairline-strong); border-radius: var(--radius-lg);
  padding: 36px 28px; background: var(--surface-soft); cursor: pointer; transition: all 0.15s ease;
}
.upload-zone:hover, .upload-zone.dragging { border-color: var(--primary); background: var(--tint-lavender); }
.upload-zone:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.upload-zone.disabled { pointer-events: none; opacity: 0.55; }
.upload-icon {
  width: 58px; height: 58px; border-radius: var(--radius-lg);
  background: var(--tint-sky); color: var(--link-blue);
  display: flex; align-items: center; justify-content: center;
}
.link-text { color: var(--link-blue); font-weight: 500; }
.kind-hints { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 2px; }
.kind-hint {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; color: var(--slate); background: var(--canvas);
  border: 1px solid var(--hairline); border-radius: var(--radius-full); padding: 4px 10px;
}

/* 材料清单 */
.file-list { display: flex; flex-direction: column; gap: 8px; }
.file-item {
  display: flex; align-items: center; gap: 10px; padding: 9px 12px;
  background: var(--canvas); border: 1px solid var(--hairline); border-radius: var(--radius-md);
}
.file-thumb { width: 36px; height: 36px; object-fit: cover; border-radius: var(--radius-sm); flex-shrink: 0; }
.file-badge {
  width: 36px; height: 36px; border-radius: var(--radius-sm); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.file-name { font-size: 13px; font-weight: 500; }
.file-meta { font-size: 11.5px; color: var(--stone); }
.icon-btn {
  border: none; background: transparent; color: var(--stone);
  padding: 6px; border-radius: var(--radius-sm); display: flex; cursor: pointer;
}
.icon-btn:hover { background: var(--surface); color: var(--error); }

.info-card { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 6px; }

/* Agent 步骤 */
.steps-card { padding: 18px; }
.steps-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px; }
.steps-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  color: var(--stone); text-align: center; padding: 18px 8px;
}
.steps-empty p { font-size: 12.5px; max-width: 260px; line-height: 1.6; }
.steps-list { list-style: none; display: flex; flex-direction: column; }
.step { display: flex; gap: 12px; }
.step-rail { display: flex; flex-direction: column; align-items: center; width: 26px; flex-shrink: 0; }
.step-dot {
  width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; color: var(--stone);
  background: var(--surface-soft); border: 1px solid var(--hairline-strong);
  transition: all 0.2s ease;
}
.step.running .step-dot { background: var(--tint-yellow); border-color: var(--brand-yellow); color: var(--ink); }
.step.done .step-dot { background: var(--tint-mint); border-color: var(--brand-green); color: var(--brand-green); }
.step-line { flex: 1; width: 2px; min-height: 16px; background: var(--hairline-strong); margin: 4px 0; }
.step.done .step-line { background: var(--brand-green); opacity: 0.4; }
.step-body { flex: 1; padding-bottom: 16px; min-width: 0; }
.step:last-child .step-body { padding-bottom: 4px; }
.step-top { display: flex; align-items: center; gap: 6px; }
.step-ico { color: var(--steel); }
.step-label { font-size: 13.5px; font-weight: 600; color: var(--ink); }
.step.pending .step-label { color: var(--slate); font-weight: 500; }
.step-dur { margin-left: auto; font-size: 11.5px; color: var(--stone); font-variant-numeric: tabular-nums; }
.step-desc { font-size: 12px; color: var(--stone); margin-top: 2px; }

.gen-actions { display: flex; align-items: center; gap: 10px; margin-top: 6px; padding-top: 14px; border-top: 1px solid var(--hairline-soft); flex-wrap: wrap; }
.gen-hint { font-size: 12px; color: var(--stone); }
.stopped-tip { margin-top: 10px; font-size: 12.5px; color: var(--error); }
.btn-del { background: var(--error); color: #fff; }
.btn-del:hover { background: #b42318; }

/* 纪要面板 */
.note-panel { padding: 20px 24px; }
.note-head { display: flex; align-items: flex-start; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid var(--hairline-soft); }
.note-title { font-size: 17px; font-weight: 700; letter-spacing: -0.2px; }
.note-meta { display: flex; align-items: center; gap: 8px; margin-top: 6px; }

.note-empty { text-align: center; padding: 56px 20px; color: var(--stone); }
.note-empty-icon {
  width: 64px; height: 64px; margin: 0 auto 14px; border-radius: var(--radius-lg);
  background: var(--tint-lavender); color: var(--primary);
  display: flex; align-items: center; justify-content: center;
}
.note-empty p { margin-top: 8px; line-height: 1.7; }

.note-body { padding-top: 6px; }
.n-sec { padding: 16px 0 4px; border-bottom: 1px solid var(--hairline-soft); }
.n-sec:last-child { border-bottom: none; }
.n-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.n-ico {
  width: 26px; height: 26px; border-radius: var(--radius-sm);
  background: var(--tint-lavender); color: var(--primary);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.n-title { font-size: 14px; font-weight: 700; }
.n-typing { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--link-blue); }

.n-theme { font-size: 14px; line-height: 1.8; color: var(--ink); }
.caret {
  display: inline-block; width: 2px; height: 15px; margin-left: 2px; vertical-align: -2px;
  background: var(--primary); animation: caret-blink 0.9s steps(1) infinite;
}
@keyframes caret-blink { 50% { opacity: 0; } }

.n-list { list-style: none; display: flex; flex-direction: column; gap: 9px; }
.n-item { display: flex; align-items: flex-start; gap: 9px; font-size: 13.5px; line-height: 1.65; }
.n-bullet { width: 6px; height: 6px; border-radius: 50%; background: var(--primary); margin-top: 8px; flex-shrink: 0; }

.def { display: block; }
.def-term { font-size: 13.5px; font-weight: 700; color: var(--brand-purple-800); }
.def-detail { font-size: 13px; color: var(--slate); line-height: 1.65; margin-top: 3px; }

.emph { background: var(--tint-yellow-bold); border-radius: var(--radius-md); padding: 9px 12px; font-size: 13.5px; }
.emph-ico { color: var(--brand-brown); margin-top: 3px; flex-shrink: 0; }

.qa-block { padding: 10px 12px; background: var(--surface-soft); border-radius: var(--radius-md); margin-bottom: 8px; }
.qa-q, .qa-a { display: flex; gap: 8px; font-size: 13.5px; line-height: 1.65; }
.qa-a { margin-top: 6px; color: var(--slate); }
.qa-tag {
  flex-shrink: 0; width: 20px; height: 20px; border-radius: 6px; font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  background: var(--tint-sky); color: var(--link-blue); margin-top: 1px;
}
.qa-tag.a { background: var(--tint-mint); color: var(--brand-green); }

.todo { align-items: center; }
.todo-box {
  width: 15px; height: 15px; border-radius: 4px; flex-shrink: 0;
  border: 1.5px solid var(--hairline-strong); background: var(--canvas);
}

/* 引用角标 */
.cite-chip {
  display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; margin-left: 6px;
  font-size: 11.5px; font-weight: 600; font-family: inherit;
  color: var(--link-blue); background: var(--tint-sky);
  border: none; border-radius: var(--radius-full); padding: 2.5px 9px;
  cursor: pointer; transition: all 0.15s ease;
}
.cite-chip:hover { background: var(--primary); color: #fff; }

/* 新浮现条目的入场动画 */
.fresh { animation: item-in 0.35s ease both; }
@keyframes item-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

.note-foot { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--hairline-soft); font-size: 12px; color: var(--stone); }

/* 引用溯源卡片 */
.source-card {
  position: sticky; bottom: 0; z-index: 10;
  border: 1px solid var(--hairline-strong); box-shadow: var(--shadow-modal);
  padding: 14px 16px; background: var(--canvas);
}
.source-head { display: flex; align-items: center; gap: 8px; }
.source-ico {
  width: 24px; height: 24px; border-radius: 6px; background: var(--tint-sky); color: var(--link-blue);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.source-head b { font-size: 13px; flex: 1; }
.source-snippet { margin-top: 8px; font-size: 12.5px; line-height: 1.7; color: var(--slate); }

.pop-enter-active, .pop-leave-active { transition: all 0.2s ease; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translateY(10px); }

@media (max-width: 1080px) {
  .studio-grid { grid-template-columns: 1fr; }
}
@media (max-width: 720px) {
  .page { padding: 20px 16px 40px; }
  .note-head { flex-direction: column; }
}
</style>
