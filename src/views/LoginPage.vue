<script setup lang="ts">
/**
 * 登录 / 注册 / 找回密码页
 * 左侧：深蓝品牌区（动态极光光晕 + 网格 + 漂浮便签圆点）
 * 右侧：浅色表单区（动态粉彩光斑背景）
 * 所有动画仅使用 transform / opacity，保证流畅并遵循 prefers-reduced-motion
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'

const router = useRouter()
type Mode = 'login' | 'register' | 'forgot'
const mode = ref<Mode>('login')

// 登录方式：邮箱 / 手机号
type LoginType = 'email' | 'phone'
const loginType = ref<LoginType>('email')

const username = ref('')
const phone = ref('')
const email = ref('')
const password = ref('')
const agree = ref(false)
const loading = ref(false)

// 找回密码（演示流程，支持手机号或邮箱）
const forgotAccount = ref('')
const forgotSent = ref(false)
const forgotSending = ref(false)

function switchMode(m: Mode) {
  mode.value = m
  forgotSent.value = false
}

function submit() {
  loading.value = true
  setTimeout(() => {
    localStorage.setItem('zy_token', 'demo-token')
    if (mode.value === 'register') {
      localStorage.setItem('zy_user', username.value || '林小智')
    }
    loading.value = false
    router.push('/chat')
  }, 600)
}

function sendReset() {
  if (!forgotAccount.value || forgotSending.value) return
  forgotSending.value = true
  setTimeout(() => {
    forgotSending.value = false
    forgotSent.value = true
  }, 800)
}

function guestLogin() {
  localStorage.setItem('zy_token', 'demo-token')
  router.push('/chat')
}

// 装饰便签圆点（Notion 风格，带漂浮动画参数）
const dots = [
  { top: '12%', left: '8%', c: '#ff64c8', s: 14, dur: '7s', delay: '0s' },
  { top: '22%', left: '84%', c: '#f5d75e', s: 10, dur: '9s', delay: '0.6s' },
  { top: '68%', left: '12%', c: '#2a9d99', s: 12, dur: '8s', delay: '1.2s' },
  { top: '78%', left: '76%', c: '#5645d4', s: 16, dur: '10s', delay: '0.3s' },
  { top: '40%', left: '92%', c: '#dd5b00', s: 9, dur: '7.5s', delay: '1.8s' },
  { top: '8%', left: '58%', c: '#1aae39', s: 8, dur: '9.5s', delay: '0.9s' },
]

// 右侧漂浮几何装饰（Notion 便签风：便签方块 / 圆环 / 加号 / 圆点）
const shapes = [
  { kind: 'note', top: '9%', left: '7%', s: 54, c: '#f5d75e', r: -12, dur: '9s', delay: '0s' },
  { kind: 'ring', top: '21%', left: '87%', s: 38, c: '#5645d4', r: 0, dur: '11s', delay: '0.5s' },
  { kind: 'plus', top: '57%', left: '9%', s: 30, c: '#2a9d99', r: 0, dur: '10s', delay: '1.2s' },
  { kind: 'dot', top: '73%', left: '85%', s: 18, c: '#ff64c8', r: 0, dur: '8.5s', delay: '0.8s' },
  { kind: 'note', top: '85%', left: '15%', s: 40, c: '#dcecfa', r: 10, dur: '12s', delay: '0.3s' },
  { kind: 'ring', top: '6%', left: '60%', s: 26, c: '#dd5b00', r: 0, dur: '9.5s', delay: '1.6s' },
  { kind: 'dot', top: '37%', left: '4%', s: 12, c: '#1aae39', r: 0, dur: '7.5s', delay: '0.2s' },
  { kind: 'plus', top: '91%', left: '58%', s: 24, c: '#a02e6d', r: 0, dur: '10.5s', delay: '1s' },
]

// 漂浮光球
const orbs = [
  { top: '30%', left: '24%', c: 'rgba(255,100,200,0.75)', s: 10, dur: '11s', delay: '0s', dx: 46, dy: -58 },
  { top: '56%', left: '64%', c: 'rgba(86,69,212,0.8)', s: 12, dur: '13s', delay: '1s', dx: -52, dy: 44 },
  { top: '24%', left: '70%', c: 'rgba(42,157,153,0.7)', s: 8, dur: '9s', delay: '0.5s', dx: 38, dy: 52 },
  { top: '76%', left: '40%', c: 'rgba(245,215,94,0.65)', s: 9, dur: '12s', delay: '1.6s', dx: -40, dy: -48 },
]
</script>

<template>
  <div class="page">
    <!-- ============ 左侧品牌区 ============ -->
    <section class="hero">
      <!-- 动态背景：极光光晕 -->
      <div class="bg-aurora" aria-hidden="true"></div>
      <!-- 动态背景：缓慢平移的网格 -->
      <div class="bg-grid" aria-hidden="true"></div>
      <!-- 动态背景：漂浮光球 -->
      <span
        v-for="(o, i) in orbs"
        :key="'orb' + i"
        class="orb"
        :style="{
          top: o.top, left: o.left, background: o.c,
          width: o.s + 'px', height: o.s + 'px',
          animationDuration: o.dur, animationDelay: o.delay,
          '--dx': o.dx + 'px', '--dy': o.dy + 'px',
        }"
        aria-hidden="true"
      />
      <!-- 便签圆点 -->
      <span
        v-for="(d, i) in dots"
        :key="'dot' + i"
        class="dot-deco"
        :style="{
          top: d.top, left: d.left, background: d.c,
          width: d.s + 'px', height: d.s + 'px',
          animationDuration: d.dur, animationDelay: d.delay,
        }"
        aria-hidden="true"
      />

      <div class="hero-body">
        <!-- 品牌：耳机 logo + 系统名 -->
        <div class="hero-brand">
          <div class="hero-logo"><AppIcon name="headphones" :size="26" /></div>
          <span class="hero-brand-name">智学纪要</span>
        </div>

        <h1 class="hero-title">录一堂课，得一份<br />可追问的笔记</h1>
        <p class="hero-sub">
          多模态课堂知识助手：上传课堂录音、板书照片或短视频，<br />
          自动转写、抽取关键帧、生成结构化课堂纪要，随时溯源追问。
        </p>
        <div class="hero-features">
          <div class="feature-chip tint-yellow-bold"><AppIcon name="headphones" :size="14" /> 语音转写</div>
          <div class="feature-chip tint-mint"><AppIcon name="image" :size="14" /> 关键帧理解</div>
          <div class="feature-chip tint-sky"><AppIcon name="chat" :size="14" /> 追问溯源</div>
        </div>
      </div>
    </section>

    <!-- ============ 右侧表单区 ============ -->
    <section class="form-side">
      <!-- 动态背景：旋转的粉彩流动渐变 -->
      <div class="bg-flow" aria-hidden="true"></div>
      <!-- 动态背景：纸面点阵纹理 -->
      <div class="bg-dots" aria-hidden="true"></div>
      <!-- 动态背景：漂浮几何图形 -->
      <span
        v-for="(sh, i) in shapes"
        :key="'shape' + i"
        class="shape"
        :class="'shape-' + sh.kind"
        :style="{
          top: sh.top, left: sh.left, color: sh.c,
          width: sh.s + 'px', height: sh.s + 'px',
          '--rot': sh.r + 'deg',
          animationDuration: sh.dur, animationDelay: sh.delay,
        }"
        aria-hidden="true"
      />

      <div class="form-card card-lg">
        <div class="seg-tabs mb-md">
          <button
            class="seg-tab"
            :class="{ active: mode === 'login' }"
            @click="switchMode('login')"
          >登录</button>
          <button
            class="seg-tab"
            :class="{ active: mode === 'register' }"
            @click="switchMode('register')"
          >注册</button>
        </div>

        <Transition name="form-fade" mode="out-in">
          <!-- 登录 -->
          <form v-if="mode === 'login'" key="login" @submit.prevent="submit">
            <div class="type-tabs" role="tablist" aria-label="登录方式">
              <button
                type="button"
                class="type-tab"
                :class="{ active: loginType === 'email' }"
                @click="loginType = 'email'"
              >邮箱登录</button>
              <button
                type="button"
                class="type-tab"
                :class="{ active: loginType === 'phone' }"
                @click="loginType = 'phone'"
              >手机号登录</button>
            </div>

            <div v-if="loginType === 'email'" class="field">
              <label class="field-label" for="login-email">邮箱</label>
              <input id="login-email" v-model="email" class="input" type="email" placeholder="you@example.com" required />
            </div>
            <div v-else class="field">
              <label class="field-label" for="login-phone">手机号</label>
              <input id="login-phone" v-model="phone" class="input" type="tel" inputmode="numeric" placeholder="请输入 11 位手机号" required pattern="1[3-9]\d{9}" maxlength="11" title="请输入 11 位手机号" />
            </div>

            <div class="field">
              <label class="field-label" for="login-pwd">密码</label>
              <input id="login-pwd" v-model="password" class="input" type="password" placeholder="请输入密码" required minlength="6" />
            </div>

            <div class="aux-row">
              <button type="button" class="forgot-link" @click="switchMode('forgot')">忘记密码？</button>
            </div>

            <button class="btn btn-primary btn-block btn-lg" type="submit" :disabled="loading">
              <span v-if="loading" class="spinner"></span>
              {{ loading ? '请稍候…' : '登 录' }}
            </button>
          </form>

          <!-- 注册 -->
          <form v-else-if="mode === 'register'" key="register" @submit.prevent="submit">
            <div class="field">
              <label class="field-label" for="reg-username">用户名</label>
              <input id="reg-username" v-model="username" class="input" placeholder="2-20 位字符" required minlength="2" maxlength="20" />
            </div>
            <div class="field">
              <label class="field-label" for="reg-phone">手机号</label>
              <input id="reg-phone" v-model="phone" class="input" type="tel" inputmode="numeric" placeholder="11 位手机号" required pattern="1[3-9]\d{9}" maxlength="11" title="请输入 11 位手机号" />
            </div>
            <div class="field">
              <label class="field-label" for="reg-email">邮箱</label>
              <input id="reg-email" v-model="email" class="input" type="email" placeholder="you@example.com" required />
            </div>
            <div class="field">
              <label class="field-label" for="reg-pwd">密码</label>
              <input id="reg-pwd" v-model="password" class="input" type="password" placeholder="至少 6 位密码" required minlength="6" />
            </div>
            <label class="agree-row">
              <input v-model="agree" type="checkbox" />
              <span>我已阅读并同意<a href="#" @click.stop.prevent>《用户协议》</a>与<a href="#" @click.stop.prevent>《隐私政策》</a></span>
            </label>
            <button class="btn btn-primary btn-block btn-lg" type="submit" :disabled="loading || !agree">
              <span v-if="loading" class="spinner"></span>
              {{ loading ? '请稍候…' : agree ? '注 册 并 登 录' : '请先勾选协议' }}
            </button>
          </form>

          <!-- 找回密码 -->
          <form v-else key="forgot" @submit.prevent="sendReset">
            <div class="forgot-tip">
              <AppIcon name="lock" :size="15" />
              输入注册时的手机号或邮箱，我们将向你发送重置链接
            </div>

            <template v-if="!forgotSent">
              <div class="field">
                <label class="field-label" for="forgot-account">手机号 / 邮箱</label>
                <input id="forgot-account" v-model="forgotAccount" class="input" placeholder="13800138000 或 you@example.com" required />
              </div>
              <button class="btn btn-primary btn-block btn-lg" type="submit" :disabled="forgotSending">
                <span v-if="forgotSending" class="spinner"></span>
                {{ forgotSending ? '发送中…' : '发送重置邮件' }}
              </button>
            </template>

            <div v-else class="sent-box">
              <AppIcon name="check" :size="18" />
              <div>
                <div class="sent-title">重置链接已发送</div>
                <div class="text-caption">请前往 {{ forgotAccount }} 查收（演示环境不会真实发信）</div>
              </div>
            </div>

            <button type="button" class="btn btn-secondary btn-block back-btn" @click="switchMode('login')">
              <AppIcon name="arrow-left" :size="14" /> 返回登录
            </button>
          </form>
        </Transition>

        <template v-if="mode !== 'forgot'">
          <div class="divider"><span>或</span></div>
          <button class="btn btn-secondary btn-block" @click="guestLogin">
            <AppIcon name="zap" :size="16" /> 游客一键体验
          </button>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page { display: flex; height: 100%; }

/* ============ 左侧品牌区 ============ */
.hero {
  flex: 1.2; background: var(--brand-navy); color: var(--on-dark);
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}

