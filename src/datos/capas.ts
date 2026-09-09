import type { Capa } from '../tipos'

/**
 * Las cinco capas vienen de PLANEACION INTEGRAL/extracted/public, que es la
 * copia en WGS84. La copia de extracted/shapefiles esta en EPSG:32614 y no
 * sirve ni para Leaflet ni para STAC.
 */
const PUBLICAS: Capa[] = [
  {
    id: 'LIMITE',
    etiqueta: 'Limite municipal',
    archivo: 'capas/LIMITE.geojson',
    color: '#f2c744',
    tipo: 'poligono',
    esAreaInteres: true,
    visiblePorDefecto: true,
    publica: true,
  },
  {
    id: 'LIMITE_URBANO',
    etiqueta: 'Limite urbano',
    archivo: 'capas/LIMITE_URBANO.geojson',
    color: '#ff7a45',
    tipo: 'poligono',
    esAreaInteres: true,
    visiblePorDefecto: true,
    publica: true,
  },
  {
    id: 'CUENCA_PALOTE',
    etiqueta: 'Cuenca Palote',
    archivo: 'capas/CUENCA_PALOTE.geojson',
    color: '#43d1c4',
    tipo: 'poligono',
    esAreaInteres: true,
    visiblePorDefecto: true,
    publica: true,
  },
]

/**
 * Capas internas, en un arreglo aparte y no en una bandera dentro del mismo.
 *
 * La diferencia no es de estilo. Si el filtro fuera en tiempo de ejecucion,
 * los nombres y las rutas de estas capas viajarian igual dentro del bundle,
 * aunque sus archivos no se sirvieran. Separadas, y con INCLUIR_INTERNAS
 * resuelto en tiempo de compilacion, el build publico las elimina del todo.
 */
const INTERNAS: Capa[] = [
  {
    id: 'EMA',
    etiqueta: 'Estaciones EMA',
    archivo: 'capas/EMA.geojson',
    color: '#ffffff',
    tipo: 'punto',
    esAreaInteres: false,
    visiblePorDefecto: false,
    // Ubicaciones de instrumentacion de SAPAL. No hacen falta para analizar
    // una escena, asi que no viajan a un sitio publico.
    publica: false,
  },
  {
    id: 'SENSORES_ARROYOS',
    etiqueta: 'Sensores en arroyos',
    archivo: 'capas/SENSORES_ARROYOS.geojson',
    color: '#7ab8ff',
    tipo: 'punto',
    esAreaInteres: false,
    visiblePorDefecto: false,
    publica: false,
  },
]

/**
 * Las capas internas se excluyen salvo que se pidan a proposito.
 *
 * El sentido de la bandera importa: si el valor por defecto fuera incluirlas,
 * bastaria olvidar una variable de entorno para publicarlas. Asi, el olvido
 * lleva al lado seguro, y el despliegue completo exige decirlo.
 *
 * En desarrollo se activan desde .env.development, para que la herramienta
 * local siga teniendo todo.
 */
const INCLUIR_INTERNAS = import.meta.env.VITE_CAPAS_INTERNAS === 'true'

export const CAPAS: Capa[] = INCLUIR_INTERNAS ? [...PUBLICAS, ...INTERNAS] : PUBLICAS

export const CAPAS_AREA = CAPAS.filter((c) => c.esAreaInteres)
