/**
 * 课堂纪要共享 store（模块级 ref 单例）
 * 数据来自后端 /api/notes/：工作台生成纪要 → 我的纪要列表 → 追问侧边栏，三处数据实时同步
 * 课程表：课程只是纪要上的字符串字段，列表 = 纪要去重 ∪ 本地新增的空课程
 */
import { ref, reactive, computed, watch } from 'vue'

import { notesApi, type ApiNote } from '@/api'
import { isGuest, currentUser } from '@/store/auth'
import type { ClassNote } from '@/mock/data'
import { wrongBook, refreshWrongBook } from '@/store/quiz'

/** 后端纪要 → 页面 ClassNote（chunkCount / keyframes 由内容派生，仅作展示） */
export function noteFromApi(n: ApiNote): ClassNote {
  return {
    id: String(n.id),
    title: n.title,
    course: n.course,
    date: n.created_at,
    duration: n.duration || '00:00',
    keyframes: ((n.id * 7 + 13) % 9) + 3,
    chunkCount: n.points.length + n.definitions.length + n.emphasized.length,
    questions: n.questions,
    status: n.status,
    failReason: n.fail_reason || '',
    theme: n.theme,
    points: n.points.map((p) => ({ text: p.text, cite: p.ref || '' })),
    definitions: n.definitions.map((d) => ({ term: d.term, detail: d.text, cite: d.ref || '' })),
    emphasized: [...n.emphasized],
    transcript: n.transcript || '',
  }
}

export const classNotes = ref<ClassNote[]>([])

// ---------- 拉取纪要（登录后各页面 / 布局挂载时调用，进行中自动去重） ----------
let notesInFlight: Promise<void> | null = null
export function ensureNotesLoaded(): Promise<void> {
  if (isGuest.value) return Promise.resolve()
  if (!notesInFlight) {
    notesInFlight = (async () => {
      try {
        const list = await notesApi.list()
        classNotes.value = list.map(noteFromApi)
        courseList.value = syncCourses(list)
      } finally {
        notesInFlight = null
      }
    })()
  }
  return notesInFlight
}

// ---------- 课程表 ----------
const EXTRA_COURSES_KEY = 'zy_courses_extra'

function loadExtraCourses(): string[] {
  try {
    const raw = localStorage.getItem(EXTRA_COURSES_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

/**
 * 课程表共享状态：纪要涉及的课程 + 工作台里新加的空课程（后者持久化在本地）
 */
export const courseList = ref<string[]>([...loadExtraCourses()])

/** 纪要课程 ∪ 本地新增课程（保持加入顺序） */
function syncCourses(list: ApiNote[]): string[] {
  const out: string[] = [...loadExtraCourses()]
  for (const n of list) {
    if (!out.includes(n.course)) out.push(n.course)
  }
  return out
}

function persistExtraCourses() {
  const fromNotes = new Set(classNotes.value.map((n) => n.course))
  // 只持久化「还没有纪要」的课程；有纪要的课程以后端为准
  localStorage.setItem(
    EXTRA_COURSES_KEY,
    JSON.stringify(courseList.value.filter((c) => !fromNotes.has(c))),
  )
}

/** 新增课程：空名 / 重名返回 false，不重复添加 */
export function addCourse(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed || courseList.value.includes(trimmed)) return false
  courseList.value.push(trimmed)
  persistExtraCourses()
  return true
}

/** 其他页面可见的课程：课程表中名下已有纪要的课程 */
export const activeCourses = computed(() => [...new Set(classNotes.value.map((n) => n.course))])

/**
 * 删除课程：连同该课程名下的全部纪要（问答 / 练习 / 错题由后端级联清除）一并删除
 * 不可恢复，调用方需先弹窗确认
 */
export async function removeCourse(name: string) {
  await notesApi.deleteCourse(name)
  courseList.value = courseList.value.filter((c) => c !== name)
  classNotes.value = classNotes.value.filter((n) => n.course !== name)
  wrongBook.value = wrongBook.value.filter((w) => w.question.course !== name)
  persistExtraCourses()
}

/**
 * 重命名课程：课程表、该课程全部纪要与错题记录同步更新，其他页面随即展示新名称
 */
export async function renameCourse(oldName: string, newName: string): Promise<boolean> {
  const trimmed = newName.trim()
  if (!trimmed || trimmed === oldName) return false
  if (!courseList.value.includes(oldName) || courseList.value.includes(trimmed)) return false
  await notesApi.renameCourse(oldName, trimmed)
  const idx = courseList.value.indexOf(oldName)
  if (idx !== -1) courseList.value[idx] = trimmed
  classNotes.value = classNotes.value.map((n) => (n.course === oldName ? { ...n, course: trimmed } : n))
  for (const w of wrongBook.value) {
    if (w.question.course === oldName) w.question.course = trimmed
  }
  persistExtraCourses()
  return true
}

// ---------- 用户资料（侧边栏用户卡片与个人设置共享） ----------
function mediaUrl(path: string): string {
  // /media/... 直接用同源路径（Vite 已代理到 Django 8080），本机与 ngrok 隧道访问均可用
  return path
}

export const userProfile = reactive({
  name: '',
  email: '',
  phone: '',
  avatar: '', // 头像图片地址（上传预览为 objectURL，登录后为后端媒体地址）
  color: '#5645d4',
})

// 登录资料变化（登录 / SSO 接入 / 资料修改）即时同步到共享资料
watch(
  currentUser,
  (u) => {
    if (!u) return
    userProfile.name = u.name
    userProfile.email = u.email
    userProfile.phone = u.phone
    userProfile.avatar = u.avatar ? mediaUrl(u.avatar) : ''
  },
  { immediate: true },
)

/** 会话内新增 / 更新纪要（生成完成、重新处理完成后调用） */
export function addClassNote(note: ClassNote) {
  classNotes.value = [note, ...classNotes.value.filter((n) => n.id !== note.id)]
  if (!courseList.value.includes(note.course)) courseList.value.push(note.course)
}

export function updateNote(id: string, patch: Partial<ClassNote>) {
  classNotes.value = classNotes.value.map((n) => (n.id === id ? { ...n, ...patch } : n))
}

/** 删除纪要（本地立即移除；调用方负责调用后端删除） */
export function removeClassNote(id: string) {
  classNotes.value = classNotes.value.filter((n) => n.id !== id)
  persistExtraCourses()
}

export function findNote(id: string | null | undefined): ClassNote | undefined {
  if (!id) return undefined
  return classNotes.value.find((n) => n.id === id)
}

// 错题本随纪要一起在进入应用时刷新
void ensureNotesLoaded().then(() => refreshWrongBook())
