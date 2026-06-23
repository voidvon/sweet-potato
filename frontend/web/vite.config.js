import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import path from 'path'
// https://vitejs.dev/config/
export default defineConfig(() => {
  const base = process.env.VITE_ASSET_BASE || './'
  const devPort = Number(process.env.FRONTEND_PORT || 9527)

  return {
    plugins: [
      react(),
    ],
    base,
    server: {
      host: '0.0.0.0',
      port: devPort,
      strictPort: true,
    },
    publicDir: 'public',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      assetsInlineLimit: 4096,
      cssCodeSplit: true,
      sourcemap: false,
    },
  }
})
