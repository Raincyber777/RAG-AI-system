/**
 * 课堂纪要共享 store（模块级 ref 单例，后续可无缝替换为 Pinia / 接口）
 * 工作台生成纪要 → 我的纪要列表 → 追问侧边栏，三处数据实时同步
 */
import { ref, reactive } from 'vue'
import { mockNotes, currentUser, type ClassNote } from '@/mock/data'

export const classNotes = ref<ClassNote[]>([...mockNotes])

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