/* 极光光晕：两个大光斑缓慢漂移 */
.bg-aurora { position: absolute; inset: -18%; filter: blur(90px); pointer-events: none; }
.bg-aurora::before {
  content: ''; position: absolute; width: 58%; aspect-ratio: 1; border-radius: 50%;
  background: radial-gradient(circle, rgba(86, 69, 212, 0.55), transparent 65%);
  top: 2%; left: 8%;
  animation: aurora-a 26s ease-in-out infinite alternate;
}
.bg-aurora::after {
  content: ''; position: absolute; width: 52%; aspect-ratio: 1; border-radius: 50%;
  background: radial-gradient(circle, rgba(42, 157, 153, 0.4), transparent 65%);
  bottom: 0%; right: 6%;
  animation: aurora-b 32s ease-in-out infinite alternate;
}
@keyframes aurora-a {
  from { transform: translate(0, 0) scale(1); }
  to { transform: translate(20%, 14%) scale(1.28); }
}
@keyframes aurora-b {
  from { transform: translate(0, 0) scale(1.15); }
  to { transform: translate(-16%, -12%) scale(0.92); }
}

/* 网格：超尺寸图层做无缝平移 */
.bg-grid { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.bg-grid::before {
  content: ''; position: absolute; top: -100%; left: -50%; width: 200%; height: 300%;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
  background-size: 44px 44px;
  -webkit-mask-image: radial-gradient(ellipse at 42% 42%, #000 28%, transparent 74%);
  mask-image: radial-gradient(ellipse at 42% 42%, #000 28%, transparent 74%);
  animation: grid-pan 36s linear infinite;
}
@keyframes grid-pan { to { transform: translate(44px, 44px); } }

/* 漂浮光球 */
.orb {
  position: absolute; border-radius: 50%; pointer-events: none;
  mix-blend-mode: screen; opacity: 0.85;
  animation-name: orb-float; animation-timing-function: ease-in-out;
  animation-iteration-count: infinite; animation-direction: alternate;
}
@keyframes orb-float {
  from { transform: translate(0, 0); }
  to { transform: translate(var(--dx, 40px), var(--dy, -50px)); }
}

/* 便签圆点 */
.dot-deco {
  position: absolute; border-radius: 50%; opacity: 0.9; pointer-events: none;
  animation-name: dot-float; animation-timing-function: ease-in-out;
  animation-iteration-count: infinite; animation-direction: alternate;
}
@keyframes dot-float {
  from { transform: translateY(0); }
  to { transform: translateY(-16px); }
}

.hero-body { max-width: 480px; padding: 40px; position: relative; z-index: 1; }

/* 品牌行 */
.hero-brand { display: flex; align-items: center; gap: 14px; margin-bottom: 26px; }
.hero-logo {
  width: 52px; height: 52px; border-radius: 14px;
  background: rgba(255, 255, 255, 0.1); color: var(--brand-yellow);
  display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.15);
  position: relative;
}
.hero-logo::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit;
  box-shadow: 0 0 44px rgba(245, 215, 94, 0.5);
  opacity: 0.15; animation: glow-pulse 4.5s ease-in-out infinite;
}
@keyframes glow-pulse { 0%, 100% { opacity: 0.12; } 50% { opacity: 0.65; } }
.hero-brand-name { font-size: 36px; font-weight: 700; letter-spacing: -0.5px; }

.hero-title { font-size: 48px; font-weight: 600; line-height: 1.1; letter-spacing: -1.5px; margin-bottom: 20px; }
.hero-sub { font-size: 16px; line-height: 1.7; color: rgba(230, 228, 220, 0.85); margin-bottom: 32px; }
.hero-features { display: flex; gap: 10px; flex-wrap: wrap; }
.feature-chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: var(--radius-md);
}

