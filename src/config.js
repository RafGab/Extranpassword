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

function validar(c) {
  const errores = [];
  for (const campo of ['provincia', 'documento', 'nombre', 'paisNacionalidad']) {
    if (!c[campo] || String(c[campo]).trim() === '') errores.push(`Falta "${campo}"`);
  }
  if (c.modo === 'reservar') {
    if (!c.telefono) errores.push('Falta "telefono" (necesario en modo "reservar")');
    if (!c.email) errores.push('Falta "email" (necesario en modo "reservar")');
  }
  if (!MODOS.includes(c.modo)) errores.push(`"modo" debe ser uno de: ${MODOS.join(', ')}`);
  if (!TIPOS_DOC.includes(String(c.tipoDocumento).toUpperCase())) {
    errores.push(`"tipoDocumento" debe ser uno de: ${TIPOS_DOC.join(', ')}`);
  }
  if (!Array.isArray(c.intervaloMinutos) || c.intervaloMinutos.length !== 2) {
    errores.push('"intervaloMinutos" debe ser [minimo, maximo]');
  } else if (c.intervaloMinutos[0] < 2) {
    errores.push('"intervaloMinutos" mínimo es 2 minutos: consultas más frecuentes provocan bloqueos de la sede');
  }
  for (const f of ['fechaMinima', 'fechaMaxima', 'fechaCaducidad']) {
    if (c[f] && parseFecha(c[f]) === undefined) errores.push(`"${f}" no es una fecha válida (usa dd/mm/aaaa)`);
  }
  if (c.documento && c.documento === 'Y1234567X') errores.push('Cambia "documento" por tu NIE/pasaporte real');
  return errores;
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
  const c = {
    ...POR_DEFECTO,
    ...datos,
    horario: { ...POR_DEFECTO.horario, ...(datos.horario || {}) },
    navegador: { ...POR_DEFECTO.navegador, ...(datos.navegador || {}) },
    notificaciones: { ...POR_DEFECTO.notificaciones, ...(datos.notificaciones || {}) },
  };
  if (typeof c.oficina === 'string') c.oficina = [c.oficina];
  c.tipoDocumento = String(c.tipoDocumento).toUpperCase();
  c.documento = String(c.documento || '').trim().toUpperCase();
  c.nombre = String(c.nombre || '').trim().toUpperCase();
  return c;
}

module.exports = { cargarConfig, validar, parseFecha };
