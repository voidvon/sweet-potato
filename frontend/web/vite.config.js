import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { versionAssetPlugin } from '../scripts/version-asset-plugin.mjs'

import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vitejs.dev/config/
export default defineConfig(() => {
  const base = process.env.VITE_ASSET_BASE || '/'
  const devPort = Number(process.env.FRONTEND_PORT || 9527)

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
        react: path.resolve(__dirname, '../node_modules/react'),
        'react-dom': path.resolve(__dirname, '../node_modules/react-dom'),
        'react/jsx-runtime': path.resolve(__dirname, '../node_modules/react/jsx-runtime.js'),
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
    },
  }
})
