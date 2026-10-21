<script setup lang="ts">
/**
 * 问答页安全提醒弹窗：违规拦截 / 政治引导 / 健康禁忌拦截命中时弹出说明
 * 由 QAPage 传入 notice（null 关闭）；点「我知道了」回调关闭
 * 根类名用 safety-mask：避开布局作用域的 .mask { display:none } 规则泄漏
 */
import { computed } from 'vue'
import AppIcon from '@/components/AppIcon.vue'

export interface SafetyNotice {
  kind: 'blocked' | 'political' | 'health_block'
  text: string
}

const props = defineProps<{ notice: SafetyNotice | null }>()
const emit = defineEmits<{ close: [] }>()

const META = computed(() => {
  switch (props.notice?.kind) {
    case 'political':
      return { icon: 'info', tag: '温馨提醒', title: '我们换个话题吧' }
    case 'health_block':
      return { icon: 'shield', tag: '健康守护', title: '已按你的健康档案拦截' }
    default:
      return { icon: 'shield', tag: '安全提醒', title: '该内容无法回答' }
  }
})
</script>

<template>
  <Transition name="safety">
    <!-- 文档弹窗 120 / 登录弹窗 100，本层 95 保持在登录弹窗之下、页面之上 -->
    <div v-if="notice" class="safety-mask" @click.self="emit('close')">
      <div class="safety-card" role="dialog" aria-modal="true" aria-label="安全提醒">
        <span class="safety-tag" :class="`is-${notice.kind}`">
          <AppIcon :name="META.icon" :size="13" /> {{ META.tag }}
        </span>
        <h3 class="safety-title">{{ META.title }}</h3>
        <p class="safety-content">{{ notice.text }}</p>
        <button class="btn btn-primary btn-block" @click="emit('close')">我知道了</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.safety-mask {
  position: fixed; inset: 0; z-index: 95;
  background: rgba(10, 21, 48, 0.5); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.safety-card {
  width: 440px; max-width: 100%;
  background: var(--canvas); border-radius: 20px; padding: 24px 26px 22px;
  box-shadow: var(--shadow-modal);
}
.safety-tag {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; font-weight: 700;
  padding: 4px 10px; border-radius: 999px;
}
.safety-tag.is-blocked { background: var(--tint-rose, #fdecec); color: #d64545; }
.safety-tag.is-political { background: var(--surface-soft); color: var(--primary); }
.safety-tag.is-health_block { background: var(--tint-peach, #fdf0e7); color: #d97a2b; }
.safety-title { font-size: 19px; font-weight: 800; color: var(--ink-deep); margin-top: 12px; letter-spacing: -0.3px; }
.safety-content {
  font-size: 13.5px; line-height: 1.9; color: var(--slate);
  margin-top: 12px; padding: 14px; border-radius: 12px;
  background: var(--surface-soft); white-space: pre-line;
}
.safety-card .btn-block { margin-top: 16px; width: 100%; }

.safety-enter-active, .safety-leave-active { transition: opacity 0.18s ease; }
.safety-enter-active .safety-card, .safety-leave-active .safety-card { transition: transform 0.18s ease; }
.safety-enter-from, .safety-leave-to { opacity: 0; }
.safety-enter-from .safety-card, .safety-leave-to .safety-card { transform: translateY(10px) scale(0.98); }
</style>
