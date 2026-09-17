import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  /*
   * Base en la raiz. Cloudflare Pages sirve el sitio en la raiz de su dominio,
   * y las fuentes se piden con ruta absoluta (/fonts/...) desde index.css.
   * cargarGeojson compone sus rutas con import.meta.env.BASE_URL.
   */
  base: '/',
  plugins: [react(), tailwindcss()],
})
