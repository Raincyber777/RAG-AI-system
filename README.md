# 智学纪要 · 用户端

> 多模态课堂知识助手 —— 把课堂音视频与课件，变成可检索、可追问、可出题、可追溯的学习资产。
> 与「管理端」为两个独立项目，本仓库为面向学生与教师的 **用户端前台**。
>
> - 服务端仓库：[Raincyber777/-RAG-Database](https://github.com/Raincyber777/-RAG-Database)
> - 管理端仓库：[Raincyber777/RAG-admin](https://github.com/Raincyber777/RAG-admin)

## 快速开始

```bash
npm install
npm run type-check   # vue-tsc 类型检查（CI 部署前强制执行）
npm run dev          # 开发调试，默认 http://localhost:5173
npm run build        # 类型检查 + 生产构建
```

接口默认走本仓库 Vite 代理（`/api` → `http://127.0.0.1:8080`，即服务端 `python manage.py runserver`）。可选环境变量 `VITE_ADMIN_ORIGIN`：与管理端跨域互通时的管理端站点地址，默认当前站点。

进站需登录（注册 / 登录均支持邮箱验证码；`/login` 提供两种表单）。

## 功能板块

| 路由 | 页面 | 说明 |
|---|---|---|
| `/login` | 着陆页 / 登录注册 | 产品介绍 + 登录注册（协议勾选、验证码） |
| `/studio` | **课堂纪要工作台**（核心） | 多模态上传（音频/视频/图片/文档，支持文件夹打包批量）· 逐份设置课堂主题与课程 · Agent 工作流可视化 · 结构化纪要流式生成 · 切换卡片查看各份进度 · 停止生成 / 重新处理 · 刷新保现场（上传队列与生成清单持久化） |
| `/qa` | **智能问答**（核心） | 知识库优先 + 覆盖不足联网补充 · 流式回答 · 引用溯源卡片（录音时间点/纪要片段/外部网页）· 会话目录（课内会话按材料归档）· 个性化推荐问题（候选池随机抽样）· 语音提问 · 附件问答 · 会话级流式任务（切换会话不断答） |
| `/notes` | 我的纪要 | 纪要卡片视图：回放原文、继续追问、导出 Markdown、删除 |
| `/quiz` | 自创题练习 | 基于纪要自动出题（六类题型）、按课程章节筛选、即时批改、错题本与重练 |
| `/dashboard` | 数据看板 | 个人学习口径：课堂总数/累计追问/练习题量/错题数 + 每日追问趋势、材料类型占比、高频知识点、热门追问词云（ECharts） |
| `/announcements` | 公告管理 | 平台公告集中查看、已读角标提醒 |
| `/settings` | 个人设置 | 资料/头像/手机号邮箱换绑（验证码）/密码 |
| `/feedback` | 问题反馈 | Bug / 建议提交（附截图），处理进度跟踪 |
| `/guide` | 使用说明 | 快速上手三步曲 · 八大板块导览 · 使用技巧 · 常见问题 FAQ |

## 目录结构

```
src/
├── assets/design.css        # 设计系统（Design Tokens + 通用组件类）
├── content/policies.ts      # 《用户协议》/《隐私政策》结构化文档
├── api/index.ts             # REST + SSE（流式问答）客户端
├── store/                   # Pinia：auth / notes / 会话等
├── router/index.ts          # 路由表（登录守卫）
├── layouts/AppLayout.vue    # 全局布局（侧边导航 + 内容区）
├── components/              # AppIcon、AuthModal、PolicyModal、SparkMark 等
└── views/                   # 页面组件（与上表路由一一对应）
```

## 技术栈

Vue 3.5（`<script setup>` + TypeScript）· Vue Router 4 · Pinia · Element Plus · ECharts · JSZip（文件夹打包上传）· Vite

## 部署

`git push` 触发 GitHub Actions：`vue-tsc --build` 类型检查通过后构建并自动部署到 ECS Nginx（生产站点 `:8082`）。
