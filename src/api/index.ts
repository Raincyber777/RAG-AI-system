/**
 * 后端接口清单（与 Django 后端一一对应，返回原始字段）
 * 前端各 store 负责把这里的数据映射为页面模型（ClassNote / Citation / QuizQuestion 等）
 */
import { request, listAll, buildForm, BASE, getToken } from './http'

export type ApiRole = 'user' | 'admin' | 'super'

// ---------- 认证 ----------
export interface ApiUser {
  id: number
  name: string
  phone: string
  email: string
  role: ApiRole
  status: 'active' | 'disabled'
  avatar: string
  notes_count: number
  questions_count: number
  created_at: string
}

export interface AuthPayload {
  access: string
  refresh: string
  user: ApiUser
}

/** 注册验证码的接收通道（phone=短信到手机号）；可用性由 /auth/code-channels/ 协商 */
export type CodeChannel = 'email' | 'phone'
/** 验证码用途：注册 / 更换手机号 / 更换邮箱（换绑固定发到绑定邮箱） */
export type CodePurpose = 'register' | 'change_phone' | 'change_email'

export interface CodeSendResult {
  detail: string
  expires_in: number
  /** 仅后端 DEBUG（本地联调）返回：验证码未真正发出，直接回填输入框 */
  dev_code?: string
}

export const authApi = {
  login: (account: string, password: string) =>
    request<AuthPayload>('/auth/login/', { method: 'POST', data: { account, password } }),
  register: (form: {
    name: string; phone: string; email: string; password: string
    code: string; code_channel: CodeChannel
  }) => request<AuthPayload>('/auth/register/', { method: 'POST', data: form }),
  /** 哪些验证码接收方式已开通（未开通的通道前端隐藏对应选项） */
  codeChannels: () => request<{ email: boolean; phone: boolean }>('/auth/code-channels/'),
  sendCode: (channel: CodeChannel, target: string, purpose: CodePurpose = 'register') =>
    request<CodeSendResult>('/auth/code/send/', { method: 'POST', data: { channel, target, purpose } }),
  /** 更换手机号 / 邮箱：验证码已发到绑定邮箱，带码改绑 */
  changePhone: (phone: string, code: string) =>
    request<ApiUser>('/auth/me/phone/', { method: 'POST', data: { phone, code } }),
  changeEmail: (email: string, code: string) =>
    request<ApiUser>('/auth/me/email/', { method: 'POST', data: { email, code } }),
  logout: (refresh: string) => request<void>('/auth/logout/', { method: 'POST', data: { refresh } }),
  me: () => request<ApiUser>('/auth/me/'),
  updateMe: (patch: Record<string, string>) =>
    request<ApiUser>('/auth/me/', { method: 'PATCH', data: patch }),
  updateAvatar: (file: File) => {
    const fd = buildForm({}, { avatar: file })
    return request<ApiUser>('/auth/me/', { method: 'PATCH', form: fd })
  },
  changePassword: (old_password: string, new_password: string) =>
    request<void>('/auth/password/', { method: 'POST', data: { old_password, new_password } }),
}

// ---------- 课堂纪要 ----------
export interface ApiNote {
  id: number
  course: string
  title: string
  duration: string
  status: 'processing' | 'done' | 'failed'
  fail_reason?: string
  uploader: number
  uploader_name: string
  source: string
  source_type: string
  theme: string
  points: { text: string; ref: string }[]
  definitions: { term: string; text: string; ref: string }[]
  emphasized: string[]
  transcript: string
  questions: number
  created_at: string
  updated_at: string
}

