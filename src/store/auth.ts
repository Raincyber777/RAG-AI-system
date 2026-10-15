/**
 * 登录态共享 store（模块级 ref 单例）
 * 状态：游客模式（有 token 但未真实登录，仅可浏览演示内容，功能操作统一弹出登录）/ 已登录
 * 登录 / 注册弹窗（AuthModal）在着陆页与应用内共用本状态
 */
import { ref } from 'vue'

export type AuthMode = 'login' | 'register' | 'forgot'

const GUEST_KEY = 'zy_guest'

/** 是否为游客模式：可以浏览各页面演示内容，但任何功能操作都会要求登录 */
export const isGuest = ref(false)

/** 登录 / 注册弹窗状态（全局共用，任意页面可打开） */
export const authModalOpen = ref(false)
export const authModalMode = ref<AuthMode>('login')

// 模块加载时按本地存储恢复游客态
isGuest.value = !!(localStorage.getItem('zy_token') && localStorage.getItem(GUEST_KEY))

export function openAuth(mode: AuthMode = 'login') {
  authModalMode.value = mode
  authModalOpen.value = true
}

export function closeAuth() {
  authModalOpen.value = false
}

/** 真实登录 / 注册成功：写入 token、清除游客标记 */
export function loginSuccess(options: { register?: boolean; name?: string } = {}) {
  localStorage.setItem('zy_token', 'demo-token')
  localStorage.removeItem(GUEST_KEY)
  if (options.register && options.name) localStorage.setItem('zy_user', options.name)
  isGuest.value = false
  authModalOpen.value = false
}

/** 进入游客模式：写入 token 与游客标记，仅可浏览 */
export function guestLogin() {
  localStorage.setItem('zy_token', 'demo-token')
  localStorage.setItem(GUEST_KEY, '1')
  isGuest.value = true
  authModalOpen.value = false
}

/** 退出登录：清除全部本地登录信息 */
export function logout() {
  localStorage.removeItem('zy_token')
  localStorage.removeItem('zy_user')
  localStorage.removeItem(GUEST_KEY)
  isGuest.value = false
  authModalOpen.value = false
}
