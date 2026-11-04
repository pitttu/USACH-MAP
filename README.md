# USACH-MAP

> Mapa 3D del campus de la Universidad de Santiago de Chile: salas, servicios, rutas a pie por los caminos internos
> y el horario de clases de cada alumno sobre el mapa.

**Abrir:** https://pitttu.github.io/USACH-MAP

- **Campus en 3D** con motor propio (Three.js): edificios, árboles, luz y sombras, nombres de calles y capa opcional
  de fotogrametría.
- **Interfaz al estilo de Google Maps**: búsqueda de salas y lugares, categorías ordenadas por cercanía (baños, agua,
  comida, impresiones...), edificios con sus salas por piso, guardados y recientes.
- **Rutas a pie** por una red propia de caminos internos del campus, que los mapas comerciales no tienen.
- **Tú**: el horario de clases importado desde SIAC, la próxima clase y cuánto se camina entre una sala y otra.
- Web estática, gratuita y sin instalar nada (GitHub Pages). La importación de SIAC pasa por un Cloudflare Worker
  (`siac-worker/`).
- Datos: OpenStreetMap, levantamiento propio de salas y servicios, y modelos 3D con licencia del autor.

## Correr

Desde la raíz del repositorio:

```bash
python3 -m http.server 8765
# abrir http://localhost:8765/
```

`?q=low` fuerza calidad baja (sin antialias, pixel ratio 1, sombras 1024). `?dev` muestra el panel de hora/clima y parte con hora y clima reales (normalmente se activan con el interruptor "Hora y clima").

## Qué hay

La interfaz es propia, al estilo de Google Maps 2025 (ver *Interfaz*). El mapa es el motor 3D.

| Archivo | Qué hace |
|---|---|
| `js/app.js` | **Interfaz**: vistas de la hoja y navegación entre ellas, buscador, pastillas, botones del mapa, inicio, lugar, ruta, categorías, edificios, elegir en el mapa, GPS (con ubicación manual), capas, clima del título, enlaces compartidos. Solo habla con `mapView`. |
| `js/sheet.js` | **Hoja deslizable**: una sola hoja con vistas, tres alturas, título fijo por vista y el arrastre (ver *Interfaz*) |
| `js/search.js` | **Búsqueda** a pantalla completa y **planificador de rutas** (partida → destino) |
| `js/places.js` | **Lugares**: catálogo de categorías, cómo se muestra cada lugar, búsqueda, edificios con sus salas, guardados, recientes y distancias a pie |
| `js/tu.js` | **Vista "Tú"** (beta): horario importado desde SIAC, próxima clase, traslados entre salas, guardados y recientes. Ver *Pestaña Tú* |
| `js/ui.js` | Utilidades de la interfaz: crear elementos, íconos, avisos (snackbar), formatos |
| `js/mapview.js` | **Motor**: escena, luz, sombras, cámara, etiquetas y marcadores. Exporta `mapView`, una API en lon/lat estilo Mapbox: `flyTo`, `jumpTo`, `resetNorth`, `setRoute`, `setPin`, `setUserLocation`, `setSelected`, `showCategory`, `addPOIs`, `addCategoryMarkers`, `setSectors`, `setBaseLayer` y los eventos `tap`, `longpress`, `move`. |
| `js/devpanel.js` | Panel `?dev`: hora, clima y FPS |
| `ui.css` | Estilos de la interfaz (colores, tipografía, buscador, pastillas, hoja y vistas, búsqueda, barra inferior, capas, avisos) |
| `style.css` | Solo lo propio del 3D: etiquetas y marcadores del mapa, panel dev |
| `assets/campus.glb` | Geometría (generada desde `campus-editable.glb`) |
| `assets/data/` | Datos del campus (GeoJSON): salas, caminos (`paths.json`, el grafo de las rutas), sectores, entradas, baños, agua, impresiones, cajeros, metro y puntos de interés |
| `assets/icons/`, `assets/svg/` | Íconos de las etiquetas del mapa (spritesheets), el pin de selección y los íconos de las pastillas clásicas |
| `assets/fotogrametria.glb` | Capa de fotogrametría (se descarga solo al elegirla). Ver *Capa de fotogrametría* |
| `assets/capa-*.jpg` | Miniaturas de la hoja de capas (288 px): Planetario, FAE y DMCC al fondo. Cámara `jumpTo({ center: [-70.6812, -33.44935], zoom: 16.1, pitch: 45, bearing: -55 })` en un viewport de 390×390 a 2×, solo el canvas, recortando el cuadrado de 700 px de arriba a la izquierda (así queda fuera el borde oriente de la fotogrametría) |
| `assets/streets.json` | Nombres de calles (OSM), generado con `tools/build-streets.mjs` |
| `js/geo.js` | lon/lat ⇄ metros locales, equivalencia zoom Mapbox ⇄ distancia |
| `js/sun.js` | Posición del sol y modelo de luz |
| `js/controls.js` | Gestos de cámara estilo Mapbox + `flyTo` |
| `js/labels.js` | Etiquetas de POIs (íconos y textos en capas separadas, fundido por colisión), nombres de calles, marcadores por categoría, pin y ubicación del usuario |
| `js/routing.js` | Dijkstra sobre `paths.json`; índice de nodos y distancias desde un punto a todo el campus (para "Cerca de ti") |
| `js/weather.js` | Clima real (Open-Meteo), con lluvia y transiciones |
| `js/cache.js` | Guarda el mapa y la fotogrametría en el navegador, con versión (ver *Archivos guardados en el navegador*) |

## Interfaz (estilo Google Maps 2025)

**Aspecto.** Colores medidos en capturas de Google Maps (Android, 2025), como variables en `ui.css`: turquesa
`#007b8b` (botones principales, "Cómo llegar"), píldora activa `#c0eaf4`, barra inferior `#eff5f6`, divisores
`#dadce0`, bandas entre secciones `#f1f3f4`, texto `#1f1f1f` / `#5e5e5e`. Tipografía **Google Sans Flex** (Google
Fonts, licencia OFL); las etiquetas del mapa y las pastillas usan Inter. Íconos **Material Symbols
Rounded** (los de Google Maps) desde Google Fonts, pidiendo solo los que se usan (`icon_names` en el `<link>` de
`index.html`, en orden alfabético). Si usas un ícono nuevo, agrégalo ahí; `node tools/check-icons.mjs` revisa que no
falte ninguno (si falta, se ve su nombre en texto).

