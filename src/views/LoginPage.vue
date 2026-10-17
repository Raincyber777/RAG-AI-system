<script setup lang="ts">
/**
 * 着陆页（用户看到的第一页）· appily 风格
 * 顶部导航栏 + 大字 Hero + 撞色几何装饰 + 简约板块
 * 导航点击平滑滚动到对应板块（滚动时高亮当前板块）
 * 登录 / 注册为导航按钮，点击打开共用登录弹窗（AuthModal，状态在 store/auth）
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import AuthModal from '@/components/AuthModal.vue'
import FaqModal from '@/components/FaqModal.vue'
import { openAuth, guestLogin } from '@/store/auth'
import { faqApi } from '@/api'
import heroImg from '@/assets/landing-students.png'

const router = useRouter()
const route = useRoute()

/* ---------- 顶部导航：平滑滚动 + 滚动高亮 ---------- */
const navSecs = [
  { id: 'features', label: '产品功能' },
  { id: 'how', label: '使用流程' },
  { id: 'faq', label: '常见问题' },
]
const activeSec = ref('')
const navScrolled = ref(false)

function scrollToSec(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
function onWinScroll() {
  navScrolled.value = window.scrollY > 10
}

let spy: IntersectionObserver | null = null
onMounted(() => {
  // 管理端未登录跳回时携带 ?login=1：着陆后自动打开登录弹窗
  if (route.query.login === '1') openAuth('login')
  window.addEventListener('scroll', onWinScroll, { passive: true })
  onWinScroll()
  spy = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) activeSec.value = e.target.id
    },
    { rootMargin: '-40% 0px -55% 0px' },
  )
  document.querySelectorAll('.landing section[id]').forEach((s) => spy?.observe(s))
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onWinScroll)
  spy?.disconnect()
})

/* ---------- 游客一键体验：进入应用（仅可浏览，功能操作会弹出登录） ---------- */
function startGuest() {
  guestLogin()
  router.push('/studio')
}

/* ---------- 产品功能 ---------- */
const features = [
  { icon: 'upload', tint: 'fi-lavender', title: '多模态材料上传', desc: '录音、板书照片、课堂视频、讲义文档统一拖进上传区，支持格式自动识别' },
  { icon: 'layers', tint: 'fi-sky', title: 'Agent 可视化流水线', desc: '抽帧、转写、图片理解、融合生成、向量入库，每一步进度实时可见' },
  { icon: 'link', tint: 'fi-mint', title: '全程可溯源', desc: '每个结论都带录音时间戳或图片页码，点开即可核对录音与板书原文' },
  { icon: 'edit', tint: 'fi-peach', title: '追问与练习', desc: '基于纪要多轮追问、自动出题练习，错题自动进入错题本按章节重练' },
]

/* ---------- 使用流程 ---------- */
const steps = [
  { title: '上传课堂材料', desc: '把课堂录音、板书照片或短视频拖进工作台，选好所属课程与课堂主题' },
  { title: 'Agent 自动处理', desc: '提取音频 → 抽取关键帧 → 图片理解 → 语音转写 → 融合生成 → 向量入库，全程可视化' },
  { title: '纪要 · 追问 · 练习', desc: '流式生成结构化课堂纪要并随时导出；继续追问，或一键生成练习题巩固' },
]

