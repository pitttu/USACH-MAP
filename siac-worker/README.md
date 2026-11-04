# siac-worker

Cloudflare Worker que importa el horario de SIAC para la app publicada en GitHub Pages (pestaña Tú).
Hace lo mismo que `tools/siac.py` en el servidor local: recibe `{ rut, clave }`, inicia sesión en SIAC, lee el horario,
cierra la sesión y devuelve `{ alumno, carrera, periodo, cursos, clases }` (o `{ error }` con 400, 401, 403, 423,
429 o 502).

- La clave solo viaja a SIAC: no se guarda ni se registra (el código no escribe logs y `observability` está apagado).
- Solo acepta llamadas desde `ALLOWED_ORIGINS` (`wrangler.toml`): la app en `https://pitttu.github.io` y
  `http://localhost:8765`.
- A lo más 5 intentos por minuto por IP (binding de rate limiting `LIMITER`).

## Publicar

Necesita una cuenta gratuita de Cloudflare.

```bash
cd siac-worker
npx wrangler login     # una vez: abre el navegador para autorizar
npx wrangler deploy    # imprime la dirección: hoy https://usach-siac.siac-worker.workers.dev
```

Esa dirección va en `SIAC_WORKER`, al comienzo de `js/tu.js`. Luego se hace commit y push, y GitHub Pages
la publica.

## Probar en el Mac

```bash
npx wrangler dev --port 8787
curl -X POST -H 'Origin: https://pitttu.github.io' -d '{"rut":"11111111-1","clave":"xxxx"}' http://127.0.0.1:8787/horario
```

Si SIAC cambia su página, cambia también `tools/siac.py`: los dos leen la página igual.
