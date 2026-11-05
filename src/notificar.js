'use strict';

/**
 * Notificaciones: consola + pitido, Telegram y ntfy.sh (push al móvil).
 * Ningún fallo de notificación debe detener la búsqueda.
 */

function hora() {
  return new Date().toLocaleTimeString('es-ES', { hour12: false });
}

function log(...args) {
  console.log(`[${hora()}]`, ...args);
}

async function enviarTelegram(cfg, texto) {
  const t = cfg.telegram || {};
  if (!t.token || !t.chatId) return;
  const r = await fetch(`https://api.telegram.org/bot${t.token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: t.chatId, text: texto }),
  });
  if (!r.ok) throw new Error(`Telegram respondió ${r.status}`);
}

async function enviarNtfy(cfg, titulo, texto) {
  const n = cfg.ntfy || {};
  if (!n.tema) return;
  const servidor = n.servidor || 'https://ntfy.sh';
  const r = await fetch(`${servidor}/${encodeURIComponent(n.tema)}`, {
    method: 'POST',
    headers: { Title: titulo, Priority: 'urgent', Tags: 'rotating_light' },
    body: texto,
  });
  if (!r.ok) throw new Error(`ntfy respondió ${r.status}`);
}

function pitar(veces = 5) {
  for (let i = 0; i < veces; i++) process.stdout.write('\x07');
}

/**
 * @param {object} cfgNotif  sección "notificaciones" de la config
 * @param {string} titulo
 * @param {string} texto
 */
async function notificar(cfgNotif, titulo, texto) {
  log(`🔔 ${titulo}: ${texto}`);
  if (cfgNotif.sonido !== false) pitar();
  const envios = [
    enviarTelegram(cfgNotif, `${titulo}\n${texto}`),
    enviarNtfy(cfgNotif, titulo, texto),
  ];
  const res = await Promise.allSettled(envios);
  for (const r of res) {
    if (r.status === 'rejected') log(`⚠️  No se pudo enviar notificación: ${r.reason.message}`);
  }
}

module.exports = { notificar, log };
