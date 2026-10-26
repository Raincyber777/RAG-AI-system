import { createRouter, createWebHistory } from 'vue-router'
import { acceptUserSso, remoteLogoutCleanup } from '@/store/auth'

/**
 * 用户端路由表 — 智学纪要 · 多模态课堂知识助手
 * /login     着陆页（顶部导航 + 登录 / 注册弹窗，无需鉴权）
 * /studio    课堂纪要工作台（核心：上传 → Agent 处理 → 流式纪要）
 * /qa        智能问答（带时间戳 / 图片来源的 RAG 问答）
 * /notes     我的纪要（课堂卡片管理与导出）
 * /quiz      自创题练习（筛选生成题目 / 作答批改 / 错题本）
 * /dashboard 数据看板
 * /announcements 公告管理（查看平台公告）
 * /settings  个人设置（资料 / 密码）
 * /feedback  问题反馈
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/views/LoginPage.vue') },
    {
      path: '/',
      component: () => import('@/layouts/AppLayout.vue'),
      // 进站一律先落在着陆页：已登录用户看到「进入系统」按钮再进应用，不直接进入已登录状态（2026-10-26）
      redirect: '/login',
      children: [
        {
          path: 'studio',
          name: 'studio',
          component: () => import('@/views/StudioPage.vue'),
          meta: { title: '课堂纪要' },
        },
        {
          path: 'qa',
          name: 'qa',
          component: () => import('@/views/QAPage.vue'),
          meta: { title: '智能问答' },
        },
        {
          path: 'notes',
          name: 'notes',
          component: () => import('@/views/NotesPage.vue'),
          meta: { title: '我的纪要' },
        },
        {
          path: 'quiz',
          name: 'quiz',
          component: () => import('@/views/QuizPage.vue'),
          meta: { title: '自创题练习' },
        },
        {
          path: 'dashboard',
          name: 'dashboard',
          component: () => import('@/views/DashboardPage.vue'),
          meta: { title: '数据看板' },
        },
        {
          path: 'announcements',
          name: 'announcements',
          component: () => import('@/views/AnnouncementsPage.vue'),
          meta: { title: '公告管理' },
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('@/views/SettingsPage.vue'),
          meta: { title: '个人设置' },
        },
        {
          path: 'feedback',
          name: 'feedback',
          component: () => import('@/views/FeedbackPage.vue'),
          meta: { title: '问题反馈' },
        },
        {
          path: 'guide',
          name: 'guide',
          component: () => import('@/views/GuidePage.vue'),
          meta: { title: '使用说明' },
        },
      ],
    },
    // 兜底：未匹配路径回到课堂纪要工作台
    { path: '/:pathMatch(.*)*', redirect: '/studio' },
  ],
})

// 登录守卫：管理端「进入用户端」携带 sso（含 JWT）时先建立会话；游客可浏览，未登录跳转登录页
router.beforeEach((to) => {
  // 管理端退出登录跳回（?logout=1）：先清空本端登录态（避免残留会话把首页重定向进应用），落到首页
  if (to.query.logout === '1') {
    remoteLogoutCleanup()
    return { name: 'login', query: {} }
  }
  if (to.query.sso === '1') {
    const q = to.query
    const pick = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : undefined)
    const t = pick('t')
    // 管理端跳入且带 token：直接建立会话（覆盖本地旧会话，残留失效 token 借此自愈）
    if (t && acceptUserSso({ n: pick('n'), e: pick('e'), r: pick('r'), t, rt: pick('rt') })) {
      return { path: to.path, replace: true }
    }
    // 缺 token 的 sso：本端已有会话则去掉参数继续（不要求重登），否则回登录页
    if (!t && localStorage.getItem('zy_token')) {
      return { path: to.path, query: { ...q, sso: undefined, n: undefined, e: undefined, r: undefined }, replace: true }
    }
    return { name: 'login' }
  }
  const authed = !!localStorage.getItem('zy_token') || !!localStorage.getItem('zy_guest')
  if (!authed && to.name !== 'login') return { name: 'login' }
  // 已登录访问 /login 不再弹回应用：着陆页对已登录用户展示「进入系统」入口（2026-10-26）
  return true
})

export default router
