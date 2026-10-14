/**
 * 自创题练习 store：错题本（全局共享单例）
 * - 从练习结果一键加入；重练答对后可移出；重复加入只累计错误次数
 * - 练习中新做错的题记入 newWrongIds（页签角标提示新错题数），进入错题本查看后清零
 * - 前端演示数据，后续替换为后端接口
 */
import { ref } from 'vue'
import { QUIZ_BANK, type QuizQuestion } from '@/mock/quiz'

export interface WrongBookItem {
  question: QuizQuestion
  myAnswer: string // 最近一次做错的作答
  addedTime: string // 加入时间
  wrongCount: number // 累计做错次数
}

export const wrongBook = ref<WrongBookItem[]>(seedWrongBook())

/** 新错题 id 列表：练习中新做错的题（预置的历史错题不算），用于页签角标提示 */
export const newWrongIds = ref<string[]>([])

/** 进入错题本即视为已读：清空新错题标记，页签角标随之消失 */
export function markWrongBookRead() {
  if (newWrongIds.value.length) newWrongIds.value = []
}

function seedWrongBook(): WrongBookItem[] {
  // 预置两条历史错题，让错题本筛选 / 重练功能开箱即有内容可演示
  const pick = (noteId: string, knowledge: string) =>
    QUIZ_BANK.find((t) => t.noteId === noteId && t.knowledge === knowledge && t.type === 'single')
  const a = pick('n1', '收敛半径')
  const b = pick('n2', '信号量与PV操作')
  const out: WrongBookItem[] = []
  if (a) out.push({ question: a, myAnswer: 'B', addedTime: '2026-10-12 20:36', wrongCount: 1 })
  if (b) out.push({ question: b, myAnswer: 'A', addedTime: '2026-10-13 21:04', wrongCount: 2 })
  return out
}

/** 加入错题本：已存在则只更新作答与错误次数；返回是否为新加入 */
export function addToWrongBook(q: QuizQuestion, myAnswer: string): boolean {
  const exist = wrongBook.value.find((w) => w.question.id === q.id)
  const time = new Date().toLocaleString('zh-CN', { hour12: false })
  if (exist) {
    exist.myAnswer = myAnswer
    exist.addedTime = time
    exist.wrongCount++
  } else {
    wrongBook.value.unshift({ question: q, myAnswer, addedTime: time, wrongCount: 1 })
  }
  // 无论新旧，练习中再次做错都算「新错题」，角标重新亮起
  if (!newWrongIds.value.includes(q.id)) newWrongIds.value.push(q.id)
  return !exist
}

export function removeFromWrongBook(id: string) {
  wrongBook.value = wrongBook.value.filter((w) => w.question.id !== id)
  newWrongIds.value = newWrongIds.value.filter((n) => n !== id)
}
