/**
 * 课堂纪要共享 store（模块级 ref 单例，后续可无缝替换为 Pinia / 接口）
 * 工作台生成纪要 → 我的纪要列表 → 追问侧边栏，三处数据实时同步
 */
import { ref, reactive, computed } from 'vue'
import { mockNotes, currentUser, type ClassNote } from '@/mock/data'
import { wrongBook } from '@/store/quiz'

export const classNotes = ref<ClassNote[]>([...mockNotes])

/**
 * 课程表共享状态（初始为示例纪要涉及的课程）
 * 工作台新建课程后，「我的纪要」等页面的课程筛选下拉同步可见
 */
export const courseList = ref<string[]>([...new Set(mockNotes.map((n) => n.course))])

/** 新增课程：空名 / 重名返回 false，不重复添加 */
export function addCourse(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed || courseList.value.includes(trimmed)) return false
  courseList.value.push(trimmed)
  return true
}

/**
 * 其他页面可见的课程：课程表中名下已有纪要的课程
 * 新课程在工作台成功生成纪要后，才会同步到我的纪要等页面的课程筛选中
 */
export const activeCourses = computed(() => [...new Set(classNotes.value.map((n) => n.course))])

/**
 * 删除课程：移出课程表，并连带清除该课程名下的全部纪要与错题记录（不可恢复，调用方需先弹窗确认）
 */
export function removeCourse(name: string) {
  courseList.value = courseList.value.filter((c) => c !== name)
  classNotes.value = classNotes.value.filter((n) => n.course !== name)
  wrongBook.value = wrongBook.value.filter((w) => w.question.course !== name)
}

/**
 * 重命名课程：课程表、该课程全部纪要与错题记录同步更新，其他页面随即展示新名称
 */
export function renameCourse(oldName: string, newName: string): boolean {
  const trimmed = newName.trim()
  if (!trimmed || trimmed === oldName) return false
  const idx = courseList.value.indexOf(oldName)
  if (idx === -1 || courseList.value.includes(trimmed)) return false
  courseList.value[idx] = trimmed
  classNotes.value = classNotes.value.map((n) => (n.course === oldName ? { ...n, course: trimmed } : n))
  for (const w of wrongBook.value) {
    if (w.question.course === oldName) w.question.course = trimmed
  }
  return true
}

/**
 * 用户资料共享状态：个人设置修改后，侧边栏用户卡片实时同步
 * phone / avatar 为演示数据，接入后端后由登录信息与上传接口填充
 */
export const userProfile = reactive({
  ...currentUser,
  phone: '13812348678',
  avatar: '', // 头像图片地址（本地预览为 objectURL）
})

let seq = Date.now()

export function addClassNote(note: Omit<ClassNote, 'id' | 'questions'>): ClassNote {
  const full: ClassNote = { ...note, id: 'n' + seq++, questions: 0 }
  classNotes.value = [full, ...classNotes.value]
  return full
}

export function updateNote(id: string, patch: Partial<ClassNote>) {
  classNotes.value = classNotes.value.map((n) => (n.id === id ? { ...n, ...patch } : n))
}

export function removeClassNote(id: string) {
  classNotes.value = classNotes.value.filter((n) => n.id !== id)
}

export function findNote(id: string | null | undefined): ClassNote | undefined {
  if (!id) return undefined
  return classNotes.value.find((n) => n.id === id)
}
