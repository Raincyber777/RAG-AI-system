<script setup lang="ts">
/**
 * 个人设置：资料 / 转写设置 / 视频抽帧 / 纪要生成 / 课堂问答调优 / 密码 / 通知
 * 所有参数为演示状态，接入真实后端后保存接口替换 onClick 回调即可
 */
import { ref, reactive, computed, onBeforeUnmount } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { userProfile } from '@/store/study'

// ---------- 个人资料（userProfile 为共享状态，侧边栏用户卡片实时同步） ----------
const nameInput = ref(userProfile.name)
const savedProfile = ref(false)
const showSaveConfirm = ref(false)
function saveProfile() {
  showSaveConfirm.value = true
}
function confirmSave() {
  userProfile.name = nameInput.value.trim() || userProfile.name
  showSaveConfirm.value = false
  savedProfile.value = true
  setTimeout(() => (savedProfile.value = false), 1800)
}

// 头像上传（演示：本地预览；接入后端后替换为上传接口并保存返回的 URL）
const avatarInput = ref<HTMLInputElement>()
const avatarTip = ref('')
let avatarTipTimer: number | null = null
function pickAvatar() {
  avatarInput.value?.click()
}
function onAvatarChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  if (!f.type.startsWith('image/')) {
    showAvatarTip('仅支持图片文件（jpg / png / webp / gif 等）')
    return
  }
  if (f.size > 5 * 1024 * 1024) {
    showAvatarTip('图片大小不能超过 5MB')
    return
  }
  if (userProfile.avatar) URL.revokeObjectURL(userProfile.avatar)
  userProfile.avatar = URL.createObjectURL(f)
  showAvatarTip('头像已更新')
}
function showAvatarTip(t: string) {
  avatarTip.value = t
  if (avatarTipTimer) window.clearTimeout(avatarTipTimer)
  avatarTipTimer = window.setTimeout(() => (avatarTip.value = ''), 2600)
}

