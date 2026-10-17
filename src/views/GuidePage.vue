<script setup lang="ts">
/**
 * 使用说明页：帮助新用户快速理解 智学纪要 的玩法
 * 快速上手三步曲 → 板块导览 → 实用技巧 → 常见问题
 */
import { ref, computed, watch, onMounted } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import FaqModal from '@/components/FaqModal.vue'
import { faqApi, tipsApi } from '@/api'

const steps = [
  { n: 1, title: '上传课堂材料', desc: '进入「课堂纪要」工作台，把课堂录音（mp3/wav/m4a）、板书 PPT 照片或课堂短视频拖进上传区，填好课堂主题', to: '/studio', toText: '去上传' },
  { n: 2, title: 'Agent 自动处理', desc: '工作台会按材料类型编排步骤：提取音频 → 抽取关键帧 → 图片理解 → 语音转写 → 融合生成纪要 → 向量入库，全程可视化', to: '', toText: '' },
  { n: 3, title: '看纪要 · 继续追问', desc: '纪要按「主题 / 知识点 / 定义公式 / 重点问题」等板块生成，每个结论都带录音时间戳或图片页码，随时溯源追问', to: '/qa', toText: '去追问' },
]

const boards = [
  { icon: 'spark', tint: 'tint-yellow-bold', name: '课堂纪要工作台', desc: '核心板块。多模态上传 + Agent 工作流可视化 + 结构化纪要流式生成，支持中途停止与重新生成，完成后一键导出 Markdown。' },
  { icon: 'chat', tint: 'tint-mint', name: '智能问答', desc: '基于课堂纪要知识库的多轮问答。回答下方展示引用来源卡片：录音第几分钟、哪张 PPT / 板书，可点赞 / 重新生成，支持语音提问与附件上传。' },
  { icon: 'book', tint: 'tint-sky', name: '我的纪要', desc: '所有课堂纪要的卡片视图：查看回放原文、继续追问、导出 Markdown、删除。工作台新生成的纪要会实时出现在这里。' },
  { icon: 'edit', tint: 'tint-yellow', name: '自创题练习', desc: '基于已完成的课堂纪要自动出题：选择题（随机单选 / 多选 / 不定项）、判断、填空、简答，可按课程与章节筛选；作答后即时批改并展示解析，错题自动进入错题本，支持按章节重练与分页浏览。' },
  { icon: 'chart', tint: 'tint-lavender', name: '数据看板', desc: '课堂总数、转写时长、关键帧解析量、每日追问趋势、材料类型占比、高频知识点排行与热门追问词云。' },
  { icon: 'sliders', tint: 'tint-peach', name: '个人设置', desc: '维护个人资料、头像、手机号 / 邮箱与登录密码。处理与生成参数由系统统一按最佳配置运行，无需手动调整。' },
  { icon: 'flag', tint: 'tint-rose', name: '问题反馈', desc: '遇到 Bug 或有建议？填写标题与描述、附上截图提交即可，提交后会收到确认提示。' },
]

// ---------- 使用技巧（来自后端配置，分页展示；加载失败回退到内置默认） ----------
const DEFAULT_TIPS: string[] = [
  '答案中的 [1][2] 是引用角标，点开“引用来源”可核对录音原文或板书原图，不怕 AI 编造',
  '纪要里的「录音 03:24」角标点开可查看该时间点的转写原文，复习时精准回听',
  '智能问答输入框支持语音提问与附件上传（图片 / PPT / 文档）；Enter 发送、Shift+Enter 换行',
  '视频材料会自动抽帧并去重，只保留信息量最大的关键帧，无需手动截屏或调参',
  '练习中做错的题会自动收进错题本，点开错题卡片可回看完整题目与解析，按章节重练巩固薄弱点',
]
const TIP_ICONS = ['link', 'headphones', 'mic', 'refresh', 'edit']
/** 按技巧的全局序号循环取图标（后端只存文本，图标为展示层装饰） */
function tipIcon(globalIndex: number) {
  return TIP_ICONS[globalIndex % TIP_ICONS.length] ?? 'link'
}
const tips = ref<string[]>([...DEFAULT_TIPS])
// 关键词搜索：过滤后分页（输入或清空关键词时回到第 1 页）
const tipQuery = ref('')
const filteredTips = computed(() => {
  const k = tipQuery.value.trim().toLowerCase()
  if (!k) return tips.value
  return tips.value.filter((t) => t.toLowerCase().includes(k))
})
const tipPage = ref(1)
const TIP_PAGE_SIZE = 5
const tipTotalPages = computed(() => Math.max(1, Math.ceil(filteredTips.value.length / TIP_PAGE_SIZE)))
const tipSafePage = computed(() => Math.min(tipPage.value, tipTotalPages.value))
const tipsPaged = computed(() =>
  filteredTips.value.slice((tipSafePage.value - 1) * TIP_PAGE_SIZE, tipSafePage.value * TIP_PAGE_SIZE),
)
watch(tipQuery, () => {
  tipPage.value = 1
})

