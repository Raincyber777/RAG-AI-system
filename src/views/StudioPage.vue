<script setup lang="ts">
/**
 * 课堂纪要工作台（核心页面）
 * 左：多模态上传（录音 / 图片 / 视频）+ Agent 处理步骤时间线
 * 右：结构化纪要流式渲染（主题逐字 → 其余章节逐条浮现）+ 引用溯源卡片
 * 处理流程为前端演示（定时器模拟），接入真实模型后仅需替换 runSteps / startStreaming 中的回调
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount, onActivated, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'

// 组件名固定：AppLayout 的 keep-alive include 依赖它，路由切走再回来保持生成现场
defineOptions({ name: 'StudioPage' })
import AppIcon from '@/components/AppIcon.vue'
import AppSelect from '@/components/AppSelect.vue'
import { addClassNote, findNote, updateNote, removeClassNote, courseList, addCourse, classNotes, removeCourse, renameCourse, ensureNotesLoaded, noteFromApi } from '@/store/study'
import { notesApi, type ApiNote } from '@/api'
import { ApiError } from '@/api/http'
import { wrongBook } from '@/store/quiz'
import type { ClassNote } from '@/mock/data'
import { buildNoteMarkdown, downloadText } from '@/utils/exportNote'
import {
  UPLOAD_EXTS,
  UPLOAD_KIND_META,
  UPLOAD_MAX_MB,
  detectUploadKind,
  uploadAcceptAttr,
  formatFileSize,
  type UploadKind,
} from '@/utils/uploadFormats'

const route = useRoute()
const router = useRouter()

// ---------- 上传材料（格式来自全站统一的 uploadFormats 注册表） ----------
type FileKind = UploadKind
interface InputFile {
  id: string
  name: string
  kind: FileKind
  size: string
  preview?: string
  file?: File // 原始文件（创建纪要时随表单提交给后端）
  theme?: string // 该材料的课堂主题（点选卡片后在下方表单填写）
  course?: string // 该材料的所属课程
}

const KIND_META = UPLOAD_KIND_META

const inputFiles = ref<InputFile[]>([])
const dragging = ref(false)
const fileInput = ref<HTMLInputElement>()
const MAX_FILES = 8 // 同时生成多份纪要会并发占用转写 / 生成线程，上限控制在服务器可承受范围

// ---------- 逐份设置：点选材料卡片，下方表单直接编辑该份材料的主题 / 课程（队列里的材料都参与生成） ----------
const selectedFile = ref<InputFile | null>(null)
function selectFile(f: InputFile) {
  selectedFile.value = f
  themeSuggestOpen.value = false
}
const selectedTheme = computed({
  get: () => selectedFile.value?.theme ?? '',
  set(v: string) {
    const f = selectedFile.value
    if (!f) return
    const t = v.trim()
    if (t) f.theme = t
    else delete f.theme
  },
})
const selectedCourse = computed({
  get: () => selectedFile.value?.course ?? '',
  set(v: string) {
    const f = selectedFile.value
    if (!f) return
    const c = v.trim()
    if (c) f.course = c
    else delete f.course
  },
})
function effTheme(f: InputFile) {
  return f.theme?.trim() || ''
}
function effCourse(f: InputFile) {
  return f.course?.trim() || ''
}

// ---------- 主题历史回填：已生成纪要的主题（连带课程）+ 本次已填主题，输入框聚焦 / 输入时下拉展示 ----------
const themeHistory = computed(() => {
  const seen = new Set<string>()
  const out: { theme: string; course: string }[] = []
  for (const n of classNotes.value) {
    const t = n.title.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push({ theme: t, course: n.course })
  }
  for (const f of inputFiles.value) {
    const t = f.theme?.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push({ theme: t, course: f.course?.trim() || '' })
  }
  return out
})
const themeSuggestOpen = ref(false)
const themeSuggest = computed(() => {
  const q = selectedTheme.value.trim().toLowerCase()
  const hit = q ? themeHistory.value.filter((x) => x.theme.toLowerCase().includes(q)) : themeHistory.value
  return hit.slice(0, 6)
})
function applyThemeSuggestion(x: { theme: string; course: string }) {
  const f = selectedFile.value
  if (!f) return
  f.theme = x.theme
  if (x.course) f.course = x.course
  themeSuggestOpen.value = false
  flashZoneTip(`已回填历史主题「${x.theme}」${x.course ? `，课程「${x.course}」` : ''}`)
}

// ---------- 所属课程：优先从课程表下拉选择，点“+”可新建（新课程同步到全局课程表） ----------
const courseOptions = computed(() => courseList.value.map((c) => ({ label: c, value: c })))
const addingCourse = ref(false)
const newCourse = ref('')
const courseError = ref('')
const newCourseInput = ref<HTMLInputElement>()

function startAddCourse() {
  addingCourse.value = true
  newCourse.value = ''
  courseError.value = ''
  nextTick(() => newCourseInput.value?.focus())
}
function cancelAddCourse() {
  addingCourse.value = false
  courseError.value = ''
}
function confirmAddCourse() {
  const name = newCourse.value.trim()
  if (!name) { courseError.value = '请输入课程名称'; return }
  if (!addCourse(name)) { courseError.value = '该课程已存在，可直接选择'; return }
  selectedCourse.value = name
  addingCourse.value = false
  courseError.value = ''
}

// ---------- 课程管理：删除（连带清除纪要 / 错题等全部记录）与重命名（全局同步） ----------
const deleteCourseTarget = ref('')
const deleteCourseNoteCount = computed(
  () => classNotes.value.filter((n) => n.course === deleteCourseTarget.value).length
)
const deleteCourseWrongCount = computed(
  () => wrongBook.value.filter((w) => w.question.course === deleteCourseTarget.value).length
)
function askDeleteCourse(name: string) {
  deleteCourseTarget.value = name
}
function confirmDeleteCourse() {
  const name = deleteCourseTarget.value
  if (name) void removeCourse(name).catch(() => flashZoneTip('删除课程失败，请确认后端已启动'))
  for (const f of inputFiles.value) {
    if (f.course === name) delete f.course
  }
  deleteCourseTarget.value = ''
}

const renameCourseTarget = ref('')
const renameValue = ref('')
const renameError = ref('')
const renameInput = ref<HTMLInputElement>()
function askRenameCourse(name: string) {
  renameCourseTarget.value = name
  renameValue.value = name
  renameError.value = ''
  nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}
function closeRenameCourse() {
  renameCourseTarget.value = ''
  renameError.value = ''
}
async function confirmRenameCourse() {
  const name = renameValue.value.trim()
  if (!name) { renameError.value = '请输入课程名称'; return }
  if (name !== renameCourseTarget.value && courseList.value.includes(name)) {
    renameError.value = '该课程名已存在'
    return
  }
  try {
    const ok = await renameCourse(renameCourseTarget.value, name)
    if (!ok) { renameError.value = '该课程名已存在'; return }
    for (const f of inputFiles.value) {
      if (f.course === renameCourseTarget.value) f.course = name
    }
    closeRenameCourse()
  } catch {
    renameError.value = '重命名失败，请确认后端已启动'
  }
}

// 上传格式提示（i 图标悬停展示）：直接取自统一格式注册表，与真实过滤规则保持一致
const FORMAT_HINTS: { label: string; exts: string }[] = (Object.keys(UPLOAD_EXTS) as UploadKind[]).map((k) => ({
  label: UPLOAD_KIND_META[k].label,
  exts: UPLOAD_EXTS[k].join(' / '),
}))

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

// 上传区瞬时提示（超过数量上限 / 类型不支持 / 重复添加），2.6 秒后自动消失
const zoneTip = ref('')
let zoneTipTimer: number | undefined
function flashZoneTip(msg: string) {
  zoneTip.value = msg
  if (zoneTipTimer) window.clearTimeout(zoneTipTimer)
  zoneTipTimer = window.setTimeout(() => (zoneTip.value = ''), 2600)
}

function handleFiles(list: FileList | null | undefined) {
  if (!list) return
  let accepted = 0
  let dupCount = 0
  for (const f of Array.from(list)) {
    // 最多同时上传 MAX_FILES 个材料（相同或不同文件合计），超出部分给出提示
    if (inputFiles.value.length >= MAX_FILES) {
      flashZoneTip(`最多同时上传 ${MAX_FILES} 个材料，超出部分未添加`)
      break
    }
    const kind = detectUploadKind(f.name)
    if (!kind) continue
    if (f.size > UPLOAD_MAX_MB[kind] * 1024 * 1024) {
      flashZoneTip(`「${f.name}」超过${UPLOAD_KIND_META[kind].label}上限 ${UPLOAD_MAX_MB[kind]}MB，未添加`)
      continue
    }
    if (inputFiles.value.some((x) => x.name === f.name && x.size === formatFileSize(f.size))) {
      dupCount++
      continue
    }
    const item: InputFile = {
      id: 'f' + Date.now() + Math.random().toString(36).slice(2, 5),
      name: f.name,
      kind,
      size: formatFileSize(f.size),
      file: f,
    }
    if (kind === 'image') item.preview = URL.createObjectURL(f)
    inputFiles.value.push(item)
    selectedFile.value = item // 新材料自动选中，下方表单随即等待填写这份材料的主题 / 课程
    accepted++
  }
  if (accepted === 0 && inputFiles.value.length < MAX_FILES) {
    flashZoneTip(dupCount > 0 ? '所选材料已在清单中' : '未识别到支持的文件类型')
  }
}

function removeFile(id: string) {
  const idx = inputFiles.value.findIndex((f) => f.id === id)
  if (idx >= 0) {
    const prev = inputFiles.value[idx]
    if (prev?.preview) URL.revokeObjectURL(prev.preview)
    inputFiles.value.splice(idx, 1)
    if (selectedFile.value?.id === id) {
      // 移除的正是选中项：就近顺延选中，保持下方表单始终有明确的编辑对象
      selectedFile.value = inputFiles.value[Math.min(idx, inputFiles.value.length - 1)] ?? null
      themeSuggestOpen.value = false
    }
  }
}

// 全部清空：确认弹窗后回收全部图片预览 objectURL，再清空清单
const showClearConfirm = ref(false)
function revokeAllPreviews() {
  for (const f of inputFiles.value) {
    if (f.preview) URL.revokeObjectURL(f.preview)
  }
}
function confirmClearFiles() {
  revokeAllPreviews()
  inputFiles.value = []
  selectedFile.value = null
  themeSuggestOpen.value = false
  showClearConfirm.value = false
}

const kindCount = computed(() => {
  const c: Record<FileKind, number> = { audio: 0, image: 0, video: 0, ppt: 0, doc: 0 }
  for (const f of inputFiles.value) c[f.kind]++
  return c
})
const canStart = computed(
  () =>
    inputFiles.value.length > 0 &&
    inputFiles.value.every((f) => effTheme(f) !== '' && effCourse(f) !== '') && // 每份材料都须填好主题 / 课程
    (genState.value === 'idle' || genState.value === 'done' || genState.value === 'stopped')
)
// 生成按钮旁的缺项提示
const startHint = computed(() => {
  if (!inputFiles.value.length) return '请先上传课堂材料'
  const missing = inputFiles.value.filter((f) => !effTheme(f) || !effCourse(f)).length
  if (missing) return `还有 ${missing} 个材料未设置课堂主题 / 所属课程，点击材料卡片逐一填写`
  return ''
})

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
  if (kinds.has('doc')) {
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
  { key: 'emphasized', title: '重点问题', icon: 'alert' },
] as const
type SectionKey = (typeof NOTE_SECTIONS)[number]['key']

const themeShown = ref('')
const headersShown = ref<string[]>([])
const itemsShown = reactive<Record<string, number>>({ points: 0, definitions: 0, emphasized: 0 })
const activeSection = ref<SectionKey | ''>('')

function shown(sec: string) {
  return itemsShown[sec] ?? 0
}
/** 板块内容条数：课堂里没有的内容（如没有重点问题）对应板块自动隐藏 */
function sectionCount(key: SectionKey): number {
  const n = note.value
  if (!n) return 0
  if (key === 'points') return n.points.length
  if (key === 'definitions') return n.definitions.length
  if (key === 'emphasized') return n.emphasized.length
  return 0
}
function sectionVisible(key: SectionKey) {
  if (key === 'theme') return themeShown.value !== ''
  // 回看历史纪要时同样只显示有内容的板块
  return headersShown.value.includes(key) && sectionCount(key) > 0
}

