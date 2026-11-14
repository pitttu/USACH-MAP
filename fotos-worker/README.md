# fotos-worker

Cloudflare Worker de las **fotos de la comunidad**: guarda las fotos que sube la gente para el carrusel de los lugares,
y el panel donde un administrador las revisa antes de publicarlas. La app (GitHub Pages) pide aquí las publicadas y
las junta con las de Wikimedia Commons de `assets/data/fotos.json`.

- **Quién sube:** cuentas de Google **@usach.cl** (Google Identity Services en la app; la app nunca ve la clave). El
  Worker verifica el token de Google con las llaves públicas de Google: firma, audiencia (`GOOGLE_CLIENT_ID`),
  vigencia, correo verificado y dominio (`DOMINIO`).
- **Licencia:** quien sube acepta compartirla con **CC BY-NC-SA 4.0** (dar crédito, sin fines de lucro, compartir
  igual). El crédito es su nombre de la cuenta de Google o, si lo elige, "Comunidad USACH". No hay apodos.
- **Revisión:** toda foto queda *pendiente* hasta que un administrador (`ADMINS`) la publica en `/admin`. Una publicada
  se puede retirar (y volver a publicar). Las rechazadas se borran (queda su fila y el registro).
- **Auditoría:** la tabla `registro` guarda cada subida y cada decisión (quién, qué, cuándo, motivo). El panel la
  muestra.
- **Privacidad:** la app achica la foto y la vuelve a codificar, y el Worker igual le quita los metadatos (EXIF con
  ubicación GPS y cámara, XMP, ICC, comentarios), en JPEG y en WebP. El correo solo lo ven los
  administradores. Condiciones para la gente: `condiciones-fotos.html` en la app.
- **Compresión:** la app manda **WebP** de 1280 px de lado mayor (calidad 0,70) y una miniatura de 520 px de alto
  (0,62), unos 115 KB entre las dos; si el navegador no sabe codificar WebP, JPEG (0,72 y 0,68, unos 170 KB). Las dos
  van en el mismo formato (`formato` en la tabla).
- **Tope de espacio: 9,9 GB** (`TOPE_BYTES`), bajo los 10 GB gratis de R2. Cuenta lo que ocupan las fotos guardadas
  (pendientes, publicadas y retiradas; las rechazadas se borran). Al llegar, subir responde "Se llenó el espacio". El
  panel muestra el espacio usado. Caben unas **85.000 fotos** en WebP (unas 58.000 si todas fueran JPEG).
- **Límites:** 10 fotos al día y 30 pendientes por persona; 10 subidas por minuto por IP; foto de a lo más 1600 px y
  1,2 MB, miniatura de 520 px de alto y 250 KB.
- **Lugares:** cada foto va con la clave del lugar (`lugar`): su nombre, o nombre y coordenadas si el nombre se repite
  (los 26 "Baño Público", los dispensadores…), y con el texto que ve el administrador (`lugar_texto`).

| Ruta | Qué hace |
|---|---|
| `GET /fotos` | fotos publicadas por lugar (mismo formato que `assets/data/fotos.json`) |
| `GET /img/<id>.webp`, `/img/<id>-m.webp` | una foto publicada, grande o miniatura (`.jpg` si llegó en JPEG) |
| `POST /subir` | sube una foto (formulario: `lugar`, `lugarTexto`, `foto`, `mini`, `nombre` si/no, `acepto` si) |
| `GET /mias` | las fotos de quien llama, con su estado |
| `GET /admin` | panel de revisión |
| `GET /admin/lista?estado=…`, `GET /admin/img/…`, `POST /admin/decidir` | lo que usa el panel (solo `ADMINS`) |

Datos: R2 `usach-fotos` (archivos `<id>.webp` y `<id>-m.webp`, o `.jpg`) y D1 `usach-fotos` (`schema.sql`).

## Estado (2026-11-14)

- Publicado en <https://usach-fotos.siac-worker.workers.dev> (panel en `/admin`), con la base D1 creada y un
  administrador en el secreto `ADMINS`.
- **Falta:** el ID de cliente de Google (paso 1; sin él el panel no deja entrar) y activar R2 (paso 2; sin él subir
  fotos responde 503). Al tenerlos: `GOOGLE_CLIENT_ID` en `wrangler.toml` y en `js/fotos.js`, crear el bucket, quitar
  los `#` del bloque `[[r2_buckets]]`, `FOTOS_WORKER` en `js/fotos.js`, y publicar.

## Poner en marcha

1. **Google** (una vez), en <https://console.cloud.google.com>:
   1. Crear un proyecto, por ejemplo "USACH Map".
   2. *APIs y servicios → Pantalla de consentimiento de OAuth*: tipo **Externo**; nombre "USACH Map", tu correo de
      contacto. Basta con los permisos básicos (`openid`, `email`, `profile`), que no requieren que Google verifique la
      app. Publicarla ("En producción"), para que no quede limitada a usuarios de prueba.
   3. *Credenciales → Crear credenciales → ID de cliente de OAuth*, tipo **Aplicación web**. Orígenes autorizados de
      JavaScript: `https://pitttu.github.io`, `http://localhost:8765` y la dirección del Worker
      (`https://usach-fotos.siac-worker.workers.dev`, para el panel). No hacen falta URI de redirección.
   4. Copiar el **ID de cliente** (termina en `.apps.googleusercontent.com`; no es secreto).
2. **Cloudflare** (una vez): activar R2 en el panel (gratis hasta 10 GB, pide registrar una tarjeta). Luego:
   ```bash
   cd fotos-worker
   npx wrangler r2 bucket create usach-fotos
   npx wrangler d1 create usach-fotos                     # copiar el database_id a wrangler.toml
   npx wrangler d1 execute usach-fotos --remote --file schema.sql
   ```
3. En `wrangler.toml`: `GOOGLE_CLIENT_ID`. Los administradores son un **secreto** (el repositorio es público):
   `npx wrangler secret put ADMINS` y escribir los correos de Google separados por coma.
4. `npx wrangler deploy` (imprime la dirección).
5. En la app, al comienzo de `js/fotos.js`: `FOTOS_WORKER` (esa dirección) y `GOOGLE_CLIENT_ID`. Commit y push.

## Probar en el Mac

Sin Google: `.dev.vars` (no se sube al repositorio) con `PRUEBA_SIN_GOOGLE=1`, `ADMINS=admin@usach.cl` y
`GOOGLE_CLIENT_ID=prueba` (y, para probar el tope, `TOPE_BYTES=600000`). Mientras R2 no esté activado en la cuenta,
`wrangler dev` necesita una copia de `wrangler.toml` con el bloque `[[r2_buckets]]` sin `#` (`--config`). Así el Worker local acepta el token `prueba:<correo>:<nombre>`, solo si se le llama en
`localhost` / `127.0.0.1` (el Worker publicado nunca lo acepta).

```bash
npx wrangler d1 execute usach-fotos --local --file schema.sql
npx wrangler dev --port 8787 --ip 127.0.0.1
# app: http://localhost:8765/?fotos-api=http://127.0.0.1:8787&fotos-prueba=ana@usach.cl:Ana%20Pérez
curl -H 'Authorization: Bearer prueba:admin@usach.cl:Admin' 'http://127.0.0.1:8787/admin/lista?estado=pendiente'
```
