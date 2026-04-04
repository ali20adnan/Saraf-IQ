import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      rollupOptions: {
        external: [
          '@capacitor/core',
          '@capacitor/android',
          '@capacitor/ios',
          '@capacitor/haptics',
          '@capacitor/push-notifications',
          '@capacitor/status-bar',
          '@capacitor/cli',
        ],
      },
    },
  };
});
