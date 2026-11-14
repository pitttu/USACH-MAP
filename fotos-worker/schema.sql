-- Fotos de la comunidad: un envío por fila. estado: pendiente | publicada | rechazada | retirada
CREATE TABLE IF NOT EXISTS fotos (
  id TEXT PRIMARY KEY,
  lugar TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  email TEXT NOT NULL,          -- quién la subió (solo lo ven los administradores)
  nombre TEXT,                  -- nombre de la cuenta de Google
  mostrar_nombre INTEGER NOT NULL DEFAULT 0, -- 1: el crédito lleva su nombre; 0: "Comunidad USACH"
  ancho INTEGER, alto INTEGER, bytes INTEGER,
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
