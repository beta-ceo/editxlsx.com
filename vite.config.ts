import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

export default defineConfig({
  base: '/document',
  plugins: [
    {
      name: 'gzip-headers',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.includes('.gz')) {
            res.setHeader('Content-Encoding', 'gzip');
            res.setHeader('Content-Type', 'application/wasm');
          }
          next();
        });
      },
    },
  ],
  publicDir: 'public',
  resolve: {
    alias: {
      '@/lib': resolve(__dirname, '/lib'),
      '@/store': resolve(__dirname, '/store'),
      '@/assets': resolve(__dirname, '/assets'),
      '@/types': resolve(__dirname, '/types'),
      '@/styles': resolve(__dirname, '/styles'),
    },
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json'],
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@import "@/styles/base.css";`,
      },
    },
  },
});
