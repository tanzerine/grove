/**
 * Spanish UI catalogue — SCAFFOLD.
 *
 * Intentionally partial. Every key absent here renders its English source
 * (see lib/i18n/index.ts), so shipping this half-finished is safe: the
 * dashboard is English where Spanish is missing, never a raw key. Filling it
 * is a data task — no code changes — and `coverage()` tells the switcher how
 * far along it is so nobody picks it expecting a finished translation.
 */
export const ES: Record<string, string> = {
  // ── shell ──
  'Home': 'Inicio',
  'Strategy': 'Estrategia',
  'Write': 'Escribir',
  'Pipeline': 'Producción',
  'Calendar': 'Calendario',
  'Analytics': 'Analíticas',
  'Brand voice': 'Voz de marca',
  'Social': 'Redes',
  'Embed': 'Insertar',
  'Content API': 'API de contenido',
  'Billing': 'Facturación',
  'Feedback': 'Comentarios',
  'Language': 'Idioma',
};
