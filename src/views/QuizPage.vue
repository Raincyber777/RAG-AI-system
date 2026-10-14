<script setup lang="ts">
/**
 * 自创题练习：基于已完成的课堂纪要生成练习题并作答
 * 流程：筛选（课程 / 章节 / 题型 / 难度 / 题量；选择题大类随机生成单选 / 多选 / 不定项）
 *      → 生成（模拟 loading + 缓存 + 随机失败重试）
 *      → 逐题作答（单选 / 多选 / 不定项 / 判断 / 填空 / 简答）→ 批改（对错 / 正确答案 / 解析 / 知识点）
 *      → 错题一键加入错题本；页签角标只提示「新错题」个数，进入错题本查看后即消失
 *      → 错题本支持按课程 / 章节筛选重练，点击错题卡片可查看题目详情，列表分页展示
 * 接入真实后端后：startGenerate 内替换为 POST /quiz/generate（SSE 进度），批改走 /quiz/grade
 */
import { ref, reactive, computed, watch, onBeforeUnmount } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import AppSelect from '@/components/AppSelect.vue'
import { classNotes } from '@/store/study'
import {
  QUIZ_TYPE_TEXT,
  QUIZ_TYPE_GROUP_TEXT,
  expandTypeGroups,
  sourceLabel,
  getCachedQuiz,
  generateQuiz,
  type QuizQuestion,
  type QuizType,
  type QuizTypeGroup,
  type QuizDifficulty,
  type QuizFilter,
} from '@/mock/quiz'
import { wrongBook, newWrongIds, markWrongBookRead, addToWrongBook, removeFromWrongBook, type WrongBookItem } from '@/store/quiz'

// ---------- 顶部页签 ----------
const tab = ref<'practice' | 'wrong'>('practice')
/** 页签角标：只显示新错题（练习中新做错）的个数，进入错题本查看后清零消失 */
const newWrongCount = computed(() => newWrongIds.value.length)
watch(tab, (t) => {
  if (t === 'wrong') markWrongBookRead()
})

// ---------- 可选课程 / 章节（仅已完成课堂可出题） ----------
const doneNotes = computed(() => classNotes.value.filter((n) => n.status === 'done'))
const courses = computed(() => [...new Set(doneNotes.value.map((n) => n.course))])
const notesOfCourse = computed(() => doneNotes.value.filter((n) => n.course === courseId.value))
const courseOptions = computed(() => courses.value.map((c) => ({ label: c, value: c })))
const noteOptions = computed(() => [
  { label: '全部章节', value: 'all' },
  ...notesOfCourse.value.map((n) => ({ label: n.title, value: n.id })),
])

// ---------- 筛选条件（题型按大类筛选，选择题大类随机包含单选 / 多选 / 不定项） ----------
const QUIZ_TYPE_GROUPS: QuizTypeGroup[] = ['choice', 'judge', 'blank', 'short']
const DIFFICULTIES: (QuizDifficulty | '全部')[] = ['全部', '简单', '中等', '困难']
const COUNTS = [5, 10, 15]

const courseId = ref(courses.value[0] ?? '')
const noteId = ref('all')
const types = ref<QuizTypeGroup[]>(['choice', 'judge', 'blank'])
const difficulty = ref<QuizDifficulty | '全部'>('全部')
const count = ref(10)

watch(courseId, () => {
  noteId.value = 'all'
})

function toggleType(t: QuizTypeGroup) {
  if (genState.value === 'generating') return
  const i = types.value.indexOf(t)
  if (i >= 0) {
    if (types.value.length > 1) types.value.splice(i, 1) // 至少保留一种题型
  } else {
    types.value.push(t)
  }
}

// ---------- 生成（模拟接口：进度动画 + 缓存命中 + 随机失败） ----------
const GEN_STEPS = ['正在检索课堂知识片段…', '正在提炼可考点…', '正在生成交互题目…', '正在匹配来源引用…']
const genState = ref<'idle' | 'generating' | 'error'>('idle')
const progress = ref(0)
const genStep = ref(GEN_STEPS[0])
const errorMsg = ref('')
const fromCache = ref(false)
let progressTimer: number | undefined
let finishTimer: number | undefined

function filterObj(): QuizFilter {
  // 选择题大类先展开为具体题型（单选 / 多选 / 不定项），再请求生成
  return { courseId: courseId.value, noteId: noteId.value, types: expandTypeGroups([...types.value]), difficulty: difficulty.value, count: count.value }
}

function startGenerate(force: boolean) {
  if (genState.value === 'generating') return
  clearTimers()
  genState.value = 'generating'
  progress.value = 0
  errorMsg.value = ''
  fromCache.value = false
  const hasCache = !force && !!getCachedQuiz(filterObj())
  const duration = hasCache ? 600 : 1400 + Math.random() * 900
  progressTimer = window.setInterval(() => {
    progress.value = Math.min(96, progress.value + (100 / duration) * 120)
    genStep.value = GEN_STEPS[Math.min(GEN_STEPS.length - 1, Math.floor(progress.value / 26))] ?? GEN_STEPS[0]
  }, 120)
  finishTimer = window.setTimeout(() => {
    clearTimers()
    // 演示：无缓存时约 12% 概率模拟生成失败，展示错误提示与重试按钮
    if (!hasCache && Math.random() < 0.12) {
      genState.value = 'error'
      errorMsg.value = '题目生成超时，请稍后重试'
      return
    }
    const res = generateQuiz(filterObj(), { force })
    loadSession(res.questions, 'normal')
    fromCache.value = res.fromCache
    genState.value = 'idle'
  }, duration)
}

function clearTimers() {
  if (progressTimer) {
    window.clearInterval(progressTimer)
    progressTimer = undefined
  }
  if (finishTimer) {
    window.clearTimeout(finishTimer)
    finishTimer = undefined
  }
}
onBeforeUnmount(clearTimers)

