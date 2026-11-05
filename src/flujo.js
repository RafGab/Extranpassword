'use strict';

/**
 * Recorre el flujo de la sede ICP (cita previa de Extranjería):
 *
 *  1. Provincia                     -> #form           + #btnAceptar
 *  2. Oficina + trámite             -> #sede, #tramiteGrupo[n] + #btnAceptar
 *  3. Información del trámite       -> #btnEntrar
 *  4. Datos personales              -> #txtIdCitado, #txtDesCitado, #txtPaisNac ... + #btnEnviar
 *  5. Menú                          -> #btnEnviar ("Solicitar Cita")
 *  6. ¿Hay citas? / elegir oficina  -> "no hay citas disponibles" | #idSede + #btnSiguiente
 *  7. Contacto                      -> #txtTelefonoCitado, #emailUNO, #emailDOS + #btnSiguiente
 *  8. Huecos disponibles            -> radios de cita + #btnSiguiente
 *  9. Confirmación                  -> #chkTotal, #enviarCorreo, #txtCodigoVerificacion (SMS) + #btnConfirmar
 *
 * La sede cambia de vez en cuando; por eso cada paso acepta varios selectores
 * alternativos y las opciones de los desplegables se buscan por texto.
 */

const fs = require('fs');
const path = require('path');
const { log } = require('./notificar');
const { parseFecha } = require('./config');

const ESTADO = {
  SIN_CITAS: 'SIN_CITAS',
  CITAS_DISPONIBLES: 'CITAS_DISPONIBLES', // modo "avisar": se detiene antes de reservar
  FUERA_DE_RANGO: 'FUERA_DE_RANGO', // hay huecos pero ninguno entre fechaMinima/fechaMaxima
  RESERVADA: 'RESERVADA',
  BLOQUEADO: 'BLOQUEADO',
  ERROR: 'ERROR',
};

const TIMEOUT_PASO = 30_000;

const normalizar = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

async function existe(page, selector) {
  return (await page.locator(selector).count()) > 0;
}

async function primeroQueExista(page, selectores) {
  for (const s of selectores) if (await existe(page, s)) return s;
  return null;
}

async function textoPagina(page) {
  try {
    return normalizar(await page.locator('body').innerText({ timeout: 5000 }));
  } catch {
    return '';
  }
}

/** Selecciona en un <select> la primera opción cuyo texto contenga alguno de `textos`. */
async function seleccionarPorTexto(page, selector, textos, { obligatorio = true } = {}) {
  const opciones = await page.locator(`${selector} option`).evaluateAll((ops) =>
    ops.map((o) => ({ value: o.value, label: o.textContent || '' }))
  );
  const lista = Array.isArray(textos) ? textos : [textos];
  for (const t of lista) {
    const buscado = normalizar(t);
    const op = opciones.find((o) => o.value && normalizar(o.label).includes(buscado));
    if (op) {
      await page.selectOption(selector, op.value);
      return op.label.trim();
    }
  }
  if (obligatorio) {
    const disponibles = opciones.map((o) => o.label.trim()).filter(Boolean).join(' | ');
    throw new Error(`No encuentro "${lista.join('" / "')}" en ${selector}. Opciones: ${disponibles}`);
  }
  return null;
}

async function clicYEsperar(page, selector) {
  await Promise.all([
    page.waitForLoadState('domcontentloaded', { timeout: TIMEOUT_PASO }).catch(() => {}),
    page.locator(selector).first().click({ timeout: TIMEOUT_PASO }),
  ]);
  await page.waitForLoadState('domcontentloaded', { timeout: TIMEOUT_PASO }).catch(() => {});
}

function estaBloqueado(texto) {
  return [
    'THE REQUESTED URL WAS REJECTED',
    'TOO MANY REQUESTS',
    'DEMASIADAS PETICIONES',
    'HA SUPERADO EL NUMERO MAXIMO',
    'ACCESO DENEGADO',
  ].some((m) => texto.includes(m));
}

function sinCitas(texto) {
  return texto.includes('NO HAY CITAS DISPONIBLES') || texto.includes('NO EXISTEN CITAS DISPONIBLES');
}

async function verificarBloqueo(page) {
  const t = await textoPagina(page);
  if (estaBloqueado(t)) {
    const e = new Error('La sede ha bloqueado temporalmente las peticiones');
    e.estado = ESTADO.BLOQUEADO;
    throw e;
  }
  return t;
}