/* ============ 右侧表单区 ============ */
.form-side {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 32px; background: var(--surface-soft);
  position: relative; overflow: hidden;
}
/* 流动渐变：超大锥形渐变缓慢旋转，整片色彩持续流转 */
.bg-flow {
  position: absolute; inset: -60%;
  background: conic-gradient(
    from 180deg at 50% 50%,
    #e9e3f7, #dbeafc, #ffe9d6, #e3f4df, #fbe3ef, #e9e3f7
  );
  filter: blur(50px); opacity: 0.85; pointer-events: none;
  will-change: transform;
  animation: flow-spin 44s linear infinite;
}
@keyframes flow-spin { to { transform: rotate(360deg); } }

/* 纸面点阵纹理（静态，增加 Notion 纸质感） */
.bg-dots {
  position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(circle, rgba(10, 21, 48, 0.07) 1.2px, transparent 1.2px);
  background-size: 24px 24px;
  -webkit-mask-image: radial-gradient(ellipse at 68% 32%, #000 22%, transparent 72%);
  mask-image: radial-gradient(ellipse at 68% 32%, #000 22%, transparent 72%);
}

/* 漂浮几何图形：上下漂浮 + 轻微旋转（旋转基准由 --rot 提供） */
.shape {
  position: absolute; pointer-events: none; opacity: 0.6;
  animation-name: shape-float; animation-timing-function: ease-in-out;
  animation-iteration-count: infinite; animation-direction: alternate;
  will-change: transform;
}
@keyframes shape-float {
  from { transform: translateY(0) rotate(var(--rot, 0deg)); }
  to { transform: translateY(-28px) rotate(calc(var(--rot, 0deg) + 9deg)); }
}
.shape-note { background: currentColor; border-radius: 7px; box-shadow: 0 6px 16px rgba(10, 21, 48, 0.1); }
.shape-ring { border: 3.5px solid currentColor; border-radius: 50%; }
.shape-dot { background: currentColor; border-radius: 50%; }
.shape-plus::before, .shape-plus::after {
  content: ''; position: absolute; background: currentColor; border-radius: 2px;
}
.shape-plus::before { left: 50%; top: 0; width: 24%; height: 100%; transform: translateX(-50%); }
.shape-plus::after { top: 50%; left: 0; height: 24%; width: 100%; transform: translateY(-50%); }

.form-card {
  width: 420px; max-width: 100%; background: var(--canvas);
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.85);
  box-shadow:
    0 24px 64px -16px rgba(10, 21, 48, 0.2),
    0 6px 20px -6px rgba(10, 21, 48, 0.08);
  position: relative; z-index: 1;
}
.form-card .input { border-radius: 12px; }

/* 表单切换过渡 */
.form-fade-enter-active, .form-fade-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.form-fade-enter-from, .form-fade-leave-to { opacity: 0; transform: translateY(6px); }

/* 登录方式切换（邮箱 / 手机号） */
.type-tabs {
  display: flex; gap: 6px; margin-bottom: 18px;
  background: var(--surface-soft); padding: 4px; border-radius: 10px;
}
.type-tab {
  flex: 1; border: none; background: transparent; font-family: inherit;
  font-size: 13px; font-weight: 600; color: var(--slate);
  padding: 8px 0; border-radius: 7px; cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.type-tab:hover { color: var(--ink); }
.type-tab.active {
  background: var(--canvas); color: var(--ink);
  box-shadow: 0 1px 3px rgba(10, 21, 48, 0.1);
}

/* 忘记密码行：密码框下方右对齐 */
.aux-row { display: flex; justify-content: flex-end; margin: -4px 0 14px; }
.forgot-link {
  border: none; background: transparent; padding: 0;
  font-size: 12.5px; font-weight: 500; color: var(--link-blue); cursor: pointer;
}
.forgot-link:hover { text-decoration: underline; }

/* 注册协议勾选 */
.agree-row {
  display: flex; align-items: flex-start; gap: 8px;
  margin: 4px 0 16px; font-size: 12.5px; color: var(--slate);
  line-height: 1.6; cursor: pointer; user-select: none;
}
.agree-row input[type='checkbox'] {
  width: 15px; height: 15px; margin-top: 2px;
  accent-color: var(--primary); cursor: pointer; flex-shrink: 0;
}

/* 找回密码 */
.forgot-tip {
  display: flex; align-items: center; gap: 8px;
  background: var(--tint-sky); color: var(--link-blue);
  font-size: 13px; font-weight: 500; line-height: 1.5;
  border-radius: var(--radius-md); padding: 11px 14px; margin-bottom: 18px;
}
.sent-box {
  display: flex; align-items: flex-start; gap: 10px;
  background: var(--tint-mint); color: var(--brand-green);
  border-radius: var(--radius-md); padding: 14px 16px; margin-bottom: 14px;
}
.sent-box > svg { flex-shrink: 0; margin-top: 2px; }
.sent-title { font-size: 14px; font-weight: 700; margin-bottom: 2px; }
.back-btn { margin-top: 4px; }

.divider { display: flex; align-items: center; gap: 12px; margin: 20px 0; color: var(--stone); font-size: 12px; }
.divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--hairline); }

@media (max-width: 860px) {
  .page { flex-direction: column; overflow-y: auto; }
  .hero { flex: none; padding: 48px 0; }
  .hero-title { font-size: 32px; }
  .hero-brand-name { font-size: 26px; }
  .hero-logo { width: 44px; height: 44px; }
  .form-side { flex: none; padding: 24px 16px 48px; }
  .shape { display: none; }
}
</style>
