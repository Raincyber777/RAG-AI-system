# 「智学纪要」前端自动部署（GitHub Actions → 阿里云 ECS）

push 到 `main` / `txy` 分支即自动构建并发布，无需登录服务器手动操作。

## 架构

```
GitHub push
  └─ GitHub Actions：npm ci → npm run build（含类型检查）→ 打包 dist
       └─ SSH 上传 ECS，原子切换发布目录
            ├─ /var/www/rag-user   ← 用户端（nginx :80）
            └─ /var/www/rag-admin  ← 管理端（nginx :8081）
                  └─ /api、/media → 反代本机 Django(:8080)
```

上一版发布始终保留在同目录 `.old`，出问题可秒回滚（`mv` 回来即可）。

## 首次配置（一次性，约 5 分钟）

### 1. 生成部署专用 SSH 密钥（本机 Git Bash 执行）

```bash
ssh-keygen -t ed25519 -f ~/.ssh/rag_deploy_key -N "" -C "github-actions-deploy"
ssh-copy-id -i ~/.ssh/rag_deploy_key.pub 用户名@服务器IP    # 这一步输一次服务器密码
```

> 也可以在服务器上手动执行：把 `~/.ssh/rag_deploy_key.pub` 的内容追加到服务器
> `~/.ssh/authorized_keys`。密码本身永远不进 GitHub。

### 2. 配置两个仓库的 Secrets（Settings → Secrets and variables → Actions）

Secrets（两个仓库都配，值相同）：

| 名称 | 值 |
|---|---|
| `DEPLOY_HOST` | ECS 公网 IP，如 `47.x.x.x` |
| `DEPLOY_USER` | SSH 用户名（上一步 ssh-copy-id 用的） |
| `DEPLOY_PORT` | SSH 端口，22 可以不配 |
| `DEPLOY_SSH_KEY` | `~/.ssh/rag_deploy_key`（私钥）文件**全部内容** |

Variables（注意在 **Variables** 标签页，不是 Secrets）：

| 仓库 | 名称 | 值 |
|---|---|---|
| 用户端 RAG-AI-system | `VITE_ADMIN_ORIGIN` | `http://服务器IP:8081` |
| 管理端 RAG-admin | `VITE_USER_ORIGIN` | `http://服务器IP` |

> 这两个值会编译进前端，用于两端互跳（SSO / 退出回跳）。
> 有域名后改成域名即可（如 `https://demo.example.com:8081`）。

### 3. 服务器：nginx 站点配置

把本目录的 `nginx-rag.conf` 上传到服务器：

```bash
scp deploy/nginx-rag.conf 用户名@服务器IP:/etc/nginx/conf.d/rag.conf
ssh 用户名@服务器IP "sudo nginx -t && sudo systemctl reload nginx"
```

并确认阿里云控制台**安全组**放行 80 / 8081 入方向；Django 的
`ALLOWED_HOSTS` / `CSRF_TRUSTED_ORIGINS` 包含服务器 IP（或域名）。

### 4. 触发

把代码 push 上去（或到 Actions 页点 `workflow_dispatch` 手动跑一次），
Actions 跑完访问 `http://服务器IP`（用户端）/ `http://服务器IP:8081`（管理端）。

## 日常使用

- **自动部署**：push 即部署，Actions 页可看每一步日志；构建或类型检查失败不会发布。
- **手动回滚**（服务器上执行）：
  ```bash
  cd /var/www && mv rag-user rag-user.bad && mv rag-user.old rag-user
  ```
- **修改部署分支**：编辑 `.github/workflows/deploy.yml` 里 `branches` 列表。
- **密钥泄漏处理**：删掉服务器 `authorized_keys` 里对应行 + GitHub Secret 里的私钥，重新生成即可。
