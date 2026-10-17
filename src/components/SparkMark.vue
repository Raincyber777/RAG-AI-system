<script setup lang="ts">
/**
 * 动态星标（智学纪要 logo 同款四角星，用于问答欢迎位等模块标识处）：
 * - 主星白↔紫渐变缓慢流动（SVG 渐变 stop-color 动画）
 * - 边缘水晶亮光周期性沿轮廓扫过（描边 dash 扫光 + 明暗时间窗，「时不时」出现）
 * - 星尖小晶花不定时闪烁；整体带柔光呼吸（CSS drop-shadow）
 * 用法：<SparkMark :size="36" />
 */
defineProps<{ size?: number }>()
</script>

<template>
  <svg :width="size || 32" :height="size || 32" viewBox="0 0 32 32" fill="none" class="spark-mark" aria-hidden="true">
    <defs>
      <!-- 主星填充：白 ↔ 紫（品牌紫）缓慢流动 -->
      <linearGradient id="spark-fill" x1="6" y1="5" x2="26" y2="27" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#ffffff">
          <animate attributeName="stop-color" values="#ffffff;#e6dfff;#a292f2;#e6dfff;#ffffff" dur="7s" repeatCount="indefinite" />
        </stop>
        <stop offset="1" stop-color="#a292f2">
          <animate attributeName="stop-color" values="#a292f2;#ffffff;#cfC4f8;#ffffff;#a292f2" dur="7s" repeatCount="indefinite" />
        </stop>
      </linearGradient>
      <!-- 边缘扫光的亮段（两端透明，中段水晶白） -->
      <linearGradient id="spark-glint" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0" />
        <stop offset="0.5" stop-color="#f4efff" />
        <stop offset="1" stop-color="#ffffff" stop-opacity="0" />
      </linearGradient>
    </defs>

    <!-- 主星：四角星（logo 同款造型） -->
    <path
      d="M16 4.6C17 11.2 20.8 15 27.4 16C20.8 17 17 20.8 16 27.4C15 20.8 11.2 17 4.6 16C11.2 15 15 11.2 16 4.6Z"
      fill="url(#spark-fill)"
    />
    <!-- 边缘水晶扫光：亮段沿轮廓游走，多数时间隐去（时不时闪一下） -->
    <path
      class="spark-edge"
      d="M16 4.6C17 11.2 20.8 15 27.4 16C20.8 17 17 20.8 16 27.4C15 20.8 11.2 17 4.6 16C11.2 15 15 11.2 16 4.6Z"
      pathLength="100"
      stroke="url(#spark-glint)"
    >
      <animate attributeName="stroke-dashoffset" values="100;0" dur="5.2s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.06;0.3;0.4;1" dur="5.2s" repeatCount="indefinite" />
    </path>
    <!-- 星尖晶花：错峰闪烁的两粒小晶 -->
    <path
      d="M0 -2.3C0.2 -0.9 0.9 -0.2 2.3 0C0.9 0.2 0.2 0.9 0 2.3C-0.2 0.9 -0.9 0.2 -2.3 0C-0.9 -0.2 -0.2 -0.9 0 -2.3Z"
      transform="translate(23.2 8.4)"
      fill="#ffffff"
    >
      <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.42;0.5;0.6;1" dur="4.4s" repeatCount="indefinite" />
    </path>
    <path
      d="M0 -1.7C0.15 -0.65 0.65 -0.15 1.7 0C0.65 0.15 0.15 0.65 0 1.7C-0.15 0.65 -0.65 0.15 -1.7 0C-0.65 -0.15 -0.15 -0.65 0 -1.7Z"
      transform="translate(7.4 20.6)"
      fill="#ffffff"
    >
      <animate attributeName="opacity" values="0;0;0.9;0;0" keyTimes="0;0.55;0.62;0.7;1" dur="5.6s" repeatCount="indefinite" />
    </path>
  </svg>
</template>

<style scoped>
/* 整体柔光呼吸：紫晕缓慢收放，营造通透水晶感 */
.spark-mark {
  animation: spark-glow 7s ease-in-out infinite;
  overflow: visible;
}
.spark-edge {
  stroke-width: 1.1;
  stroke-dasharray: 16 84;
  stroke-linejoin: round;
}
@keyframes spark-glow {
  0%, 100% { filter: drop-shadow(0 0 3px rgba(162, 146, 242, 0.35)); }
  50% { filter: drop-shadow(0 0 10px rgba(228, 220, 255, 0.6)); }
}
</style>