export const notesApi = {
  list: () => listAll<ApiNote>('/notes/'),
  create: (fields: { course: string; title: string; duration: string }, file?: File) => {
    const fd = buildForm(fields, file ? { source: file } : {})
    return request<ApiNote>('/notes/', { method: 'POST', form: fd })
  },
  detail: (id: string) => request<ApiNote>(`/notes/${id}/`),
  remove: (id: string) => request<void>(`/notes/${id}/`, { method: 'DELETE' }),
  reprocess: (id: string) => request<ApiNote>(`/notes/${id}/reprocess/`, { method: 'POST' }),
  /** 停止生成：取消仍在处理中的纪要，释放串行流水线队列（下一轮生成不再排旧任务后面） */
  cancel: (id: string) => request<ApiNote>(`/notes/${id}/cancel/`, { method: 'POST' }),
  renameCourse: (from: string, to: string) =>
    request<{ course: string; updated: number }>('/notes/course-rename/', {
      method: 'POST',
      data: { from, to },
    }),
  deleteCourse: (course: string) =>
    request<{ course: string; deleted: number }>('/notes/course-delete/', {
      method: 'POST',
      data: { course },
    }),
}

// ---------- 智能问答 ----------
export interface ApiQaRecord {
  id: number
  note: number | null
  note_title: string
  course: string
  user_name: string
  question: string
  answer: string
  /** 引用来源：kind=kb 知识库片段（time 带录音时间戳）/ external 外部检索（带 url）/ doc 上传文档 */
  references: { label: string; time: string; detail: string; kind?: 'kb' | 'external' | 'doc'; url?: string }[]
  /** RAG 生成的追问建议（回答下方可点击继续问） */
  followups: string[]
  liked: boolean
  created_at: string
  /** 审核标记：political 政治引导 / health_block 禁忌拦截（命中时前端弹安全提醒） */
  moderation?: 'political' | 'health_block' | ''
  /** 本次提问更新了健康档案（前端 toast「已记录你的健康禁忌」） */
  profile_updated?: boolean
}

/** 按消息的反馈埋点动作（点赞 / 点踩 / 复制 / 重新提问 / 停留时长） */
export type QaFeedbackAction = 'like' | 'dislike' | 'copy' | 'reask' | 'dwell'

export const qaApi = {
  /** 我的问答历史：课内会话按纪要（note）过滤；自由对话按会话标识（session_ref）过滤 */
  list: (noteId?: string, sessionRef?: string) => {
    const params: Record<string, string> = {}
    if (noteId) params.note = noteId
    if (sessionRef) params.session = sessionRef
    return listAll<ApiQaRecord>('/qa/', params)
  },
  ask: (noteId: string | null, question: string, sessionRef?: string) =>
    request<ApiQaRecord>('/qa/ask/', {
      method: 'POST',
      data: {
        ...(noteId ? { note_id: Number(noteId) } : {}),
        question,
        ...(sessionRef ? { session_ref: sessionRef } : {}),
      },
    }),
  like: (id: number) => request<ApiQaRecord>(`/qa/${id}/like/`, { method: 'POST' }),
  /** 反馈埋点：驱动片段权重升降与训练样本筛选，失败静默（不影响浏览） */
  feedback: (id: number, action: QaFeedbackAction, value?: string) =>
    request<{ action: QaFeedbackAction; liked: boolean }>(`/qa/${id}/feedback/`, {
      method: 'POST',
      data: { action, ...(value ? { value } : {}) },
    }),
  /** 会话回滚：删除该问答及其后的全部记录（Claude 式 rewind 的服务端部分） */
  rollback: (sessionRef: string, recordId: number) =>
    request<{ deleted: number }>('/qa/rollback/', {
      method: 'POST',
      data: { session_ref: sessionRef, record_id: recordId },
    }),
  /** 欢迎页个性化追问建议（按用户近期提问生成，失败由页面回退默认文案） */
  suggestions: () => request<{ suggestions: string[] }>('/qa/suggestions/'),
}

/**
 * SSE 流式问答：回答增量实时写入 buf.text（event: delta），结束返回完整问答记录（event: done）。
 * 后端 event: status（stage + round）经 onStatus 上抛：agent 链路的路由 / 生成 / 校验 / 修正
 * 阶段实时驱动页面状态提示（校验期间正文已上屏，不再像卡住）。
 * 内容被安全审核拦截时下发 event: blocked（category + message）：message 写入 buf.text 展示拦截文案，
 * buf.blocked 记下类别供页面弹安全提醒，返回 null（无记录可入库）。
 * 接口报错（如未完成纪要 400）写入 buf.error；网络 / 流异常时也以 buf.error 收尾，
 * 页面凭 buf 已有内容与错误态渲染，不再二次请求。
 */