// ---------- 生成请求：动画进行的同时把材料提交给后端，返回完整纪要后进入流式渲染 ----------
const genError = ref('')

// ---------- 流程控制 ----------
const stepTimers: number[] = []
let typeTimer: number | null = null
let revealTimer: number | null = null
// 真实流水线状态轮询（后端 processing → done / failed）
let pollTimer: number | null = null
let pollCount = 0
// 多材料生成：主材料在右侧流式展示，其余勾选材料后台轮询收敛（「我的纪要」同步可见）
let extrasTimer: number | null = null
let extrasPollCount = 0
const extrasPending = ref(0)

/** 清主流程计时器（步骤动画 / 打字机 / 主材料轮询）；后台材料补拉不属于主流程，单独清理 */
function clearMainTimers() {
  for (const t of stepTimers) window.clearTimeout(t)
  stepTimers.length = 0
  if (typeTimer) { window.clearInterval(typeTimer); typeTimer = null }
  if (revealTimer) { window.clearInterval(revealTimer); revealTimer = null }
  if (zoneTipTimer) { window.clearTimeout(zoneTipTimer); zoneTipTimer = undefined }
  if (pollTimer) { window.clearInterval(pollTimer); pollTimer = null }
}

function clearAllTimers() {
  clearMainTimers()
  if (extrasTimer) { window.clearInterval(extrasTimer); extrasTimer = null }
  extrasPendingIds.clear()
  extrasPending.value = 0
}

