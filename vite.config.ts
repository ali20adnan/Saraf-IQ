import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'path';
import type {Plugin} from 'vite';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

/**
 * يقلّل عمق سلسلة الطلبات الحرجة: CSS يُحمَّل مبكراً مع preload،
 * وحزمة App تُحمَّل بالتوازي مع الـ bootstrap (modulepreload).
 */
function criticalPathHints(): Plugin {
  return {
    name: 'saraf-critical-path-hints',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, {bundle}) {
        if (!bundle) return html;

        const cssMatch = html.match(/<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"[^>]*>/);
        if (!cssMatch) return html;
        const cssHref = cssMatch[1];

        let out = html.replace(/\s*<link rel="stylesheet"[^>]*href="[^"]+\.css"[^>]*>\s*/g, '');

        const cssBlock = `<link rel="preload" href="${cssHref}" as="style" crossorigin fetchpriority="high" />
    <link rel="stylesheet" crossorigin href="${cssHref}" />`;

        const logoPreload =
          /<link rel="preload" as="image" href="\/icons\/logo\.png" fetchpriority="high" \/>/;
        if (logoPreload.test(out)) {
          out = out.replace(logoPreload, (m) => `${m}\n    ${cssBlock}`);
        } else {
          out = out.replace(/(<script type="module")/, `${cssBlock}\n    $1`);
        }

        const appChunk = Object.keys(bundle).find((f) => /^assets\/App-[^/]+\.js$/.test(f));
        if (appChunk) {
          const appHref = `/${appChunk}`;
          if (!out.includes(`href="${appHref}"`)) {
            out = out.replace(
              /(<script type="module"[^>]*><\/script>)/,
              `$1\n    <link rel="modulepreload" crossorigin href="${appHref}" />`,
            );
          }
        }

        return out;
      },
    },
    /** بعد كل الإخراج (بما فيه حقن PWA) — تنسيق manifest و </head> */
    closeBundle() {
      const indexPath = path.join(process.cwd(), 'dist', 'index.html');
      if (!existsSync(indexPath)) return;
      let html = readFileSync(indexPath, 'utf8');
      html = html.replace(/"><link rel="manifest"/g, '">\n    <link rel="manifest"');
      html = html.replace(
        /<link rel="manifest" href="\/manifest\.webmanifest"><\/head>/,
        '<link rel="manifest" href="/manifest.webmanifest" />\n  </head>',
      );
      writeFileSync(indexPath, html, 'utf8');
    },
  };
}

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
            /** طلبات API من دومين آخر — لا تُخزَّن في SW لتفادي استجابات بلا CORS */
            {
              urlPattern: /^https:\/\/[^/]+\.up\.railway\.app\/api\//i,
              handler: 'NetworkOnly',
            },
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
      criticalPathHints(),
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
            if (id.includes('lucide-react')) return 'icons';
          },
        },
      },
    },
  };
});