// ---------- 常见问题（来自后端 FAQ 配置，分页展示；加载失败时回退到内置默认） ----------
const DEFAULT_FAQS: { q: string; a: string }[] = [
  {
    q: '引用里的“录音 03:24”是怎么来的？',
    a: '语音转写模型会为每句话打上时间戳，纪要生成时把结论与其出处对齐，因此每个知识点都能定位到录音的精确时间点，点开角标即可核对原文。',
  },
  {
    q: '视频太大，浏览器会卡吗？',
    a: '视频在浏览器端通过 ffmpeg.wasm 抽帧，只把关键帧和音轨送往后端，传输量远小于原视频。建议单个视频不超过 20 分钟；过长可先剪辑或只上传录音。',
  },
  {
    q: '为什么纪要显示“处理失败”？',
    a: '常见原因：音频文件损坏、视频编码不受支持或网络中断。可在「我的纪要」中点击「重新处理」重试；若多次失败，请通过「问题反馈」联系我们。',
  },
  {
    q: '一节课的纪要包含哪些内容？',
    a: '按「课程主题、核心知识点、重要定义与公式、重点问题」等板块生成；课堂中没有的内容会自动省略。处理参数由系统统一按最佳配置运行，无需手动调整。',
  },
  {
    q: '我的课堂数据安全吗？',
    a: '录音、图片与纪要仅存储在你的课堂知识库中，不会参与任何模型训练；只有你本人能看到自己的课堂内容，可随时删除。',
  },
]
const faqs = ref(DEFAULT_FAQS.map((f) => ({ ...f })))
// 关键词搜索：匹配问题与解答（过滤后分页，输入或清空关键词时回到第 1 页）
const faqQuery = ref('')
const filteredFaqs = computed(() => {
  const k = faqQuery.value.trim().toLowerCase()
  if (!k) return faqs.value
  return faqs.value.filter((f) => (f.q + f.a).toLowerCase().includes(k))
})
const faqPage = ref(1)
const FAQ_PAGE_SIZE = 5
const faqTotalPages = computed(() => Math.max(1, Math.ceil(filteredFaqs.value.length / FAQ_PAGE_SIZE)))
const faqSafePage = computed(() => Math.min(faqPage.value, faqTotalPages.value))
const faqsPaged = computed(() =>
  filteredFaqs.value.slice((faqSafePage.value - 1) * FAQ_PAGE_SIZE, faqSafePage.value * FAQ_PAGE_SIZE),
)
watch(faqQuery, () => {
  faqPage.value = 1
})

onMounted(async () => {
  try {
    const [tipList, faqList] = await Promise.all([tipsApi.list('user'), faqApi.list('user')])
    if (tipList.length) tips.value = tipList.map((t) => t.text)
    if (faqList.length) faqs.value = faqList.map((f) => ({ q: f.q, a: f.a }))
  } catch {
    // 后端不可达时展示内置使用技巧与常见问题
  }
})

/** 当前查看的 FAQ（点击列表项弹窗展示完整内容；null 表示关闭） */
const faqView = ref<{ q: string; a: string } | null>(null)
</script>

