/**
 * 自创题练习：类型定义、后端题目映射与抽题逻辑
 * - 题目数据来自后端 /api/quiz/（含答案与解析），本模块负责映射与按条件抽题
 * - pickQuestions 按筛选条件从给定题目池抽题，数量不足时逐级放宽
 */
import type { ApiQuizType } from '@/api'

export type QuizType = 'single' | 'multi' | 'indefinite' | 'judge' | 'blank' | 'short'
export type QuizDifficulty = '简单' | '中等' | '困难'

export interface QuizQuestion {
  id: string
  noteId: string
  course: string
  chapter: string // 章节 = 课堂纪要标题
  type: QuizType
  difficulty: QuizDifficulty
  stem: string
  options?: string[] // 仅选择题（单选 / 多选 / 不定项）
  answer: string // 单选存选项字母；多选 / 不定项存按字母序排列的字母串（如 ABD）；判断题存「对/错」；填空题存答案文本；简答题存参考答案
  analysis: string // 解析
  knowledge: string // 知识点标签
  cite: string // 原始引用，如「录音 03:24」「PPT 第2页」「板书 图1」
  accept?: string[] // 填空题可接受的等价答案（判分时一并匹配）
}

export const QUIZ_TYPE_TEXT: Record<QuizType, string> = {
  single: '单选题',
  multi: '多选题',
  indefinite: '不定项选择题',
  judge: '判断题',
  blank: '填空题',
  short: '简答题',
}

/** 筛选用的题型大类：选择「选择题」后随机包含单选 / 多选 / 不定项三种小题 */
export type QuizTypeGroup = 'choice' | 'judge' | 'blank' | 'short'

export const QUIZ_TYPE_GROUP_TEXT: Record<QuizTypeGroup, string> = {
  choice: '选择题',
  judge: '判断题',
  blank: '填空题',
  short: '简答题',
}

/** 把题型大类展开为具体题型（选择题 → 单选 + 多选 + 不定项），供抽题按具体题型筛选 */
export function expandTypeGroups(groups: QuizTypeGroup[]): QuizType[] {
  const out: QuizType[] = []
  for (const g of groups) {
    if (g === 'choice') out.push('single', 'multi', 'indefinite')
    else out.push(g)
  }
  return out
}

/** 后端题型 → 前端题型（multiple→multi，answer→short） */
export function quizTypeFromApi(t: ApiQuizType): QuizType {
  if (t === 'multiple') return 'multi'
  if (t === 'answer') return 'short'
  return t
}

/** 后端题目 → 页面题目模型（难度 / 来源引用 / 知识点标签由 LLM 出题时生成） */
export function quizFromApi(item: {
  id: number
  note?: number | null
  course: string
  chapter: string
  type: ApiQuizType
  difficulty?: string
  stem: string
  options: string[] | null
  answer: string
  analysis: string
  cite?: string
  knowledge?: string
}): QuizQuestion {
  const diffs: QuizDifficulty[] = ['简单', '中等', '困难']
  return {
    id: String(item.id),
    noteId: item.note != null ? String(item.note) : '',
    course: item.course,
    chapter: item.chapter,
    type: quizTypeFromApi(item.type),
    difficulty: diffs.includes(item.difficulty as QuizDifficulty) ? (item.difficulty as QuizDifficulty) : '中等',
    stem: item.stem,
    options: item.options ?? undefined,
    answer: item.answer,
    analysis: item.analysis,
    knowledge: item.knowledge || item.chapter,
    cite: item.cite || '',
  }
}

/** 来源展示：'录音 03:24' → 来自 3 分 24 秒课堂录音；'PPT 第2页' → 来自第 2 页 PPT；'板书 图1' → 来自课堂板书（图1） */
export function sourceLabel(cite: string): string {
  const audio = /^录音 (\d{1,2}):(\d{2})$/.exec(cite)
  if (audio) return `来自 ${Number(audio[1])} 分 ${Number(audio[2])} 秒课堂录音`
  const ppt = /^PPT 第(\d+)页$/.exec(cite)
  if (ppt) return `来自第 ${ppt[1]} 页 PPT`
  const board = /^板书 (.+)$/.exec(cite)
  if (board) return `来自课堂板书（${board[1]}）`
  return cite ? `来自 ${cite}` : '来自本节课堂纪要'
}

export interface QuizFilter {
  courseId: string
  noteId: string // 'all' 表示该课程全部章节
  types: QuizType[]
  /** 难度子集（可多选）；空数组表示不限难度（「全部」或三档全选） */
  difficulties: QuizDifficulty[]
  count: number
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = arr[i]!
    const b = arr[j]!
    arr[i] = b
    arr[j] = a
  }
  return arr
}

/** 题型优先级：客观题优先，简答题靠后（题量不足放宽补充时先补客观题） */
const PRIORITY_TYPES: QuizType[] = ['single', 'multi', 'indefinite', 'judge', 'blank']

/**
 * 按筛选条件从题目池抽题，数量不足时逐级放宽：
 * 同课程同题型 → 同课程客观题 → 同课程不限题型 → 不限课程。
 * 选了难度子集时难度约束全程保留（逐级放宽只放题型 / 范围，不再拿其他难度凑数）；
 * 不限难度时空数组恒过，兜底行为与旧版一致。
 */
export function pickQuestions(pool: QuizQuestion[], f: QuizFilter): QuizQuestion[] {
  const base = pool.filter((t) => t.course === f.courseId && (f.noteId === 'all' || t.noteId === f.noteId))
  const inDiff = (t: QuizQuestion) => !f.difficulties.length || f.difficulties.includes(t.difficulty)
  const picked = shuffle(base.filter((t) => f.types.includes(t.type) && inDiff(t))).slice(0, f.count)

  if (picked.length < f.count) {
    const got = new Set(picked)
    const take = (candidates: QuizQuestion[]) => {
      for (const t of shuffle(candidates)) {
        if (picked.length >= f.count) break
        got.add(t)
        picked.push(t)
      }
    }
    // 同课程同题型 → 同课程客观题优先 → 同课程不限题型
    const stages: ((t: QuizQuestion) => boolean)[] = [
      (t) => f.types.includes(t.type),
      (t) => PRIORITY_TYPES.includes(t.type),
      () => true,
    ]
    for (const stage of stages) {
      take(base.filter((t) => stage(t) && inDiff(t) && !got.has(t)))
      if (picked.length >= f.count) break
    }
    // 兜底：其他课程（同样尊重难度子集）
    if (picked.length < f.count) take(pool.filter((t) => !got.has(t) && inDiff(t)))
  }

  return picked.slice(0, f.count)
}
