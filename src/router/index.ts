import { createRouter, createWebHistory } from 'vue-router'

/**
 * 用户端路由表
 * /login        登录注册页（无需鉴权）
 * /             智能对话交互区（核心前台）
 * /knowledge    知识库与文档管理区
 * /dashboard    数据统计仪表盘
 * /history      问答历史
 * /settings     用户与系统配置区（RAG 参数调优）
 * /feedback     问题反馈
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/views/LoginPage.vue') },
    {
      path: '/',
      component: () => import('@/layouts/AppLayout.vue'),
      redirect: '/chat',
      children: [
        {
          path: 'chat',
          name: 'chat',
          component: () => import('@/views/ChatPage.vue'),
          meta: { title: '智能对话' },
        },
        {
          path: 'knowledge',
          name: 'knowledge',
          component: () => import('@/views/KnowledgeBasePage.vue'),
          meta: { title: '知识库管理' },
        },
        {
          path: 'dashboard',
          name: 'dashboard',
          component: () => import('@/views/DashboardPage.vue'),
          meta: { title: '数据看板' },
        },
        {
          path: 'history',
          name: 'history',
          component: () => import('@/views/HistoryPage.vue'),
          meta: { title: '问答历史' },
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
    // 兜底：未匹配路径回到对话页
    { path: '/:pathMatch(.*)*', redirect: '/chat' },
  ],
})

// 简易登录守卫：无 token 时跳转登录页
router.beforeEach((to) => {
  const token = localStorage.getItem('zy_token')
  if (!token && to.name !== 'login') return { name: 'login' }
  if (token && to.name === 'login') return { name: 'chat' }
  return true
})

export default router
