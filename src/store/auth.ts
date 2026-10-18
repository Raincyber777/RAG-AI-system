/**
 * 登录态共享 store（模块级 ref 单例）
 * 状态：游客模式（仅可浏览演示内容，功能操作统一弹出登录）/ 已登录（JWT）
 * 登录 / 注册弹窗（AuthModal）在着陆页与应用内共用本状态
 * 分权：普通用户登录后留在用户端；管理员 / 超级管理员登录后携带 token 跳入管理端
 */
import { ref } from 'vue'

import { authApi, type ApiRole, type ApiUser, type AuthPayload, type CodeChannel } from '@/api'
import { clearTokens, getRefresh, getToken, saveTokens, setAuthExpiredHandler } from '@/api/http'

export type AuthMode = 'login' | 'register' | 'forgot'
export type Role = ApiRole

const GUEST_KEY = 'zy_guest'
const ROLE_KEY = 'zy_role'
const USER_KEY = 'zy_user'

/** 管理端地址（分权：管理员账号登录后先进入管理端；管理端也可一键回到用户端）
 * 本地开发取 .env.development（5174）；生产构建由 CI 注入 VITE_ADMIN_ORIGIN（如 http://服务器IP:8081） */
export const ADMIN_ORIGIN =
  (import.meta.env.VITE_ADMIN_ORIGIN as string | undefined) || window.location.origin

/** 当前账号角色：普通用户 / 管理员 / 超级管理员（管理员账号同样可使用用户端全部功能） */
export const role = ref<Role>((localStorage.getItem(ROLE_KEY) as Role) || 'user')

/** 是否为游客模式：可以浏览各页面演示内容，但任何功能操作都会要求登录 */
export const isGuest = ref(false)

/** 登录 / 注册弹窗状态（全局共用，任意页面可打开） */
export const authModalOpen = ref(false)
export const authModalMode = ref<AuthMode>('login')

/** 当前登录用户（后端返回的资料；游客态为 null） */
export const currentUser = ref<ApiUser | null>(readUser())

function readUser(): ApiUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as ApiUser) : null
  } catch {
    return null
  }
}

// 模块加载时按本地存储恢复游客态（游客无真实 token）
isGuest.value = !!localStorage.getItem(GUEST_KEY)

// 本地有 token 时拉取后端最新资料：纠正过期的本地缓存与 SSO 占位资料（静默，失败由 401 自愈逻辑处理）
if (!isGuest.value && getToken()) void ensureMe()

/** 拉取当前账号后端资料并同步本地会话（角色 / 统计数以服务端为准） */
export async function ensureMe(): Promise<ApiUser | null> {
  if (isGuest.value || !getToken()) return null
  try {
    const u = await authApi.me()
    updateCurrentUser(u)
    role.value = u.role
    localStorage.setItem(ROLE_KEY, u.role)
    return u
  } catch {
    return null
  }
}

// 登录过期（刷新失败）：清空本地登录态
setAuthExpiredHandler(() => {
  clearLocalSession()
})

function clearLocalSession() {
  clearTokens()
  localStorage.removeItem(USER_KEY)
  localStorage.removeItem(GUEST_KEY)
  localStorage.removeItem(ROLE_KEY)
  currentUser.value = null
  role.value = 'user'
  isGuest.value = false
}

/** 管理端退出登录跳回首页（?logout=1）时由路由守卫调用：清空本端全部登录态 */
export function remoteLogoutCleanup() {
  clearLocalSession()
}

export function openAuth(mode: AuthMode = 'login') {
  authModalMode.value = mode
  authModalOpen.value = true
}

export function closeAuth() {
  authModalOpen.value = false
}

