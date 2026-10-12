<script setup lang="ts">
/**
 * 使用说明页：帮助新用户快速理解 RAG 问答系统的玩法
 * 快速上手三步曲 → 板块导览 → 对话技巧 → 常见问题
 */
import { ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'

const steps = [
  { n: 1, title: '先建知识库', desc: '进入「知识库管理」，新建一个知识空间（如“技术文档”），把 PDF / Word / Markdown 拖进去', to: '/knowledge', toText: '去上传' },
  { n: 2, title: '等解析完成', desc: '系统自动完成“切片 → 向量化 → 入库”。文档状态变为绿色的「解析完成」后，它就“学会”了这份资料', to: '', toText: '' },
  { n: 3, title: '开始提问', desc: '回到「智能对话」随便问，AI 只依据你的知识库作答，每个结论都带 [1][2] 引用角标，点开即可查看原文', to: '/chat', toText: '去提问' },
]

const boards = [
  { icon: 'chat', tint: 'tint-yellow-bold', name: '智能对话', desc: '核心板块。左侧是历史会话列表；支持上传文件针对性提问；回答下方有引用来源卡片，可点赞 / 点踩 / 重新生成。' },
  { icon: 'book', tint: 'tint-mint', name: '知识库管理', desc: '系统的“记忆”来源。管理知识空间与文档，支持上传、下载、重命名、删除，并实时反馈解析状态。' },
  { icon: 'chart', tint: 'tint-sky', name: '数据看板', desc: '宏观指标一览：文档总数、向量总数、每日提问趋势、热门问题词云与高频词排行。' },
  { icon: 'clock', tint: 'tint-lavender', name: '问答历史', desc: '你提过的每个问题都在这里，带当时的引用来源，可按知识空间筛选、一键“再问一次”。' },
  { icon: 'sliders', tint: 'tint-peach', name: '个人设置', desc: '微调 AI 回答偏好：回答长度、参考文档数量（Top-K）、引用严格度、记忆轮数与随机性。' },
  { icon: 'flag', tint: 'tint-rose', name: '问题反馈', desc: '遇到 Bug 或有建议？提交后可在“我的反馈”里跟踪处理进度（待处理 → 处理中 → 已解决）。' },
]

const tips = [
  { icon: 'link', text: '答案中的 [1][2] 是引用角标，点开“引用来源”可核对原文片段，不怕 AI 编造' },
  { icon: 'paperclip', text: '输入框左侧 📎 可附带文件提问，Enter 发送、Shift+Enter 换行' },
  { icon: 'refresh', text: '回答不满意可点「重新生成」；长期不满意就去「个人设置」调低随机性' },
  { icon: 'sliders', text: '「引用严格度」调高后，知识库没有的内容 AI 会明确回答“暂无依据”，而不是瞎猜' },
]

const faqs = ref<{ q: string; a: string; open: boolean }[]>([
  {
    q: '为什么 AI 有时回答“知识库中暂无依据”？',
    a: '这是「引用严格度」在起作用：当知识库里找不到相关内容时，系统宁可承认不知道也不编造答案。你可以上传相关文档，或在「个人设置」中把严格度调低（不推荐）。',
    open: false,
  },
  {
    q: '文档一直显示“解析失败”怎么办？',
    a: '最常见原因是扫描版 PDF（图片型文件，没有可提取的文字层）。可尝试用 OCR 工具转成文字版 PDF 后重新上传，或在列表中点「重新解析」重试。',
    open: false,
  },
  {
    q: '上传文档有什么限制？',
    a: '目前支持 PDF / Word / Markdown / TXT / PPT / Excel，单文件不超过 20MB。解析完成后原文档仍可随时下载。',
    open: false,
  },
  {
    q: '“参考文档数量（Top-K）”调大一定更好吗？',
    a: '不一定。Top-K 越大，AI 能参考的片段越多、覆盖面越广，但响应会变慢，且无关内容可能干扰回答。一般 3~5 篇效果最均衡。',
    open: false,
  },
  {
    q: '我的数据安全吗？',
    a: '文档仅存储在你的知识库向量库中，不会参与任何模型训练；管理员端可配置权限，只读用户无法看到无权空间的文档。',
    open: false,
  },
])

function toggle(i: number) {
  const item = faqs.value[i]
  if (item) item.open = !item.open
}
</script>

<template>
  <div class="page">
    <!-- 页头 -->
    <header class="head">
      <h1 class="h1">使用说明</h1>
      <p class="text-md">3 分钟看懂智源问答：一个“只依据你的文档回答问题、并且每句话都能溯源”的 AI 助手。</p>
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
    <h2 class="h3 sec-title">六大板块导览</h2>
    <div class="board-grid">
      <div v-for="b in boards" :key="b.name" class="board-card" :class="b.tint">
        <div class="board-icon"><AppIcon :name="b.icon" :size="18" /></div>
        <div class="h4">{{ b.name }}</div>
        <p class="board-desc">{{ b.desc }}</p>
      </div>
    </div>

    <!-- 对话技巧 -->
    <h2 class="h3 sec-title">让回答更好用的 4 个技巧</h2>
    <div class="card tips-card">
      <div v-for="t in tips" :key="t.text" class="tip-row">
        <span class="tip-ico"><AppIcon :name="t.icon" :size="15" /></span>
        <span class="tip-text">{{ t.text }}</span>
      </div>
    </div>

    <!-- 常见问题 -->
    <h2 class="h3 sec-title">常见问题 FAQ</h2>
    <div class="faq-list">
      <div v-for="(f, i) in faqs" :key="f.q" class="faq-item">
        <button class="faq-q" @click="toggle(i)">
          <AppIcon name="chevron-right" :size="15" :style="{ transform: f.open ? 'rotate(90deg)' : '' }" />
          <span>{{ f.q }}</span>
        </button>
        <p v-if="f.open" class="faq-a">{{ f.a }}</p>
      </div>
    </div>

    <p class="text-caption foot">更多问题可通过「问题反馈」联系我们，或联系管理员查看系统日志排查。</p>
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
.faq-a { padding: 0 20px 16px 45px; font-size: 13.5px; color: var(--slate); line-height: 1.7; }

.foot { margin-top: 18px; text-align: center; }

@media (max-width: 860px) {
  .page { padding: 20px 16px 40px; }
  .step-grid, .board-grid { grid-template-columns: 1fr; }
}
</style>