// ---------- 答题会话 ----------
const questions = ref<QuizQuestion[]>([])
const sessionMode = ref<'normal' | 'wrongbook'>('normal')
const answers = reactive<Record<string, string>>({})
const graded = reactive<Record<string, { right: boolean | null; my: string }>>({})
const current = ref(0)

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']
const letter = (i: number) => LETTERS[i] ?? ''
const optText = (opt: string) => opt.replace(/^[A-F]\.\s*/, '')
const diffTag: Record<QuizDifficulty, string> = { 简单: 'tag-green', 中等: 'tag-orange', 困难: 'tag-red' }
const sourceIcon = (cite: string) => (cite.startsWith('录音') ? 'headphones' : cite.startsWith('PPT') ? 'file' : 'edit')

const curQ = computed(() => questions.value[current.value])
const submittedCount = computed(() => questions.value.filter((q) => !!graded[q.id]).length)
const rightCount = computed(() => questions.value.filter((q) => graded[q.id]?.right === true).length)
const wrongCount = computed(() => questions.value.filter((q) => graded[q.id]?.right === false).length)
const pendingGradeCount = computed(() => questions.value.filter((q) => graded[q.id]?.right === null).length)
const allGraded = computed(() => questions.value.length > 0 && questions.value.every((q) => !!graded[q.id]))
const accuracy = computed(() => {
  const total = rightCount.value + wrongCount.value
  return total ? Math.round((rightCount.value / total) * 100) : null
})

/** 载入一组题目开始作答（重置作答与批改记录） */
function loadSession(qs: QuizQuestion[], mode: 'normal' | 'wrongbook') {
  questions.value = qs
  sessionMode.value = mode
  for (const k of Object.keys(answers)) delete answers[k]
  for (const k of Object.keys(graded)) delete graded[k]
  current.value = 0
}

// ---------- 作答与批改 ----------
function isGraded(q: QuizQuestion) {
  return !!graded[q.id]
}
function canGradeOne(q: QuizQuestion) {
  return !!(answers[q.id] ?? '').trim()
}
/** 多选 / 不定项答案归一：提取 A-F 字母、去重、按字母序排列后比较 */
const normLetters = (s: string) => [...new Set(s.toUpperCase().match(/[A-F]/g) ?? [])].sort().join('')
/** 判分：单选 / 判断精确匹配；多选 / 不定项按字母集合比较（漏选、错选均判为答错）；填空题忽略空格大小写并接受等价答案 */
function checkAnswer(q: QuizQuestion, my: string): boolean {
  if (q.type === 'single' || q.type === 'judge') return my === q.answer
  if (q.type === 'multi' || q.type === 'indefinite') return normLetters(my) === normLetters(q.answer)
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase().replace(/₂/g, '2')
  const mine = norm(my)
  if (mine === norm(q.answer)) return true
  return (q.accept ?? []).some((a) => norm(a) === mine)
}
/** 写入批改结果；错题重练模式下答错自动累计进错题本 */
function applyGrade(q: QuizQuestion, right: boolean | null, my: string) {
  graded[q.id] = { right, my }
  if (sessionMode.value === 'wrongbook' && right === false) addToWrongBook(q, my)
}
function gradeOne(q: QuizQuestion) {
  if (graded[q.id]) return
  const my = (answers[q.id] ?? '').trim()
  if (!my) return
  applyGrade(q, q.type === 'short' ? null : checkAnswer(q, my), my)
}
function selfGrade(q: QuizQuestion, right: boolean) {
  const g = graded[q.id]
  if (!g || g.right !== null) return
  applyGrade(q, right, g.my)
}
function submitAll() {
  for (const q of questions.value) {
    if (graded[q.id]) continue
    const my = (answers[q.id] ?? '').trim()
    applyGrade(q, q.type === 'short' ? null : my ? checkAnswer(q, my) : false, my)
  }
}

function resultClass(q: QuizQuestion) {
  const r = graded[q.id]?.right
  if (r === true) return 'rp-right'
  if (r === false) return 'rp-wrong'
  return 'rp-pending'
}
function resultText(q: QuizQuestion) {
  const g = graded[q.id]
  if (!g) return ''
  if (g.right === null) return '待自评'
  if (g.right === true) return '回答正确'
  return g.my ? '回答错误' : '未作答'
}
function choiceClass(q: QuizQuestion, val: string) {
  const g = graded[q.id]
  const my = answers[q.id] ?? ''
  // 多选 / 不定项：批改后正确选项标绿、自己选错的标红；作答前按选中态高亮
  if (q.type === 'multi' || q.type === 'indefinite') {
    const ansSet = new Set(normLetters(q.answer).split(''))
    const mySet = new Set(normLetters(my).split(''))
    if (g) {
      if (ansSet.has(val)) return 'correct'
      if (mySet.has(val)) return 'incorrect'
      return ''
    }
    return mySet.has(val) ? 'selected' : ''
  }
  if (g) {
    if (val === q.answer) return 'correct'
    if (my === val) return 'incorrect'
    return ''
  }
  return my === val ? 'selected' : ''
}
/** 是否选择题：单选 / 多选 / 不定项共用选项列表 */
const isChoice = (t: QuizType) => t === 'single' || t === 'multi' || t === 'indefinite'
/** 选项点击：单选直接选中；多选 / 不定项切换选中状态（字母按序组合，作答后不可更改） */
function pickChoice(q: QuizQuestion, val: string) {
  if (isGraded(q)) return
  if (q.type === 'multi' || q.type === 'indefinite') {
    const set = new Set((answers[q.id] ?? '').split(''))
    if (set.has(val)) set.delete(val)
    else set.add(val)
    answers[q.id] = [...set].sort().join('')
  } else {
    answers[q.id] = val
  }
}
function pillClass(q: QuizQuestion, i: number) {
  const g = graded[q.id]
  return {
    active: i === current.value,
    right: g?.right === true,
    wrong: g?.right === false,
    pending: g?.right === null,
    answered: !g && !!(answers[q.id] ?? '').trim(),
  }
}

// ---------- 错题本联动 ----------
const inBookIds = computed(() => new Set(wrongBook.value.map((w) => w.question.id)))
const isWrongAdded = (q: QuizQuestion) => inBookIds.value.has(q.id)
const wrongCountOf = (id: string) => wrongBook.value.find((w) => w.question.id === id)?.wrongCount ?? 0
function addWrong(q: QuizQuestion) {
  addToWrongBook(q, graded[q.id]?.my ?? '')
}
function mastered(q: QuizQuestion) {
  removeFromWrongBook(q.id)
}

