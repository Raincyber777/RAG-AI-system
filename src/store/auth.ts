/**
 * 登录态共享 store（模块级 ref 单例）
 * 状态：游客模式（有 token 但未真实登录，仅可浏览演示内容，功能操作统一弹出登录）/ 已登录
 * 登录 / 注册弹窗（AuthModal）在着陆页与应用内共用本状态
 */
import { ref } from 'vue'

export type AuthMode = 'login' | 'register' | 'forgot'
export type Role = 'user' | 'admin' | 'super'

const GUEST_KEY = 'zy_guest'
const ROLE_KEY = 'zy_role'

/** 管理端地址（分权：管理员账号登录后先进入管理端；管理端也可一键回到用户端） */
export const ADMIN_ORIGIN = 'http://localhost:5174'

/** 当前账号角色：普通用户 / 管理员 / 超级管理员（管理员账号同样可使用用户端全部功能） */
export const role = ref<Role>((localStorage.getItem(ROLE_KEY) as Role) || 'user')

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
  role.value = 'user'
  localStorage.setItem(ROLE_KEY, 'user')
  isGuest.value = false
  authModalOpen.value = false
}

/** 进入游客模式：写入 token 与游客标记，仅可浏览 */
export function guestLogin() {
  localStorage.setItem('zy_token', 'demo-token')
  localStorage.setItem(GUEST_KEY, '1')
  role.value = 'user'
  localStorage.setItem(ROLE_KEY, 'user')
  isGuest.value = true
  authModalOpen.value = false
}

/** 退出登录：清除全部本地登录信息 */
export function logout() {
  localStorage.removeItem('zy_token')
  localStorage.removeItem('zy_user')
  localStorage.removeItem(GUEST_KEY)
  localStorage.removeItem(ROLE_KEY)
  role.value = 'user'
  isGuest.value = false
  authModalOpen.value = false
}

/**
 * 演示管理员账号（与 RAG-admin 管理端共享同一份种子数据；接入后端后由接口校验）
 * 在用户端用管理员账号登录 → 跳转管理端（管理端通过 sso 参数免登）
 */
export interface DemoAdmin {
  name: string
  email: string
  phone: string
  password: string
  role: Exclude<Role, 'user'>
}

const DEMO_ADMIN_ACCOUNTS: DemoAdmin[] = [
  { name: '超级管理员', email: 'admin@zhiyuan.ai', phone: '13800000001', password: 'admin123456', role: 'super' },
  { name: '陈教务', email: 'chenjw@zhiyuan.ai', phone: '13800000002', password: 'admin123456', role: 'admin' },
  { name: '刘运营', email: 'liuyy@zhiyuan.ai', phone: '13800000003', password: 'admin123456', role: 'admin' },
]

/** 按账号（邮箱或手机号）+ 密码匹配管理员账号，非管理员返回 undefined */
export function matchAdminAccount(account: string, password: string): DemoAdmin | undefined {
  return DEMO_ADMIN_ACCOUNTS.find(
    (a) => (a.email === account || a.phone === account) && a.password === password,
  )
}

/**
 * 登录表单下方展示的演示账号（与 RAG-admin 管理端共享同一份种子数据）
 * 点击可一键填入登录表单：普通用户登录后留在用户端；管理员 / 超级管理员登录后先进入管理端
 */
export interface DemoLoginAccount {
  label: string
  email: string
  phone: string
  password: string
}

export const DEMO_ACCOUNTS: DemoLoginAccount[] = [
  { label: '普通用户', email: 'linxz@zhiyuan.ai', phone: '13800001001', password: '123456' },
  { label: '管理员', email: 'chenjw@zhiyuan.ai', phone: '13800000002', password: 'admin123456' },
  { label: '超级管理员', email: 'admin@zhiyuan.ai', phone: '13800000001', password: 'admin123456' },
]
