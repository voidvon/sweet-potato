import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ command }) => {
  const isBuild = command === 'build';
  const base = process.env.VITE_ADMIN_ASSET_BASE || (isBuild ? '/admin/' : './');
  const routerBasename = process.env.VITE_ADMIN_ROUTER_BASENAME ?? (isBuild ? '/admin' : '');
  const devPort = Number(process.env.ADMIN_FRONTEND_PORT || process.env.FRONTEND_PORT || 9528);

  return {
    plugins: [
      react(),
    ],
    base,
    define: {
      'import.meta.env.VITE_ROUTER_BASENAME': JSON.stringify(routerBasename),
    },
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
  };
});