// ---------- 手机号 / 邮箱更换（验证码 60s 一次，演示验证码 123456） ----------
const PHONE_RE = /^1[3-9]\d{9}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEMO_CODE = '123456'
// 模拟已被其他账号绑定的手机号 / 邮箱（接入后端后由接口校验）
const takenPhones = ['13800138000', '13900000000']
const takenEmails = ['demo@zhiyuan.ai', 'test@163.com']

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
  if (takenPhones.includes(v)) { phone.error = '该手机号已绑定其他账号'; return }
  startCooldown('phone')
  phone.sent = `验证码已发送至 ${maskPhone(v)}（演示验证码：${DEMO_CODE}）`
}
function confirmPhone() {
  phone.error = ''
  if (!/^\d{6}$/.test(phone.code)) { phone.error = '请输入 6 位数字验证码'; return }
  if (phone.code !== DEMO_CODE) { phone.error = '验证码不正确，请重新输入'; return }
  userProfile.phone = phone.value.trim()
  cancelPhone()
  phone.done = true
  setTimeout(() => (phone.done = false), 2600)
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
  if (takenEmails.includes(v)) { email.error = '该邮箱已绑定其他账号'; return }
  startCooldown('email')
  email.sent = `验证码已发送至原邮箱 ${maskEmail(userProfile.email)}（演示验证码：${DEMO_CODE}）`
}
function confirmEmail() {
  email.error = ''
  if (!/^\d{6}$/.test(email.code)) { email.error = '请输入 6 位数字验证码'; return }
  if (email.code !== DEMO_CODE) { email.error = '验证码不正确，请重新输入'; return }
  userProfile.email = email.value.trim()
  cancelEmail()
  email.done = true
  setTimeout(() => (email.done = false), 2600)
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

// 修改密码（演示：前端校验通过即提示成功，接入后端后替换为修改密码接口）
const pwdForm = reactive({ old: '', next: '', confirm: '', error: '' })
const savedPwd = ref(false)
function updatePassword() {
  pwdForm.error = ''
  if (!pwdForm.old) { pwdForm.error = '请输入当前密码'; return }
  if (pwdForm.next.length < 8) { pwdForm.error = '新密码至少需要 8 位'; return }
  if (pwdForm.next === pwdForm.old) { pwdForm.error = '新密码不能与当前密码相同'; return }
  if (!pwdForm.confirm) { pwdForm.error = '请再次输入新密码'; return }
  if (pwdForm.confirm !== pwdForm.next) { pwdForm.error = '两次输入的新密码不一致'; return }
  Object.assign(pwdForm, { old: '', next: '', confirm: '' })
  savedPwd.value = true
  setTimeout(() => (savedPwd.value = false), 1800)
}

// ---------- 转写设置 ----------
const asr = reactive({
  model: 'Whisper Medium',
  lang: '中英混合',
  granularity: '句级',
})
const asrModels = ['Whisper Small（更快）', 'Whisper Medium（均衡）', 'Whisper Large（更准）']
const asrLangs = ['中文', '中英混合', 'English']
const savedAsr = ref(false)
function saveAsr() {
  savedAsr.value = true
  setTimeout(() => (savedAsr.value = false), 1800)
}

// ---------- 视频抽帧 ----------
const frames = reactive({
  interval: 5, // 抽帧间隔（秒）
  maxFrames: 12, // 最大关键帧数
  dedup: true, // 感知哈希去重
})
const savedFrames = ref(false)
function saveFrames() {
  savedFrames.value = true
  setTimeout(() => (savedFrames.value = false), 1800)
}
const intervalOptions = [3, 5, 10]
function intervalLabel(v: number) {
  return v + 's'
}

// ---------- 纪要生成 ----------
const gen = reactive({
  detail: '标准', // 详细程度
  withQA: true, // 包含学生问答
  withFormula: true, // 公式识别
  exportFormat: 'Markdown',
})
const detailOptions = ['精简', '标准', '详尽']
const exportOptions = ['Markdown', 'PDF']
const savedGen = ref(false)
function saveGen() {
  savedGen.value = true
  setTimeout(() => (savedGen.value = false), 1800)
}

// ---------- RAG 参数调优 ----------
const rag = reactive({
  length: '适中', // 回答长度
  topK: 5, // 参考文档数量
  strictness: 70, // 引用严格度 0-100
  memory: 6, // 上下文记忆轮数
  temperature: 0.4, // 生成随机性
})
const savedRag = ref(false)
function saveRag() {
  savedRag.value = true
  setTimeout(() => (savedRag.value = false), 1800)
}
const lengthOptions = ['简短', '适中', '详细']
const strictLabel = () => (rag.strictness < 34 ? '宽松 · 尽量给出回答' : rag.strictness < 67 ? '均衡 · 适度引用' : '严格 · 无据不答')
</script>

<template>
  <div class="page">
    <header class="mb-md">
      <h1 class="h2">个人设置</h1>
      <p class="text-sm">维护账号与资料安全，调优转写、抽帧与纪要生成偏好</p>
    </header>

    <!-- 账号与安全：个人资料 + 修改密码 -->
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
            <input ref="avatarInput" type="file" accept="image/*" hidden @change="onAvatarChange" />
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
              <input class="input input-locked" :value="maskPhone(userProfile.phone)" readonly aria-label="当前手机号（中间四位已隐藏）" />
              <button class="btn btn-secondary change-btn" @click="startPhone">更换</button>
            </div>
            <div v-else class="change-panel">
              <input
                v-model="phone.value"
                class="input"
                placeholder="请输入新手机号"
                maxlength="11"
                inputmode="numeric"
                @input="phone.error = ''"
              />
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
              <input v-model="pwdForm.old" class="input" type="password" placeholder="请输入当前密码" autocomplete="current-password" />
            </div>
            <div class="field">
              <label class="field-label">新密码</label>
              <input v-model="pwdForm.next" class="input" type="password" placeholder="请输入新密码" autocomplete="new-password" />
              <p class="field-hint">至少 8 位，建议包含字母、数字与符号</p>
            </div>
            <div class="field">
              <label class="field-label">确认新密码</label>
              <input v-model="pwdForm.confirm" class="input" type="password" placeholder="请再次输入新密码" autocomplete="new-password" @input="pwdForm.error = ''" />
            </div>
            <p v-if="pwdForm.error" class="field-hint hint-err">{{ pwdForm.error }}</p>
            <button class="btn btn-primary" @click="updatePassword">
              <AppIcon v-if="savedPwd" name="check" :size="15" /> {{ savedPwd ? '已更新' : '更新密码' }}
            </button>
          </section>
        </div>
      </div>

    <!-- 课堂处理偏好：转写 + 抽帧 -->
    <div class="group-head">
      <h2 class="group-title">课堂处理偏好</h2>
      <span class="group-sub">上传材料的识别与处理方式</span>
    </div>
    <div class="grid">
      <div class="col">
        <!-- 转写设置 -->
        <section class="card card-lg">
          <div class="h4 mb-sm"><AppIcon name="headphones" :size="15" /> 转写设置</div>
          <div class="field">
            <label class="field-label">语音识别模型</label>
            <div class="pill-tabs">
              <button
                v-for="m in asrModels"
                :key="m"
                class="pill-tab"
                :class="{ active: asr.model === m }"
                @click="asr.model = m"
              >{{ m }}</button>
            </div>
            <p class="field-hint">越大越准但耗时更长，课堂录音推荐 Medium</p>
          </div>
          <div class="field">
            <label class="field-label">识别语言</label>
            <div class="pill-tabs">
              <button
                v-for="l in asrLangs"
                :key="l"
                class="pill-tab"
                :class="{ active: asr.lang === l }"
                @click="asr.lang = l"
              >{{ l }}</button>
            </div>
          </div>
          <div class="field">
            <label class="field-label">时间戳粒度</label>
            <div class="pill-tabs">
              <button class="pill-tab" :class="{ active: asr.granularity === '句级' }" @click="asr.granularity = '句级'">句级</button>
              <button class="pill-tab" :class="{ active: asr.granularity === '段落级' }" @click="asr.granularity = '段落级'">段落级</button>
            </div>
            <p class="field-hint">句级可精确回听到每一句话，段落级引用更简洁</p>
          </div>
          <button class="btn btn-primary" @click="saveAsr">
            <AppIcon v-if="savedAsr" name="check" :size="15" /> {{ savedAsr ? '已保存' : '保存转写设置' }}
          </button>
        </section>

      </div>
      <div class="col">
        <!-- 视频抽帧 -->
        <section class="card card-lg">
          <div class="h4 mb-sm"><AppIcon name="film" :size="15" /> 视频抽帧</div>
          <div class="param">
            <div class="param-head">
              <span class="param-name">抽帧间隔</span>
              <div class="pill-tabs">
                <button
                  v-for="o in intervalOptions"
                  :key="o"
                  class="pill-tab"
                  :class="{ active: frames.interval === o }"
                  @click="frames.interval = o"
                >{{ intervalLabel(o) }}</button>
              </div>
            </div>
            <p class="field-hint">每 N 秒截取一帧，间隔越小关键帧越全，处理越慢</p>
          </div>
          <div class="param">
            <div class="param-head">
              <span class="param-name">最大关键帧数</span>
              <b class="param-value">{{ frames.maxFrames }} 帧</b>
            </div>
            <input v-model.number="frames.maxFrames" type="range" min="6" max="20" />
            <p class="field-hint">超出上限时按画面变化度保留信息量最大的帧</p>
          </div>
          <label class="switch-row">
            <div>
              <div class="switch-title">感知哈希去重</div>
              <div class="text-caption">自动剔除画面几乎相同的重复帧，节省识别成本</div>
            </div>
            <input v-model="frames.dedup" type="checkbox" class="switch" />
          </label>
          <button class="btn btn-primary" @click="saveFrames">
            <AppIcon v-if="savedFrames" name="check" :size="15" /> {{ savedFrames ? '已保存' : '保存抽帧设置' }}
          </button>
        </section>
      </div>
    </div>

    <!-- 纪要与追问：生成偏好 + 检索问答调优 -->
    <div class="group-head">
      <h2 class="group-title">纪要与追问</h2>
      <span class="group-sub">纪要生成与课堂问答的生成策略</span>
    </div>
    <div class="grid">
      <div class="col">
        <section class="card card-lg">
          <div class="h4 mb-sm"><AppIcon name="spark" :size="15" /> 纪要生成</div>
          <div class="param">
            <div class="param-head">
              <span class="param-name">详细程度</span>
              <div class="pill-tabs">
                <button
                  v-for="o in detailOptions"
                  :key="o"
                  class="pill-tab"
                  :class="{ active: gen.detail === o }"
                  @click="gen.detail = o"
                >{{ o }}</button>
              </div>
            </div>
            <p class="field-hint">精简只保留考点骨架，详尽会包含完整推导与例题步骤</p>
          </div>
          <label class="switch-row">
            <div>
              <div class="switch-title">包含学生问答</div>
              <div class="text-caption">把课堂上学生的提问与教师解答整理进纪要</div>
            </div>
            <input v-model="gen.withQA" type="checkbox" class="switch" />
          </label>
          <label class="switch-row">
            <div>
              <div class="switch-title">公式识别</div>
              <div class="text-caption">将板书与 PPT 中的公式转写为可复制的文本（LaTeX）</div>
            </div>
            <input v-model="gen.withFormula" type="checkbox" class="switch" />
          </label>
          <div class="param">
            <div class="param-head">
              <span class="param-name">默认导出格式</span>
              <div class="pill-tabs">
                <button
                  v-for="o in exportOptions"
                  :key="o"
                  class="pill-tab"
                  :class="{ active: gen.exportFormat === o }"
                  @click="gen.exportFormat = o"
                >{{ o }}</button>
              </div>
            </div>
          </div>
          <button class="btn btn-primary" @click="saveGen">
            <AppIcon v-if="savedGen" name="check" :size="15" /> {{ savedGen ? '已保存' : '保存纪要设置' }}
          </button>
        </section>

      </div>
      <div class="col">
        <section class="card card-lg rag-card">
          <div class="flex items-center justify-between mb-sm">
            <div class="h4"><AppIcon name="sliders" :size="16" /> 课堂问答调优</div>
            <span class="tag tag-orange">进阶</span>
          </div>
          <p class="text-sm mb-md">微调以下参数可改变课堂追问的检索与生成策略，保存后立即对新提问生效。</p>

          <!-- 回答长度 -->
          <div class="param">
            <div class="param-head">
              <span class="param-name">回答长度</span>
              <div class="pill-tabs">
                <button
                  v-for="o in lengthOptions"
                  :key="o"
                  class="pill-tab"
                  :class="{ active: rag.length === o }"
                  @click="rag.length = o"
                >{{ o }}</button>
              </div>
            </div>
            <p class="field-hint">控制生成答案的篇幅，简短适合快速查阅，详细适合深度学习</p>
          </div>

          <!-- 参考文档数量 -->
          <div class="param">
            <div class="param-head">
              <span class="param-name">参考片段数量（Top-K）</span>
              <b class="param-value">{{ rag.topK }} 条</b>
            </div>
            <input v-model.number="rag.topK" type="range" min="1" max="10" />
            <p class="field-hint">每次回答检索的知识片段数量，越多覆盖越全，但响应稍慢</p>
          </div>

          <!-- 引用严格度 -->
          <div class="param">
            <div class="param-head">
              <span class="param-name">引用严格度</span>
              <b class="param-value">{{ rag.strictness }} · {{ strictLabel() }}</b>
            </div>
            <input v-model.number="rag.strictness" type="range" min="0" max="100" />
            <p class="field-hint">越高则越依赖知识库原文，知识库中没有的内容将明确回答"暂无依据"</p>
          </div>

          <!-- 记忆轮数 -->
          <div class="param">
            <div class="param-head">
              <span class="param-name">上下文记忆轮数</span>
              <b class="param-value">{{ rag.memory }} 轮</b>
            </div>
            <input v-model.number="rag.memory" type="range" min="1" max="12" />
            <p class="field-hint">AI 能记住的最近对话轮数，用于支持多轮追问</p>
          </div>

          <!-- 温度 -->
          <div class="param">
            <div class="param-head">
              <span class="param-name">生成随机性（Temperature）</span>
              <b class="param-value">{{ rag.temperature.toFixed(1) }}</b>
            </div>
            <input v-model.number="rag.temperature" type="range" min="0" max="1" step="0.1" />
            <p class="field-hint">越低回答越稳定保守，越高越发散有创意</p>
          </div>

          <button class="btn btn-primary btn-lg w-full mt-md" @click="saveRag">
            <AppIcon v-if="savedRag" name="check" :size="15" /> {{ savedRag ? '参数已生效' : '保存参数' }}
          </button>
        </section>
      </div>
    </div>

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
.input-locked { background: var(--surface-soft); color: var(--steel); cursor: not-allowed; }
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

.switch-row {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 13px 0; border-bottom: 1px solid var(--hairline-soft); cursor: pointer;
}
.switch-row:last-child { border-bottom: none; }
.switch-title { font-size: 14px; font-weight: 500; }

/* iOS 风格开关 */
.switch {
  appearance: none; width: 40px; height: 22px; border-radius: 11px;
  background: var(--hairline-strong); position: relative; cursor: pointer;
  transition: background 0.2s ease; flex-shrink: 0;
}
.switch::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px;
  border-radius: 50%; background: #fff; transition: left 0.2s ease; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.switch:checked { background: var(--primary); }
.switch:checked::after { left: 20px; }

.rag-card { border-top: 3px solid var(--primary); }
.param { padding: 16px 0; border-bottom: 1px solid var(--hairline-soft); }
.param:last-of-type { border-bottom: none; }
.param-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.param-name { font-size: 14px; font-weight: 600; }
.param-value { font-size: 13px; color: var(--primary); }

@media (max-width: 900px) {
  .page { padding: 20px 16px; }
  .grid { grid-template-columns: 1fr; }
}
</style>
