/**
 * 自创题练习 store：错题本（全局共享单例）
 * - 数据来自后端 /api/quiz/wrong/：提交批改后答错的题由后端自动记录，这里拉取展示
 * - 重练答对后（后端 submit 判对即删除记录）可移出；「已掌握」直接调删除接口
 * - 累计错误次数后端暂未记录，本地按题目 id 累计（仅作展示）
 * - 练习中新做错的题记入 newWrongIds（页签角标提示新错题数），进入错题本查看后清零
 */
import { ref } from 'vue'

import { quizApi } from '@/api'
import { isGuest } from '@/store/auth'
import { quizFromApi, type QuizQuestion } from '@/mock/quiz'

export interface WrongBookItem {
  /** 后端错题记录 id（移出时调用 DELETE /api/quiz/wrong/{wrId}/） */
  wrId: number
  question: QuizQuestion
  myAnswer: string // 最近一次做错的作答
  addedTime: string // 记入时间
  wrongCount: number // 累计做错次数（本地累计）
}

export const wrongBook = ref<WrongBookItem[]>([])

/** 新错题 id 列表：练习中新做错的题（历史错题不算），用于页签角标提示 */
export const newWrongIds = ref<string[]>([])

/** 进入错题本即视为已读：清空新错题标记，页签角标随之消失 */
export function markWrongBookRead() {
  if (newWrongIds.value.length) newWrongIds.value = []
}

// ---------- 本地错误次数（题目 id → 次数） ----------
const COUNTS_KEY = 'zy_wrong_counts'
function loadCounts(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(COUNTS_KEY) || '{}') as Record<string, number>
  } catch {
    return {}
  }
}
const wrongCounts = loadCounts()
function bumpCount(quizId: string) {
  wrongCounts[quizId] = (wrongCounts[quizId] ?? 0) + 1
  localStorage.setItem(COUNTS_KEY, JSON.stringify(wrongCounts))
}

// ---------- 拉取错题本（提交批改 / 进入应用后刷新） ----------
let wrongInFlight: Promise<void> | null = null
export async function refreshWrongBook(): Promise<void> {
  if (isGuest.value) return
  if (!wrongInFlight) {
    wrongInFlight = (async () => {
      try {
        const list = await quizApi.wrongList()
        wrongBook.value = list.map((w) => ({
          wrId: w.id,
          question: quizFromApi(w.quiz),
          myAnswer: w.my_answer,
          addedTime: w.created_at,
          wrongCount: wrongCounts[w.quiz.id] ?? 1,
        }))
      } finally {
        wrongInFlight = null
      }
    })()
  }
  return wrongInFlight
}

/** 加入错题本（练习中做错）：本地即时呈现，随后与后端对账；已存在则只更新作答与错误次数 */
export function addToWrongBook(q: QuizQuestion, myAnswer: string): boolean {
  const exist = wrongBook.value.find((w) => w.question.id === q.id)
  const time = new Date().toLocaleString('zh-CN', { hour12: false })
  bumpCount(q.id)
  if (exist) {
    exist.myAnswer = myAnswer
    exist.addedTime = time
    exist.wrongCount++
  } else {
    wrongBook.value.unshift({ wrId: 0, question: q, myAnswer, addedTime: time, wrongCount: wrongCounts[q.id] ?? 1 })
  }
  // 无论新旧，练习中再次做错都算「新错题」，角标重新亮起
  if (!newWrongIds.value.includes(q.id)) newWrongIds.value.push(q.id)
  void refreshWrongBook() // 与后端对账，补全 wrId
  return !exist
}

/** 已掌握，移出错题本：后端删除记录，本地同步移除 */
export async function removeFromWrongBook(id: string) {
  const item = wrongBook.value.find((w) => w.question.id === id)
  if (item?.wrId) {
    try {
      await quizApi.wrongRemove(item.wrId)
    } catch {
      // 记录可能已被 submit 判对自动删除，本地照常移除
    }
  }
  wrongBook.value = wrongBook.value.filter((w) => w.question.id !== id)
  newWrongIds.value = newWrongIds.value.filter((n) => n !== id)
}