**Parte superior clásica o nueva.** El buscador, las pastillas, la brújula y las capas pueden verse como en la app
original (vidrio esmerilado, Inter, íconos SVG propios en las pastillas) o al estilo Google Maps. Por ahora
parte la **clásica**; `?top=nuevo` en la URL muestra la nueva (y `?top=clasico` la clásica). Para fijar una, cambia
`TOP_CLASICO` al comienzo de `js/app.js`. La clásica es la clase `top-clasico` en `<html>` (estilos en `ui.css`, sección
*parte superior clásica*); cada botón trae ambos íconos (`.solo-nuevo` / `.solo-clasico`). Lo demás no cambia. El buscador de la clásica es una mezcla, a pedido: forma, íconos (micrófono y avatar; sin el pin naranjo) y posición de la nueva,
con el vidrio esmerilado y el texto de la clásica. La brújula y las capas también: posición e íconos de la nueva (capas arriba), con el tamaño (el alto de las pastillas) y el vidrio de la clásica.

**Pantalla (nueva).** Buscador blanco arriba (abre la búsqueda; micrófono si el navegador permite dictar; el avatar abre Tú y
muestra las iniciales del alumno), pastillas de categorías, capas y brújula a la derecha, y sobre la hoja los botones
de ubicación (blanco; azul cuando sigue el GPS) y **Cómo llegar** (turquesa: ruta al lugar abierto o el
planificador). Abajo, la barra **Explorar / Tú**.

**Hoja deslizable** (`sheet.js`). Es una sola y cambia de vista; se arrastra entre **reposo** (asoma solo el título de
la vista), **media altura** (44 % de la pantalla, como Google Maps) y **arriba**.

- Cada vista es un `<section class="sheet-view">` con un **título fijo** (`.sheet-header`, lo que se ve en reposo) y
  un **cuerpo** (`.sheet-body`) que se desplaza solo con la hoja arriba. Al bajar la hoja el cuerpo vuelve al inicio,
  así en reposo el título queda siempre limpio. Con el cuerpo desplazado, una línea separa el título.
- Se toma desde cualquier parte, también desde un botón (si el dedo se mueve, es arrastre y no se toca el botón). Con
  la hoja arriba el dedo desplaza el cuerpo; si llega al inicio y sigue bajando, el mismo gesto baja la hoja. Un gesto
  horizontal (carruseles) no la mueve. Al soltar va a la altura más cercana; un gesto rápido salta a la siguiente.
- Tocar el título en reposo la sube a media altura. Con mouse se arrastra desde la manija o el título.
- Con algo seleccionado (un lugar abierto o un edificio elegido) el mapa sigue a la hoja (`syncPadding` en `app.js`,
  `mapView.setPadding`): lo seleccionado queda al centro de la pantalla con la hoja en reposo y al medio del espacio
  sobre la hoja a media altura; entre ambas se interpola cuadro a cuadro, también al arrastrar. Más arriba se queda
  como a media altura. Sin nada seleccionado (inicio, Tú, listas, rutas), mover la hoja no mueve el mapa; al abrir o
  cerrar un lugar el ajuste entra o sale con una transición.
  `setPadding` corre el centro óptico de la cámara (`camera.setViewOffset`), no la cámara: picking, etiquetas y ruta
  siguen calzando.
- La página nunca se desplaza (un foco o `scrollIntoView` del navegador descuadraría mapa y hoja): `sheet.js` la
  devuelve a 0.

**Vistas** (`app.js`). Explorar: **inicio** (fecha, saludo, clima real y la próxima clase en el título; en el cuerpo
"Cerca de ti", "Explora por categoría" y "Edificios y salas"), **lugar**, **ruta**, **categoría**, **edificio** y
**elegir en el mapa**; y **Tú**. La X de cada vista vuelve a la anterior (pila `stack`): un lugar abierto desde una
lista vuelve a la lista; una ruta abierta desde un lugar, al lugar. Al pasar a Tú se guarda Explorar tal como estaba y
se retoma al volver. Lo que muestra el mapa (pin, línea de la ruta, marcadores de la categoría) sale de la vista
actual (`syncMap`). Tocar el mapa baja la hoja en el inicio, Tú, categorías y edificios; un lugar o una ruta abiertos
no se cierran (se cierran con la X).

- **Lugar**: nombre y tipo (y minutos a pie si hay ubicación); botones **Cómo llegar**, **Guardar** (queda en Tú) y
  **Compartir** (enlace `?lugar=EAO514`, o `?punto=lon,lat` para puntos y lugares sin nombre propio; con el menú de
  compartir del teléfono o copiado); datos de la sala (edificio, piso, capacidad) y **tus clases en esa sala**.
- **Ruta**: minutos, metros y hora de llegada; tarjeta Desde / Hasta (tocar uno abre el planificador para cambiarlo) e
  intercambio. La cámara encuadra la ruta en el mapa que queda libre entre las pastillas y la hoja.
