import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2020', // Support BigInt and modern features
    rollupOptions: {
      input: {
        main: 'index.html',
        splash: 'splash.html'
      },
      output: {
        manualChunks: {
          'reown': ['@reown/appkit', '@reown/appkit-adapter-ethers'],
          'ethers': ['ethers'],
          'vendor': ['canvas-confetti', '@farcaster/miniapp-sdk']
        }
      }
    }
  },
  server: {
    port: 3000,
    open: true
  },
  publicDir: 'public',
  esbuild: {
    target: 'es2020' // Ensure esbuild also targets ES2020
  }
});
