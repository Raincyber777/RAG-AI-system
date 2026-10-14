<script setup lang="ts">
/**
 * 问题反馈页：提交 Bug / 建议，并查看自己的反馈处理进度
 * 不区分反馈类型；回访统一通过注册邮箱；截图仅支持图片，支持点击或拖拽上传
 */
import { ref, reactive, onBeforeUnmount } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { myFeedbacks, feedbackStatusText, type FeedbackItem } from '@/mock/data'
import { userProfile } from '@/store/study'

const form = reactive({ title: '', desc: '' })
const submitted = ref(false)
const feedbacks = ref<FeedbackItem[]>([...myFeedbacks])

// ---------- 截图上传（仅图片，点击选择或拖拽，本地预览演示） ----------
const shotInput = ref<HTMLInputElement>()
const shot = ref<{ name: string; url: string } | null>(null)
const dragActive = ref(false)
const shotError = ref('')

function pickShot() {
  shotInput.value?.click()
}
function acceptShot(f: File) {
  shotError.value = ''
  if (!f.type.startsWith('image/')) {
    shotError.value = '仅支持图片文件（jpg / png / webp / gif 等）'
    return
  }
  if (f.size > 10 * 1024 * 1024) {
    shotError.value = '图片大小不能超过 10MB'
    return
  }
  clearShot()
  shot.value = { name: f.name, url: URL.createObjectURL(f) }
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
onBeforeUnmount(() => clearShot())

// ---------- 提交（需确认弹窗，结果回访至注册邮箱） ----------
const showSubmitConfirm = ref(false)
const canSubmit = () => !!(form.title.trim() && form.desc.trim())
function submit() {
  if (!canSubmit()) return
  showSubmitConfirm.value = true
}
function confirmSubmit() {
  feedbacks.value.unshift({
    id: 'f' + Date.now(),
    title: form.title.trim(),
    desc: form.desc.trim(),
    status: 'pending',
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
  })
  form.title = ''
  form.desc = ''
  clearShot()
  showSubmitConfirm.value = false
  submitted.value = true
  setTimeout(() => (submitted.value = false), 2000)
}

// ---------- 撤回自己的反馈（仅待处理可撤回，需确认弹窗） ----------
const withdrawTarget = ref<FeedbackItem | null>(null)
function confirmWithdraw() {
  if (!withdrawTarget.value) return
  feedbacks.value = feedbacks.value.filter((f) => f.id !== withdrawTarget.value!.id)
  withdrawTarget.value = null
}

const statusTag: Record<FeedbackItem['status'], string> = {
  pending: 'tag-orange',
  resolved: 'tag-green',
}
</script>

<template>
  <div class="page">
    <header class="mb-md">
      <h1 class="h2">问题反馈</h1>
      <p class="text-sm">遇到 Bug 或有改进建议？告诉我们，让智学纪要变得更好</p>
    </header>

    <div class="grid">
      <!-- 反馈表单 -->
      <section class="card card-lg">
        <div class="h4 mb-md"><AppIcon name="flag" :size="16" /> 提交新反馈</div>
        <div class="field">
          <label class="field-label">标题</label>
          <input v-model="form.title" class="input" placeholder="一句话概括问题" />
        </div>
        <div class="field">
          <label class="field-label">详细描述</label>
          <textarea v-model="form.desc" class="textarea" rows="5" placeholder="发生了什么？期望的结果是什么？"></textarea>
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
              <AppIcon name="image" :size="16" />
              <span>点击选择或拖拽图片到此处</span>
            </template>
            <input ref="shotInput" type="file" accept="image/*" hidden @change="onShotChange" />
          </div>
          <p v-if="shotError" class="field-hint hint-err">{{ shotError }}</p>
          <p v-else class="field-hint">仅支持图片，拖拽图片文件到上方框内即可上传</p>
        </div>
        <p class="field-hint reply-hint">处理结果将通过注册邮箱 {{ userProfile.email }} 回访</p>
        <button class="btn btn-primary btn-lg w-full" :disabled="!canSubmit()" @click="submit">
          <AppIcon v-if="submitted" name="check" :size="15" />
          {{ submitted ? '提交成功，感谢反馈！' : '提交反馈' }}
        </button>
      </section>

      <!-- 我的反馈列表 -->
      <section class="card card-lg">
        <div class="h4 mb-md">我的反馈</div>
        <div v-if="feedbacks.length" class="fb-list">
          <div v-for="f in feedbacks" :key="f.id" class="fb-item">
            <div class="flex items-center justify-between gap-sm">
              <span class="tag" :class="statusTag[f.status]">{{ feedbackStatusText[f.status] }}</span>
              <button v-if="f.status === 'pending'" class="fb-withdraw" type="button" @click="withdrawTarget = f">
                <AppIcon name="x" :size="12" /> 撤回
              </button>
            </div>
            <div class="fb-title mt-xs">{{ f.title }}</div>
            <p class="text-sm">{{ f.desc }}</p>
            <div class="text-caption mt-xs">{{ f.time }}</div>
          </div>
        </div>
        <p v-else class="text-sm empty-tip">暂无反馈记录，有问题随时告诉我们</p>
      </section>
    </div>

    <!-- 提交反馈确认弹窗 -->
    <div v-if="showSubmitConfirm" class="modal-mask" @click.self="showSubmitConfirm = false">
      <div class="modal modal-sm">
        <div class="modal-title">提交反馈</div>
        <p class="modal-sub">确认提交这条反馈吗？处理结果将通过注册邮箱 {{ userProfile.email }} 回访。</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="showSubmitConfirm = false">取消</button>
          <button class="btn btn-primary" @click="confirmSubmit">确认提交</button>
        </div>
      </div>
    </div>

    <!-- 撤回反馈确认弹窗 -->
    <div v-if="withdrawTarget" class="modal-mask" @click.self="withdrawTarget = null">
      <div class="modal modal-sm">
        <div class="modal-title">撤回反馈</div>
        <p class="modal-sub">确定撤回「{{ withdrawTarget.title }}」吗？撤回后这条反馈将被删除，无法恢复。</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="withdrawTarget = null">取消</button>
          <button class="btn btn-danger" @click="confirmWithdraw">确认撤回</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 28px 32px 40px; max-width: 1000px; width: 100%; margin: 0 auto; }
