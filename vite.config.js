import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11']
    })
  ],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
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
  resolve: {
    alias: {
      // Fix for some ESM issues
      'node-fetch': 'node-fetch'
    }
  }
});
