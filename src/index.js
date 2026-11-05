#!/usr/bin/env node
'use strict';

const readline = require('readline');
const { cargarConfig, validar } = require('./config');
const { intentar, ESTADO } = require('./flujo');
const { notificar, log } = require('./notificar');

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

  log(`Buscando cita "${cfg.tramite}" en ${cfg.provincia} · modo ${cfg.modo}`);
  if (!cfg.navegador.visible) log('Navegador oculto: el código SMS tendrás que escribirlo aquí, en la terminal.');

  const opcionesFlujo = {
    alEncontrar: async ({ detalle, reservando }) => {
      await notificar(
        cfg.notificaciones,
        '¡Hay citas de huellas!',
        `${cfg.provincia}: ${detalle}. ${reservando ? 'Intentando reservar...' : 'Entra ya a reservar en el navegador.'}`
      );
    },
    pedirCodigoSMS: async () => {
      await notificar(cfg.notificaciones, 'Cita retenida: falta el SMS', `Te ha llegado un código al ${cfg.telefono}. Escríbelo en la terminal o en el navegador.`);
      return pregunta('Código SMS (o Enter para escribirlo tú en el navegador): ', 9 * 60_000);
    },
  };

  let intento = 0;
  let erroresSeguidos = 0;
  for (;;) {
    if (!dentroDeHorario(cfg.horario)) {
      log(`Fuera de horario (${cfg.horario.desde}-${cfg.horario.hasta}); espero 10 min.`);
      await dormir(10 * 60_000);
      continue;
    }
    intento++;
    log(`Intento #${intento}`);
    const r = await intentar(browser, cfg, opcionesFlujo);

    switch (r.estado) {
      case ESTADO.RESERVADA:
        await notificar(cfg.notificaciones, '✅ CITA RESERVADA', `${r.detalle}. Captura: ${r.captura}`);
        log('Revisa tu correo: la sede envía el justificante. ¡Imprímelo y llévalo a la cita!');
        return cerrar();

      case ESTADO.CITAS_DISPONIBLES:
        log(`${r.detalle}. Completa la reserva en la ventana del navegador.`);
        await pregunta('Pulsa Enter cuando termines (se cerrará el navegador)... ');
        return cerrar();

      case ESTADO.SIN_CITAS:
        log(`Sin citas.${r.detalle ? ` ${r.detalle}` : ''}`);
        erroresSeguidos = 0;
        break;

      case ESTADO.FUERA_DE_RANGO:
        log(r.detalle);
        erroresSeguidos = 0;
        break;

      case ESTADO.BLOQUEADO:
        log(`⛔ ${r.detalle}. Pausa de ${cfg.pausaBloqueoMinutos} min.`);
        await dormir(cfg.pausaBloqueoMinutos * 60_000);
        continue;

      case ESTADO.ERROR:
      default:
        erroresSeguidos++;
        log(`⚠️  Error: ${r.detalle}${r.captura ? ` (captura: ${r.captura})` : ''}`);
        if (r.page) {
          await notificar(cfg.notificaciones, 'Cita retenida con problemas', `${r.detalle}. Intenta terminarla en el navegador.`);
          await pregunta('Pulsa Enter para continuar buscando... ');
          await r.context.close().catch(() => {});
        }
        if (erroresSeguidos >= 5) {
          await notificar(cfg.notificaciones, 'El buscador se detuvo', `5 errores seguidos. Último: ${r.detalle}`);
          return cerrar();
        }
    }

    if (opts.unaVez || (cfg.maxIntentos && intento >= cfg.maxIntentos)) return cerrar();
    const espera = esperaAleatoria(cfg.intervaloMinutos);
    log(`Próximo intento en ${Math.round(espera / 60_000)} min.`);
    await dormir(espera);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
