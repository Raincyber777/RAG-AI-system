<script setup lang="ts">
/**
 * 个人设置：资料 / 转写设置 / 视频抽帧 / 纪要生成 / 课堂问答调优 / 密码 / 通知
 * 所有参数为演示状态，接入真实后端后保存接口替换 onClick 回调即可
 */
import { ref, reactive } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { currentUser } from '@/mock/data'

const profile = reactive({
  name: currentUser.name,
  email: currentUser.email,
  intro: '热爱学习，专注课堂知识管理',
})
const savedProfile = ref(false)
function saveProfile() {
  savedProfile.value = true
  setTimeout(() => (savedProfile.value = false), 1800)
}

const pwdForm = reactive({ old: '', next: '', confirm: '' })

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

const notices = reactive({ email: true, wechat: false, weekly: true })
</script>

<template>
  <div class="page">
    <header class="mb-md">
      <h1 class="h2">个人设置</h1>
      <p class="text-sm">维护个人资料，调优转写、抽帧与纪要生成偏好，让智学纪要更懂你</p>
    </header>

    <div class="grid">
      <!-- 左列：资料 + 密码 + 通知 -->
      <div class="col">
        <!-- 个人资料 -->
        <section class="card card-lg">
          <div class="flex items-center gap-md mb-md">
            <div class="avatar avatar-lg" :style="{ background: currentUser.color }">{{ profile.name[0] }}</div>
            <div>
              <div class="h3">{{ profile.name }}</div>
              <div class="text-sm">{{ profile.email }}</div>
            </div>
          </div>
          <div class="field">
            <label class="field-label">昵称</label>
            <input v-model="profile.name" class="input" />
          </div>
          <div class="field">
            <label class="field-label">邮箱</label>
            <input v-model="profile.email" class="input" type="email" />
          </div>
          <div class="field">
            <label class="field-label">个人简介</label>
            <textarea v-model="profile.intro" class="textarea" rows="2"></textarea>
          </div>
          <button class="btn btn-primary" @click="saveProfile">
            <AppIcon v-if="savedProfile" name="check" :size="15" /> {{ savedProfile ? '已保存' : '保存资料' }}
          </button>
        </section>

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

        <!-- 修改密码 -->
        <section class="card card-lg">
          <div class="h4 mb-sm"><AppIcon name="lock" :size="15" /> 修改密码</div>
          <div class="field">
            <label class="field-label">当前密码</label>
            <input v-model="pwdForm.old" class="input" type="password" />
          </div>
          <div class="field">
            <label class="field-label">新密码</label>
            <input v-model="pwdForm.next" class="input" type="password" />
          </div>
          <div class="field">
            <label class="field-label">确认新密码</label>
            <input v-model="pwdForm.confirm" class="input" type="password" />
          </div>
          <button class="btn btn-secondary">更新密码</button>
        </section>

        <!-- 通知偏好 -->
        <section class="card card-lg">
          <div class="h4 mb-sm">通知偏好</div>
          <label class="switch-row">
            <div>
              <div class="switch-title">邮件通知</div>
              <div class="text-caption">转写与纪要生成结果、系统公告通过邮件告知</div>
            </div>
            <input v-model="notices.email" type="checkbox" class="switch" />
          </label>
          <label class="switch-row">
            <div>
              <div class="switch-title">微信通知</div>
              <div class="text-caption">纪要生成完成、处理失败即时推送</div>
            </div>
            <input v-model="notices.wechat" type="checkbox" class="switch" />
          </label>
          <label class="switch-row">
            <div>
              <div class="switch-title">每周学习报告</div>
              <div class="text-caption">每周一发送上周课堂纪要与追问统计</div>
            </div>
            <input v-model="notices.weekly" type="checkbox" class="switch" />
          </label>
        </section>
      </div>

      <!-- 右列：纪要生成 + 课堂问答调优 -->
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
  </div>
</template>

<style scoped>
.page { padding: 28px 32px 40px; max-width: 1080px; width: 100%; margin: 0 auto; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.col { display: flex; flex-direction: column; gap: 16px; }

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