<template>
  <div class="page">
    <!-- 页头 -->
    <header class="head">
      <h1 class="h1">使用说明</h1>
      <p class="text-md">3 分钟看懂智学纪要：一个“把课堂变成可追问笔记、每句话都能溯源到录音和板书”的多模态知识助手。</p>
    </header>

    <!-- 快速上手三步曲 -->
    <section class="banner tint-yellow-bold">
      <div class="banner-head">
        <AppIcon name="zap" :size="22" />
        <span>快速上手 · 只需三步</span>
      </div>
      <div class="step-grid">
        <div v-for="s in steps" :key="s.n" class="step">
          <div class="step-num">{{ s.n }}</div>
          <div class="h4">{{ s.title }}</div>
          <p class="step-desc">{{ s.desc }}</p>
          <router-link v-if="s.to" :to="s.to" class="step-link">{{ s.toText }} →</router-link>
        </div>
      </div>
    </section>

    <!-- 板块导览 -->
    <h2 class="h3 sec-title">七大板块导览</h2>
    <div class="board-grid">
      <div v-for="b in boards" :key="b.name" class="board-card" :class="b.tint">
        <div class="board-icon"><AppIcon :name="b.icon" :size="18" /></div>
        <div class="h4">{{ b.name }}</div>
        <p class="board-desc">{{ b.desc }}</p>
      </div>
    </div>

    <!-- 对话技巧 -->
    <h2 class="h3 sec-title">让纪要更好用的 {{ tips.length }} 个技巧</h2>
    <div class="card tips-card">
      <div class="search-box">
        <AppIcon name="search" :size="15" />
        <input v-model="tipQuery" class="search-input" type="text" placeholder="搜索使用技巧关键词" />
        <button v-if="tipQuery" class="search-clear" aria-label="清空技巧搜索" @click="tipQuery = ''">
          <AppIcon name="x" :size="13" />
        </button>
      </div>
      <div v-for="(t, i) in tipsPaged" :key="t" class="tip-row">
        <span class="tip-ico"><AppIcon :name="tipIcon((tipSafePage - 1) * TIP_PAGE_SIZE + i)" :size="15" /></span>
        <span class="tip-text">{{ t }}</span>
      </div>
      <p v-if="!filteredTips.length" class="empty-tip">未找到与「{{ tipQuery.trim() }}」相关的使用技巧，换个关键词试试</p>
      <div v-if="filteredTips.length" class="pager">
        <span class="pager-info">共 {{ filteredTips.length }} 条</span>
        <div class="pager-nav">
          <button class="pager-btn" :disabled="tipSafePage <= 1" aria-label="上一页" @click="tipPage = tipSafePage - 1">
            <AppIcon name="chevron-left" :size="14" />
          </button>
          <span class="pager-page">第 {{ tipSafePage }} / {{ tipTotalPages }} 页</span>
          <button class="pager-btn" :disabled="tipSafePage >= tipTotalPages" aria-label="下一页" @click="tipPage = tipSafePage + 1">
            <AppIcon name="chevron-right" :size="14" />
          </button>
        </div>
      </div>
    </div>

    <!-- 常见问题 -->
    <h2 class="h3 sec-title">常见问题</h2>
    <div class="search-box faq-search">
      <AppIcon name="search" :size="15" />
      <input v-model="faqQuery" class="search-input" type="text" placeholder="搜索常见问题关键词" />
      <button v-if="faqQuery" class="search-clear" aria-label="清空问题搜索" @click="faqQuery = ''">
        <AppIcon name="x" :size="13" />
      </button>
    </div>
    <div class="faq-list">
      <div v-for="f in faqsPaged" :key="f.q" class="faq-item">
        <button class="faq-q" @click="faqView = f">
          <AppIcon name="chevron-right" :size="15" />
          <span>{{ f.q }}</span>
        </button>
      </div>
      <p v-if="!filteredFaqs.length" class="empty-tip faq-empty">未找到与「{{ faqQuery.trim() }}」相关的常见问题，换个关键词试试</p>
    </div>
    <div v-if="filteredFaqs.length" class="pager pager-loose">
      <span class="pager-info">共 {{ filteredFaqs.length }} 条</span>
      <div class="pager-nav">
        <button class="pager-btn" :disabled="faqSafePage <= 1" aria-label="上一页" @click="faqPage = faqSafePage - 1">
          <AppIcon name="chevron-left" :size="14" />
        </button>
        <span class="pager-page">第 {{ faqSafePage }} / {{ faqTotalPages }} 页</span>
        <button class="pager-btn" :disabled="faqSafePage >= faqTotalPages" aria-label="下一页" @click="faqPage = faqSafePage + 1">
          <AppIcon name="chevron-right" :size="14" />
        </button>
      </div>
    </div>

    <p class="text-caption foot">更多问题可通过「问题反馈」联系我们，或联系管理员查看系统日志排查。</p>

    <!-- 常见问题详情弹窗 -->
    <FaqModal :faq="faqView" @close="faqView = null" />
  </div>
</template>

