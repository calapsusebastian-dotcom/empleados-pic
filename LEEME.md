# Control de Ingreso y Salida — Firebase

> **Ya configurado para el proyecto `registro-pic-empleados`** con el administrador `coocentralempleados@gmail.com`.
> Si ya creó el proyecto y la app web, solo le faltan los pasos 2, 3 y 6.

Sistema para que cada empleado, con su propio usuario, registre su **ingreso** y su **salida** (con motivo y firma). El administrador ve todos los registros, el **resumen diario de horas trabajadas** y gestiona al personal.

- **Firebase Authentication**: una cuenta por empleado (usuario + contraseña).
- **Cloud Firestore**: guarda empleados, marcas y ajustes.
- **Firebase Hosting**: publica la página en `https://SU-PROYECTO.web.app`.
- **Hora del servidor**: la hora de cada marca la pone Firebase, no el celular ni el computador.

---

## Contenido

```
control-personal-firebase/
├── public/
│   ├── index.html      ← la página
│   ├── app.js          ← la lógica
│   └── config.js       ← SUS DATOS (editar)
├── firestore.rules     ← reglas de seguridad (editar el correo del admin)
├── firestore.indexes.json
├── firebase.json
├── .firebaserc         ← id del proyecto (editar)
└── functions/          ← OPCIONAL: restablecer contraseñas desde el panel
```

---

## Paso 1 — Crear el proyecto en Firebase

1. Entre a <https://console.firebase.google.com> con su cuenta de Google.
2. **Agregar proyecto** → póngale un nombre (por ejemplo `control-personal`) → puede desactivar Google Analytics → **Crear**.
3. Anote el **ID del proyecto** (aparece debajo del nombre, por ejemplo `control-personal-4f2a1`).

## Paso 2 — Activar el inicio de sesión

1. Menú **Compilación → Authentication → Comenzar**.
2. Pestaña **Método de acceso** → **Correo electrónico/contraseña** → **Habilitar** → Guardar.
3. Pestaña **Usuarios → Agregar usuario**: cree la cuenta del **administrador** con su correo real y una contraseña segura.

## Paso 3 — Crear la base de datos

1. **Compilación → Firestore Database → Crear base de datos**.
2. Ubicación: `southamerica-east1 (São Paulo)` o `us-east1` (la más cercana a Colombia).
3. Elija **modo de producción** (las reglas de este proyecto se cargan en el paso 6).

## Paso 4 — Registrar la app web y copiar la configuración

1. ⚙ **Configuración del proyecto → General → Tus apps →** icono **`</>`** (Web).
2. Póngale un apodo, **no** marque Hosting aquí, y pulse **Registrar app**.
3. Copie el bloque `firebaseConfig` que aparece.

## Paso 5 — Editar los archivos

**`public/config.js`**
- Pegue su `firebaseConfig`.
- En `ADMIN_EMAILS` ponga el correo del administrador del paso 2 (en minúsculas).
- `DOMINIO_USUARIOS` puede dejarlo así; es solo un dominio interno (no envía correos).

**`firestore.rules`** → en la función `esAdmin()` cambie `admin@miempresa.com` por el **mismo correo**.

**`.firebaserc`** → cambie `su-proyecto` por su **ID del proyecto**.

> Para tener varios administradores, agregue los correos en los tres lugares: `config.js`, `firestore.rules` y (si la usa) `functions/index.js`.

## Paso 6 — Publicar

