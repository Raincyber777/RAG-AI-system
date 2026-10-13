<script setup lang="ts">
/**
 * 问题反馈页：提交 Bug / 建议，并查看自己的反馈处理进度
 */
import { ref, reactive } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { myFeedbacks, feedbackStatusText, type FeedbackItem } from '@/mock/data'

const types = ['功能异常', '体验建议', '内容纠错', '其他']
const form = reactive({ type: '功能异常', title: '', desc: '', contact: '' })
const screenshot = ref('')
const submitted = ref(false)
const feedbacks = ref<FeedbackItem[]>([...myFeedbacks])

function submit() {
  if (!form.title.trim() || !form.desc.trim()) return
  feedbacks.value.unshift({
    id: 'f' + Date.now(),
    type: form.type,
    title: form.title.trim(),
    desc: form.desc.trim(),
    status: 'pending',
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
  })
  form.title = ''
  form.desc = ''
  form.contact = ''
  submitted.value = true
  setTimeout(() => (submitted.value = false), 2000)
}

const statusTag: Record<FeedbackItem['status'], string> = {
  pending: 'tag-gray',
  processing: 'tag-orange',
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
          <label class="field-label">反馈类型</label>
          <div class="pill-tabs">
            <button
              v-for="t in types"
              :key="t"
              type="button"
              class="pill-tab"
              :class="{ active: form.type === t }"
              @click="form.type = t"
            >{{ t }}</button>
          </div>
        </div>
        <div class="field">
          <label class="field-label">标题</label>
          <input v-model="form.title" class="input" placeholder="一句话概括问题" />
        </div>
        <div class="field">
          <label class="field-label">详细描述</label>
          <textarea v-model="form.desc" class="textarea" rows="5" placeholder="发生了什么？期望的结果是什么？"></textarea>
        </div>
        <div class="field">
          <label class="field-label">联系方式（可选）</label>
          <input v-model="form.contact" class="input" placeholder="邮箱 / 工号，便于回访" />
        </div>
        <div class="field">
          <label class="field-label">截图（可选）</label>
          <label class="shot-box pointer">
            <AppIcon name="paperclip" :size="16" />
            <span>{{ screenshot || '点击添加截图' }}</span>
            <input type="file" hidden accept="image/*" @change="(e: Event) => {
              const f = (e.target as HTMLInputElement).files?.[0]
              if (f) screenshot = f.name
            }" />
          </label>
        </div>
        <button class="btn btn-primary btn-lg w-full" @click="submit">
          <AppIcon v-if="submitted" name="check" :size="15" />
          {{ submitted ? '提交成功，感谢反馈！' : '提交反馈' }}
        </button>
      </section>

      <!-- 我的反馈列表 -->
      <section class="card card-lg">
        <div class="h4 mb-md">我的反馈 · {{ feedbacks.length }}</div>
        <div class="fb-list">
          <div v-for="f in feedbacks" :key="f.id" class="fb-item">
            <div class="flex items-center justify-between gap-sm">
              <span class="tag tag-blue">{{ f.type }}</span>
              <span class="tag" :class="statusTag[f.status]">{{ feedbackStatusText[f.status] }}</span>
            </div>
            <div class="fb-title mt-xs">{{ f.title }}</div>
            <p class="text-sm">{{ f.desc }}</p>
            <div class="text-caption mt-xs">{{ f.time }}</div>
          </div>
        </div>
        <div class="tip-box mt-md">
          <AppIcon name="alert" :size="15" />
          <span>反馈将在 1-3 个工作日内由管理员处理</span>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 28px 32px 40px; max-width: 1000px; width: 100%; margin: 0 auto; }
.grid { display: grid; grid-template-columns: 1.1fr 1fr; gap: 16px; align-items: start; }

.shot-box {
  display: flex; align-items: center; gap: 8px; padding: 13px 14px;
  border: 1px dashed var(--hairline-strong); border-radius: var(--radius-md);
  color: var(--steel); font-size: 13px; transition: all 0.15s ease;
}
.shot-box:hover { border-color: var(--primary); color: var(--primary); }

.fb-list { display: flex; flex-direction: column; gap: 12px; max-height: 420px; overflow-y: auto; }
.fb-item { padding: 14px; border: 1px solid var(--hairline); border-radius: var(--radius-md); }
.fb-title { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.tip-box {
  display: flex; align-items: center; gap: 8px;
  background: var(--tint-yellow); color: #8a6d00; font-size: 12.5px; font-weight: 500;
  border-radius: var(--radius-md); padding: 11px 14px;
}

@media (max-width: 900px) {
  .page { padding: 20px 16px; }
  .grid { grid-template-columns: 1fr; }
}
</style>