<style scoped>
.page { padding: 28px 32px 48px; max-width: 960px; width: 100%; margin: 0 auto; }
.head { margin-bottom: 22px; }
.head .text-md { margin-top: 8px; color: var(--slate); }

/* 三步曲横幅 */
.banner { border-radius: var(--radius-lg); padding: 26px 28px; margin-bottom: 32px; }
.banner-head { display: flex; align-items: center; gap: 9px; font-size: 17px; font-weight: 700; margin-bottom: 20px; }
.step-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.step-num {
  width: 30px; height: 30px; border-radius: 50%; background: var(--ink-deep); color: var(--on-dark);
  font-size: 14px; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-bottom: 10px;
}
.step-desc { font-size: 13px; color: var(--slate); line-height: 1.65; margin-top: 6px; }
.step-link { display: inline-block; margin-top: 8px; font-size: 13px; font-weight: 600; }

/* 板块导览 */
.sec-title { margin-bottom: 14px; }
.board-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 32px; }
.board-card { border-radius: var(--radius-lg); padding: 20px; }
.board-icon {
  width: 36px; height: 36px; border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.6); display: flex; align-items: center; justify-content: center;
  margin-bottom: 12px;
}
.board-desc { font-size: 13px; color: var(--slate); line-height: 1.65; margin-top: 6px; }

/* 技巧 */
.tips-card { margin-bottom: 32px; padding: 8px 22px; }

/* 搜索框（使用技巧 / 常见问题共用） */
.search-box {
  display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-md);
  background: var(--canvas); padding: 0 12px; height: 38px;
  color: var(--stone); margin: 10px 0 4px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.search-box:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px var(--tint-lavender); }
.search-input {
  flex: 1; border: none; outline: none; background: transparent;
  font-family: inherit; font-size: 13.5px; color: var(--ink);
}
.search-input::placeholder { color: var(--stone); }
.search-clear {
  border: none; background: transparent; color: var(--stone); cursor: pointer;
  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm); flex-shrink: 0;
}
.search-clear:hover { color: var(--ink); background: var(--surface-soft); }
.faq-search { margin: 0 0 12px; }
.empty-tip { text-align: center; color: var(--stone); font-size: 13px; padding: 20px 0; }
.faq-list .empty-tip { border-top: 1px solid var(--hairline-soft); }

.tip-row {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 13px 0; border-bottom: 1px solid var(--hairline-soft);
}
.tip-row:last-child { border-bottom: none; }
.tip-ico {
  width: 28px; height: 28px; border-radius: var(--radius-sm); flex-shrink: 0;
  background: var(--tint-lavender); color: var(--brand-purple-800);
  display: flex; align-items: center; justify-content: center; margin-top: 1px;
}
.tip-text { font-size: 14px; color: var(--charcoal); line-height: 1.65; }

/* FAQ */
.faq-list { border: 1px solid var(--hairline); border-radius: var(--radius-lg); overflow: hidden; background: var(--canvas); }
.faq-item { border-bottom: 1px solid var(--hairline); }
.faq-item:last-child { border-bottom: none; }
.faq-q {
  width: 100%; display: flex; align-items: center; gap: 10px; text-align: left;
  background: transparent; border: none; padding: 16px 20px;
  font-size: 15px; font-weight: 600; color: var(--ink); font-family: inherit;
}
.faq-q:hover { background: var(--surface-soft); }
.faq-q svg { color: var(--stone); transition: transform 0.15s ease; flex-shrink: 0; }

.foot { margin-top: 18px; text-align: center; }

/* 分页条（使用技巧 / 常见问题） */
.pager { display: flex; align-items: center; justify-content: flex-end; gap: 14px; padding: 10px 4px 6px; }
.pager-loose { padding: 12px 4px 0; }
.pager-info { font-size: 12.5px; color: var(--stone); margin-right: auto; padding-left: 4px; }
.pager-nav { display: flex; align-items: center; gap: 8px; }
.pager-btn {
  width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  background: var(--canvas); border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm);
  color: var(--slate); cursor: pointer; transition: all 0.15s ease;
}
.pager-btn:hover:not(:disabled) { border-color: var(--steel); color: var(--ink); }
.pager-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pager-page { font-size: 12.5px; color: var(--slate); min-width: 72px; text-align: center; }

@media (max-width: 860px) {
  .page { padding: 20px 16px 40px; }
  .step-grid, .board-grid { grid-template-columns: 1fr; }
}
</style>