export async function streamAsk(
  noteId: string | null,
  question: string,
  buf: { text: string; error: string | null; blocked?: string | null },
  sessionRef?: string,
  onStatus?: (stage: string, round?: number) => void,
  images?: File[],
  docs?: File[],
  signal?: AbortSignal,
): Promise<ApiQaRecord | null> {
  let res: Response
  try {
    // 带图片附件时走 multipart（后端 /qa/ask/stream/ 支持 images[] 视觉问答），纯文本仍走 JSON；
    // 文档附件（documents[]）由后端解析文本后围绕文档作答，与图片互斥由后端校验
    const headers: Record<string, string> = {
      'ngrok-skip-browser-warning': '1',
      Authorization: `Bearer ${getToken()}`,
    }
    let body: BodyInit
    if (images?.length || docs?.length) {
      const fd = buildForm(
        {
          question,
          ...(noteId ? { note_id: String(Number(noteId)) } : {}),
          ...(sessionRef ? { session_ref: sessionRef } : {}),
        },
        { ...(images?.length ? { images } : {}), ...(docs?.length ? { documents: docs } : {}) },
      )
      body = fd
    } else {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify({
        ...(noteId ? { note_id: Number(noteId) } : {}),
        question,
        ...(sessionRef ? { session_ref: sessionRef } : {}),
      })
    }
    res = await fetch(`${BASE}/qa/ask/stream/`, { method: 'POST', headers, body, signal })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err // 主动停止：调用方按「已停止」收尾
    buf.error = '网络异常，请稍后再试'
    return null
  }
  if (!res.ok || !res.body) {
    try {
      const data = await res.json()
      buf.error = typeof data.detail === 'string' ? data.detail : `请求失败（${res.status}）`
    } catch {
      buf.error = `请求失败（${res.status}）`
    }
    return null
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let carry = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    carry += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = carry.indexOf('\n\n')) >= 0) {
      const block = carry.slice(0, idx)
      carry = carry.slice(idx + 2)
      let name = 'message'
      let dataStr = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) name = line.slice(6).trim()
        else if (line.startsWith('data:')) dataStr += line.slice(5).trim()
      }
      if (!dataStr) continue
      try {
        const payload = JSON.parse(dataStr)
        if (name === 'delta' && typeof payload.text === 'string') buf.text += payload.text
        else if (name === 'replace' && typeof payload.text === 'string') buf.text = payload.text
        else if (name === 'status' && onStatus && typeof payload.stage === 'string') onStatus(payload.stage, payload.round)
        else if (name === 'done') return payload as ApiQaRecord
        else if (name === 'blocked') {
          buf.blocked = typeof payload.category === 'string' ? payload.category : 'blocked'
          if (typeof payload.message === 'string') buf.text += payload.message
          return null
        }
      } catch {
        // 跳过无法解析的帧
      }
    }
  }
  return null // 流结束但未等到 done：以已展示文本收尾（无引用）
}

// ---------- 题库 / 错题本 ----------
export type ApiQuizType = 'single' | 'multiple' | 'indefinite' | 'judge' | 'blank' | 'answer'

export interface ApiQuizItem {
  id: number
  note: number | null
  course: string
  chapter: string
  type: ApiQuizType
  difficulty: string
  stem: string
  options: string[] | null
  answer: string
  analysis: string
  cite: string
  knowledge: string
  uploader: number
  uploader_name: string
  created_at: string
}

export interface ApiWrongRecord {
  id: number
  quiz: {
    id: number
    course: string
    chapter: string
    type: ApiQuizType
    stem: string
    options: string[] | null
    answer: string
    analysis: string
  }
  my_answer: string
  created_at: string
}

