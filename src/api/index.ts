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

export const authApi = {
  login: (account: string, password: string) =>
    request<AuthPayload>('/auth/login/', { method: 'POST', data: { account, password } }),
  register: (form: { name: string; phone: string; email: string; password: string }) =>
    request<AuthPayload>('/auth/register/', { method: 'POST', data: form }),
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
  references: { label: string; time: string; detail: string }[]
  /** RAG 生成的追问建议（回答下方可点击继续问） */
  followups: string[]
  liked: boolean
  created_at: string
}

export const qaApi = {
  list: (noteId?: string) =>
    listAll<ApiQaRecord>('/qa/', noteId ? { note: noteId } : {}),
  ask: (noteId: string | null, question: string) =>
    request<ApiQaRecord>('/qa/ask/', {
      method: 'POST',
      data: { ...(noteId ? { note_id: Number(noteId) } : {}), question },
    }),
  like: (id: number) => request<ApiQaRecord>(`/qa/${id}/like/`, { method: 'POST' }),
  /** 欢迎页个性化追问建议（按用户近期提问生成，失败由页面回退默认文案） */
  suggestions: () => request<{ suggestions: string[] }>('/qa/suggestions/'),
}

/**
 * SSE 流式问答：回答增量实时写入 buf.text（event: delta），结束返回完整问答记录（event: done）。
 * 接口报错（如未完成纪要 400）写入 buf.error；网络 / 流异常时也以 buf.error 收尾，
 * 页面凭 buf 已有内容与错误态渲染，不再二次请求。
 */
export async function streamAsk(
  noteId: string | null,
  question: string,
  buf: { text: string; error: string | null },
): Promise<ApiQaRecord | null> {
  let res: Response
  try {
    res = await fetch(`${BASE}/qa/ask/stream/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ ...(noteId ? { note_id: Number(noteId) } : {}), question }),
    })
  } catch {
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
        else if (name === 'done') return payload as ApiQaRecord
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
  /** LLM 出题入库（types 限定题型，传后端题型名或前端别名 multi/short 均可） */
  generate: (noteId: string, count = 5, types?: string[]) =>
    request<ApiQuizItem[]>('/quiz/generate/', {
      method: 'POST',
      data: { note_id: Number(noteId), count, ...(types?.length ? { types } : {}) },
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
export interface PersonalStats {
  scope: 'personal'
  notes: number
  qa_records: number
  quiz_items: number
  wrong_records: number
}

export const statsApi = {
  summary: () => request<PersonalStats>('/stats/summary/'),
}
