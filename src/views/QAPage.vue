<script setup lang="ts">
/**
 * 智能问答：基于课堂纪要知识库的多轮问答（核心前台）
 * - 左侧：对话列表（新增 / 置顶 / 重命名 / 删除，可关联课堂）+ 搜索 + 常显滚动条（折叠状态持久化）
 * - 右侧：聊天窗口（流式回答 / 录音时间戳与图片来源引用 / 语音输入 / 附件上传）
 * - 提问记录导航：千问式右侧悬浮面板，悬停展开、点击定位，固定在滚动条左侧不遮挡
 * 回答为前端演示，接入真实模型后仅需替换 runStages / startStream 中的回调；
 * 流式任务按会话登记（askTasks）：切换对话不打断后台回答，答完落在原会话
 */
import { ref, reactive, nextTick, computed, watch, onMounted, onBeforeUnmount, onDeactivated, onActivated } from 'vue'

// 组件名固定：AppLayout 的 keep-alive include 依赖它，路由切走再回来保持对话现场
defineOptions({ name: 'QAPage' })
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import SparkMark from '@/components/SparkMark.vue'
import { classNotes, ensureNotesLoaded } from '@/store/study'
import { currentUser, isGuest } from '@/store/auth'
import { qaApi, streamAsk, type ApiQaRecord } from '@/api'
import { BASE, getToken } from '@/api/http'
import SafetyModal, { type SafetyNotice } from '@/components/SafetyModal.vue'
import { demoReply, type ChatMessage, type ChatAttachment, type Citation } from '@/mock/data'
import { UPLOAD_ACCEPT, UPLOAD_KIND_META, UPLOAD_MAX_MB, detectUploadKind, formatFileSize, type UploadKind } from '@/utils/uploadFormats'

const route = useRoute()
const router = useRouter()

// ---------- 对话列表（可关联课堂，也可自由追问） ----------
interface QaSession {
  id: string
  title: string
  noteId?: string // 关联的课堂纪要
  pinned?: boolean
  pinnedAt?: number
}

const qaSessions = ref<QaSession[]>([])
const sessionSearch = ref('')
const activeSessionId = ref('')
// 会话面板可横向收起 / 展开；折叠状态持久化，跳转其他页面再回来保持上次的开合
const SIDEBAR_KEY = 'zy_qa_sidebar_open'
const sessionsOpen = ref(localStorage.getItem(SIDEBAR_KEY) !== '0')
watch(sessionsOpen, (v) => localStorage.setItem(SIDEBAR_KEY, v ? '1' : '0'))

// ---------- 自由对话会话持久化（按账号隔离） ----------
// 会话标识 'qa'+时间戳 同时作为 QaRecord.session_ref 存后端：刷新后列表从 localStorage 恢复，
// 消息进会话时按 session 从 /api/qa/ 拉回（loadHistory）。课内会话随纪要自动重建，不落盘。
const uidKey = () => `${currentUser.value?.id ?? 'guest'}`

function loadFreeSessions(): QaSession[] {
  try {
    const arr = JSON.parse(localStorage.getItem(`zy_qa_sessions:${uidKey()}`) || '[]') as QaSession[]
    return Array.isArray(arr) ? arr.filter((s) => s && typeof s.id === 'string' && typeof s.title === 'string') : []
  } catch {
    return []
  }
}

function persistFreeSessions() {
  localStorage.setItem(`zy_qa_sessions:${uidKey()}`, JSON.stringify(qaSessions.value.filter((s) => !s.noteId)))
}

watch(qaSessions, persistFreeSessions, { deep: true })

watch(activeSessionId, (v) => {
  localStorage.setItem(`zy_qa_active:${uidKey()}`, v || '')
})

// 纪要被删除 → 对应课内对话条目同步移除（重新生成等状态变化不动条目，问答记录仍在）
watch(
  () => classNotes.value.map((n) => n.id).join('|'),
  () => {
    qaSessions.value = qaSessions.value.filter((s) => !s.noteId || classNotes.value.some((n) => n.id === s.noteId))
  }
)

const doneNotes = computed(() => classNotes.value.filter((n) => n.status === 'done'))
const totalChunks = computed(() => doneNotes.value.reduce((s, n) => s + n.chunkCount, 0))