// ---------- 错题重练 ----------
function practiceItems(items: WrongBookItem[]) {
  if (!items.length) return
  loadSession(
    items.map((w) => w.question),
    'wrongbook',
  )
  tab.value = 'practice'
}
function retrySession() {
  loadSession([...questions.value], sessionMode.value)
}

// ---------- 错题本筛选（章节与练习页的「章节 / 知识点」口径一致：按纪要章节归类） ----------
const wCourse = ref('')
const wChapter = ref('')
const wCourses = computed(() => [...new Set(wrongBook.value.map((w) => w.question.course))])
const wChapters = computed(() => {
  const pool = wCourse.value ? wrongBook.value.filter((w) => w.question.course === wCourse.value) : wrongBook.value
  return [...new Set(pool.map((w) => w.question.chapter))]
})
const wFiltered = computed(() =>
  wrongBook.value.filter(
    (w) => (!wCourse.value || w.question.course === wCourse.value) && (!wChapter.value || w.question.chapter === wChapter.value),
  ),
)
const wCourseOptions = computed(() => [{ label: '全部课程', value: '' }, ...wCourses.value.map((c) => ({ label: c, value: c }))])
const wChapterOptions = computed(() => [{ label: '全部章节', value: '' }, ...wChapters.value.map((k) => ({ label: k, value: k }))])
watch(wCourse, () => {
  wChapter.value = ''
})

// ---------- 移出错题本（确认弹窗） ----------
const removeTarget = ref<WrongBookItem | null>(null)
function confirmRemove() {
  if (removeTarget.value) removeFromWrongBook(removeTarget.value.question.id)
  removeTarget.value = null
}

// ---------- 错题本分页（错题记录会越来越多，每页 10 / 20 / 30 条） ----------
const W_PAGE_SIZES = [10, 20, 30]
const wPage = ref(1)
const wPageSize = ref(10)
const wTotalPages = computed(() => Math.max(1, Math.ceil(wFiltered.value.length / wPageSize.value)))
const wPaged = computed(() => {
  const start = (wPage.value - 1) * wPageSize.value
  return wFiltered.value.slice(start, start + wPageSize.value)
})
// 切换筛选条件回到第一页；换每页条数或删减错题后页码越界则收敛到最后一页
watch([wCourse, wChapter], () => {
  wPage.value = 1
})
watch([wPageSize, () => wFiltered.value.length], () => {
  if (wPage.value > wTotalPages.value) wPage.value = wTotalPages.value
})
// 页码按钮序列：页数多时用省略号折叠
const wPageNums = computed<(number | '…')[]>(() => {
  const t = wTotalPages.value
  const c = wPage.value
  if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1)
  const picked = [...new Set([1, 2, c - 1, c, c + 1, t - 1, t])].filter((n) => n >= 1 && n <= t).sort((a, b) => a - b)
  const out: (number | '…')[] = []
  let prev = 0
  for (const n of picked) {
    if (n - prev > 1) out.push('…')
    out.push(n)
    prev = n
  }
  return out
})

// ---------- 错题详情（点击错题卡片任意处查看，内容与练习中的题目详情一致） ----------
const detailTarget = ref<WrongBookItem | null>(null)
/** 详情中的选项高亮：正确选项标绿，自己上次选错的标红 */
function wChoiceClass(w: WrongBookItem, val: string) {
  const q = w.question
  if (q.type === 'judge') {
    if (val === q.answer) return 'correct'
    if (val === w.myAnswer) return 'incorrect'
    return ''
  }
  const ansSet = new Set(normLetters(q.answer).split(''))
  const mySet = new Set(normLetters(w.myAnswer).split(''))
  if (ansSet.has(val)) return 'correct'
  if (mySet.has(val)) return 'incorrect'
  return ''
}
/** 详情中直接重练这道题 */
function detailPractice() {
  if (!detailTarget.value) return
  practiceItems([detailTarget.value])
  detailTarget.value = null
}
/** 详情中发起移出（进入确认弹窗） */
function detailRemove() {
  if (!detailTarget.value) return
  removeTarget.value = detailTarget.value
  detailTarget.value = null
}
</script>

