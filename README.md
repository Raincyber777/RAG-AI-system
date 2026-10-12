# 智源问答 · 用户端

> 基于 RAG（检索增强生成）的企业知识问答系统 —— **让每一次回答都有据可查**。
> 与「管理员端」为两个独立项目，本仓库为面向普通用户的 **用户端前台**。

## 快速开始

```bash
npm install
npm run dev      # 开发调试，默认 http://localhost:5173
npm run build    # 类型检查 + 生产构建
```

演示可直接使用登录页的 **「游客一键体验」**（登录状态存于 localStorage）。

## 功能板块

| 路由 | 页面 | 说明 |
|---|---|---|
| `/login` | 登录 / 注册 | 深蓝品牌区 + 登录注册表单 |
| `/chat` | **智能对话**（核心） | 历史会话列表 · 多模态输入（文本/文件）· 流式回答 · **引用溯源卡片** · 点赞点踩 / 重新生成 |
| `/knowledge` | **知识库管理** | 知识空间切换/新建 · 拖拽上传 · 文档全生命周期（下载/重命名/删除）· 解析状态实时反馈（排队→切片→向量化→完成/失败） |
| `/dashboard` | **数据看板** | 系统指标卡 · 每日提问量趋势（ECharts）· 知识空间占比环形图 · 高频词 TOP10 · 热门问题词云 |
| `/history` | 问答历史 | 历史提问记录、引用来源、按空间筛选 |
| `/settings` | 个人设置 | 资料维护 · **RAG 参数调优**（回答长度 / Top-K / 引用严格度 / 记忆轮数 / Temperature）· 通知偏好 |
| `/feedback` | 问题反馈 | Bug / 建议提交，处理进度跟踪 |
| `/guide` | 使用说明 | 快速上手三步曲 · 板块导览 · 对话技巧 · 常见问题 FAQ |

## 目录结构

```
src/
├── assets/design.css        # 设计系统（Notion 风格 Design Tokens + 通用组件类）
├── router/index.ts          # 路由表（含登录守卫）
├── layouts/AppLayout.vue    # 全局布局（侧边导航 + 内容区）
├── components/AppIcon.vue   # 内置 SVG 图标库
├── mock/data.ts             # 模拟数据（可替换为真实接口）
└── views/                   # 页面组件
    ├── LoginPage.vue        # 登录注册
    ├── ChatPage.vue         # 智能对话（核心）
    ├── KnowledgeBasePage.vue# 知识库管理
    ├── DashboardPage.vue    # 数据看板
    ├── HistoryPage.vue      # 问答历史
    ├── SettingsPage.vue     # 个人设置
    ├── FeedbackPage.vue     # 问题反馈
    └── GuidePage.vue        # 使用说明
```

## 设计规范

UI 基于 Notion 风格设计系统（见 `DESIGN.md`）：深蓝品牌带 `#0a1530`、主 CTA 紫 `#5645d4`、
粉彩特性卡片（peach/rose/mint/lavender/sky/yellow）、8px 矩形按钮 + 12px 卡片圆角、Inter 字体族。

## 技术栈

Vue 3.5（`<script setup>` + TypeScript）· Vue Router 4 · ECharts 6 · Vite 8

> 当前为纯前端演示，数据来自 `src/mock/data.ts`；对接后端时替换该文件为 API 请求即可。
