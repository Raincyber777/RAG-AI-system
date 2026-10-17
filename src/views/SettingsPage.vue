<script setup lang="ts">
/**
 * 个人设置：资料 / 手机号 / 邮箱 / 头像 / 密码
 * 修改统一走后端 /auth/me/ 与 /auth/password/；手机号 / 邮箱的短信验证码为演示流程（123456）
 * 转写、抽帧、纪要生成与问答参数统一采用系统最佳配置，不提供用户侧调整
 */
import { ref, reactive, computed, onBeforeUnmount } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { userProfile } from '@/store/study'
import { isGuest, openAuth, updateCurrentUser } from '@/store/auth'
import { authApi } from '@/api'
import { ApiError } from '@/api/http'
import { UPLOAD_ACCEPT, isSupportedImage } from '@/utils/uploadFormats'

// ---------- 个人资料（保存后经 updateCurrentUser 同步会话与共享资料） ----------
const nameInput = ref(userProfile.name)
const savedProfile = ref(false)
const showSaveConfirm = ref(false)
function saveProfile() {
  showSaveConfirm.value = true
}
async function confirmSave() {
  const name = nameInput.value.trim() || userProfile.name
  showSaveConfirm.value = false
  try {
    const u = await authApi.updateMe({ name })
    updateCurrentUser(u)
    savedProfile.value = true
    setTimeout(() => (savedProfile.value = false), 1800)
  } catch (e) {
    showAvatarTip(e instanceof ApiError ? e.message : '保存失败，请确认后端已启动')
  }
}

// 头像上传（选择后直接上传到后端，返回的媒体地址同步到共享资料）
const avatarInput = ref<HTMLInputElement>()
const avatarTip = ref('')
let avatarTipTimer: number | null = null
function pickAvatar() {
  avatarInput.value?.click()
}
async function onAvatarChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  if (!isSupportedImage(f.name)) {
    showAvatarTip('仅支持图片格式（jpg / jpeg / png / webp / gif）')
    return
  }
  if (f.size > 5 * 1024 * 1024) {
    showAvatarTip('图片大小不能超过 5MB')
    return
  }
  try {
    const u = await authApi.updateAvatar(f)
    updateCurrentUser(u)
    showAvatarTip('头像已更新')
  } catch (err) {
    showAvatarTip(err instanceof ApiError ? err.message : '头像上传失败，请确认后端已启动')
  }
}
function showAvatarTip(t: string) {
  avatarTip.value = t
  if (avatarTipTimer) window.clearTimeout(avatarTipTimer)
  avatarTipTimer = window.setTimeout(() => (avatarTip.value = ''), 2600)
}

// ---------- 手机号 / 邮箱更换（短信验证码为演示流程；更换请求由后端校验占用） ----------
const PHONE_RE = /^1[3-9]\d{9}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEMO_CODE = '123456'

function maskPhone(p: string) {
  return p.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
}
function maskEmail(e: string) {
  const i = e.indexOf('@')
  return i <= 2 ? e : e.slice(0, 2) + '***' + e.slice(i)
}

const phone = reactive({ changing: false, value: '', code: '', error: '', sent: '', done: false })
const email = reactive({ changing: false, value: '', code: '', error: '', sent: '', done: false })
const cooldowns = reactive({ phone: 0, email: 0 })
const timers: Record<'phone' | 'email', number> = { phone: 0, email: 0 }

// 敏感信息默认以「·」展示，点眼睛查看真实内容
const showPhone = ref(false)
const showNewPhone = ref(false)
const showPwdOld = ref(false)
const showPwdNew = ref(false)
const showPwdConfirm = ref(false)

// 输入时实时校验提示（不等提交才报错）
const phoneMsg = computed(() => {
  const v = phone.value.trim()
  if (!v) return { text: '请输入 11 位手机号', ok: false }
  if (!PHONE_RE.test(v)) return { text: '手机号格式不正确', ok: false }
  return { text: '请填写能正常接收短信的手机号', ok: true }
})
const emailMsg = computed(() => {
  const v = email.value.trim()
  if (!v) return { text: '请输入邮箱地址', ok: false }
  if (!EMAIL_RE.test(v)) return { text: '邮箱格式不正确', ok: false }
  return { text: '请填写可正常收信的邮箱地址', ok: true }
})

