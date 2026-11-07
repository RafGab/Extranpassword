#!/usr/bin/env node
'use strict';

const readline = require('readline');
const { cargarConfig, validar } = require('./config');
const { intentar, ESTADO } = require('./flujo');
const fs = require('fs');
const path = require('path');
const { notificar, log } = require('./notificar');

const ARCHIVO_RESERVADAS = path.resolve('reservadas.json');

function cargarReservadas() {
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO_RESERVADAS, 'utf8'));
  } catch {
    return {};
  }
}

function guardarReservadas(r) {
  fs.writeFileSync(ARCHIVO_RESERVADAS, JSON.stringify(r, null, 2));
}

function args() {
  const a = process.argv.slice(2);
  const valor = (flag, def) => {
    const i = a.indexOf(flag);
    return i >= 0 && a[i + 1] ? a[i + 1] : def;
  };
  return {
    config: valor('--config', 'config.json'),
    unaVez: a.includes('--una-vez'),
    probarNotif: a.includes('--probar-notificaciones'),
    ayuda: a.includes('--help') || a.includes('-h'),
  };
}

const AYUDA = `
Uso: node src/index.js [opciones]

  --config <ruta>            Archivo de configuración (por defecto config.json)
  --una-vez                  Hace un único intento y termina
  --probar-notificaciones    Envía una notificación de prueba y termina

Las personas que ya tienen cita se guardan en reservadas.json y no se vuelven
a buscar. Borra su entrada de ese archivo si necesitas buscarle otra.
  -h, --help                 Muestra esta ayuda
`;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function pregunta(texto, timeoutMs) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve('');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const t = timeoutMs ? setTimeout(() => { rl.close(); resolve(''); }, timeoutMs) : null;
    rl.question(texto, (r) => {
      if (t) clearTimeout(t);
      rl.close();
      resolve(r.trim());
    });
  });
}

function dentroDeHorario({ desde, hasta }) {
  const ahora = new Date();
  const hhmm = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
  return desde <= hasta ? hhmm >= desde && hhmm <= hasta : hhmm >= desde || hhmm <= hasta;
}

function esperaAleatoria([min, max]) {
  return Math.round((min + Math.random() * (max - min)) * 60_000);
}

