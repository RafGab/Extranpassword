'use strict';

/**
 * Servidor que imita las pantallas (y los id de los campos) de la sede ICP
 * para probar el flujo sin tocar la web real.
 * escenario: 'sin-citas' | 'con-citas' | 'bloqueo' | 'fuera-rango'
 */
const http = require('http');

function pagina(cuerpo) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>ICP</title></head><body>${cuerpo}</body></html>`;
}

function form(accion, contenido, boton = 'btnAceptar', texto = 'Aceptar') {
  return `<form method="POST" action="${accion}">${contenido}<input type="submit" id="${boton}" value="${texto}"></form>`;
}

function crearSede(escenario) {
  const registro = { peticiones: [], datos: {} };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const params = Object.fromEntries(new URLSearchParams(body));
      Object.assign(registro.datos, params);
      const url = req.url.split('?')[0];
      registro.peticiones.push(url);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');

      if (escenario === 'bloqueo' && url !== '/icpplus/index.html') {
        return res.end(pagina('<h1>The requested URL was rejected. Please consult with your administrator.</h1>'));
      }

      switch (url) {
        case '/icpplus/index.html':
          return res.end(pagina(form('/icpplus/citar',
            `<select id="form" name="form"><option value="">Seleccione</option>
             <option value="/icpplus/citar?p=8">Barcelona</option>
             <option value="/icpplus/citar?p=28">Madrid</option>
             <option value="/icpplus/citar?p=46">Valencia</option></select>`)));
        case '/icpplus/citar':
          return res.end(pagina(form('/icpplus/acInfo',
            `<select id="sede" name="sede"><option value="99">Cualquier oficina</option>
               <option value="1">CNP Aluche, Calle General Ricardos</option>
               <option value="2">CNP Moratalaz, Calle Fuente Carrantona</option></select>
             <select id="tramiteGrupo[0]" name="tramiteGrupo[0]"><option value="-1">Seleccione</option>
               <option value="4036">AUTORIZACIONES DE REGRESO</option></select>
             <select id="tramiteGrupo[1]" name="tramiteGrupo[1]"><option value="-1">Seleccione</option>
               <option value="4038">POLICIA-CERTIFICADO DE REGISTRO DE CIUDADANO DE LA U.E.</option>
               <option value="4010">POLICIA-TOMA DE HUELLAS (EXPEDICIÓN DE TARJETA) Y RENOVACIÓN DE TARJETA DE LARGA DURACIÓN</option></select>`)));
        case '/icpplus/acInfo':
          return res.end(pagina(`<p>Requisitos del trámite...</p>${form('/icpplus/acEntrada', '', 'btnEntrar', 'Entrar')}`));
        case '/icpplus/acEntrada':
          return res.end(pagina(form('/icpplus/acValidarEntrada',
            `<input type="radio" id="rdbTipoDocNie" name="rdbTipoDoc" value="N" checked>
             <input type="radio" id="rdbTipoDocPas" name="rdbTipoDoc" value="P">
             <input id="txtIdCitado" name="txtIdCitado"><input id="txtDesCitado" name="txtDesCitado">
             <select id="txtPaisNac" name="txtPaisNac"><option value="">Seleccionar</option>
               <option value="239">COLOMBIA</option><option value="340">PERÚ</option><option value="402">VENEZUELA</option></select>`,
            'btnEnviar', 'Aceptar')));
        case '/icpplus/acValidarEntrada':
          return res.end(pagina(form('/icpplus/acCitar', '', 'btnEnviar', 'Solicitar Cita')));
        case '/icpplus/acCitar':
          if (escenario === 'sin-citas') {
            return res.end(pagina('<p>En este momento no hay citas disponibles.</p><p>En breve, la Oficina pondrá a su disposición nuevas citas.</p>'));
          }
          return res.end(pagina(form('/icpplus/acVerFormulario',
            `<select id="idSede" name="idSede"><option value="">Seleccione</option>
               <option value="2">CNP Moratalaz, Calle Fuente Carrantona</option></select>`,
            'btnSiguiente', 'Siguiente')));
        case '/icpplus/acVerFormulario':
          return res.end(pagina(form('/icpplus/acOfertarCita',
            `<input id="txtTelefonoCitado" name="txtTelefonoCitado">
             <input id="emailUNO" name="emailUNO"><input id="emailDOS" name="emailDOS">`,
            'btnSiguiente', 'Siguiente')));
        case '/icpplus/acOfertarCita': {
          const fechas = escenario === 'fuera-rango'
            ? ['10/03/2027', '11/03/2027']
            : ['20/11/2026', '18/11/2026'];
          return res.end(pagina(form('/icpplus/acGrabarCita',
            `<p>Seleccione una de las siguientes citas</p>
             <table><tr><td><input type="radio" id="cita1" name="rdbCita" value="1"> CITA 1</td>
               <td>Día: ${fechas[0]} Hora: 10:30</td></tr></table>
             <table><tr><td><input type="radio" id="cita2" name="rdbCita" value="2"> CITA 2</td>
               <td>Día: ${fechas[1]} Hora: 09:15</td></tr></table>
             <script>document.querySelector('form').addEventListener('submit', e => { if(!confirm('¿Confirmar?')) e.preventDefault(); });</script>`,
            'btnSiguiente', 'Siguiente')));
        }
        case '/icpplus/acGrabarCita':
          return res.end(pagina(form('/icpplus/acConfirmar',
            `<p>Cita retenida. Introduzca el código recibido por SMS.</p>
             <input type="checkbox" id="chkTotal" name="chkTotal">
             <input type="checkbox" id="enviarCorreo" name="enviarCorreo">
             <input id="txtCodigoVerificacion" name="txtCodigoVerificacion">`,
            'btnConfirmar', 'Confirmar')));
        case '/icpplus/acConfirmar':
          if (params.txtCodigoVerificacion !== '123456') {
            return res.end(pagina('<p>El código de verificación no es correcto</p>'));
          }
          return res.end(pagina('<h1>CITA CONFIRMADA Y GRABADA</h1><p>Número de justificante de cita: ABC123XYZ</p>'));
        default:
          res.statusCode = 404;
          return res.end('no encontrado');
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/icpplus/index.html`,
        registro,
        cerrar: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

module.exports = { crearSede };
