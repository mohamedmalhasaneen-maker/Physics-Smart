import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'prompt',
        injectRegister: false,
        manifest: {
          id: '/',
          name: 'Physics Smart | منصة الفيزياء الذكية',
          short_name: 'PhysicsSmart',
          description:
            'منصة فيزياء تعليمية تفاعلية تعمل دون اتصال بالإنترنت — دروس، معمل افتراضي، بنك أسئلة، امتحانات، ورسوم بيانية.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'any',
          theme_color: '#060B18',
          background_color: '#060B18',
          dir: 'rtl',
          lang: 'ar',
          categories: ['education', 'science'],
          icons: [
            {
              src: '/assets/aistudio/__________________________425160ec.png',
              sizes: '1254x1254',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/assets/aistudio/__________________________425160ec.png',
              sizes: '1254x1254',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,ttf,jpg,jpeg,webp,webmanifest}'],
          globIgnores: [
            '**/Physics-Ar-EB-part1*.pdf',
            '**/KaTeX_*.ttf',
            '**/KaTeX_*.woff',
            'icon.svg',
            'favicon.png',
            'apple-touch-icon.png',
            'pwa-*.png',
          ],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
        devOptions: {
          enabled: true,
          type: 'module',
          navigateFallback: '/index.html',
        },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('/react-dom/') || id.includes('/react/')) return 'vendor-react';
            if (id.includes('/firebase/') || id.includes('/@firebase/')) return 'vendor-firebase';
            if (id.includes('/katex/') || id.includes('/mathjs/')) return 'vendor-math';
            if (id.includes('/recharts/') || id.includes('/d3-')) return 'vendor-charts';
            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
