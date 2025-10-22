import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

const certDir = path.resolve(__dirname, 'certs')

// mkcert -install
// mkcert ip localhost
// copy ip+1*.pem

const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || 'http://127.0.0.1:8000'
const apiUrl = new URL(BACKEND_ORIGIN)
const wsTarget = `${apiUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${apiUrl.host}`

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    https: {
      key: fs.readFileSync(path.join(certDir, 'local-key.pem')),
      cert: fs.readFileSync(path.join(certDir, 'local-cert.pem')),
    },
    proxy: {
      '/api': {
        target: BACKEND_ORIGIN,         
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      '/ws': {
        target: wsTarget,               
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
