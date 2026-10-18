# 「智学纪要」前端自动部署（GitHub Actions → 阿里云 ECS）

push 到 `main` / `txy` 分支即自动构建并发布，无需登录服务器手动操作。

## 架构

> 该 ECS 与其他项目（控糖管家，占 80/443/8000）共用一台机器，
> RAG 全部走独立端口，互不干扰。

```
GitHub push
  └─ GitHub Actions：npm ci → npm run build（含类型检查）→ 打包 dist
       └─ SSH 上传 ECS，原子切换发布目录
            ├─ /var/www/rag-user   ← 用户端（nginx :8082）
            └─ /var/www/rag-admin  ← 管理端（nginx :8081）
                  └─ /api、/media → 反代本机 Django(:8080)
```

上一版发布始终保留在同目录 `.old`，出问题可秒回滚（`mv` 回来即可）。

## 首次配置（一次性，约 5 分钟）

### 1. 生成部署专用 SSH 密钥（本机 Git Bash 执行）

```bash
ssh-keygen -t ed25519 -f ~/.ssh/rag_deploy_key -N "" -C "github-actions-deploy"
ssh-copy-id -i ~/.ssh/rag_deploy_key.pub root@服务器IP    # 这一步输一次服务器密码
```

> 也可以在服务器上手动执行：把 `~/.ssh/rag_deploy_key.pub` 的内容追加到服务器
> `~/.ssh/authorized_keys`。密码本身永远不进 GitHub。

### 2. 配置两个仓库的 Secrets（Settings → Secrets and variables → Actions）

Secrets（两个仓库都配，值相同）：

| 名称 | 值 |
|---|---|
| `DEPLOY_HOST` | ECS 公网 IP，如 `39.96.61.195` |
| `DEPLOY_USER` | SSH 用户名（如 `root`） |
| `DEPLOY_PORT` | SSH 端口，22 可以不配 |
| `DEPLOY_SSH_KEY` | `~/.ssh/rag_deploy_key`（私钥）文件**全部内容** |

Variables（注意在 **Variables** 标签页，不是 Secrets；两个仓库的名字不同）：

| 仓库 | 名称 | 值 |
|---|---|---|
| 用户端 RAG-AI-system | `VITE_ADMIN_ORIGIN` | `http://39.96.61.195:8081` |
| 管理端 RAG-admin | `VITE_USER_ORIGIN` | `http://39.96.61.195:8082` |

> 这两个值会编译进前端，用于两端互跳（SSO / 退出回跳），**端口不能漏**。
> 有域名后改成域名即可。

### 3. 服务器：nginx 站点配置

把本目录的 `nginx-rag.conf` 上传到服务器（用户端站点监听 **8082 + 8443(HTTPS)**，管理端 **8081**）：

```bash
scp deploy/nginx-rag.conf root@39.96.61.195:/etc/nginx/conf.d/rag.conf
ssh root@39.96.61.195 "nginx -t && systemctl reload nginx"
```

并在阿里云控制台 **安全组** 放行 **8081 / 8082 / 8443** 入方向（80/443 已被其他项目占用，不要动）。
Django 部署后其 `ALLOWED_HOSTS` / `CSRF_TRUSTED_ORIGINS` 需包含服务器 IP。

### 3.1 语音识别需要 HTTPS（自签证书）

浏览器只在不安全上下文以外的源开放麦克风（getUserMedia），所以录音功能必须走 HTTPS 入口
`https://39.96.61.195:8443`。证书为自签（无域名时 Let's Encrypt 不可用），浏览器首次访问会警告，
点「高级 → 继续前往」即可，同一浏览器信任一次后续不再提示。重新生成证书（10 年期，含 IP SAN）：

```bash
ssh root@39.96.61.195 'mkdir -p /etc/nginx/ssl && openssl req -x509 -nodes -newkey rsa:2048 \
  -days 3650 -keyout /etc/nginx/ssl/rag.key -out /etc/nginx/ssl/rag.crt \
  -subj "/CN=39.96.61.195" -addext "subjectAltName=IP:39.96.61.195" \
  && systemctl reload nginx'
```

> 换域名后：把证书换成正式签发（阿里云免费 DV 证书），nginx 里改证书路径并把
> `VITE_*_ORIGIN` 变量改成域名即可，无需改代码。

### 4. 触发

push 代码（或 Actions 页 `workflow_dispatch` 手动跑）后访问：

- 用户端：`http://39.96.61.195:8082`（日常）/ `https://39.96.61.195:8443`（**语音识别必须用这个**，自签证书需信任一次）
- 管理端：`http://39.96.61.195:8081`

## 日常使用

- **自动部署**：push 即部署，Actions 页可看每一步日志；构建或类型检查失败不会发布。
- **手动回滚**（服务器上执行）：
  ```bash
  cd /var/www && mv rag-user rag-user.bad && mv rag-user.old rag-user
  ```
- **修改部署分支**：编辑 `.github/workflows/deploy.yml` 里 `branches` 列表。
- **密钥泄漏处理**：删掉服务器 `authorized_keys` 里对应行 + GitHub Secret 里的私钥，重新生成即可。
