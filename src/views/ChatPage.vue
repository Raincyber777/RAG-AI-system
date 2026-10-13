<script setup lang="ts">
/**
 * 板块一：智能对话交互区（核心前台）
 * - 左侧：历史会话列表 + 新建对话
 * - 右侧：聊天窗口（多模态输入 / 流式回答 / 引用溯源 / 点赞点踩 / 重新生成）
 */
import { ref, reactive, nextTick, computed, onMounted, onBeforeUnmount } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import {
  sessions as mockSessions,
  initialMessages,
  demoReply,
  type ChatMessage,
  type Session,
} from '@/mock/data'

// ---------- 会话列表 ----------
const sessions = ref<Session[]>([...mockSessions])
const sessionSearch = ref('')
const activeSessionId = ref('s1')
const sessionsOpen = ref(false) // 会话面板默认折叠，点击 rail 标志展开

// 会话分组：置顶组在最上（后置顶的排在先置顶的前面），其余按 今天/昨天/更早
const sessionGroups = computed(() => {
  const q = sessionSearch.value.trim()
  const match = (s: Session) => s.title.includes(q)
  const groups: { label: string; items: Session[] }[] = []
  const pinned = sessions.value
    .filter((s) => s.pinned && match(s))
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
  if (pinned.length) groups.push({ label: '置顶', items: pinned })
  for (const g of ['今天', '昨天', '更早'] as const) {
    const items = sessions.value.filter((s) => !s.pinned && s.group === g && match(s))
    if (items.length) groups.push({ label: g, items })
  }
  return groups
})

// 会话重命名（行内编辑）
const editId = ref<string | null>(null)
const editTitle = ref('')

function startRename(s: Session) {
  editId.value = s.id
  editTitle.value = s.title
  nextTick(() => {
    const el = document.querySelector('.rename-input') as HTMLInputElement | null
    el?.focus()
    el?.select()
  })
}
function commitRename() {
  const s = sessions.value.find((x) => x.id === editId.value)
  const t = editTitle.value.trim()
  if (s && t) s.title = t
  editId.value = null
}
function cancelRename() {
  editId.value = null
}

// 置顶 / 取消置顶（记录时间戳，后置顶靠前）
function togglePin(s: Session) {
  if (s.pinned) {
    s.pinned = false
    s.pinnedAt = undefined
  } else {
    s.pinned = true
    s.pinnedAt = Date.now()
  }
}

// 删除会话；若删除的是当前会话则自动切到剩余的第一个
function removeSession(s: Session) {
  const idx = sessions.value.indexOf(s)
  if (idx !== -1) sessions.value.splice(idx, 1)
  if (activeSessionId.value === s.id) {
    const first = sessions.value[0]
    if (first) activeSessionId.value = first.id
    else {
      activeSessionId.value = ''
      messages.value = []
    }
  }
}

function createSession() {
  const s: Session = { id: 's' + Date.now(), title: '新的对话', group: '今天' }
  sessions.value.unshift(s)
  activeSessionId.value = s.id
  messages.value = []
}

// ---------- 消息 ----------
const messages = ref<ChatMessage[]>(initialMessages.map((m) => ({ ...m })))
const input = ref('')
const isTyping = ref(false) // AI 正在生成（前置阶段）
const isStreaming = ref(false) // 正在逐字输出
const uploading = ref<string[]>([]) // 已附加的文件名

