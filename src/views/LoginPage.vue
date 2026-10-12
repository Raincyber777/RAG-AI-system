<script setup lang="ts">
/**
 * 登录 / 注册页
 * 左侧：深蓝品牌区（Notion hero-band-dark 风格 + 便签圆点装饰）
 * 右侧：登录 / 注册表单
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'

const router = useRouter()
const mode = ref<'login' | 'register'>('login')
const email = ref('')
const password = ref('')
const nickname = ref('')
const loading = ref(false)

// 装饰用便签圆点（Notion 风格）
const dots = [
  { top: '12%', left: '8%', c: '#ff64c8', s: 14 },
  { top: '22%', left: '84%', c: '#f5d75e', s: 10 },
  { top: '68%', left: '12%', c: '#2a9d99', s: 12 },
  { top: '78%', left: '76%', c: '#5645d4', s: 16 },
  { top: '40%', left: '92%', c: '#dd5b00', s: 9 },
  { top: '8%', left: '58%', c: '#1aae39', s: 8 },
]

function submit() {
  loading.value = true
  setTimeout(() => {
    localStorage.setItem('zy_token', 'demo-token')
    localStorage.setItem('zy_user', nickname.value || '林小智')
    loading.value = false
    router.push('/chat')
  }, 600)
}

function guestLogin() {
  localStorage.setItem('zy_token', 'demo-token')
  router.push('/chat')
}
</script>

<template>
  <div class="page">
    <!-- 左侧品牌区 -->
    <section class="hero">
      <span
        v-for="(d, i) in dots"
        :key="i"
        class="dot-deco"
        :style="{ top: d.top, left: d.left, background: d.c, width: d.s + 'px', height: d.s + 'px' }"
      />
      <div class="hero-body">
        <div class="hero-logo"><AppIcon name="spark" :size="26" /></div>
        <h1 class="hero-title">让每一次回答<br />都有据可查</h1>
        <p class="hero-sub">
          智源问答 · 基于 RAG 检索增强生成的企业知识问答系统。<br />
          上传文档，即刻拥有一个懂业务的 AI 助手。
        </p>
        <div class="hero-features">
          <div class="feature-chip tint-yellow-bold"><AppIcon name="link" :size="14" /> 引用溯源</div>
          <div class="feature-chip tint-mint"><AppIcon name="database" :size="14" /> 知识库管理</div>
          <div class="feature-chip tint-sky"><AppIcon name="chart" :size="14" /> 数据看板</div>
        </div>
      </div>
    </section>

    <!-- 右侧表单区 -->
    <section class="form-side">
      <div class="form-card card-lg">
        <div class="seg-tabs mb-md">
          <button class="seg-tab" :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</button>
          <button class="seg-tab" :class="{ active: mode === 'register' }" @click="mode = 'register'">注册</button>
        </div>

        <form @submit.prevent="submit">
          <div v-if="mode === 'register'" class="field">
            <label class="field-label">昵称</label>
            <input v-model="nickname" class="input" placeholder="给自己起个名字" />
          </div>
          <div class="field">
            <label class="field-label">邮箱</label>
            <input v-model="email" class="input" type="email" placeholder="you@example.com" required />
          </div>
          <div class="field">
            <label class="field-label">密码</label>
            <input v-model="password" class="input" type="password" placeholder="至少 6 位密码" required minlength="6" />
          </div>

          <button class="btn btn-primary btn-block btn-lg" type="submit" :disabled="loading">
            <span v-if="loading" class="spinner"></span>
            {{ loading ? '请稍候…' : mode === 'login' ? '登 录' : '注 册 并 登 录' }}
          </button>
        </form>

        <div class="divider"><span>或</span></div>
        <button class="btn btn-secondary btn-block" @click="guestLogin">
          <AppIcon name="zap" :size="16" /> 游客一键体验
        </button>

        <p class="agreement">登录即代表同意《用户协议》与《隐私政策》</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page { display: flex; height: 100%; }

.hero {
  flex: 1.2; background: var(--brand-navy); color: var(--on-dark);
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
.dot-deco { position: absolute; border-radius: 50%; opacity: 0.9; }
.hero-body { max-width: 480px; padding: 40px; position: relative; z-index: 1; }
.hero-logo {
  width: 52px; height: 52px; border-radius: 14px; margin-bottom: 28px;
  background: rgba(255, 255, 255, 0.1); color: var(--brand-yellow);
  display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.15);
}
.hero-title { font-size: 48px; font-weight: 600; line-height: 1.1; letter-spacing: -1.5px; margin-bottom: 20px; }
.hero-sub { font-size: 16px; line-height: 1.7; color: var(--on-dark-muted); margin-bottom: 32px; }
.hero-features { display: flex; gap: 10px; flex-wrap: wrap; }
.feature-chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: var(--radius-md);
}

.form-side {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 32px; background: var(--surface-soft);
}
.form-card { width: 420px; max-width: 100%; background: var(--canvas); }

.divider { display: flex; align-items: center; gap: 12px; margin: 20px 0; color: var(--stone); font-size: 12px; }
.divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--hairline); }
.agreement { margin-top: 18px; font-size: 12px; color: var(--stone); text-align: center; }

@media (max-width: 860px) {
  .page { flex-direction: column; overflow-y: auto; }
  .hero { flex: none; padding: 48px 0; }
  .hero-title { font-size: 32px; }
  .form-side { flex: none; padding: 24px 16px 48px; }
}
</style>
