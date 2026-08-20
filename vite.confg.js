import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // WAJIB relative path agar aset termuat benar di WebView Capacitor
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    host: true
  }
});
