<script setup lang="ts">
/**
 * 游客提示弹窗：游客模式点击功能操作时统一弹出
 * 说明当前仅可浏览，提供 × 关闭与「去登录 / 去注册」跳转登录表单
 */
import AppIcon from '@/components/AppIcon.vue'
import { guestHintOpen, closeGuestHint, openAuthFromHint } from '@/store/auth'
</script>

<template>
  <!-- 根类名用 ghint-mask：避开 AppLayout 作用域里的 .mask { display:none }（Vue 会把父组件作用域属性传给子组件根节点） -->
  <div v-if="guestHintOpen" class="ghint-mask" data-guest-allow @click.self="closeGuestHint">
    <div class="hint-card" role="dialog" aria-modal="true" aria-label="登录提示">
      <button class="hint-x" aria-label="关闭提示" @click="closeGuestHint"><AppIcon name="x" :size="15" /></button>

      <span class="hint-ico"><AppIcon name="lock" :size="22" /></span>
      <div class="hint-title">登录后即可使用该功能</div>
      <p class="hint-desc">当前为游客模式，仅可浏览演示内容。登录或注册后即可上传材料、生成纪要、追问与练习。</p>

      <div class="hint-actions">
        <button class="btn btn-secondary" @click="openAuthFromHint('register')">去注册</button>
        <button class="btn btn-primary" @click="openAuthFromHint('login')">去登录</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ghint-mask {
  position: fixed; inset: 0; z-index: 90;
  background: rgba(15, 15, 15, 0.4);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.hint-card {
  position: relative; width: 100%; max-width: 400px;
  background: var(--canvas); border-radius: var(--radius-lg);
  padding: 28px 26px 24px; text-align: center;
  box-shadow: var(--shadow-modal);
}
.hint-x {
  position: absolute; top: 12px; right: 12px;
  width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: var(--stone); cursor: pointer;
  border-radius: var(--radius-sm);
}
.hint-x:hover { color: var(--ink); background: var(--surface-soft); }
.hint-ico {
  width: 52px; height: 52px; border-radius: 50%;
  background: var(--tint-lavender); color: var(--primary);
  display: inline-flex; align-items: center; justify-content: center; margin-bottom: 14px;
}
.hint-title { font-size: 16.5px; font-weight: 700; margin-bottom: 8px; }
.hint-desc { font-size: 13px; color: var(--slate); line-height: 1.75; margin-bottom: 20px; }
.hint-actions { display: flex; gap: 10px; justify-content: center; }
.hint-actions .btn { min-width: 120px; }
</style>
