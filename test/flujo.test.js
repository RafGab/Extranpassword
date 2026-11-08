'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { crearSede } = require('./sede-simulada');
const { intentar, ESTADO, filtrarHuecos } = require('../src/flujo');
const { validar, cargarConfig } = require('../src/config');

// Las capturas se guardan en ./capturas: en los tests, en un directorio temporal
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'citas-')));

function cfgBase(url, extra = {}) {
  return {
    urlInicio: url,
    provincia: 'Madrid',
    oficina: ['Cualquier oficina'],
    tramite: 'TOMA DE HUELLAS',
    tipoDocumento: 'NIE',
    documento: 'X0000000T',
    nombre: 'PERSONA DE PRUEBA',
    paisNacionalidad: 'Colombia',
    telefono: '600111222',
    email: 'prueba@ejemplo.com',
    modo: 'reservar',
    fechaMinima: '',
    fechaMaxima: '',
    ...extra,
  };
}

const opciones = (codigo = '123456') => ({
  alEncontrar: async () => {},
  pedirCodigoSMS: async () => codigo,
  resolverCaptcha: async () => { throw new Error('no debería pedirse captcha'); },
});

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

test('sin citas disponibles', async () => {
  const sede = await crearSede('sin-citas');
  try {
    const r = await intentar(browser, cfgBase(sede.url), opciones());
    assert.strictEqual(r.estado, ESTADO.SIN_CITAS, r.detalle);
    assert.strictEqual(sede.registro.datos.txtIdCitado, 'X0000000T');
    assert.strictEqual(sede.registro.datos.txtPaisNac, '239');
    assert.strictEqual(sede.registro.datos['tramiteGrupo[1]'], '4010');
  } finally { await sede.cerrar(); }
});

test('reserva completa con código SMS y elige el hueco más temprano', async () => {
  const sede = await crearSede('con-citas');
  let avisado = null;
  try {
    const r = await intentar(browser, cfgBase(sede.url), {
      alEncontrar: async (i) => { avisado = i; },
      pedirCodigoSMS: async () => '123456',
      resolverCaptcha: async () => { throw new Error('no debería pedirse captcha'); },
    });
    assert.strictEqual(r.estado, ESTADO.RESERVADA, r.detalle);
    assert.match(r.detalle, /18\/11\/2026 09:15/);
    assert.match(r.detalle, /ABC123XYZ/);
    assert.ok(avisado && avisado.reservando);
    assert.strictEqual(sede.registro.datos.rdbCita, '2');
    assert.strictEqual(sede.registro.datos.emailUNO, 'prueba@ejemplo.com');
    assert.ok(fs.existsSync(r.captura));
  } finally { await sede.cerrar(); }
});

test('confirmación con captcha: espera a que la persona lo resuelva y pulse Confirmar', async () => {
  const sede = await crearSede('captcha');
  let pagina;
  let avisos = 0;
  try {
    const ctxOrig = browser.newContext.bind(browser);
    const b = { newContext: async (o) => { const c = await ctxOrig(o); c.on('page', (p) => { pagina = p; }); return c; } };
    const r = await intentar(b, cfgBase(sede.url), {
      alEncontrar: async () => {},
      pedirCodigoSMS: async () => { throw new Error('no hay SMS'); },
      resolverCaptcha: async ({ momento }) => {
        avisos++;
        assert.strictEqual(momento, 'confirmar');
        // Simula a la persona: primero se equivoca, luego acierta
        setTimeout(async () => {
          await pagina.fill('#captcha', 'MAL1');
          await pagina.click('#btnConfirmar');
          await pagina.goBack();
          await pagina.fill('#captcha', 'K7P2');
          await pagina.click('#btnConfirmar');
        }, 500);
      },
    });
    assert.strictEqual(r.estado, ESTADO.RESERVADA, r.detalle);
    assert.strictEqual(avisos, 1);
    assert.strictEqual(sede.registro.datos.captcha, 'K7P2');
    assert.strictEqual(sede.registro.datos.chkTotal, 'on');
  } finally { await sede.cerrar(); }
});

test('modo avisar se detiene antes de reservar y deja la sesión abierta', async () => {
  const sede = await crearSede('con-citas');
  try {
    const r = await intentar(browser, cfgBase(sede.url, { modo: 'avisar' }), opciones());
    assert.strictEqual(r.estado, ESTADO.CITAS_DISPONIBLES, r.detalle);
    assert.ok(r.page);
    assert.ok(!sede.registro.peticiones.includes('/icpplus/acGrabarCita'));
    await r.context.close();
  } finally { await sede.cerrar(); }
});

