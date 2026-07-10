import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vitejs.dev/config/
export default defineConfig(() => {
  const base = process.env.VITE_ASSET_BASE || './'
  const devPort = Number(process.env.FRONTEND_PORT || 9527)
  const adminDevPort = Number(process.env.FRONTEND_ADMIN_PORT || process.env.ADMIN_FRONTEND_PORT || 9528)

  return {
    plugins: [
      react(),
      {
        name: 'admin-trailing-slash',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === '/admin' || req.url?.startsWith('/admin?')) {
              res.statusCode = 302
              res.setHeader('Location', `/admin/${req.url.slice('/admin'.length)}`)
              res.end()
              return
            }
            next()
          })
        },
      },
    ],
    base,
    server: {
      host: '0.0.0.0',
      port: devPort,
      strictPort: true,
      proxy: {
        '/admin': {
          target: `http://127.0.0.1:${adminDevPort}`,
          changeOrigin: true,
          ws: true,
        },
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
        react: path.resolve(__dirname, '../node_modules/react'),
        'react-dom': path.resolve(__dirname, '../node_modules/react-dom'),
        'react/jsx-runtime': path.resolve(__dirname, '../node_modules/react/jsx-runtime.js'),
        '@': path.resolve(__dirname, 'src'),
        '@shared': path.resolve(__dirname, '../src/shared'),
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
