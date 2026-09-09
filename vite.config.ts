import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  /*
   * Base relativa. GitHub Pages sirve el proyecto en /<repo>/, no en la raiz,
   * y con './' los assets y el fetch de las capas resuelven contra la URL del
   * documento sea cual sea el nombre del repositorio. cargarGeojson ya compone
   * sus rutas con import.meta.env.BASE_URL.
   */
  base: './',
  plugins: [react(), tailwindcss()],
})
