import { fileURLToPath, URL } from 'node:url'
import vue from '../web/node_modules/@vitejs/plugin-vue/dist/index.mjs'

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url))

// A separate entry, stylesheet and build output. The desktop source is read-only.
// Resolve both presentations to one Vue/Pinia instance, so shared business
// components keep their existing stores, permissions and assessment guards.
export default {
  plugins: [vue()],
  publicDir: path('../web/public'),
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/v1'),
  },
  resolve: {
    alias: {
      '@': path('../web/src'),
      vue: path('../web/node_modules/vue/dist/vue.runtime.esm-bundler.js'),
      pinia: path('../web/node_modules/pinia/dist/pinia.js'),
      'vue-router': path('../web/node_modules/vue-router/dist/vue-router.js'),
      '@lucide/vue': path('../web/node_modules/@lucide/vue/dist/esm/lucide-vue.mjs'),
    },
  },
  server: {
    fs: { allow: [path('../..')] },
    proxy: { '/api': { target: 'http://127.0.0.1:18000', changeOrigin: true } },
  },
  preview: {
    proxy: { '/api': { target: 'http://127.0.0.1:18000', changeOrigin: true } },
  },
}