test('respeta el rango de fechas', async () => {
  const sede = await crearSede('fuera-rango');
  try {
    const r = await intentar(browser, cfgBase(sede.url, { fechaMaxima: '31/12/2026' }), opciones());
    assert.strictEqual(r.estado, ESTADO.FUERA_DE_RANGO, r.detalle);
    assert.ok(!sede.registro.peticiones.includes('/icpplus/acGrabarCita'));
  } finally { await sede.cerrar(); }
});

test('detecta bloqueo de la sede', async () => {
  const sede = await crearSede('bloqueo');
  try {
    const r = await intentar(browser, cfgBase(sede.url), opciones());
    assert.strictEqual(r.estado, ESTADO.BLOQUEADO, r.detalle);
  } finally { await sede.cerrar(); }
});

test('provincia inexistente da error claro', async () => {
  const sede = await crearSede('sin-citas');
  try {
    const r = await intentar(browser, cfgBase(sede.url, { provincia: 'Atlantis' }), opciones());
    assert.strictEqual(r.estado, ESTADO.ERROR);
    assert.match(r.detalle, /No encuentro "Atlantis"/);
  } finally { await sede.cerrar(); }
});

test('filtrarHuecos ordena y filtra', () => {
  const h = [
    { fecha: new Date(2026, 11, 5), descripcion: 'b' },
    { fecha: new Date(2026, 10, 20), descripcion: 'a' },
    { fecha: new Date(2027, 0, 9), descripcion: 'c' },
  ];
  const r = filtrarHuecos(h, { fechaMinima: '', fechaMaxima: '05/12/2026' });
  assert.deepStrictEqual(r.map((x) => x.descripcion), ['a', 'b']);
});

test('config de ejemplo se rechaza hasta poner datos reales', () => {
  const c = cargarConfig(path.join(__dirname, '..', 'config.example.json'));
  assert.strictEqual(c.personas.length, 2);
  assert.ok(validar(c).some((x) => x.includes('Persona 1') && x.includes('documento')));
  c.personas[0].documento = 'Y7654321G';
  assert.deepStrictEqual(validar(c), []);
  assert.ok(validar({ ...c, intervaloMinutos: [0.5, 1] }).length > 0);
});

test('cada persona hereda los datos comunes y tiene su propia provincia', () => {
  const c = cargarConfig(path.join(__dirname, '..', 'config.example.json'));
  assert.deepStrictEqual(c.personas.map((p) => p.provincia), ['Madrid', 'Barcelona']);
  assert.ok(c.personas.every((p) => p.telefono === '600000000' && p.modo === 'reservar'));
  assert.strictEqual(c.personas[1].fechaMaxima, '31/01/2027');
  assert.strictEqual(c.personas[0].fechaMaxima, '');
});

test('rechaza documentos repetidos, varias provincias por persona y NIE con letra errónea', () => {
  const c = cargarConfig(path.join(__dirname, '..', 'config.example.json'));
  c.personas[0].documento = 'Y7654321G';
  c.personas[1] = { ...c.personas[1], tipoDocumento: 'NIE', documento: 'Y7654321G' };
  assert.ok(validar(c).some((x) => x.includes('repetido')));
  c.personas[1] = { ...c.personas[0], documento: 'X0000000T', provincia: ['Madrid', 'Toledo'] };
  assert.ok(validar(c).some((x) => x.includes('una sola provincia')));
  c.personas[1] = { ...c.personas[0], documento: 'Y7654321M' };
  assert.ok(validar(c).some((x) => x.includes('no es válido')));
});

test('config antigua de una sola persona sigue funcionando', () => {
  const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-')), 'config.json');
  fs.writeFileSync(ruta, JSON.stringify({ provincia: 'Ávila', documento: 'y7654321g', nombre: 'nombre  apellidos',
    paisNacionalidad: 'PERU', telefono: '600', email: 'a@b.c' }));
  const c = cargarConfig(ruta);
  assert.deepStrictEqual(validar(c), []);
  assert.strictEqual(c.personas[0].documento, 'Y7654321G');
  assert.strictEqual(c.personas[0].nombre, 'NOMBRE APELLIDOS');
});
