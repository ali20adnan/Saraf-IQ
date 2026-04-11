import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: ['icons/**/*.png'],
        manifest: {
          name: 'Saraf IQ',
          short_name: 'Saraf',
          description: 'صراف — تطبيق الصرافة',
          theme_color: '#F8FAFC',
          background_color: '#F8FAFC',
          display: 'standalone',
          start_url: '/',
          icons: [
            {src: '/icons/logo.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable'},
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webp}'],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api\//, /\.apk$/i, /^\/robots\.txt$/, /^\/sitemap\.xml$/],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-stylesheets',
                expiration: {maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 365},
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-webfonts',
                expiration: {maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365},
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (id.includes('react-dom')) return 'react-dom';
            if (id.includes('react/') || id.endsWith('react/index.js')) return 'react';
            if (id.includes('motion')) return 'motion';
            if (id.includes('@supabase')) return 'supabase';
            if (id.includes('lucide-react')) return 'icons';
          },
        },
      },
    },
  };
});