async function main() {
  const opts = args();
  if (opts.ayuda) return console.log(AYUDA);

  const cfg = cargarConfig(opts.config);
  const errores = validar(cfg);
  if (errores.length) {
    console.error('Revisa config.json:\n - ' + errores.join('\n - '));
    process.exit(1);
  }

  if (opts.probarNotif) {
    await notificar(cfg.notificaciones, 'Prueba', 'Las notificaciones funcionan ✅');
    return;
  }

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('Falta Playwright. Ejecuta:  npm install && npx playwright install chromium');
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: !cfg.navegador.visible,
    slowMo: cfg.navegador.lentitudMs || 0,
  });
  const cerrar = async () => { await browser.close().catch(() => {}); process.exit(0); };
  process.on('SIGINT', cerrar);

  const registro = cargarReservadas();
  const pendientes = () => cfg.personas.filter((p) => !registro[p.documento]);
  for (const p of cfg.personas) {
    const hecha = registro[p.documento];
    log(`${hecha ? '✅' : '🔎'} ${p.nombre} · ${p.documento} · ${p.provincia}${hecha ? ` (ya reservada: ${hecha.detalle})` : ''}`);
  }
  log(`Trámite "${cfg.tramite}" · modo ${cfg.modo} · ${pendientes().length} persona(s) pendiente(s)`);
  if (!cfg.navegador.visible) log('Navegador oculto: el código SMS tendrás que escribirlo aquí, en la terminal.');

  const opcionesPara = (p) => ({
    alEncontrar: async ({ detalle, reservando }) => {
      await notificar(
        cfg.notificaciones,
        `¡Hay citas de huellas en ${p.provincia}!`,
        `${p.nombre}: ${detalle}. ${reservando ? 'Intentando reservar...' : 'Entra ya a reservar en el navegador.'}`
      );
    },
    pedirCodigoSMS: async () => {
      await notificar(cfg.notificaciones, `Cita retenida para ${p.nombre}: falta el SMS`, `Ha llegado un código al ${p.telefono}. Escríbelo en la terminal o en el navegador.`);
      return pregunta(`Código SMS para ${p.nombre} (o Enter para escribirlo en el navegador): `, 9 * 60_000);
    },
  });

  const marcarHecha = (p, detalle) => {
    registro[p.documento] = { nombre: p.nombre, provincia: p.provincia, detalle, fecha: new Date().toISOString() };
    guardarReservadas(registro);
  };

  let ciclo = 0;
  let erroresSeguidos = 0;
  while (pendientes().length) {
    if (!dentroDeHorario(cfg.horario)) {
      log(`Fuera de horario (${cfg.horario.desde}-${cfg.horario.hasta}); espero 10 min.`);
      await dormir(10 * 60_000);
      continue;
    }
    ciclo++;
    const turno = pendientes();
    log(`Ronda #${ciclo}: ${turno.length} persona(s)`);
    let bloqueado = false;

    for (const [i, p] of turno.entries()) {
      log(`→ ${p.nombre} en ${p.provincia}`);
      const r = await intentar(browser, p, opcionesPara(p));

      switch (r.estado) {
        case ESTADO.RESERVADA:
          marcarHecha(p, r.detalle);
          await notificar(cfg.notificaciones, `✅ CITA RESERVADA · ${p.nombre}`, `${p.provincia}. ${r.detalle}. Captura: ${r.captura}`);
          log(`El justificante llegará a ${p.email}. ¡Imprímelo y llévalo a la cita!`);
          break;

        case ESTADO.CITAS_DISPONIBLES: {
          log(`${r.detalle}. Completa la reserva de ${p.nombre} en la ventana del navegador.`);
          const resp = await pregunta(`¿Conseguiste la cita de ${p.nombre}? (s = sí / Enter = seguir buscando): `);
          await r.context.close().catch(() => {});
          if (/^s/i.test(resp)) marcarHecha(p, 'Reservada a mano en el navegador');
          break;
        }

        case ESTADO.SIN_CITAS:
          log(`   Sin citas.${r.detalle ? ` ${r.detalle}` : ''}`);
          erroresSeguidos = 0;
          break;

        case ESTADO.FUERA_DE_RANGO:
          log(`   ${r.detalle}`);
          erroresSeguidos = 0;
          break;

        case ESTADO.BLOQUEADO:
          bloqueado = true;
          break;

        case ESTADO.ERROR:
        default:
          erroresSeguidos++;
          log(`   ⚠️  Error: ${r.detalle}${r.captura ? ` (captura: ${r.captura})` : ''}`);
          if (r.page) {
            await notificar(cfg.notificaciones, `Cita de ${p.nombre} retenida con problemas`, `${r.detalle}. Intenta terminarla en el navegador.`);
            const resp = await pregunta(`¿Conseguiste terminarla? (s = sí / Enter = seguir buscando): `);
            await r.context.close().catch(() => {});
            if (/^s/i.test(resp)) marcarHecha(p, 'Terminada a mano en el navegador');
          }
          if (erroresSeguidos >= 5) {
            await notificar(cfg.notificaciones, 'El buscador se detuvo', `5 errores seguidos. Último: ${r.detalle}`);
            return cerrar();
          }
      }
      if (bloqueado) break;
      // Pausa corta entre personas para no encadenar peticiones a la sede
      if (i < turno.length - 1) await dormir(esperaAleatoria(cfg.pausaEntrePersonasMinutos));
    }

    if (bloqueado) {
      log(`⛔ La sede ha bloqueado las peticiones. Pausa de ${cfg.pausaBloqueoMinutos} min.`);
      await dormir(cfg.pausaBloqueoMinutos * 60_000);
      continue;
    }
    if (!pendientes().length) break;
    if (opts.unaVez || (cfg.maxIntentos && ciclo >= cfg.maxIntentos)) return cerrar();
    const espera = esperaAleatoria(cfg.intervaloMinutos);
    log(`Próxima ronda en ${Math.round(espera / 60_000)} min.`);
    await dormir(espera);
  }

  log('🎉 Todas las personas tienen cita. Fin.');
  return cerrar();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
