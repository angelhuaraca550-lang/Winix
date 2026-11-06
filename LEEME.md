# Fideliza 2.0 — tarjetas de fidelidad digitales

Tu misma página de Fideliza, ahora en tu propio hosting (sin marca de agua) y con:

- **Demo animada** en la página de inicio + QR para probarla en el celular.
- **Publicidad al celular** de cada cliente (notificación push), a todos, a un grupo o a uno solo. A los que no tienen notificaciones se la mandas por WhatsApp con un toque.
- **Diseñador de tarjeta**: 5 plantillas, colores, logo, foto de fondo, ícono de sello, textos, con vista previa en vivo.
- **Aviso a 100 m**: cuando el cliente pasa cerca del local con su tarjeta abierta, le aparece con un mensaje que lo motiva a entrar.
- **Panel de dueño (tú)**: mensualidad de cada negocio, registrar pagos, recordatorio de cobro por WhatsApp, suspensión manual o automática al vencer.
- Panel del negocio mejorado: métricas, escáner de QR con la cámara, clientes, descarga en Excel (CSV), cartel QR para imprimir, ubicación del local, claves.

---

## Cómo subirla (gratis, sin marca de agua)

Necesitas una cuenta de **GitHub** y una de **Netlify** (las dos gratis). Netlify necesita GitHub porque la página tiene “motor” (la parte que guarda clientes y envía notificaciones), y eso no funciona arrastrando la carpeta a Netlify Drop.

1. Descomprime el ZIP. Te queda la carpeta `fideliza`.
2. Entra a **github.com** → crea tu cuenta → botón **New repository** → nombre: `fideliza` → **Create repository**.
3. En el repositorio vacío toca **uploading an existing file**. Abre la carpeta `fideliza` y **arrastra lo que hay DENTRO** (`netlify.toml`, `package.json`, `package-lock.json`, `LEEME.md` y las carpetas `netlify` y `public`). No arrastres la carpeta `fideliza` entera. Toca **Commit changes**.
4. Entra a **app.netlify.com** → regístrate con tu cuenta de GitHub → **Add new project** → **Import an existing project** → **GitHub** → elige `fideliza` → **Deploy**. No cambies nada: el archivo `netlify.toml` ya trae toda la configuración.
5. En 1–2 minutos te da tu enlace (`algo-raro.netlify.app`). Cámbialo en **Project configuration → Change project name** (ej: `fideliza-winix` → `fideliza-winix.netlify.app`).
6. **Apenas la publiques**, abre `tu-enlace/dueno` y crea tu **clave de dueño** (la primera persona que entra la crea, por eso hazlo tú de inmediato).

Dominio propio (opcional, ~$12 al año): Netlify → **Domain management → Add a domain**.

### Actualizar en el futuro
Sube los archivos nuevos al mismo repositorio de GitHub (se reemplazan) y Netlify publica solo. Tus negocios y clientes no se borran.

---

## Primer uso

1. `/dueno` → **Ajustes**: pon tu WhatsApp (los negocios lo ven para pagarte), días de gracia y si quieres pausa automática.
2. **Nuevo negocio** → nombre, mensualidad, dueño y su WhatsApp → te da sus claves → **Enviar accesos por WhatsApp**.
3. Entra a su panel (botón ↗) → **Mi tarjeta** para diseñarla → **Ajustes**: ubicación del local (parado dentro del local, “Usar mi ubicación actual”) y **Imprimir cartel** con el QR.
4. Para mostrarle a un prospecto: la página de inicio tiene la demo animada y el QR “Pruébalo en tu celular”. Desde tu panel tienes **Panel demo** para enseñarle cómo se envía publicidad.

## Cobros mensuales

- Cada negocio tiene una fecha **“pagado hasta”**. 5 días antes ve un aviso para renovar.
- Si vence, tiene unos días de gracia (lo eliges en Ajustes) y luego **se pausa solo**: sus clientes ven “tarjeta en pausa” y no se suman sellos. **No se borra nada.**
- Cuando te paga: **Registrar pago** → se reactiva al instante.
- **Cobros** te muestra quién vence pronto, con el mensaje de cobro ya escrito para WhatsApp.

## Cosas que debes saber

- **iPhone**: para recibir notificaciones el cliente debe guardar la tarjeta en su pantalla de inicio (iOS 16.4 o más). La misma tarjeta le explica cómo. En Android funciona directo.
- **Aviso a 100 m**: funciona cuando el cliente tiene su tarjeta abierta o la abre cerca del local (por eso conviene que la guarde en su pantalla de inicio). Con el celular bloqueado ninguna página web puede detectar la ubicación; eso solo lo hacen Apple Wallet / Google Wallet.
- **Plan gratis de Netlify**: 300 créditos al mes (cada publicación gasta 15). Alcanza para empezar con varios negocios; cuando crezcas, el plan Personal cuesta $9/mes. Si se acaban los créditos, el sitio se pausa hasta el mes siguiente.
- **Lo que tenías en Kimi** no se pasa (está guardado en los servidores de Kimi): vuelves a crear los negocios aquí.
- **¿Olvidaste tu clave de dueño?** En Netlify → **Project configuration → Environment variables** crea `OWNER_KEY` con una clave nueva y vuelve a publicar (Deploys → Trigger deploy). Esa clave entra al panel de dueño.

## Rutas

| Página | Para quién |
|---|---|
| `/` | Inicio con demo |
| `/unirse/NEGOCIO` | El QR del local (registro del cliente) |
| `/tarjeta/CÓDIGO` | La tarjeta del cliente |
| `/acceso` | Entrada del negocio (admin o empleado) |
| `/negocio/NEGOCIO` | Panel del negocio |
| `/dueno` | Tu panel de dueño |
