import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 固定端口：用户端 5173 / 管理端 5174（跨端跳转 URL 与 store 中的常量保持一致）
    port: 5173,
    // 内网穿透：ngrok 隧道指向本前端，/api 与 /media 由开发服务器代理到 Django(8080)，
    // 浏览器侧全部同源请求，避开 ngrok 免费版拦截页对 <img>/<audio> 等无法带自定义头的请求的影响
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },
      '/media': { target: 'http://127.0.0.1:8080', changeOrigin: true },
    },
    // Vite 会校验 Host 头，放行 ngrok 域名（否则通过隧道访问返回拒绝页）
    allowedHosts: ['.ngrok-free.dev'],
  },
  // vite preview（构建产物预览，ngrok 免费档限速约 40 请求/分钟，
  // 开发模式的模块图一次上百请求必超限，隧道必须指向打包后的 preview 服务）
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },
      '/media': { target: 'http://127.0.0.1:8080', changeOrigin: true },
    },
    allowedHosts: ['.ngrok-free.dev'],
  },
})