const dayStr = (offset: number) => {
  const d = new Date(Date.now() - offset * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const todayStr = dayStr(0)
const yestStr = dayStr(1)

function groupOf(s: QaSession): '今天' | '昨天' | '更早' {
  if (!s.noteId) return '今天'
  const note = classNotes.value.find((n) => n.id === s.noteId)
  const day = note ? note.date.slice(0, 10) : todayStr
  if (day === todayStr) return '今天'
  if (day === yestStr) return '昨天'
  return '更早'
}

// 分组：置顶组在最上（后置顶的排在先置顶的前面），其余按 今天 / 昨天 / 更早。
// 课内对话条目标题实时派生（优先纪要标题）：条目可能在纪要列表加载完成前创建，
// 创建时冻结的兜底标题在这里自愈（reactive 依赖 classNotes，加载完成后重算）
const sessionGroups = computed(() => {
  const q = sessionSearch.value.trim()
  const match = (s: QaSession) => (s.noteId ? noteSessionTitle(s.noteId, s.title) : s.title).includes(q)
  const groups: { label: string; items: QaSession[] }[] = []
  const pinned = qaSessions.value
    .filter((s) => s.pinned && match(s))
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
  if (pinned.length) groups.push({ label: '置顶', items: pinned })
  for (const g of ['今天', '昨天', '更早'] as const) {
    const items = qaSessions.value
      .filter((s) => !s.pinned && match(s) && groupOf(s) === g)
      .map((s) => (s.noteId ? { ...s, title: noteSessionTitle(s.noteId, s.title) } : s))
    if (items.length) groups.push({ label: g, items })
  }
  return groups
})

// ---------- 会话管理：新增 / 置顶 / 重命名 / 删除 ----------
/** 课内对话条目标题：优先纪要标题（更可读），纪要尚未加载时用后端会话标题兜底 */
function noteSessionTitle(noteId: string, fallback: string): string {
  return classNotes.value.find((n) => n.id === noteId)?.title || fallback
}

function ensureNoteSession(noteId: string, fallbackTitle = '课内对话') {
  if (!noteId || qaSessions.value.some((s) => s.id === noteId)) return
  qaSessions.value.push({ id: noteId, title: noteSessionTitle(noteId, fallbackTitle), noteId })
}

/** 从后端对话目录补齐课内对话条目：只展示 question_count>0 的（真的发生过问答）。
 * 生成新纪要不再自动出现对话（2026-11-09 反馈）；失败静默（下次进入重试）。
 * 已有条目不覆盖标题，保留用户重命名。 */
async function syncNoteSessions() {
  if (isGuest.value) return
  try {
    for (const s of await qaApi.sessions()) {
      if (s.note && s.question_count > 0 && !qaSessions.value.some((x) => x.id === String(s.note))) {
        qaSessions.value.push({ id: String(s.note), title: noteSessionTitle(String(s.note), s.title), noteId: String(s.note) })
      }
    }
  } catch { /* 目录拉取失败不阻塞页面 */ }
}

function createSession() {
  const s: QaSession = { id: 'qa' + Date.now(), title: '新的对话' }
  qaSessions.value.unshift(s)
  activeSessionId.value = s.id // 不打断其他会话还在后台进行的回答
  messagesFor(s.id)
}

function togglePin(s: QaSession) {
  if (s.pinned) {
    s.pinned = false
    s.pinnedAt = undefined
  } else {
    s.pinned = true
    s.pinnedAt = Date.now()
  }
  if (s.noteId) void qaApi.updateSession(s.noteId, { pinned: s.pinned }).catch(() => {}) // 课内对话置顶落库
}

// 行内重命名
const editId = ref<string | null>(null)
const editTitle = ref('')

function startRename(s: QaSession) {
  editId.value = s.id
  editTitle.value = s.title
  nextTick(() => {
    const el = document.querySelector('.rename-input') as HTMLInputElement | null
    el?.focus()
    el?.select()
  })
}
function commitRename() {
  const s = qaSessions.value.find((x) => x.id === editId.value)
  const t = editTitle.value.trim()
  if (s && t) {
    s.title = t
    if (s.noteId) void qaApi.updateSession(s.noteId, { title: t }).catch(() => {}) // 课内对话重命名落库
  }
  editId.value = null
}
function cancelRename() {
  editId.value = null
}

// 删除；若删除的是当前对话则自动切到剩余的第一个
function removeSession(s: QaSession) {
  const idx = qaSessions.value.indexOf(s)
  if (idx !== -1) qaSessions.value.splice(idx, 1)
  delete messageStore[s.id]
  loadedSessions.delete(s.id)
  const task = askTasks.get(s.id)
  if (task) stopTask(task) // 被删会话的回答没有存在意义：断开并清场
  // 课内对话删除落库（后端连同该纪要的问答记录一起清），否则下次进入会从目录里回来
  if (s.noteId) {
    void qaApi.deleteSession(s.noteId).catch(() => {})
    // 删的是 URL ?note= 直达目标时清掉参数，否则刷新会被 onMounted 的直达兜底原样建回
    if (route.query.note === s.noteId) void router.replace({ query: { ...route.query, note: undefined } })
  }
  if (activeSessionId.value === s.id) {
    const first = qaSessions.value[0]
    if (first) {
      activeSessionId.value = first.id
      messagesFor(first.id)
    } else {
      activeSessionId.value = ''
    }
  }
}

// 删除前二次确认
const deleteTarget = ref<QaSession | null>(null)
function confirmDelete() {
  if (deleteTarget.value) removeSession(deleteTarget.value)
  deleteTarget.value = null
}

// ---------- 消息（按对话隔离） ----------
const messageStore = reactive<Record<string, ChatMessage[]>>({})

function messagesFor(id: string): ChatMessage[] {
  if (!messageStore[id]) messageStore[id] = []
  return messageStore[id]
}

const activeMessages = computed<ChatMessage[]>(() =>
  activeSessionId.value ? (messageStore[activeSessionId.value] ?? []) : []
)

const activeSession = computed(() => {
  const s = qaSessions.value.find((x) => x.id === activeSessionId.value)
  // 课内对话标题实时派生（同 sessionGroups，兜底标题在纪要加载后自愈）
  return s?.noteId ? { ...s, title: noteSessionTitle(s.noteId, s.title) } : s
})
const activeNote = computed(() =>
  activeSession.value?.noteId ? classNotes.value.find((n) => n.id === activeSession.value?.noteId) : undefined
)

// ---------- 历史记录（来自后端问答记录，会话首次切入时拉取一次） ----------
const loadedSessions = new Set<string>()

/** 引用片段清洗：去 markdown 记号 / OCR 截图路径 / html 标签，压成一段整齐文本 */
function cleanSnippet(raw: string) {
  return raw
    .replace(/<img[^>]*>/gi, ' ')
    .replace(/<[^<>\n]{1,120}>/g, ' ')
    .replace(/[!！]\s*\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\(?[A-Za-z]:[\\/][^)]*?\.(?:png|jpe?g|gif|webp|bmp)\)?/gi, ' ')
    .replace(/!?\[[^\]]*\]/g, ' ')
    .replace(/[#*`~|]+/g, ' ')
    .replace(/-+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([，。；、！？])/g, '$1')
    .replace(/。{2,}/g, '。')
    .trim()
    .replace(/^[^A-Za-z0-9一-鿿]+/, '')
}

/** 后端引用条目 → 卡片数据（历史恢复与流式结束两处共用，渲染口径一致） */
function toCitations(refs: ApiQaRecord['references'], noteTitle: string): Citation[] {
  return (Array.isArray(refs) ? refs : []).map((ref, i) => {
    const ext = ref.kind === 'external'
    const doc = ref.kind === 'doc'
    return {
      no: i + 1,
      kind: ext ? 'external' : doc ? 'doc' : ref.time ? 'audio' : 'kb',
      mark: ext ? (ref.label || '外部来源') : doc ? (ref.label || '上传文档') : ref.time || ref.label,
      // 自由对话的跨纪要引用没有会话级标题，卡片名取引用自带的纪要标题
      note: ext ? '网络检索' : doc ? '上传文档' : (ref.label || noteTitle),
      snippet: cleanSnippet(ref.detail ?? ''),
      score: ext ? 0 : Math.max(0.6, 0.92 - i * 0.08),
      url: ref.url,
    }
  })
}

/** 后端问答记录 → 会话内两条消息（用户提问 + 助手回答） */
function recordToMessages(r: ApiQaRecord): ChatMessage[] {
  const citations = toCitations(r.references, r.note_title)
  const time = r.created_at.slice(11, 16) || now()
  return [
    { id: 'q' + r.id, role: 'user', content: r.question, time },
    {
      id: 'a' + r.id, role: 'assistant', content: r.answer,
      citations, followups: r.followups, qaId: r.id, time,
    },
  ]
}

async function loadHistory(id: string) {
  if (loadedSessions.has(id) || isGuest.value) return
  const s = qaSessions.value.find((x) => x.id === id)
  if (!s) return
  loadedSessions.add(id)
  try {
    // 课内会话按纪要拉取；自由对话按会话标识拉取（后端 QaRecord.session_ref）
    const records = await (s.noteId ? qaApi.list(s.noteId) : qaApi.list(undefined, id))
    // 后端按时间倒序返回，聊天气泡需正序（与实时追问的追加顺序一致）
    messagesFor(id).push(...records.reverse().flatMap(recordToMessages))
    if (id === activeSessionId.value) scrollToBottom(true)
  } catch {
    loadedSessions.delete(id) // 加载失败：切回该会话时可重试
  }
}

function switchSession(id: string) {
  if (id === activeSessionId.value) return
  // 不打断当前会话的流式回答：任务绑在会话上后台继续，切回来接着显示
  activeSessionId.value = id
  messagesFor(id)
  void loadHistory(id)
  scrollToBottom(true)
}

// ---------- AI 状态机 ----------
const input = ref('')
const composerInput = ref<HTMLTextAreaElement | null>(null)

type AiStage = 'searching' | 'thinking' | 'composing' | 'validating' | 'refining'
const STAGE_TEXT: Record<AiStage, string> = {
  searching: '正在检索课堂知识库',
  thinking: '正在思考',
  composing: '正在组织回答',
  validating: '正在校验引用来源',
  refining: '正在修正回答',
}
const STAGE_ICON: Record<AiStage, string> = {
  searching: 'database',
  thinking: 'spark',
  composing: 'edit',
  validating: 'shield',
  refining: 'refresh',
}

/** 每个会话独立的流式任务：任务绑定会话而非页面全局，切换对话不打断后台回答——
 * 切走后照常答完入库，气泡落在原会话，切回来继续走字（2026-11-05 用户反馈） */
interface AskTask {
  sid: string
  phase: 'typing' | 'streaming' // typing=前置阶段动画 streaming=逐字输出
  buf: AskBuf
  promise: Promise<ApiQaRecord | null> | null
  abort: AbortController
  msg: ChatMessage | null // 进入 streaming 时创建的正式气泡
  stage: AiStage | null
  stageTimers: number[]
  streamLaunch: number | null
  stageCycle: number | null
  backendStage: boolean
  refineRound: number
  reveal: number
  lastMoveAt: number
  timer: number | null
}
const askTasks = reactive(new Map<string, AskTask>())
const activeTask = computed<AskTask | null>(() => askTasks.get(activeSessionId.value) ?? null)
const isTyping = computed(() => activeTask.value?.phase === 'typing')
const isStreaming = computed(() => activeTask.value?.phase === 'streaming')
// 模板引用的阶段状态一律取自当前会话的任务：后台任务的气泡由各自的追赶定时器推进，
// 不随切换丢失；切回会话时模板重新读到任务状态即可续显
const viewStage = computed<AiStage | null>(() => activeTask.value?.stage ?? null)
const viewStreamingId = computed(() => activeTask.value?.msg?.id ?? '')
const viewRefineRound = computed(() => activeTask.value?.refineRound ?? 0)

// 阶段文案：修正轮带轮次（如「正在修正回答（第 2 轮）」），其余直接取表
function stageText(stage: AiStage) {
  return stage === 'refining' && viewRefineRound.value > 1
    ? `${STAGE_TEXT[stage]}（第 ${viewRefineRound.value} 轮）`
    : STAGE_TEXT[stage]
}

function clearTaskTimers(t: AskTask) {
  while (t.stageTimers.length) {
    const id = t.stageTimers.pop()
    if (id !== undefined) window.clearTimeout(id)
  }
  if (t.streamLaunch !== null) { window.clearTimeout(t.streamLaunch); t.streamLaunch = null }
  if (t.stageCycle !== null) { window.clearInterval(t.stageCycle); t.stageCycle = null }
  if (t.timer !== null) { window.clearInterval(t.timer); t.timer = null }
}

function runStages(t: AskTask) {
  t.stage = 'searching'
  t.stageTimers.push(window.setTimeout(() => { t.stage = 'thinking' }, 1100))
  t.stageTimers.push(window.setTimeout(() => { t.stage = 'composing' }, 2400))
  t.streamLaunch = window.setTimeout(() => { startStream(t) }, 3300)
}

// 流式等待期状态：正式消息气泡已创建但首字未到（检索 / 外部搜索耗时不定），
// 必须持续显示阶段文案，绝不能渲染成无字空框；阶段在思考 / 组织间轮换表示活跃
function stopTaskCycle(t: AskTask) {
  if (t.stageCycle !== null) { window.clearInterval(t.stageCycle); t.stageCycle = null }
}

function startStageCycle(t: AskTask) {
  stopTaskCycle(t)
  t.stageCycle = window.setInterval(() => {
    t.stage = t.stage === 'thinking' ? 'composing' : 'thinking'
  }, 3500)
}

// 后端 status 帧驱动真实阶段（agent 流水线：路由 / 多轮生成 / 校验 / 修正）。
// 收到帧即停掉本地假轮换并清掉假阶段定时器（streamLaunch 不能动），此后阶段完全由后端推进；
// 通用问答（非 agent 链路）没有 status 帧，维持本地轮换不变。
function onTaskStatus(t: AskTask, stage: string, round?: number) {
  t.backendStage = true
  while (t.stageTimers.length) {
    const id = t.stageTimers.pop()
    if (id !== undefined) window.clearTimeout(id)
  }
  stopTaskCycle(t)
  if ((round ?? 0) > t.refineRound) t.refineRound = round!
  t.stage = stage === 'validating' ? 'validating'
    : stage === 'retrieving' ? 'searching'
    : stage === 'generating' ? 'composing'
    : (round ?? 1) > 1 ? 'refining' : 'thinking'
}

/** 终止某个会话的生成：真正断开 SSE——后端断流兜底会把已生成内容收尾入库，
 * 气泡保留已生成的部分并注明已停止（刷新后从服务端读回部分回答） */
function stopTask(t: AskTask) {
  clearTaskTimers(t)
  t.abort.abort()
  if (askTasks.get(t.sid) === t) askTasks.delete(t.sid)
  if (t.msg) t.msg.content = (t.msg.content || '') + (t.msg.content ? '\n\n（已停止生成）' : '已停止生成')
}

function stopGenerating() {
  const t = activeTask.value
  if (t) stopTask(t)
}

// 把当前对话关联课堂的纪要标题代入演示回答（更贴近真实观感）
function buildReply() {
  const note = activeNote.value
  if (!note) return demoReply
  const prefix = `根据「${note.title}」的课堂纪要与转写稿，回答如下：\n\n`
  return { content: prefix + demoReply.content, citations: demoReply.citations as Citation[] }
}

// 回答正文渲染：先转义 HTML，再做引用标记 [1] 上标与网址链接化（来源说明里的网址可点击直达）
function renderContent(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\[(\d+)\]/g, '<sup class="cite-mark">[$1]</sup>')
    .replace(/https?:\/\/[^\s<>"'），。；、！？（()]+/g, (u) => `<a class="content-link" href="${u}" target="_blank" rel="noopener">${u}</a>`)
}

// 来源说明分区：正文与「—— 来源说明 ——」后的来源列表分开渲染，
// 来源区弱化为小字灰字，不和正文同样突显（2026-10-26 用户反馈）
const SOURCE_MARK = '—— 来源说明 ——'
function renderAnswer(text: string) {
  const i = text.indexOf(SOURCE_MARK)
  if (i < 0) return renderContent(text)
  const body = renderContent(text.slice(0, i).replace(/\n+$/, ''))
  const src = renderContent(text.slice(i + SOURCE_MARK.length).replace(/^\n+/, ''))
  return `${body}<div class="src-note"><div class="src-note-title">来源说明</div>${src}</div>`
}

// ---------- 滚动与导航 ----------
const messagesEl = ref<HTMLDivElement>()
function scrollToBottom(instant = false) {
  nextTick(() => {
    const el = messagesEl.value
    el?.scrollTo({ top: el.scrollHeight, behavior: instant ? 'auto' : 'smooth' })
  })
}

const showToBottom = ref(false)
function onMessagesScroll() {
  const el = messagesEl.value
  if (!el) return
  showToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight > 240
}
function toBottom() {
  const el = messagesEl.value
  el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
}

const flashId = ref('')
let flashTimer: number | null = null
const outline = computed(() =>
  activeMessages.value.filter((m) => m.role === 'user').map((m) => ({ id: m.id, text: m.content }))
)

function jumpTo(id: string) {
  flashId.value = id
  nextTick(() => {
    messagesEl.value
      ?.querySelector(`[data-mid="${id}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
  if (flashTimer) window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => { flashId.value = '' }, 1400)
}

// ---------- 提问记录导航 ----------
// 千问式交互：固定在消息区右缘（滚动条左侧），纯 CSS 悬停 / 键盘聚焦展开，点击条目定位

// ---------- 附件上传（输入框左下角“+”菜单；格式与工作台上传完全一致，最多 8 个，支持拖拽） ----------
type AttachKind = UploadKind
interface AttachItem {
  id: string
  name: string
  kind: AttachKind
  size: string
  preview?: string
  file?: File // 附件原始文件，提问时随 multipart 上传（图片→视觉问答 / 文档→解析文本作答）
}
const MAX_ATTACH = 8

const attachments = ref<AttachItem[]>([])
const attachMenuOpen = ref(false)
const attachMenuRoot = ref<HTMLElement>()
const attachInput = ref<HTMLInputElement>()
const attachAccept = ref('')
const attachDragover = ref(false)
const attachTip = ref('')
let attachTipTimer: number | null = null
let dragDepth = 0

function flashAttachTip(msg: string) {
  attachTip.value = msg
  if (attachTipTimer) window.clearTimeout(attachTipTimer)
  attachTipTimer = window.setTimeout(() => { attachTip.value = '' }, 2600)
}

function toggleAttachMenu() {
  attachMenuOpen.value = !attachMenuOpen.value
}
function closeAttachMenu() {
  attachMenuOpen.value = false
}

function pickAttach(kind: 'image' | 'doc') {
  if (attachments.value.length >= MAX_ATTACH) {
    flashAttachTip(`最多同时上传 ${MAX_ATTACH} 个文件，请先移除部分附件`)
    closeAttachMenu()
    return
  }
  attachAccept.value = UPLOAD_ACCEPT[kind]
  closeAttachMenu()
  nextTick(() => attachInput.value?.click())
}

function onAttachChange(e: Event) {
  handleAttachFiles((e.target as HTMLInputElement).files)
  ;(e.target as HTMLInputElement).value = ''
}

function handleAttachFiles(list: FileList | null | undefined) {
  if (!list) return
  let accepted = 0
  let dupCount = 0
  let badFormat = ''
  let tooBig = ''
  let blocked = ''
  for (const f of Array.from(list)) {
    // 最多同时添加 MAX_ATTACH 个附件（相同或不同格式合计），超出部分给出提示
    if (attachments.value.length >= MAX_ATTACH) {
      flashAttachTip(`最多同时上传 ${MAX_ATTACH} 个文件，超出部分未添加`)
      break
    }
    const kind = detectUploadKind(f.name)
    if (!kind) {
      badFormat = badFormat ? `${badFormat}、${f.name}` : f.name
      continue
    }
    // 问答附件支持图片（视觉问答）与文档（后端解析文本作答）；
    // 音视频 / 压缩包在这里就拦下并说明去向，而不是等发送后才吃 400
    const isZip = f.name.toLowerCase().endsWith('.zip')
    if (kind === 'audio' || kind === 'video' || isZip) {
      blocked = blocked ? `${blocked}、${f.name}` : f.name
      continue
    }
    if (f.size > UPLOAD_MAX_MB[kind] * 1024 * 1024) {
      tooBig = tooBig ? `${tooBig}、${f.name}` : f.name
      continue
    }
    if (attachments.value.some((x) => x.name === f.name && x.size === formatFileSize(f.size))) {
      dupCount++
      continue
    }
    attachments.value.push({
      id: 'a' + Date.now() + Math.random().toString(36).slice(2, 5),
      name: f.name,
      kind,
      size: formatFileSize(f.size),
      preview: kind === 'image' ? URL.createObjectURL(f) : undefined,
      file: f,
    })
    accepted++
  }
  if (blocked) flashAttachTip(`智能问答附件仅支持图片与文档（PDF / Word / PPT / 文本）：${blocked}；音视频 / 压缩包请到「课堂纪要」上传后再提问`)
  else if (badFormat) flashAttachTip(`暂不支持此格式文件：${badFormat}`)
  else if (tooBig) flashAttachTip(`文件过大：${tooBig}，请压缩后再试`)
  else if (accepted === 0 && attachments.value.length < MAX_ATTACH) {
    flashAttachTip(dupCount > 0 ? '所选文件已在附件中' : '暂不支持此格式文件')
  }
}

function removeAttachment(id: string) {
  const idx = attachments.value.findIndex((a) => a.id === id)
  if (idx >= 0) {
    const item = attachments.value[idx]
    if (item?.preview) URL.revokeObjectURL(item.preview)
    attachments.value.splice(idx, 1)
  }
}

// 拖拽添加附件：仅对文件拖入高亮；dragenter/leave 计数避免划过子元素时闪烁
function onComposerDragEnter(e: DragEvent) {
  if (!e.dataTransfer?.types.includes('Files')) return
  dragDepth++
  attachDragover.value = true
}
function onComposerDragOver(e: DragEvent) {
  if (!e.dataTransfer?.types.includes('Files')) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
}
function onComposerDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) attachDragover.value = false
}
function onComposerDrop(e: DragEvent) {
  dragDepth = 0
  attachDragover.value = false
  handleAttachFiles(e.dataTransfer?.files)
}

// 粘贴支持：剪贴板带图片文件时直接转附件（截图 Ctrl+V 即传），纯文本走浏览器默认粘贴
function onComposerPaste(e: ClipboardEvent) {
  const files = e.clipboardData?.files
  if (files && files.length) {
    e.preventDefault()
    handleAttachFiles(files)
  }
}

// 附件菜单：点击外部 / Esc 关闭
function onDocClick(e: MouseEvent) {
  if (attachMenuOpen.value && attachMenuRoot.value && !attachMenuRoot.value.contains(e.target as Node)) {
    attachMenuOpen.value = false
  }
}
function onDocKey(e: KeyboardEvent) {
  if (e.key === 'Escape') closeAttachMenu()
}

// 附件预览 objectURL 回收（待发送的 + 已随消息展示的）
function revokeAllAttachPreviews() {
  for (const a of attachments.value) {
    if (a.preview) URL.revokeObjectURL(a.preview)
  }
  for (const list of Object.values(messageStore)) {
    for (const m of list) {
      for (const a of m.attachments ?? []) {
        if (a.preview) URL.revokeObjectURL(a.preview)
      }
    }
  }
}

// ---------- 发送 ----------
/** SSE 流式问答缓冲：后端增量实时写入 text，startStream 以打字速度追赶展示。
 * 缓冲随 AskTask 挂在会话上（askTasks），不再用页面级单例——切会话不打断回答 */
interface AskBuf {
  text: string
  error: string | null
  /** 审核拦截帧类别（blocked）：命中时气泡展示拦截文案并弹安全提醒 */
  blocked: string | null
  record: ApiQaRecord | null
}

// ---------- 反馈埋点 / 安全提醒 ----------
/** 安全提醒弹窗（违规拦截 / 政治引导 / 健康禁忌） */
const safetyNotice = ref<SafetyNotice | null>(null)
/** 健康档案更新提示（composer 内联 toast，attachTip 同款模式） */
const healthTip = ref('')
let healthTipTimer: number | null = null
function showHealthTip() {
  healthTip.value = '已记录你的健康禁忌，涉及相关建议时会先做安全核查'
  if (healthTipTimer) window.clearTimeout(healthTipTimer)
  healthTipTimer = window.setTimeout(() => { healthTip.value = '' }, 3200)
}
/** 最近一条完整展示的回答：下次发送 / 离开页面时上报停留时长（≥5s 才算有效浏览） */
const lastAnswer = ref<{ qaId: number; shownAt: number } | null>(null)
function reportDwell() {
  const la = lastAnswer.value
  lastAnswer.value = null
  if (!la) return
  const secs = Math.round((Date.now() - la.shownAt) / 1000)
  if (secs < 5) return
  void qaApi.feedback(la.qaId, 'dwell', String(secs)).catch(() => {})
}
/** 页面关闭 / 刷新时的停留上报：fetch keepalive 保证请求发出 */
function reportDwellKeepalive() {
  const la = lastAnswer.value
  lastAnswer.value = null
  if (!la) return
  const secs = Math.round((Date.now() - la.shownAt) / 1000)
  if (secs < 5) return
  void fetch(`${BASE}/qa/${la.qaId}/feedback/`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ action: 'dwell', value: String(secs) }),
  }).catch(() => {})
}

function send() {
  const text = input.value.trim()
  if ((!text && !attachments.value.length) || isTyping.value || isStreaming.value) return
  reportDwell() // 上一条回答的停留时长在新提问前结算
  // 没有选中对话时自动新建一条再发送（不必先点「新增对话」）
  if (!activeSessionId.value) createSession()

  // 引用的消息随提问一并发送（正文内联引用块；标题仍取本人原文）
  const full = withQuote(text)
  messagesFor(activeSessionId.value).push({
    id: 'u' + Date.now(),
    role: 'user',
    content: full,
    attachments: attachments.value.length ? (attachments.value.map((a) => ({ ...a })) as ChatAttachment[]) : undefined,
    time: now(),
  })
  // 首条提问自动作为会话标题（手动重命名过的不覆盖），刷新后恢复列表时也好辨认
  const cur = qaSessions.value.find((x) => x.id === activeSessionId.value)
  if (cur && cur.title === '新的对话') cur.title = text.slice(0, 18)
  // 附件随提问走 multipart 上传：图片 → 视觉问答，文档 → 后端解析文本作答
  const fileOf = (a: AttachItem) => (a.file instanceof File ? a.file : null)
  const imgFiles = attachments.value.filter((a) => a.kind === 'image').map(fileOf).filter((f): f is File => !!f)
  const docFiles = attachments.value.filter((a) => a.kind !== 'image').map(fileOf).filter((f): f is File => !!f)
  // 附件随消息发出（预览地址由消息继续持有展示），输入区清空
  attachments.value = []
  input.value = ''
  scrollToBottom()
  askQuestion(full, imgFiles, docFiles)
}

/** 提问：阶段动画进行的同时发起 SSE 流式请求，增量先落缓冲，动画结束后边收边显。
 * 任务按会话登记（askTasks）：切换对话不打断，回答在原会话照常走完 */
function askQuestion(text: string, images?: File[], docs?: File[]) {
  const sid = activeSessionId.value || ''
  // 纯数字会话 id = 纪要 id：条目缺失时先补再提问，否则课内提问会掉进自由对话
  if (sid && /^\d+$/.test(sid)) ensureNoteSession(sid)
  // 任务本身建成 reactive：askTasks 存的是代理，raw 对象的属性变更不会触发
  // isTyping/isStreaming 等 computed，且 get() 取回的对象必须与闭包里的 t 同一（身份判定删任务）
  const t = reactive({
    sid,
    phase: 'typing',
    buf: { text: '', error: null, blocked: null, record: null },
    promise: null,
    abort: new AbortController(),
    msg: null,
    stage: null,
    stageTimers: [],
    streamLaunch: null,
    stageCycle: null,
    backendStage: false, // 阶段先走本地轮换，收到后端 status 帧再接管
    refineRound: 0,
    reveal: 0,
    lastMoveAt: Date.now(),
    timer: null,
  }) as AskTask
  askTasks.set(sid, t)
  runStages(t)
  if (isGuest.value) return // 游客态：startStream 走本地演示回答
  // 会话标识随提问入库（session_ref）：刷新后按会话拉回历史
  t.promise = streamAsk(activeSession.value?.noteId ?? null, text, t.buf, sid || undefined,
      (stage, round) => onTaskStatus(t, stage, round), images, docs, t.abort.signal)
    .then((record) => {
      t.buf.record = record
      return record
    })
    .catch((err: unknown): ApiQaRecord | null => {
      // 主动停止（AbortError）时气泡已在 stopGenerating 收尾，这里只兜网络错误
      if ((err as Error)?.name !== 'AbortError' && !t.buf.error) t.buf.error = '网络异常，请稍后再试'
      return null
    })
}

function startStream(t: AskTask) {
  t.phase = 'streaming'
  t.stage = t.stage || 'composing'
  if (!t.backendStage) startStageCycle(t) // 后端 status 帧已接管时不做本地假轮换
  const msg: ChatMessage = reactive({
    id: 'a' + Date.now(),
    role: 'assistant',
    content: '',
    time: now(),
  })
  t.msg = msg
  messagesFor(t.sid).push(msg)
  if (t.sid === activeSessionId.value) scrollToBottom()

  const pending = t.promise
  const buf = t.buf

  // 游客 / 请求未发出：本地演示回答按原逐字节奏输出
  if (!pending || !buf) {
    const reply = buildReply()
    msg.citations = reply.citations
    let i = 0
    t.timer = window.setInterval(() => {
      i += 2 + Math.floor(Math.random() * 3)
      msg.content = reply.content.slice(0, i)
      if (i >= reply.content.length) {
        if (t.timer !== null) { window.clearInterval(t.timer); t.timer = null }
        t.stage = null
        stopTaskCycle(t)
        if (askTasks.get(t.sid) === t) askTasks.delete(t.sid)
      }
    }, 30)
    return
  }

  // 真流式：展示进度追赶 SSE 缓冲；流结束后落引用 / 追问 / 点赞态
  let settled = false
  // resolve / reject 都算收尾：断流时 askQuestion 的 catch 已写入 buf.error；
  // 若只监听 then，流中途异常会让 settled 永不成立 → 停止按钮永久卡住无法继续提问
  void pending.finally(() => {
    settled = true
  })
  t.timer = window.setInterval(() => {
    if (buf.text.length < t.reveal) {
      // agent 修正轮：后端 replace 清空缓冲重写。播放位必须同步回退，否则旧草稿
      // 冻结在屏上、新答案永远追不上，看起来就是「答完却卡住」
      t.reveal = buf.text.length
      msg.content = buf.text.slice(0, t.reveal)
      t.lastMoveAt = Date.now()
    }
    if (t.reveal < buf.text.length) {
      t.reveal = Math.min(buf.text.length, t.reveal + 2 + Math.floor(Math.random() * 3))
      msg.content = buf.text.slice(0, t.reveal)
      t.lastMoveAt = Date.now()
      if (t.sid === activeSessionId.value) scrollToBottom()
      return
    }
    if (!settled) {
      // 流迟迟不结束（连接黑洞 / 服务端无响应）：90 秒无任何增长按超时收尾
      if (Date.now() - t.lastMoveAt < 90_000) return
      buf.error = buf.error || '回答超时，请检查网络后重试'
      settled = true
    }
    try {
      clearTaskTimers(t)
      t.stage = null
      if (buf.error) {
        msg.content = `回答生成失败：${buf.error}`
      } else {
        // 审核拦截帧：无问答记录，气泡展示拦截文案并弹安全提醒
        if (buf.blocked) safetyNotice.value = { kind: 'blocked', text: buf.text }
        const r = buf.record
        if (r) {
          msg.citations = toCitations(r.references, r.note_title)
          msg.qaId = r.id
          // 后端校验后的权威全文：覆盖流式期间可能叠重的中间文本（agent 多轮修正等）
          if (r.answer) msg.content = r.answer
          if (r.followups?.length) msg.followups = r.followups
          // 政治引导 / 健康禁忌拦截：回答带审核标记，弹对应安全提醒
          if (r.moderation === 'political' || r.moderation === 'health_block') {
            safetyNotice.value = { kind: r.moderation, text: r.answer }
          }
          // 本次提问更新了健康档案：内联提示确认
          if (r.profile_updated) showHealthTip()
          // 停留时长计时起点：下次发送 / 离开页面上报
          lastAnswer.value = { qaId: r.id, shownAt: Date.now() }
        }
      }
    } finally {
      // 无论收尾过程是否抛错都必须移除任务，否则发送键永远停留在停止态
      if (askTasks.get(t.sid) === t) askTasks.delete(t.sid)
      if (t.sid === activeSessionId.value) scrollToBottom()
    }
  }, 30)
}

function regenerate(msg: ChatMessage) {
  if (isStreaming.value || isTyping.value || !activeSessionId.value) return
  const list = messagesFor(activeSessionId.value)
  const idx = list.indexOf(msg)
  const question = [...list.slice(0, idx)].reverse().find((m) => m.role === 'user')?.content ?? ''
  // 重新提问埋点：对上一条回答上报 reask（驱动片段降权与知识库缺口）
  if (msg.qaId) void qaApi.feedback(msg.qaId, 'reask', question.slice(0, 200)).catch(() => {})
  reportDwell()
  list.splice(idx, 1)
  askQuestion(question) // 重新提问（后端生成一条新记录）
}

// ---------- 消息操作：复制 / 引用 / 回滚 ----------
// 复制兜底：部署站是 http，navigator.clipboard 只在安全上下文存在，
// 必须降级 execCommand，否则线上点击复制毫无反应
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* 非安全上下文或权限拒绝，走降级 */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

const actionTip = ref('')
let actionTipTimer: number | undefined
function flashActionTip(text: string) {
  actionTip.value = text
  if (actionTipTimer) window.clearTimeout(actionTipTimer)
  actionTipTimer = window.setTimeout(() => (actionTip.value = ''), 2400)
}

async function copyMessage(msg: ChatMessage) {
  const ok = await copyText(msg.content)
  flashActionTip(ok ? '已复制到剪贴板' : '复制失败，请手动选择文本复制')
  // 复制埋点：视为有用信号，驱动片段加权
  if (ok && msg.qaId) void qaApi.feedback(msg.qaId, 'copy').catch(() => {})
}

// 引用消息：composer 上方出现引用条，摘录随下一次提问一并发给后端
const quoteMsg = ref<ChatMessage | null>(null)
function quoteFor(msg: ChatMessage) {
  quoteMsg.value = msg
  nextTick(() => composerInput.value?.focus())
}
// 发送时把引用摘录拼进提问正文（会话标题仍取本人原文，不带引用块）
function withQuote(text: string) {
  const q = quoteMsg.value
  quoteMsg.value = null
  if (!q) return text
  const excerpt = q.content.replace(/\s+/g, ' ').trim().slice(0, 120)
  const who = q.role === 'user' ? '我' : 'AI'
  return `（引用${who}此前的消息：「${excerpt}」）\n${text}`
}

// 回滚到某条提问：删除该问答及其后的全部记录（服务端 + 本地），
// 原问题填回输入框可改后重发（Claude 式 rewind）
const rollbackTarget = ref<{ msg: ChatMessage; idx: number; count: number; recordId?: number } | null>(null)
const rollbackBusy = ref(false)
const rollbackError = ref('')
function askRollback(msg: ChatMessage) {
  if (isStreaming.value || isTyping.value || !activeSessionId.value) return
  const list = messagesFor(activeSessionId.value)
  const idx = list.indexOf(msg)
  if (idx < 0) return
  rollbackTarget.value = {
    msg, idx,
    count: list.length - idx,
    recordId: list.slice(idx + 1).find((m) => m.role === 'assistant' && m.qaId)?.qaId,
  }
  rollbackBusy.value = false
  rollbackError.value = ''
}
async function confirmRollback() {
  const t = rollbackTarget.value
  if (!t || rollbackBusy.value || !activeSessionId.value) return
  rollbackBusy.value = true
  rollbackError.value = ''
  try {
    if (!isGuest.value && t.recordId) await qaApi.rollback(activeSessionId.value, t.recordId)
    messagesFor(activeSessionId.value).splice(t.idx)
    input.value = t.msg.content
    quoteMsg.value = null
    rollbackTarget.value = null
    nextTick(() => composerInput.value?.focus())
  } catch (e) {
    rollbackError.value = e instanceof Error ? e.message : '回滚失败，请稍后再试'
  } finally {
    rollbackBusy.value = false
  }
}

// ---------- 语音输入（Web Speech API，需 HTTPS） ----------
const listening = ref(false)
const voiceTip = ref('')
let voiceTipTimer: number | null = null
const SpeechRecognitionCtor =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
let recognition: any = null

function showVoiceTip(text: string) {
  voiceTip.value = text
  if (voiceTipTimer) window.clearTimeout(voiceTipTimer)
  voiceTipTimer = window.setTimeout(() => { voiceTip.value = '' }, 2600)
}

function toggleVoice() {
  if (!SpeechRecognitionCtor) {
    showVoiceTip('当前浏览器不支持语音识别，部署 HTTPS 证书后即可使用')
    return
  }
  if (listening.value) {
    recognition?.stop()
    return
  }
  const rec = new SpeechRecognitionCtor()
  rec.lang = 'zh-CN'
  rec.interimResults = true
  rec.onresult = (e: any) => {
    let text = ''
    for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript
    input.value = text
  }
  rec.onerror = () => {
    listening.value = false
    showVoiceTip('语音识别出错，请重试')
  }
  rec.onend = () => { listening.value = false }
  recognition = rec
  rec.start()
  listening.value = true
}

// ---------- 引用面板 ----------
const openCitations = reactive<Record<string, boolean>>({})
function toggleCitation(id: string) {
  openCitations[id] = !openCitations[id]
}

function segLevel(score: number) {
  return Math.min(10, Math.max(1, Math.round(score * 10)))
}
function citeIcon(c: Citation) {
  if (c.kind === 'audio') return 'headphones'
  if (c.kind === 'external') return 'globe'
  if (c.kind === 'kb' || c.kind === 'doc') return 'file'
  return 'image'
}
function citeMarkText(c: Citation) {
  if (c.kind === 'audio') return `录音 ${c.mark}`
  if (c.kind === 'external') return '外部来源'
  return c.mark
}

// ---------- 建议 ----------
// 通用推荐：无纪要账号 / 游客态 / 接口失败时使用——全部不依赖课堂资料，走联网通用问答
const GENERAL_SUGGESTIONS = ['用通俗的话解释什么是机器学习', '帮我制定高数期末复习计划', '英语四级作文有哪些万能句型？', '什么是毕达哥拉斯定理？']
const hasNotes = computed(() => doneNotes.value.length > 0)
// 个性化追问：登录后由后端按「近期提问」生成（后端未配模型 key 时为规则版），失败静默回退通用推荐
const personalized = ref<string[] | null>(null)
const suggestions = computed(() => {
  const t = activeNote.value?.title
  if (t) return [`「${t}」的重点是什么？`, '这节课布置了什么作业？', '把老师强调的考点整理一下', '老师课上回答过哪些问题？']
  if (!hasNotes.value) return GENERAL_SUGGESTIONS
  return personalized.value ?? GENERAL_SUGGESTIONS
})

function suggestionClick(q: string) {
  input.value = q
  send()
}

function now() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 初始对话：支持 /qa?note=id 直达；纪要异步加载完成后补齐会话列表再选中
onMounted(async () => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKey)
  window.addEventListener('pagehide', reportDwellKeepalive)
  await ensureNotesLoaded()
  // 拉取个性化追问建议（游客态跳过；失败静默保留兜底文案）
  if (!isGuest.value) {
    qaApi.suggestions()
      .then((d) => {
        if (Array.isArray(d.suggestions) && d.suggestions.length) personalized.value = d.suggestions
      })
      .catch(() => {})
  }
  // 恢复本地持久化的自由对话会话（课内会话条目来自后端对话目录，不落盘）
  const restored = loadFreeSessions()
  if (restored.length) qaSessions.value = [...restored, ...qaSessions.value]
  // 课内对话只补「真的发生过问答」的纪要（后端 question_count>0），生成新纪要不再自动多一条对话
  await syncNoteSessions()
  const q = route.query.note
  const id = typeof q === 'string' ? q : ''
  // 工作台「智能问答」直达：条目还没有也必须先补上，否则该提问会掉进自由对话
  if (id) ensureNoteSession(id)
  const savedActive = localStorage.getItem(`zy_qa_active:${uidKey()}`) || ''
  const exists = qaSessions.value.some((s) => s.id === id)
  activeSessionId.value = exists
    ? id
    : (qaSessions.value.some((x) => x.id === savedActive) ? savedActive : (qaSessions.value[0]?.id ?? ''))
  if (activeSessionId.value) void loadHistory(activeSessionId.value)
  nextTick(() => scrollToBottom(true))
})

// keep-alive 重复激活（组件已挂载时从工作台点「智能问答」直达）：处理 ?note= 切会话。
// 注意 onActivated 首次挂载也会触发且不等 onMounted 的 await——必须先等纪要加载完，
// 否则条目会在 classNotes 为空时创建、标题冻结成兜底文案
onActivated(async () => {
  const q = route.query.note
  const id = typeof q === 'string' ? q : ''
  if (!id || !/^\d+$/.test(id)) return
  await ensureNotesLoaded()
  ensureNoteSession(id)
  if (activeSessionId.value === id) return
  activeSessionId.value = id
  messagesFor(id)
  void loadHistory(id)
  nextTick(() => scrollToBottom(true))
})

onBeforeUnmount(() => {
  for (const t of askTasks.values()) {
    clearTaskTimers(t)
    t.abort.abort() // 组件销毁（登出等）：后台回答随之终止，后端断流兜底保留部分回答
  }
  askTasks.clear()
  if (flashTimer) window.clearTimeout(flashTimer)
  if (attachTipTimer) window.clearTimeout(attachTipTimer)
  if (healthTipTimer) window.clearTimeout(healthTipTimer)
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKey)
  window.removeEventListener('pagehide', reportDwellKeepalive)
  revokeAllAttachPreviews()
})

// keep-alive 切走时结算停留时长（组件不销毁，onBeforeUnmount 不触发）
onDeactivated(() => {
  reportDwell()
})
</script>

<template>
  <div class="chat-shell">
    <!-- 左侧对话列表 -->
    <aside class="sessions" :class="{ collapsed: !sessionsOpen }">
      <button class="btn btn-primary btn-block" @click="createSession">
        <AppIcon name="plus" :size="16" /> 新增对话
      </button>
      <div class="search-box">
        <AppIcon name="search" :size="15" />
        <input v-model="sessionSearch" placeholder="搜索对话" class="search-input" />
      </div>

      <div class="session-scroll">
        <template v-for="g in sessionGroups" :key="g.label">
          <div class="text-uppercase group-label">{{ g.label }}</div>
          <div
            v-for="s in g.items"
            :key="s.id"
            class="session-item"
            :class="{ active: s.id === activeSessionId, pinned: s.pinned }"
            role="button"
            tabindex="0"
            @click="switchSession(s.id)"
            @keydown.enter.prevent="switchSession(s.id)"
          >
            <AppIcon name="chat" :size="14" />
            <input
              v-if="editId === s.id"
              v-model="editTitle"
              class="rename-input"
              aria-label="重命名对话"
              @click.stop
              @keydown.enter.prevent="commitRename"
              @keydown.esc="cancelRename"
              @blur="commitRename"
            />
            <span v-else class="ellipsis">{{ s.title }}</span>
            <span v-if="editId !== s.id" class="item-actions">
              <button
                class="item-act"
                :class="{ on: s.pinned }"
                :title="s.pinned ? '取消置顶' : '置顶'"
                :aria-label="s.pinned ? '取消置顶' : '置顶'"
                @click.stop="togglePin(s)"
              ><AppIcon name="pin" :size="13" /></button>
              <button class="item-act" title="重命名" aria-label="重命名" @click.stop="startRename(s)">
                <AppIcon name="edit" :size="13" />
              </button>
              <button class="item-act danger" title="删除" aria-label="删除" @click.stop="deleteTarget = s">
                <AppIcon name="trash" :size="13" />
              </button>
            </span>
          </div>
        </template>
        <div v-if="sessionGroups.length === 0" class="session-empty">没有匹配的对话</div>
      </div>

      <div class="kb-notice">
        <AppIcon name="database" :size="15" />
        <span>已接入 {{ doneNotes.length }} 个课堂 · {{ totalChunks }} 个知识片段</span>
      </div>
    </aside>

    <!-- 折叠标志 -->
    <button
      class="rail-toggle"
      :title="sessionsOpen ? '收起对话列表' : '展开对话列表'"
      :aria-label="sessionsOpen ? '收起对话列表' : '展开对话列表'"
      @click="sessionsOpen = !sessionsOpen"
    >
      <AppIcon :name="sessionsOpen ? 'chevron-left' : 'chevron-right'" :size="14" />
    </button>

    <!-- 右侧聊天窗口 -->
    <section class="chat-main">
      <div class="chat-head">
        <template v-if="activeSession">
          <span class="head-title ellipsis">{{ activeSession.title }}</span>
        </template>
        <span v-else class="head-title muted">选择左侧对话开始追问</span>
      </div>

      <!-- 消息区 -->
      <div class="messages-wrap">
        <div ref="messagesEl" class="messages" @scroll.passive="onMessagesScroll">
          <!-- 空状态 -->
          <div v-if="!activeMessages.length" class="welcome fade-in">
            <!-- 欢迎标：logo 同款四角星（白紫渐变流动 + 边缘水晶扫光） -->
            <div class="welcome-logo"><SparkMark :size="36" /></div>
            <h2 class="h2">{{ hasNotes ? '针对课堂内容，想问点什么？' : '有问题，尽管问' }}</h2>
            <p class="text-md muted">{{ hasNotes ? '回答基于课堂纪要、转写稿与板书生成，每句话都能溯源到录音时间点或图片。' : '还没上传课堂资料也没关系：回答结合全网资料生成，并标注来源与依据。' }}</p>
            <div class="sug-grid">
              <button v-for="q in suggestions" :key="q" class="sug-card" @click="suggestionClick(q)">
                <AppIcon name="chat" :size="15" />
                {{ q }}
              </button>
            </div>
            <router-link to="/guide" class="welcome-guide">
              <AppIcon name="star" :size="13" /> 第一次使用？查看使用说明 →
            </router-link>
          </div>

          <!-- 消息列表 -->
          <template v-for="msg in activeMessages" :key="msg.id">
            <div
              v-if="msg.role === 'user'"
              class="row-user fade-in"
              :class="{ flash: flashId === msg.id }"
              :data-mid="msg.id"
            >
              <div class="user-col">
                <div class="bubble-user">
                  <div v-if="msg.attachments?.length" class="ba-list">
                    <span v-for="a in msg.attachments" :key="a.id" class="ba-chip">
                      <img v-if="a.preview" :src="a.preview" class="ba-thumb" alt="附件预览" />
                      <AppIcon v-else :name="UPLOAD_KIND_META[a.kind].icon" :size="11" />
                      <span class="ellipsis">{{ a.name }}</span>
                    </span>
                  </div>
                  <div v-if="msg.content" class="bubble-text">{{ msg.content }}</div>
                </div>
                <!-- 用户消息操作行：与 AI 消息同款（复制 / 引用 / 回滚） -->
                <div class="msg-actions user-actions">
                  <button class="action-btn" title="复制" aria-label="复制提问" @click="copyMessage(msg)"><AppIcon name="copy" :size="14" /></button>
                  <button class="action-btn" title="引用" aria-label="引用提问" @click="quoteFor(msg)"><AppIcon name="quote" :size="14" /></button>
                  <button class="action-btn" title="回滚到此处" aria-label="回滚到此处" @click="askRollback(msg)"><AppIcon name="undo" :size="14" /></button>
                  <span class="msg-time">{{ msg.time }}</span>
                </div>
              </div>
            </div>

            <div v-else class="row-ai fade-in" :data-mid="msg.id">
              <div class="ai-body">
                <!-- 流式等待期（检索 / 外部搜索中，首字未到）：显示阶段文案，绝不渲染无字空框 -->
                <div v-if="!msg.content && viewStage" class="ai-bubble typing">
                  <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
                  <Transition name="stage" mode="out-in">
                    <span :key="viewStage" class="typing-stage">
                      <AppIcon :name="STAGE_ICON[viewStage]" :size="13" />
                      {{ stageText(viewStage) }}…
                    </span>
                  </Transition>
                </div>
                <div v-else class="ai-bubble" v-html="renderAnswer(msg.content)"></div>

                <!-- 校验 / 修正进度：正文已上屏但流水线仍在跑，小字提示避免「像卡住」 -->
                <div v-if="msg.content && (viewStage === 'validating' || viewStage === 'refining') && msg.id === viewStreamingId" class="stream-chip">
                  <AppIcon :name="STAGE_ICON[viewStage]" :size="12" />
                  {{ stageText(viewStage) }}…
                </div>

                <!-- 引用溯源：录音时间戳 / 图片来源 -->
                <div v-if="msg.citations?.length" class="cite-panel">
                  <button class="cite-toggle" @click="toggleCitation(msg.id)">
                    <AppIcon name="link" :size="14" />
                    引用来源 {{ msg.citations.length }}
                    <AppIcon name="chevron-down" :size="13" :style="{ transform: openCitations[msg.id] ? 'rotate(180deg)' : '' }" />
                  </button>
                  <div v-if="openCitations[msg.id]" class="cite-grid">
                    <div v-for="c in msg.citations" :key="c.no" class="cite-card">
                      <div class="cite-head">
                        <span class="cite-no">[{{ c.no }}]</span>
                        <span class="cite-kind" :class="c.kind">
                          <AppIcon :name="citeIcon(c)" :size="12" />
                          {{ citeMarkText(c) }}
                        </span>
                      </div>
                      <div class="cite-meta">
                        <span class="tag tag-gray ellipsis">{{ c.kind === 'external' ? c.mark : c.note }}</span>
                      </div>
                      <p class="cite-snippet">{{ c.snippet }}</p>
                      <a v-if="c.kind === 'external' && c.url" class="cite-link" :href="c.url" target="_blank" rel="noopener" :title="c.url">
                        <AppIcon name="link" :size="12" />
                        <span class="ellipsis">{{ c.url }}</span>
                      </a>
                      <div v-else class="cite-score">
                        <span>相关度</span>
                        <span class="score-segs" role="img" :aria-label="`相关度 ${(c.score * 100).toFixed(0)}%`">
                          <i v-for="n in 10" :key="n" :class="{ on: n <= segLevel(c.score) }"></i>
                        </span>
                        <b>{{ (c.score * 100).toFixed(0) }}%</b>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 追问建议：RAG 依据本条回答生成的下一步可问问题，点击即发送 -->
                <div v-if="msg.followups?.length" class="msg-followups">
                  <button v-for="q in msg.followups" :key="q" class="fu-chip" @click="suggestionClick(q)">
                    <AppIcon name="chat" :size="12" />
                    <span class="ellipsis">{{ q }}</span>
                  </button>
                </div>

                <div class="msg-actions">
                  <button class="action-btn" title="复制" aria-label="复制回答" @click="copyMessage(msg)"><AppIcon name="copy" :size="14" /></button>
                  <button class="action-btn" title="引用" aria-label="引用回答" @click="quoteFor(msg)"><AppIcon name="quote" :size="14" /></button>
                  <button class="action-btn" title="重新生成" aria-label="重新生成" @click="regenerate(msg)"><AppIcon name="refresh" :size="14" /></button>
                  <span class="msg-time">{{ msg.time }}</span>
                </div>
              </div>
            </div>
          </template>

          <!-- AI 处理状态 -->
          <div v-if="isTyping && viewStage" class="row-ai fade-in">
            <div class="ai-bubble typing">
              <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
              <Transition name="stage" mode="out-in">
                <span :key="viewStage" class="typing-stage">
                  <AppIcon :name="STAGE_ICON[viewStage]" :size="13" />
                  {{ stageText(viewStage) }}…
                </span>
              </Transition>
            </div>
          </div>
        </div>

        <!-- 提问记录导航：千问式，悬停展开，点击定位（位于滚动条左侧，不遮挡） -->
        <div v-if="outline.length" class="msg-nav">
          <button class="nav-handle" type="button" title="提问记录导航" aria-label="提问记录导航">
            <AppIcon name="menu" :size="14" />
          </button>
          <div class="nav-list">
            <button
              v-for="o in outline"
              :key="o.id"
              class="nav-item"
              :title="o.text"
              @click="jumpTo(o.id)"
            >{{ o.text }}</button>
          </div>
        </div>

        <!-- 回到底部 -->
        <Transition name="fade-up">
          <button v-if="showToBottom" class="to-bottom" type="button" title="回到最新消息" aria-label="回到最新消息" @click="toBottom">
            <AppIcon name="chevron-down" :size="17" />
          </button>
        </Transition>
      </div>

      <!-- 输入区 -->
      <footer class="composer">
        <div
          class="composer-box"
          :class="{ dragover: attachDragover }"
          @dragenter="onComposerDragEnter"
          @dragover="onComposerDragOver"
          @dragleave="onComposerDragLeave"
          @drop.prevent="onComposerDrop"
        >
          <div v-if="attachDragover" class="drop-overlay">
            <AppIcon name="upload" :size="18" />
            <span>松开以添加附件（音频 / 图片 / 视频 / PPT / 文档，最多 {{ MAX_ATTACH }} 个）</span>
          </div>

          <!-- 左下角“+”：附件类型菜单 -->
          <div ref="attachMenuRoot" class="attach-wrap">
            <button
              type="button"
              class="attach-btn"
              :class="{ active: attachMenuOpen }"
              title="添加附件"
              aria-label="添加附件：上传音频、图片、视频、PPT 或文档"
              @click="toggleAttachMenu"
            >
              <AppIcon name="plus" :size="16" />
            </button>
            <Transition name="drop">
              <div v-if="attachMenuOpen" class="attach-menu" role="menu" aria-label="上传附件">
                <button type="button" class="attach-opt" role="menuitem" @click="pickAttach('image')">
                  <span class="ao-ico tint-mint"><AppIcon name="image" :size="14" /></span>
                  <span class="ao-text">
                    <b>上传图片</b>
                    <i>识别图片内容（板书 / 讲义截图等）</i>
                  </span>
                </button>
                <button type="button" class="attach-opt" role="menuitem" @click="pickAttach('doc')">
                  <span class="ao-ico tint-peach"><AppIcon name="file" :size="14" /></span>
                  <span class="ao-text">
                    <b>上传文档</b>
                    <i>PDF / Word / PPT / 文本，AI 直接阅读作答</i>
                  </span>
                </button>
              </div>
            </Transition>
          </div>

          <div class="composer-mid">
            <!-- 引用条：随下一次提问一并发送 -->
            <div v-if="quoteMsg" class="quote-chip">
              <AppIcon name="quote" :size="12" />
              <span class="quote-who">{{ quoteMsg.role === 'user' ? '引用我的提问' : '引用 AI 回答' }}</span>
              <span class="quote-text ellipsis">{{ quoteMsg.content }}</span>
              <button class="quote-x" aria-label="取消引用" @click="quoteMsg = null"><AppIcon name="x" :size="12" /></button>
            </div>
            <div v-if="attachments.length" class="attach-list">
              <div v-for="a in attachments" :key="a.id" class="attach-chip">
                <img v-if="a.preview" :src="a.preview" class="ac-thumb" alt="图片附件预览" />
                <span v-else class="ac-badge" :class="UPLOAD_KIND_META[a.kind].tint"><AppIcon :name="UPLOAD_KIND_META[a.kind].icon" :size="12" /></span>
                <span class="ac-name ellipsis" :title="a.name">{{ a.name }}</span>
                <span class="ac-size">{{ a.size }}</span>
                <button class="ac-x" :aria-label="'移除附件 ' + a.name" @click="removeAttachment(a.id)"><AppIcon name="x" :size="12" /></button>
              </div>
            </div>
            <textarea
              ref="composerInput"
              v-model="input"
              class="composer-input"
              :placeholder="listening ? '正在聆听，请说话…' : (hasNotes ? '向课堂知识库提问…' : '有任何问题都可以问…') + '（Enter 发送 / Shift+Enter 换行）'"
              rows="1"
              @keydown.enter.exact.prevent="send"
              @paste="onComposerPaste"
            ></textarea>
          </div>

          <button
            type="button"
            class="voice-btn"
            :class="{ listening }"
            :title="listening ? '停止语音输入' : '语音输入'"
            :aria-label="listening ? '停止语音输入' : '语音输入'"
            @click="toggleVoice"
          >
            <AppIcon name="mic" :size="16" />
          </button>
          <button v-if="isTyping || isStreaming" class="send-btn stop" title="停止生成" aria-label="停止生成" @click="stopGenerating">
            <AppIcon name="square" :size="14" />
          </button>
          <button v-else class="send-btn" title="发送" aria-label="发送" :disabled="!input.trim() && !attachments.length" @click="send">
            <AppIcon name="send" :size="16" />
          </button>
        </div>
        <input ref="attachInput" type="file" multiple hidden :accept="attachAccept" @change="onAttachChange" />
        <p v-if="attachTip" class="composer-tip attach-tip"><AppIcon name="alert" :size="12" /> {{ attachTip }}</p>
        <p v-else-if="voiceTip" class="composer-tip voice-tip">{{ voiceTip }}</p>
        <p v-else-if="healthTip" class="composer-tip health-tip"><AppIcon name="shield" :size="12" /> {{ healthTip }}</p>
        <p v-else-if="actionTip" class="composer-tip action-tip"><AppIcon name="check" :size="12" /> {{ actionTip }}</p>
        <p v-else class="composer-tip">{{ hasNotes ? '回答由 AI 基于课堂纪要生成，请以引用原文为准' : '回答由 AI 结合全网资料生成，并标注来源与依据' }}</p>
      </footer>
    </section>

    <!-- 回滚确认：列出将删除的消息数，避免误删 -->
    <div v-if="rollbackTarget" class="modal-mask" @click.self="!rollbackBusy && (rollbackTarget = null)">
      <div class="modal modal-sm">
        <div class="modal-title">回滚到此处</div>
        <p class="modal-sub">
          将删除这条提问及其后的 {{ rollbackTarget.count }} 条消息（含配对回答与追问），对话回到提问前的状态，原问题会填回输入框。此操作不可恢复。
        </p>
        <p v-if="rollbackError" class="rollback-err">{{ rollbackError }}</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" :disabled="rollbackBusy" @click="rollbackTarget = null">取消</button>
          <button class="btn btn-danger" :disabled="rollbackBusy" @click="confirmRollback">{{ rollbackBusy ? '回滚中…' : '确认回滚' }}</button>
        </div>
      </div>
    </div>

    <!-- 删除对话确认 -->
    <div v-if="deleteTarget" class="modal-mask" @click.self="deleteTarget = null">
      <div class="modal modal-sm">
        <div class="modal-title">删除对话</div>
        <p class="modal-sub">确定删除「{{ deleteTarget.title }}」吗？该对话的聊天记录将被清除，此操作不可恢复。</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="deleteTarget = null">取消</button>
          <button class="btn btn-danger" @click="confirmDelete">删除</button>
        </div>
      </div>
    </div>

    <!-- 安全提醒弹窗：违规拦截 / 政治引导 / 健康禁忌 -->
    <SafetyModal :notice="safetyNotice" @close="safetyNotice = null" />
  </div>
</template>

<style scoped>
.chat-shell { display: flex; height: 100%; min-height: 0; overflow: hidden; }

/* ---------- 对话列表 ---------- */
.sessions {
  width: 264px; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px;
  padding: 16px 12px; background: var(--surface); border-right: 1px solid var(--hairline);
  transition: margin-left 0.2s ease, opacity 0.15s ease;
}
.sessions.collapsed { margin-left: -264px; opacity: 0; pointer-events: none; }

.rail-toggle {
  width: 22px; flex-shrink: 0; border: none; cursor: pointer;
  background: var(--surface); border-right: 1px solid var(--hairline);
  color: var(--stone); display: flex; align-items: center; justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}
.rail-toggle:hover { background: var(--tint-lavender); color: var(--primary); }
.search-box {
  display: flex; align-items: center; gap: 8px; padding: 0 10px; height: 36px;
  background: var(--canvas); border: 1px solid var(--hairline); border-radius: var(--radius-md);
  color: var(--stone);
}
.search-input { border: none; outline: none; flex: 1; font-size: 13px; background: transparent; }
/* 常显滚动条（带轨道底色），一眼可见、方便滚动 */
.session-scroll {
  flex: 1; overflow-y: auto; min-height: 0;
  scrollbar-gutter: stable; scrollbar-width: auto;
  scrollbar-color: var(--stone) var(--hairline-soft);
  padding-right: 2px;
}
.session-scroll::-webkit-scrollbar { width: 8px; }
.session-scroll::-webkit-scrollbar-track { background: var(--hairline-soft); border-radius: 4px; }
.session-scroll::-webkit-scrollbar-thumb { background: var(--stone); border-radius: 4px; }
.session-scroll::-webkit-scrollbar-thumb:hover { background: var(--steel); }
.group-label { margin: 10px 6px 6px; }
.session-item {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border-radius: var(--radius-md); font-size: 13px; color: var(--slate);
  cursor: pointer; margin-bottom: 2px; transition: all 0.15s ease;
}
.session-item:hover { background: var(--tint-gray); }
.session-item.active { background: var(--canvas); color: var(--ink); font-weight: 500; box-shadow: 0 1px 2px rgba(15,15,15,0.06); }
.session-item .ellipsis { flex: 1; min-width: 0; }
.session-item.pinned:not(.active) { background: var(--tint-lavender); color: var(--brand-purple-800); }
.session-empty { font-size: 12.5px; color: var(--muted); text-align: center; padding: 20px 0; }

/* 会话悬浮操作：置顶 / 重命名 / 删除 */
.item-actions {
  display: flex; gap: 2px; flex-shrink: 0;
  opacity: 0; transition: opacity 0.15s ease;
}
.session-item:hover .item-actions,
.session-item:focus-within .item-actions { opacity: 1; }
.item-act {
  border: none; background: transparent; color: var(--stone);
  padding: 3px; border-radius: var(--radius-sm); display: flex; cursor: pointer;
  transition: all 0.15s ease;
}
.item-act:hover { background: var(--surface); color: var(--ink); }
.item-act.on { color: var(--primary); }
.item-act.on:hover { background: var(--tint-lavender); }
.item-act.danger:hover { color: #d92d20; background: var(--tint-rose); }

/* 行内重命名输入框 */
.rename-input {
  flex: 1; min-width: 0; border: 1px solid var(--primary); border-radius: var(--radius-sm);
  background: var(--canvas); font-family: inherit; font-size: 13px; color: var(--ink);
  padding: 3px 7px; outline: none; box-shadow: 0 0 0 2px var(--tint-lavender);
}

.kb-notice {
  display: flex; align-items: center; gap: 7px; padding: 9px 10px;
  background: var(--tint-lavender); color: var(--brand-purple-800);
  border-radius: var(--radius-md); font-size: 12px; font-weight: 500;
}

/* ---------- 聊天主区 ---------- */
.chat-main {
  flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--canvas);
  overflow: hidden; /* 悬浮球贴边时裁掉滑出的一半，呈现「隐藏一半」效果 */
}
.chat-head {
  display: flex; align-items: center; gap: 10px; padding: 12px 24px;
  border-bottom: 1px solid var(--hairline-soft); background: var(--canvas);
}
.head-title { font-size: 14px; font-weight: 700; max-width: 50%; }

.messages-wrap { flex: 1; min-height: 0; display: flex; position: relative; }
/* 消息区滚动条：常显（8px 带轨道），右内边距相应收窄保持视觉对称；
   悬浮球的活动范围已避开这 8px 槽位，不会遮挡滚动条 */
.messages {
  flex: 1; min-width: 0; overflow-y: auto; overflow-x: hidden;
  padding: 26px 16px 26px 24px;
  scrollbar-gutter: stable; scrollbar-width: auto;
  scrollbar-color: var(--stone) var(--hairline-soft);
}
.messages::-webkit-scrollbar { width: 8px; }
.messages::-webkit-scrollbar-track { background: var(--hairline-soft); border-radius: 4px; }
.messages::-webkit-scrollbar-thumb { background: var(--stone); border-radius: 4px; }
.messages::-webkit-scrollbar-thumb:hover { background: var(--steel); }
.welcome { max-width: 560px; margin: 8vh auto 0; text-align: center; }
.welcome-logo {
  width: 60px; height: 60px; border-radius: 18px; margin: 0 auto 18px;
  background: var(--brand-navy); color: var(--brand-yellow);
  display: flex; align-items: center; justify-content: center;
}
.sug-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 26px; }
.sug-card {
  display: flex; align-items: center; gap: 8px; text-align: left;
  padding: 13px 15px; border: 1px solid var(--hairline); border-radius: var(--radius-lg);
  background: var(--canvas); font-size: 13px; color: var(--charcoal); transition: all 0.15s ease;
}
.sug-card:hover { border-color: var(--primary); background: var(--tint-lavender); color: var(--brand-purple-800); }
.sug-card svg { color: var(--stone); flex-shrink: 0; }
/* 回答下方追问建议 chips */
.msg-followups { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.fu-chip {
  display: inline-flex; align-items: center; gap: 6px;
  max-width: 100%; padding: 7px 12px; border: 1px solid var(--hairline);
  border-radius: 999px; background: var(--canvas);
  font-size: 13px; color: var(--charcoal); cursor: pointer; transition: all 0.15s ease;
}
.fu-chip:hover { border-color: var(--primary); background: var(--tint-lavender); color: var(--brand-purple-800); }
.fu-chip svg { color: var(--stone); flex-shrink: 0; }
.welcome-guide {
  display: inline-flex; align-items: center; gap: 5px;
  margin-top: 18px; font-size: 13px; font-weight: 500; color: var(--link-blue);
}
.welcome-guide:hover { text-decoration: underline; }

.row-user { display: flex; justify-content: flex-end; margin-bottom: 22px; }
.bubble-user {
  max-width: 100%; background: var(--primary); color: #fff;
  padding: 12px 16px; border-radius: 14px 14px 4px 14px; line-height: 1.6; white-space: pre-wrap;
  overflow-wrap: anywhere; /* 用户粘贴长链接同样不撑破气泡 */
}

.row-ai { margin-bottom: 26px; }
.ai-body { min-width: 0; }
.ai-bubble {
  display: inline-block; max-width: 100%;
  background: var(--surface-soft); border: 1px solid var(--hairline-soft);
  border-radius: 14px; padding: 14px 18px;
  line-height: 1.7; white-space: pre-wrap; color: var(--charcoal); font-size: 14.5px;
  /* 长链接等不可断字符串在气泡内强制换行，避免溢出气泡边框 */
  overflow-wrap: anywhere;
}
/* 来源说明分区（v-html 内容需 :deep）：小字弱化 + 分隔线，与正文区分主次 */
:deep(.src-note) {
  margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--hairline);
  font-size: 12.5px; line-height: 1.8; color: var(--steel);
}
:deep(.src-note-title) { font-weight: 600; color: var(--slate); margin-bottom: 2px; }
:deep(.cite-mark) {
  color: var(--primary); font-weight: 600; cursor: pointer; font-size: 11px;
  background: var(--tint-lavender); border-radius: 4px; padding: 0 3px; margin: 0 1px;
}
.typing { display: flex; align-items: center; gap: 5px; }
.typing-stage {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 13px; color: var(--primary); font-weight: 600; margin-left: 6px;
}
.typing-stage svg { animation: stage-icon-pulse 1.4s ease-in-out infinite; }
@keyframes stage-icon-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.stage-enter-active, .stage-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.stage-enter-from { opacity: 0; transform: translateY(4px); }
.stage-leave-to { opacity: 0; transform: translateY(-4px); }

/* 校验进度小字：正文下方弱化展示（仅 agent 链路校验期间出现） */
.stream-chip {
  display: inline-flex; align-items: center; gap: 5px;
  margin-top: 6px; font-size: 12px; font-weight: 500; color: var(--steel);
}
.stream-chip svg { animation: stage-icon-pulse 1.4s ease-in-out infinite; }

/* ---------- 引用溯源 ---------- */
.cite-panel { margin-top: 10px; }
.cite-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12.5px; font-weight: 600; color: var(--slate);
  background: var(--canvas); border: 1px solid var(--hairline);
  border-radius: var(--radius-full); padding: 5px 12px;
}
.cite-toggle:hover { border-color: var(--primary); color: var(--primary); }
.cite-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; margin-top: 10px; }
.cite-card {
  background: var(--canvas); border: 1px solid var(--hairline);
  border-radius: var(--radius-md); padding: 12px 14px; font-size: 12.5px;
  display: flex; flex-direction: column; /* 等高卡片：片段伸展、底部对齐 */
}
.cite-head { display: flex; align-items: center; gap: 6px; margin-bottom: 7px; }
.cite-no { color: var(--primary); font-weight: 700; flex-shrink: 0; }
.cite-kind {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px; font-weight: 700; border-radius: var(--radius-full); padding: 2.5px 9px;
}
.cite-kind.audio { background: var(--tint-sky); color: var(--link-blue); }
.cite-kind.image { background: var(--tint-mint); color: var(--brand-green); }
.cite-kind.kb { background: var(--tint-peach); color: var(--brand-orange); }
.cite-kind.doc { background: var(--tint-yellow); color: var(--brand-orange); }
.cite-kind.external { background: var(--tint-lavender); color: var(--brand-purple-800); }
.cite-link {
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%; margin-top: auto;
  font-size: 11.5px; font-weight: 600; color: var(--link-blue); text-decoration: none;
  overflow-wrap: anywhere;
}
.cite-link .ellipsis { flex: 1; min-width: 0; }
.cite-link:hover { text-decoration: underline; }
.content-link { color: var(--primary); word-break: break-all; }
.content-link:hover { text-decoration: underline; }
.cite-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.cite-snippet {
  color: var(--slate); line-height: 1.6; margin-bottom: 9px; overflow-wrap: anywhere;
  flex: 1; overflow: hidden; /* 超出 5 行截断，卡片高度整齐 */
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 5;
}
.cite-score { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--steel); margin-top: auto; }
.score-segs { display: inline-flex; gap: 2px; flex: 1; }
.score-segs i { flex: 1; height: 6px; border-radius: 1.5px; background: var(--hairline); }
.score-segs i.on { background: var(--primary); }

/* ---------- 反馈操作条 ---------- */
.msg-actions { display: flex; align-items: center; gap: 4px; margin-top: 8px; }
.action-btn {
  border: none; background: transparent; color: var(--stone);
  padding: 6px; border-radius: var(--radius-sm); display: flex; transition: all 0.15s ease;
}
.action-btn:hover { background: var(--surface); color: var(--ink); }
.action-btn.on { color: var(--primary); background: var(--tint-lavender); }
.msg-time { font-size: 11px; color: var(--muted); margin-left: 6px; }
/* 用户消息操作行：右对齐挂在气泡下（宽度上限移到列容器上） */
.user-col { display: flex; flex-direction: column; align-items: flex-end; max-width: 72%; }
.user-actions { justify-content: flex-end; }

/* 引用条：composer 内待发送的引用消息 */
.quote-chip {
  display: flex; align-items: center; gap: 6px;
  max-width: 100%; margin-bottom: 6px; padding: 5px 10px;
  background: var(--tint-lavender); border-radius: 8px;
  font-size: 12px; color: var(--slate);
}
.quote-chip > svg { flex-shrink: 0; color: var(--primary); }
.quote-who { flex-shrink: 0; font-weight: 600; color: var(--primary); }
.quote-text { flex: 1; min-width: 0; }
.quote-x { flex-shrink: 0; display: flex; cursor: pointer; color: var(--steel); background: none; border: none; padding: 2px; }
.quote-x:hover { color: var(--ink); }

/* 操作提示（复制成功 / 失败等）与回滚报错 */
.action-tip svg { color: var(--primary); }
.rollback-err { font-size: 13px; color: #d92d20; margin-bottom: 10px; }

/* ---------- 输入区 ---------- */
.composer { padding: 14px 24px 16px; border-top: 1px solid var(--hairline); background: var(--canvas); }

@property --beam {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
.composer-box {
  position: relative;
  display: flex; align-items: flex-end; gap: 8px;
  border: 1px solid var(--hairline-strong); border-radius: 16px;
  padding: 10px 12px; background: var(--canvas);
  max-width: 880px; margin: 0 auto;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.composer-box::before {
  content: ''; position: absolute; inset: -1px; border-radius: inherit;
  padding: 1.6px;
  background: conic-gradient(
    from var(--beam),
    rgba(86, 69, 212, 0) 0deg,
    rgba(86, 69, 212, 0) 210deg,
    rgba(123, 63, 242, 0.75) 300deg,
    #5645d4 335deg,
    rgba(86, 69, 212, 0) 360deg
  );
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  opacity: 0; transition: opacity 0.35s ease;
  pointer-events: none;
}
.composer-box:focus-within { border-color: rgba(86, 69, 212, 0.4); box-shadow: 0 0 0 3px var(--tint-lavender); }
.composer-box:focus-within::before { opacity: 1; animation: beam-spin 2.8s linear infinite; }
@keyframes beam-spin { to { --beam: 360deg; } }
.composer-input {
  flex: 1; border: none; outline: none; resize: none; font-family: inherit;
  font-size: 14.5px; line-height: 1.6; max-height: 160px; min-height: 66px;
  background: transparent; color: var(--ink); padding: 4px 2px;
}
.voice-btn {
  border: none; background: transparent; color: var(--steel); padding: 7px;
  border-radius: var(--radius-sm); display: flex; position: relative;
  transition: background 0.15s ease, color 0.15s ease;
}
.voice-btn:hover { background: var(--surface); color: var(--primary); }
.voice-btn.listening { color: #d92d20; }
.voice-btn.listening::after {
  content: ''; position: absolute; inset: 3px; border-radius: 50%;
  border: 2px solid rgba(217, 45, 32, 0.45);
  animation: voice-pulse 1.2s ease-out infinite;
}
@keyframes voice-pulse {
  from { transform: scale(0.75); opacity: 1; }
  to { transform: scale(1.45); opacity: 0; }
}
.send-btn {
  width: 38px; height: 38px; border-radius: var(--radius-md); border: none;
  background: var(--primary); color: #fff; display: flex; align-items: center; justify-content: center;
  transition: background 0.15s ease; flex-shrink: 0;
}
.send-btn:hover:not(:disabled) { background: var(--primary-pressed); }
.send-btn:disabled { background: var(--hairline); color: var(--muted); cursor: not-allowed; }
.send-btn.stop { background: var(--ink-deep); }
.send-btn.stop:hover { background: var(--charcoal); }
.composer-tip { text-align: center; font-size: 11.5px; color: var(--muted); margin-top: 8px; }
.voice-tip { color: var(--link-blue); font-weight: 500; }
.attach-tip { color: var(--error); font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 4px; }

/* ---------- 附件：左下角“+”菜单 / 附件条 / 拖拽高亮 ---------- */
.attach-wrap { position: relative; flex-shrink: 0; }
.attach-btn {
  width: 38px; height: 38px; border: none; cursor: pointer;
  border-radius: var(--radius-md); background: transparent; color: var(--steel);
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}
.attach-btn:hover, .attach-btn.active { background: var(--tint-lavender); color: var(--primary); }
.attach-menu {
  position: absolute; bottom: calc(100% + 10px); left: 0; z-index: 40;
  width: 256px; padding: 5px;
  background: var(--canvas); border: 1px solid var(--hairline);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-modal);
}
.attach-opt {
  display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
  font-family: inherit; border: none; background: transparent; cursor: pointer;
  padding: 8px 9px; border-radius: var(--radius-md); transition: background 0.12s ease;
}
.attach-opt:hover, .attach-opt:focus-visible { background: var(--surface-soft); outline: none; }
.ao-ico {
  width: 30px; height: 30px; border-radius: var(--radius-sm); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.ao-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.ao-text b { font-size: 13px; font-weight: 600; color: var(--ink); }
.ao-text i { font-style: normal; font-size: 11.5px; color: var(--stone); }
.drop-enter-active, .drop-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.drop-enter-from, .drop-leave-to { opacity: 0; transform: translateY(-5px); }

.composer-mid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.attach-list { display: flex; flex-wrap: wrap; gap: 6px; }
.attach-chip {
  display: flex; align-items: center; gap: 6px; max-width: 210px;
  padding: 4px 6px; background: var(--surface-soft); border: 1px solid var(--hairline);
  border-radius: var(--radius-sm); font-size: 12px;
}
.ac-thumb { width: 24px; height: 24px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
.ac-badge {
  width: 24px; height: 24px; border-radius: 4px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.ac-name { font-weight: 500; color: var(--ink); }
.ac-size { color: var(--muted); font-size: 11px; flex-shrink: 0; }
.ac-x {
  border: none; background: transparent; color: var(--stone); padding: 2px;
  border-radius: var(--radius-sm); display: flex; cursor: pointer; flex-shrink: 0;
  transition: all 0.12s ease;
}
.ac-x:hover { color: var(--error); background: #fdecec; }

/* 拖拽文件悬停：输入框高亮 + 覆盖提示 */
.composer-box.dragover { border-color: var(--primary); box-shadow: 0 0 0 3px var(--tint-lavender); }
.drop-overlay {
  position: absolute; inset: 0; z-index: 5; border-radius: inherit;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  background: var(--tint-lavender);
  font-size: 13px; font-weight: 600; color: var(--brand-purple-800);
  pointer-events: none;
}

/* 消息气泡里的附件 */
.ba-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }
.ba-chip {
  display: inline-flex; align-items: center; gap: 5px; max-width: 190px;
  background: rgba(255, 255, 255, 0.16); border-radius: var(--radius-sm);
  padding: 3px 8px; font-size: 12px;
}
.ba-chip .ellipsis { min-width: 0; }
.ba-thumb { width: 22px; height: 22px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }

/* ---------- 回到底部 ---------- */
.to-bottom {
  position: absolute; right: 24px; bottom: 18px; z-index: 5;
  width: 38px; height: 38px; border-radius: 50%;
  background: var(--canvas); border: 1px solid var(--hairline);
  box-shadow: 0 4px 14px rgba(10, 21, 48, 0.14);
  color: var(--slate); display: flex; align-items: center; justify-content: center;
  transition: all 0.15s ease;
}
.to-bottom:hover { color: var(--primary); border-color: var(--primary); box-shadow: 0 4px 16px rgba(86, 69, 212, 0.2); }
.fade-up-enter-active, .fade-up-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.fade-up-enter-from, .fade-up-leave-to { opacity: 0; transform: translateY(8px); }

/* ---------- 提问记录导航（千问式：悬停展开 / 点击定位） ---------- */
/* 固定在消息区右缘 right:16px：常显滚动条占 8px，导航与它之间留 8px 间隙，互不遮挡 */
.msg-nav {
  position: absolute; right: 16px; top: 50%; transform: translateY(-50%);
  z-index: 7; width: 40px; max-height: 72vh;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--canvas); border: 1px solid var(--hairline);
  border-radius: 999px; box-shadow: 0 6px 20px rgba(10, 21, 48, 0.12);
  transition: width 0.22s ease, border-radius 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
  user-select: none;
}
.msg-nav:hover,
.msg-nav:focus-within {
  width: 268px; border-radius: var(--radius-lg);
  border-color: rgba(86, 69, 212, 0.45);
  box-shadow: 0 8px 26px rgba(86, 69, 212, 0.16);
}
.nav-handle {
  width: 40px; height: 40px; flex-shrink: 0;
  border: none; background: transparent; color: var(--stone);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.msg-nav:hover .nav-handle, .msg-nav:focus-within .nav-handle { color: var(--primary); }
.nav-list {
  display: none; width: 268px; flex: 1; min-height: 0;
  overflow-y: auto; padding: 2px 6px 8px;
  scrollbar-width: thin; scrollbar-color: var(--hairline-strong) transparent;
}
.msg-nav:hover .nav-list, .msg-nav:focus-within .nav-list { display: block; }
.nav-item {
  display: block; width: 100%; text-align: left; font-family: inherit;
  font-size: 12.5px; line-height: 1.5; color: var(--slate);
  padding: 7px 10px; border-radius: var(--radius-md); border: none; background: transparent;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transition: all 0.15s ease;
}
.nav-item:hover { background: var(--tint-lavender); color: var(--brand-purple-800); }

/* 导航定位高亮 */
.row-user, .row-ai { scroll-margin-top: 14px; }
@keyframes msg-flash {
  0% { box-shadow: 0 0 0 4px rgba(86, 69, 212, 0.35); }
  100% { box-shadow: 0 0 0 0 rgba(86, 69, 212, 0); }
}
.row-user.flash .bubble-user { animation: msg-flash 1.3s ease-out; }

/* ---------- 删除对话确认弹窗（危险按钮用全局 .btn-danger） ---------- */
.modal-sm { max-width: 420px; }
.modal-sub { color: var(--slate); line-height: 1.7; }

@media (max-width: 900px) {
  .sessions, .rail-toggle { display: none; }
  .sug-grid { grid-template-columns: 1fr; }
  .msg-nav { display: none; }
  .head-title { max-width: 60%; }
}
</style>