/* ---------- 常见问题（首页专用 FAQ，来自后端 home 作用域，展示前 3 条；加载失败回退内置） ---------- */
const DEFAULT_FAQS: { q: string; a: string }[] = [
  {
    q: '纪要里的「录音 03:24」是怎么来的？',
    a: '语音转写模型会为每句话打上时间戳，纪要生成时把结论与其出处对齐，因此每个知识点都能定位到录音的精确时间点，点开角标即可核对原文。',
  },
  {
    q: '视频太大，浏览器会卡吗？',
    a: '视频在浏览器端抽帧，只把关键帧和音轨送往后端，传输量远小于原视频。建议单个视频不超过 20 分钟；过长可先剪辑或只上传录音。',
  },
  {
    q: '我的课堂数据安全吗？',
    a: '录音、图片与纪要仅存储在你的课堂知识库中，不会参与任何模型训练；只有你本人能看到自己的课堂内容，可随时删除。',
  },
]
const faqs = ref(DEFAULT_FAQS.map((f) => ({ ...f })))
// 关键词搜索：默认只展示前 3 条，输入关键词后在整个常见问题库中过滤
const faqQuery = ref('')
const visibleFaqs = computed(() => {
  const k = faqQuery.value.trim().toLowerCase()
  if (!k) return faqs.value.slice(0, 3)
  return faqs.value.filter((f) => (f.q + f.a).toLowerCase().includes(k))
})
onMounted(async () => {
  try {
    const list = await faqApi.list('user')
    if (list.length) faqs.value = list.map((f) => ({ q: f.q, a: f.a }))
  } catch {
    // 后端不可达时展示内置常见问题
  }
})
/** 当前查看的 FAQ（点击列表项弹窗展示完整内容；null 表示关闭） */
const faqView = ref<{ q: string; a: string } | null>(null)
</script>

