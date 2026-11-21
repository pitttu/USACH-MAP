-- Fotos de la comunidad: un envío por fila. estado: pendiente | publicada | rechazada | retirada
CREATE TABLE IF NOT EXISTS fotos (
  id TEXT PRIMARY KEY,
  lugar TEXT NOT NULL,          -- clave del lugar en la app (su nombre, o nombre @lon,lat si el nombre se repite)
  lugar_texto TEXT,             -- cómo lo ve el administrador (p. ej. "Baño Público · Cerca de Biblioteca Central")
  estado TEXT NOT NULL DEFAULT 'pendiente',
  email TEXT NOT NULL,          -- quién la subió (solo lo ven los administradores)
  nombre TEXT,                  -- nombre de la cuenta de Google
  mostrar_nombre INTEGER NOT NULL DEFAULT 0, -- 1: el crédito lleva su nombre; 0: "Comunidad USACH"
  formato TEXT NOT NULL DEFAULT 'jpg', -- jpg | webp (la grande y la miniatura van igual)
  ancho INTEGER, alto INTEGER,
  bytes INTEGER,                -- lo que ocupan los dos archivos en R2 (para el tope de espacio)
  creada TEXT NOT NULL,
  revisada TEXT, revisor TEXT, motivo TEXT
);
CREATE INDEX IF NOT EXISTS fotos_estado ON fotos (estado, lugar);
CREATE INDEX IF NOT EXISTS fotos_email ON fotos (email, creada);
-- Registro de todo lo que pasa (subidas y decisiones), para auditar
CREATE TABLE IF NOT EXISTS registro (
  n INTEGER PRIMARY KEY AUTOINCREMENT,
  foto TEXT NOT NULL,
  accion TEXT NOT NULL,         -- subida | publicar | rechazar | retirar
  quien TEXT NOT NULL,
  cuando TEXT NOT NULL,
  detalle TEXT
);
-- Bases creadas antes de lugar_texto y formato (2026-11-14):
--   ALTER TABLE fotos ADD COLUMN lugar_texto TEXT;
--   ALTER TABLE fotos ADD COLUMN formato TEXT NOT NULL DEFAULT 'jpg';
-- Lugares que sugiere la comunidad (Más → Sugerir un lugar). Al publicarse aparecen en el mapa (GET /lugares).
-- estado: pendiente | publicada | rechazada | retirada. El registro va en la misma tabla registro (foto = id del lugar).
CREATE TABLE IF NOT EXISTS lugares (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,         -- cómo se va a llamar en el mapa (el administrador lo puede corregir al publicar)
  categoria TEXT NOT NULL,      -- comida | baño | dispensador | impresiones | cajero | biblioteca | educacion | deporte | salud | cultura | tienda | servicios | institucional | otro
  descripcion TEXT,
  lon REAL NOT NULL, lat REAL NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  email TEXT NOT NULL,          -- quién lo sugirió (solo lo ven los administradores)
  cuenta TEXT,                  -- nombre de la cuenta de Google
  creada TEXT NOT NULL,
  revisada TEXT, revisor TEXT, motivo TEXT
);
CREATE INDEX IF NOT EXISTS lugares_estado ON lugares (estado);
CREATE INDEX IF NOT EXISTS lugares_email ON lugares (email, creada);
-- Cambios sugeridos a un lugar que ya está en el mapa (botón Editar del lugar). No se aplican solos: los datos del
-- mapa están en el repositorio; el administrador los corrige allí y marca la sugerencia como aplicada (o la rechaza).
-- campo: nombre | categoria | ubicacion | detalles | cerrado. estado: pendiente | aplicada | rechazada.
CREATE TABLE IF NOT EXISTS ediciones (
  id TEXT PRIMARY KEY,
  lugar TEXT NOT NULL,          -- clave del lugar en la app (nombre, o nombre @lon,lat si el nombre se repite)
  lugar_texto TEXT,             -- cómo se ve en la app (nombre · subtítulo)
  lon REAL, lat REAL,           -- dónde está ahora en el mapa
  campo TEXT NOT NULL,
  actual TEXT,                  -- lo que muestra hoy la app
  valor TEXT,                   -- lo propuesto (ubicacion: "lon,lat"; cerrado: cerro | no_esta | no_existe)
  comentario TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  email TEXT NOT NULL, cuenta TEXT,
  creada TEXT NOT NULL,
  revisada TEXT, revisor TEXT, motivo TEXT
);
CREATE INDEX IF NOT EXISTS ediciones_estado ON ediciones (estado);
CREATE INDEX IF NOT EXISTS ediciones_email ON ediciones (email, creada);
