<script setup lang="ts">
/**
 * 全局布局：左侧导航栏 + 右侧内容区
 * 导航项：课堂纪要 / 智能问答 / 我的纪要 / 数据看板 / 设置 / 反馈
 */
import { useRouter, useRoute } from 'vue-router'
import { ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { userProfile } from '@/store/study'

const router = useRouter()
const route = useRoute()
const sidebarOpen = ref(false)

const navs = [
  { path: '/studio', icon: 'spark', label: '课堂纪要' },
  { path: '/qa', icon: 'chat', label: '智能问答' },
  { path: '/notes', icon: 'book', label: '我的纪要' },
  { path: '/quiz', icon: 'edit', label: '自创题练习' },
  { path: '/dashboard', icon: 'chart', label: '数据看板' },
  { path: '/settings', icon: 'sliders', label: '个人设置' },
  { path: '/feedback', icon: 'flag', label: '问题反馈' },
  { path: '/guide', icon: 'star', label: '使用说明' },
]

// 用户卡片点击 → 个人设置；退出登录需二次确认
function goSettings() {
  sidebarOpen.value = false
  router.push('/settings')
}
const showLogoutConfirm = ref(false)
function handleLogout() {
  showLogoutConfirm.value = false
  localStorage.removeItem('zy_token')
  router.push('/login')
}
</script>

<template>
  <div class="shell">
    <!-- 移动端顶栏 -->
    <header class="mobile-topbar">
      <button class="btn-ghost btn" @click="sidebarOpen = !sidebarOpen"><AppIcon name="menu" /></button>
      <span class="h4">智学纪要</span>
    </header>

    <!-- 侧边栏 -->
    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <div class="brand" @click="router.push('/studio')">
        <div class="brand-logo"><AppIcon name="headphones" :size="18" /></div>
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
        </router-link>
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
          <div v-else class="avatar" :style="{ background: userProfile.color }">{{ userProfile.name[0] }}</div>
          <div class="flex-1 ellipsis">
            <div class="user-name">{{ userProfile.name }}</div>
            <div class="user-mail ellipsis">{{ userProfile.email }}</div>
          </div>
          <button class="icon-btn" title="退出登录" aria-label="退出登录" @click.stop="showLogoutConfirm = true"><AppIcon name="logout" :size="16" /></button>
        </div>
      </div>
    </aside>

    <!-- 遮罩（移动端） -->
    <div v-if="sidebarOpen" class="mask" @click="sidebarOpen = false"></div>

    <!-- 内容区 -->
    <main class="content">
      <router-view />
    </main>

    <!-- 退出登录确认弹窗 -->
    <div v-if="showLogoutConfirm" class="modal-mask" @click.self="showLogoutConfirm = false">
      <div class="modal modal-sm">
        <div class="modal-title">退出登录</div>
        <p class="modal-sub">确定要退出当前账号吗？退出后需重新登录才能继续使用。</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="showLogoutConfirm = false">取消</button>
          <button class="btn btn-danger" @click="handleLogout">退出登录</button>
        </div>
      </div>
    </div>
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
.brand-logo {
  width: 34px; height: 34px; border-radius: var(--radius-md);
  background: var(--brand-navy); color: var(--brand-yellow);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
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
