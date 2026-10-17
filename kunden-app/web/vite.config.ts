import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,jpg,webp}'],
        // Dünen-Hintergründe gibt es in mehreren Größen: nicht alle vorab laden, sondern nur die passende (siehe sw.ts)
        globIgnores: ['**/*cyrillic*', '**/*greek*', '**/*vietnamese*', '**/*.woff', '**/icon-maskable-512.png', '**/wueste-*'],
      },
      manifest: {
        name: 'Perfume Cloud Club',
        short_name: 'PC Club',
        description: 'Treuepunkte sammeln, Prämien einlösen und Bestellungen verfolgen',
        lang: 'de',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F4EFE6',
        theme_color: '#F4EFE6',
        icons: [
          { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5174,
    proxy: { '/api': 'http://127.0.0.1:8094' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