/** 后台轮询生成中的材料：done / failed 都同步进 store，全部收敛后停止。
 * 可重复调用追加材料（主材料轮询超时转入后台时复用），已启动的定时器不受影响 */
const extrasPendingIds = new Set<string>()
function pollExtras(list: ApiNote[]) {
  for (const n of list) extrasPendingIds.add(String(n.id))
  extrasPending.value = extrasPendingIds.size
  if (extrasTimer) return // 已在轮询：追加跟踪即可，不重置计数
  extrasPollCount = 0
  extrasTimer = window.setInterval(() => {
    extrasPollCount++
    if (extrasPollCount > 450 || !extrasPendingIds.size) { // 约 30 分钟放弃补拉（「我的纪要」页还有 10s 兜底轮询）
      if (extrasTimer) { window.clearInterval(extrasTimer); extrasTimer = null }
      extrasPendingIds.clear()
      extrasPending.value = 0
      return
    }
    for (const id of [...extrasPendingIds]) {
      void notesApi.detail(id).then((n) => {
        updateNote(String(n.id), noteFromApi(n))
        if (n.status !== 'processing') extrasPendingIds.delete(String(n.id))
        extrasPending.value = extrasPendingIds.size
      }).catch(() => { /* 网络抖动下一轮再拉 */ })
    }
  }, 4000)
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
      tryBeginStreaming()
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

/** 前置步骤与后端生成请求都就绪后进入流式渲染（两者到达顺序不定，后到者触发） */
function tryBeginStreaming() {
  if (genState.value !== 'running' || !note.value) return
  startStreaming()
}

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
    addClassNote(n)
    savedId.value = n.id
    updateNoteRef(n.id)
  }
}

function updateNoteRef(id: string) {
  const saved = findNote(id)
  if (saved) note.value = saved
}

// ---------- 丢弃纪要（生成完成后可不保存到「我的纪要」） ----------
const showDiscardConfirm = ref(false)
const discarding = ref(false)
async function confirmDiscard() {
  const id = savedId.value
  if (!id || discarding.value) return
  discarding.value = true
  try {
    await notesApi.remove(id) // 先删后端（连同材料文件），失败则保留现场便于重试
  } catch {
    discarding.value = false
    showDiscardConfirm.value = false
    flashZoneTip('丢弃失败，请稍后重试')
    return
  }
  discarding.value = false
  showDiscardConfirm.value = false
  removeClassNote(id)
  resetAll()
  flashZoneTip('已丢弃该纪要，不会出现在「我的纪要」')
}