/** 游客提示弹窗：游客点击功能操作时先提醒（带 × / 去登录 / 去注册），不直接弹出登录表单 */
export const guestHintOpen = ref(false)
export function showGuestHint() {
  guestHintOpen.value = true
}
export function closeGuestHint() {
  guestHintOpen.value = false
}
/** 提示弹窗里的「去登录 / 去注册」：关闭提示并打开对应表单 */
export function openAuthFromHint(mode: AuthMode) {
  guestHintOpen.value = false
  openAuth(mode)
}

/** 后端登录 / 注册成功：写入 JWT 与用户资料，清除游客标记 */
export function applyAuthPayload(payload: AuthPayload) {
  saveTokens(payload.access, payload.refresh)
  localStorage.setItem(USER_KEY, JSON.stringify(payload.user))
  localStorage.removeItem(GUEST_KEY)
  currentUser.value = payload.user
  role.value = payload.user.role
  localStorage.setItem(ROLE_KEY, payload.user.role)
  isGuest.value = false
  authModalOpen.value = false
}

/** 管理端跳转入口：携带 token 与身份的 SSO 地址 */
export function buildAdminSsoUrl(): string {
  const u = currentUser.value
  const q = new URLSearchParams({
    sso: '1',
    n: u?.name ?? '',
    e: u?.email ?? '',
    r: role.value,
    t: getToken(),
    rt: getRefresh(),
  })
  return `${ADMIN_ORIGIN}/?${q.toString()}`
}

/**
 * 管理端跳回用户端时由路由守卫调用：按 sso 参数建立本地会话（含 JWT）
 * 返回是否成功建立（缺 token 视为无效，走正常登录流程）
 */
export function acceptUserSso(q: { n?: string; e?: string; r?: string; t?: string; rt?: string }): boolean {
  if (!q.t) return false
  saveTokens(q.t, q.rt || '')
  const r: Role = q.r === 'super' ? 'super' : q.r === 'admin' ? 'admin' : 'user'
  const user: ApiUser = {
    id: 0,
    name: q.n || '管理员',
    phone: '',
    email: q.e || '',
    role: r,
    status: 'active',
    avatar: '',
    notes_count: 0,
    questions_count: 0,
    created_at: '',
  }
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  localStorage.setItem(ROLE_KEY, r)
  localStorage.removeItem(GUEST_KEY)
  currentUser.value = user
  role.value = r
  isGuest.value = false
  void ensureMe() // sso 参数里只有名字 / 邮箱，拉取完整资料替换占位对象（真实 id / 手机号 / 统计数）
  return true
}

/** 资料修改成功后同步本地会话用户信息（触发共享资料 watch，侧边栏即时更新） */
export function updateCurrentUser(u: ApiUser) {
  currentUser.value = u
  localStorage.setItem(USER_KEY, JSON.stringify(u))
}

/** 真实登录：成功返回 payload（调用方按角色决定是否跳管理端）；失败抛 ApiError */
export async function login(account: string, password: string): Promise<AuthPayload> {
  const payload = await authApi.login(account.trim(), password)
  applyAuthPayload(payload)
  return payload
}

/** 真实注册（后端注册即登录，需验证码）：成功自动建立会话 */
export async function register(form: {
  name: string; phone: string; email: string; password: string
  code: string; code_channel: CodeChannel
}) {
  const payload = await authApi.register(form)
  applyAuthPayload(payload)
  return payload
}

/** 进入游客模式：无 token，仅可浏览 */
export function guestLogin() {
  localStorage.setItem(GUEST_KEY, '1')
  role.value = 'user'
  localStorage.setItem(ROLE_KEY, 'user')
  isGuest.value = true
  authModalOpen.value = false
}

/** 退出登录：通知后端拉黑 refresh（尽力而为），并清除全部本地登录信息 */
export async function logout() {
  const refresh = getRefresh()
  clearLocalSession()
  authModalOpen.value = false
  if (refresh) {
    try {
      await authApi.logout(refresh)
    } catch {
      // 本地已退出，后端登出失败可忽略（refresh 有 7 天有效期上限）
    }
  }
}

