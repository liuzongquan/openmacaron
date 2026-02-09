import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      proxy: {
        // 开发环境代理：将 /api 请求转发到 Sanic 后端
        '/api': {
          target: 'http://0.0.0.0:3001',
          changeOrigin: true,
          // rewrite: (path) => path.replace(/^\/api/, '')
        }
      }
    },
    // 🟢 生产环境预览配置 (npm run preview)
    preview: {
      host: true,
      port: 4173,        // 指定端口
      strictPort: true,  // 如果端口被占用，直接退出而不是尝试下一个可用端口
      open: false,         // 启动后自动打开浏览器
      cors: true
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve('.'),
      }
    }
  };
});