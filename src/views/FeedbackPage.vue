<script setup lang="ts">
/**
 * 问题反馈页：提交 Bug / 建议
 * 不区分反馈类型；截图仅支持图片，可一次上传多张（最多 6 张，缩略图横向滚动）；提交到后端（未登录默认联系邮箱为账号邮箱）
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

// ---------- 截图上传（仅图片，可一次多选 / 多拖，最多 6 张；本地预览 + 提交时随表单上传） ----------
const MAX_SHOTS = 6
const shotInput = ref<HTMLInputElement>()
const shots = ref<{ name: string; url: string; file: File }[]>([])
const dragActive = ref(false)
const shotError = ref('')

function pickShot() {
  shotInput.value?.click()
}
/** 批量校验并加入截图：非图片 / 超 10MB / 超张数 / 重复的跳过并提示，不打断其余图片 */
function acceptShots(list: FileList | File[]) {
  const msgs: string[] = []
  let skippedNonImage = false
  for (const f of Array.from(list)) {
    if (shots.value.length >= MAX_SHOTS) {
      msgs.push(`一次最多上传 ${MAX_SHOTS} 张，多出的图片未添加`)
      break
    }
    if (!isSupportedImage(f.name)) {
      skippedNonImage = true
      continue
    }
    if (f.size > 10 * 1024 * 1024) {
      msgs.push(`「${f.name}」超过 10MB，未添加`)
      continue
    }
    if (shots.value.some((s) => s.name === f.name && s.file.size === f.size)) continue
    shots.value.push({ name: f.name, url: URL.createObjectURL(f), file: f })
  }
  if (skippedNonImage) msgs.unshift('仅支持图片格式（jpg / jpeg / png / webp / gif），已跳过其他文件')
  shotError.value = msgs.join('；')
}
function onShotChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? []) // 先拷贝：input.value 清空会连带清空活 FileList
  input.value = ''
  if (files.length) acceptShots(files)
}
function onDrop(e: DragEvent) {
  dragActive.value = false
  const files = e.dataTransfer?.files
  if (files?.length) acceptShots(files)
}
function removeShot(i: number) {
  const s = shots.value[i]
  if (!s) return
  URL.revokeObjectURL(s.url)
  shots.value.splice(i, 1)
}
function clearShots() {
  for (const s of shots.value) URL.revokeObjectURL(s.url)
  shots.value = []
}
onBeforeUnmount(() => {
  clearShots()
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
      shots.value.map((s) => s.file),
    )
    form.title = ''
    form.desc = ''
    clearShots()
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
        <div class="shot-label-row">
          <label class="field-label">截图（可选）</label>
          <span v-if="shots.length" class="shot-count" :class="{ full: shots.length >= MAX_SHOTS }">
            已选 {{ shots.length }} / {{ MAX_SHOTS }}
          </span>
        </div>
        <!-- 点击选择或拖拽图片上传，仅接受图片文件；支持一次多选 / 多拖 -->
        <div
          class="shot-box"
          :class="{ dragover: dragActive }"
          role="button"
          tabindex="0"
          aria-label="添加截图：点击选择或拖拽图片到此处，可一次上传多张（最多 6 张）"
          @click="pickShot"
          @keydown.enter.prevent="pickShot"
          @keydown.space.prevent="pickShot"
          @dragover.prevent="dragActive = true"
          @dragleave.prevent="dragActive = false"
          @drop.prevent="onDrop"
        >
          <AppIcon name="image" :size="24" />
          <span class="shot-main">点击选择或拖拽图片到此处</span>
          <span class="shot-multi">可一次上传多张（最多 {{ MAX_SHOTS }} 张）</span>
          <span class="shot-sub">支持 jpg / jpeg / png / webp / gif，单张不超过 10MB</span>
          <input ref="shotInput" type="file" hidden multiple :accept="UPLOAD_ACCEPT.image" @change="onShotChange" />
        </div>
        <!-- 已选截图缩略图条：图片多时横向滚动 -->
        <div v-if="shots.length" class="shot-strip" role="list" aria-label="已选截图">
          <div v-for="(s, i) in shots" :key="s.url" class="shot-item" role="listitem">
            <img :src="s.url" class="shot-thumb" :alt="`截图 ${i + 1}`" :title="s.name" />
            <button class="shot-clear" type="button" :aria-label="`移除截图 ${s.name}`" @click="removeShot(i)">
              <AppIcon name="x" :size="12" />
            </button>
          </div>
        </div>
        <p v-if="shotError" class="field-hint hint-err">{{ shotError }}</p>
        <p v-else class="field-hint">把多张图片一起拖进上方框内即可批量上传，提交时随反馈一并发送</p>
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

/* 截图上传框：常驻放大拖放区（竖排居中），多选提示做成紫色胶囊徽章突出 */
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
.shot-label-row { display: flex; align-items: center; gap: 10px; }
.shot-count { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--steel); font-variant-numeric: tabular-nums; }
.shot-count.full { color: var(--warning); }
.shot-main { font-weight: 500; }
.shot-multi {
  background: var(--tint-lavender); color: var(--brand-purple-800);
  font-size: 12px; font-weight: 600; line-height: 1.4;
  padding: 3px 10px; border-radius: var(--radius-full);
}
.shot-sub { font-size: 12px; color: var(--stone); }
/* 已选截图缩略图条：图片多时横向滚动 */
.shot-strip { display: flex; gap: 10px; overflow-x: auto; padding: 8px 2px 4px; }
.shot-item { position: relative; flex-shrink: 0; }
.shot-thumb {
  width: 84px; height: 84px; object-fit: cover; display: block;
  border: 1px solid var(--hairline); border-radius: var(--radius-md);
}
.shot-clear {
  position: absolute; top: -6px; right: -6px;
  width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--hairline-strong); border-radius: 50%;
  background: var(--canvas); color: var(--slate); cursor: pointer; padding: 0;
  transition: all 0.15s ease;
}
.shot-clear:hover { color: var(--error); border-color: var(--error); }
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