Necesita **Node.js 18 o superior** (<https://nodejs.org>). En una terminal, dentro de la carpeta del proyecto:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting,firestore
```

Al terminar verá la dirección de su sistema: `https://SU-PROYECTO.web.app`.

> El índice de la base de datos puede tardar unos minutos en quedar listo. Si un empleado ve el mensaje «Falta crear un índice», espere 5 minutos y vuelva a intentar.

## Paso 7 (opcional) — Restablecer contraseñas desde el panel

El botón **Nueva contraseña** de la pestaña *Personal* usa una Cloud Function. Firebase exige el **plan Blaze** (pago por uso) para las funciones; con este uso normalmente no se paga nada porque cabe en la cuota gratuita, pero debe registrar una tarjeta.

```bash
cd functions && npm install && cd ..
firebase deploy --only functions
```

Edite antes `ADMIN_EMAILS` en `functions/index.js`.

**Sin el plan Blaze:** cada empleado puede cambiar su propia contraseña desde su sesión («Cambiar mi contraseña»). Si alguien la olvida, bórrelo en *Authentication → Usuarios* y en *Firestore → empleados*, y vuelva a crearlo desde el panel.

---

## Uso diario

**Administrador**
1. Abra la página y entre con **su correo** y contraseña. Verá el panel de administración.
2. En **Personal**, agregue a cada empleado con nombre, documento, cargo, **usuario** y **contraseña inicial**, y entrégueles esos datos.
3. En **Ajustes**, ponga el nombre de la empresa (sale en el encabezado).
4. **Registros** muestra cada marca con su firma; **Resumen diario** muestra las horas trabajadas por persona y día. Ambos se exportan a CSV para Excel.

**Empleado**
1. Abre la página (en la tablet de la entrada o en su celular) y entra con **su usuario**, por ejemplo `mlopez`.
2. Elige **Ingreso** o **Salida**. En la salida elige el **motivo** y escribe el detalle.
3. **Firma** y confirma. La sesión se cierra sola a los pocos segundos.

---

## Seguridad incluida

- Cada empleado solo puede **crear sus propias marcas** y solo **ver las suyas**.
- La hora se valida en el servidor (`request.time`); no se puede falsificar desde el equipo.
- El nombre y documento de la marca deben coincidir con la ficha del empleado.
- Nadie puede **modificar** una marca; solo el administrador puede **eliminarla**.
- Un empleado **desactivado** no puede marcar.
- La sesión se guarda solo mientras la pestaña está abierta y se cierra tras 2 minutos sin uso.

## Costos

Con el plan gratuito (Spark) tiene 50.000 lecturas y 20.000 escrituras diarias en Firestore, y 1 GB de almacenamiento. Una empresa de 30 personas con 4 marcas al día usa una fracción mínima de eso. Cada firma ocupa unos 5–10 KB.

## Portería con código QR y permisos de salida

1. **Publique las reglas nuevas** (obligatorio, sin esto el celador no podrá registrar):
   `firebase deploy --only firestore:rules` (y `firebase deploy --only hosting` si usa Firebase Hosting).
2. **Cree al celador**: panel del administrador → *Ajustes* → *Celadores*. Entra con su usuario y contraseña desde su celular.
3. **Genere los QR**: panel → *Personal* → *Ver QR* (o «Generar QR para N personas sin código»). Se puede imprimir o enviar al empleado. Los empleados nuevos ya nacen con su QR.
4. **Permisos**: el empleado pide el permiso en su sesión (*Permiso de salida*); el administrador lo aprueba en la pestaña *Permisos*.
5. **En la puerta**: el celador toca *Escanear código QR*. Si el empleado está fuera, registra el ingreso. Si está dentro, solo registra la salida cuando hay un permiso aprobado hoy (queda «usado»); si no, muestra «Sin permiso de salida» y puede registrar una salida de fin de jornada.

El QR es fijo por empleado. Si alguien lo pierde o lo comparte, genere uno nuevo (reemplaza al anterior).

### Cambio: ya no hay firma ni marcado por el empleado
Los ingresos y salidas los registra **solo el celador**. Al escanear el QR ve la ficha del empleado y elige *Registrar ingreso* o *Registrar salida*. La salida con permiso aprobado hoy queda «autorizada» y el permiso se marca como usado; sin permiso, el sistema avisa y el celador puede registrar una salida de fin de jornada. Vuelva a publicar `firestore.rules` para que los empleados dejen de poder crear marcas.

## Cambio: los trabajadores ya no tienen usuario ni contraseña

- **Alta:** panel → *Personal* → *Agregar persona* (nombre, documento, cargo). Se genera su QR y se abre para imprimirlo. *Imprimir carnets* saca una hoja con el QR de todos.
- **Permisos:** los registra el administrador en la pestaña *Permisos* (queda aprobado al instante, vale solo ese día y se usa una vez).
- **Portería:** el celador es el único que registra ingresos y salidas, escaneando el QR.
- **Cuentas:** solo existen el administrador (correo) y los celadores (usuario). Las cuentas de empleados anteriores ya no sirven para entrar; se pueden borrar en Firebase → Authentication.
- **Reglas:** vuelva a publicar `firestore.rules` (los empleados ya no leen ni escriben nada).
