<script setup lang="ts">
/**
 * 板块一：智能对话交互区（核心前台）
 * - 左侧：历史会话列表 + 新建对话
 * - 右侧：聊天窗口（多模态输入 / 流式回答 / 引用溯源 / 点赞点踩 / 重新生成）
 */
import { ref, reactive, nextTick, computed } from 'vue'
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
const filteredSessions = computed(() =>
  sessions.value.filter((s) => s.title.includes(sessionSearch.value.trim()))
)

function createSession() {
  const s: Session = { id: 's' + Date.now(), title: '新的对话', group: '今天' }
  sessions.value.unshift(s)
  activeSessionId.value = s.id
  messages.value = []
}

// ---------- 消息 ----------
const messages = ref<ChatMessage[]>(initialMessages.map((m) => ({ ...m })))
const input = ref('')
const isTyping = ref(false) // AI 正在生成
const isStreaming = ref(false) // 正在逐字输出
const uploading = ref<string[]>([]) // 已附加的文件名

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

function scrollToBottom() {
  nextTick(() => {
    const el = document.querySelector('.messages')
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  })
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

  // AI 打字指示 → 流式输出
  isTyping.value = true
  setTimeout(() => {
    isTyping.value = false
    streamAnswer(files)
  }, 900)
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
  const timer = setInterval(() => {
    i += 2 + Math.floor(Math.random() * 3)
    msg.content = full.slice(0, i)
    if (i >= full.length) {
      clearInterval(timer)
      isStreaming.value = false
      scrollToBottom()
    }
  }, 30)
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

// 附件选择
const fileInput = ref<HTMLInputElement>()
function pickFiles() {
  fileInput.value?.click()
}
function onFilesChosen(e: Event) {
  const list = (e.target as HTMLInputElement).files
  if (!list) return
  for (const f of Array.from(list)) {
    if (f.size > 20 * 1024 * 1024) continue
    uploading.value.push(f.name)
  }
  ;(e.target as HTMLInputElement).value = ''
}

// 展开某条消息的引用面板
const openCitations = reactive<Record<string, boolean>>({})
function toggleCitation(id: string) {
  openCitations[id] = !openCitations[id]
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
    <!-- 左侧会话列表 -->
    <aside class="sessions">
      <button class="btn btn-primary btn-block" @click="createSession">
        <AppIcon name="plus" :size="16" /> 新建对话
      </button>
      <div class="search-box">
        <AppIcon name="search" :size="15" />
        <input v-model="sessionSearch" placeholder="搜索会话" class="search-input" />
      </div>

      <div class="session-scroll">
        <template v-for="group in ['今天', '昨天', '更早']" :key="group">
          <template v-if="filteredSessions.some((s) => s.group === group)">
            <div class="text-uppercase group-label">{{ group }}</div>
            <div
              v-for="s in filteredSessions.filter((x) => x.group === group)"
              :key="s.id"
              class="session-item"
              :class="{ active: s.id === activeSessionId }"
              @click="activeSessionId = s.id"
            >
              <AppIcon name="chat" :size="14" />
              <span class="ellipsis">{{ s.title }}</span>
            </div>
          </template>
        </template>
      </div>

      <div class="kb-notice">
        <AppIcon name="database" :size="15" />
        <span>已接入 4 个知识空间 · 108 篇文档</span>
      </div>
    </aside>

    <!-- 右侧聊天窗口 -->
    <section class="chat-main">
      <header class="chat-header">
        <div class="flex-1 ellipsis">
          <div class="h4">{{ sessions.find((s) => s.id === activeSessionId)?.title || '新的对话' }}</div>
          <div class="text-caption">基于知识库检索增强 · 引用严格度：高</div>
        </div>
        <span class="tag tag-purple"><AppIcon name="zap" :size="12" /> RAG 已启用</span>
      </header>

      <!-- 消息区 -->
      <div class="messages">
        <!-- 空状态：欢迎 + 推荐问题 -->
        <div v-if="messages.length === 0" class="welcome fade-in">
          <div class="welcome-logo"><AppIcon name="spark" :size="30" /></div>
          <h2 class="h2">您好，我是智源助手 👋</h2>
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
          <div v-if="msg.role === 'user'" class="row-user fade-in">
            <div class="bubble-user">{{ msg.content }}</div>
          </div>

          <!-- AI 消息 -->
          <div v-else class="row-ai fade-in">
            <div class="avatar ai-avatar">智</div>
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
                      <div class="score-bar"><i :style="{ width: c.score * 100 + '%' }"></i></div>
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
                  @click="toggleLike(msg, true)"
                ><AppIcon name="thumbs-up" :size="14" /></button>
                <button
                  class="action-btn"
                  :class="{ on: msg.disliked }"
                  title="无用"
                  @click="toggleLike(msg, false)"
                ><AppIcon name="thumbs-down" :size="14" /></button>
                <button class="action-btn" title="复制" @click="copyMessage(msg)"><AppIcon name="copy" :size="14" /></button>
                <button class="action-btn" title="重新生成" @click="regenerate(msg)"><AppIcon name="refresh" :size="14" /></button>
                <span class="msg-time">{{ msg.time }}</span>
              </div>
            </div>
          </div>
        </template>

        <!-- AI 正在思考 -->
        <div v-if="isTyping" class="row-ai fade-in">
          <div class="avatar ai-avatar">智</div>
          <div class="ai-bubble typing">
            <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
            <span class="typing-text">正在检索知识库…</span>
          </div>
        </div>
      </div>

      <!-- 输入区 -->
      <footer class="composer">
        <div v-if="uploading.length" class="attach-list">
          <span v-for="f in uploading" :key="f" class="attach-chip">
            <AppIcon name="file" :size="13" /> {{ f }}
            <button class="attach-x" @click="uploading = uploading.filter((x) => x !== f)"><AppIcon name="x" :size="11" /></button>
          </span>
        </div>
        <div class="composer-box">
          <button class="attach-btn" title="上传文件提问" @click="pickFiles"><AppIcon name="paperclip" :size="18" /></button>
          <input ref="fileInput" type="file" multiple hidden accept=".pdf,.doc,.docx,.md,.txt,.xlsx,.pptx" @change="onFilesChosen" />
          <textarea
            v-model="input"
            class="composer-input"
            placeholder="向智源助手提问…（Enter 发送 / Shift+Enter 换行）"
            rows="1"
            @keydown.enter.exact.prevent="send"
          ></textarea>
          <button class="send-btn" :disabled="isTyping || isStreaming || (!input.trim() && !uploading.length)" @click="send">
            <AppIcon name="send" :size="16" />
          </button>
        </div>
        <p class="composer-tip">回答由 AI 基于知识库生成，请以引用原文为准</p>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.chat-shell { display: flex; height: 100%; min-height: 0; }

/* ---------- 会话列表 ---------- */
.sessions {
  width: 260px; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px;
  padding: 16px 12px; background: var(--surface); border-right: 1px solid var(--hairline);
}
.search-box {
  display: flex; align-items: center; gap: 8px; padding: 0 10px; height: 36px;
  background: var(--canvas); border: 1px solid var(--hairline); border-radius: var(--radius-md);
  color: var(--stone);
}
.search-input { border: none; outline: none; flex: 1; font-size: 13px; background: transparent; }
.session-scroll { flex: 1; overflow-y: auto; min-height: 0; }
.group-label { margin: 10px 6px 6px; }
.session-item {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border-radius: var(--radius-md); font-size: 13px; color: var(--slate);
  cursor: pointer; margin-bottom: 2px; transition: all 0.15s ease;
}
.session-item:hover { background: var(--tint-gray); }
.session-item.active { background: var(--canvas); color: var(--ink); font-weight: 500; box-shadow: 0 1px 2px rgba(15,15,15,0.06); }
.kb-notice {
  display: flex; align-items: center; gap: 7px; padding: 9px 10px;
  background: var(--tint-lavender); color: var(--brand-purple-800);
  border-radius: var(--radius-md); font-size: 12px; font-weight: 500;
}

/* ---------- 聊天主区 ---------- */
.chat-main { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--canvas); }
.chat-header {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 24px; border-bottom: 1px solid var(--hairline);
}

.messages { flex: 1; overflow-y: auto; padding: 28px 24px; }
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

.row-ai { display: flex; gap: 12px; margin-bottom: 26px; }
.ai-avatar { background: var(--brand-navy); color: var(--brand-yellow); }
.ai-body { flex: 1; min-width: 0; }
.ai-bubble {
  background: var(--surface-soft); border: 1px solid var(--hairline-soft);
  border-radius: 4px 14px 14px 14px; padding: 14px 18px;
  line-height: 1.7; white-space: pre-wrap; color: var(--charcoal); font-size: 14.5px;
}
:deep(.cite-mark) {
  color: var(--primary); font-weight: 600; cursor: pointer; font-size: 11px;
  background: var(--tint-lavender); border-radius: 4px; padding: 0 3px; margin: 0 1px;
}
.typing { display: flex; align-items: center; gap: 5px; }
.typing-text { font-size: 13px; color: var(--steel); margin-left: 6px; }

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
.score-bar { flex: 1; height: 5px; border-radius: 3px; background: var(--hairline-soft); overflow: hidden; }
.score-bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--brand-purple-300), var(--primary)); border-radius: 3px; }

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
.attach-list { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.attach-chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--tint-sky); color: var(--link-blue); font-size: 12px; font-weight: 500;
  border-radius: var(--radius-full); padding: 5px 12px;
}
.attach-x { border: none; background: transparent; display: flex; color: inherit; opacity: 0.7; }
.composer-box {
  display: flex; align-items: flex-end; gap: 8px;
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-lg);
  padding: 8px 10px; background: var(--canvas); transition: border-color 0.15s ease;
}
.composer-box:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px var(--tint-lavender); }
.attach-btn { border: none; background: transparent; color: var(--steel); padding: 7px; border-radius: var(--radius-sm); display: flex; }
.attach-btn:hover { background: var(--surface); color: var(--primary); }
.composer-input {
  flex: 1; border: none; outline: none; resize: none; font-family: inherit;
  font-size: 14.5px; line-height: 1.6; max-height: 140px; background: transparent; color: var(--ink);
}
.send-btn {
  width: 38px; height: 38px; border-radius: var(--radius-md); border: none;
  background: var(--primary); color: #fff; display: flex; align-items: center; justify-content: center;
  transition: background 0.15s ease; flex-shrink: 0;
}
.send-btn:hover:not(:disabled) { background: var(--primary-pressed); }
.send-btn:disabled { background: var(--hairline); color: var(--muted); cursor: not-allowed; }
.composer-tip { text-align: center; font-size: 11.5px; color: var(--muted); margin-top: 8px; }

@media (max-width: 900px) {
  .sessions { display: none; }
  .sug-grid { grid-template-columns: 1fr; }
}
</style>