function startGenerate() {
  if (!canStart.value) return
  // 清除可能残留的回看 query：生成新纪要后从其他页面返回时应保持新现场，而非误切回看旧纪要
  if (route.query.note) router.replace({ path: '/studio' })
  clearAllTimers()
  themeShown.value = ''
  headersShown.value = []
  for (const k of Object.keys(itemsShown)) itemsShown[k] = 0
  plan = []
  savedId.value = null
  note.value = null
  genError.value = ''
  extrasPending.value = 0
  steps.value = buildSteps(inputFiles.value)
  genState.value = 'running'

  // 每份带文件的材料各建一份纪要，主题 / 课程用该材料逐份设置的值
  const targets = inputFiles.value.filter((f) => f.file)
  if (!targets.length) { // 兜底：canStart 已拦截勾选为空的情况，这里防无文件勾选项
    genState.value = 'stopped'
    genError.value = '请先上传要生成纪要的材料'
    return
  }
  const creates = targets.map((f) =>
    notesApi
      .create({ course: effCourse(f), title: effTheme(f), duration: '' }, f.file)
      .then((n) => ({ ok: true as const, n }))
      .catch((e: unknown) => ({ ok: false as const, e })),
  )
  Promise.all(creates).then((results) => {
    if (genState.value !== 'running') return // 用户已停止 / 重置
    const okList = results
      .filter((r): r is { ok: true; n: ApiNote } => r.ok)
      .map((r) => r.n)
    const failed = results.find((r): r is { ok: false; e: unknown } => !r.ok)
    if (!okList.length) {
      clearAllTimers()
      genState.value = 'stopped'
      genError.value = failed && failed.e instanceof ApiError ? failed.e.message : '生成请求失败，请确认后端已启动'
      return
    }
    if (failed) genError.value = `${results.length - okList.length} 个材料提交失败，其余正在正常生成`
    // 第一个成功的材料作为主材料在右侧流式展示，其余交给后台补拉（「我的纪要」同步收敛）
    const [head, ...rest] = okList
    if (!head) return // okList 非空才走到这里
    if (rest.length) {
      extrasPending.value = rest.length
      pollExtras(rest)
    }
    if (head.status === 'processing') {
      // 真实流水线进行中（转写 / 生成耗时数十秒）：轮询详情直至完成，
      // 步骤条停在「生成纪要」running，内容就绪后再进入流式渲染
      pollCount = 0
      pollTimer = window.setInterval(async () => {
        pollCount++
        if (pollCount > 450) { // 约 30 分钟仍未完成（后端常驻 worker 继续跑，不再算失败）
          clearMainTimers() // 主流程停止；材料转入后台补拉继续收敛（pollExtras 不受 clearMainTimers 影响）
          genState.value = 'stopped'
          genError.value = '生成时间较长，已转入后台继续生成，完成后会自动出现在「我的纪要」，无需重新处理'
          pollExtras([head]) // 主材料同样进入后台补拉：done / failed 都会同步进「我的纪要」
          return
        }
        try {
          const n = await notesApi.detail(String(head.id))
          if (n.status === 'done') {
            clearMainTimers()
            note.value = noteFromApi(n)
            tryBeginStreaming()
          } else if (n.status === 'failed') {
            clearMainTimers()
            genState.value = 'stopped'
            // 后端已写入面向用户的失败原因（如「未识别到语音内容」），有则优先展示
            genError.value = n.fail_reason
              ? `生成失败：${n.fail_reason}`
              : '生成失败：材料处理未成功（当前支持 音频 / 视频 / 图片 / PPT / PDF / Word / Excel / 文本 / 压缩包），可重新处理或更换材料'
          }
        } catch { /* 网络抖动等下一轮 */ }
      }, 4000)
      return
    }
    note.value = noteFromApi(head)
    tryBeginStreaming()
  })
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
  genError.value = ''
  extrasPending.value = 0
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
  // 只有录音引用可打开（模板中板书 / PPT 引用已是纯文本）；展示该时间点的转写原文
  if (!cite.startsWith('录音')) return
  if (activeSource.value?.cite === cite) { activeSource.value = null; return }
  const n = note.value
  // 转写行带 [mm:ss] 时定位到对应原文；找不到或无转写时给出兜底说明
  let snippet = ''
  if (n?.transcript) {
    const ts = cite.replace('录音 ', '')
    const line = n.transcript.split('\n').find((l) => l.startsWith(`[${ts}]`))
    if (line) snippet = `「${n.title}」录音 ${ts} 处原文：${line.replace(/^\[\d{1,2}:\d{2}\]\s*/, '')}`
  }
  if (!snippet) snippet = `「${n?.title ?? '本节课'}」录音 ${cite.replace('录音 ', '')} 处原文`
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
/** 按 id 定位回看目标并填充回看态；纪要不存在时保持当前状态不动 */
async function showNoteFromQuery(id: string | null) {
  await ensureNotesLoaded() // 纪要列表来自后端，异步加载完成后才能定位回看目标
  const exists = findNote(id)
  if (!exists) return
  note.value = exists
  savedId.value = exists.id
  if (!courseList.value.includes(exists.course)) addCourse(exists.course)
  genState.value = 'done'
  themeShown.value = exists.theme
  headersShown.value = ['points', 'definitions', 'emphasized']
  for (const k of Object.keys(itemsShown)) itemsShown[k] = 999
  const fake: InputFile[] = []
  if (exists.duration.startsWith('录音')) fake.push({ id: 'f-a', name: '课堂录音.m4a', kind: 'audio', size: '38.2 MB' })
  if (exists.keyframes > 0) fake.push({ id: 'f-i', name: '板书照片 ×' + Math.max(1, Math.round(exists.keyframes / 2)), kind: 'image', size: '12.4 MB' })
  steps.value = buildSteps(fake.length ? fake : [{ id: 'f-i', name: '板书照片', kind: 'image', size: '' }])
  steps.value = steps.value.map((s) => ({ ...s, status: 'done' as StepStatus, dur: '2.0s' }))
}

onMounted(() => {
  const id = route.query.note
  void showNoteFromQuery(typeof id === 'string' ? id : null)
})

// keep-alive 从其他页面返回：带 ?note= 回看参数时切换到目标纪要；
// 无参数（侧边栏直接点回本页）原样保留离开前的进度，生成进行中也不打断
onActivated(() => {
  if (genState.value === 'running' || genState.value === 'streaming') return
  const id = route.query.note
  if (typeof id !== 'string') return
  void showNoteFromQuery(id)
})

onBeforeUnmount(() => {
  clearAllTimers()
  revokeAllPreviews()
})
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
      <!-- 左：材料与设置（上传区 + 材料清单 + 课堂信息 + 生成操作，合并为一张卡） -->
      <div class="left-col">
        <div class="card compose-card">
          <div class="cc-head">
            <div class="cc-title">
              <div class="h4">上传课堂材料</div>
              <span class="info-tip" tabindex="0" aria-label="查看支持上传解析的文件格式">
                <AppIcon name="info" :size="13" />
                <span class="info-pop" role="tooltip">
                  <b>支持上传解析的全部格式</b>
                  <span v-for="f in FORMAT_HINTS" :key="f.label" class="ip-row">
                    <i>{{ f.label }}</i>
                    <span>{{ f.exts }}</span>
                  </span>
                </span>
              </span>
            </div>
            <span class="text-caption" :class="{ 'count-full': inputFiles.length >= MAX_FILES }">{{ inputFiles.length }} / {{ MAX_FILES }}</span>
          </div>

          <div
            class="upload-zone"
            :class="{ dragging, disabled: genState === 'running' || genState === 'streaming', full: inputFiles.length >= MAX_FILES }"
            role="button"
            tabindex="0"
            aria-label="上传课堂材料：点击选择或拖拽音频、图片、视频、PPT 或讲义文件"
            @click="pickFiles"
            @keydown.enter.prevent="pickFiles"
            @dragover.prevent="dragging = true"
            @dragleave="dragging = false"
            @drop.prevent="onDrop"
          >
            <div class="upload-icon"><AppIcon name="upload" :size="24" /></div>
            <div v-if="inputFiles.length < MAX_FILES" class="upload-text">拖拽材料到此处，或 <span class="link-text">点击上传</span>（可多选 / 一次拖入多个）</div>
            <div v-else class="upload-text">已达 {{ MAX_FILES }} 个材料上限，可先移除部分再上传</div>
            <!-- 多文件上传提示徽章：呼吸光晕突出「可批量」，空态与未满时展示 -->
            <div v-if="inputFiles.length < MAX_FILES" class="multi-badge">
              <AppIcon name="layers" :size="13" /> 支持一次添加多个材料，批量生成纪要（最多 {{ MAX_FILES }} 个）
            </div>
            <div class="kind-hints">
              <span class="kind-hint"><AppIcon name="headphones" :size="13" /> 音频 mp3 / wav / m4a 等</span>
              <span class="kind-hint"><AppIcon name="image" :size="13" /> 图片 jpg / png / webp 等</span>
              <span class="kind-hint"><AppIcon name="film" :size="13" /> 视频 mp4 / mov / mkv 等</span>
              <span class="kind-hint"><AppIcon name="layers" :size="13" /> PPT ppt / pptx</span>
              <span class="kind-hint"><AppIcon name="file" :size="13" /> 文档 pdf / word / excel 等</span>
            </div>
            <input ref="fileInput" type="file" multiple hidden :accept="uploadAcceptAttr" @change="onFileChange" />
          </div>
          <p v-if="zoneTip" class="zone-tip"><AppIcon name="alert" :size="13" /> {{ zoneTip }}</p>

          <!-- 材料清单：横向滚动卡片条，最多 8 个；点击卡片选中，在下方表单逐份填写主题 / 课程 -->
          <div v-if="inputFiles.length" class="queue">
            <div class="fl-head">
              <span class="text-caption">已选 {{ inputFiles.length }} 个材料</span>
              <div class="fl-head-actions">
                <button
                  class="fl-clear"
                  type="button"
                  :disabled="genState === 'running' || genState === 'streaming'"
                  @click="showClearConfirm = true"
                >
                  <AppIcon name="trash" :size="13" /> 全部清空
                </button>
              </div>
            </div>
            <div class="file-list">
              <!-- 点卡片选中该材料，在下方表单填写它的主题 / 课程；移除按钮不冒泡 -->
              <div
                v-for="f in inputFiles"
                :key="f.id"
                class="file-item"
                :class="{ sel: selectedFile?.id === f.id }"
                role="button"
                tabindex="0"
                :aria-label="`选择并设置材料 ${f.name} 的课堂主题与所属课程`"
                @click="selectFile(f)"
                @keydown.enter.prevent="selectFile(f)"
              >
                <div class="fi-top">
                  <img v-if="f.preview" :src="f.preview" class="file-thumb" alt="图片预览" />
                  <span v-else class="file-badge" :class="KIND_META[f.kind].tint">
                    <AppIcon :name="KIND_META[f.kind].icon" :size="15" />
                  </span>
                  <button class="icon-btn" aria-label="移除该材料" @click.stop="removeFile(f.id)"><AppIcon name="x" :size="14" /></button>
                </div>
                <div class="file-name ellipsis" :title="f.name">{{ f.name }}</div>
                <div class="file-meta">{{ KIND_META[f.kind].label }} · {{ f.size }}</div>
                <div v-if="f.theme || f.course" class="file-assign ellipsis" :title="[f.theme, f.course].filter(Boolean).join(' · ')">
                  {{ [f.theme, f.course].filter(Boolean).join(' · ') }}
                </div>
                <div v-else class="file-assign assign-todo">待设置主题 / 课程</div>
              </div>
            </div>
          </div>

          <!-- 单份材料信息：点选上方卡片后在此填写；主题输入框下拉展示之前填写过的记录（点选回填主题与课程） -->
          <div v-if="selectedFile" class="fields assign-now">
            <p class="assign-target">
              正在设置：<span class="ellipsis" :title="selectedFile.name">{{ selectedFile.name }}</span>
            </p>
            <div class="field theme-field">
              <label class="field-label" for="class-title">课堂主题</label>
              <input
                id="class-title"
                v-model="selectedTheme"
                class="input"
                placeholder="例如：第12讲 泰勒展开与级数"
                maxlength="60"
                autocomplete="off"
                @focus="themeSuggestOpen = themeHistory.length > 0"
                @input="themeSuggestOpen = true"
                @blur="themeSuggestOpen = false"
                @keydown.esc.prevent="themeSuggestOpen = false"
              />
              <div v-if="themeSuggestOpen && themeSuggest.length" class="theme-suggest">
                <div class="theme-suggest-head">之前填写过的主题（点选回填）</div>
                <button
                  v-for="x in themeSuggest"
                  :key="x.theme"
                  type="button"
                  class="theme-suggest-item"
                  @mousedown.prevent="applyThemeSuggestion(x)"
                >
                  <span class="ellipsis ts-theme">{{ x.theme }}</span>
                  <span v-if="x.course" class="ts-course">{{ x.course }}</span>
                </button>
              </div>
            </div>
            <div class="field">
              <span class="field-label">所属课程</span>
              <div v-if="!addingCourse" class="course-row">
                <AppSelect
                  v-model="selectedCourse"
                  :options="courseOptions"
                  placeholder="请选择所属课程"
                  aria-label="选择这份材料的所属课程"
                  deletable
                  renamable
                  @delete="askDeleteCourse"
                  @rename="askRenameCourse"
                />
                <button class="add-course-btn" type="button" title="新建课程" aria-label="新建所属课程" @click="startAddCourse">
                  <AppIcon name="plus" :size="16" />
                </button>
              </div>
              <div v-else class="course-row">
                <input
                  ref="newCourseInput"
                  v-model="newCourse"
                  class="input"
                  placeholder="输入新课程名称，如：线性代数"
                  maxlength="20"
                  @keydown.enter.prevent="confirmAddCourse"
                  @keydown.esc.prevent="cancelAddCourse"
                />
                <button class="add-course-btn ok" type="button" title="确认新增" aria-label="确认新增课程" @click="confirmAddCourse">
                  <AppIcon name="check" :size="16" />
                </button>
                <button class="add-course-btn" type="button" title="取消" aria-label="取消新增课程" @click="cancelAddCourse">
                  <AppIcon name="x" :size="16" />
                </button>
              </div>
              <p v-if="courseError" class="course-err"><AppIcon name="alert" :size="12" /> {{ courseError }}</p>
            </div>
          </div>

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
              <span v-if="startHint" class="gen-hint">{{ startHint }}</span>
            </template>
          </div>
        </div>
      </div>

      <!-- 右：Agent 处理进度（仅生成过程中显示）+ 结构化纪要 -->
      <div class="right-col">
        <div v-if="steps.length && genState !== 'idle' && genState !== 'done'" class="card steps-card">
          <div class="steps-head">
            <div class="h4">Agent 处理进度</div>
            <span class="text-caption">{{ doneSteps }} / {{ steps.length }} 步 · {{ progress }}%</span>
          </div>
          <ol class="steps-list">
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
          <p v-if="genState === 'stopped'" class="stopped-tip">已中断生成，已完成的步骤会保留，可回到左侧重新开始。</p>
        </div>
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
              <div v-if="genError" class="gen-error" role="alert">{{ genError }}</div>
            </div>
            <div v-if="genState === 'done' && note" class="flex gap-xs">
              <button class="btn btn-ghost btn-sm" :disabled="discarding" @click="showDiscardConfirm = true">
                <AppIcon name="trash" :size="14" /> 丢弃
              </button>
              <button class="btn btn-secondary btn-sm" @click="exportNote"><AppIcon name="download" :size="14" /> 导出 Markdown</button>
              <button class="btn btn-primary btn-sm" @click="goQA"><AppIcon name="chat" :size="14" /> 智能问答</button>
            </div>
          </div>

          <!-- 空态 -->
          <div v-if="genState === 'idle' && !note" class="note-empty">
            <div class="note-empty-icon"><AppIcon name="spark" :size="26" /></div>
            <div class="h4">纪要将在这里生成</div>
            <p class="text-sm">按「课程主题 / 核心知识点 / 重要定义与公式 / 重点问题」自动生成<br />课堂中没有的内容会自动省略</p>
          </div>

          <!-- 纪要内容 -->
          <div v-else class="note-body">
            <section
              v-for="sec in NOTE_SECTIONS"
              :key="sec.key"
              v-show="sectionVisible(sec.key)"
              class="n-sec"
            >
              <!-- 课程主题作为导语直接展示，不显示板块头 -->
              <div v-if="sec.key !== 'theme'" class="n-head">
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
                  <!-- 录音引用可点击定位转写原文；板书 / PPT 引用仅作来源标注（弹窗无附加信息，已去掉） -->
                  <button v-if="p.cite.startsWith('录音')" class="cite-chip" :aria-label="'查看录音原文：' + p.cite" @click="showSource(p.cite)">
                    <AppIcon name="headphones" :size="12" /> {{ p.cite }}
                  </button>
                  <span v-else-if="p.cite" class="cite-chip static"><AppIcon :name="citeIcon(p.cite)" :size="12" /> {{ p.cite }}</span>
                </li>
              </ul>

              <ul v-else-if="sec.key === 'definitions'" class="n-list">
                <li v-for="(d, i) in note?.definitions || []" :key="i" v-show="i < shown('definitions')" class="n-item def" :class="{ fresh: genState === 'streaming' }">
                  <div class="def-term">{{ d.term }}</div>
                  <div class="def-detail">
                    {{ d.detail }}
                    <button v-if="d.cite && d.cite.startsWith('录音')" class="cite-chip" :aria-label="'查看录音原文：' + d.cite" @click="showSource(d.cite)">
                      <AppIcon name="headphones" :size="12" /> {{ d.cite }}
                    </button>
                    <span v-else-if="d.cite" class="cite-chip static"><AppIcon :name="citeIcon(d.cite)" :size="12" /> {{ d.cite }}</span>
                  </div>
                </li>
              </ul>

              <ul v-else-if="sec.key === 'emphasized'" class="n-list">
                <li v-for="(e, i) in note?.emphasized || []" :key="i" v-show="i < shown('emphasized')" class="n-item emph" :class="{ fresh: genState === 'streaming' }">
                  <AppIcon name="alert" :size="14" class="emph-ico" />
                  <span class="flex-1">{{ e }}</span>
                </li>
              </ul>
            </section>
          </div>

          <p v-if="genState === 'done' && note" class="note-foot">
            已存入「我的纪要」，知识片段 {{ note.chunkCount }} 条 · 关键帧 {{ note.keyframes }} 张
            <span v-if="extrasPending > 0"> · 其余 {{ extrasPending }} 个材料仍在后台生成，完成后可在「我的纪要」查看</span>
          </p>
        </div>

        <!-- 引用溯源卡片：仅录音引用可打开（定位转写原文），板书 / PPT 引用为纯文本标注 -->
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

    <!-- 清空材料确认弹窗 -->
    <div v-if="showClearConfirm" class="modal-mask" @click.self="showClearConfirm = false">
      <div class="modal modal-sm">
        <div class="modal-title">清空材料清单</div>
        <p class="modal-sub">确定清空全部 {{ inputFiles.length }} 个已选材料吗？清空后需要重新上传。</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="showClearConfirm = false">取消</button>
          <button class="btn btn-danger" @click="confirmClearFiles">确认清空</button>
        </div>
      </div>
    </div>

    <!-- 丢弃纪要确认弹窗：不保存到「我的纪要」并删除后端记录 -->
    <div v-if="showDiscardConfirm" class="modal-mask" @click.self="showDiscardConfirm = false">
      <div class="modal modal-sm">
        <div class="modal-title">不保存这份纪要？</div>
        <p class="modal-sub">丢弃后会删除这份纪要及其材料文件，它不会出现在「我的纪要」中，且<strong>不可恢复</strong>。</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="showDiscardConfirm = false">再想想</button>
          <button class="btn btn-danger" :disabled="discarding" @click="confirmDiscard">
            <span v-if="discarding" class="spinner" style="width:13px;height:13px;border-width:2px"></span>
            确认丢弃
          </button>
        </div>
      </div>
    </div>

    <!-- 删除课程警示弹窗：删除将连带清除该课程全部相关记录 -->
    <div v-if="deleteCourseTarget" class="modal-mask" @click.self="deleteCourseTarget = ''">
      <div class="modal modal-sm">
        <div class="modal-title">删除课程「{{ deleteCourseTarget }}」</div>
        <p class="modal-sub">
          <template v-if="deleteCourseNoteCount || deleteCourseWrongCount">
            该课程名下有 <b>{{ deleteCourseNoteCount }}</b> 个课堂纪要、<b>{{ deleteCourseWrongCount }}</b> 条错题记录。
          </template>
          <template v-else>该课程名下暂无纪要与练习记录。</template>
          确认删除后，课程将移出课程表，其名下的<b>全部课堂纪要、上传材料记录、练习与错题数据</b>都将被永久清除，且无法恢复，请谨慎操作。
        </p>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="deleteCourseTarget = ''">取消</button>
          <button class="btn btn-danger" @click="confirmDeleteCourse">确认删除</button>
        </div>
      </div>
    </div>

    <!-- 重命名课程弹窗：保存后课程表 / 纪要 / 错题等全局同步新名称 -->
    <div v-if="renameCourseTarget" class="modal-mask" @click.self="closeRenameCourse">
      <div class="modal modal-sm">
        <div class="modal-title">重命名课程「{{ renameCourseTarget }}」</div>
        <p class="modal-sub">修改后，该课程名下的纪要与相关页面都将同步显示新名称。</p>
        <div class="rename-field">
          <input
            ref="renameInput"
            v-model="renameValue"
            class="input"
            maxlength="20"
            placeholder="输入新的课程名称"
            @keydown.enter.prevent="confirmRenameCourse"
          />
          <p v-if="renameError" class="course-err"><AppIcon name="alert" :size="12" /> {{ renameError }}</p>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="closeRenameCourse">取消</button>
          <button class="btn btn-primary" @click="confirmRenameCourse">保存</button>
        </div>
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

/* 上下两个全宽板块：上传课堂材料在上，课堂纪要在下 */
.studio-grid { display: flex; flex-direction: column; gap: 16px; }
.left-col { display: flex; flex-direction: column; }
.right-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

/* 左列合并卡：上传区 + 材料清单 + 课堂信息 + 生成操作 */
.compose-card { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }
.cc-head { display: flex; align-items: center; justify-content: space-between; }
.cc-title { display: flex; align-items: center; gap: 5px; }
.count-full { color: var(--error); font-weight: 600; }

/* 标题旁（i）：悬停 / 聚焦展示支持的全部上传格式 */
.info-tip { position: relative; display: flex; color: var(--stone); cursor: help; outline: none; transition: color 0.15s ease; }
.info-tip:hover, .info-tip:focus-visible { color: var(--primary); }
.info-pop {
  position: absolute; top: calc(100% + 7px); left: -8px; z-index: 60;
  width: 320px; padding: 10px 13px;
  display: flex; flex-direction: column; gap: 6px;
  background: var(--canvas); border: 1px solid var(--hairline);
  border-radius: var(--radius-md); box-shadow: var(--shadow-modal);
  opacity: 0; visibility: hidden; transform: translateY(-4px);
  transition: opacity 0.15s ease, transform 0.15s ease, visibility 0.15s;
  pointer-events: none;
}
.info-tip:hover .info-pop, .info-tip:focus-within .info-pop { opacity: 1; visibility: visible; transform: none; }
.info-pop b { font-size: 12px; color: var(--ink); }
.ip-row { display: flex; gap: 8px; font-size: 11.5px; line-height: 1.55; color: var(--slate); }
.ip-row i { flex-shrink: 0; width: 30px; font-style: normal; font-weight: 600; color: var(--brand-purple-800); }
.ip-row span { flex: 1; min-width: 0; word-break: break-all; }
.fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

/* 上传区（卡内嵌套的虚线投放区，全宽加大） */
.upload-zone {
  display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center;
  border: 2px dashed var(--hairline-strong); border-radius: var(--radius-lg);
  padding: 62px 28px; background: var(--surface-soft); cursor: pointer; transition: all 0.15s ease;
}
.upload-zone:hover, .upload-zone.dragging { border-color: var(--primary); background: var(--tint-lavender); }
.upload-zone:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.upload-zone.disabled, .upload-zone.full { pointer-events: none; opacity: 0.55; }
.upload-icon {
  width: 62px; height: 62px; border-radius: var(--radius-lg);
  background: var(--tint-sky); color: var(--link-blue);
  display: flex; align-items: center; justify-content: center;
}
.upload-text { font-size: 15px; font-weight: 600; color: var(--ink); }
.zone-tip { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--error); margin: -6px 0 0; }
.link-text { color: var(--link-blue); font-weight: 500; }
.kind-hints { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 2px; }
.kind-hint {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; color: var(--slate); background: var(--canvas);
  border: 1px solid var(--hairline); border-radius: var(--radius-full); padding: 4px 10px;
}
/* 多文件上传徽章：紫色胶囊 + 呼吸光晕，比格式提示更醒目（reduced-motion 下自动静止） */
.multi-badge {
  display: inline-flex; align-items: center; gap: 5px;
  background: var(--tint-lavender); color: var(--brand-purple-800);
  font-size: 12.5px; font-weight: 600;
  padding: 5px 12px; border-radius: var(--radius-full);
  animation: badge-breathe 2.4s ease-in-out infinite;
}
@keyframes badge-breathe {
  0%, 100% { box-shadow: 0 0 0 0 rgba(123, 63, 242, 0.16); }
  50% { box-shadow: 0 0 0 7px rgba(123, 63, 242, 0); }
}

