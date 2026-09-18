import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  /*
   * Base en la raiz. Cloudflare sirve el sitio en la raiz de su dominio, y
   * las fuentes se piden con ruta absoluta (/fonts/...) desde index.css.
   * cargarGeojson compone sus rutas con import.meta.env.BASE_URL.
   */
  base: '/',
  plugins: [react(), tailwindcss()],

  /*
   * El worker de calculo importa geotiff, que carga sus decodificadores con
   * import() dinamico, y pako. En desarrollo Vite los descubria a media
   * sesion y el worker podia terminar con copias distintas: el descompresor
   * fallaba con "buffer error" solo en `npm run dev`, nunca en el build.
   * Pre-empaquetarlos desde el arranque deja una sola copia para todos.
   */
  optimizeDeps: {
    include: ['geotiff', 'pako', 'proj4'],
  },
  worker: {
    format: 'es',
  },
})