// AI 处理阶段：检索知识库 → 思考 → 组织回答（接入真实模型后直接复用这套状态）
type AiStage = 'searching' | 'thinking' | 'composing'
const aiStage = ref<AiStage | null>(null)
const STAGE_TEXT: Record<AiStage, string> = {
  searching: '正在检索知识库',
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

// 依次推进 AI 状态，最后进入流式输出
function runStages(files: string[]) {
  aiStage.value = 'searching'
  stageTimers.push(window.setTimeout(() => { aiStage.value = 'thinking' }, 1100))
  stageTimers.push(window.setTimeout(() => { aiStage.value = 'composing' }, 2400))
  stageTimers.push(window.setTimeout(() => {
    isTyping.value = false
    aiStage.value = null
    streamAnswer(files)
  }, 3300))
}

// 中断生成：停止状态推进与流式输出，保留已生成内容
function stopGenerating() {
  clearStageTimers()
  if (streamTimer) { window.clearInterval(streamTimer); streamTimer = null }
  isTyping.value = false
  isStreaming.value = false
  aiStage.value = null
}

const suggestions = [
  'RAG 系统的核心工作流程是什么？',
  '新员工报销流程怎么走？',
  '年假有几天，未休完怎么处理？',
  '向量数据库应该如何选型？',
]

// 把 [1] 引用标记渲染为上标
function renderContent(text: string) {
  return text.replace(
    /\[(\d+)\]/g,
    '<sup class="cite-mark">[$1]</sup>'
  )
}

const messagesEl = ref<HTMLDivElement>()
function scrollToBottom() {
  nextTick(() => {
    const el = messagesEl.value
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  })
}

// 回到底部按钮：往上翻超过一屏高度时出现
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

// 千问式对话导航：悬浮展开提问列表，点击定位到对应消息
const navOpen = ref(false)
const flashId = ref('')
let flashTimer: number | null = null
const outline = computed(() =>
  messages.value
    .filter((m) => m.role === 'user')
    .map((m) => ({ id: m.id, text: m.content }))
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

// 发送消息
function send() {
  const text = input.value.trim()
  if ((!text && uploading.value.length === 0) || isTyping.value || isStreaming.value) return

  const files = [...uploading.value]
  // 用户消息
  messages.value.push({
    id: 'u' + Date.now(),
    role: 'user',
    content: text || `请帮我解答与「${files.join('、')}」相关的问题`,
    time: now(),
  })
  uploading.value = []
  input.value = ''
  scrollToBottom()

  // AI 状态流转：检索 → 思考 → 组织回答 → 流式输出
  isTyping.value = true
  runStages(files)
}

// 模拟流式回答
function streamAnswer(files: string[] = []) {
  isStreaming.value = true
  const reply = { ...demoReply }
  const full = files.length
    ? `已收到您上传的 ${files.length} 个文件（${files.join('、')}），正在解析并建立向量索引，完成后即可针对该文档提问。\n\n` + reply.content
    : reply.content

  const msg: ChatMessage = reactive({
    id: 'a' + Date.now(),
    role: 'assistant',
    content: '',
    citations: reply.citations,
    time: now(),
  })
  messages.value.push(msg)
  scrollToBottom()

  let i = 0
  const timer = window.setInterval(() => {
    i += 2 + Math.floor(Math.random() * 3)
    msg.content = full.slice(0, i)
    if (i >= full.length) {
      window.clearInterval(timer)
      streamTimer = null
      isStreaming.value = false
      scrollToBottom()
    }
  }, 30)
  streamTimer = timer
}

function regenerate(msg: ChatMessage) {
  if (isStreaming.value || isTyping.value) return
  const idx = messages.value.indexOf(msg)
  messages.value.splice(idx, 1)
  streamAnswer()
}

function toggleLike(msg: ChatMessage, liked: boolean) {
  msg.liked = liked ? !msg.liked : false
  msg.disliked = !liked ? !msg.disliked : false
}

function copyMessage(msg: ChatMessage) {
  navigator.clipboard?.writeText(msg.content)
}

// 附件选择 + 拖拽上传
const ACCEPT_EXTS = ['pdf', 'doc', 'docx', 'md', 'txt', 'xlsx', 'pptx']
const fileInput = ref<HTMLInputElement>()
function pickFiles() {
  fileInput.value?.click()
}

// 校验并加入附件（点击选择与拖拽共用）
function addFiles(list: FileList | File[] | null) {
  if (!list) return
  for (const f of Array.from(list)) {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    if (!ACCEPT_EXTS.includes(ext)) continue
    if (f.size > 20 * 1024 * 1024) continue
    uploading.value.push(f.name)
  }
}

function onFilesChosen(e: Event) {
  addFiles((e.target as HTMLInputElement).files)
  ;(e.target as HTMLInputElement).value = ''
}

// 拖拽上传：拖入输入区高亮，松手添加为附件
const dragOver = ref(false)
let dragDepth = 0

function onDragEnter(e: DragEvent) {
  if (!e.dataTransfer?.types.includes('Files')) return
  dragDepth++
  dragOver.value = true
}
function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragOver.value = false
}
function onDrop(e: DragEvent) {
  dragDepth = 0
  dragOver.value = false
  addFiles(e.dataTransfer?.files ?? null)
}

// 防止把文件拖到输入区以外时浏览器直接打开文件
function preventWindowDrop(e: DragEvent) {
  e.preventDefault()
}
onMounted(() => {
  window.addEventListener('dragover', preventWindowDrop)
  window.addEventListener('drop', preventWindowDrop)
})
onBeforeUnmount(() => {
  window.removeEventListener('dragover', preventWindowDrop)
  window.removeEventListener('drop', preventWindowDrop)
})

// 语音输入（Web Speech API，需 HTTPS 环境，后续配好证书即可用）
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

// 展开某条消息的引用面板
const openCitations = reactive<Record<string, boolean>>({})
function toggleCitation(id: string) {
  openCitations[id] = !openCitations[id]
}

// 相关度 → 10 段刻度（扁平分段，避免渐变条的 AI 感）
function segLevel(score: number) {
  return Math.min(10, Math.max(1, Math.round(score * 10)))
}

function now() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function suggestionClick(q: string) {
  input.value = q
  send()
}
</script>

<template>
  <div class="chat-shell">
    <!-- 左侧会话列表（默认折叠，可通过 rail 标志展开） -->
    <aside class="sessions" :class="{ collapsed: !sessionsOpen }">
      <button class="btn btn-primary btn-block" @click="createSession">
        <AppIcon name="plus" :size="16" /> 新建对话
      </button>
      <div class="search-box">
        <AppIcon name="search" :size="15" />
        <input v-model="sessionSearch" placeholder="搜索会话" class="search-input" />
      </div>

      <div class="session-scroll">
        <template v-for="g in sessionGroups" :key="g.label">
          <div class="text-uppercase group-label">{{ g.label }}</div>
          <div
            v-for="s in g.items"
            :key="s.id"
            class="session-item"
            :class="{ active: s.id === activeSessionId, pinned: s.pinned }"
            @click="activeSessionId = s.id"
          >
            <AppIcon name="chat" :size="14" />
            <input
              v-if="editId === s.id"
              v-model="editTitle"
              class="rename-input"
              aria-label="重命名会话"
              @click.stop
              @keydown.enter.prevent="commitRename"
              @keydown.esc="cancelRename"
              @blur="commitRename"
            />
            <span v-else class="ellipsis">{{ s.title }}</span>
            <AppIcon v-if="s.pinned && editId !== s.id" name="pin" :size="12" class="pin-badge" />
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
              <button class="item-act danger" title="删除" aria-label="删除" @click.stop="removeSession(s)">
                <AppIcon name="trash" :size="13" />
              </button>
            </span>
          </div>
        </template>
        <div v-if="sessionGroups.length === 0" class="session-empty">没有匹配的会话</div>
      </div>

      <div class="kb-notice">
        <AppIcon name="database" :size="15" />
        <span>已接入 4 个知识空间 · 108 篇文档</span>
      </div>
    </aside>

    <!-- 会话面板折叠标志（横向收起 / 展开） -->
    <button
      class="rail-toggle"
      :title="sessionsOpen ? '收起会话列表' : '展开会话列表'"
      :aria-label="sessionsOpen ? '收起会话列表' : '展开会话列表'"
      @click="sessionsOpen = !sessionsOpen"
    >
      <AppIcon :name="sessionsOpen ? 'chevron-left' : 'chevron-right'" :size="14" />
    </button>

    <!-- 右侧聊天窗口 -->
    <section class="chat-main">
      <!-- 消息区 -->
      <div class="messages-wrap">
        <div ref="messagesEl" class="messages" @scroll.passive="onMessagesScroll">
        <!-- 空状态：欢迎 + 推荐问题 -->
        <div v-if="messages.length === 0" class="welcome fade-in">
          <div class="welcome-logo"><AppIcon name="spark" :size="30" /></div>
          <h2 class="h2">您好，我是智源助手</h2>
          <p class="text-md muted">所有回答均基于您的知识库生成，并附上引用来源，放心查阅。</p>
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
        <template v-for="msg in messages" :key="msg.id">
          <!-- 用户消息 -->
          <div
            v-if="msg.role === 'user'"
            class="row-user fade-in"
            :class="{ flash: flashId === msg.id }"
            :data-mid="msg.id"
          >
            <div class="bubble-user">{{ msg.content }}</div>
          </div>

          <!-- AI 消息 -->
          <div v-else class="row-ai fade-in" :data-mid="msg.id">
            <div class="ai-body">
              <div class="ai-bubble" v-html="renderContent(msg.content)"></div>

              <!-- 引用溯源（RAG 的灵魂） -->
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
                      <span class="cite-doc ellipsis">{{ c.doc }}</span>
                    </div>
                    <div class="cite-meta">
                      <span class="tag tag-gray">{{ c.space }}</span>
                      <span class="cite-chunk">{{ c.chunk }}</span>
                    </div>
                    <p class="cite-snippet">{{ c.snippet }}</p>
                    <div class="cite-score">
                      <span>相关度</span>
                      <span class="score-segs" role="img" :aria-label="`相关度 ${(c.score * 100).toFixed(0)}%`">
                        <i v-for="n in 10" :key="n" :class="{ on: n <= segLevel(c.score) }"></i>
                      </span>
                      <b>{{ (c.score * 100).toFixed(0) }}%</b>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 反馈操作条 -->
              <div class="msg-actions">
                <button
                  class="action-btn"
                  :class="{ on: msg.liked }"
                  title="有用"
                  aria-label="有用"
                  @click="toggleLike(msg, true)"
                ><AppIcon name="thumbs-up" :size="14" /></button>
                <button
                  class="action-btn"
                  :class="{ on: msg.disliked }"
                  title="无用"
                  aria-label="无用"
                  @click="toggleLike(msg, false)"
                ><AppIcon name="thumbs-down" :size="14" /></button>
                <button class="action-btn" title="复制" aria-label="复制回答" @click="copyMessage(msg)"><AppIcon name="copy" :size="14" /></button>
                <button class="action-btn" title="重新生成" aria-label="重新生成" @click="regenerate(msg)"><AppIcon name="refresh" :size="14" /></button>
                <span class="msg-time">{{ msg.time }}</span>
              </div>
            </div>
          </div>
        </template>

        <!-- AI 处理状态（检索 → 思考 → 组织回答） -->
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

        <!-- 千问式对话导航：悬浮展开提问列表，点击定位 -->
        <div
          v-if="outline.length"
          class="msg-nav"
          :class="{ open: navOpen }"
          @mouseenter="navOpen = true"
          @mouseleave="navOpen = false"
        >
          <button class="nav-handle" type="button" title="对话记录导航" aria-label="对话记录导航">
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
          <button
            v-if="showToBottom"
            class="to-bottom"
            type="button"
            title="回到最新消息"
            aria-label="回到最新消息"
            @click="toBottom"
          >
            <AppIcon name="chevron-down" :size="17" />
          </button>
        </Transition>
      </div>

      <!-- 输入区（支持把文件直接拖进来） -->
      <footer
        class="composer"
        @dragenter.prevent="onDragEnter"
        @dragover.prevent
        @dragleave="onDragLeave"
        @drop.prevent="onDrop"
      >
        <div v-if="uploading.length" class="attach-list">
          <span v-for="f in uploading" :key="f" class="attach-chip">
            <AppIcon name="file" :size="13" /> {{ f }}
            <button class="attach-x" @click="uploading = uploading.filter((x) => x !== f)"><AppIcon name="x" :size="11" /></button>
          </span>
        </div>
        <div class="composer-box" :class="{ dragging: dragOver }">
          <button class="attach-btn" title="上传文件提问" aria-label="上传文件提问" @click="pickFiles"><AppIcon name="paperclip" :size="18" /></button>
          <input ref="fileInput" type="file" multiple hidden accept=".pdf,.doc,.docx,.md,.txt,.xlsx,.pptx" @change="onFilesChosen" />
          <textarea
            v-model="input"
            class="composer-input"
            :placeholder="listening ? '正在聆听，请说话…' : '向智源助手提问…（Enter 发送 / Shift+Enter 换行）'"
            rows="1"
            @keydown.enter.exact.prevent="send"
          ></textarea>
          <!-- 语音输入 -->
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
          <!-- 生成中显示中断按钮，否则显示发送按钮 -->
          <button
            v-if="isTyping || isStreaming"
            class="send-btn stop"
            title="停止生成"
            aria-label="停止生成"
            @click="stopGenerating"
          >
            <AppIcon name="square" :size="14" />
          </button>
          <button
            v-else
            class="send-btn"
            title="发送"
            aria-label="发送"
            :disabled="!input.trim() && !uploading.length"
            @click="send"
          >
            <AppIcon name="send" :size="16" />
          </button>
        </div>
        <p v-if="dragOver" class="composer-tip drag-tip">松开鼠标即可添加为附件（单个文件不超过 20MB）</p>
        <p v-else-if="voiceTip" class="composer-tip voice-tip">{{ voiceTip }}</p>
        <p v-else class="composer-tip">回答由 AI 基于知识库生成，请以引用原文为准</p>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.chat-shell { display: flex; height: 100%; min-height: 0; overflow: hidden; }

/* ---------- 会话列表 ---------- */
.sessions {
  width: 260px; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px;
  padding: 16px 12px; background: var(--surface); border-right: 1px solid var(--hairline);
  transition: margin-left 0.2s ease, opacity 0.15s ease;
}
.sessions.collapsed { margin-left: -260px; opacity: 0; pointer-events: none; }

/* 折叠标志：竖向细长条，点击横向收起 / 展开会话面板 */
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
/* 会话记录列表：常显滚动条（带轨道底色），一眼可见、方便滚动 */
.session-scroll {
  flex: 1; overflow-y: auto; min-height: 0;
  scrollbar-gutter: stable;
  scrollbar-width: auto;
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

/* 会话悬浮操作：置顶 / 重命名 / 删除 */
.item-actions {
  display: flex; gap: 2px; flex-shrink: 0;
  opacity: 0; transition: opacity 0.15s ease;
}
.session-item:hover .item-actions,
.session-item:focus-within .item-actions { opacity: 1; }
.item-act {
  border: none; background: transparent; color: var(--stone);
  padding: 3px; border-radius: var(--radius-sm); display: flex;
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
.session-empty { font-size: 12.5px; color: var(--muted); text-align: center; padding: 20px 0; }
.kb-notice {
  display: flex; align-items: center; gap: 7px; padding: 9px 10px;
  background: var(--tint-lavender); color: var(--brand-purple-800);
  border-radius: var(--radius-md); font-size: 12px; font-weight: 500;
}

/* ---------- 聊天主区 ---------- */
.chat-main { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--canvas); }

.messages-wrap { flex: 1; min-height: 0; display: flex; position: relative; }
.messages { flex: 1; min-width: 0; overflow-y: auto; padding: 28px 24px; }
.welcome { max-width: 560px; margin: 8vh auto 0; text-align: center; }
.welcome-logo {
  width: 64px; height: 64px; border-radius: 18px; margin: 0 auto 18px;
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
.cite-doc { font-weight: 600; color: var(--ink); }
.cite-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.cite-chunk { font-size: 11px; color: var(--stone); }
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
.attach-list { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; max-width: 880px; margin-left: auto; margin-right: auto; }
.attach-chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--tint-sky); color: var(--link-blue); font-size: 12px; font-weight: 500;
  border-radius: var(--radius-full); padding: 5px 12px;
}
.attach-x { border: none; background: transparent; display: flex; color: inherit; opacity: 0.7; }

/* 流光边框：注册可插值的角度变量（不支持的浏览器退化为静态高亮环） */
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
/* 拖拽文件悬停时的提示态 */
.composer-box.dragging {
  border: 1px dashed var(--primary);
  background: var(--tint-lavender);
  box-shadow: 0 0 0 3px rgba(86, 69, 212, 0.12);
}
@keyframes beam-spin { to { --beam: 360deg; } }
.attach-btn { border: none; background: transparent; color: var(--steel); padding: 7px; border-radius: var(--radius-sm); display: flex; }
.attach-btn:hover { background: var(--surface); color: var(--primary); }
.composer-input {
  flex: 1; border: none; outline: none; resize: none; font-family: inherit;
  font-size: 14.5px; line-height: 1.6; max-height: 160px; min-height: 66px;
  background: transparent; color: var(--ink); padding: 4px 2px;
}
/* 语音按钮 */
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
.drag-tip { color: var(--brand-purple-800); font-weight: 600; }

/* ---------- 回到底部按钮 ---------- */
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

/* ---------- 千问式对话导航 ---------- */
.msg-nav {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  z-index: 6; width: 40px; max-height: 72vh;
  display: flex; flex-direction: column; align-items: stretch; overflow: hidden;
  background: var(--canvas); border: 1px solid var(--hairline);
  border-radius: 999px; box-shadow: 0 6px 20px rgba(10, 21, 48, 0.1);
  transition: width 0.22s ease, border-radius 0.22s ease;
}
.msg-nav.open { width: 268px; border-radius: var(--radius-lg); }
.nav-handle {
  width: 40px; height: 40px; flex-shrink: 0;
  border: none; background: transparent; color: var(--stone);
  display: flex; align-items: center; justify-content: center;
}
.msg-nav.open .nav-handle { color: var(--primary); }
.nav-list {
  display: none; width: 100%;
  max-height: calc(72vh - 40px); overflow-y: auto; min-height: 0;
  padding: 2px 6px 8px;
  scrollbar-width: thin; scrollbar-color: var(--hairline-strong) transparent;
}
.msg-nav.open .nav-list { display: block; }
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

@media (max-width: 900px) {
  .sessions, .rail-toggle { display: none; }
  .sug-grid { grid-template-columns: 1fr; }
  .msg-nav { display: none; }
}
</style>