<template>
  <div class="page">
    <header class="mb-md">
      <h1 class="h2">自创题练习</h1>
      <p class="text-sm">基于已完成的课堂纪要自动出题，作答后立即查看解析，错题一键加入错题本</p>
    </header>

    <div class="stack">
      <!-- 页签：练习 / 错题本 -->
      <div class="quiz-tabs">
        <button class="qtab" :class="{ active: tab === 'practice' }" type="button" @click="tab = 'practice'">
          <AppIcon name="edit" :size="15" /> 练习
        </button>
        <button class="qtab" :class="{ active: tab === 'wrong' }" type="button" @click="tab = 'wrong'">
          <AppIcon name="book" :size="15" /> 错题本
          <span v-if="newWrongCount" class="qtab-badge">{{ newWrongCount }}</span>
        </button>
      </div>

      <!-- ==================== 练习 ==================== -->
      <template v-if="tab === 'practice'">
        <!-- 顶部筛选区 -->
        <section class="card card-lg">
          <div class="h4 mb-sm"><AppIcon name="sliders" :size="16" /> 出题范围</div>
          <div class="filter-grid">
            <div class="field">
              <label class="field-label">课程</label>
              <AppSelect v-model="courseId" :options="courseOptions" :disabled="genState === 'generating'" aria-label="选择课程" />
            </div>
            <div class="field">
              <label class="field-label">章节 / 知识点</label>
              <AppSelect v-model="noteId" :options="noteOptions" :disabled="genState === 'generating'" aria-label="选择章节 / 知识点" />
            </div>
            <div class="field span-2">
              <label class="field-label">题型（可多选，选择题随机生成单选 / 多选 / 不定项）</label>
              <div class="pill-tabs">
                <button
                  v-for="g in QUIZ_TYPE_GROUPS"
                  :key="g"
                  class="pill-tab"
                  :class="{ active: types.includes(g) }"
                  type="button"
                  :disabled="genState === 'generating'"
                  @click="toggleType(g)"
                >{{ QUIZ_TYPE_GROUP_TEXT[g] }}</button>
              </div>
            </div>
            <div class="field span-2 f-row">
              <div>
                <label class="field-label">难度</label>
                <div class="pill-tabs">
                  <button
                    v-for="d in DIFFICULTIES"
                    :key="d"
                    class="pill-tab"
                    :class="{ active: difficulty === d }"
                    type="button"
                    :disabled="genState === 'generating'"
                    @click="difficulty = d"
                  >{{ d }}</button>
                </div>
              </div>
              <div>
                <label class="field-label">题量</label>
                <div class="pill-tabs">
                  <button
                    v-for="c in COUNTS"
                    :key="c"
                    class="pill-tab"
                    :class="{ active: count === c }"
                    type="button"
                    :disabled="genState === 'generating'"
                    @click="count = c"
                  >{{ c }} 题</button>
                </div>
              </div>
            </div>
          </div>
          <div class="gen-row">
            <p v-if="fromCache" class="field-hint ok-hint"><AppIcon name="check" :size="13" /> 已使用上次生成的题目缓存，可在上方调整条件重新出题</p>
            <p v-else class="field-hint">题目将基于所选课堂的纪要内容生成，每道题都标注来源出处</p>
            <button class="btn btn-primary" type="button" :disabled="genState === 'generating'" @click="startGenerate(false)">
              <AppIcon name="spark" :size="15" /> 生成题目
            </button>
          </div>
        </section>

        <!-- 题目生成状态区：加载动画 / 失败重试 / 空态提示 -->
        <section v-if="genState === 'generating'" class="card card-lg gen-status">
          <span class="spinner spinner-lg"></span>
          <div class="gs-main">
            <div class="gs-title">正在生成题目</div>
            <div class="gs-step text-sm">{{ genStep }}</div>
            <div class="bar"><div class="bar-fill" :style="{ width: progress + '%' }"></div></div>
          </div>
          <span class="gs-pct text-caption">{{ Math.round(progress) }}%</span>
        </section>
        <section v-else-if="genState === 'error'" class="card card-lg gen-error">
          <div class="ge-ico"><AppIcon name="alert" :size="20" /></div>
          <div class="gs-main">
            <div class="gs-title">题目生成失败</div>
            <p class="text-sm">{{ errorMsg }}（演示环境会随机模拟生成失败，可点击重试）</p>
          </div>
          <button class="btn btn-primary" type="button" @click="startGenerate(false)">
            <AppIcon name="refresh" :size="14" /> 重试
          </button>
        </section>
        <section v-else-if="!questions.length" class="card card-lg empty-hint">
          <div class="eh-ico"><AppIcon name="edit" :size="20" /></div>
          <div class="gs-main">
            <div class="gs-title">还没有题目</div>
            <p class="text-sm">选择课程、章节与题型后点击「生成题目」，题目会基于对应课堂的纪要内容生成并标注来源。</p>
          </div>
        </section>

        <!-- 题目列表区 -->
        <template v-else>
          <!-- 进度条与题号导航 -->
          <section class="card quiz-progress">
            <div class="qp-pills">
              <button
                v-for="(q, i) in questions"
                :key="q.id"
                class="qpill"
                :class="pillClass(q, i)"
                type="button"
                :aria-label="'跳转到第 ' + (i + 1) + ' 题'"
                @click="current = i"
              >{{ i + 1 }}</button>
            </div>
            <div class="qp-meta">
              <span class="text-caption">已提交 {{ submittedCount }} / {{ questions.length }}</span>
              <span v-if="sessionMode === 'wrongbook'" class="tag tag-blue">错题重练</span>
              <button v-else class="btn btn-secondary btn-sm" type="button" @click="startGenerate(true)">
                <AppIcon name="refresh" :size="13" /> 重新生成题目
              </button>
            </div>
          </section>

          <!-- 当前题目 -->
          <section v-if="curQ" class="card card-lg q-card">
            <div class="q-top">
              <span class="q-no">第 {{ current + 1 }} / {{ questions.length }} 题</span>
              <span class="tag tag-purple">{{ QUIZ_TYPE_TEXT[curQ.type] }}</span>
              <span class="tag" :class="diffTag[curQ.difficulty]">{{ curQ.difficulty }}</span>
            </div>
            <div class="q-stem">{{ curQ.stem }}</div>
            <div class="q-source">
              <AppIcon :name="sourceIcon(curQ.cite)" :size="12" />
              {{ sourceLabel(curQ.cite) }} · 来自「{{ curQ.chapter }}」
            </div>

            <!-- 选择题：单选点击即选中；多选 / 不定项点击切换，字母按序组合 -->
            <div v-if="isChoice(curQ.type)" class="opt-list">
              <div v-if="curQ.type !== 'single'" class="choice-hint">
                <AppIcon name="info" :size="13" />
                <span>
                  {{ curQ.type === 'multi' ? '多选题：选出所有正确选项，漏选、错选均判为答错' : '不定项选择题：正确选项可能为一个或多个，漏选、错选均判为答错' }}
                  <template v-if="!isGraded(curQ)">· 已选 {{ (answers[curQ.id] ?? '').length }} 项</template>
                </span>
              </div>
              <button
                v-for="(opt, oi) in curQ.options ?? []"
                :key="oi"
                class="opt"
                :class="choiceClass(curQ, letter(oi))"
                type="button"
                :disabled="isGraded(curQ)"
                @click="pickChoice(curQ, letter(oi))"
              >
                <span class="opt-letter">{{ letter(oi) }}</span>
                <span>{{ optText(opt) }}</span>
              </button>
            </div>

            <!-- 判断题 -->
            <div v-else-if="curQ.type === 'judge'" class="opt-list judge-list">
              <button
                v-for="v in ['对', '错']"
                :key="v"
                class="opt judge-opt"
                :class="choiceClass(curQ, v)"
                type="button"
                :disabled="isGraded(curQ)"
                @click="answers[curQ.id] = v"
              >
                <AppIcon :name="v === '对' ? 'check' : 'x'" :size="15" /> {{ v }}
              </button>
            </div>

            <!-- 填空题 -->
            <input
              v-else-if="curQ.type === 'blank'"
              v-model="answers[curQ.id]"
              class="input blank-input"
              placeholder="输入你的答案，回车提交本题"
              :disabled="isGraded(curQ)"
              @keydown.enter.prevent="gradeOne(curQ)"
            />

            <!-- 简答题 -->
            <textarea
              v-else
              v-model="answers[curQ.id]"
              class="textarea"
              rows="4"
              placeholder="写下你的答案，提交后对照参考答案自评"
              :disabled="isGraded(curQ)"
            ></textarea>

            <!-- 切换与提交 -->
            <div class="q-nav">
              <button class="btn btn-secondary" type="button" :disabled="current === 0" @click="current--">
                <AppIcon name="chevron-left" :size="14" /> 上一题
              </button>
              <div class="q-nav-right">
                <button v-if="current < questions.length - 1" class="btn btn-secondary" type="button" @click="current++">
                  下一题 <AppIcon name="chevron-right" :size="14" />
                </button>
                <button v-if="!isGraded(curQ)" class="btn btn-primary" type="button" :disabled="!canGradeOne(curQ)" @click="gradeOne(curQ)">
                  提交本题
                </button>
                <button v-if="!allGraded" class="btn btn-secondary" type="button" @click="submitAll">提交全部答案</button>
              </div>
            </div>

            <!-- 答题结果区：对错 / 正确答案 / 解析 / 知识点 / 错题本 -->
            <div v-if="isGraded(curQ)" class="result-panel" :class="resultClass(curQ)">
              <div class="rp-head">
                <span class="rp-badge">
                  <AppIcon :name="graded[curQ.id]?.right === true ? 'check' : graded[curQ.id]?.right === false ? 'x' : 'edit'" :size="14" />
                  {{ resultText(curQ) }}
                </span>
                <span class="tag tag-purple">{{ curQ.knowledge }}</span>
              </div>

              <!-- 简答题：自评 -->
              <div v-if="curQ.type === 'short' && graded[curQ.id]?.right === null" class="rp-self">
                <span class="text-sm">对照参考答案，给自己评个分：</span>
                <button class="btn btn-secondary btn-sm" type="button" @click="selfGrade(curQ, true)">
                  <AppIcon name="check" :size="13" /> 答对了
                </button>
                <button class="btn btn-secondary btn-sm" type="button" @click="selfGrade(curQ, false)">
                  <AppIcon name="x" :size="13" /> 答错了
                </button>
              </div>

              <div class="rp-grid" :class="{ stacked: curQ.type === 'short' }">
                <div>
                  <div class="rp-label">{{ curQ.type === 'short' ? '我的作答' : '我的答案' }}</div>
                  <div class="rp-value" :class="{ empty: !graded[curQ.id]?.my }">{{ graded[curQ.id]?.my || '未作答' }}</div>
                </div>
                <div>
                  <div class="rp-label">{{ curQ.type === 'short' ? '参考答案' : '正确答案' }}</div>
                  <div class="rp-value strong">{{ curQ.answer }}</div>
                </div>
              </div>

              <div>
                <div class="rp-label">解析</div>
                <p class="rp-analysis">{{ curQ.analysis }}</p>
              </div>

              <div class="rp-foot">
                <span class="q-source">
                  <AppIcon :name="sourceIcon(curQ.cite)" :size="12" />
                  {{ sourceLabel(curQ.cite) }} · {{ curQ.chapter }}
                </span>
                <span v-if="sessionMode === 'wrongbook' && graded[curQ.id]?.right === false" class="text-caption">
                  已记入错题本 · 累计错误 {{ wrongCountOf(curQ.id) }} 次
                </span>
                <!-- 错题重练：答对可移出错题本 -->
                <button
                  v-if="sessionMode === 'wrongbook' && graded[curQ.id]?.right === true && isWrongAdded(curQ)"
                  class="btn btn-secondary btn-sm"
                  type="button"
                  @click="mastered(curQ)"
                >
                  <AppIcon name="check" :size="13" /> 已掌握，移出错题本
                </button>
                <!-- 普通练习：答错一键加入错题本 -->
                <button
                  v-if="sessionMode === 'normal' && graded[curQ.id]?.right === false"
                  class="btn btn-secondary btn-sm"
                  type="button"
                  :disabled="isWrongAdded(curQ)"
                  @click="addWrong(curQ)"
                >
                  <AppIcon :name="isWrongAdded(curQ) ? 'check' : 'plus'" :size="13" />
                  {{ isWrongAdded(curQ) ? '已在错题本' : '加入错题本' }}
                </button>
              </div>
            </div>
          </section>

          <!-- 成绩横幅 -->
          <section v-if="allGraded" class="card card-lg banner">
            <div>
              <div class="bn-title"><AppIcon name="flag" :size="16" /> 本次练习完成</div>
              <div class="bn-stats text-sm">
                答对 <b class="c-ok">{{ rightCount }}</b> 题 · 答错 <b class="c-err">{{ wrongCount }}</b> 题
                <template v-if="pendingGradeCount"> · 待自评 <b>{{ pendingGradeCount }}</b> 题</template>
                <template v-if="accuracy !== null"> · 正确率 <b>{{ accuracy }}%</b></template>
              </div>
            </div>
            <div class="bn-actions">
              <template v-if="sessionMode === 'normal'">
                <button class="btn btn-primary" type="button" @click="startGenerate(true)">
                  <AppIcon name="refresh" :size="14" /> 重新生成题目
                </button>
              </template>
              <template v-else>
                <button class="btn btn-secondary" type="button" @click="tab = 'wrong'">返回错题本</button>
                <button class="btn btn-primary" type="button" @click="retrySession">
                  <AppIcon name="refresh" :size="14" /> 再练一遍
                </button>
              </template>
            </div>
          </section>
        </template>
      </template>

      <!-- ==================== 错题本 ==================== -->
      <template v-else>
        <section class="card card-lg">
          <div class="w-head">
            <div class="h4"><AppIcon name="book" :size="16" /> 错题本</div>
            <button v-if="wFiltered.length" class="btn btn-primary btn-sm" type="button" @click="practiceItems(wFiltered)">
              <AppIcon name="refresh" :size="13" /> 重练全部（{{ wFiltered.length }} 题）
            </button>
          </div>
          <div class="w-filters">
            <AppSelect v-model="wCourse" :options="wCourseOptions" class="w-select" aria-label="按课程筛选错题" />
            <AppSelect v-model="wChapter" :options="wChapterOptions" class="w-select" aria-label="按章节筛选错题" />
          </div>

          <div v-if="wFiltered.length" class="w-list">
            <!-- 点击卡片任意处查看题目详情（内部按钮除外） -->
            <div
              v-for="w in wPaged"
              :key="w.question.id"
              class="w-item"
              role="button"
              tabindex="0"
              aria-label="查看错题详情"
              @click="detailTarget = w"
              @keydown.enter="detailTarget = w"
            >
              <div class="w-top">
                <div class="flex items-center gap-xs flex-wrap">
                  <span class="tag">{{ QUIZ_TYPE_TEXT[w.question.type] }}</span>
                  <span class="tag" :class="diffTag[w.question.difficulty]">{{ w.question.difficulty }}</span>
                </div>
                <div class="flex items-center gap-xs">
                  <span class="text-caption">已错 {{ w.wrongCount }} 次</span>
                  <button class="icon-btn danger" type="button" title="移出错题本" @click.stop="removeTarget = w">
                    <AppIcon name="trash" :size="14" />
                  </button>
                </div>
              </div>
              <div class="w-stem">{{ w.question.stem }}</div>
              <div class="w-ans text-sm">
                <span class="w-mine">我的答案：{{ w.myAnswer || '未作答' }}</span>
                <span class="w-right">正确答案：{{ w.question.answer }}</span>
              </div>
              <div class="w-foot">
                <span class="q-source">
                  <AppIcon :name="sourceIcon(w.question.cite)" :size="12" />
                  {{ sourceLabel(w.question.cite) }} · {{ w.question.chapter }}
                </span>
                <div class="flex items-center gap-sm">
                  <span class="text-caption">{{ w.addedTime }}</span>
                  <button class="btn btn-secondary btn-sm" type="button" @click.stop="practiceItems([w])">
                    <AppIcon name="refresh" :size="13" /> 重新练习
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 分页：每页 10 / 20 / 30 条 -->
          <div v-if="wFiltered.length" class="pager">
            <div class="pager-size">
              <span class="text-caption">每页</span>
              <div class="pill-tabs">
                <button
                  v-for="s in W_PAGE_SIZES"
                  :key="s"
                  type="button"
                  class="pill-tab"
                  :class="{ active: wPageSize === s }"
                  @click="wPageSize = s"
                >{{ s }}</button>
              </div>
              <span class="text-caption">共 {{ wFiltered.length }} 条 · 第 {{ wPage }}/{{ wTotalPages }} 页</span>
            </div>
            <div v-if="wTotalPages > 1" class="pager-nav">
              <button class="pager-btn" type="button" :disabled="wPage === 1" aria-label="上一页" @click="wPage--">
                <AppIcon name="chevron-left" :size="14" />
              </button>
              <template v-for="(n, i) in wPageNums" :key="i">
                <span v-if="n === '…'" class="pager-dots">…</span>
                <button v-else class="pager-num" type="button" :class="{ active: n === wPage }" @click="wPage = n">{{ n }}</button>
              </template>
              <button class="pager-btn" type="button" :disabled="wPage === wTotalPages" aria-label="下一页" @click="wPage++">
                <AppIcon name="chevron-right" :size="14" />
              </button>
            </div>
          </div>
          <p v-else-if="wrongBook.length" class="text-sm empty-tip">当前筛选条件下没有错题，换一个课程或章节试试</p>
          <div v-else class="empty-state">
            <div class="empty-ico"><AppIcon name="book" :size="24" /></div>
            <p class="h4">错题本还是空的</p>
            <p class="text-sm muted">练习中答错的题可以一键加入错题本，支持按课程 / 章节筛选重练</p>
          </div>
        </section>
      </template>
    </div>

    <!-- 移出错题本确认弹窗 -->
    <div v-if="removeTarget" class="modal-mask" @click.self="removeTarget = null">
      <div class="modal modal-sm">
        <div class="modal-title">移出错题本</div>
        <p class="modal-sub">确定移出这道{{ QUIZ_TYPE_TEXT[removeTarget.question.type] }}吗？移出后如果再做错，会重新加入错题本。</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" @click="removeTarget = null">取消</button>
          <button class="btn btn-danger" type="button" @click="confirmRemove">确认移出</button>
        </div>
      </div>
    </div>

    <!-- 错题详情弹窗：点击错题卡片任意处打开，内容与练习中的题目详情一致 -->
    <div v-if="detailTarget" class="modal-mask" @click.self="detailTarget = null">
      <div class="modal modal-lg">
        <div class="wd-head">
          <div class="flex items-center gap-xs flex-wrap">
            <span class="tag">{{ QUIZ_TYPE_TEXT[detailTarget.question.type] }}</span>
            <span class="tag" :class="diffTag[detailTarget.question.difficulty]">{{ detailTarget.question.difficulty }}</span>
            <span class="tag tag-purple">{{ detailTarget.question.knowledge }}</span>
          </div>
          <button class="icon-btn" type="button" aria-label="关闭详情" @click="detailTarget = null">
            <AppIcon name="x" :size="15" />
          </button>
        </div>
        <div class="q-stem">{{ detailTarget.question.stem }}</div>
        <div class="q-source">
          <AppIcon :name="sourceIcon(detailTarget.question.cite)" :size="12" />
          {{ sourceLabel(detailTarget.question.cite) }} · 来自「{{ detailTarget.question.chapter }}」
        </div>

        <!-- 选择题选项：正确选项标绿，自己上次选错的标红 -->
        <div v-if="isChoice(detailTarget.question.type)" class="opt-list">
          <button
            v-for="(opt, oi) in detailTarget.question.options ?? []"
            :key="oi"
            class="opt"
            :class="wChoiceClass(detailTarget, letter(oi))"
            type="button"
            disabled
          >
            <span class="opt-letter">{{ letter(oi) }}</span>
            <span>{{ optText(opt) }}</span>
          </button>
        </div>
        <!-- 判断题选项 -->
        <div v-else-if="detailTarget.question.type === 'judge'" class="opt-list judge-list">
          <button
            v-for="v in ['对', '错']"
            :key="v"
            class="opt judge-opt"
            :class="wChoiceClass(detailTarget, v)"
            type="button"
            disabled
          >
            <AppIcon :name="v === '对' ? 'check' : 'x'" :size="15" /> {{ v }}
          </button>
        </div>

        <div class="rp-grid" :class="{ stacked: detailTarget.question.type === 'short' }">
          <div>
            <div class="rp-label">{{ detailTarget.question.type === 'short' ? '我的作答' : '我的答案' }}</div>
            <div class="rp-value" :class="{ empty: !detailTarget.myAnswer }">{{ detailTarget.myAnswer || '未作答' }}</div>
          </div>
          <div>
            <div class="rp-label">{{ detailTarget.question.type === 'short' ? '参考答案' : '正确答案' }}</div>
            <div class="rp-value strong">{{ detailTarget.question.answer }}</div>
          </div>
        </div>

        <div>
          <div class="rp-label">解析</div>
          <p class="rp-analysis">{{ detailTarget.question.analysis }}</p>
        </div>

        <div class="wd-foot">
          <span class="text-caption">已错 {{ detailTarget.wrongCount }} 次 · 记入于 {{ detailTarget.addedTime }}</span>
          <div class="flex items-center gap-sm">
            <button class="btn btn-danger btn-sm" type="button" @click="detailRemove">
              <AppIcon name="trash" :size="13" /> 移出错题本
            </button>
            <button class="btn btn-primary btn-sm" type="button" @click="detailPractice">
              <AppIcon name="refresh" :size="13" /> 重新练习
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 28px 32px 48px; max-width: 1080px; width: 100%; margin: 0 auto; }
.stack { display: flex; flex-direction: column; gap: 16px; }

