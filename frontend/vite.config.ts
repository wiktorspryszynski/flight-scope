import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  envDir: '..', // load .env from project root
  server: {
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
})
