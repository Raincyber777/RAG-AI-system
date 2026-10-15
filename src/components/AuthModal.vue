<script setup lang="ts">
/**
 * 登录 / 注册 / 找回密码弹窗（着陆页与应用内共用）
 * 打开状态与模式由 store/auth 管理；演示环境提交即成功
 * 应用内游客态打开弹窗时，登录成功后原地恢复完整权限
 */
import { ref, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { authModalOpen, authModalMode, closeAuth, loginSuccess, guestLogin, type AuthMode } from '@/store/auth'

const route = useRoute()
const router = useRouter()

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

function switchMode(m: AuthMode) {
  authModalMode.value = m
  forgotSent.value = false
}

function submit() {
  loading.value = true
  setTimeout(() => {
    loginSuccess({ register: authModalMode.value === 'register', name: username.value || '林小智' })
    loading.value = false
    // 在着陆页打开的弹窗：登录 / 注册后进入应用；应用内则原地恢复完整权限
    if (route.name === 'login') router.push('/studio')
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

function doGuestLogin() {
  guestLogin()
  if (route.name === 'login') router.push('/studio')
}

// 弹窗打开时锁定背景滚动、支持 Esc 关闭；重新打开时重置找回密码状态
function onEscKey(e: KeyboardEvent) {
  if (e.key === 'Escape') closeAuth()
}
watch(authModalOpen, (v) => {
  document.body.style.overflow = v ? 'hidden' : ''
  if (v) {
    forgotSent.value = false
    window.addEventListener('keydown', onEscKey)
  } else {
    window.removeEventListener('keydown', onEscKey)
  }
})
onBeforeUnmount(() => {
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onEscKey)
})
</script>

<template>
  <Transition name="modal">
    <div v-if="authModalOpen" class="mask" data-guest-allow @click.self="closeAuth">
      <div class="auth-card" role="dialog" aria-modal="true" aria-label="登录或注册">
        <button class="auth-x" aria-label="关闭弹窗" @click="closeAuth"><AppIcon name="x" :size="15" /></button>

        <div class="auth-brand">
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
            <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#zx-auth)" />
            <path d="M16 6.5l2.4 7.1 7.1 2.4-7.1 2.4L16 25.5l-2.4-7.1-7.1-2.4 7.1-2.4z" fill="#fff" />
            <defs>
              <linearGradient id="zx-auth" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                <stop stop-color="#6d5ae0" /><stop offset="1" stop-color="#4534b3" />
              </linearGradient>
            </defs>
          </svg>
          <span class="auth-brand-name">智学纪要</span>
        </div>

        <div v-if="authModalMode !== 'forgot'" class="seg-tabs mb-md">
          <button class="seg-tab" :class="{ active: authModalMode === 'login' }" @click="switchMode('login')">登录</button>
          <button class="seg-tab" :class="{ active: authModalMode === 'register' }" @click="switchMode('register')">注册</button>
        </div>

        <Transition name="form-fade" mode="out-in">
          <!-- 登录 -->
          <form v-if="authModalMode === 'login'" key="login" @submit.prevent="submit">
            <div class="type-tabs" role="tablist" aria-label="登录方式">
              <button type="button" class="type-tab" :class="{ active: loginType === 'email' }" @click="loginType = 'email'">邮箱登录</button>
              <button type="button" class="type-tab" :class="{ active: loginType === 'phone' }" @click="loginType = 'phone'">手机号登录</button>
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
          <form v-else-if="authModalMode === 'register'" key="register" @submit.prevent="submit">
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

        <template v-if="authModalMode !== 'forgot'">
          <div class="divider"><span>或</span></div>
          <button class="btn btn-secondary btn-block" @click="doGuestLogin">
            <AppIcon name="user" :size="16" /> 游客一键体验
          </button>
        </template>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.mask {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(10, 21, 48, 0.45); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
  display: flex; padding: 20px; overflow-y: auto;
}
.auth-card {
  width: 430px; max-width: 100%; margin: auto;
  background: var(--canvas); border-radius: 20px; padding: 26px 28px 24px;
  box-shadow: var(--shadow-modal); position: relative;
}
.auth-x {
  position: absolute; top: 14px; right: 14px;
  border: none; background: var(--surface); color: var(--steel);
  width: 30px; height: 30px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.auth-x:hover { background: var(--hairline-soft); color: var(--ink); }
.auth-brand { display: flex; align-items: center; gap: 9px; margin-bottom: 16px; }
.auth-brand-name { font-size: 17px; font-weight: 800; color: var(--ink-deep); letter-spacing: -0.2px; }
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-active .auth-card, .modal-leave-active .auth-card { transition: transform 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .auth-card, .modal-leave-to .auth-card { transform: translateY(10px) scale(0.98); }

/* 表单细节 */
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
.type-tab.active { background: var(--canvas); color: var(--ink); box-shadow: 0 1px 3px rgba(10, 21, 48, 0.1); }
.aux-row { display: flex; justify-content: flex-end; margin: -4px 0 14px; }
.forgot-link { border: none; background: transparent; padding: 0; font-size: 12.5px; font-weight: 500; color: var(--link-blue); cursor: pointer; }
.forgot-link:hover { text-decoration: underline; }
.agree-row {
  display: flex; align-items: flex-start; gap: 8px;
  margin: 4px 0 16px; font-size: 12.5px; color: var(--slate);
  line-height: 1.6; cursor: pointer; user-select: none;
}
.agree-row input[type='checkbox'] { width: 15px; height: 15px; margin-top: 2px; accent-color: var(--primary); cursor: pointer; flex-shrink: 0; }
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
.form-fade-enter-active, .form-fade-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.form-fade-enter-from, .form-fade-leave-to { opacity: 0; transform: translateY(6px); }
</style>