/* 页签 */
.quiz-tabs { display: flex; gap: 6px; padding: 4px; background: var(--surface-soft); border-radius: var(--radius-md); width: fit-content; }
.qtab {
  display: flex; align-items: center; gap: 6px;
  border: none; background: transparent; color: var(--slate);
  font-size: 13.5px; font-weight: 500; padding: 8px 16px;
  border-radius: var(--radius-sm); cursor: pointer; transition: all 0.15s ease;
}
.qtab:hover { color: var(--ink); }
.qtab.active { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-card); font-weight: 600; }
.qtab-badge {
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
  background: var(--primary); color: var(--on-primary, #fff);
  font-size: 11px; font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center;
}

/* 筛选区 */
.filter-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; }
.filter-grid .field { margin: 0; }
.span-2 { grid-column: span 2; }
.f-row { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; }
.gen-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--hairline-soft);
}
.pill-tab:disabled { opacity: 0.5; cursor: not-allowed; }
.ok-hint { color: var(--success); display: flex; align-items: center; gap: 4px; }

/* 生成状态区 */
.gen-status { display: flex; align-items: center; gap: 16px; }
.spinner-lg { width: 30px; height: 30px; border-width: 3px; }
.gs-main { flex: 1; min-width: 0; }
.gs-title { font-size: 14.5px; font-weight: 600; }
.gs-step { color: var(--slate); margin-top: 2px; }
.bar { height: 6px; background: var(--surface-soft); border-radius: 3px; overflow: hidden; margin-top: 10px; }
.bar-fill { height: 100%; background: var(--primary); border-radius: 3px; transition: width 0.12s linear; }
.gs-pct { color: var(--primary); font-weight: 600; font-variant-numeric: tabular-nums; }
.gen-error { display: flex; align-items: center; gap: 14px; border-color: #f5c2c2; background: #fffafa; }
.ge-ico {
  width: 40px; height: 40px; border-radius: var(--radius-md); flex-shrink: 0;
  background: #fdecec; color: var(--error);
  display: flex; align-items: center; justify-content: center;
}
.empty-hint { display: flex; align-items: flex-start; gap: 14px; }
.eh-ico {
  width: 40px; height: 40px; border-radius: var(--radius-md); flex-shrink: 0;
  background: var(--tint-lavender); color: var(--primary);
  display: flex; align-items: center; justify-content: center;
}

/* 题号进度 */
.quiz-progress { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; padding: 12px 16px; }
.qp-pills { display: flex; gap: 6px; flex-wrap: wrap; }
.qpill {
  min-width: 30px; height: 30px; padding: 0 6px; border-radius: var(--radius-sm);
  border: 1px solid var(--hairline); background: var(--canvas); color: var(--slate);
  font-size: 12.5px; font-weight: 600; cursor: pointer; transition: all 0.15s ease;
}
.qpill:hover { border-color: var(--hairline-strong); color: var(--ink); }
.qpill.answered { background: var(--tint-lavender); border-color: transparent; color: var(--primary); }
.qpill.right { background: var(--tint-mint); border-color: transparent; color: var(--brand-green); }
.qpill.wrong { background: #fdecec; border-color: transparent; color: var(--error); }
.qpill.pending { background: #fef3e2; border-color: transparent; color: #b25e09; }
.qpill.active { outline: 2px solid var(--primary); outline-offset: 1px; }
.qp-meta { display: flex; align-items: center; gap: 12px; }

/* 题目卡片 */
.q-card { display: flex; flex-direction: column; gap: 14px; }
.q-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.q-no {
  font-size: 13px; font-weight: 700; color: var(--primary);
  background: var(--tint-lavender); padding: 4px 10px; border-radius: var(--radius-sm);
}
.q-stem { font-size: 15.5px; font-weight: 600; line-height: 1.7; color: var(--ink); }
.q-source { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--stone); }

/* 选项 */
.opt-list { display: flex; flex-direction: column; gap: 10px; }
/* 多选 / 不定项作答提示 */
.choice-hint {
  display: flex; align-items: center; gap: 5px;
  font-size: 12px; color: var(--primary); background: var(--tint-lavender);
  padding: 7px 10px; border-radius: var(--radius-sm);
}
.judge-list { flex-direction: row; }
.judge-opt { justify-content: center; font-weight: 600; padding: 14px; flex: 1; max-width: 220px; }
.opt {
  display: flex; align-items: center; gap: 10px; text-align: left;
  padding: 12px 14px; border: 1px solid var(--hairline); border-radius: var(--radius-md);
  background: var(--canvas); color: var(--ink); font-size: 14px; line-height: 1.6;
  cursor: pointer; transition: all 0.15s ease;
}
.opt:hover:not(:disabled) { border-color: var(--primary); }
.opt:disabled { cursor: default; }
.opt.selected { border-color: var(--primary); background: var(--tint-lavender); font-weight: 500; }
.opt.selected .opt-letter { background: var(--primary); border-color: var(--primary); color: var(--on-primary, #fff); }
.opt.correct { border-color: var(--success); background: var(--tint-mint); }
.opt.correct .opt-letter { background: var(--success); border-color: var(--success); color: #fff; }
.opt.incorrect { border-color: #f5c2c2; background: #fdecec; }
.opt.incorrect .opt-letter { background: var(--error); border-color: var(--error); color: #fff; }
.opt-letter {
  width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
  border: 1px solid var(--hairline-strong); color: var(--slate);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600;
}
.blank-input { max-width: 420px; }

/* 切换与提交 */
.q-nav { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.q-nav-right { display: flex; gap: 8px; flex-wrap: wrap; }

/* 答题结果区 */
.result-panel { border-radius: var(--radius-md); padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.rp-right { background: var(--tint-mint); }
.rp-wrong { background: #fdecec; }
.rp-pending { background: #fef3e2; }
.rp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.rp-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 700; }
.rp-right .rp-badge { color: var(--brand-green); }
.rp-wrong .rp-badge { color: var(--error); }
.rp-pending .rp-badge { color: #b25e09; }
.rp-self { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.rp-grid.stacked { grid-template-columns: 1fr; }
.rp-label { font-size: 12px; color: var(--slate); font-weight: 600; margin-bottom: 4px; }
.rp-value { font-size: 13.5px; line-height: 1.7; color: var(--ink); white-space: pre-wrap; }
.rp-value.empty { color: var(--stone); font-style: italic; }
.rp-value.strong { font-weight: 600; }
.rp-analysis { font-size: 13px; line-height: 1.8; color: var(--slate); margin: 0; }
.rp-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
  border-top: 1px solid rgba(0, 0, 0, 0.06); padding-top: 10px;
}

/* 成绩横幅 */
.banner {
  display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
  background: linear-gradient(135deg, var(--tint-lavender), var(--surface));
}
.bn-title { font-size: 14.5px; font-weight: 700; display: flex; align-items: center; gap: 6px; }
.bn-stats { color: var(--slate); margin-top: 4px; }
.bn-stats b { font-weight: 700; }
.c-ok { color: var(--brand-green); }
.c-err { color: var(--error); }
.bn-actions { display: flex; gap: 8px; flex-wrap: wrap; }

/* 错题本 */
.w-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.w-filters { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.w-filters .w-select { width: 220px; }
.w-list { display: flex; flex-direction: column; gap: 12px; }
/* 卡片可点击查看详情 */
.w-item {
  border: 1px solid var(--hairline); border-radius: var(--radius-md); padding: 14px 16px;
  display: flex; flex-direction: column; gap: 8px;
  cursor: pointer; transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.w-item:hover { border-color: var(--hairline-strong); box-shadow: var(--shadow-card); }
.w-item:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.w-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.w-stem { font-size: 14px; font-weight: 600; line-height: 1.65; color: var(--ink); }
.w-ans { display: flex; gap: 16px; flex-wrap: wrap; }
.w-mine { color: var(--error); }
.w-right { color: var(--brand-green); font-weight: 500; }
.w-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
  border-top: 1px solid var(--hairline-soft); padding-top: 8px;
}
.icon-btn {
  border: none; background: transparent; color: var(--stone);
  padding: 6px; border-radius: var(--radius-sm); display: flex; cursor: pointer;
}
.icon-btn:hover { background: var(--surface); color: var(--ink); }
.icon-btn.danger:hover { color: var(--error); background: #fdecec; }

/* 分页（每页 10 / 20 / 30 条） */
.pager { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
.pager-size { display: flex; align-items: center; gap: 10px; }
.pager-nav { display: flex; align-items: center; gap: 4px; }
.pager-btn {
  border: 1px solid var(--hairline); background: var(--canvas); color: var(--slate);
  padding: 6px; border-radius: var(--radius-sm); display: flex; cursor: pointer; transition: all 0.15s ease;
}
.pager-btn:hover:not(:disabled) { background: var(--surface); color: var(--ink); }
.pager-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pager-num {
  min-width: 30px; height: 30px; border: none; background: transparent;
  color: var(--slate); font-size: 13px; font-weight: 500; border-radius: var(--radius-sm);
  cursor: pointer; transition: all 0.15s ease;
}
.pager-num:hover { background: var(--surface); color: var(--ink); }
.pager-num.active { background: var(--primary); color: var(--on-primary, #fff); }
.pager-dots { color: var(--stone); padding: 0 2px; font-size: 13px; }

/* 错题详情弹窗 */
.modal-lg { max-width: 640px; display: flex; flex-direction: column; gap: 12px; }
.wd-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.wd-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
  border-top: 1px solid var(--hairline-soft); padding-top: 10px; margin-top: 2px;
}
.empty-tip { color: var(--stone); padding: 24px 0; text-align: center; }
.empty-state { text-align: center; padding: 56px 20px; color: var(--slate); }
.empty-ico {
  width: 56px; height: 56px; margin: 0 auto 12px; border-radius: var(--radius-lg);
  background: var(--tint-lavender); color: var(--primary);
  display: flex; align-items: center; justify-content: center;
}

/* 弹窗（危险按钮用全局 .btn-danger 软色样式） */
.modal-sm { max-width: 420px; }
.modal-sub { color: var(--slate); line-height: 1.7; }

@media (max-width: 760px) {
  .page { padding: 20px 16px 40px; }
  .filter-grid { grid-template-columns: 1fr; }
  .span-2 { grid-column: auto; }
  .f-row { grid-template-columns: 1fr; }
  .gen-row { flex-direction: column; align-items: stretch; }
  .gen-row .btn { width: 100%; justify-content: center; }
  .judge-list { flex-direction: column; }
  .judge-opt { max-width: none; }
  .rp-grid, .rp-grid.stacked { grid-template-columns: 1fr; }
  .q-nav-right { width: 100%; }
  .q-nav-right .btn { flex: 1; justify-content: center; }
  .w-filters .w-select { width: 100%; }
  .banner { flex-direction: column; align-items: stretch; }
}
</style>
