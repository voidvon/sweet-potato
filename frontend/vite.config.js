import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { versionAssetPlugin } from './scripts/version-asset-plugin.mjs'

import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vitejs.dev/config/
export default defineConfig(() => {
  const base = process.env.VITE_ASSET_BASE || '/'
  const devPort = Number(process.env.FRONTEND_PORT || 9527)
  const backendProxyTarget = process.env.BACKEND_PROXY_TARGET || `http://127.0.0.1:${process.env.BACKEND_PORT || process.env.PORT || 7072}`

  return {
    plugins: [
      react(),
      versionAssetPlugin(),
    ],
    base,
    server: {
      host: '0.0.0.0',
      port: devPort,
      strictPort: true,
      proxy: {
        // Preserve the browser-facing host so the backend's origin guard can
        // recognize LAN access to the Vite server as same-origin traffic.
        // WebSocket chat turns share the /api namespace; explicitly enable
        // Upgrade forwarding or Vite will leave the browser handshake pending.
        '/api': { target: backendProxyTarget, changeOrigin: false, ws: true },
        '/files': { target: backendProxyTarget, changeOrigin: false },
      },
    },
    publicDir: 'public',
    resolve: {
      dedupe: [
        'react',
        'react-dom',
        'react-router',
        'react-router-dom',
      ],
      alias: {
        react: path.resolve(__dirname, 'node_modules/react'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
        'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
        '@': path.resolve(__dirname, 'src'),
        '@shared': path.resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      assetsInlineLimit: 4096,
      cssCodeSplit: true,
      sourcemap: false,
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router', 'react-router-dom'],
            'vendor-antd': ['antd', '@ant-design/icons'],
            'vendor-grid': ['ag-grid-community', 'ag-grid-react'],
            'vendor-editor': ['@tiptap/core', '@tiptap/react', '@tiptap/starter-kit', '@tiptap/extension-mention', '@tiptap/extension-placeholder', '@tiptap/suggestion'],
          },
        },
      },
    },
  }
})
