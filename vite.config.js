import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Semi UI re-exports its Lottie component from the package barrel. The
      // default player contains After Effects expression support implemented
      // with eval(), which is both unused here and rejected by the desktop CSP.
      'lottie-web': 'lottie-web/build/player/lottie_light.js',
    },
  },
})