function startCooldown(which: 'phone' | 'email') {
  cooldowns[which] = 60
  timers[which] = window.setInterval(() => {
    cooldowns[which] = Math.max(0, cooldowns[which] - 1)
    if (cooldowns[which] === 0) window.clearInterval(timers[which])
  }, 1000)
}
function stopCooldown(which: 'phone' | 'email') {
  cooldowns[which] = 0
  window.clearInterval(timers[which])
}

function startPhone() {
  Object.assign(phone, { changing: true, value: '', code: '', error: '', sent: '' })
}
function sendPhoneCode() {
  phone.error = ''
  const v = phone.value.trim()
  if (!v) { phone.error = '请输入 11 位手机号'; return }
  if (!PHONE_RE.test(v)) { phone.error = '手机号格式不正确'; return }
  if (v === userProfile.phone) { phone.error = '新手机号与当前手机号相同'; return }
  startCooldown('phone')
  phone.sent = `验证码已发送至 ${maskPhone(v)}（演示验证码：${DEMO_CODE}）`
}
async function confirmPhone() {
  phone.error = ''
  if (!/^\d{6}$/.test(phone.code)) { phone.error = '请输入 6 位数字验证码'; return }
  if (phone.code !== DEMO_CODE) { phone.error = '验证码不正确，请重新输入'; return }
  try {
    const u = await authApi.updateMe({ phone: phone.value.trim() })
    updateCurrentUser(u)
    cancelPhone()
    phone.done = true
    setTimeout(() => (phone.done = false), 2600)
  } catch (e) {
    phone.error = e instanceof ApiError ? e.message : '更换失败，请确认后端已启动'
  }
}
function cancelPhone() {
  Object.assign(phone, { changing: false, value: '', code: '', error: '', sent: '' })
  stopCooldown('phone')
}

function startEmail() {
  Object.assign(email, { changing: true, value: '', code: '', error: '', sent: '' })
}
function sendEmailCode() {
  email.error = ''
  const v = email.value.trim()
  if (!v) { email.error = '请输入邮箱地址'; return }
  if (!EMAIL_RE.test(v)) { email.error = '邮箱格式不正确'; return }
  if (v === userProfile.email) { email.error = '新邮箱与当前邮箱相同'; return }
  startCooldown('email')
  email.sent = `验证码已发送至原邮箱 ${maskEmail(userProfile.email)}（演示验证码：${DEMO_CODE}）`
}
async function confirmEmail() {
  email.error = ''
  if (!/^\d{6}$/.test(email.code)) { email.error = '请输入 6 位数字验证码'; return }
  if (email.code !== DEMO_CODE) { email.error = '验证码不正确，请重新输入'; return }
  try {
    const u = await authApi.updateMe({ email: email.value.trim() })
    updateCurrentUser(u)
    cancelEmail()
    email.done = true
    setTimeout(() => (email.done = false), 2600)
  } catch (e) {
    email.error = e instanceof ApiError ? e.message : '更换失败，请确认后端已启动'
  }
}
function cancelEmail() {
  Object.assign(email, { changing: false, value: '', code: '', error: '', sent: '' })
  stopCooldown('email')
}

onBeforeUnmount(() => {
  stopCooldown('phone')
  stopCooldown('email')
  if (avatarTipTimer) window.clearTimeout(avatarTipTimer)
})

// 修改密码（前端预校验后调用后端修改接口，旧密码校验由后端完成）
const pwdForm = reactive({ old: '', next: '', confirm: '', error: '' })
const savedPwd = ref(false)
const pwdBusy = ref(false)
async function updatePassword() {
  pwdForm.error = ''
  if (!pwdForm.old) { pwdForm.error = '请输入当前密码'; return }
  if (pwdForm.next.length < 8) { pwdForm.error = '新密码至少需要 8 位'; return }
  if (pwdForm.next === pwdForm.old) { pwdForm.error = '新密码不能与当前密码相同'; return }
  if (!pwdForm.confirm) { pwdForm.error = '请再次输入新密码'; return }
  if (pwdForm.confirm !== pwdForm.next) { pwdForm.error = '两次输入的新密码不一致'; return }
  if (pwdBusy.value) return
  pwdBusy.value = true
  try {
    await authApi.changePassword(pwdForm.old, pwdForm.next)
    Object.assign(pwdForm, { old: '', next: '', confirm: '' })
    savedPwd.value = true
    setTimeout(() => (savedPwd.value = false), 1800)
  } catch (e) {
    pwdForm.error = e instanceof ApiError ? e.message : '密码修改失败，请确认后端已启动'
  } finally {
    pwdBusy.value = false
  }
}