<template>
  <div class="landing">
    <!-- ============ 顶部导航栏 ============ -->
    <header class="nav" :class="{ scrolled: navScrolled }">
      <div class="nav-inner">
        <a class="brand" href="#" aria-label="智学纪要 · 回到顶部" @click.prevent="scrollToTop">
          <svg class="brand-mark" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
            <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#zx-lg)" />
            <path d="M16 6.5l2.4 7.1 7.1 2.4-7.1 2.4L16 25.5l-2.4-7.1-7.1-2.4 7.1-2.4z" fill="#fff" />
            <defs>
              <linearGradient id="zx-lg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                <stop stop-color="#6d5ae0" /><stop offset="1" stop-color="#4534b3" />
              </linearGradient>
            </defs>
          </svg>
          <span class="brand-name">智学纪要</span>
        </a>

        <nav class="nav-links" aria-label="页面导航">
          <button
            v-for="s in navSecs"
            :key="s.id"
            class="nav-link"
            :class="{ active: activeSec === s.id }"
            @click="scrollToSec(s.id)"
          >{{ s.label }}</button>
        </nav>

        <div class="nav-actions">
          <button class="pill pill-ghost" @click="openAuth('login')">登录</button>
          <button class="pill pill-primary" @click="openAuth('register')">免费注册</button>
        </div>
      </div>
    </header>

    <main>
      <!-- ============ Hero ============ -->
      <section id="hero" class="hero">
        <!-- 浅色几何底纹 -->
        <span class="hero-deco d1" aria-hidden="true"></span>
        <span class="hero-deco d2" aria-hidden="true"></span>
        <span class="hero-deco d3" aria-hidden="true"></span>
        <span class="hero-deco d4" aria-hidden="true"></span>

        <div class="hero-inner">
          <div class="hero-copy">
            <span class="eyebrow"><AppIcon name="spark" :size="13" /> 多模态课堂知识助手</span>
            <h1 class="h1">录一堂课，<br />得一份<em>可追问</em>的笔记。</h1>
            <p class="hero-sub">
              上传课堂录音、板书照片或短视频，AI 自动生成结构化课堂纪要——
              每个结论都能溯源到录音时间戳与 PPT 页码，随时追问、一键出题练习。
            </p>
            <div class="cta-row">
              <button class="btn btn-primary cta" @click="openAuth('register')">免费开始使用</button>
              <button class="cta-ghost" @click="scrollToSec('how')">
                了解使用流程 <AppIcon name="download" :size="14" />
              </button>
            </div>
            <p class="hero-note">浏览器直接使用 · 演示环境可一键体验 · 无需安装</p>
          </div>

          <div class="hero-visual">
            <span class="shape shape-teal" aria-hidden="true"></span>
            <span class="shape shape-yellow" aria-hidden="true"></span>
            <img :src="heroImg" class="hero-photo" alt="学生们在图书馆一起讨论课堂内容" />
            <span class="shape shape-purple" aria-hidden="true"></span>
          </div>
        </div>
      </section>

      <!-- ============ 产品功能 ============ -->
      <section id="features" class="sec">
        <span class="sec-deco deco-a" aria-hidden="true"></span>
        <div class="sec-inner">
          <div class="sec-head">
            <h2>一个工作台，装下整堂课</h2>
            <p>从材料上传到练习巩固，学习闭环的每一步都在这里</p>
          </div>
          <div class="feat-grid">
            <div v-for="f in features" :key="f.title" class="feat-card">
              <span class="feat-ico" :class="f.tint"><AppIcon :name="f.icon" :size="18" /></span>
              <div class="feat-title">{{ f.title }}</div>
              <p class="feat-desc">{{ f.desc }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- ============ 使用流程 ============ -->
      <section id="how" class="sec">
        <span class="sec-deco deco-b" aria-hidden="true"></span>
        <div class="sec-inner">
          <div class="sec-head">
            <h2>三步，把课堂变成知识库</h2>
            <p>Agent 按材料类型自动编排处理步骤，你只需要上传</p>
          </div>
          <div class="steps-row">
            <div v-for="(s, i) in steps" :key="s.title" class="step-card">
              <div class="step-num">{{ i + 1 }}</div>
              <div class="step-title">{{ s.title }}</div>
              <p class="step-desc">{{ s.desc }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- ============ 常见问题 ============ -->
      <section id="faq" class="sec">
        <span class="sec-deco deco-c" aria-hidden="true"></span>
        <div class="sec-inner sec-inner-narrow">
          <div class="sec-head">
            <h2>常见问题</h2>
            <p>{{ faqQuery.trim() ? `找到 ${visibleFaqs.length} 个与「${faqQuery.trim()}」相关的问题` : '关于课堂纪要与数据安全的三个高频问题，支持关键词搜索' }}</p>
          </div>
          <div class="faq-search-box">
            <AppIcon name="search" :size="15" />
            <input v-model="faqQuery" class="faq-search-input" type="text" placeholder="搜索常见问题关键词" />
            <button v-if="faqQuery" class="faq-search-clear" aria-label="清空问题搜索" @click="faqQuery = ''">
              <AppIcon name="x" :size="13" />
            </button>
          </div>
          <div class="faq-list">
            <div v-for="f in visibleFaqs" :key="f.q" class="faq-item">
              <button class="faq-q" @click="faqView = f">
                <span class="faq-ico"><AppIcon name="chevron-right" :size="15" /></span>
                <span>{{ f.q }}</span>
              </button>
            </div>
            <p v-if="!visibleFaqs.length" class="faq-none">未找到与「{{ faqQuery.trim() }}」相关的常见问题，换个关键词试试</p>
          </div>
        </div>
      </section>

      <!-- ============ 底部 CTA ============ -->
      <section class="cta-band-wrap">
        <div class="cta-band">
          <h2>把下一堂课，变成可追问的知识库</h2>
          <p>免费注册，几分钟内生成你的第一份课堂纪要</p>
          <button class="btn btn-primary cta" @click="openAuth('register')">免费注册</button>
        </div>
      </section>
    </main>

    <!-- ============ 页脚 ============ -->
    <footer class="foot">
      <div class="foot-inner">
        <div class="foot-brand">
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
            <rect x="1" y="1" width="30" height="30" rx="9" fill="#5645d4" />
            <path d="M16 6.5l2.4 7.1 7.1 2.4-7.1 2.4L16 25.5l-2.4-7.1-7.1-2.4 7.1-2.4z" fill="#fff" />
          </svg>
          智学纪要
        </div>
        <span class="foot-cap">© 2026 智学纪要 · 多模态课堂知识助手</span>
      </div>
    </footer>

    <!-- 登录 / 注册弹窗（共用组件，状态在 store/auth） -->
    <AuthModal />

    <!-- 常见问题详情弹窗 -->
    <FaqModal :faq="faqView" @close="faqView = null" />
  </div>
</template>

<style scoped>
.landing { min-height: 100%; background: var(--canvas); color: var(--ink); }

/* ============ 顶部导航栏 ============ */
.nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 50;
  background: rgba(255, 255, 255, 0.84); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid transparent;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.nav.scrolled { border-bottom-color: var(--hairline); box-shadow: 0 4px 24px rgba(10, 21, 48, 0.06); }
.nav-inner { max-width: 1200px; margin: 0 auto; padding: 0 32px; height: 68px; display: flex; align-items: center; gap: 28px; }
.brand { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.brand-mark { display: block; }
.brand-name { font-size: 19px; font-weight: 800; letter-spacing: -0.3px; color: var(--ink-deep); }
.nav-links { display: flex; gap: 4px; }
.nav-link {
  border: none; background: transparent; font-family: inherit; cursor: pointer;
  font-size: 14px; font-weight: 600; color: var(--slate);
  padding: 8px 14px; border-radius: 9px;
  transition: color 0.15s ease, background 0.15s ease;
}
.nav-link:hover { color: var(--ink); background: var(--surface); }
.nav-link.active { color: var(--primary); background: var(--tint-lavender); }
.nav-actions { display: flex; gap: 10px; margin-left: auto; flex-shrink: 0; }
.pill {
  font-family: inherit; cursor: pointer; border-radius: var(--radius-full);
  font-size: 14px; font-weight: 700; padding: 9px 20px;
  transition: all 0.15s ease;
}
.pill-ghost { background: transparent; border: 1.5px solid var(--hairline-strong); color: var(--ink); }
.pill-ghost:hover { border-color: var(--ink-deep); }
.pill-primary { background: var(--primary); border: 1.5px solid var(--primary); color: #fff; }
.pill-primary:hover { background: var(--primary-pressed); border-color: var(--primary-pressed); }

/* ============ Hero ============ */
.hero { position: relative; padding: 158px 0 100px; overflow: hidden; }
.hero-inner {
  max-width: 1200px; margin: 0 auto; padding: 0 32px;
  display: grid; grid-template-columns: 1.02fr 0.98fr; gap: 52px; align-items: center;
  position: relative; z-index: 1;
}
.eyebrow {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--tint-lavender); color: var(--brand-purple-800);
  font-size: 12.5px; font-weight: 700; padding: 6px 13px; border-radius: var(--radius-full);
  margin-bottom: 20px;
}
.h1 { font-size: 46px; line-height: 1.18; font-weight: 800; letter-spacing: -1px; color: var(--ink-deep); margin-bottom: 18px; }
.h1 em { font-style: normal; background: linear-gradient(transparent 64%, var(--tint-yellow-bold) 64%); padding: 0 2px; }
.hero-sub { font-size: 15.5px; line-height: 1.85; color: var(--slate); max-width: 470px; margin-bottom: 30px; }
.cta-row { display: flex; gap: 16px; align-items: center; }
.cta { border-radius: 12px; padding: 14px 26px; font-size: 15px; font-weight: 700; }
.cta-ghost {
  border: none; background: transparent; font-family: inherit; cursor: pointer;
  color: var(--ink); font-size: 14.5px; font-weight: 600;
  display: inline-flex; gap: 6px; align-items: center; padding: 10px 4px;
  transition: color 0.15s ease;
}
.cta-ghost:hover { color: var(--primary); }
.cta-ghost svg { transform: rotate(180deg); }
.hero-note { margin-top: 18px; font-size: 12.5px; color: var(--stone); }

/* Hero 右侧视觉：照片 + 撞色几何 */
.hero-visual { position: relative; }
.hero-photo {
  width: 100%; aspect-ratio: 10 / 9; object-fit: cover; display: block;
  border-radius: 18px; box-shadow: var(--shadow-mockup); position: relative; z-index: 2;
}
.shape { position: absolute; pointer-events: none; }
.shape-teal { top: -52px; right: -46px; width: 235px; height: 235px; background: var(--brand-teal); border-radius: 0 0 0 100%; z-index: 1; }
.shape-yellow { bottom: -58px; left: -52px; width: 215px; height: 215px; background: var(--brand-yellow); border-radius: 100% 0 0 0; z-index: 3; }
.shape-purple { top: -30px; right: -26px; width: 104px; height: 104px; background: var(--brand-purple); clip-path: polygon(0 0, 100% 0, 100% 100%); z-index: 3; }

/* Hero 浅色底纹 */
.hero-deco { position: absolute; pointer-events: none; opacity: 0.75; z-index: 0; }
.d1 { top: 118px; left: -70px; width: 190px; height: 190px; background: var(--tint-mint); border-radius: 0 0 100% 0; }
.d2 { top: 315px; left: 118px; width: 150px; height: 150px; background: var(--tint-sky); border-radius: 100% 0 0 0; }
.d3 { bottom: 42px; left: 42%; width: 130px; height: 130px; background: var(--tint-yellow); border-radius: 0 100% 0 0; }
.d4 { bottom: -46px; right: 5%; width: 165px; height: 165px; background: var(--tint-lavender); border-radius: 0 0 0 100%; }

/* ============ 通用板块 ============ */
.sec { position: relative; padding: 90px 0; overflow: hidden; }
.sec-inner { max-width: 1200px; margin: 0 auto; padding: 0 32px; position: relative; z-index: 1; }
.sec-inner-narrow { max-width: 860px; }
.sec-head { text-align: center; margin-bottom: 44px; }
.sec-head h2 { font-size: 30px; font-weight: 800; letter-spacing: -0.5px; color: var(--ink-deep); margin-bottom: 10px; }
.sec-head p { font-size: 14.5px; color: var(--slate); }
.sec-deco { position: absolute; pointer-events: none; opacity: 0.65; }
.deco-a { top: -62px; right: -62px; width: 220px; height: 220px; background: var(--tint-lavender); border-radius: 0 0 0 100%; }
.deco-b { bottom: -72px; left: -72px; width: 240px; height: 240px; background: var(--tint-peach); border-radius: 0 100% 0 0; }
.deco-c { top: 44px; right: 4%; width: 150px; height: 150px; background: var(--tint-mint); border-radius: 0 0 100% 0; }

/* 产品功能 */
.feat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.feat-card {
  background: var(--canvas); border: 1px solid var(--hairline); border-radius: 16px; padding: 24px 20px;
  transition: box-shadow 0.15s ease, transform 0.15s ease;
}
.feat-card:hover { box-shadow: var(--shadow-card); transform: translateY(-2px); }
.feat-ico { width: 40px; height: 40px; border-radius: 11px; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; }
.fi-lavender { background: var(--tint-lavender); color: var(--primary); }
.fi-sky { background: var(--tint-sky); color: var(--link-blue); }
.fi-mint { background: var(--tint-mint); color: var(--brand-green); }
.fi-peach { background: var(--tint-peach); color: var(--brand-orange); }
.feat-title { font-size: 15.5px; font-weight: 700; margin-bottom: 6px; }
.feat-desc { font-size: 13px; line-height: 1.7; color: var(--slate); }

/* 使用流程 */
.steps-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.step-card { background: var(--surface-soft); border: 1px solid var(--hairline); border-radius: 16px; padding: 26px 24px; }
.step-num {
  width: 34px; height: 34px; border-radius: 50%; background: var(--ink-deep); color: #fff;
  font-size: 15px; font-weight: 800; display: flex; align-items: center; justify-content: center; margin-bottom: 15px;
}
.step-title { font-size: 15.5px; font-weight: 700; margin-bottom: 6px; }
.step-desc { font-size: 13px; line-height: 1.75; color: var(--slate); }

/* 常见问题 */
/* 常见问题搜索框 */
.faq-search-box {
  display: flex; align-items: center; gap: 9px;
  border: 1px solid var(--hairline-strong); border-radius: 12px;
  background: var(--canvas); padding: 0 14px; height: 42px;
  color: var(--stone); margin-bottom: 14px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.faq-search-box:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px var(--tint-lavender); }
.faq-search-input {
  flex: 1; border: none; outline: none; background: transparent;
  font-family: inherit; font-size: 14px; color: var(--ink);
}
.faq-search-input::placeholder { color: var(--stone); }
.faq-search-clear {
  border: none; background: transparent; color: var(--stone); cursor: pointer;
  width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
  border-radius: 8px; flex-shrink: 0;
}
.faq-search-clear:hover { color: var(--ink); background: var(--surface-soft); }
.faq-none { text-align: center; color: var(--stone); font-size: 14px; padding: 26px 0; }

.faq-list { border: 1px solid var(--hairline); border-radius: 16px; overflow: hidden; background: var(--canvas); }
.faq-item + .faq-item { border-top: 1px solid var(--hairline); }
.faq-q {
  width: 100%; display: flex; align-items: center; gap: 11px; text-align: left;
  background: transparent; border: none; font-family: inherit; cursor: pointer;
  padding: 17px 20px; font-size: 15px; font-weight: 600; color: var(--ink);
}
.faq-q:hover { background: var(--surface-soft); }
.faq-ico { display: flex; color: var(--stone); transition: transform 0.18s ease, color 0.18s ease; flex-shrink: 0; }
.faq-q:hover .faq-ico { color: var(--primary); transform: translateX(2px); }

/* 底部 CTA */
.cta-band-wrap { padding: 16px 32px 96px; }
.cta-band {
  max-width: 1136px; margin: 0 auto; border-radius: 24px; padding: 56px 32px; text-align: center;
  background: linear-gradient(120deg, var(--tint-lavender), var(--tint-sky) 52%, var(--tint-mint));
  position: relative; overflow: hidden;
}
.cta-band::before, .cta-band::after {
  content: ''; position: absolute; background: rgba(255, 255, 255, 0.55); pointer-events: none;
}
.cta-band::before { top: -70px; left: -40px; width: 190px; height: 190px; border-radius: 0 0 100% 0; }
.cta-band::after { bottom: -80px; right: -30px; width: 210px; height: 210px; border-radius: 100% 0 0 0; }
.cta-band h2 { font-size: 26px; font-weight: 800; letter-spacing: -0.5px; color: var(--brand-purple-800); margin-bottom: 10px; position: relative; z-index: 1; }
.cta-band p { font-size: 14px; color: var(--slate); margin-bottom: 26px; position: relative; z-index: 1; }
.cta-band .cta { position: relative; z-index: 1; }

/* 页脚 */
.foot { border-top: 1px solid var(--hairline); background: var(--surface-soft); }
.foot-inner { max-width: 1200px; margin: 0 auto; padding: 22px 32px; display: flex; align-items: center; justify-content: space-between; }
.foot-brand { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 800; color: var(--ink-deep); }
.foot-cap { font-size: 12.5px; color: var(--stone); }

/* ============ 响应式 ============ */
@media (max-width: 1020px) {
  .hero { padding: 140px 0 84px; }
  .hero-inner { grid-template-columns: 1fr; gap: 64px; }
  .hero-visual { max-width: 560px; margin: 0 auto; width: 100%; }
  .feat-grid { grid-template-columns: repeat(2, 1fr); }
  .steps-row { grid-template-columns: 1fr; }
}
@media (max-width: 860px) {
  .nav-links { display: none; }
  .h1 { font-size: 34px; }
  .shape-teal { width: 150px; height: 150px; top: -28px; right: -18px; }
  .shape-yellow { width: 140px; height: 140px; bottom: -36px; left: -22px; }
  .shape-purple { width: 68px; height: 68px; top: -16px; right: -12px; }
  .sec { padding: 68px 0; }
  .sec-head h2 { font-size: 25px; }
}
@media (max-width: 640px) {
  .nav-inner, .hero-inner, .sec-inner, .foot-inner { padding-left: 20px; padding-right: 20px; }
  .hero { padding: 128px 0 72px; }
  .feat-grid { grid-template-columns: 1fr; }
  .pill { padding: 8px 15px; font-size: 13px; }
  .cta-row { flex-direction: column; align-items: flex-start; }
}
</style>
