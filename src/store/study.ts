/**
 * 课堂纪要共享 store（模块级 ref 单例，后续可无缝替换为 Pinia / 接口）
 * 工作台生成纪要 → 我的纪要列表 → 追问侧边栏，三处数据实时同步
 */
import { ref } from 'vue'
import { mockNotes, type ClassNote } from '@/mock/data'

export const classNotes = ref<ClassNote[]>([...mockNotes])

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