- **Categoría**: los lugares de una pastilla o de la grilla de categorías, **los más cercanos primero** si hay
  ubicación (a pie por los caminos del campus). Los lugares con nombre repetido en los datos ("Baño Público",
  "Dispensador de Agua", "Impresiones y Fotocopias") se muestran con el lugar con nombre más cercano ("Cerca de
  Biblioteca Central").
- **Edificio**: sus salas por piso. Las salas se agrupan por edificio; las que en los datos no tienen ("Sin definir"),
  por el prefijo de su código (FDE, MIN...), con el nombre del edificio de ese prefijo si alguna sala lo tiene.
- **Elegir en el mapa**: tu ubicación si no hay GPS (o estás fuera del campus), o un extremo de la ruta.

**Búsqueda** (`search.js`, página completa): atajos (la próxima clase, Metro, Biblioteca Central, Casino Central),
recientes (se pueden quitar uno a uno o todos) y, al escribir, categorías sugeridas ("baño", "comida"...) y lugares,
con lo escrito resaltado y la distancia si hay ubicación. Enter elige el primero. En modo ruta, dos campos (partida y
destino) con "Tu ubicación" y "Elegir en el mapa". El botón atrás del teléfono la cierra.

**Cerca de ti**: una sola pasada de Dijkstra desde el nodo del grafo más cercano al usuario da la distancia a todos los
lugares (`places.walk`); con el GPS andando, las listas se rehacen solo si se movió más de 15 m.

**Clima del título**: el de ahora en el campus (Open-Meteo, cada 15 min). No cambia la escena, que sigue fija en
despejado a las 9:55 salvo con "Hora y clima".

**Guardados y recientes**: en el navegador (`localStorage`: `usach-map.guardados` y `usach_map_history`, la misma
clave del historial de antes), en Tú y en la búsqueda.

Prueba de los flujos: `CHROME=... node tools/ui-test.mjs <carpeta> [url]` (tamaño celular, con gestos táctiles).

## Editar la geometría

La fuente es **`USACH - SELFHOST/campus-editable.glb`** (fuera del repo). Se edita en Blender y se convierte para la web:

1. Blender → *File › Import › glTF 2.0* → `campus-editable.glb`
2. Editar (mover, borrar o agregar edificios, calles, árboles…)
3. *File › Export › glTF 2.0* → sobrescribir `campus-editable.glb` (formato `.glb`)
4. `cd tools && node build-glb.mjs` → genera `assets/campus.glb` (~0,75 MB)

**Lo que importa es el nombre del material**, no la colección ni el nombre del objeto:

| Material | Capa en la web |
|---|---|
| `edificio` | edificios (con sombras) |
| `suelo` | suelo base |
| `terreno_campus`, `pasto`, `pasto_claro`, `pasto_oscuro`, `pavimento`, `zona_salud`, `agua` | áreas del suelo |
| `calle`, `calle_borde`, `pasaje`, `pasaje_borde`, `pasto_linea` | calles |
| `arbol`, `arbol_oscuro`, `tronco` | árboles |
| `vidrio` | vidrios (celeste, esquiva parte del tinte cálido: `GLASS_UNWARM` en `mapview.js`) |
| `luz_*`, `luz_poste*` | luces: conos de puertas y ampolletas (las del modelo comprado se detectan solas) |
| cualquier otro | modelo de detalle: conserva su color (p. ej. el planetario) |

- Para un edificio nuevo: modelarlo y asignarle el material `edificio`. Los sufijos de Blender (`edificio.001`) se ignoran.
- Las capas del suelo se pintan en el orden de `LAYER_OF` en `tools/build-glb.mjs` (lo de abajo en la lista queda encima). Deben quedar a nivel 0.
- `terreno_campus` va primero, debajo de todo lo demás del suelo: los pastos, canchas y plazas del campus (de OSM) quedan a la vista encima del terreno, como en Google/Apple Maps. Antes iba sobre los pastos y los tapaba; el usuario pidió verlos.
- Solo se usa el color base del material (sin texturas).
- **Calles con curvas:** al convertir, `build-glb.mjs` redondea la forma de `calle`, `calle_borde`, `pasaje` y `pasaje_borde` (`tools/round-roads.mjs`). Las esquinas de los cruces quedan con radio de 4 m en calles y 2 m en pasajes, y los fondos de las calles sin salida y las puntas quedan curvos. En Blender las calles siguen con sus ángulos originales: el redondeo se aplica solo al exportar, también a las calles nuevas que dibujes. Los radios están en `ROUND` (`build-glb.mjs`); `NO_ROUND=1 node build-glb.mjs` genera sin curvas, para comparar.

- **Identificador de cada edificio:** el nombre del objeto en Blender (`Facultad de Derecho`, `Edificio 213`, `Modelo 066`...). El build lo lleva al glb como atributo `_ID` (índice en `scene.extras.ids`) para edificios y modelos; la web lo usa al tocar (`tap` trae `object: { id, name, layer }`, `mapView.highlightObject(id)` lo resalta). Con `?dev`, tocar un edificio muestra su nombre.

Guía para pedir cambios de geometría a Claude (scripts de Blender por nombre de objeto): `USACH - SELFHOST/CLAUDE.md`.

`tools/make-editable.mjs` generó el editable a partir del export original (`Usach-selfhost.glb`): georreferencia, limpieza, recorte por Alameda / Autopista Central / Portales / Matucana y unión Matucana–Portales. **No volver a correrlo**: sobrescribiría las ediciones.

## Pestaña Tú (horario de clases, beta)

Tú es una vista de la hoja (ver *Interfaz*). Su título es "Tú" y el perfil del alumno (lo que asoma en reposo); el
cuerpo tiene el horario, los **guardados** y los **recientes**. El botón redondo del título vuelve a importar.

En Tú el alumno importa su horario desde SIAC con su RUT y su clave, y la app lo cruza con las salas de
`assets/data/salas.json`:

- **Próxima clase** (o la que está en curso): sala, hora, edificio y botones *Cómo llegar* / *Ver sala*. En clase, el
  botón principal es la ruta a la sala de la clase siguiente. La misma tarjeta, compacta, asoma en la hoja de Explorar
  (la hoja en reposo crece para mostrarla entera).
- **Día por día**: las clases (los bloques seguidos del mismo curso en la misma sala se unen) y, entre dos clases,
  el **traslado**: minutos a pie y metros por el grafo de `paths.json` (4 km/h, igual que la ficha de ruta), contra
  la ventana (tiempo libre entre ambas). Verde si sobra tiempo, ámbar si queda menos de 5 min ("Justo"), rojo si no alcanza. Tocar un
  traslado dibuja la ruta de sala a sala; tocar una clase muestra su sala.
- *Probar con un horario de ejemplo*: un horario ficticio con salas reales, para probar sin cuenta.
- `window.__tuNow = { dia: 2, min: 630 }` (martes 10:30) fija la hora, para capturas.

**Importar.** El navegador no puede hablar con SIAC (otro dominio, sin CORS), así que la app manda `{ rut, clave }`
a un servicio que lo hace por ella:

- **App publicada (GitHub Pages):** el Cloudflare Worker de `siac-worker/` (ver su README). Su dirección va en
  `SIAC_WORKER`, al comienzo de `js/tu.js`. Mientras esté vacía, la app avisa que la importación web no está activa.
- **Servidor local:** `POST /api/siac/horario` en `tools/serve-https.py`, que usa `tools/siac.py`.

Los dos hacen lo mismo:

1. Abre el login de SIAC, toma su token `cu` y envía el formulario como lo hace la página (RUT sin dígito, dígito
   aparte, clave en `passwd`; SIAC corta la clave a 9 caracteres).
2. Lee `app/estudiante/horario-clases.action` y lo parsea: la lista de cursos de la versión escritorio
   (`[código] NOMBRE`, docentes y líneas `TEORIA: L2 (EAO514) - …`; L M W J V S = lunes a sábado, el número es el
   bloque) y las horas de cada bloque desde la grilla.
3. Cierra la sesión y responde `{ alumno, carrera, periodo, cursos: [{ codigo, nombre, docentes }],
   clases: [{ curso, tipo, dia, bloque, inicio, fin, sala, docentes }] }`. Errores: `{ error }` con 400, 401, 423,
   429 (más de 5 intentos por minuto por IP) o 502.

La clave no se guarda ni queda en el log; en el navegador queda solo el horario y el RUT (`localStorage`,
`usach-map.horario`). Por `python3 -m http.server` (8765) la importación no funciona y la app lo dice; el horario de
ejemplo sí. Si SIAC cambia su página, hay que corregir `tools/siac.py` y `siac-worker/src/index.js` (leen igual).

Probar el parser sin la app: `python3 tools/siac.py horario.html` (una página guardada) o, contra SIAC,
`read -s P; RUT=12345678-9 P=$P python3 tools/siac.py`.

## Archivos guardados en el navegador (con versión)

El mapa (`assets/campus.glb`, ~1 MB) y la fotogrametría (`assets/fotogrametria.glb`, ~18 MB) se descargan una vez y
quedan guardados en el navegador (Cache Storage, `js/cache.js`). Al abrir la app se lee `assets/versiones.json`
(siempre desde la red): si la versión guardada de un archivo es la misma, se usa sin descargar nada; si cambió, se
descarga (con `?v=<versión>`, así ningún caché de por medio la sirve vieja), se guarda y se borra la anterior.

- La versión es un hash del contenido (12 caracteres) y la escriben solos `tools/build-glb.mjs` y
  `tools/fotogrametria/build-fotogrametria.mjs` al terminar (`tools/versiones.mjs`). Si se reemplaza uno de los glb a
  mano: `cd tools && node versiones.mjs`.
- Requiere https (o localhost): por `http://<ip>` no hay Cache Storage y se descarga cada vez, igual que sin versión
  o en navegación privada.

## Capa de fotogrametría

El botón bajo la brújula abre una hoja que sube desde abajo, copia de la de "Tipo de mapa" de Google Maps (se cierra
con la X, tocando fuera o con Escape; elegir una opción no la cierra):

- **Tipo de mapa**: **Mapa** (el dibujado) o **Fotogrametría**.
- **Detalles del mapa**: interruptores (no se recuerdan: la app siempre parte con los tres primeros prendidos y el último apagado):
  - **Colores de sectores** (`mapView.setSectorsVisible`).
  - **Puntos de interés** (`mapView.setPOIsVisible`): íconos y nombres de los POI; el seleccionado se ve igual.
  - **Edificios 3D** (`mapView.setBuildings3D`): al apagarlo, todo lo que sobresale del suelo se achata en 0,9 s
    (escala vertical hasta `FLAT` = 0,01; no desaparece). En el mapa dibujado quedan las plantas de los edificios; en
    la fotogrametría, la misma foto achatada queda como una foto aérea plana (sin descargar nada más). Para
    depurar: `__app.flat = 0..1`.
  - **Hora y clima** (`mapView.setLive`): hora actual y clima real (ver *Clima*).

La fotogrametría (~18 MB) se descarga recién la primera vez que alguien la elige; mientras, su opción muestra
"Descargando N%". Con ella activa:

- Se ocultan los edificios, árboles, calles y sectores dibujados. Siguen las etiquetas, marcadores, pin y ruta (la ruta se
  dibuja encima, porque el terreno de la foto no es plano). Tocar un edificio sigue funcionando (sus volúmenes ocultos
  responden al toque).
- Lleva el filtro "faded" y el tinte cálido del mapa, y recibe el sol de la escena (sombreado y sombras), además de
  la luz que ya trae la foto. Para quitar el sol: `PHOTO_SUN = false` en `js/mapview.js` (o `?fotosol=0` para
  comparar).

Se genera desde la compra original (`~/Downloads/Photogrametry USACH.gltf`) con `tools/fotogrametria/`:

```
cd tools/fotogrametria && node build-fotogrametria.mjs     # requiere: brew install basis_universal
```

| Archivo | Qué hace |
|---|---|
| `build-fotogrametria.mjs` | Calza, recorta, simplifica, arma 5 atlas de 4096 px en KTX2/ETC1S y escribe el glb (meshopt) |
| `calce.json` | Giro, traslación y escala (x, z) que llevan la foto a la escena + plano del suelo para nivelarla |
| `recorte.mjs` | Polígono de recorte: borde exterior de Portales, Matucana, Alameda y General Velásquez (OSM) + margen de vereda |
| `crop.mjs` | Corta exacto los triángulos del borde (clipper + earcut) |
| `calce-1-alturas.mjs` → `calce-2-giro.mjs` → `calce-3-afinar.mjs` | Cómo se obtuvo `calce.json`: mapa de alturas de la foto y de `campus-editable.glb`, correlación por FFT (giro y traslación) y ajuste fino. Solo hace falta si cambia la fotogrametría o se mueven los edificios |
| `revisar-*.mjs` | Imágenes de control: superposición de alturas, ortofoto, polígono de recorte |
| `alturas.mjs` | Ajusta la altura de los edificios del mapa a la foto (ver abajo). Modifica `campus-editable.glb` |
| `dos-alturas.mjs` | Divide la planta de un edificio en una parte alta y una baja según la foto (conserva la planta de OSM) |
| `cruz.mjs` | Rehace un edificio como dos cajas rectangulares que se cruzan en ángulo recto (barra alta + bloque bajo), con forma y alturas de la foto; para plantas de OSM chuecas. Con `--hueco este|oeste` el tramo de la barra a ese lado queda sobre una planta libre con pilares. Hecho: Depto. de Matemáticas (`--hueco oeste --hueco-alto 7.17`: barra 42,4 × 13,1 m a 20,5 m, tramo poniente sobre un hueco de 7,2 m con columnas en las esquinas surponiente y norponiente; bloque 12,4 × 37,8 m a 14,3 m). Si se vuelve a correr, hay que reponer el letrero (`tools/letrero.mjs`). `alturas.mjs` lo salta |
| `casa-central.mjs` | Rehace la Casa Central desde su caja original: alto de la foto (12,2 m), largo de la foto (x 171,5–257, 85,5 m; OSM la dejaba ~14 m corta), fachada (`tools/casa-central-fachada.mjs`, con la oficina del 2.º piso que sale 1,5 m de la cara norte en x 238,5–249,5: sus losas siguen las corridas de pared y el ventanal del 2.º piso da la vuelta por sus tres caras sin marcos en las esquinas) y hueco poniente (`tools/hueco.mjs`: 19 m × 3,87 m, pilares en las esquinas SO y NO; con el eje fijo, `--eje`, para que la oficina no lo gire) y el escudo de la universidad en la cara sur, sobre el hueco (`tools/logo.mjs`, ver *Logos*) |
| `calce-modelo.mjs` | Calza un modelo hecho a mano (ficha `tools/modelos/<x>.json`) con el trozo de fotogrametría de Google que trae adentro (`BuildingMesh-…`): giro, escala y posición por comparación de mapas de alturas con la foto. Ver *Modelos hechos a mano* |

Notas: la foto viene a escala 1:2202 y queda girada 19,3°. La escala ajustada no es exactamente 1, porque `geo.js` usa
metros por grado aproximados y los edificios del mapa se calzaron contra Mapbox: la foto se ajusta a ellos.
Simplifica poco (823k → 708k triángulos) porque el UV de cada tesela está muy fragmentado; `Permissive` simplificaría
más, pero arrastra la textura en franjas.

### Logos

`tools/logo.mjs` pone un logo a color en relieve sobre la pared de un objeto, desde un PNG y una ficha
(`tools/modelos/logo-<x>.json`). Cada píxel va al color más cercano de la paleta de la ficha; los transparentes y los
colores de `"vacio"` no se ponen (se ve la pared). `"recorte": { "hastaY" }` deja solo las partes conexas del dibujo que
empiezan sobre esa fila del PNG. Cada color se traza con marching squares sobre su máscara suavizada, se simplifica
(`"tolerancia"` en px) y se triangula (clipper + earcut). La silueta completa va como una base de `"grosor"` m del color
`"base"` y cada color encima como una placa de `"placa"` m (materiales `logo_<color>`): los contornos quedan como surcos,
como un escudo esmaltado. Se centra en `"centro"` ([x, alto] en caras sur/norte) sobre la pared que mira a `"cara"`, con
`"alto"` m. Es idempotente (reemplaza las primitivas `logo_*` del objeto).

Hecho: el escudo de la universidad en la cara sur de la Casa Central (`logo-casa-central.json`, PNG
`modelos/logos/usach-escudo-color.png`): sobre el hueco poniente, centrado en x 185,2 y 8,05 m de alto (la mancha oscura de
la fotogrametría, de unos 2,6 × 2,8 m), con 3,4 m de alto; sin el pergamino ni el texto, y con el campo blanco del león
vacío. Base 0,12 m + placas 0,03 m; 5.836 triángulos. `fotogrametria/casa-central.mjs` lo repone al rehacer la Casa Central.

### Modelos hechos a mano

El usuario modela en Blender los edificios cuya planta de OSM no alcanza (por ahora la **FAE**: anillo octogonal,
membrana tensada y torre con muro cortina y balcones; Marsino Arquitectura, 2021, fotos y planos en ArchDaily). Los archivos van en `modelos/` y cada uno tiene su
ficha en `tools/modelos/<x>.json` (archivo, objeto del mapa que reemplaza, colección, trato de algunas partes y calce):

```
cd tools/fotogrametria && node calce-modelo.mjs ../modelos/fae.json    # solo si el modelo se movió en Blender
cd .. && node importar-modelo.mjs modelos/fae.json && node build-glb.mjs
```

- **Calce:** el archivo trae el trozo de fotogrametría de Google sobre el que se modeló (objetos `BuildingMesh-…`,
  de MapsModelsImporter). `calce-modelo.mjs` lo superpone a la fotogrametría del mapa comparando mapas de alturas
  (giro barrido cada 10° y afinado) y aplica ese mismo giro, escala y posición al modelo. El piso del modelo queda en
  y = 0. FAE: giro 86,2°, escala 32,29 m por unidad de Blender, error medio de alturas 5 m (la foto es borrosa; la
  torre calza en sus cuatro bordes).
- **Norma gráfica (la del planetario y la del pack de edificios de Santiago):** muros, marcos, losas, aletas y
  parapetos `modelos_fff` (blanco); caras que miran hacia arriba y pisos de balcones `techo_planetario`; vidrios y
  barandas `vidrio`; membranas blancas por ambas caras, como el cono del planetario. Las "cajas" de la ficha (en la FAE,
  las cajas de vidrio rojo de la torre de escaleras) llevan los costados en el material de acento de la ficha
  (`acento_rojo`, que se crea si no existe; los rojos `modelos_603/703…` del original no sirven: son conos de luz).
- **Lenguaje del pack** (`~/Documents/BLENDER/EdificiosSantiago.blend`, 46 edificios emblemáticos comprados por el
  usuario, del estilo de los landmarks de Mapbox): muros blancos, techos durazno y ventanas celestes; el vidrio va
  hundido detrás de un marco blanco, las losas y montantes se ven, y los techos llevan un parapeto blanco delgado.
- Las superficies abiertas (membrana, vidrios) se duplican con la cara opuesta: la web pinta un solo lado.
- **Pisos** (`"pisos"` en la ficha, `tools/fachadas.mjs`): las alturas de los volúmenes se llevan a una grilla de
  3,4 m (la FAE tiene 12 pisos en la torre y 6 en el anillo), así cada volumen empieza y termina en un piso. Las cajas
  quedan una por piso.
- **Balcones** (`"balcones"`): los prismas salientes son huecos. Cada uno se da en la ficha por su planta (convexa),
  sus pisos, la arista abierta y las de fondo; se vacía piso a piso (losa de 35 cm, muro ciego de 30 cm), con baranda
  de vidrio de 1,05 m y pasamanos blanco en la cara abierta, y al fondo un muro blanco (sin vidrio, para que la
  baranda se lea: lo pidió el usuario). En las fotos de los cuatro de la torre la cara abierta es la de la derecha mirando hacia afuera. En los
  dos del anillo (poniente y norte) es al revés: la de la derecha mirando el edificio desde afuera (corrección del
  usuario). Con `"alinear": true` las losas son del grosor de las líneas del muro cortina (25 cm) y van centradas en
  cada piso, también la de abajo y la de arriba, así siguen las líneas de la fachada vecina (FAE: los dos de la
  izquierda de la cara sur, junto al muro cortina). FAE: 7 balcones.
- **Fachadas** (`"fachadas"`): cada plano vertical recibe un tipo según las reglas de la ficha (por orientación,
  cercanía a un punto, tramo de la planta y pisos), y el resto el tipo por defecto. Una regla puede cambiar las
  medidas del tipo solo en su tramo (`"medidas"`, p. ej. `{ "borde": 0 }` para un ventanal pegado a la esquina):
  - `cortina`: todo vidrio detrás de un marco blanco de 60 cm, una línea blanca por piso y cruces de arriostramiento
    (una cada 4 pisos, de lado a lado). El marco de 60 cm va solo en el contorno del paño: junto a un balcón (aunque
    muerda el borde del paño) es de media línea, 12,5 cm, así sus bordes calzan con las líneas de piso en vez de
    sobresalir arriba y abajo. FAE: la cara sur de la torre con su triángulo.
  - `franjas`: un ventanal corrido por piso, de losa a losa y de punta a punta del muro: vidrio desde 12,5 cm sobre
    cada piso hasta 12,5 cm bajo el siguiente y hasta 12,5 cm de cada costado, así entre pisos y en las esquinas queda
    solo una línea blanca de 25 cm, como las del muro cortina; sin montantes. Solo se corta donde hay un balcón (con el
    mismo margen de 12,5 cm) o se acaba el muro. FAE: el resto de la torre (el usuario lo pidió así: ventanales de
    corrido, sin cruces, separaciones ni márgenes anchos).
  - `celosia`: franjas detrás de aletas verticales blancas cada 1,2 m. FAE: el anillo.
  - `ranuras`: ventanas angostas en columnas, centradas en el tramo de muro que más se repite de piso a piso (la del
    medio al centro del muro). FAE: el muro de hormigón de la cara oriente sobre el volumen bajo (muro
    liso con tres ranuras verticales, como en las fotos); la franja angosta a su lado, lisa.
  - `ciego`: sin ventanas. FAE: la espina de hormigón junto al muro cortina y la torre de escaleras.
  Las ventanas solo se abren donde el muro se ve desde afuera (rayos contra el resto del modelo). Las rendijas finas
  entre triángulos del modelo se cierran antes de trabajar cada plano.
- **Mallas desprolijas:** el modelo de la FAE junta volúmenes sin unirlos, así que una misma fachada viene partida en
  caras paralelas desfasadas hasta 2 m (y algunas giradas casi 1°), superpuestas, con juntas en diagonal y caras
  internas que llegan a la fachada. Para que las ventanas salgan limpias:
  - las caras casi coplanares (hasta 3° y 1 m) se tratan como una sola fachada, con una sola grilla de ventanas; cada
    vano se corta en cada cara en su propio marco (la geometría no se mueve);
  - una ventana que cae en varias caras casi a la misma profundidad (hasta 30 cm) se arma entera a la de la más afuera
    (si no, la junta se veía como una línea diagonal dentro del vidrio); solo con un escalón real se parte;
  - el "túnel" de cada ventana (de la cara más afuera al vidrio) se vacía de lo que quede adentro, p. ej. caras
    internas que llegan a la fachada.
- **Solape de fotos** (`tools/solape-foto.mjs` + una ficha como `tools/modelos/fae-foto-sur.json`): con 6 a 10 puntos
  conocidos (escena → píxel) calza la cámara de la foto (nivelada, con lente descentrable: posición, azimut, foco y
  centro óptico) y dibuja el objeto desde ahí, junto a la foto y mezclado al 50 %. Con la foto sur de la FAE (error
  medio 9 px en 3000) se vio que la espina de hormigón son los últimos 5,4 m al oriente de la cara sur (no la cara
  siguiente) y que el balcón de abajo a la derecha va en los pisos 3 y 4: los cuatro balcones de la cara sur van en
  zigzag (pisos 3–4 derecha, 5–6 izquierda, 8–9 derecha, 10 izquierda, contando la planta baja como piso 1). Bajo el
  de abajo a la derecha, el piso 2 es un hueco a propósito (muro con ventana atrás) y el piso 1 un saliente con
  ventanas.
- **Parapetos** (`"parapetos"`): borde blanco de 0,9 × 0,3 m en los techos principales, planos o inclinados (en el
  techo inclinado de la torre de la FAE sigue la pendiente), solo en los bordes libres:
  - no donde sigue un muro más alto, ni en la junta con otro techo a la misma altura;
  - no en un borde que queda bajo el resto del edificio (estaría adentro y se asomaría por los ventanales);
  - no en la losa de arriba de un balcón (un techo a otra altura sobre la misma planta sí lleva);
  - no en los bordes que la membrana tapa casi enteros (el patio techado del anillo de la FAE).
  Se decide a lo largo de cada borde; el parapeto termina donde empieza el muro y, si queda una rendija de menos de
  0,8 m, se estira hasta tocarlo. Los techos hechos de dos triángulos alabeados (hasta 5°, con una arista común) son un
  solo techo, y donde un techo sigue en otro (el inclinado en el plano) el parapeto sigue con inglete, sin remates. Las
  cadenas de tramos de menos de 1,5 m en total se descartan. Para decidirlo se mira solo el volumen del edificio: la
  membrana, las celosías o un plano de vidrio suelto no cuentan como muro.
- **Suelo** (`"suelo"`): losa `techo_planetario` 5 cm sobre el suelo en la planta baja del edificio y en los patios
  que la planta completa encierra (el de la FAE, bajo la membrana), para que no se vea el pasto adentro. No va bajo
  los volúmenes en voladizo. La membrana no cuenta para la planta.
- FAE: unos 7.900 triángulos.
- El objeto reemplazado pasa a la colección `Modelos`, así `alturas.mjs` ya no lo toca.
- Las piezas de OSM que formaban parte del edificio antiguo no se reemplazan solas: hay que borrarlas
  (`tools/borrar.mjs "Objeto" ...`). En la FAE se borraron los edificios 447, 449, 450 y 453, que quedaban
  asomando al norte, al oriente y bajo la torre, o escondidos adentro.
- FAE: 47,2 m en la punta de la membrana.

### Ventanas sobre las cajas de un edificio (DMCC)

`importar-modelo.mjs` también sirve para un edificio del mapa sin modelo propio: sus cajas se guardan como fuente en
`modelos/` (en coordenadas de escena, calce identidad) y la ficha les aplica las mismas fachadas que a la FAE. Con
`"conservar": ["letras_celeste"]` las primitivas de ese material (un letrero hecho con `letrero.mjs`) quedan tal cual
y el nodo no se mueve.

**DMCC** (`tools/modelos/dmcc.json`, fuente `modelos/dmcc-cajas.glb`). Fuentes: fotos de
https://www.dmcc.usach.cl/infraestructura/ y alzados de la fotogrametría.
- Cajas: las de `cruz.mjs` (barra alta con su tramo poniente sobre un hueco, bloque más bajo que la cruza). Los dos
  pilares del hueco pasaron a ser el marco del extremo poniente de las fotos: dos columnas de alto completo que
  sobresalen 0,6 m del testero, con un dintel arriba. Todo a ras de la azotea (si sube sobre ella, el techo queda
  desnivelado y la baranda se corta) y armado sobre las esquinas exactas de la barra: con una rendija de milímetros
  entre su techo y la azotea, el parapeto lo toma como otro techo chico pegado y deja ese borde sin baranda.
- Barra: un ventanal corrido por piso, sin montantes, como en la FAE. Grilla de 3 m, filas de 2,4 m con 0,6 m de muro
  entre pisos (las fajas de hormigón de las fotos). Las filas llegan hasta 18,95 m: la banda de arriba queda ciega
  para el letrero, que va centrado en ella entre el último ventanal y el remate de la baranda (19,47–20,62 m; se subió
  0,35 m cuando la baranda alargó la banda). Los testeros son ciegos, con una columna de ventanas al centro (`ranuras` de una).
- Bloque: el primer piso de su tramo sur va vaciado hasta la barra (hueco de 4,25 m, a media faja como el de la
  barra), con pilares de 1,6 m en sus esquinas surponiente y suroriente; al fondo queda a la vista la fachada sur de
  la barra con su ventanal de planta baja. Para no duplicar esa fachada, la caja del bloque termina 0,6 m adentro de
  la barra. Caras norte y sur ciegas (el usuario lo prefirió así al muro cortina con cruz), salvo un ventanal en su
  cuarto poniente, pegado al borde (regla con `"medidas": { "borde": 0 }`). Sus costados oriente y poniente, al norte
  y al sur de la barra, llevan el mismo ventanal corrido: le caben 4 filas, a la misma altura que las de la barra. El
  costado poniente va también sin margen en sus puntas, así su ventanal se junta en la esquina con el de las caras
  norte y sur.
- Esquina abierta: una punta de ventanal sin margen donde justo después ya no sigue el muro dobla la esquina con el
  ventanal de la cara vecina. En esa punta no lleva jamba, el vidrio se corta donde se topa con el del otro lado (el
  hundido más adentro) y el dintel y el antepecho van a inglete. Si no, cada vidrio seguía de largo hasta la arista y
  se montaba sobre el otro. Para dejar sin margen solo una punta: `"medidas": { "sinBordeEn": [[x, z]] }` (la punta
  que queda junto a ese punto). En el DMCC: las esquinas poniente del bloque y la esquina de planta baja entre el fondo
  del hueco poniente y la fachada sur de la barra (que quedó a la vista con el hueco del bloque).
- En la fachada sur de la barra, tapada por el tramo sur del bloque, el ventanal del primer piso se corta 0,7 m
  adentro del bloque: si no, se asomaba dentro del ventanal del costado poniente del bloque. En los otros pisos sigue
  por detrás del bloque, como antes: si se corta justo en sus caras, la jamba queda a la vista como un borde en la
  esquina interior.
- El muro cortina admite `lamas` (líneas finas entre losas) y `holgura` (cuánto puede bajar el módulo de la cruz bajo
  el vidrio).

### Edificios clásicos generados

Para los edificios históricos sin modelo propio, `tools/clasico.mjs` arma la malla desde una ficha
(`tools/modelos/<x>.json`, `"tipo": "clasico"`) y la pone en lugar del objeto del mismo nombre (pasa a `Modelos`). Sigue
el lenguaje de los clásicos del pack de Santiago (Casa Central UC, U. de Chile, La Moneda, museos): la norma no son
solo los colores sino el tratamiento de la geometría.
- Planta rectangular con resaltos simétricos en las dos fachadas largas: uno en cada extremo y uno central. Entre
  ellos la fachada queda retranqueada.
- Zócalo, una imposta en cada piso, pilastras en las esquinas de los resaltos (los frentes las doblan por la esquina)
  y donde diga la ficha.
- Ventanas hundidas 30 cm con alféizar; en el piso noble, con marco y sobrecornisa. Grupos: `una`, `par`, `triple`,
  `arco3` (tres luces de medio punto), `balcon3` y `puerta3` (con puerta al medio).
- Entablamento (arquitrabe, friso y cornisa de dos cuerpos) y ático con albardilla. Los resaltos rematan más alto.
- Techos dentro del borde del ático: la crujía a dos aguas, cada resalto a cuatro aguas con la misma pendiente en sus
  cuatro caras. La crujía entra bajo los techos de los resaltos lo justo para que su cumbrera quede adentro (forma las
  limahoyas sin cortar nada).
- Pórtico de entrada con balcón encima, si la ficha lo pide.
- Entradas con la luz blanca de las puertas del pack (como el Planetario y el Artequín). La puerta baja a ras de suelo
  y el zócalo se corta frente a ella. En su plano van dos triángulos en las jambas y un trapecio en el suelo, de
  material `luz_puerta`; salen 1,3 veces el alto de la puerta y se abren 0,42 veces a cada lado. El build los pinta
  blancos, opacos en la base del marco y transparentes hacia afuera, y pinta blanco el vano de la puerta. El build
  arma cada puerta con los dos marcos de igual alto que son el más cercano uno del otro (hasta 6 m, así entran los
  portales anchos sin emparejar marcos de puertas vecinas, como las tres del Artequín).
- Las medidas salen de la fotogrametría: mapa de alturas (largo, fondo, resaltos, aleros y cumbreras) y alzados
  ortogonales con textura de cada fachada (pisos, ritmo y tipo de ventanas).

**Periodismo y Psicología** (antigua Escuela de Aplicación República de Venezuela, `tools/modelos/periodismo.json`):
- Planta de 87,8 × 11,3 m con resaltos de 0,75 m: los laterales miden 10,6 m de ancho y el central 22,5 m.
- Tres pisos: zócalo a 1,2 m, pisos cada 4,7 m, cornisa a 16,45 m, ático a 17,3 m (resaltos 18,1 m).
- Cumbreras: crujía 20 m, resaltos laterales 21,2 m, central 21,1 m.
- Ventanas: pares en la crujía (5 por tramo); en los resaltos laterales y las testeras, un par y dos ventanas sueltas.
  Al norte, pórtico con arco y balcón al centro. Al sur, tríos de medio punto en el resalto central; en el primer piso,
  portal cuadrado grande, de 4,1 × 5,1 m (como en la fotogrametría): ocupa el ancho de un grupo de tres ventanas, del
  umbral al dintel del piso. Las dos entradas llevan la luz blanca.
- Unos 8.900 triángulos.

### Alturas de los edificios

Muchos edificios del mapa vienen de OpenStreetMap sin altura y quedaron con una inventada (18–20 m).
`alturas.mjs` mide cada uno en la fotogrametría: la mediana del techo dentro de su planta (sin 1 m de borde) menos el
suelo local (percentil 10 de un anillo de 3–25 m afuera, corregido a lo más ±1 m). Prueba la planta corrida hasta ±2 m,
porque el calce tiene 1–2 m de error local. Si la diferencia con el mapa supera 2 m, escala el edificio en vertical.
Así conserva su forma y no crea ni borra nada. Resultado (2026-11-01): 277 ajustados (47 subidos, 230 bajados),
170 ya calzaban, 35 sin datos (fuera del recorte o muy chicos) y la Casa Central aparte (19,4 → 12,2 m).

Quedan para revisar en `assets/revisar-alturas.json`, y con `?dev` se pintan de color (leyenda en el panel; al
tocarlos, el aviso dice por qué):
- **magenta, "no existe en la foto"** (16): la foto no muestra nada sobre ~2 m (canchas, sitios, estacionamientos).
  **No se tocaron.**
- **ámbar, "varias alturas"** (10; la FAE salió de la lista al reemplazarla por el modelo): la foto muestra partes bastante más altas que la mediana (una torre sobre un
  cuerpo bajo, o árboles encima). Se ajustaron a la altura típica.

El detalle por edificio está en `tools/fotogrametria/alturas-informe.json`.

## Colores e iluminación

Replica la configuración del estilo en Mapbox Studio (`mapbox://styles/pittu/cmnknq7ed000401qkb02l4ec0`, import **Basemap** = Mapbox Standard):
`lightPreset: "dawn"`, `theme: "faded"`, `colorBuildings: "hsl(40, 15%, 91%)"`.

- **Luz** (`js/sun.js`): ambiente `hsl(28, 98%, 93%)` × 0.75 y sol `hsl(33, 98%, 77%)`, los colores del preset "dawn". Mapbox declara el sol en 0.5, pero 0.3 es lo que calza con sus capturas (muros al sol y a la sombra casi iguales). El sol se mueve con la hora real.
- **Tinte cálido global** (`WARM` en `js/main.js`): se aplica a todo lo iluminado, igual que la luz de Mapbox a zoom de calle (suelo `#fef1e1` → `#f9e1cb`, sector azul verdoso).
- **Objetos 3D** (edificios, árboles, modelos, vidrio): el color del material es el *albedo*, y la luz cálida lo entibia. Después pasan por el filtro "faded" (`FADED_SAT`, `FADED_GAIN` en `js/main.js`). El edificio usa `#ebe9e5` = `hsl(40, 15%, 91%)`.
- **Suelo, áreas y calles**: el color del material es el tono *final* medido en Mapbox; `paletteMaterialColor()` lo compensa por la luz.
- Sectores: opacidad 0.25.
- **Sombreado suave de los modelos** (`creasedNormals` en `js/mapview.js`): promedia las normales de los triángulos que
  comparten un vértice y no forman más de 35° (`CREASE`). Agrupa los vértices por su posición real al centímetro: el glb
  trae las posiciones cuantizadas (enteros normalizados a −1…1 y la malla escalada ×~400), y `toCreasedNormals` de three
  redondeaba en celdas de ~4 m, con un costo que crece con el cuadrado de los vértices de cada celda (con el escudo de la
  Casa Central el celular se quedaba pegado al cargar).

## Clima

> La app parte con la escena fija en cielo despejado a las 9:55 (`FIXED_TIME` en `js/mapview.js`). El interruptor **Hora y clima** del menú de capas (`mapView.setLive`) activa la hora actual (sigue el reloj; el cambio de hora se anima en 1,5 s y de noche se oscurece) y el clima real; al apagarlo vuelve a las 9:55 despejado. Con hora y clima reales, el chip de clima de la hoja principal muestra la temperatura y el estado de ahora. `?dev` en la URL parte así y muestra el panel, p. ej. `?dev&clima=lluvia`.

- Fuente: [Open-Meteo](https://open-meteo.com) (gratis, sin API key, uso no comercial). Se consulta al prender "Hora y clima" solo si el último dato tiene más de 15 min (lo que tarda Open-Meteo en actualizar; `refreshIfStale` en `js/weather.js`): apagar y volver a prender no repite la llamada, y una llamada en curso no se duplica. Mientras está prendido se renueva cada 15 min; apagado no se consulta. Si falla, queda despejado y se reintenta la próxima vez.
- El código WMO se traduce a niveles (`fromWMO` en `js/weather.js`): despejado, nublado, niebla, llovizna, lluvia/chubascos y tormenta.
- Efectos: el sol se apaga según la nubosidad (sin sombras), la luz pasa a gris tibio. Para que los edificios juntos no se fundan en una mancha, la luz difusa sigue viniendo sobre todo de arriba (techos claros, muros más oscuros), una luz de relleno sin sombras distingue los muros según su orientación y la oclusión en la base de los muros se marca más. Además, la niebla se acerca, el suelo se oscurece al mojarse, hay gotas (un solo draw call, animadas en la GPU) y relámpagos en tormenta. Las transiciones duran ~3 s.
- Para probar: selector en el panel, o `?clima=despejado|nublado|llovizna|lluvia|tormenta` en la URL.
- `?q=low` desactiva las gotas. Mientras llueve, la escena se renderiza en cada frame (con cielo despejado solo cuando algo cambia).

## Nombres de calles

- Datos: calles con nombre de OpenStreetMap (`tools/osm/streets.json`), recortadas a los cuatro límites, con los tramos unidos (`tools/build-streets.mjs` → `assets/streets.json`, 8 KB).
- Se muestran como en Mapbox: mayúsculas espaciadas, alineados con la calle y nunca de cabeza, solo donde el nombre cabe en un tramo recto, con la misma calle repetida cada ~250 px y sin pisar íconos ni textos de POIs.
- Aparecen según el zoom: avenidas desde 15, calles desde 16 y pasajes desde 16,8 (`STREET_MIN_ZOOM` en `js/labels.js`).
- Para actualizar desde OSM: volver a bajar `osm/streets.json` con Overpass (`way["highway"]["name"]` en el área) y correr `node build-streets.mjs`.
