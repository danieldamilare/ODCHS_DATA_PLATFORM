import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite' // This maps the missing reference variable!

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        react(),
        tailwindcss() // Mounted safely into your compilation loop
    ],
    server: {
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:5000',
                changeOrigin: true,
                secure: false,
                ws: true,
            }
        }
    },
    optimizeDeps: {
        // This stops Vite and Rolldown from crawling into Tailwind's Rust binary extensions
        exclude: [
            '@tailwindcss/oxide',
            '@tailwindcss/oxide-linux-x64-gnu',
            '@tailwindcss/oxide-linux-x64-musl'
        ]
    }
})
