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
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        // Nur die lateinischen Schriftschnitte vorab laden; Sonderzeichen (latin-ext) kommen bei Bedarf
        globIgnores: ['**/*cyrillic*', '**/*greek*', '**/*vietnamese*', '**/*latin-ext*', '**/*.woff'],
      },
      manifest: {
        id: '/',
        name: 'Perfume Cloud Team',
        short_name: 'PC Team',
        description: 'Planung, Statistiken und Postfach für das Perfume-Cloud-Team',
        lang: 'de',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F6F2EB',
        theme_color: '#F6F2EB',
        icons: [
          { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        categories: ['business', 'productivity'],
        // App-Icon erneut anklicken holt das offene Fenster nach vorn statt ein zweites zu öffnen
        launch_handler: { client_mode: ['focus-existing', 'auto'] },
        // Rechtsklick aufs Icon (Windows, Mac, Android)
        shortcuts: [
          { name: 'Postfach', url: '/postfach', icons: [{ src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Versand', url: '/versand', icons: [{ src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Planung', url: '/planung', icons: [{ src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Kalender', url: '/kalender', icons: [{ src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Idee festhalten', url: '/ideen', icons: [{ src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' }] },
        ],
        // Bilder für den Installieren-Dialog von Edge und Chrome
        screenshots: [
          { src: '/brand/screen-wide.jpg', sizes: '1280x800', type: 'image/jpeg', form_factor: 'wide', label: 'Kalender am Computer' },
          { src: '/brand/screen-narrow.jpg', sizes: '780x1688', type: 'image/jpeg', form_factor: 'narrow', label: 'Kalender auf dem Handy' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
  },
});
