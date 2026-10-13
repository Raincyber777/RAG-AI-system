<script setup lang="ts">
/**
 * 课堂追问：基于课堂纪要知识库的多轮问答（核心前台）
 * - 左侧：课堂列表（与我的纪要数据同步）+ 搜索
 * - 右侧：聊天窗口（流式回答 / 录音时间戳与图片来源引用 / 语音输入 / 对话导航）
 * 回答为前端演示，接入真实模型后仅需替换 runStages / streamAnswer 中的回调
 */
import { ref, reactive, nextTick, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { classNotes } from '@/store/study'
import { initialMessages, demoReply, type ChatMessage, type Citation } from '@/mock/data'

const route = useRoute()

// ---------- 课堂列表 ----------
const sessionSearch = ref('')
const activeSessionId = ref('')
const sessionsOpen = ref(true) // 会话面板可横向收起 / 展开

const doneNotes = computed(() => classNotes.value.filter((n) => n.status === 'done'))
const totalChunks = computed(() => doneNotes.value.reduce((s, n) => s + n.chunkCount, 0))

// 课堂分组：按生成日期动态分为 今天 / 昨天 / 更早
const dayStr = (offset: number) => {
  const d = new Date(Date.now() - offset * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const todayStr = dayStr(0)
const yestStr = dayStr(1)

const sessionGroups = computed(() => {
  const q = sessionSearch.value.trim()
  const match = (title: string) => title.includes(q)
  const byGroup: Record<'今天' | '昨天' | '更早', typeof doneNotes.value> = { 今天: [], 昨天: [], 更早: [] }
  for (const n of doneNotes.value) {
    if (!match(n.title)) continue
    const day = n.date.slice(0, 10)
    if (day === todayStr) byGroup['今天'].push(n)
    else if (day === yestStr) byGroup['昨天'].push(n)
    else byGroup['更早'].push(n)
  }
  const groups: { label: string; items: typeof doneNotes.value }[] = []
  for (const g of ['今天', '昨天', '更早'] as const) {
    if (byGroup[g].length) groups.push({ label: g, items: byGroup[g] })
  }
  return groups
})

// ---------- 消息（按课堂隔离） ----------
const messageStore = reactive<Record<string, ChatMessage[]>>({})

function messagesFor(id: string): ChatMessage[] {
  if (!messageStore[id]) messageStore[id] = []
  return messageStore[id]
}

const activeMessages = computed<ChatMessage[]>(() =>
  activeSessionId.value ? (messageStore[activeSessionId.value] ?? []) : []
)

const activeNote = computed(() => classNotes.value.find((n) => n.id === activeSessionId.value))

function switchSession(id: string) {
  if (isTyping.value || isStreaming.value) stopGenerating()
  activeSessionId.value = id
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
  stageTimers.push(window.setTimeout(() => {
    isTyping.value = false
    aiStage.value = null
    streamAnswer()
  }, 3300))
}

function stopGenerating() {
  clearStageTimers()
  if (streamTimer) { window.clearInterval(streamTimer); streamTimer = null }
  isTyping.value = false
  isStreaming.value = false
  aiStage.value = null
}

// 把当前课堂的纪要标题代入演示回答（更贴近真实观感）
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

const navOpen = ref(false)
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

// ---------- 发送 ----------
function send() {
  const text = input.value.trim()
  if (!text || isTyping.value || isStreaming.value || !activeSessionId.value) return

  messagesFor(activeSessionId.value).push({
    id: 'u' + Date.now(),
    role: 'user',
    content: text,
    time: now(),
  })
  input.value = ''
  scrollToBottom()
  isTyping.value = true
  runStages()
}

function streamAnswer() {
  isStreaming.value = true
  const reply = buildReply()
  const msg: ChatMessage = reactive({
    id: 'a' + Date.now(),
    role: 'assistant',
    content: '',
    citations: reply.citations,
    time: now(),
  })
  if (activeSessionId.value) messagesFor(activeSessionId.value).push(msg)
  scrollToBottom()

  let i = 0
  const timer = window.setInterval(() => {
    i += 2 + Math.floor(Math.random() * 3)
    msg.content = reply.content.slice(0, i)
    if (i >= reply.content.length) {
      window.clearInterval(timer)
      streamTimer = null
      isStreaming.value = false
      scrollToBottom()
    }
  }, 30)
  streamTimer = timer
}

function regenerate(msg: ChatMessage) {
  if (isStreaming.value || isTyping.value || !activeSessionId.value) return
  const list = messagesFor(activeSessionId.value)
  const idx = list.indexOf(msg)
  list.splice(idx, 1)
  streamAnswer()
}

function toggleLike(msg: ChatMessage, liked: boolean) {
  msg.liked = liked ? !msg.liked : false
  msg.disliked = !liked ? !msg.disliked : false
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
  return c.kind === 'audio' ? 'headphones' : 'image'
}
function citeMarkText(c: Citation) {
  return c.kind === 'audio' ? `录音 ${c.mark}` : c.mark
}

// ---------- 建议 ----------
const suggestions = computed(() => {
  const t = activeNote.value?.title ?? '这节课'
  return [`「${t}」的重点是什么？`, '这节课布置了什么作业？', '把老师强调的考点整理一下', '老师课上回答过哪些问题？']
})

function suggestionClick(q: string) {
  input.value = q
  send()
}

function now() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 初始课堂：支持 /qa?note=id 直达；否则选第一个（首个课堂预置一轮演示对话）
onMounted(() => {
  const q = route.query.note
  const id = typeof q === 'string' ? q : ''
  const exists = doneNotes.value.some((n) => n.id === id)
  activeSessionId.value = exists ? id : (doneNotes.value[0]?.id ?? '')
  if (activeSessionId.value && !messageStore[activeSessionId.value]) {
    messageStore[activeSessionId.value] =
      activeSessionId.value === 'n1' ? initialMessages.map((m) => ({ ...m })) : []
  }
  scrollToBottom(true)
})

onBeforeUnmount(() => {
  clearStageTimers()
  if (streamTimer) window.clearInterval(streamTimer)
  if (flashTimer) window.clearTimeout(flashTimer)
})
</script>

<template>
  <div class="chat-shell">
    <!-- 左侧课堂列表 -->
    <aside class="sessions" :class="{ collapsed: !sessionsOpen }">
      <div class="side-title">
        <AppIcon name="book" :size="15" />
        <span>课堂知识库</span>
      </div>
      <div class="search-box">
        <AppIcon name="search" :size="15" />
        <input v-model="sessionSearch" placeholder="搜索课堂" class="search-input" />
      </div>

      <div class="session-scroll">
        <template v-for="g in sessionGroups" :key="g.label">
          <div class="text-uppercase group-label">{{ g.label }}</div>
          <div
            v-for="s in g.items"
            :key="s.id"
            class="session-item"
            :class="{ active: s.id === activeSessionId }"
            role="button"
            tabindex="0"
            @click="switchSession(s.id)"
            @keydown.enter.prevent="switchSession(s.id)"
          >
            <AppIcon name="book" :size="14" />
            <span class="ellipsis">{{ s.title }}</span>
            <span class="qa-count" title="追问次数">{{ s.questions }}</span>
          </div>
        </template>
        <div v-if="sessionGroups.length === 0" class="session-empty">没有匹配的课堂</div>
      </div>

      <div class="kb-notice">
        <AppIcon name="database" :size="15" />
        <span>已接入 {{ doneNotes.length }} 个课堂 · {{ totalChunks }} 个知识片段</span>
      </div>
    </aside>

    <!-- 折叠标志 -->
    <button
      class="rail-toggle"
      :title="sessionsOpen ? '收起课堂列表' : '展开课堂列表'"
      :aria-label="sessionsOpen ? '收起课堂列表' : '展开课堂列表'"
      @click="sessionsOpen = !sessionsOpen"
    >
      <AppIcon :name="sessionsOpen ? 'chevron-left' : 'chevron-right'" :size="14" />
    </button>

    <!-- 右侧聊天窗口 -->
    <section class="chat-main">
      <div class="chat-head">
        <template v-if="activeNote">
          <span class="head-title ellipsis">{{ activeNote.title }}</span>
          <span class="tag tag-purple">{{ activeNote.course }}</span>
        </template>
        <span v-else class="head-title muted">请选择一个课堂</span>
      </div>

      <!-- 消息区 -->
      <div class="messages-wrap">
        <div ref="messagesEl" class="messages" @scroll.passive="onMessagesScroll">
          <!-- 空状态 -->
          <div v-if="!activeMessages.length" class="welcome fade-in">
            <div class="welcome-logo"><AppIcon name="chat" :size="28" /></div>
            <h2 class="h2">针对这节课，想问点什么？</h2>
            <p class="text-md muted">回答基于本节课的转写稿、板书与 PPT 生成，每句话都能溯源到录音时间点或图片。</p>
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
              <div class="bubble-user">{{ msg.content }}</div>
            </div>

            <div v-else class="row-ai fade-in" :data-mid="msg.id">
              <div class="ai-body">
                <div class="ai-bubble" v-html="renderContent(msg.content)"></div>

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
                        <span class="tag tag-gray ellipsis">{{ c.note }}</span>
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

        <!-- 对话导航 -->
        <div
          v-if="outline.length"
          class="msg-nav"
          :class="{ open: navOpen }"
          @mouseenter="navOpen = true"
          @mouseleave="navOpen = false"
        >
          <button class="nav-handle" type="button" title="提问记录导航" aria-label="提问记录导航">
            <AppIcon name="menu" :size="14" />
          </button>
          <div class="nav-list">
            <button v-for="o in outline" :key="o.id" class="nav-item" :title="o.text" @click="jumpTo(o.id)">{{ o.text }}</button>
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
        <div class="composer-box">
          <textarea
            v-model="input"
            class="composer-input"
            :placeholder="listening ? '正在聆听，请说话…' : '向课堂知识库提问…（Enter 发送 / Shift+Enter 换行）'"
            rows="1"
            @keydown.enter.exact.prevent="send"
          ></textarea>
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
          <button v-else class="send-btn" title="发送" aria-label="发送" :disabled="!input.trim()" @click="send">
            <AppIcon name="send" :size="16" />
          </button>
        </div>
        <p v-if="voiceTip" class="composer-tip voice-tip">{{ voiceTip }}</p>
        <p v-else class="composer-tip">回答由 AI 基于课堂纪要生成，请以引用原文为准</p>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.chat-shell { display: flex; height: 100%; min-height: 0; overflow: hidden; }

/* ---------- 课堂列表 ---------- */
.sessions {
  width: 264px; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px;
  padding: 16px 12px; background: var(--surface); border-right: 1px solid var(--hairline);
  transition: margin-left 0.2s ease, opacity 0.15s ease;
}
.sessions.collapsed { margin-left: -264px; opacity: 0; pointer-events: none; }

.side-title { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; padding: 0 4px; }

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
.session-empty { font-size: 12.5px; color: var(--muted); text-align: center; padding: 20px 0; }
.qa-count {
  flex-shrink: 0; min-width: 20px; height: 18px; padding: 0 5px;
  border-radius: 9px; background: var(--hairline-soft); color: var(--steel);
  font-size: 10.5px; font-weight: 600; line-height: 18px; text-align: center;
}
.session-item.active .qa-count { background: var(--tint-lavender); color: var(--primary); }
.kb-notice {
  display: flex; align-items: center; gap: 7px; padding: 9px 10px;
  background: var(--tint-lavender); color: var(--brand-purple-800);
  border-radius: var(--radius-md); font-size: 12px; font-weight: 500;
}

/* ---------- 聊天主区 ---------- */
.chat-main { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--canvas); }
.chat-head {
  display: flex; align-items: center; gap: 10px; padding: 12px 24px;
  border-bottom: 1px solid var(--hairline-soft); background: var(--canvas);
}
.head-title { font-size: 14px; font-weight: 700; max-width: 50%; }

.messages-wrap { flex: 1; min-height: 0; display: flex; position: relative; }
.messages { flex: 1; min-width: 0; overflow-y: auto; padding: 26px 24px; }
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

/* ---------- 提问记录导航 ---------- */
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
  .head-title { max-width: 60%; }
}
</style>