</script>

<template>
  <div class="page">
    <header class="mb-md">
      <h1 class="h2">个人设置</h1>
      <p class="text-sm">维护个人资料与账号安全</p>
    </header>

    <!-- 游客态：待登录，仅展示提示卡片 -->
    <template v-if="isGuest">
      <div class="group-head">
        <h2 class="group-title">账号与安全</h2>
        <span class="group-sub">待登录</span>
      </div>
      <div class="card card-lg guest-state">
        <span class="guest-ico"><AppIcon name="lock" :size="22" /></span>
        <div class="guest-title">登录后即可管理个人资料与账号安全</div>
        <p class="guest-desc">当前为游客模式，仅可浏览演示内容。登录或注册后，即可在这里维护头像、用户名、手机号、邮箱与密码。</p>
        <div class="guest-actions">
          <button class="btn btn-primary" data-guest-allow @click="openAuth('login')">立即登录</button>
          <button class="btn btn-secondary" data-guest-allow @click="openAuth('register')">注册新账号</button>
        </div>
      </div>
    </template>

    <!-- 已登录：个人资料 + 修改密码 -->
    <template v-else>
    <div class="group-head">
      <h2 class="group-title">账号与安全</h2>
      <span class="group-sub">资料 · 密码</span>
    </div>
    <div class="grid">
      <div class="col">
        <!-- 个人资料 -->
        <section class="card card-lg">
          <div class="flex items-center gap-md mb-md">
            <button class="avatar-edit" type="button" title="更换头像" aria-label="更换头像" @click="pickAvatar">
              <img v-if="userProfile.avatar" :src="userProfile.avatar" class="avatar-img" alt="用户头像" />
              <span v-else class="avatar avatar-lg" :style="{ background: userProfile.color }">{{ nameInput[0] || '智' }}</span>
              <span class="avatar-mask"><AppIcon name="image" :size="12" /> 更换</span>
            </button>
            <input ref="avatarInput" type="file" hidden :accept="UPLOAD_ACCEPT.image" @change="onAvatarChange" />
            <div>
              <div class="h3">{{ nameInput || userProfile.name }}</div>
              <div class="text-sm">{{ userProfile.email }}</div>
            </div>
          </div>
          <p v-if="avatarTip" class="avatar-tip">{{ avatarTip }}</p>

          <div class="field">
            <label class="field-label">用户名</label>
            <input v-model="nameInput" class="input" placeholder="请输入用户名" />
          </div>

          <div class="field">
            <label class="field-label">电话号码</label>
            <div v-if="!phone.changing" class="locked-row">
              <div class="secret-wrap flex-1">
                <input
                  class="input input-locked" :value="showPhone ? userProfile.phone : userProfile.phone.replace(/./g, '·')"
                  readonly aria-label="当前手机号（点眼睛查看）"
                />
                <button type="button" class="eye-btn" :aria-label="showPhone ? '隐藏手机号' : '显示手机号'" @click="showPhone = !showPhone">
                  <AppIcon :name="showPhone ? 'eye-off' : 'eye'" :size="15" />
                </button>
              </div>
              <button class="btn btn-secondary change-btn" @click="startPhone">更换</button>
            </div>
            <div v-else class="change-panel">
              <div class="secret-wrap">
                <input
                  v-model="phone.value"
                  class="input"
                  :class="{ 'text-masked': !showNewPhone }"
                  placeholder="请输入新手机号"
                  maxlength="11"
                  inputmode="numeric"
                  @input="phone.error = ''"
                />
                <button type="button" class="eye-btn" :aria-label="showNewPhone ? '隐藏新手机号' : '显示新手机号'" @click="showNewPhone = !showNewPhone">
                  <AppIcon :name="showNewPhone ? 'eye-off' : 'eye'" :size="15" />
                </button>
              </div>
              <p class="field-hint" :class="phone.error || !phoneMsg.ok ? 'hint-err' : 'hint-ok'">
                {{ phone.error || phoneMsg.text }}
              </p>
              <div class="code-row">
                <input v-model="phone.code" class="input" placeholder="6 位验证码" maxlength="6" inputmode="numeric" />
                <button class="btn btn-secondary code-btn" :disabled="cooldowns.phone > 0 || !phoneMsg.ok" @click="sendPhoneCode">
                  {{ cooldowns.phone > 0 ? cooldowns.phone + 's 后重发' : '获取验证码' }}
                </button>
              </div>
              <p v-if="phone.sent" class="field-hint hint-ok">{{ phone.sent }}</p>
              <div class="change-actions">
                <button class="btn btn-primary" @click="confirmPhone">确认更换</button>
                <button class="btn btn-secondary" @click="cancelPhone">取消</button>
              </div>
            </div>
            <p v-if="phone.done && !phone.changing" class="field-hint hint-ok">手机号已更换</p>
          </div>

          <div class="field">
            <label class="field-label">邮箱</label>
            <div v-if="!email.changing" class="locked-row">
              <input class="input input-locked" :value="userProfile.email" readonly aria-label="当前邮箱" />
              <button class="btn btn-secondary change-btn" @click="startEmail">更换</button>
            </div>
            <div v-else class="change-panel">
              <input
                v-model="email.value"
                class="input"
                type="email"
                placeholder="请输入新邮箱地址"
                @input="email.error = ''"
              />
              <p class="field-hint" :class="email.error || !emailMsg.ok ? 'hint-err' : 'hint-ok'">
                {{ email.error || emailMsg.text }}
              </p>
              <div class="code-row">
                <input v-model="email.code" class="input" placeholder="6 位验证码" maxlength="6" inputmode="numeric" />
                <button class="btn btn-secondary code-btn" :disabled="cooldowns.email > 0 || !emailMsg.ok" @click="sendEmailCode">
                  {{ cooldowns.email > 0 ? cooldowns.email + 's 后重发' : '获取验证码' }}
                </button>
              </div>
              <p v-if="email.sent" class="field-hint hint-ok">{{ email.sent }}</p>
              <div class="change-actions">
                <button class="btn btn-primary" @click="confirmEmail">确认更换</button>
                <button class="btn btn-secondary" @click="cancelEmail">取消</button>
              </div>
            </div>
            <p v-if="email.done && !email.changing" class="field-hint hint-ok">邮箱已更换</p>
          </div>

          <button class="btn btn-primary" @click="saveProfile">
            <AppIcon v-if="savedProfile" name="check" :size="15" /> {{ savedProfile ? '已保存' : '保存资料' }}
          </button>
        </section>

      </div>
      <div class="col">
          <!-- 修改密码：与个人资料同组，账号安全相关设置集中在一起 -->
          <section class="card card-lg">
            <div class="h4 mb-sm"><AppIcon name="lock" :size="15" /> 修改密码</div>
            <div class="field">
              <label class="field-label">当前密码</label>
              <div class="secret-wrap">
                <input v-model="pwdForm.old" class="input" :type="showPwdOld ? 'text' : 'password'" placeholder="请输入当前密码" autocomplete="current-password" />
                <button type="button" class="eye-btn" :aria-label="showPwdOld ? '隐藏当前密码' : '显示当前密码'" @click="showPwdOld = !showPwdOld">
                  <AppIcon :name="showPwdOld ? 'eye-off' : 'eye'" :size="15" />
                </button>
              </div>
            </div>
            <div class="field">
              <label class="field-label">新密码</label>
              <div class="secret-wrap">
                <input v-model="pwdForm.next" class="input" :type="showPwdNew ? 'text' : 'password'" placeholder="请输入新密码" autocomplete="new-password" />
                <button type="button" class="eye-btn" :aria-label="showPwdNew ? '隐藏新密码' : '显示新密码'" @click="showPwdNew = !showPwdNew">
                  <AppIcon :name="showPwdNew ? 'eye-off' : 'eye'" :size="15" />
                </button>
              </div>
              <p class="field-hint">至少 8 位，建议包含字母、数字与符号</p>
            </div>
            <div class="field">
              <label class="field-label">确认新密码</label>
              <div class="secret-wrap">
                <input v-model="pwdForm.confirm" class="input" :type="showPwdConfirm ? 'text' : 'password'" placeholder="请再次输入新密码" autocomplete="new-password" @input="pwdForm.error = ''" />
                <button type="button" class="eye-btn" :aria-label="showPwdConfirm ? '隐藏确认密码' : '显示确认密码'" @click="showPwdConfirm = !showPwdConfirm">
                  <AppIcon :name="showPwdConfirm ? 'eye-off' : 'eye'" :size="15" />
                </button>
              </div>
            </div>
            <p v-if="pwdForm.error" class="field-hint hint-err">{{ pwdForm.error }}</p>
            <button class="btn btn-primary" @click="updatePassword">
              <AppIcon v-if="savedPwd" name="check" :size="15" /> {{ savedPwd ? '已更新' : '更新密码' }}
            </button>
          </section>
        </div>
      </div>
    </template>

    <!-- 保存资料确认弹窗 -->
    <div v-if="showSaveConfirm" class="modal-mask" @click.self="showSaveConfirm = false">
      <div class="modal modal-sm">
        <div class="modal-title">保存个人资料</div>
        <p class="modal-sub">确认保存修改后的用户名吗？头像以及手机号、邮箱的更改已在验证通过后立即生效。</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="showSaveConfirm = false">取消</button>
          <button class="btn btn-primary" @click="confirmSave">确认保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 28px 32px 40px; max-width: 1080px; width: 100%; margin: 0 auto; }
