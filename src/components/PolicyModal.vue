<script setup lang="ts">
/**
 * 《用户协议》/《隐私政策》文档查看弹窗
 * 由 AuthModal 的协议勾选处与着陆页页脚打开；标题栏 Tab 可在两份文档间切换
 * 内容优先取后端（超管在管理端「公告管理 → 协议管理」维护）；后端为空或不可达时回退内置默认文案
 * 后端文本约定：行首 # 为小节标题，其余每行为一个段落
 * 根类名用 policy-mask：避开布局作用域的 .mask { display:none } 规则泄漏
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { authModalOpen } from '@/store/auth'
import { legalApi } from '@/api'
import { PRIVACY_POLICY, USER_AGREEMENT, type PolicyDoc } from '@/content/policies'

const props = defineProps<{ doc: PolicyDoc | null }>()
const emit = defineEmits<{ close: []; switch: [PolicyDoc['key']] }>()

function switchDoc(key: PolicyDoc['key']) {
  if (props.doc?.key !== key) emit('switch', key)
}

// ---------- 文档内容：后端优先，内置兜底 ----------
interface Block {
  h: string | null // 小节标题（# 开头的行），null 表示普通段落
  ps: string[]
}
const remoteBlocks = ref<Block[] | null>(null)
const remoteUpdated = ref('')

function parsePolicy(text: string): Block[] {
  const blocks: Block[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) blocks.push({ h: line.replace(/^#+\s*/, ''), ps: [] })
    else blocks.push({ h: null, ps: [line] })
  }
  return blocks.length ? blocks : [{ h: null, ps: [text.trim()] }]
}

async function loadRemote(key: PolicyDoc['key']) {
  try {
    const r = await legalApi.get(key)
    if (!r.content.trim()) return
    remoteBlocks.value = parsePolicy(r.content)
    if (r.updated_at) remoteUpdated.value = r.updated_at.slice(0, 10)
  } catch {
    // 后端不可达 / 未启动：静默回退内置文案
  }
}

const viewBlocks = computed<Block[]>(() => {
  if (remoteBlocks.value) return remoteBlocks.value
  const d = props.doc
  if (!d) return []
  return [{ h: null, ps: [d.intro] }, ...d.sections.map((s) => ({ h: s.h as string | null, ps: [...s.ps] }))]
})

// ---------- 打开/切换/关闭与滚动锁（叠加登录弹窗时保持锁定） ----------
function onEscKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.doc) emit('close')
}
// body 滚动锁跟随弹窗开关；关闭时若登录弹窗仍开着则保持锁定（两弹窗可叠加）
watch(
  () => props.doc,
  (v) => {
    window.removeEventListener('keydown', onEscKey)
    if (v) {
      window.addEventListener('keydown', onEscKey)
      document.body.style.overflow = 'hidden'
      remoteBlocks.value = null
      remoteUpdated.value = ''
      void loadRemote(v.key)
    } else {
      document.body.style.overflow = authModalOpen.value ? 'hidden' : ''
    }
  },
)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onEscKey)
  document.body.style.overflow = authModalOpen.value ? 'hidden' : ''
})
</script>

<template>
  <Transition name="policy">
    <!-- 登录弹窗 z-index 100，本文档层 120 保证叠加在上 -->
    <div v-if="doc" class="policy-mask" @click.self="emit('close')">
      <div class="policy-card" role="dialog" aria-modal="true" :aria-label="doc.title">
        <button class="policy-x" aria-label="关闭文档" @click="emit('close')"><AppIcon name="x" :size="15" /></button>

        <div class="policy-head">
          <div class="policy-tabs" role="tablist" aria-label="文档切换">
            <button
              class="policy-tab" :class="{ active: doc.key === 'terms' }"
              role="tab" :aria-selected="doc.key === 'terms'"
              @click="switchDoc('terms')"
            >用户协议</button>
            <button
              class="policy-tab" :class="{ active: doc.key === 'privacy' }"
              role="tab" :aria-selected="doc.key === 'privacy'"
              @click="switchDoc('privacy')"
            >隐私政策</button>
          </div>
        </div>

        <div class="policy-body">
          <h2 class="policy-title">{{ doc.title }}</h2>
          <p class="policy-updated">最近更新：{{ remoteUpdated || doc.updated }}</p>
          <template v-for="(b, i) in viewBlocks" :key="i">
            <h3 v-if="b.h" class="policy-h">{{ b.h }}</h3>
            <p v-else class="policy-p">{{ b.ps[0] }}</p>
          </template>
        </div>

        <div class="policy-foot">
          <button class="btn btn-primary btn-sm" @click="emit('close')">我已阅读</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.policy-mask {
  position: fixed; inset: 0; z-index: 120;
  background: rgba(10, 21, 48, 0.5); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
  display: flex; padding: 24px; overflow-y: auto;
}
.policy-card {
  width: 680px; max-width: 100%; margin: auto; position: relative;
  background: var(--canvas); border-radius: 20px; padding: 20px 28px 18px;
  box-shadow: var(--shadow-modal);
  display: flex; flex-direction: column; max-height: 86vh;
}
.policy-x {
  position: absolute; top: 14px; right: 14px;
  width: 30px; height: 30px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  border: none; background: var(--surface); color: var(--steel); cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.policy-x:hover { background: var(--hairline-soft); color: var(--ink); }

.policy-tabs {
  display: flex; gap: 6px; margin-bottom: 14px;
  background: var(--surface-soft); padding: 4px; border-radius: 10px;
}
.policy-tab {
  flex: 1; border: none; background: transparent; font-family: inherit;
  font-size: 13px; font-weight: 600; color: var(--slate);
  padding: 8px 0; border-radius: 7px; cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.policy-tab:hover { color: var(--ink); }
.policy-tab.active { background: var(--canvas); color: var(--ink); box-shadow: 0 1px 3px rgba(10, 21, 48, 0.1); }

.policy-body { overflow-y: auto; flex: 1; min-height: 0; padding-right: 6px; }
.policy-title { font-size: 20px; font-weight: 800; color: var(--ink-deep); letter-spacing: -0.3px; }
.policy-updated { font-size: 12px; color: var(--stone); margin-top: 4px; }
.policy-h { font-size: 14.5px; font-weight: 700; color: var(--ink); margin-top: 20px; margin-bottom: 6px; }
.policy-p { font-size: 13.5px; line-height: 1.9; color: var(--slate); margin-top: 8px; }

.policy-foot {
  display: flex; justify-content: center; padding-top: 14px; margin-top: 6px;
  border-top: 1px solid var(--hairline-soft);
}
.btn-sm { padding: 9px 30px; font-size: 13.5px; }

.policy-enter-active, .policy-leave-active { transition: opacity 0.18s ease; }
.policy-enter-active .policy-card, .policy-leave-active .policy-card { transition: transform 0.18s ease; }
.policy-enter-from, .policy-leave-to { opacity: 0; }
.policy-enter-from .policy-card, .policy-leave-to .policy-card { transform: translateY(10px) scale(0.98); }
</style>
