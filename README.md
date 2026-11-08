# Buscador de cita previa · Toma de huellas (Extranjería)

Programa que entra en la sede oficial de cita previa de Extranjería
(<https://icp.administracionelectronica.gob.es/icpplus/index.html>), rellena tus
datos, revisa cada pocos minutos si hay huecos para **POLICÍA – TOMA DE HUELLAS
(expedición de tarjeta / TIE)** y, cuando aparece uno, te avisa y lo reserva.

Usa un navegador real (Chromium con Playwright). Tú ves lo que hace en la
ventana, y el último paso, **el captcha de confirmación, lo resuelves tú**.

## Cómo funciona

1. Elige provincia → oficina → trámite "TOMA DE HUELLAS".
2. Rellena NIE/pasaporte, nombre, país (y año de nacimiento o caducidad si la sede los pide).
3. Pulsa "Solicitar cita".
   - Si sale *"En este momento no hay citas disponibles"*, espera entre 4 y 8
     minutos (intervalo aleatorio que puedes cambiar) y vuelve a intentarlo con una sesión nueva.
   - Si hay citas, **te avisa** (pitido, Telegram y/o notificación push al móvil).
4. En modo `reservar`: elige tu oficina preferida, pone teléfono y email, escoge
   **el hueco más temprano** dentro de tus fechas y lo retiene.
5. La cita queda **retenida** y la sede pide un **captcha**. El programa pita, te
   avisa y espera hasta 10 minutos: escribe el captcha en la ventana del navegador y
   pulsa **Confirmar**. En cuanto aparece el justificante, guarda una captura en
   `capturas/` y sigue con la siguiente persona.
   (Si alguna provincia pide en su lugar un código por SMS, te lo pedirá en la terminal.)

## Instalación (una sola vez)

1. Instala **Node.js** (versión LTS) desde <https://nodejs.org> y reinicia el ordenador.
2. Descarga este proyecto: en GitHub, botón verde **Code → Download ZIP**
   (elige la rama `claude/extranjeria-citas-huellas-f0zlhb`) y descomprímelo.
   O con git: `git clone https://github.com/RafGab/Extranpassword.git`
3. Abre una terminal **dentro de la carpeta** del proyecto:
   - **Windows**: abre la carpeta, escribe `cmd` en la barra de direcciones y pulsa Enter.
   - **Mac**: clic derecho sobre la carpeta → *Nuevo terminal en la carpeta*.
4. Instala lo necesario:

```bash
npm install
npx playwright install chromium
```

5. Copia `config.example.json` como `config.json` (o usa el `config.json` que ya
   tengas) y déjalo en la carpeta del proyecto.

Edita `config.json` (no se sube a git). Arriba van los datos **comunes** (teléfono,
email, modo, intervalos, avisos) y en `personas` una entrada por persona, **cada
una con su propia provincia**:

```json
{
  "telefono": "600000000",
  "email": "correo@ejemplo.com",
  "modo": "reservar",
  "personas": [
    { "nombre": "NOMBRE APELLIDOS", "documento": "Y7654321G", "paisNacionalidad": "PERU", "provincia": "Ávila" },
    { "nombre": "OTRA PERSONA", "tipoDocumento": "PASAPORTE", "documento": "AB123456",
      "paisNacionalidad": "VENEZUELA", "provincia": "Barcelona", "oficina": ["Sant Feliu"] }
  ]
}
```

En cada ronda el programa intenta a todas las personas pendientes, una detrás de
otra, con una pausa corta entre ellas. Cuando consigue la cita de una, la guarda
en `reservadas.json` y deja de buscarle; sigue con las demás hasta que todas
tienen cita. Si necesitas buscarle otra a alguien, borra su entrada de ese archivo.

Campos de cada persona (cualquiera de los comunes también se puede poner dentro
de una persona para cambiarlo solo para ella, p. ej. otro `telefono`):

| Campo | Qué poner |
|---|---|
| `provincia` | **Una sola** provincia, como aparece en la web: `"Madrid"`, `"Ávila"`, `"Alicante"`... |
| `oficina` | Oficinas preferidas (basta un trozo del nombre, p. ej. `["Aluche", "Moratalaz"]`). `["Cualquier oficina"]` acepta cualquiera. |
| `tipoDocumento` | `"NIE"` (por defecto), `"PASAPORTE"` o `"DNI"` |
| `documento` | NIE (`Y1234567X`) o número de pasaporte. Se comprueba la letra del NIE. |
| `nombre` | Nombre y apellidos **igual que en el documento** |
| `paisNacionalidad` | Como sale en el desplegable: `"COLOMBIA"`, `"PERU"`, `"MARRUECOS"`... |
| `anioNacimiento` | Solo si la sede lo pide (algunas provincias) |
| `fechaCaducidad` | Solo para renovaciones si la sede lo pide (`dd/mm/aaaa`) |
| `fechaMinima` / `fechaMaxima` | Opcional, `dd/mm/aaaa`. Ignora huecos fuera de ese rango. |

Datos comunes:

| Campo | Qué poner |
|---|---|
| `telefono` / `email` | Teléfono de contacto y correo donde llega el justificante |
| `tramite` | Por defecto `"TOMA DE HUELLAS"` (se busca por texto) |
| `modo` | `"reservar"` (reserva automáticamente) o `"avisar"` (solo avisa y deja el navegador abierto) |
| `intervaloMinutos` | `[mín, máx]` entre rondas. **Mínimo 2.** Recomendado 4–8. |
| `pausaEntrePersonasMinutos` | Pausa entre una persona y la siguiente dentro de la misma ronda |
| `pausaBloqueoMinutos` | Si la sede bloquea por exceso de peticiones, espera esto antes de seguir |
| `horario` | Franja en la que buscar, p. ej. `{"desde": "07:00", "hasta": "23:59"}` |
| `maxIntentos` | Máximo de rondas; `0` = sin límite |
| `navegador.visible` | Debe ser `true`: necesitas ver la ventana para resolver el captcha |

Un `config.json` antiguo, con una sola persona y sin `personas`, sigue funcionando.

## Uso

Desde la terminal abierta en la carpeta del proyecto:

```bash
npm run una-vez      # 1) prueba: un solo intento para revisar que todo se encuentra bien
npm start            # 2) búsqueda continua hasta conseguir cita para todas las personas
```

Para pararlo: **Ctrl + C**. Para comprobar los avisos al móvil:
`node src/index.js --probar-notificaciones`.

Mientras busca:

- Deja la terminal y la **ventana del navegador abiertas** (puedes minimizarla) y el
  ordenador **encendido y sin suspender**.
- Cuando retenga una cita oirás un pitido (y te llegará el aviso al móvil si lo
  configuraste). Ve a la ventana del navegador, **escribe el captcha y pulsa
  Confirmar**. Tienes unos minutos antes de que la cita retenida caduque.
- Si te equivocas con el captcha, vuelve a intentarlo en la misma ventana; el
  programa sigue esperando.
- El justificante llega al correo de `config.json`. Imprímelo y llévalo a la cita.

### Avisos al móvil (recomendado)

- **ntfy** (lo más fácil): instala la app *ntfy* en el móvil, suscríbete a un
  tema con un nombre difícil de adivinar (p. ej. `huellas-maria-8f3k2`) y ponlo en
  `notificaciones.ntfy.tema`.
- **Telegram**: crea un bot con @BotFather, copia el token a
  `notificaciones.telegram.token`, escribe al bot y obtén tu `chatId` (por
  ejemplo con @userinfobot).

## Consejos

- Las citas de huellas se suelen liberar a primera hora (8:00–9:00) y a veces a
  mediodía; un horario de 07:00 a 23:59 cubre casi todo.
- **No bajes el intervalo de 2 minutos.** La sede bloquea temporalmente las IP que
  hacen demasiadas peticiones; el programa detecta el bloqueo y hace una pausa.
- Los captchas los resuelves tú en la ventana del navegador: el programa no salta
  captchas ni otras protecciones de la web. Si alguna provincia pide captcha ya en
  la pantalla de datos personales, también te avisará para que lo resuelvas.
- Antes de dejarlo en bucle, haz `npm run una-vez` para comprobar que la provincia,
  el trámite y el país se encuentran bien. Si algo falla, mira la captura en `capturas/`.

## Uso responsable

Esta herramienta es para conseguir citas para ti o para personas que te lo han
pedido, con sus datos reales. Cada cita debe pedirse en la provincia donde vive esa persona. La cita previa de Extranjería es gratuita: no la uses para
acaparar ni revender citas. Reservar a nombre de otra persona sin su permiso o
vender citas puede ser delito. Si consigues una cita que ya no necesitas,
anúlala en la misma web para liberarla.

La web oficial cambia de vez en cuando. Si deja de funcionar, mira la captura del
error en `capturas/` y ajusta los selectores en `src/flujo.js`.

## Desarrollo

```bash
npm test
```

Las pruebas usan una sede simulada (`test/sede-simulada.js`) con las mismas
pantallas e identificadores de campo que la web real. Así no se hacen
peticiones a la sede oficial.