export interface ApiSubmitResult {
  correct: boolean
  my_answer: string
  id: number
  course: string
  chapter: string
  type: ApiQuizType
  stem: string
  options: string[] | null
  answer: string
  analysis: string
}

export const quizApi = {
  list: () => listAll<ApiQuizItem>('/quiz/'),
  /** LLM 出题入库（types 限定题型、difficulties 限定难度子集，传后端题型名或前端别名 multi/short 均可） */
  generate: (noteId: string, count = 5, types?: string[], difficulties?: string[]) =>
    request<ApiQuizItem[]>('/quiz/generate/', {
      method: 'POST',
      data: {
        note_id: Number(noteId),
        count,
        ...(types?.length ? { types } : {}),
        ...(difficulties?.length ? { difficulties } : {}),
      },
    }),
  submit: (id: number, answer: string) =>
    request<ApiSubmitResult>(`/quiz/${id}/submit/`, { method: 'POST', data: { answer } }),
  wrongList: () => listAll<ApiWrongRecord>('/quiz/wrong/'),
  wrongRemove: (id: number) => request<void>(`/quiz/wrong/${id}/`, { method: 'DELETE' }),
}

// ---------- 问题反馈 ----------
export interface ApiFeedback {
  id: number
  title: string
  content: string
  contact: string
  images: string[]
  status: 'pending' | 'resolved'
  user: number
  user_name: string
  user_email: string
  created_at: string
}

export const feedbackApi = {
  list: () => listAll<ApiFeedback>('/feedback/'),
  create: (fields: { title: string; content: string; contact?: string }, images: File[]) => {
    const fd = buildForm(fields, { images })
    return request<ApiFeedback>('/feedback/', { method: 'POST', form: fd })
  },
}

// ---------- 常见问题 / 使用技巧（公开；分页接口经 listAll 拉全量） ----------
export interface ApiFaq {
  id: number
  scope: 'user' | 'admin'
  q: string
  a: string
  order: number
}

export interface ApiTip {
  id: number
  scope: 'user' | 'admin'
  text: string
  order: number
}

export const faqApi = {
  list: (scope: 'user' | 'admin') => listAll<ApiFaq>('/faqs/', { scope }),
}

export const tipsApi = {
  list: (scope: 'user' | 'admin') => listAll<ApiTip>('/tips/', { scope }),
}

// ---------- 数据速览 ----------
/** 数据看板四张图的实时聚合（/stats/summary/ personal 口径返回） */
export interface DashboardCharts {
  daily: { date: string; count: number }[] // 近 14 天追问量（MM-DD，缺的日子补 0）
  materials: { name: string; value: number }[] // 纪要材料类型分布（5 类齐全）
  top_points: { label: string; count: number }[] // 高频知识点 Top10
  cloud: { text: string; count: number }[] // 热门追问词云（Top16）
  trend_delta: number | null // 近 7 日对比前 7 日的百分比变化；无基线为 null
}

export interface PersonalStats {
  scope: 'personal'
  notes: number
  qa_records: number
  quiz_items: number
  wrong_records: number
  charts?: DashboardCharts
}

export const statsApi = {
  summary: () => request<PersonalStats>('/stats/summary/'),
}

// ---------- 公告与协议 ----------
export interface ApiAnnouncement {
  id: number
  title: string
  content: string
  status: 'published' | 'withdrawn'
  creator_name: string
  created_at: string
  withdrawn_at: string | null
}

export const announcementApi = {
  list: () => listAll<ApiAnnouncement>('/announcements/'),
  unread: () => request<{ count: number; latest: ApiAnnouncement | null }>('/announcements/unread/'),
  markAllRead: () => request<{ detail: string }>('/announcements/read/', { method: 'POST', data: { all: true } }),
}

export const legalApi = {
  get: (key: 'terms' | 'privacy') =>
    request<{ content: string; updated_at: string | null }>(`/legal/${key}/`),
}
