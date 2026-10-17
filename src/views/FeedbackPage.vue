<script setup lang="ts">
/**
 * 问题反馈页：提交 Bug / 建议
 * 不区分反馈类型；截图仅支持图片，支持点击或拖拽上传；提交到后端（未登录默认联系邮箱为账号邮箱）
 */
import { reactive, ref, onBeforeUnmount } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { feedbackApi } from '@/api'
import { ApiError } from '@/api/http'
import { UPLOAD_ACCEPT, isSupportedImage } from '@/utils/uploadFormats'

const form = reactive({ title: '', desc: '' })
const submitted = ref(false)
const submitting = ref(false)
const submitError = ref('')
let submittedTimer: number | undefined

// ---------- 截图上传（仅图片，点击选择或拖拽，本地预览 + 提交时随表单上传） ----------
const shotInput = ref<HTMLInputElement>()
const shot = ref<{ name: string; url: string; file: File } | null>(null)
const dragActive = ref(false)
const shotError = ref('')

function pickShot() {
  shotInput.value?.click()
}
function acceptShot(f: File) {
  shotError.value = ''
  if (!isSupportedImage(f.name)) {
    shotError.value = '仅支持图片格式（jpg / jpeg / png / webp / gif）'
    return
  }
  if (f.size > 10 * 1024 * 1024) {
    shotError.value = '图片大小不能超过 10MB'
    return
  }
  clearShot()
  shot.value = { name: f.name, url: URL.createObjectURL(f), file: f }
}
function onShotChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (f) acceptShot(f)
}
function onDrop(e: DragEvent) {
  dragActive.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) acceptShot(f)
}
function clearShot() {
  if (shot.value) URL.revokeObjectURL(shot.value.url)
  shot.value = null
}
onBeforeUnmount(() => {
  clearShot()
  if (submittedTimer) window.clearTimeout(submittedTimer)
})

// ---------- 提交（标题 + 描述 + 可选截图上传到后端） ----------
const canSubmit = () => !!(form.title.trim() && form.desc.trim())
async function submit() {
  if (!canSubmit() || submitting.value || submitted.value) return
  submitting.value = true
  submitError.value = ''
  try {
    await feedbackApi.create(
      { title: form.title.trim(), content: form.desc.trim() },
      shot.value ? [shot.value.file] : [],
    )
    form.title = ''
    form.desc = ''
    clearShot()
    submitted.value = true
    if (submittedTimer) window.clearTimeout(submittedTimer)
    submittedTimer = window.setTimeout(() => (submitted.value = false), 2600)
  } catch (e) {
    submitError.value = e instanceof ApiError ? e.message : '提交失败，请确认后端已启动'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="page">
    <header class="mb-md">
      <h1 class="h2">问题反馈</h1>
      <p class="text-sm">遇到 Bug 或有改进建议？告诉我们，让智学纪要变得更好</p>
    </header>

    <!-- 反馈表单 -->
    <section class="card card-lg">
      <div class="h4 mb-md"><AppIcon name="flag" :size="16" /> 提交新反馈</div>
      <div class="field">
        <label class="field-label">标题</label>
        <input v-model="form.title" class="input" placeholder="一句话概括问题" />
      </div>
      <div class="field">
        <label class="field-label">详细描述</label>
        <textarea v-model="form.desc" class="textarea" rows="6" placeholder="发生了什么？期望的结果是什么？"></textarea>
      </div>
      <div class="field">
        <label class="field-label">截图（可选）</label>
        <!-- 点击选择或拖拽图片上传，仅接受图片文件 -->
        <div
          class="shot-box"
          :class="{ dragover: dragActive, filled: shot }"
          role="button"
          tabindex="0"
          aria-label="添加截图：点击选择或拖拽图片到此处"
          @click="pickShot"
          @keydown.enter.prevent="pickShot"
          @keydown.space.prevent="pickShot"
          @dragover.prevent="dragActive = true"
          @dragleave.prevent="dragActive = false"
          @drop.prevent="onDrop"
        >
          <template v-if="shot">
            <img :src="shot.url" class="shot-thumb" alt="截图预览" />
            <span class="shot-name ellipsis">{{ shot.name }}</span>
            <button class="shot-clear" type="button" aria-label="移除截图" @click.stop="clearShot">
              <AppIcon name="x" :size="13" />
            </button>
          </template>
          <template v-else>
            <AppIcon name="image" :size="24" />
            <span class="shot-main">点击选择或拖拽图片到此处</span>
            <span class="shot-sub">支持 jpg / jpeg / png / webp / gif，不超过 10MB</span>
          </template>
          <input ref="shotInput" type="file" hidden :accept="UPLOAD_ACCEPT.image" @change="onShotChange" />
        </div>
        <p v-if="shotError" class="field-hint hint-err">{{ shotError }}</p>
        <p v-else class="field-hint">仅支持图片，拖拽图片文件到上方框内即可上传</p>
      </div>

      <!-- 提交失败提示 -->
      <div v-if="submitError" class="submit-err" role="alert">{{ submitError }}</div>
      <!-- 提交成功提示 -->
      <div v-if="submitted" class="submit-ok">
        <AppIcon name="check" :size="14" /> 反馈已提交，感谢您的建议。
      </div>
      <button class="btn btn-primary btn-lg w-full" :disabled="!canSubmit() || submitting" @click="submit">
        <span v-if="submitting" class="spinner"></span>
        {{ submitting ? '提交中…' : '提交反馈' }}
      </button>
    </section>
  </div>
</template>

<style scoped>
.page { padding: 28px 32px 40px; max-width: 880px; width: 100%; margin: 0 auto; }

/* 截图上传框：空态为放大的拖放区（竖排居中），已选截图时压缩为横向小条 */
.shot-box {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  min-height: 136px; padding: 24px 16px;
  border: 1px dashed var(--hairline-strong); border-radius: var(--radius-md);
  color: var(--steel); font-size: 13.5px; transition: all 0.15s ease;
  cursor: pointer; user-select: none; text-align: center;
}
.shot-box:hover, .shot-box:focus-visible { border-color: var(--primary); color: var(--primary); }
.shot-box:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.shot-box.dragover { border-color: var(--primary); color: var(--primary); background: var(--tint-lavender); border-style: solid; }
.shot-box.filled { flex-direction: row; min-height: 0; padding: 10px 14px; gap: 8px; text-align: left; }
.shot-main { font-weight: 500; }
.shot-sub { font-size: 12px; color: var(--stone); }
.shot-thumb { width: 36px; height: 36px; object-fit: cover; border-radius: var(--radius-sm); flex-shrink: 0; }
.shot-name { flex: 1; min-width: 0; color: var(--ink); }
.shot-clear {
  border: none; background: transparent; color: var(--stone);
  padding: 5px; border-radius: var(--radius-sm); display: flex; cursor: pointer; flex-shrink: 0;
}
.shot-clear:hover { background: var(--surface-soft); color: var(--error); }
.field-hint.hint-err { color: #d92d20; }

/* 提交失败提示 */
.submit-err {
  display: flex; align-items: center; justify-content: center;
  color: var(--error); background: var(--tint-rose);
  padding: 10px 14px; border-radius: var(--radius-md);
  font-size: 13.5px; font-weight: 500; margin-bottom: 12px;
}

/* 提交成功提示 */
.submit-ok {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  color: var(--brand-green); background: var(--tint-mint);
  padding: 10px 14px; border-radius: var(--radius-md);
  font-size: 13.5px; font-weight: 600; margin-bottom: 12px;
}

@media (max-width: 900px) {
  .page { padding: 20px 16px; }
}
</style>
