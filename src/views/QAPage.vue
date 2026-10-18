<script setup lang="ts">
/**
 * 智能问答：基于课堂纪要知识库的多轮问答（核心前台）
 * - 左侧：对话列表（新增 / 置顶 / 重命名 / 删除，可关联课堂）+ 搜索 + 常显滚动条（折叠状态持久化）
 * - 右侧：聊天窗口（流式回答 / 录音时间戳与图片来源引用 / 语音输入 / 附件上传）
 * - 提问记录导航：千问式右侧悬浮面板，悬停展开、点击定位，固定在滚动条左侧不遮挡
 * 回答为前端演示，接入真实模型后仅需替换 runStages / streamAnswer 中的回调
 */
import { ref, reactive, nextTick, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import SparkMark from '@/components/SparkMark.vue'
import { classNotes, ensureNotesLoaded } from '@/store/study'
import { isGuest } from '@/store/auth'
import { qaApi, streamAsk, type ApiQaRecord } from '@/api'
import { demoReply, type ChatMessage, type ChatAttachment, type Citation } from '@/mock/data'
import { UPLOAD_ACCEPT, UPLOAD_KIND_META, detectUploadKind, formatFileSize, type UploadKind } from '@/utils/uploadFormats'

const route = useRoute()

// ---------- 对话列表（可关联课堂，也可自由追问） ----------
interface QaSession {
  id: string
  title: string
  noteId?: string // 关联的课堂纪要
  pinned?: boolean
  pinnedAt?: number
}

const qaSessions = ref<QaSession[]>(
  classNotes.value
    .filter((n) => n.status === 'done')
    .map((n) => ({ id: n.id, title: n.title, noteId: n.id }))
)
const sessionSearch = ref('')
const activeSessionId = ref('')
// 会话面板可横向收起 / 展开；折叠状态持久化，跳转其他页面再回来保持上次的开合
const SIDEBAR_KEY = 'zy_qa_sidebar_open'
const sessionsOpen = ref(localStorage.getItem(SIDEBAR_KEY) !== '0')
watch(sessionsOpen, (v) => localStorage.setItem(SIDEBAR_KEY, v ? '1' : '0'))

// 工作台新完成的纪要 → 自动出现为一条对话
watch(
  () => classNotes.value.map((n) => n.id + ':' + n.status).join('|'),
  () => {
    for (const n of classNotes.value) {
      if (n.status === 'done' && !qaSessions.value.some((s) => s.id === n.id)) {
        qaSessions.value.push({ id: n.id, title: n.title, noteId: n.id })
      }
    }
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

// 分组：置顶组在最上（后置顶的排在先置顶的前面），其余按 今天 / 昨天 / 更早
const sessionGroups = computed(() => {
  const q = sessionSearch.value.trim()
  const match = (s: QaSession) => s.title.includes(q)
  const groups: { label: string; items: QaSession[] }[] = []
  const pinned = qaSessions.value
    .filter((s) => s.pinned && match(s))
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
  if (pinned.length) groups.push({ label: '置顶', items: pinned })
  for (const g of ['今天', '昨天', '更早'] as const) {
    const items = qaSessions.value.filter((s) => !s.pinned && match(s) && groupOf(s) === g)
    if (items.length) groups.push({ label: g, items })
  }
  return groups
})

// 徽标：关联课堂显示纪要追问次数，自由对话显示本轮提问数
function badgeCount(s: QaSession): number {
  if (s.noteId) {
    const n = classNotes.value.find((x) => x.id === s.noteId)
    if (n) return n.questions
  }
  const list = messageStore[s.id]
  return list ? list.filter((m) => m.role === 'user').length : 0
}

// ---------- 会话管理：新增 / 置顶 / 重命名 / 删除 ----------
function createSession() {
  const s: QaSession = { id: 'qa' + Date.now(), title: '新的对话' }
  qaSessions.value.unshift(s)
  if (isTyping.value || isStreaming.value) stopGenerating()
  activeSessionId.value = s.id
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
  if (s && t) s.title = t
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
  if (activeSessionId.value === s.id) {
    if (isTyping.value || isStreaming.value) stopGenerating()
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

const activeSession = computed(() => qaSessions.value.find((s) => s.id === activeSessionId.value))
const activeNote = computed(() =>
  activeSession.value?.noteId ? classNotes.value.find((n) => n.id === activeSession.value?.noteId) : undefined
)

// ---------- 历史记录（来自后端问答记录，会话首次切入时拉取一次） ----------
const loadedSessions = new Set<string>()

/** 后端问答记录 → 会话内两条消息（用户提问 + 助手回答） */
function recordToMessages(r: ApiQaRecord): ChatMessage[] {
  const citations: Citation[] = r.references.map((ref, i) => {
    const ext = ref.kind === 'external'
    return {
      no: i + 1,
      kind: ext ? 'external' : ref.time ? 'audio' : 'kb',
      mark: ext ? (ref.label || '外部来源') : ref.time || ref.label,
      note: ext ? '网络检索' : r.note_title,
      snippet: ref.detail,
      score: ext ? 0 : Math.max(0.6, 0.92 - i * 0.08),
      url: ref.url,
    }
  })
  const time = r.created_at.slice(11, 16) || now()
  return [
    { id: 'q' + r.id, role: 'user', content: r.question, time },
    {
      id: 'a' + r.id, role: 'assistant', content: r.answer,
      citations, followups: r.followups, liked: r.liked, qaId: r.id, time,
    },
  ]
}

async function loadHistory(id: string) {
  if (loadedSessions.has(id) || isGuest.value) return
  const s = qaSessions.value.find((x) => x.id === id)
  if (!s?.noteId) return // 自由对话暂无历史
  loadedSessions.add(id)
  try {
    const records = await qaApi.list(s.noteId)
    messagesFor(id).push(...records.flatMap(recordToMessages))
    if (id === activeSessionId.value) scrollToBottom(true)
  } catch {
    loadedSessions.delete(id) // 加载失败：切回该会话时可重试
  }
}

function switchSession(id: string) {
  if (id === activeSessionId.value) return
  if (isTyping.value || isStreaming.value) stopGenerating()
  activeSessionId.value = id
  messagesFor(id)
  void loadHistory(id)
  scrollToBottom(true)
}

// ---------- AI 状态机 ----------
const input = ref('')
const isTyping = ref(false) // 前置阶段
const isStreaming = ref(false) // 逐字输出

type AiStage = 'searching' | 'thinking' | 'composing'
const aiStage = ref<AiStage | null>(null)
const STAGE_TEXT: Record<AiStage, string> = {
  searching: '正在检索课堂知识库',
  thinking: '正在思考',
  composing: '正在组织回答',
}
const STAGE_ICON: Record<AiStage, string> = {
  searching: 'database',
  thinking: 'spark',
  composing: 'edit',
}
const stageTimers: number[] = []
let streamTimer: number | null = null

function clearStageTimers() {
  while (stageTimers.length) {
    const t = stageTimers.pop()
    if (t !== undefined) window.clearTimeout(t)
  }
}

function runStages() {
  aiStage.value = 'searching'
  stageTimers.push(window.setTimeout(() => { aiStage.value = 'thinking' }, 1100))
  stageTimers.push(window.setTimeout(() => { aiStage.value = 'composing' }, 2400))
  stageTimers.push(window.setTimeout(() => { streamAnswer() }, 3300))
}

// 流式等待期状态：正式消息气泡已创建但首字未到（检索 / 外部搜索耗时不定），
// 必须持续显示阶段文案，绝不能渲染成无字空框；阶段在思考 / 组织间轮换表示活跃
const streamStage = ref<AiStage | null>(null)
let stageCycle: number | null = null

function stopStageCycle() {
  if (stageCycle !== null) { window.clearInterval(stageCycle); stageCycle = null }
}

function startStageCycle() {
  stopStageCycle()
  stageCycle = window.setInterval(() => {
    streamStage.value = streamStage.value === 'thinking' ? 'composing' : 'thinking'
  }, 3500)
}

function stopGenerating() {
  clearStageTimers()
  stopStageCycle()
  if (streamTimer) { window.clearInterval(streamTimer); streamTimer = null }
  isTyping.value = false
  isStreaming.value = false
  aiStage.value = null
  streamStage.value = null
}

// 把当前对话关联课堂的纪要标题代入演示回答（更贴近真实观感）
function buildReply() {
  const note = activeNote.value
  if (!note) return demoReply
  const prefix = `根据「${note.title}」的课堂纪要与转写稿，回答如下：\n\n`
  return { content: prefix + demoReply.content, citations: demoReply.citations as Citation[] }
}

// 引用标记 [1] → 上标
function renderContent(text: string) {
  return text.replace(/\[(\d+)\]/g, '<sup class="cite-mark">[$1]</sup>')
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
}
const MAX_ATTACH = 8

const ATTACH_MENU: { kind: AttachKind; label: string; hint: string }[] = [
  { kind: 'image', label: '上传图片', hint: 'jpg / png / webp / gif' },
  { kind: 'ppt', label: '上传 PPT', hint: 'ppt / pptx 演示文稿' },
  { kind: 'audio', label: '上传音频', hint: 'mp3 / wav / m4a 等' },
  { kind: 'video', label: '上传视频', hint: 'mp4 / mov / mkv 等' },
  { kind: 'doc', label: '更多格式文档', hint: 'pdf / word / excel / 压缩包等' },
]

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

function pickAttach(kind: AttachKind) {
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
  for (const f of Array.from(list)) {
    // 最多同时添加 MAX_ATTACH 个附件（相同或不同格式合计），超出部分给出提示
    if (attachments.value.length >= MAX_ATTACH) {
      flashAttachTip(`最多同时上传 ${MAX_ATTACH} 个文件，超出部分未添加`)
      break
    }
    const kind = detectUploadKind(f.name)
    if (!kind) continue
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
    })
    accepted++
  }
  if (accepted === 0 && attachments.value.length < MAX_ATTACH) {
    flashAttachTip(dupCount > 0 ? '所选文件已在附件中' : '仅支持音频、图片、视频、PPT 与文档格式')
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
/** SSE 流式问答缓冲：后端增量实时写入 text，streamAnswer 以打字速度追赶展示 */
interface AskBuf {
  text: string
  error: string | null
  record: ApiQaRecord | null
}
let askBuf: AskBuf | null = null
let askPromise: Promise<void> | null = null

function send() {
  const text = input.value.trim()
  if ((!text && !attachments.value.length) || isTyping.value || isStreaming.value || !activeSessionId.value) return

  messagesFor(activeSessionId.value).push({
    id: 'u' + Date.now(),
    role: 'user',
    content: text,
    attachments: attachments.value.length ? (attachments.value.map((a) => ({ ...a })) as ChatAttachment[]) : undefined,
    time: now(),
  })
  // 附件随消息发出（预览地址由消息继续持有展示），输入区清空
  attachments.value = []
  input.value = ''
  scrollToBottom()
  askQuestion(text)
}

/** 提问：阶段动画进行的同时发起 SSE 流式请求，增量先落缓冲，动画结束后边收边显 */
function askQuestion(text: string) {
  isTyping.value = true
  runStages()
  if (isGuest.value) {
    askPromise = null // 游客态回退到本地演示回答
    askBuf = null
    return
  }
  const buf: AskBuf = { text: '', error: null, record: null }
  askBuf = buf
  askPromise = streamAsk(activeSession.value?.noteId ?? null, text, buf)
    .then((record) => {
      buf.record = record
      if (record) {
        const note = activeNote.value
        if (note) note.questions++ // 会话角标即时 +1（下次拉取与后端计数对齐）
      }
    })
    .catch(() => {
      if (!buf.error) buf.error = '网络异常，请稍后再试'
    })
}

async function streamAnswer() {
  isStreaming.value = true
  isTyping.value = false // 前置气泡切到正式消息气泡，等待期状态由 streamStage 接管
  streamStage.value = aiStage.value || 'composing'
  startStageCycle()
  const msg: ChatMessage = reactive({
    id: 'a' + Date.now(),
    role: 'assistant',
    content: '',
    time: now(),
  })
  if (activeSessionId.value) messagesFor(activeSessionId.value).push(msg)
  scrollToBottom()

  const pending = askPromise
  const buf = askBuf
  askPromise = null
  askBuf = null

  // 游客 / 请求未发出：本地演示回答按原逐字节奏输出
  if (!pending || !buf) {
    const reply = buildReply()
    msg.citations = reply.citations
    let i = 0
    const timer = window.setInterval(() => {
      i += 2 + Math.floor(Math.random() * 3)
      msg.content = reply.content.slice(0, i)
      if (i >= reply.content.length) {
        window.clearInterval(timer)
        streamTimer = null
        streamStage.value = null
        stopStageCycle()
        isStreaming.value = false
        scrollToBottom()
      }
    }, 30)
    streamTimer = timer
    return
  }

  // 真流式：展示进度追赶 SSE 缓冲；流结束后落引用 / 追问 / 点赞态
  let reveal = 0
  let settled = false
  void pending.then(() => {
    settled = true
  })
  const timer = window.setInterval(() => {
    if (reveal < buf.text.length) {
      reveal = Math.min(buf.text.length, reveal + 2 + Math.floor(Math.random() * 3))
      msg.content = buf.text.slice(0, reveal)
      scrollToBottom()
      return
    }
    if (!settled) return // 回答还没收完：继续等下一个增量（气泡内持续显示阶段文案）
    window.clearInterval(timer)
    streamTimer = null
    streamStage.value = null
    stopStageCycle()
    if (buf.error) {
      msg.content = `回答生成失败：${buf.error}`
    } else {
      const r = buf.record
      if (r) {
        msg.citations = r.references.map((ref, i) => {
          const ext = ref.kind === 'external'
          return {
            no: i + 1,
            kind: ext ? 'external' : ref.time ? 'audio' : 'kb',
            mark: ext ? (ref.label || '外部来源') : ref.time || ref.label,
            note: ext ? '网络检索' : r.note_title,
            snippet: ref.detail,
            score: ext ? 0 : Math.max(0.6, 0.92 - i * 0.08),
            url: ref.url,
          }
        })
        msg.liked = r.liked
        msg.qaId = r.id
        if (r.followups?.length) msg.followups = r.followups
      }
    }
    isStreaming.value = false
    scrollToBottom()
  }, 30)
  streamTimer = timer
}

function regenerate(msg: ChatMessage) {
  if (isStreaming.value || isTyping.value || !activeSessionId.value) return
  const list = messagesFor(activeSessionId.value)
  const idx = list.indexOf(msg)
  const question = [...list.slice(0, idx)].reverse().find((m) => m.role === 'user')?.content ?? ''
  list.splice(idx, 1)
  askQuestion(question) // 重新提问（后端生成一条新记录）
}

function toggleLike(msg: ChatMessage, liked: boolean) {
  msg.liked = liked ? !msg.liked : false
  msg.disliked = !liked ? !msg.disliked : false
  // 点赞同步到后端（后端为切换语义）；点踩仅本地记录
  if (msg.qaId) {
    void qaApi.like(msg.qaId).then((r) => { msg.liked = r.liked }).catch(() => {})
  }
}

function copyMessage(msg: ChatMessage) {
  navigator.clipboard?.writeText(msg.content)
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
  if (c.kind === 'kb') return 'file'
  return 'image'
}
function citeMarkText(c: Citation) {
  if (c.kind === 'audio') return `录音 ${c.mark}`
  if (c.kind === 'external') return '外部来源'
  return c.mark
}

// ---------- 建议 ----------
// 兜底推荐：游客态 / 接口失败 / 后端暂无个性化数据时使用
const FALLBACK_SUGGESTIONS = ['帮我总结上一节课的重点', '泰勒展开有哪些易错点？', '进程和线程的区别是什么？', '二叉树的四种遍历怎么背？']
// 个性化追问：登录后由后端按「近期提问」生成（后端未配模型 key 时为规则版），失败静默回退兜底
const personalized = ref<string[] | null>(null)
const suggestions = computed(() => {
  const t = activeNote.value?.title
  if (t) return [`「${t}」的重点是什么？`, '这节课布置了什么作业？', '把老师强调的考点整理一下', '老师课上回答过哪些问题？']
  return personalized.value ?? FALLBACK_SUGGESTIONS
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
  await ensureNotesLoaded()
  // 拉取个性化追问建议（游客态跳过；失败静默保留兜底文案）
  if (!isGuest.value) {
    qaApi.suggestions()
      .then((d) => {
        if (Array.isArray(d.suggestions) && d.suggestions.length) personalized.value = d.suggestions
      })
      .catch(() => {})
  }
  // note 对话按最新纪要列表补齐（watch 为异步触发，这里先行补齐一次）
  for (const n of classNotes.value) {
    if (n.status === 'done' && !qaSessions.value.some((s) => s.id === n.id)) {
      qaSessions.value.push({ id: n.id, title: n.title, noteId: n.id })
    }
  }
  const q = route.query.note
  const id = typeof q === 'string' ? q : ''
  const exists = qaSessions.value.some((s) => s.id === id)
  activeSessionId.value = exists ? id : (qaSessions.value[0]?.id ?? '')
  if (activeSessionId.value) void loadHistory(activeSessionId.value)
  nextTick(() => scrollToBottom(true))
})

onBeforeUnmount(() => {
  clearStageTimers()
  if (streamTimer) window.clearInterval(streamTimer)
  if (flashTimer) window.clearTimeout(flashTimer)
  if (attachTipTimer) window.clearTimeout(attachTipTimer)
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKey)
  revokeAllAttachPreviews()
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
            <AppIcon v-if="s.pinned && editId !== s.id" name="pin" :size="12" class="pin-badge" />
            <span v-if="editId !== s.id" class="qa-count" title="追问次数">{{ badgeCount(s) }}</span>
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
          <span class="tag tag-purple">{{ activeNote ? activeNote.course : '自由追问' }}</span>
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
            <h2 class="h2">针对课堂内容，想问点什么？</h2>
            <p class="text-md muted">回答基于课堂纪要、转写稿与板书生成，每句话都能溯源到录音时间点或图片。</p>
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
            </div>

            <div v-else class="row-ai fade-in" :data-mid="msg.id">
              <div class="ai-body">
                <!-- 流式等待期（检索 / 外部搜索中，首字未到）：显示阶段文案，绝不渲染无字空框 -->
                <div v-if="!msg.content && streamStage" class="ai-bubble typing">
                  <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
                  <Transition name="stage" mode="out-in">
                    <span :key="streamStage" class="typing-stage">
                      <AppIcon :name="STAGE_ICON[streamStage]" :size="13" />
                      {{ STAGE_TEXT[streamStage] }}…
                    </span>
                  </Transition>
                </div>
                <div v-else class="ai-bubble" v-html="renderContent(msg.content)"></div>

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
                      <a v-if="c.kind === 'external' && c.url" class="cite-link" :href="c.url" target="_blank" rel="noopener">
                        <AppIcon name="link" :size="12" />
                        打开原文
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
                  <button class="action-btn" :class="{ on: msg.liked }" title="有用" aria-label="有用" @click="toggleLike(msg, true)">
                    <AppIcon name="thumbs-up" :size="14" />
                  </button>
                  <button class="action-btn" :class="{ on: msg.disliked }" title="无用" aria-label="无用" @click="toggleLike(msg, false)">
                    <AppIcon name="thumbs-down" :size="14" />
                  </button>
                  <button class="action-btn" title="复制" aria-label="复制回答" @click="copyMessage(msg)"><AppIcon name="copy" :size="14" /></button>
                  <button class="action-btn" title="重新生成" aria-label="重新生成" @click="regenerate(msg)"><AppIcon name="refresh" :size="14" /></button>
                  <span class="msg-time">{{ msg.time }}</span>
                </div>
              </div>
            </div>
          </template>

          <!-- AI 处理状态 -->
          <div v-if="isTyping && aiStage" class="row-ai fade-in">
            <div class="ai-bubble typing">
              <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
              <Transition name="stage" mode="out-in">
                <span :key="aiStage" class="typing-stage">
                  <AppIcon :name="STAGE_ICON[aiStage]" :size="13" />
                  {{ STAGE_TEXT[aiStage] }}…
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
              <div v-if="attachMenuOpen" class="attach-menu" role="menu" aria-label="选择附件类型">
                <button
                  v-for="m in ATTACH_MENU"
                  :key="m.kind"
                  type="button"
                  class="attach-opt"
                  role="menuitem"
                  @click="pickAttach(m.kind)"
                >
                  <span class="ao-ico" :class="UPLOAD_KIND_META[m.kind].tint"><AppIcon :name="UPLOAD_KIND_META[m.kind].icon" :size="14" /></span>
                  <span class="ao-text">
                    <b>{{ m.label }}</b>
                    <i>{{ m.hint }}</i>
                  </span>
                </button>
              </div>
            </Transition>
          </div>

          <div class="composer-mid">
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
              v-model="input"
              class="composer-input"
              :placeholder="listening ? '正在聆听，请说话…' : '向课堂知识库提问…（Enter 发送 / Shift+Enter 换行）'"
              rows="1"
              @keydown.enter.exact.prevent="send"
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
        <p v-else class="composer-tip">回答由 AI 基于课堂纪要生成，请以引用原文为准</p>
      </footer>
    </section>

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
.pin-badge { color: var(--primary); flex-shrink: 0; }
.session-item:hover .pin-badge { display: none; }
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

/* 追问次数徽标：悬浮操作出现时让位隐藏，避免拥挤 */
.qa-count {
  flex-shrink: 0; min-width: 20px; height: 18px; padding: 0 5px;
  border-radius: 9px; background: var(--hairline-soft); color: var(--steel);
  font-size: 10.5px; font-weight: 600; line-height: 18px; text-align: center;
}
.session-item.active .qa-count { background: var(--tint-lavender); color: var(--primary); }
.session-item:hover .qa-count { display: none; }

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
  flex: 1; min-width: 0; overflow-y: auto;
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
  max-width: 72%; background: var(--primary); color: #fff;
  padding: 12px 16px; border-radius: 14px 14px 4px 14px; line-height: 1.6; white-space: pre-wrap;
}

.row-ai { margin-bottom: 26px; }
.ai-body { min-width: 0; }
.ai-bubble {
  display: inline-block; max-width: 100%;
  background: var(--surface-soft); border: 1px solid var(--hairline-soft);
  border-radius: 14px; padding: 14px 18px;
  line-height: 1.7; white-space: pre-wrap; color: var(--charcoal); font-size: 14.5px;
}
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
.cite-kind.external { background: var(--tint-lavender); color: var(--brand-purple-800); }
.cite-link {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px; font-weight: 600; color: var(--link-blue); text-decoration: none;
}
.cite-link:hover { text-decoration: underline; }
.cite-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.cite-snippet { color: var(--slate); line-height: 1.6; margin-bottom: 9px; }
.cite-score { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--steel); }
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