async function guardarEvidencia(page, nombre) {
  const dir = path.resolve('capturas');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${nombre}`);
  await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
  fs.writeFileSync(`${base}.html`, await page.content().catch(() => ''));
  return `${base}.png`;
}

// ---------------------------------------------------------------- pasos

async function pasoProvincia(page, cfg) {
  await page.goto(cfg.urlInicio, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await verificarBloqueo(page);
  const sel = await primeroQueExista(page, ['select#form', 'select[name="form"]', 'select#provincia']);
  if (!sel) throw new Error('No aparece el desplegable de provincias');
  const elegida = await seleccionarPorTexto(page, sel, cfg.provincia);
  log(`Provincia: ${elegida}`);
  await clicYEsperar(page, '#btnAceptar');
}

async function pasoTramite(page, cfg) {
  await verificarBloqueo(page);
  const selSede = await primeroQueExista(page, ['select#sede', 'select[name="sede"]']);
  if (selSede) {
    const oficina = await seleccionarPorTexto(page, selSede, [...cfg.oficina, 'CUALQUIER OFICINA'], {
      obligatorio: false,
    });
    if (oficina) log(`Oficina: ${oficina}`);
  }
  // Hay varios desplegables de trámite (uno por grupo); usamos el que contenga la opción.
  const grupos = page.locator('select[id^="tramiteGrupo"], select[name^="tramiteGrupo"]');
  const n = await grupos.count();
  if (n === 0) throw new Error('No aparece el desplegable de trámites');
  let elegido = null;
  for (let i = 0; i < n && !elegido; i++) {
    const id = await grupos.nth(i).getAttribute('id');
    const selector = id ? `select[id="${id}"]` : `select[name^="tramiteGrupo"] >> nth=${i}`;
    elegido = await seleccionarPorTexto(page, selector, cfg.tramite, { obligatorio: false });
  }
  if (!elegido) throw new Error(`No encuentro el trámite "${cfg.tramite}" en esta provincia/oficina`);
  log(`Trámite: ${elegido}`);
  await clicYEsperar(page, '#btnAceptar');
}

async function pasoEntrar(page) {
  await verificarBloqueo(page);
  if (await existe(page, '#btnEntrar')) await clicYEsperar(page, '#btnEntrar');
}

async function pasoDatosPersonales(page, cfg) {
  await verificarBloqueo(page);
  await page.waitForSelector('#txtIdCitado', { timeout: TIMEOUT_PASO });

  const radios = { NIE: '#rdbTipoDocNie', PASAPORTE: '#rdbTipoDocPas', DNI: '#rdbTipoDocDni' };
  const radio = radios[cfg.tipoDocumento];
  if (radio && (await existe(page, radio))) await page.check(radio);

  await page.fill('#txtIdCitado', cfg.documento);
  await page.fill('#txtDesCitado', cfg.nombre);

  if (await existe(page, '#txtAnnoCitado')) {
    if (!cfg.anioNacimiento) throw new Error('La sede pide año de nacimiento: rellena "anioNacimiento"');
    await page.fill('#txtAnnoCitado', String(cfg.anioNacimiento));
  }
  if (await existe(page, '#txtPaisNac')) {
    await seleccionarPorTexto(page, '#txtPaisNac', cfg.paisNacionalidad);
  }
  if (await existe(page, '#txtFecha')) {
    if (!cfg.fechaCaducidad) throw new Error('La sede pide fecha de caducidad de la tarjeta: rellena "fechaCaducidad"');
    await page.fill('#txtFecha', cfg.fechaCaducidad);
  }
  await clicYEsperar(page, '#btnEnviar');
}

async function pasoSolicitar(page) {
  const t = await verificarBloqueo(page);
  if (t.includes('NO SE HA PODIDO VALIDAR') || t.includes('DATOS INCORRECTOS')) {
    throw new Error('La sede rechazó los datos personales; revísalos en config.json');
  }
  if (await existe(page, '#btnEnviar')) await clicYEsperar(page, '#btnEnviar');
}

async function pasoElegirOficina(page, cfg) {
  if (!(await existe(page, '#idSede'))) return null;
  const preferidas = cfg.oficina.filter((o) => normalizar(o) !== 'CUALQUIER OFICINA');
  let elegida = preferidas.length
    ? await seleccionarPorTexto(page, '#idSede', preferidas, { obligatorio: false })
    : null;
  if (!elegida) {
    // Primera oficina con valor
    elegida = await page.locator('#idSede option').evaluateAll((ops) => {
      const o = ops.find((x) => x.value);
      return o ? o.textContent.trim() : null;
    });
    if (!elegida) return null;
    await seleccionarPorTexto(page, '#idSede', elegida);
  }
  return elegida;
}

async function pasoContacto(page, cfg) {
  await page.fill('#txtTelefonoCitado', String(cfg.telefono));
  for (const s of ['#emailUNO', '#emailDOS']) if (await existe(page, s)) await page.fill(s, cfg.email);
  await clicYEsperar(page, '#btnSiguiente');
}

const RE_FECHA = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
const RE_HORA = /(\d{1,2}):(\d{2})/;

/** Devuelve los huecos de cita de la página con su fecha (si se puede leer). */
async function leerHuecos(page) {
  const huecos = await page
    .locator('input[type="radio"][id^="cita"], input[type="radio"][name="rdbCita"], input[type="radio"][id^="HUECO"]')
    .evaluateAll((radios) =>
      radios.map((r) => {
        const cont = r.closest('tr, li, div, table, label') || r.parentElement;
        const lbl = r.id ? document.querySelector(`label[for="${r.id}"]`) : null;
        return { id: r.id, value: r.value, texto: `${lbl ? lbl.textContent : ''} ${cont ? cont.textContent : ''}` };
      })
    );
  return huecos.map((h) => {
    const f = RE_FECHA.exec(h.texto);
    const hr = RE_HORA.exec(h.texto);
    const fecha = f ? new Date(Number(f[3]), Number(f[2]) - 1, Number(f[1]), hr ? Number(hr[1]) : 0, hr ? Number(hr[2]) : 0) : null;
    return { ...h, fecha, descripcion: [f && f[0], hr && hr[0]].filter(Boolean).join(' ') || h.texto.trim().slice(0, 80) };
  });
}

function filtrarHuecos(huecos, cfg) {
  const min = parseFecha(cfg.fechaMinima);
  let max = parseFecha(cfg.fechaMaxima);
  if (max) max = new Date(max.getFullYear(), max.getMonth(), max.getDate(), 23, 59, 59);
  return huecos
    .filter((h) => !h.fecha || ((!min || h.fecha >= min) && (!max || h.fecha <= max)))
    .sort((a, b) => (a.fecha && b.fecha ? a.fecha - b.fecha : 0));
}

async function pasoConfirmar(page, cfg, opciones) {
  await page.waitForLoadState('domcontentloaded');
  await verificarBloqueo(page);
  if (await existe(page, '#chkTotal')) await page.check('#chkTotal');
  if (await existe(page, '#enviarCorreo')) await page.check('#enviarCorreo');

  if (await existe(page, '#txtCodigoVerificacion')) {
    const codigo = await opciones.pedirCodigoSMS();
    if (codigo) {
      await page.fill('#txtCodigoVerificacion', codigo);
      await clicYEsperar(page, '#btnConfirmar');
    } else {
      log('Esperando a que completes la confirmación en el navegador (máx. 10 min)...');
    }
  } else if (await existe(page, '#btnConfirmar')) {
    await clicYEsperar(page, '#btnConfirmar');
  }

  // Esperar el justificante (lo confirma el bot o la persona en el navegador)
  const limite = Date.now() + 10 * 60_000;
  while (Date.now() < limite) {
    const t = await textoPagina(page);
    if (t.includes('CITA CONFIRMADA') || t.includes('JUSTIFICANTE DE CITA') || t.includes('NUMERO DE JUSTIFICANTE')) {
      return t;
    }
    if (t.includes('CODIGO INCORRECTO') || t.includes('CODIGO DE VERIFICACION NO ES CORRECTO')) {
      log('El código SMS no es correcto; introdúcelo de nuevo en el navegador.');
    }
    await page.waitForTimeout(3000);
  }
  throw new Error('No se completó la confirmación a tiempo; la cita retenida caducará');
}

/**
 * Ejecuta un intento completo en una sesión nueva.
 * @param {import('playwright').Browser} browser
 * @param {object} cfg
 * @param {{pedirCodigoSMS: () => Promise<string>, alEncontrar: (info:object) => Promise<void>}} opciones
 * @returns {Promise<{estado: string, detalle?: string, captura?: string, page?: any, context?: any}>}
 */
async function intentar(browser, cfg, opciones) {
  const context = await browser.newContext({ locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT_PASO);
  // La sede usa alert/confirm (p. ej. "¿Desea confirmar la cita?"): se aceptan.
  page.on('dialog', (d) => d.accept().catch(() => {}));
  let mantenerAbierto = false;

  try {
    await pasoProvincia(page, cfg);
    await pasoTramite(page, cfg);
    await pasoEntrar(page);
    await pasoDatosPersonales(page, cfg);
    await pasoSolicitar(page);

    let t = await verificarBloqueo(page);
    if (sinCitas(t)) return { estado: ESTADO.SIN_CITAS };

    const oficina = await pasoElegirOficina(page, cfg);
    if (oficina !== null || (await existe(page, '#txtTelefonoCitado'))) {
      const detalle = oficina ? `Oficina disponible: ${oficina}` : 'Hay citas disponibles';
      if (cfg.modo === 'avisar') {
        mantenerAbierto = true;
        const captura = await guardarEvidencia(page, 'citas-disponibles');
        await opciones.alEncontrar({ detalle, reservando: false });
        return { estado: ESTADO.CITAS_DISPONIBLES, detalle, captura, page, context };
      }
      await opciones.alEncontrar({ detalle, reservando: true });
      if (oficina !== null) await clicYEsperar(page, '#btnSiguiente');
    }

    t = await verificarBloqueo(page);
    if (sinCitas(t)) return { estado: ESTADO.SIN_CITAS, detalle: 'Las citas se agotaron al elegir oficina' };

    if (await existe(page, '#txtTelefonoCitado')) await pasoContacto(page, cfg);

    t = await verificarBloqueo(page);
    if (sinCitas(t)) return { estado: ESTADO.SIN_CITAS, detalle: 'Las citas se agotaron al dar el teléfono' };

    const huecos = await leerHuecos(page);
    if (huecos.length === 0) {
      const captura = await guardarEvidencia(page, 'pagina-desconocida');
      return { estado: ESTADO.ERROR, detalle: 'No reconozco la página de huecos', captura };
    }
    const validos = filtrarHuecos(huecos, cfg);
    log(`Huecos: ${huecos.map((h) => h.descripcion).join(', ')}`);
    if (validos.length === 0) {
      return { estado: ESTADO.FUERA_DE_RANGO, detalle: `Huecos fuera de tus fechas: ${huecos.map((h) => h.descripcion).join(', ')}` };
    }
    const hueco = validos[0];
    log(`Reteniendo hueco: ${hueco.descripcion}`);
    await page.check(hueco.id ? `input[id="${hueco.id}"]` : `input[type="radio"][value="${hueco.value}"]`);
    await clicYEsperar(page, '#btnSiguiente');

    mantenerAbierto = true; // si algo falla aquí, la persona puede terminar a mano
    const textoFinal = await pasoConfirmar(page, cfg, opciones);
    const captura = await guardarEvidencia(page, 'cita-confirmada');
    const just = /JUSTIFICANTE(?: DE CITA)?\s*:?\s*([A-Z0-9]{6,})/.exec(textoFinal);
    mantenerAbierto = false;
    return {
      estado: ESTADO.RESERVADA,
      detalle: `Cita: ${hueco.descripcion}${oficina ? ` en ${oficina}` : ''}${just ? ` · Justificante ${just[1]}` : ''}`,
      captura,
    };
  } catch (e) {
    if (e.estado === ESTADO.BLOQUEADO) return { estado: ESTADO.BLOQUEADO, detalle: e.message };
    const captura = await guardarEvidencia(page, 'error');
    return { estado: ESTADO.ERROR, detalle: e.message.split('\n')[0], captura, page: mantenerAbierto ? page : undefined, context: mantenerAbierto ? context : undefined };
  } finally {
    if (!mantenerAbierto) await context.close().catch(() => {});
  }
}

module.exports = { intentar, ESTADO, normalizar, filtrarHuecos };