/* 材料清单：横向滚动卡片条（最多 12 个，拖动滚动条查看） */
.queue { display: flex; flex-direction: column; gap: 4px; }
.fl-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fl-head-actions { display: flex; align-items: center; gap: 4px; }
.fl-clear {
  display: inline-flex; align-items: center; gap: 4px;
  font-family: inherit; font-size: 12px; font-weight: 500; color: var(--stone);
  border: none; background: transparent; cursor: pointer;
  padding: 4px 8px; border-radius: var(--radius-sm); transition: all 0.15s ease;
}
.fl-clear:hover:not(:disabled) { background: #fdecec; color: var(--error); }
.fl-clear:disabled { opacity: 0.45; cursor: not-allowed; }
.file-list {
  display: flex; gap: 8px; overflow-x: auto; padding-bottom: 8px;
  scrollbar-width: thin; scrollbar-color: var(--hairline-strong) transparent;
}
.file-list::-webkit-scrollbar { height: 8px; }
.file-list::-webkit-scrollbar-thumb { background: var(--hairline-strong); border-radius: 4px; }
.file-list::-webkit-scrollbar-track { background: transparent; }
.file-item {
  width: 192px; flex-shrink: 0;
  display: flex; flex-direction: column; gap: 7px; padding: 10px 12px;
  background: var(--canvas); border: 1px solid var(--hairline); border-radius: var(--radius-md);
  cursor: pointer; transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.file-item:hover { border-color: var(--primary); box-shadow: 0 1px 6px rgba(124, 58, 237, 0.10); }
.file-item:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.fi-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.file-thumb { width: 32px; height: 32px; object-fit: cover; border-radius: var(--radius-sm); flex-shrink: 0; }
.file-badge {
  width: 32px; height: 32px; border-radius: var(--radius-sm); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.file-name { font-size: 12.5px; font-weight: 500; }
.file-meta { font-size: 11.5px; color: var(--stone); }
/* 选中待编辑的卡片：常驻高亮描边（与 hover 同色，外加投影环不挤动布局） */
.file-item.sel { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary), 0 1px 6px rgba(124, 58, 237, 0.12); }
/* 已填主题 / 课程的卡片显示设置结果；未填的给待设置提示 */
.file-assign {
  font-size: 11px; color: var(--brand-purple-800); background: var(--tint-lavender);
  border-radius: var(--radius-sm); padding: 2.5px 7px;
}
.file-assign.assign-todo {
  color: var(--stone); background: var(--surface);
  border: 1px dashed var(--hairline-strong); padding: 1.5px 6px;
}
.icon-btn {
  border: none; background: transparent; color: var(--stone);
  padding: 6px; border-radius: var(--radius-sm); display: flex; cursor: pointer;
}
.icon-btn:hover { background: var(--surface); color: var(--error); }

.field { display: flex; flex-direction: column; gap: 6px; }

/* 所属课程：课程表下拉 + 新建课程（“+”按钮，或新建态的确认/取消） */
.course-row { display: flex; align-items: center; gap: 8px; }
.course-row > .app-select { flex: 1; min-width: 0; }
.course-row > .input { flex: 1; min-width: 0; }
.add-course-btn {
  width: 44px; height: 44px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-family: inherit; color: var(--slate);
  background: var(--canvas); border: 1px solid var(--hairline-strong); border-radius: var(--radius-md);
  cursor: pointer; transition: all 0.15s ease;
}
.add-course-btn:hover { border-color: var(--primary); color: var(--primary); background: var(--tint-lavender); }
.add-course-btn.ok { color: var(--brand-green); }
.add-course-btn.ok:hover { border-color: var(--brand-green); color: var(--brand-green); background: var(--tint-mint); }
.course-err { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--error); }

/* 清空材料确认弹窗（遮罩/卡片/按钮组用全局样式） */
.modal-sm { max-width: 420px; }
.modal-sub { color: var(--slate); line-height: 1.7; }
.modal-sub b { color: var(--error); font-weight: 600; }
.rename-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; }

