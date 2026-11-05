# Buscador de cita previa · Toma de huellas (Extranjería)

Programa que entra en la sede oficial de cita previa de Extranjería
(<https://icp.administracionelectronica.gob.es/icpplus/index.html>), rellena tus
datos, revisa cada pocos minutos si hay huecos para **POLICÍA – TOMA DE HUELLAS
(expedición de tarjeta / TIE)** y, cuando aparece uno, te avisa y lo reserva.

Usa un navegador real (Chromium con Playwright). Tú ves lo que hace en la
ventana, y el último paso, el código que llega por SMS, lo pones tú.

## Cómo funciona

1. Elige provincia → oficina → trámite "TOMA DE HUELLAS".
2. Rellena NIE/pasaporte, nombre, país (y año de nacimiento o caducidad si la sede los pide).
3. Pulsa "Solicitar cita".
   - Si sale *"En este momento no hay citas disponibles"*, espera entre 4 y 8
     minutos (intervalo aleatorio que puedes cambiar) y vuelve a intentarlo con una sesión nueva.
   - Si hay citas, **te avisa** (pitido, Telegram y/o notificación push al móvil).
4. En modo `reservar`: elige tu oficina preferida, pone teléfono y email, escoge
   **el hueco más temprano** dentro de tus fechas y lo retiene.
5. La sede manda un **SMS**: escribes el código en la terminal (o directamente en
   el navegador) y la cita queda confirmada. Guarda una captura del justificante en `capturas/`.

## Instalación

Necesitas [Node.js 18 o superior](https://nodejs.org).

```bash
git clone <este repositorio>
cd Extranpassword
npm install
npx playwright install chromium
cp config.example.json config.json
```

Edita `config.json` con tus datos (no se sube a git):

| Campo | Qué poner |
|---|---|
| `provincia` | Como aparece en la web: `"Madrid"`, `"Barcelona"`, `"Alicante"`... |
| `oficina` | Lista de oficinas preferidas (basta un trozo del nombre, p. ej. `["Aluche", "Moratalaz"]`). `["Cualquier oficina"]` acepta cualquiera. |
| `tramite` | Por defecto `"TOMA DE HUELLAS"`. Se busca por texto, así que vale cualquier trozo del nombre del trámite. |
| `tipoDocumento` | `"NIE"`, `"PASAPORTE"` o `"DNI"` |
| `documento` | Tu NIE (`Y1234567X`) o número de pasaporte |
| `nombre` | Nombre y apellidos **igual que en el documento** |
| `paisNacionalidad` | Como sale en el desplegable: `"COLOMBIA"`, `"VENEZUELA"`, `"MARRUECOS"`... |
| `anioNacimiento` | Solo si la sede lo pide (algunas provincias) |
| `fechaCaducidad` | Solo para renovaciones si la sede lo pide (`dd/mm/aaaa`) |
| `telefono` / `email` | Donde recibirás el SMS de confirmación y el justificante |
| `modo` | `"reservar"` (reserva automáticamente) o `"avisar"` (solo avisa y te deja el navegador abierto para que termines tú) |
| `fechaMinima` / `fechaMaxima` | Opcional, `dd/mm/aaaa`. Ignora huecos fuera de ese rango. |
| `intervaloMinutos` | `[mín, máx]` entre intentos. **Mínimo 2.** Recomendado 4–8. |
| `pausaBloqueoMinutos` | Si la sede bloquea por exceso de peticiones, espera esto antes de seguir. |
| `horario` | Franja en la que buscar, p. ej. `{"desde": "07:00", "hasta": "23:59"}` |
| `maxIntentos` | `0` = sin límite |
| `navegador.visible` | `true` para ver la ventana (recomendado). |

## Uso

```bash
npm start                         # busca en bucle hasta conseguir cita
npm run una-vez                   # un único intento (para probar tu configuración)
node src/index.js --probar-notificaciones
```

Deja la terminal abierta y el ordenador encendido (y sin suspender). Cuando
consiga retener una cita sonará un pitido y te pedirá el **código SMS**:
tienes unos minutos antes de que la cita retenida caduque.

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
- Si la sede pide resolver un captcha, hazlo en la ventana del navegador: el
  programa no salta captchas ni otras protecciones de la web.
- Antes de dejarlo en bucle, haz `npm run una-vez` para comprobar que la provincia,
  el trámite y el país se encuentran bien. Si algo falla, mira la captura en `capturas/`.

## Uso responsable

Esta herramienta es para que **cada persona consiga su propia cita** con sus
propios datos. La cita previa de Extranjería es gratuita: no la uses para
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