/* 分组标题：组名 + 说明 + 贯穿分隔线 */
.group-head { display: flex; align-items: center; gap: 10px; margin: 30px 0 14px; }
.group-head:first-of-type { margin-top: 4px; }
.group-title { font-size: 15px; font-weight: 600; color: var(--charcoal); letter-spacing: 0.2px; }
.group-sub { font-size: 12.5px; color: var(--stone); }
.group-head::after { content: ''; flex: 1; height: 1px; background: var(--hairline); }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.col { display: flex; flex-direction: column; gap: 16px; }

/* ---------- 游客态：待登录提示 ---------- */
.guest-state {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: 56px 32px; margin-top: 4px;
}
.guest-ico {
  width: 52px; height: 52px; border-radius: 50%;
  background: var(--tint-lavender); color: var(--primary);
  display: flex; align-items: center; justify-content: center; margin-bottom: 16px;
}
.guest-title { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
.guest-desc { font-size: 13px; color: var(--slate); line-height: 1.7; max-width: 420px; margin-bottom: 20px; }
.guest-actions { display: flex; gap: 10px; }

/* ---------- 个人资料 ---------- */
.avatar-edit {
  position: relative; width: 64px; height: 64px; border-radius: 50%;
  padding: 0; border: none; background: none; cursor: pointer;
  overflow: hidden; flex-shrink: 0; display: block;
}
.avatar-img { width: 64px; height: 64px; object-fit: cover; border-radius: 50%; display: block; }
.avatar-mask {
  position: absolute; inset: 0; border-radius: 50%;
  background: rgba(15, 15, 15, 0.45); color: #fff;
  display: flex; align-items: center; justify-content: center; gap: 4px;
  font-size: 11px; font-weight: 600; opacity: 0; transition: opacity 0.15s ease;
}
.avatar-edit:hover .avatar-mask, .avatar-edit:focus-visible .avatar-mask { opacity: 1; }
.avatar-tip { font-size: 12px; color: var(--brand-green); margin: -8px 0 12px; }
.locked-row { display: flex; align-items: center; gap: 8px; }
.locked-row .secret-wrap { flex: 1; min-width: 0; }
.input-locked { background: var(--surface-soft); color: var(--steel); cursor: not-allowed; }
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
.change-btn { flex-shrink: 0; }
.change-panel {
  border: 1px solid var(--hairline); border-radius: var(--radius-md);
  background: var(--surface-soft); padding: 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.code-row { display: flex; align-items: center; gap: 8px; }
.code-row .input { flex: 1; }
.code-btn { flex-shrink: 0; white-space: nowrap; }
.change-actions { display: flex; gap: 8px; margin-top: 2px; }
.field-hint.hint-ok { color: var(--brand-green); }
.field-hint.hint-err { color: #d92d20; }
.modal-sm { max-width: 440px; }
.modal-sub { color: var(--slate); line-height: 1.7; }

@media (max-width: 900px) {
  .page { padding: 20px 16px; }
  .grid { grid-template-columns: 1fr; }
}
</style>
