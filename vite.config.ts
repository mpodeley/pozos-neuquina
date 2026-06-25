import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' so the built site works under the GitHub Pages subpath
// (https://<user>.github.io/pozos-neuquina/).
export default defineConfig({
  plugins: [react()],
  base: './',
})