.grid { display: grid; grid-template-columns: 1.1fr 1fr; gap: 16px; align-items: start; }

/* 截图上传框：点击选择 / 拖拽投放 */
.shot-box {
  display: flex; align-items: center; gap: 8px; padding: 13px 14px;
  border: 1px dashed var(--hairline-strong); border-radius: var(--radius-md);
  color: var(--steel); font-size: 13px; transition: all 0.15s ease;
  cursor: pointer; user-select: none;
}
.shot-box:hover, .shot-box:focus-visible { border-color: var(--primary); color: var(--primary); }
.shot-box:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.shot-box.dragover { border-color: var(--primary); color: var(--primary); background: var(--tint-lavender); border-style: solid; }
.shot-thumb { width: 34px; height: 34px; object-fit: cover; border-radius: var(--radius-sm); flex-shrink: 0; }
.shot-name { flex: 1; min-width: 0; color: var(--ink); }
.shot-clear {
  border: none; background: transparent; color: var(--stone);
  padding: 5px; border-radius: var(--radius-sm); display: flex; cursor: pointer; flex-shrink: 0;
}
.shot-clear:hover { background: var(--surface-soft); color: var(--error); }
.field-hint.hint-err { color: #d92d20; }
.reply-hint { margin-top: -6px; }

.fb-list { display: flex; flex-direction: column; gap: 12px; max-height: 420px; overflow-y: auto; }
.fb-item { padding: 14px; border: 1px solid var(--hairline); border-radius: var(--radius-md); }
.fb-title { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.empty-tip { color: var(--stone); padding: 24px 0; text-align: center; }

.fb-withdraw {
  display: flex; align-items: center; gap: 3px;
  border: none; background: transparent; cursor: pointer;
  color: var(--stone); font-size: 12px; font-weight: 500;
  padding: 4px 8px; border-radius: var(--radius-sm); transition: all 0.15s ease;
}
.fb-withdraw:hover { background: var(--tint-rose, rgba(217, 45, 32, 0.08)); color: #d92d20; }

/* 弹窗（危险按钮用全局 .btn-danger 软色样式） */
.modal-sm { max-width: 440px; }
.modal-sub { color: var(--slate); line-height: 1.7; }

@media (max-width: 900px) {
  .page { padding: 20px 16px; }
  .grid { grid-template-columns: 1fr; }
}
</style>
