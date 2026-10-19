<script setup lang="ts">
/**
 * 全局布局：左侧导航栏 + 右侧内容区
 * 导航项：课堂纪要 / 智能问答 / 我的纪要 / 自创题练习 / 数据看板 / 公告管理 / 个人设置 / 问题反馈 / 使用说明
 * 游客模式：主内容区只读 —— 点击按钮 / 输入 / 拖拽上传等交互统一弹出「登录后即可使用」提示（可去登录 / 去注册）；
 * 侧边栏导航（查看各页面）与退出登录不受限制
 */
import { useRouter, useRoute } from 'vue-router'
import { onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import AnnouncementModal from '@/components/AnnouncementModal.vue'
import AuthModal from '@/components/AuthModal.vue'
import GuestHintModal from '@/components/GuestHintModal.vue'
import { userProfile } from '@/store/study'
import { isGuest, role, logout as authLogout, showGuestHint, buildAdminSsoUrl } from '@/store/auth'
import { refreshUnread, unreadCount } from '@/store/notice'
import LogoMark from '@/components/LogoMark.vue'

const router = useRouter()
const route = useRoute()
const sidebarOpen = ref(false)

const navs = [
  { path: '/studio', icon: 'file', label: '课堂纪要' },
  { path: '/qa', icon: 'chat', label: '智能问答' },
  { path: '/notes', icon: 'book', label: '我的纪要' },
  { path: '/quiz', icon: 'edit', label: '自创题练习' },
  { path: '/dashboard', icon: 'chart', label: '数据看板' },
  { path: '/announcements', icon: 'horn', label: '公告管理' },
  { path: '/settings', icon: 'sliders', label: '个人设置' },
  { path: '/feedback', icon: 'flag', label: '问题反馈' },
  { path: '/guide', icon: 'star', label: '使用说明' },
]

/** 角标文案：99+ 封顶 */
function badgeText(n: number) {
  return n > 99 ? '99+' : String(n)
}

// 新公告角标：登录后拉取；游客 → 注册/登录（isGuest true→false）后重新拉取
onMounted(() => {
  if (!isGuest.value) void refreshUnread()
})
watch(isGuest, (g, old) => {
  if (old && !g) void refreshUnread()
})

// 用户卡片点击 → 个人设置；退出登录需二次确认
function goSettings() {
  sidebarOpen.value = false
  router.push('/settings')
}
const showLogoutConfirm = ref(false)
function handleLogout() {
  showLogoutConfirm.value = false
  authLogout()
  router.push('/login')
}

/** 返回管理端（管理员 / 超级管理员）：携带登录态 SSO 跳回管理端工作台 */
function backToAdmin() {
  sidebarOpen.value = false
  window.location.href = buildAdminSsoUrl()
}

/* ---------- 游客模式守卫：拦截主内容区的交互，统一弹出登录 ---------- */
const INTERACTIVE = 'button, input, textarea, select, label, a[href], [role="button"], [tabindex="0"]'
function guestAllowed(t: HTMLElement) {
  return !!t.closest('[data-guest-allow]')
}
function guestClick(e: MouseEvent) {
  if (!isGuest.value) return
  const t = e.target as HTMLElement | null
  if (!t || guestAllowed(t) || !t.closest(INTERACTIVE)) return
  e.preventDefault()
  e.stopPropagation()
  // 先弹「登录后即可使用」提示（含 × / 去登录 / 去注册），由用户选择再进登录或注册表单
  showGuestHint()
}
function guestMouseDown(e: MouseEvent) {
  if (!isGuest.value) return
  const t = e.target as HTMLElement | null
  if (!t || guestAllowed(t)) return
  // 阻止输入框聚焦：游客态下输入框只读
  if (t.closest('input, textarea, select')) e.preventDefault()
}
function guestDragOver(e: DragEvent) {
  if (!isGuest.value) return
  // 阻止浏览器直接打开拖入的文件；drop 时统一弹出登录
  e.preventDefault()
}
function guestDrop(e: DragEvent) {
  if (!isGuest.value) return
  e.preventDefault()
  e.stopPropagation()
  showGuestHint()
}
</script>

<template>
  <div
    class="shell"
    @click.capture="guestClick"
    @mousedown.capture="guestMouseDown"
    @dragover.capture="guestDragOver"
    @drop.capture="guestDrop"
  >
    <!-- 移动端顶栏 -->
    <header class="mobile-topbar" data-guest-allow>
      <button class="btn-ghost btn" @click="sidebarOpen = !sidebarOpen"><AppIcon name="menu" /></button>
      <span class="h4">智学纪要</span>
    </header>

    <!-- 侧边栏 -->
    <aside class="sidebar" :class="{ open: sidebarOpen }" data-guest-allow>
      <div class="brand" @click="router.push('/studio')">
        <div class="brand-logo">
          <LogoMark :size="26" />
        </div>
        <div>
          <div class="brand-name">智学纪要</div>
          <div class="brand-sub">多模态课堂知识助手</div>
        </div>
      </div>

      <nav class="nav">
        <router-link
          v-for="n in navs"
          :key="n.path"
          :to="n.path"
          class="nav-item"
          :class="{ active: route.path === n.path }"
          @click="sidebarOpen = false"
        >
          <AppIcon :name="n.icon" :size="17" />
          <span>{{ n.label }}</span>
          <!-- 新公告角标：公告管理导航上的未读数 -->
          <span v-if="n.path === '/announcements' && unreadCount > 0" class="nav-badge">{{ badgeText(unreadCount) }}</span>
        </router-link>

        <!-- 管理员 / 超级管理员：返回管理端入口（携带登录态 SSO 跳转） -->
        <template v-if="!isGuest && role !== 'user'">
          <div class="nav-divider"></div>
          <button class="nav-item nav-admin" @click="backToAdmin">
            <AppIcon name="shield" :size="17" />
            <span>返回管理端</span>
          </button>
        </template>
      </nav>

      <div class="sidebar-footer">
        <!-- 用户卡片：点击进入个人设置（退出登录按钮除外） -->
        <div
          class="user-card"
          role="button"
          tabindex="0"
          title="进入个人设置"
          aria-label="进入个人设置"
          @click="goSettings"
          @keydown.enter="goSettings"
          @keydown.space.prevent="goSettings"
        >
          <img v-if="userProfile.avatar" :src="userProfile.avatar" class="avatar avatar-photo" :alt="userProfile.name + ' 的头像'" />
          <div v-else-if="isGuest" class="avatar avatar-guest"><AppIcon name="user" :size="17" /></div>
          <div v-else class="avatar" :style="{ background: userProfile.color }">{{ userProfile.name[0] }}</div>
          <div class="flex-1 ellipsis">
            <div class="user-name">{{ isGuest ? '游客' : userProfile.name }}</div>
            <div class="user-mail ellipsis">{{ isGuest ? '未登录 · 仅可浏览' : userProfile.email }}</div>
          </div>
          <button class="icon-btn" title="退出登录" aria-label="退出登录" @click.stop="showLogoutConfirm = true"><AppIcon name="logout" :size="16" /></button>
        </div>
      </div>
    </aside>

    <!-- 遮罩（移动端） -->
    <div v-if="sidebarOpen" class="mask" data-guest-allow @click="sidebarOpen = false"></div>

    <!-- 内容区 -->
    <main class="content">
      <!-- 问答页 keep-alive：跳转其他页面再回来保持对话现场（选中的会话 / 消息 / 输入框内容） -->
      <router-view v-slot="{ Component }">
        <keep-alive include="QAPage">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>

    <!-- 退出登录确认弹窗（游客无账号：文案更直接，只问是否确认退出） -->
    <div v-if="showLogoutConfirm" class="modal-mask" data-guest-allow @click.self="showLogoutConfirm = false">
      <div class="modal modal-sm">
        <div class="modal-title">{{ isGuest ? '退出游客模式' : '退出登录' }}</div>
        <p class="modal-sub">
          {{ isGuest ? '当前为游客身份浏览，没有账号数据，确认退出并返回首页吗？' : '确定要退出当前账号吗？退出后需重新登录才能继续使用。' }}
        </p>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="showLogoutConfirm = false">取消</button>
          <button class="btn btn-danger" @click="handleLogout">{{ isGuest ? '确认退出' : '退出登录' }}</button>
        </div>
      </div>
    </div>

    <!-- 游客提示弹窗：游客态点击功能操作时提醒，含去登录 / 去注册入口 -->
    <GuestHintModal />

    <!-- 登录后新公告弹窗：只提醒一次，点「我知道了」后不再弹（发新公告除外） -->
    <AnnouncementModal />

    <!-- 登录 / 注册弹窗（提示弹窗选择后打开，登录后原地恢复完整权限） -->
    <AuthModal />
  </div>
</template>

<style scoped>
.shell { display: flex; height: 100%; background: var(--surface-soft); }

.mobile-topbar {
  display: none; position: fixed; top: 0; left: 0; right: 0; z-index: 40;
  height: 52px; align-items: center; gap: 12px; padding: 0 16px;
  background: var(--canvas); border-bottom: 1px solid var(--hairline);
}

.sidebar {
  width: 232px; flex-shrink: 0; display: flex; flex-direction: column;
  background: var(--canvas); border-right: 1px solid var(--hairline);
}
.brand {
  display: flex; align-items: center; gap: 10px; padding: 20px 16px;
  border-bottom: 1px solid var(--hairline-soft); cursor: pointer;
}
.brand-logo { display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.brand-name { font-size: 16px; font-weight: 600; letter-spacing: -0.2px; }
.brand-sub { font-size: 11px; color: var(--stone); }

.nav { flex: 1; padding: 12px 10px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
.nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px; border-radius: var(--radius-md);
  color: var(--slate); font-size: 14px; font-weight: 500; transition: all 0.15s ease;
}
.nav-item:hover { background: var(--surface); color: var(--ink); }
.nav-item.active { background: var(--tint-lavender); color: var(--brand-purple-800); }
.nav-divider { height: 1px; background: var(--hairline-soft); margin: 8px 6px; }
/* 新公告未读角标 */
.nav-badge {
  margin-left: auto; min-width: 17px; height: 17px; padding: 0 5px;
  border-radius: 999px; background: var(--error); color: #fff;
  font-size: 10.5px; font-weight: 700; line-height: 17px; text-align: center;
}
.nav-admin { width: 100%; border: none; background: transparent; font-family: inherit; cursor: pointer; color: var(--brand-purple-800); }
.nav-admin:hover { background: var(--tint-lavender); }

.sidebar-footer { padding: 12px; border-top: 1px solid var(--hairline-soft); }
/* 用户卡片可点击进入个人设置：负 margin 扩大热区且不改变外部布局 */
.user-card {
  display: flex; align-items: center; gap: 10px;
  padding: 6px; margin: -6px; border-radius: var(--radius-md);
  cursor: pointer; transition: background 0.15s ease;
}
.user-card:hover { background: var(--surface-soft); }
.user-card:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
.avatar-photo { object-fit: cover; }
/* 游客态头像：灰色人形占位 */
.avatar-guest { background: var(--surface); color: var(--stone); }
.user-name { font-size: 13px; font-weight: 600; }
.user-mail { font-size: 11px; color: var(--stone); }
.icon-btn {
  border: none; background: transparent; color: var(--stone);
  padding: 6px; border-radius: var(--radius-sm); display: flex;
}
.icon-btn:hover { background: var(--surface); color: var(--error); }
/* 退出登录确认弹窗 */
.modal-sm { max-width: 400px; }

.mask { display: none; }

@media (max-width: 900px) {
  .mobile-topbar { display: flex; }
  .sidebar {
    position: fixed; z-index: 50; top: 0; bottom: 0; left: -260px;
    transition: left 0.2s ease; box-shadow: var(--shadow-modal);
  }
  .sidebar.open { left: 0; }
  .mask { display: block; position: fixed; inset: 0; background: rgba(15,15,15,0.4); z-index: 45; }
  .content { padding-top: 52px; }
}

.content { flex: 1; min-width: 0; overflow-y: auto; display: flex; flex-direction: column; }
</style>
