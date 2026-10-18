<script setup lang="ts">
/**
 * 登录 / 注册 / 找回密码弹窗（着陆页与应用内共用）
 * 打开状态与模式由 store/auth 管理；登录 / 注册走后端接口，失败在弹窗内提示
 * 应用内游客态打开弹窗时，登录成功后原地恢复完整权限
 */
import { ref, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import LogoMark from '@/components/LogoMark.vue'
import PolicyModal from '@/components/PolicyModal.vue'
import { PRIVACY_POLICY, USER_AGREEMENT, type PolicyDoc } from '@/content/policies'
import {
  authModalOpen, authModalMode, closeAuth, guestLogin, login, register,
  buildAdminSsoUrl, type AuthMode,
} from '@/store/auth'
import { authApi, type CodeChannel } from '@/api'
import { ApiError } from '@/api/http'

const route = useRoute()
const router = useRouter()

/** 当前查看的协议文档（null 表示关闭）；由勾选处链接 / 页脚打开 */
const policyDoc = ref<PolicyDoc | null>(null)

// 登录方式：邮箱 / 手机号
type LoginType = 'email' | 'phone'
const loginType = ref<LoginType>('email')

const username = ref('')
const phone = ref('')
const email = ref('')
const password = ref('')
const agree = ref(false)
const loading = ref(false)
const errorMsg = ref('')

// 敏感信息（手机号 / 密码）默认以「·」展示，点眼睛可查看真实内容
const showLoginPhone = ref(false)
const showLoginPwd = ref(false)
const showRegPhone = ref(false)
const showRegPwd = ref(false)

// 注册验证码：接收通道按后端实际开通情况展示，发送后 60s 倒计时
const code = ref('')
const codeChannel = ref<CodeChannel>('email')
const channels = ref({ email: true, phone: false })
const channelsLoaded = ref(false)
const sendingCode = ref(false)
const codeCountdown = ref(0)
const codeSentTip = ref('')
let codeTimer: ReturnType<typeof setInterval> | null = null

// 找回密码（演示流程，支持手机号或邮箱）
const forgotAccount = ref('')
const forgotSent = ref(false)
const forgotSending = ref(false)

function switchMode(m: AuthMode) {
  authModalMode.value = m
  errorMsg.value = ''
  forgotSent.value = false
  if (m === 'register' && !channelsLoaded.value) {
    // 只拉一次可用通道；失败按默认（仅邮箱）处理，发码时后端会给出具体提示
    channelsLoaded.value = true
    authApi.codeChannels()
      .then((d) => {
        channels.value = d
        if (!d.email && d.phone) codeChannel.value = 'phone' // 邮箱未开通时默认短信
      })
      .catch(() => {})
  }
}

/** 登录 / 注册成功后：管理员 / 超级管理员携带 token 进入管理端，普通用户进入用户端 */
function afterAuthed(isAdmin: boolean) {
  loading.value = false
  if (isAdmin) {
    window.location.href = buildAdminSsoUrl()
    return
  }
  // 在着陆页打开的弹窗：登录 / 注册后进入应用；应用内则原地恢复完整权限
  if (route.name === 'login') router.push('/studio')
}

async function submit() {
  if (loading.value) return
  errorMsg.value = ''
  loading.value = true
  try {
    if (authModalMode.value === 'register') {
      await register({
        name: username.value.trim(), phone: phone.value.trim(), email: email.value.trim(),
        password: password.value, code: code.value.trim(), code_channel: codeChannel.value,
      })
      afterAuthed(false) // 注册账号固定为普通用户
    } else {
      const id = loginType.value === 'email' ? email.value.trim() : phone.value.trim()
      const payload = await login(id, password.value)
      // 分权：管理员账号在用户端登录 → 先进入管理端（管理端通过 sso 参数免登）
      afterAuthed(payload.user.role !== 'user')
    }
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? e.message : '网络异常，请稍后再试'
    loading.value = false
  }
}

/** 验证码按钮文案：发送中 / 倒计时 / 待获取 */
const codeBtnLabel = () =>
  sendingCode.value ? '发送中…' : codeCountdown.value > 0 ? `${codeCountdown.value}s 后重发` : '获取验证码'

/** 开始 60s 重发倒计时；期间按钮禁用，弹窗关闭即终止 */
function startCountdown() {
  codeCountdown.value = 60
  codeTimer = setInterval(() => {
    codeCountdown.value -= 1
    if (codeCountdown.value <= 0 && codeTimer) {
      clearInterval(codeTimer)
      codeTimer = null
    }
  }, 1000)
}

/** 向当前通道的接收目标发送注册验证码 */
async function sendCode() {
  if (sendingCode.value || codeCountdown.value > 0) return
  const target = (codeChannel.value === 'email' ? email.value : phone.value).trim()
  if (codeChannel.value === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
    errorMsg.value = '请先填写正确的邮箱'
    return
  }
  if (codeChannel.value === 'phone' && !/^1[3-9]\d{9}$/.test(target)) {
    errorMsg.value = '请先填写正确的手机号'
    return
  }
  errorMsg.value = ''
  sendingCode.value = true
  try {
    const res = await authApi.sendCode(codeChannel.value, target)
    codeSentTip.value = res.detail
    if (res.dev_code) code.value = res.dev_code // 本地 DEBUG：验证码未真正发出，直接回填
    startCountdown()
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? e.message : '网络异常，请稍后再试'
  } finally {
    sendingCode.value = false
  }
}

function stopCountdown() {
  if (codeTimer) {
    clearInterval(codeTimer)
    codeTimer = null
  }
  codeCountdown.value = 0
}

/** 协议弹窗内的文档切换 */
function switchPolicy(key: PolicyDoc['key']) {
  policyDoc.value = key === 'terms' ? USER_AGREEMENT : PRIVACY_POLICY
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

// 弹窗打开时锁定背景滚动、支持 Esc 关闭；重新打开时重置找回密码 / 验证码状态
function onEscKey(e: KeyboardEvent) {
  if (e.key === 'Escape') closeAuth()
}
watch(authModalOpen, (v) => {
  document.body.style.overflow = v ? 'hidden' : ''
  if (v) {
    forgotSent.value = false
    errorMsg.value = ''
    codeSentTip.value = ''
    stopCountdown()
    window.addEventListener('keydown', onEscKey)
  } else {
    window.removeEventListener('keydown', onEscKey)
  }
})
onBeforeUnmount(() => {
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onEscKey)
  stopCountdown()
})
</script>

<template>
  <Transition name="modal">
    <!-- 根类名用 auth-mask：避开 AppLayout 作用域的 .mask { display:none }（Vue 会把父组件作用域属性传给子组件根节点，导致弹窗被隐藏） -->
    <div v-if="authModalOpen" class="auth-mask" data-guest-allow @click.self="closeAuth">
      <div class="auth-card" role="dialog" aria-modal="true" aria-label="登录或注册">
        <button class="auth-x" aria-label="关闭弹窗" @click="closeAuth"><AppIcon name="x" :size="15" /></button>

        <div class="auth-brand">
          <LogoMark :size="26" />
          <span class="auth-brand-name">智学纪要</span>
        </div>

        <div v-if="authModalMode !== 'forgot'" class="seg-tabs mb-md">
          <button class="seg-tab" :class="{ active: authModalMode === 'login' }" @click="switchMode('login')">登录</button>
          <button class="seg-tab" :class="{ active: authModalMode === 'register' }" @click="switchMode('register')">注册</button>
        </div>

        <div v-if="errorMsg" class="error-box" role="alert">{{ errorMsg }}</div>

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
              <div class="secret-wrap">
                <input
                  id="login-phone" v-model="phone" class="input" type="text" inputmode="numeric"
                  :class="{ 'text-masked': !showLoginPhone }" placeholder="请输入 11 位手机号"
                  required pattern="1[3-9]\d{9}" maxlength="11" title="请输入 11 位手机号"
                />
                <button type="button" class="eye-btn" :aria-label="showLoginPhone ? '隐藏手机号' : '显示手机号'" @click="showLoginPhone = !showLoginPhone">
                  <AppIcon :name="showLoginPhone ? 'eye-off' : 'eye'" :size="15" />
                </button>
              </div>
            </div>

            <div class="field">
              <label class="field-label" for="login-pwd">密码</label>
              <div class="secret-wrap">
                <input id="login-pwd" v-model="password" class="input" :type="showLoginPwd ? 'text' : 'password'" placeholder="请输入密码" required minlength="6" />
                <button type="button" class="eye-btn" :aria-label="showLoginPwd ? '隐藏密码' : '显示密码'" @click="showLoginPwd = !showLoginPwd">
                  <AppIcon :name="showLoginPwd ? 'eye-off' : 'eye'" :size="15" />
                </button>
              </div>
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
              <div class="secret-wrap">
                <input
                  id="reg-phone" v-model="phone" class="input" type="text" inputmode="numeric"
                  :class="{ 'text-masked': !showRegPhone }" placeholder="11 位手机号"
                  required pattern="1[3-9]\d{9}" maxlength="11" title="请输入 11 位手机号"
                />
                <button type="button" class="eye-btn" :aria-label="showRegPhone ? '隐藏手机号' : '显示手机号'" @click="showRegPhone = !showRegPhone">
                  <AppIcon :name="showRegPhone ? 'eye-off' : 'eye'" :size="15" />
                </button>
              </div>
            </div>
            <div class="field">
              <label class="field-label" for="reg-email">邮箱</label>
              <input id="reg-email" v-model="email" class="input" type="email" placeholder="you@example.com" required />
            </div>
            <div class="field">
              <label class="field-label" for="reg-code">验证码</label>
              <!-- 接收方式仅展示后端实际开通的通道（/auth/code-channels/ 协商） -->
              <div v-if="channels.email && channels.phone" class="type-tabs code-way" role="tablist" aria-label="验证码接收方式">
                <button type="button" class="type-tab" :class="{ active: codeChannel === 'email' }" @click="codeChannel = 'email'">邮箱接收</button>
                <button type="button" class="type-tab" :class="{ active: codeChannel === 'phone' }" @click="codeChannel = 'phone'">短信接收</button>
              </div>
              <div class="code-row">
                <input
                  id="reg-code" v-model="code" class="input code-input" type="text" inputmode="numeric"
                  placeholder="6 位数字" required pattern="\d{6}" maxlength="6" title="6 位数字验证码" autocomplete="one-time-code"
                />
                <button
                  type="button" class="btn btn-secondary code-send"
                  :disabled="sendingCode || codeCountdown > 0"
                  @click="sendCode"
                >{{ codeBtnLabel() }}</button>
              </div>
              <div v-if="codeSentTip" class="code-tip">{{ codeSentTip }}</div>
            </div>
            <div class="field">
              <label class="field-label" for="reg-pwd">密码</label>
              <div class="secret-wrap">
                <input id="reg-pwd" v-model="password" class="input" :type="showRegPwd ? 'text' : 'password'" placeholder="至少 6 位密码" required minlength="6" />
                <button type="button" class="eye-btn" :aria-label="showRegPwd ? '隐藏密码' : '显示密码'" @click="showRegPwd = !showRegPwd">
                  <AppIcon :name="showRegPwd ? 'eye-off' : 'eye'" :size="15" />
                </button>
              </div>
            </div>
            <label class="agree-row">
              <input v-model="agree" type="checkbox" />
              <span>我已阅读并同意<a href="#" @click.stop.prevent="policyDoc = USER_AGREEMENT">《用户协议》</a>与<a href="#" @click.stop.prevent="policyDoc = PRIVACY_POLICY">《隐私政策》</a></span>
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
                <div class="text-caption">请前往 {{ forgotAccount }} 查收</div>
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

  <!-- 用户协议 / 隐私政策查看弹窗 -->
  <PolicyModal :doc="policyDoc" @close="policyDoc = null" @switch="switchPolicy" />
</template>

<style scoped>
.auth-mask {
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
/* 敏感信息输入框：手机号 / 密码默认以「·」展示，右侧眼睛切换明文 */
.secret-wrap { position: relative; }
.secret-wrap .input { padding-right: 40px; }
/* Chromium 系列生效的文本打点（type=text 但视觉上等价密码框） */
.text-masked { -webkit-text-security: disc; }
.eye-btn {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; border-radius: var(--radius-sm);
  color: var(--stone); cursor: pointer; transition: color 0.15s ease, background 0.15s ease;
}
.eye-btn:hover { color: var(--ink); background: var(--surface-soft); }
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
/* 注册验证码：通道小标签 + 输入框与「获取验证码」同行 */
.code-way { margin-bottom: 10px; padding: 3px; }
.code-way .type-tab { font-size: 12px; padding: 6px 0; }
.code-row { display: flex; gap: 8px; }
.code-input { flex: 1; letter-spacing: 3px; }
.code-send { white-space: nowrap; padding: 0 14px; font-size: 13px; font-weight: 600; }
.code-send:disabled { opacity: 0.55; cursor: not-allowed; }
.code-tip { margin-top: 7px; font-size: 12px; color: var(--brand-green); line-height: 1.5; }
.aux-row { display: flex; justify-content: flex-end; margin: -4px 0 14px; }
.forgot-link { border: none; background: transparent; padding: 0; font-size: 12.5px; font-weight: 500; color: var(--link-blue); cursor: pointer; }
.forgot-link:hover { text-decoration: underline; }
.agree-row {
  display: flex; align-items: flex-start; gap: 8px;
  margin: 4px 0 16px; font-size: 12.5px; color: var(--slate);
  line-height: 1.6; cursor: pointer; user-select: none;
}
.agree-row input[type='checkbox'] { width: 15px; height: 15px; margin-top: 2px; accent-color: var(--primary); cursor: pointer; flex-shrink: 0; }
/* 登录 / 注册失败提示（后端返回的错误信息） */
.error-box {
  background: var(--tint-rose); color: var(--error);
  font-size: 13px; font-weight: 500; line-height: 1.5;
  border-radius: var(--radius-md); padding: 10px 14px; margin-bottom: 14px;
}
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
