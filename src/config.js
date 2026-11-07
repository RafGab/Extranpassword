'use strict';

const fs = require('fs');
const path = require('path');

const POR_DEFECTO = {
  oficina: ['Cualquier oficina'],
  tramite: 'TOMA DE HUELLAS',
  tipoDocumento: 'NIE',
  anioNacimiento: '',
  fechaCaducidad: '',
  modo: 'reservar',
  fechaMinima: '',
  fechaMaxima: '',
  intervaloMinutos: [4, 8],
  pausaBloqueoMinutos: 30,
  pausaEntrePersonasMinutos: [0.5, 1.5],
  horario: { desde: '00:00', hasta: '23:59' },
  maxIntentos: 0,
  navegador: { visible: true, lentitudMs: 150 },
  notificaciones: { sonido: true, telegram: {}, ntfy: {} },
  urlInicio: 'https://icp.administracionelectronica.gob.es/icpplus/index.html',
};

const MODOS = ['avisar', 'reservar'];
const TIPOS_DOC = ['NIE', 'PASAPORTE', 'DNI'];

function parseFecha(txt) {
  if (!txt) return null;
  // Acepta dd/mm/aaaa o aaaa-mm-dd
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(txt.trim());
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(txt.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return undefined;
}

const CAMPOS_PERSONA = [
  'nombre', 'documento', 'tipoDocumento', 'paisNacionalidad', 'anioNacimiento', 'fechaCaducidad',
  'provincia', 'oficina', 'tramite', 'telefono', 'email', 'fechaMinima', 'fechaMaxima',
];

/** Comprueba la letra de control de un NIE (X/Y/Z + 7 dígitos + letra) o DNI. */
function documentoValido(tipo, doc) {
  const LETRAS = 'TRWAGMYFPDXBNJZSQVHLCKE';
  if (tipo === 'NIE') {
    const m = /^([XYZ])(\d{7})([A-Z])$/.exec(doc);
    if (!m) return false;
    return LETRAS[Number('XYZ'.indexOf(m[1]) + m[2]) % 23] === m[3];
  }
  if (tipo === 'DNI') {
    const m = /^(\d{8})([A-Z])$/.exec(doc);
    return !!m && LETRAS[Number(m[1]) % 23] === m[2];
  }
  return doc.length >= 5;
}

function validarPersona(p) {
  const errores = [];
  for (const campo of ['provincia', 'documento', 'nombre', 'paisNacionalidad']) {
    if (!p[campo] || String(p[campo]).trim() === '') errores.push(`Falta "${campo}"`);
  }
  if (typeof p.provincia !== 'string') errores.push('"provincia" debe ser una sola provincia (texto), no una lista');
  if (p.modo === 'reservar') {
    if (!p.telefono) errores.push('Falta "telefono" (necesario en modo "reservar")');
    if (!p.email) errores.push('Falta "email" (necesario en modo "reservar")');
  }
  if (!TIPOS_DOC.includes(p.tipoDocumento)) {
    errores.push(`"tipoDocumento" debe ser uno de: ${TIPOS_DOC.join(', ')}`);
  } else if (p.documento && !documentoValido(p.tipoDocumento, p.documento)) {
    errores.push(`El ${p.tipoDocumento} "${p.documento}" no es válido (revisa números y letra)`);
  }
  for (const f of ['fechaMinima', 'fechaMaxima', 'fechaCaducidad']) {
    if (p[f] && parseFecha(p[f]) === undefined) errores.push(`"${f}" no es una fecha válida (usa dd/mm/aaaa)`);
  }
  if (p.documento === 'Y1234567X') errores.push('Cambia "documento" por el NIE/pasaporte real');
  return errores;
}

function validar(c) {
  const errores = [];
  if (!MODOS.includes(c.modo)) errores.push(`"modo" debe ser uno de: ${MODOS.join(', ')}`);
  if (!Array.isArray(c.intervaloMinutos) || c.intervaloMinutos.length !== 2) {
    errores.push('"intervaloMinutos" debe ser [minimo, maximo]');
  } else if (c.intervaloMinutos[0] < 2) {
    errores.push('"intervaloMinutos" mínimo es 2 minutos: consultas más frecuentes provocan bloqueos de la sede');
  }
  if (!c.personas.length) errores.push('No hay ninguna persona en "personas"');
  const vistos = new Set();
  c.personas.forEach((p, i) => {
    const quien = `Persona ${i + 1} (${p.nombre || 'sin nombre'})`;
    for (const e of validarPersona(p)) errores.push(`${quien}: ${e}`);
    if (p.documento && vistos.has(p.documento)) {
      errores.push(`${quien}: el documento ${p.documento} está repetido; cada persona va una sola vez, con una sola provincia`);
    }
    vistos.add(p.documento);
  });
  return errores;
}

function normalizarPersona(base, datosPersona) {
  const p = { ...base, ...datosPersona };
  if (typeof p.oficina === 'string') p.oficina = [p.oficina];
  p.tipoDocumento = String(p.tipoDocumento || 'NIE').toUpperCase();
  p.documento = String(p.documento || '').replace(/[\s-]/g, '').toUpperCase();
  p.nombre = String(p.nombre || '').trim().replace(/\s+/g, ' ').toUpperCase();
  return p;
}

function cargarConfig(ruta) {
  const abs = path.resolve(ruta);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `No existe ${abs}.\nCopia config.example.json a config.json y rellena tus datos:\n  cp config.example.json config.json`
    );
  }
  let datos;
  try {
    datos = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    throw new Error(`config.json no es JSON válido: ${e.message}`);
  }
  const { personas, ...comun } = datos;
  const c = {
    ...POR_DEFECTO,
    ...comun,
    horario: { ...POR_DEFECTO.horario, ...(comun.horario || {}) },
    navegador: { ...POR_DEFECTO.navegador, ...(comun.navegador || {}) },
    notificaciones: { ...POR_DEFECTO.notificaciones, ...(comun.notificaciones || {}) },
  };
  // Cada persona hereda los ajustes comunes (teléfono, email, modo...) y puede sobrescribirlos.
  const lista = Array.isArray(personas) ? personas : [Object.fromEntries(CAMPOS_PERSONA.map((k) => [k, comun[k]]).filter(([, v]) => v !== undefined))];
  c.personas = lista.map((p) => normalizarPersona(c, p));
  return c;
}

module.exports = { cargarConfig, validar, parseFecha, documentoValido };