/* Agent 处理进度（右侧，仅生成过程中显示） */
.steps-card { padding: 16px 18px; }
.steps-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
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

.gen-actions { display: flex; align-items: center; gap: 10px; padding-top: 14px; border-top: 1px solid var(--hairline-soft); flex-wrap: wrap; }
.gen-hint { font-size: 12px; color: var(--stone); }

/* 逐份设置表单：正在设置的材料名 + 主题历史回填下拉 */
.assign-now { margin-top: 12px; position: relative; }
.assign-target {
  grid-column: 1 / -1; display: flex; align-items: center; gap: 5px;
  margin: 0; min-width: 0; font-size: 12.5px; color: var(--slate);
}
.assign-target span { min-width: 0; font-weight: 600; color: var(--ink); }
.theme-field { position: relative; }
.theme-suggest {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 50;
  padding: 5px; background: var(--canvas); border: 1px solid var(--hairline);
  border-radius: var(--radius-md); box-shadow: var(--shadow-modal);
}
.theme-suggest-head { padding: 5px 10px 3px; font-size: 11.5px; color: var(--stone); }
.theme-suggest-item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; padding: 8px 10px; font-family: inherit; font-size: 13px; color: var(--ink);
  background: transparent; border: none; border-radius: var(--radius-sm);
  cursor: pointer; text-align: left; transition: background 0.12s ease;
}
.theme-suggest-item:hover { background: var(--surface-soft); }
.ts-theme { flex: 1; min-width: 0; }
.ts-course {
  flex-shrink: 0; font-size: 11px; color: var(--brand-purple-800);
  background: var(--tint-lavender); border-radius: var(--radius-sm); padding: 1px 6px;
}
.stopped-tip { margin-top: 10px; font-size: 12.5px; color: var(--error); }
.btn-del { background: var(--error); color: #fff; }
.btn-del:hover { background: #b42318; }

/* 纪要面板 */
.note-panel { padding: 20px 24px; }
.note-head { display: flex; align-items: flex-start; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid var(--hairline-soft); }
.note-title { font-size: 17px; font-weight: 700; letter-spacing: -0.2px; }
.note-meta { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
/* 生成请求失败提示（后端不可达 / 校验失败等） */
.gen-error {
  margin-top: 8px; font-size: 12.5px; font-weight: 500; line-height: 1.5;
  background: var(--tint-rose); color: var(--error);
  border-radius: var(--radius-md); padding: 8px 12px;
}

.note-empty { text-align: center; padding: 56px 20px; color: var(--stone); }
.note-empty-icon {
  width: 64px; height: 64px; margin: 0 auto 14px; border-radius: var(--radius-lg);
  background: var(--tint-lavender); color: var(--primary);
  display: flex; align-items: center; justify-content: center;
}
.note-empty p { margin-top: 8px; line-height: 1.7; }

.note-body { padding-top: 6px; }
.n-sec { padding: 13px 0 4px; border-bottom: 1px solid var(--hairline-soft); }
.n-sec:last-child { border-bottom: none; }
/* 课程主题无板块头，作为标题下的导语段落 */
.n-head { display: flex; align-items: center; gap: 7px; margin-bottom: 9px; }
.n-ico { display: flex; color: var(--primary); flex-shrink: 0; }
.n-title { font-size: 13px; font-weight: 700; }
.n-typing { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--link-blue); }

.n-theme { font-size: 13.5px; line-height: 1.8; color: var(--ink); }
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

.emph { background: var(--tint-yellow-bold); border-radius: var(--radius-sm); padding: 7px 11px; font-size: 13px; }
.emph-ico { color: var(--brand-brown); margin-top: 3px; flex-shrink: 0; }

/* 引用角标：录音引用为按钮（定位转写原文），板书 / PPT 为纯文本标注 */
.cite-chip {
  display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; margin-left: 6px;
  font-size: 11.5px; font-weight: 600; font-family: inherit;
  color: var(--link-blue); background: var(--tint-sky);
  border: none; border-radius: var(--radius-full); padding: 2.5px 9px;
}
button.cite-chip { cursor: pointer; transition: all 0.15s ease; }
button.cite-chip:hover { background: var(--primary); color: #fff; }
.cite-chip.static { color: var(--steel); background: var(--surface); }

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

@media (max-width: 720px) {
  .page { padding: 20px 16px 40px; }
  .fields { grid-template-columns: 1fr; }
  .upload-zone { padding: 36px 16px; }
  .note-head { flex-direction: column; }
}
</style>
