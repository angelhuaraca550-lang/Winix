// Fideliza — acceso y panel del negocio
import {
  html, raw, ic, mount, $, $$, api, ls, go, toast, toastErr, modal, confirmBox, busy, ago, fmtDate, fmtDay, money,
  plural, initials, firstName, slugify, qrSvg, qrCanvas, setHead, waLink, copyText, loadImage, coverImage, fitImage,
  loadScript, todayYmd, contrastOn, fillTemplate, errorPage, loading, vibrate,
} from "./core.js";
import { cardHTML, TEMPLATES, ICONS, COLORS, templateSwatch } from "./cardview.js";

/* ================================================================== */
/* /acceso                                                             */
/* ================================================================== */
export async function access(app) {
  setHead({ title: "Acceso negocio · Fideliza" });
  const pre = new URLSearchParams(location.search).get("n") || ls.get("last_biz", "");
  mount(
    app,
    html`<div class="auth"><form class="card auth__card fade-in" novalidate>
      <div class="icon-bubble">${ic("store", "", 26)}</div>
      <h1 class="auth__title" style="text-align:left">Acceso negocio</h1>
      <div class="stack mt-6" style="--gap:16px">
        <div class="field"><label class="label" for="a-slug">Negocio</label>
          <input class="input" id="a-slug" name="slug" placeholder="Ej: cafeteria-la-esquina" autocomplete="username" autocapitalize="none" value="${pre}" required></div>
        <div class="field"><label class="label" for="a-key">Clave de administrador o empleado</label>
          <input class="input" id="a-key" name="key" type="password" placeholder="Tu clave" autocomplete="current-password" required></div>
        <button class="btn btn--block" type="submit">Abrir panel</button>
        <p class="center small muted">¿Eres el propietario de la plataforma? <a class="link" href="/dueno" data-go>Panel de dueño</a></p>
      </div>
    </form></div>`
  );
  const f = $("form", app);
  if (pre) f.key.focus();
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const slug = slugify(f.slug.value);
    const key = f.key.value.trim();
    if (!slug || !key) return toastErr("Escribe el negocio y la clave");
    await busy(f.querySelector("button"), async () => {
      try {
        const r = await api("/biz/login", { method: "POST", body: { slug, key } });
        ls.set("biz_" + r.slug, { key, role: r.role, name: r.name });
        ls.set("last_biz", r.slug);
        go(`/negocio/${r.slug}`);
      } catch (err) {
        toastErr(err);
      }
    });
  });
}

/* ================================================================== */
/* /negocio/:slug                                                      */
/* ================================================================== */
const KIND = {
  stamp: (n) => `+${n} ${n === 1 ? "sello" : "sellos"}`,
  unstamp: (n) => `−${n} ${n === 1 ? "sello" : "sellos"} (corrección)`,
  redeem: () => "Canjeó su premio 🎁",
  join: () => "Se registró",
  bonus: () => "Sello de bienvenida",
};
const BY = { admin: "Administrador", staff: "Empleado", owner: "Soporte", cliente: "", demo: "Demo" };
const DAY = 864e5;
const COUNTRIES = [["593", "Ecuador (+593)"], ["1", "EE. UU. (+1)"], ["57", "Colombia (+57)"], ["51", "Perú (+51)"], ["52", "México (+52)"], ["34", "España (+34)"], ["502", "Guatemala (+502)"], ["503", "El Salvador (+503)"], ["504", "Honduras (+504)"], ["58", "Venezuela (+58)"], ["56", "Chile (+56)"], ["54", "Argentina (+54)"]];

export async function panel(app, slugRaw) {
  const slug = slugify(slugRaw);
  const params = new URLSearchParams(location.search);
  if (params.has("dueno")) {
    sessionStorage.setItem("fz_ownerview_" + slug, "1");
    history.replaceState({}, "", `/negocio/${slug}${location.hash}`);
  }
  const ownerKey = ls.get("owner");
  const sess = ls.get("biz_" + slug);
  const asOwner = ownerKey && (sessionStorage.getItem("fz_ownerview_" + slug) || !sess);
  const auth = asOwner ? { owner: ownerKey } : sess ? { key: sess.key } : null;
  if (!auth) return go(`/acceso?n=${slug}`, true);

  loading(app);
  let S; // estado del panel
  const call = (path, opts = {}) => api(`/biz/${slug}${path}`, { ...opts, ...auth });
  async function load() {
    S = await call("/panel");
    S.goal = S.business.stampsGoal;
  }
  try {
    await load();
  } catch (e) {
    if (e.status === 401) {
      ls.del("biz_" + slug);
      sessionStorage.removeItem("fz_ownerview_" + slug);
      toastErr("Tu clave cambió o no es válida. Vuelve a entrar.");
      return go(`/acceso?n=${slug}`, true);
    }
    if (e.status === 404) return errorPage(app, { title: "Negocio no encontrado", text: "Revisa el enlace del negocio." });
    return errorPage(app, { text: e.message, action: html`<button class="btn btn--outline mt-6" onclick="location.reload()">Reintentar</button>` });
  }

  const isAdmin = () => S.role !== "staff";
  const TABS = () =>
    isAdmin()
      ? [["inicio", "Inicio", "house"], ["sellos", "Sellos", "stamp"], ["clientes", "Clientes", "users"], ["publicidad", "Publicidad", "megaphone"], ["tarjeta", "Mi tarjeta", "palette"], ["ajustes", "Ajustes", "settings"]]
      : [["sellos", "Sellos", "stamp"], ["clientes", "Clientes", "users"]];
  const origin = location.origin;
  const joinUrl = () => `${origin}/unirse/${slug}`;
  const cardUrl = (code) => `${origin}/tarjeta/${code}`;
  let tab = "";
  let timer = null;
  let destroyed = false;
  const cleanups = [];

  /* ---------- utilidades de clientes ---------- */
  const leftOf = (c) => Math.max(0, S.goal - c.stamps);
  const isNear = (c) => leftOf(c) > 0 && leftOf(c) <= 2;
  const isReady = (c) => leftOf(c) === 0;
  const isInactive = (c) => Date.now() - (c.last || c.created) > 15 * DAY;
  const cc = () => S.business.cc || "593";
  function waNudge(c, kind) {
    const f = firstName(c.name);
    const b = S.business;
    const msg =
      kind === "ready"
        ? `¡${f}, tu premio te espera en ${b.name}! 🎉 Ya completaste tu tarjeta: pasa a reclamar ${b.reward}.\nTu tarjeta: ${cardUrl(c.code)}`
        : kind === "inactive"
          ? `Hola ${f} 👋 Te extrañamos en ${b.name}. Llevas ${c.stamps} de ${S.goal} sellos: vuelve y sigue sumando para tu ${b.reward}.\nTu tarjeta: ${cardUrl(c.code)}`
          : kind === "near"
            ? `Hola ${f} 👋 Te ${leftOf(c) === 1 ? "falta" : "faltan"} ${plural(leftOf(c), "sello", "sellos")} para tu ${b.reward} en ${b.name}. ¡Te esperamos! 🎁\nTu tarjeta: ${cardUrl(c.code)}`
            : `Hola ${f} 👋 Te escribimos de ${b.name}.\nTu tarjeta: ${cardUrl(c.code)}`;
    return waLink(c.phone, msg, cc());
  }
  const logoEl = (b, size = 36) =>
    b.design.logoSmall
      ? html`<img class="logo" src="${b.design.logoSmall}" alt="" style="width:${size}px;height:${size}px">`
      : html`<span class="logo" style="background:${b.design.color};color:${contrastOn(b.design.color)};width:${size}px;height:${size}px">${initials(b.name)}</span>`;

  /* ---------- estructura ---------- */
  function shell() {
    const b = S.business;
    const roleBadge = S.role === "owner" ? html`<span class="badge badge--dark">Soporte</span>` : S.role === "admin" ? html`<span class="badge">Administrador</span>` : html`<span class="badge">Empleado</span>`;
    setHead({ title: `${b.name} · Panel`, theme: "#ffffff" });
    mount(
      app,
      html`<div class="panel">
        <header class="panel__hd"><div class="container">
          <div class="panel__top">
            <div class="panel__who">${logoEl(b)}<div style="min-width:0"><div class="panel__name ellipsis">${b.name}</div><div class="cluster" style="--gap:6px">${roleBadge}<span class="xs muted hide-sm">/${slug}</span></div></div></div>
            <div class="cluster" style="--gap:4px;flex-wrap:nowrap">
              <a class="btn btn--ghost btn--sm" href="/unirse/${slug}?nuevo=1" target="_blank" rel="noopener" title="Ver como cliente">${ic("eye", "", 16)}<span class="hide-sm">Ver como cliente</span></a>
              <button class="btn btn--ghost btn--sm btn--icon" data-x="reload" aria-label="Actualizar">${ic("refresh-cw", "", 16)}</button>
              ${S.role === "owner" ? html`<a class="btn btn--outline btn--sm" href="/dueno" data-go>${ic("crown", "", 15)}<span class="hide-sm">Panel de dueño</span></a>` : html`<button class="btn btn--outline btn--sm" data-x="logout">${ic("log-out", "", 15)}<span class="hide-sm">Salir</span></button>`}
            </div>
          </div>
          <nav class="tabs" role="tablist">${TABS().map(([id, label, icn]) => html`<a class="tab" href="#${id}" data-tab="${id}">${ic(icn, "", 16)} ${label}</a>`)}</nav>
        </div></header>
        <div class="container panel__bd">
          <div data-banner></div>
          <div data-body></div>
        </div>
      </div>`
    );
    renderBanner();
  }

  function renderBanner() {
    const st = S.status;
    const el = $("[data-banner]", app);
    if (!el) return;
    const sup = S.support.whatsapp;
    const payBtn = sup && S.role !== "owner" ? html`<a class="btn btn--sm ${st.blocked ? "btn--accent" : "btn--outline"}" target="_blank" rel="noopener" href="${waLink(sup, `Hola 👋 Quiero renovar el plan de ${S.business.name} (${slug}).`)}">${ic("message-circle", "", 15)} Renovar por WhatsApp</a>` : "";
    let box = "";
    const until = fmtDate(st.paidUntil);
    if (st.blocked)
      box = html`<div class="alert alert--danger">${ic("circle-pause", "", 20)}<div class="grow"><b>Tu cuenta está pausada.</b> Tus clientes ven la tarjeta en pausa y no se pueden sumar sellos. Tus datos están guardados: renueva para reactivarla al instante.</div>${payBtn}</div>`;
    else if (st.code === "gracia")
      box = html`<div class="alert alert--warn">${ic("triangle-alert", "", 20)}<div class="grow"><b>Tu plan venció el ${until}.</b> Te ${st.graceLeft === 1 ? "queda" : "quedan"} ${plural(st.graceLeft, "día", "días")} antes de que la tarjeta se pause.</div>${payBtn}</div>`;
    else if (st.code === "vencido")
      box = html`<div class="alert alert--warn">${ic("triangle-alert", "", 20)}<div class="grow"><b>Tu plan venció el ${until}.</b> Renueva para no perder el servicio.</div>${payBtn}</div>`;
    else if (st.code === "por_vencer" && isAdmin())
      box = html`<div class="alert alert--info">${ic("calendar", "", 20)}<div class="grow">Tu plan vence ${st.daysLeft === 0 ? "hoy" : st.daysLeft === 1 ? "mañana" : `en ${st.daysLeft} días`} (${until}).</div>${payBtn}</div>`;
    mount(el, box ? html`<div style="margin-bottom:16px">${box}</div>` : "");
  }

  function setTab(id) {
    const ids = TABS().map((t) => t[0]);
    if (!ids.includes(id)) id = ids[0];
    tab = id;
    $$("[data-tab]", app).forEach((t) => t.classList.toggle("is-on", t.dataset.tab === id));
    while (cleanups.length) cleanups.pop()();
    const body = $("[data-body]", app);
    ({ inicio: tabInicio, sellos: tabSellos, clientes: tabClientes, publicidad: tabPublicidad, tarjeta: tabTarjeta, ajustes: tabAjustes })[id](body);
    schedule();
  }
  async function reload(manual) {
    try {
      await load();
      if (destroyed) return;
      renderBanner();
      if (tab !== "tarjeta" && tab !== "publicidad" && tab !== "ajustes") setTab(tab);
      if (manual) toast("Actualizado");
    } catch (e) {
      if (manual) toastErr(e);
    }
  }
  function schedule() {
    clearInterval(timer);
    if (["inicio", "clientes"].includes(tab)) timer = setInterval(() => !document.hidden && reload(), 60_000);
  }

  /* ================================================================ */
  /* INICIO                                                            */
  /* ================================================================ */
  function tabInicio(body) {
    const cs = S.customers;
    const week = cs.filter((c) => Date.now() - c.created < 7 * DAY).length;
    const days = {};
    S.days.forEach((d) => (days[d.day] = d));
    const today = todayYmd();
    const last14 = Array.from({ length: 14 }, (_, i) => {
      const dt = new Date(today + "T12:00:00");
      dt.setDate(dt.getDate() - (13 - i));
      const k = dt.toISOString().slice(0, 10);
      return { k, v: days[k]?.stamps || 0 };
    });
    const max = Math.max(1, ...last14.map((x) => x.v));
    const stamps7 = last14.slice(-7).reduce((a, x) => a + x.v, 0);
    const stampsToday = last14[13].v;
    const rewards = cs.reduce((a, c) => a + c.rewards, 0);
    const ready = cs.filter(isReady);
    const near = cs.filter(isNear).sort((a, b) => leftOf(a) - leftOf(b));
    const pushN = S.pushCount || 0;
    mount(
      body,
      html`<div class="stack fade-in" style="--gap:16px">
        <div class="grid g4" style="--gap:12px">
          <div class="card kpi"><div class="kpi__l">${ic("users", "", 15)} Clientes</div><div class="kpi__v">${cs.length}</div><div class="kpi__s">+${week} esta semana</div></div>
          <div class="card kpi"><div class="kpi__l">${ic("stamp", "", 15)} Sellos (7 días)</div><div class="kpi__v">${stamps7}</div><div class="kpi__s">${stampsToday} hoy</div></div>
          <div class="card kpi"><div class="kpi__l">${ic("gift", "", 15)} Premios canjeados</div><div class="kpi__v">${rewards}</div><div class="kpi__s">${plural(ready.length, "listo", "listos")} para canjear</div></div>
          <div class="card kpi"><div class="kpi__l">${ic("bell-ring", "", 15)} Reciben tus promos</div><div class="kpi__v">${pushN}</div><div class="kpi__s">${cs.length ? Math.round((pushN / cs.length) * 100) : 0}% de tus clientes</div></div>
        </div>

        <div class="card card__bd">
          <div class="between"><p class="h4">Sellos por día</p><span class="xs muted">Últimos 14 días</span></div>
          <div class="bars mt-4">${last14.map((x) => html`<div class="bars__c"><div class="bars__b${x.v ? "" : " is-zero"}" style="height:${(x.v / max) * 100}%">${x.v ? html`<span>${x.v}</span>` : ""}</div><div class="bars__l">${fmtDay(x.k).split(" ")[0]}</div></div>`)}</div>
        </div>

        <div class="grid g2">
          <div class="card card__bd">
            <div class="between"><p class="h4">${ic("trophy", "", 16)} A punto de ganar</p><span class="badge">${near.length + ready.length}</span></div>
            <p class="hint mt-1">Escríbeles: un mensaje a tiempo los trae de vuelta.</p>
            <div class="list mt-2">
              ${[...ready.map((c) => [c, "ready"]), ...near.map((c) => [c, "near"])].slice(0, 8).map(
                ([c, k]) => html`<div class="list__row">
                  <span class="avatar" style="background:${S.business.design.color}">${initials(c.name)}</span>
                  <div class="list__main"><div class="list__t ellipsis">${c.name}</div><div class="list__s">${k === "ready" ? "🎉 Completó su tarjeta" : `Le ${leftOf(c) === 1 ? "falta" : "faltan"} ${plural(leftOf(c), "sello", "sellos")}`}</div></div>
                  ${c.phone ? html`<a class="btn btn--outline btn--xs" target="_blank" rel="noopener" href="${waNudge(c, k)}">${ic("message-circle", "", 14)} Escribir</a>` : ""}
                </div>`
              )}
              ${near.length + ready.length === 0 ? html`<div class="empty">Cuando alguien esté a 1 o 2 sellos del premio aparecerá aquí.</div>` : ""}
            </div>
          </div>
          <div class="card card__bd">
            <div class="between"><p class="h4">${ic("clock", "", 16)} Actividad reciente</p><a class="link small" href="#sellos">Sumar sello</a></div>
            <div class="list mt-2">${logRows(S.log.slice(0, 8))}</div>
          </div>
        </div>

        <div class="grid g2">
          <div class="card card__bd">
            <p class="h4">Acciones rápidas</p>
            <div class="cluster mt-3">
              <a class="btn btn--sm" href="#sellos">${ic("scan-line", "", 15)} Sumar sello</a>
              <a class="btn btn--outline btn--sm" href="#publicidad">${ic("megaphone", "", 15)} Enviar publicidad</a>
              <a class="btn btn--outline btn--sm" href="#ajustes">${ic("printer", "", 15)} Imprimir mi QR</a>
              <a class="btn btn--outline btn--sm" href="#tarjeta">${ic("palette", "", 15)} Diseñar tarjeta</a>
            </div>
          </div>
          <div class="card card__bd">
            <p class="h4">Tu plan</p>
            <p class="mt-2 small">${planLine()}</p>
            ${S.support.whatsapp ? html`<a class="btn btn--outline btn--sm mt-3" target="_blank" rel="noopener" href="${waLink(S.support.whatsapp, `Hola 👋 Tengo una consulta sobre ${S.business.name} (${slug}).`)}">${ic("message-circle", "", 15)} Soporte por WhatsApp</a>` : ""}
          </div>
        </div>
      </div>`
    );
  }
  function planLine() {
    const st = S.status;
    const b = S.business.billing || {};
    if (S.business.demo) return html`Negocio de demostración.`;
    const fee = b.fee ? html` · Mensualidad <b>${money(b.fee, S.support.currency)}</b>` : "";
    if (st.blocked) return html`<span class="badge badge--danger">Pausado</span> Pagado hasta ${fmtDate(st.paidUntil)}${fee}`;
    if (st.code === "gracia" || st.code === "vencido") return html`<span class="badge badge--warn">Vencido</span> desde ${fmtDate(st.paidUntil)}${fee}`;
    return html`<span class="badge badge--ok"><span class="dot"></span>Activo</span> hasta ${fmtDate(st.paidUntil)}${fee}`;
  }
  function logRows(rows) {
    if (!rows.length) return html`<div class="empty">Aún no hay movimientos.</div>`;
    return rows.map(
      (l) => html`<div class="list__row">
        <span class="icon-bubble icon-bubble--sm icon-bubble--soft">${ic(l.k === "redeem" ? "gift" : l.k === "join" ? "user-plus" : "stamp", "", 16)}</span>
        <div class="list__main"><div class="list__t ellipsis">${l.name}</div><div class="list__s">${(KIND[l.k] || (() => l.k))(l.n || 1)}${BY[l.by] ? ` · ${BY[l.by]}` : ""}</div></div>
        <span class="xs muted nowrap">${ago(l.t)}</span>
      </div>`
    );
  }

  /* ================================================================ */
  /* SELLOS                                                            */
  /* ================================================================ */
  function tabSellos(body) {
    let current = null;
    mount(
      body,
      html`<div class="scan-hero fade-in">
        <div class="card card__bd stack" style="--gap:14px">
          <div><p class="h3">Sumar sello</p><p class="muted small mt-1">Escanea el QR de la tarjeta del cliente o escribe su código.</p></div>
          <button class="btn btn--lg btn--block" data-s="scan">${ic("scan-line", "", 20)} Escanear QR del cliente</button>
          <form class="input-group" data-s="form">
            <input class="input input--code" name="code" placeholder="Código (ej: N46HDJ)" maxlength="10" autocomplete="off" autocapitalize="characters">
            <button class="btn btn--outline" style="--h:48px" type="submit">Buscar</button>
          </form>
          <div data-found></div>
        </div>
        <div class="card card__bd">
          <div class="between"><p class="h4">Últimos movimientos</p><span class="xs muted">${S.log.length}</span></div>
          <div class="list mt-2" data-log>${logRows(S.log.slice(0, 12))}</div>
        </div>
      </div>`
    );
    const found = $("[data-found]", body);
    const form = $("[data-s=form]", body);
    if (window.innerWidth > 900) form.code.focus();

    function showFound(c, newFrom) {
      current = c;
      const full = isReady(c);
      mount(
        found,
        html`<div class="found fade-in">
          ${cardHTML(S.business, c, { compact: true, newFrom })}
          <div class="status-line${full ? " status-line--full" : ""}">${full ? html`<span>🎉 Tarjeta completa: entrega <b>${S.business.reward}</b></span>` : html`${ic("gift", "", 17)}<span>Le ${leftOf(c) === 1 ? "falta" : "faltan"} <b>${plural(leftOf(c), "sello", "sellos")}</b> · ${c.rewards ? `${plural(c.rewards, "premio", "premios")} canjeados` : "aún sin premios"}</span>`}</div>
          <div class="cluster">
            ${full
              ? html`<button class="btn btn--ok btn--lg grow" data-s="redeem">${ic("gift", "", 18)} Canjear premio</button>`
              : html`<button class="btn btn--lg grow" data-s="add" data-n="1">${ic("plus", "", 18)} 1 sello</button>
                <button class="btn btn--outline btn--lg" data-s="add" data-n="2">+2</button>
                <button class="btn btn--outline btn--lg" data-s="add" data-n="3">+3</button>`}
            ${isAdmin() && c.stamps > 0 ? html`<button class="btn btn--ghost btn--lg btn--icon" data-s="add" data-n="-1" title="Quitar un sello">${ic("minus", "", 18)}</button>` : ""}
          </div>
          <button class="btn btn--ghost btn--sm" data-s="clear">${ic("x", "", 14)} Atender a otro cliente</button>
        </div>`
      );
    }
    async function lookup(code) {
      code = String(code || "").trim().toUpperCase();
      if (!code) return;
      const local = S.customers.find((c) => c.code === code);
      if (local) return showFound(local);
      try {
        const r = await call(`/customer/${code}`);
        S.customers.unshift(r.customer);
        showFound(r.customer);
      } catch (e) {
        toastErr(e);
      }
    }
    function upsert(c) {
      const i = S.customers.findIndex((x) => x.code === c.code);
      if (i >= 0) S.customers[i] = c;
      else S.customers.unshift(c);
    }
    async function refreshLog() {
      try {
        await load();
        const el = $("[data-log]", body);
        if (el) mount(el, logRows(S.log.slice(0, 12)));
      } catch {}
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      lookup(form.code.value);
    });
    body.addEventListener("click", async (e) => {
      const t = e.target.closest("[data-s]");
      if (!t) return;
      const s = t.dataset.s;
      if (s === "scan") return openScanner(lookup);
      if (s === "clear") {
        current = null;
        mount(found, "");
        form.code.value = "";
        return form.code.focus();
      }
      if (s === "add" && current)
        return busy(t, async () => {
          try {
            const n = +t.dataset.n;
            const before = current.stamps;
            const r = await call("/stamp", { method: "POST", body: { code: current.code, n } });
            upsert(r.customer);
            showFound(r.customer, n > 0 ? before : undefined);
            vibrate(40);
            toast(n > 0 ? `+${r.added} ${r.added === 1 ? "sello" : "sellos"} para ${firstName(r.customer.name)}` : "Sello quitado");
            refreshLog();
          } catch (err) {
            if (err.data?.full) showFound({ ...current, stamps: S.goal });
            toastErr(err);
          }
        });
      if (s === "redeem" && current)
        return busy(t, async () => {
          try {
            const r = await call("/redeem", { method: "POST", body: { code: current.code } });
            upsert(r.customer);
            showFound(r.customer);
            toast(`🎁 Premio entregado a ${firstName(r.customer.name)}`);
            refreshLog();
          } catch (err) {
            toastErr(err);
          }
        });
    });
  }

  async function openScanner(onCode) {
    if (!navigator.mediaDevices?.getUserMedia) return toastErr("Este navegador no permite usar la cámara. Escribe el código.");
    let stream = null;
    let stop = false;
    const m = modal({
      title: "Escanear QR del cliente",
      body: html`<div class="scanner"><video playsinline muted></video><div class="scanner__frame"></div></div><p class="hint mt-3 center">Apunta al código QR de la tarjeta del cliente.</p>`,
      actions: [{ label: "Cancelar", cls: "btn--outline" }],
      onClose: () => {
        stop = true;
        stream?.getTracks().forEach((t) => t.stop());
      },
    });
    const video = $("video", m.el);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (stop) return stream.getTracks().forEach((t) => t.stop());
      video.srcObject = stream;
      await video.play();
    } catch {
      m.close();
      return toastErr("No se pudo abrir la cámara. Revisa el permiso o escribe el código.");
    }
    let detector = null;
    try {
      if ("BarcodeDetector" in window && (await BarcodeDetector.getSupportedFormats()).includes("qr_code")) detector = new BarcodeDetector({ formats: ["qr_code"] });
    } catch {}
    if (!detector) await loadScript("/vendor/jsQR.js").catch(() => {});
    const cv = document.createElement("canvas");
    const g = cv.getContext("2d", { willReadFrequently: true });
    const parse = (t) => {
      const mm = /\/tarjeta\/([A-Za-z0-9]{4,10})/.exec(t || "");
      if (mm) return mm[1].toUpperCase();
      const s = String(t || "").trim();
      return /^[A-Za-z0-9]{4,10}$/.test(s) ? s.toUpperCase() : null;
    };
    const loop = async () => {
      if (stop) return;
      let text = null;
      try {
        if (video.readyState >= 2) {
          if (detector) text = (await detector.detect(video))[0]?.rawValue;
          else if (window.jsQR) {
            const w = 480;
            const h = Math.round((video.videoHeight / video.videoWidth) * w) || 480;
            cv.width = w;
            cv.height = h;
            g.drawImage(video, 0, 0, w, h);
            text = window.jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" })?.data;
          }
        }
      } catch {}
      const code = parse(text);
      if (code) {
        vibrate(60);
        m.close();
        return onCode(code);
      }
      setTimeout(loop, 140);
    };
    loop();
  }

  /* ================================================================ */
  /* CLIENTES                                                          */
  /* ================================================================ */
  function tabClientes(body) {
    let filter = "all";
    let q = "";
    let limit = 60;
    const counts = () => ({
      all: S.customers.length,
      near: S.customers.filter((c) => isNear(c) || isReady(c)).length,
      inactive: S.customers.filter(isInactive).length,
      push: S.customers.filter((c) => c.push).length,
    });
    function list() {
      const nq = q.toLowerCase();
      return S.customers.filter((c) => {
        if (filter === "near" && !(isNear(c) || isReady(c))) return false;
        if (filter === "inactive" && !isInactive(c)) return false;
        if (filter === "push" && !c.push) return false;
        if (!nq) return true;
        return c.name.toLowerCase().includes(nq) || c.code.toLowerCase().includes(nq) || (c.phone || "").replace(/\D/g, "").includes(nq.replace(/\D/g, "") || "~");
      });
    }
    function row(c) {
      const pct = Math.round((c.stamps / S.goal) * 100);
      return html`<div class="list__row" data-code="${c.code}">
        <span class="avatar" style="background:${S.business.design.color};color:${contrastOn(S.business.design.color)}">${initials(c.name)}</span>
        <div class="list__main">
          <div class="list__t ellipsis">${c.name} ${c.push ? html`<span title="Recibe notificaciones">${ic("bell-ring", "", 13)}</span>` : ""}</div>
          <div class="list__s ellipsis">${isAdmin() && c.phone ? `${c.phone} · ` : ""}<span class="mono">${c.code}</span> · ${c.last ? `vino ${ago(c.last)}` : `se registró ${ago(c.created)}`}</div>
          <div class="cluster mt-1" style="--gap:8px"><div class="meter"><i style="width:${pct}%;background:${S.business.design.color}"></i></div><span class="xs muted">${c.stamps}/${S.goal} · ${plural(c.total, "sello", "sellos")} · ${plural(c.rewards, "premio", "premios")}</span></div>
        </div>
        <div class="cluster" style="--gap:4px;flex-wrap:nowrap">
          <button class="btn btn--outline btn--xs" data-c="stamp" title="Sumar sello">${ic("plus", "", 14)} Sello</button>
          ${isAdmin() && c.phone ? html`<a class="btn btn--outline btn--xs btn--icon" target="_blank" rel="noopener" href="${waNudge(c, isReady(c) ? "ready" : isNear(c) ? "near" : isInactive(c) ? "inactive" : "")}" title="WhatsApp">${ic("message-circle", "", 14)}</a>` : ""}
          ${isAdmin() ? html`<button class="btn btn--outline btn--xs btn--icon" data-c="msg" title="Enviar publicidad solo a este cliente">${ic("send", "", 14)}</button>` : ""}
          ${isAdmin() ? html`<button class="btn btn--ghost btn--xs btn--icon" data-c="del" title="Eliminar">${ic("trash-2", "", 14)}</button>` : ""}
        </div>
      </div>`;
    }
    function draw() {
      const k = counts();
      const rows = list();
      mount(
        body,
        html`<div class="card fade-in">
          <div class="card__bd stack" style="--gap:12px">
            <div class="between" style="flex-wrap:wrap">
              <p class="h3">Clientes <span class="muted" style="font-weight:500">(${k.all})</span></p>
              ${isAdmin() && S.customers.length ? html`<button class="btn btn--outline btn--sm" data-c="csv">${ic("download", "", 15)} Descargar lista</button>` : ""}
            </div>
            <div class="input-group"><input class="input" data-q placeholder="Buscar por nombre, teléfono o código" value="${q}"></div>
            <div class="chips">
              ${[["all", "Todos", k.all], ["near", "Cerca del premio", k.near], ["inactive", "No vienen hace 15+ días", k.inactive], ...(isAdmin() ? [["push", "Con notificaciones", k.push]] : [])].map(
                ([id, l, n]) => html`<button class="chip${filter === id ? " is-on" : ""}" data-f="${id}">${l} <span class="n">${n}</span></button>`
              )}
            </div>
            <div class="list" data-list>
              ${rows.slice(0, limit).map(row)}
              ${!rows.length ? html`<div class="empty">${ic("users", "", 28)}${S.customers.length ? "Nadie coincide con la búsqueda." : "Aún no hay clientes. Comparte el QR de la pestaña Ajustes."}</div>` : ""}
            </div>
            ${rows.length > limit ? html`<button class="btn btn--outline btn--block" data-c="more">Mostrar más (${rows.length - limit})</button>` : ""}
          </div>
        </div>`
      );
      const input = $("[data-q]", body);
      input.addEventListener("input", () => {
        q = input.value;
        const sel = input.selectionStart;
        draw();
        const n = $("[data-q]", body);
        n.focus();
        n.setSelectionRange(sel, sel);
      });
    }
    draw();
    body.onclick = async (e) => {
      const f = e.target.closest("[data-f]");
      if (f) {
        filter = f.dataset.f;
        limit = 60;
        return draw();
      }
      const t = e.target.closest("[data-c]");
      if (!t) return;
      const code = t.closest("[data-code]")?.dataset.code;
      const c = S.customers.find((x) => x.code === code);
      const act = t.dataset.c;
      if (act === "more") {
        limit += 100;
        return draw();
      }
      if (act === "csv") return downloadCsv();
      if (act === "stamp" && c)
        return busy(t, async () => {
          try {
            const r = await call("/stamp", { method: "POST", body: { code, n: 1 } });
            Object.assign(c, r.customer);
            toast(`+1 sello para ${firstName(c.name)} (${c.stamps}/${S.goal})`);
            draw();
          } catch (err) {
            toastErr(err);
          }
        });
      if (act === "msg" && c) {
        ls.set("promo_target_" + slug, c.code);
        location.hash = "publicidad";
        return;
      }
      if (act === "del" && c) {
        if (!(await confirmBox("Eliminar cliente", `Se borrará la tarjeta de ${c.name} con sus ${c.stamps} sellos. Esto no se puede deshacer.`, "Eliminar", "btn--accent"))) return;
        try {
          await call(`/customer/${code}`, { method: "DELETE" });
          S.customers = S.customers.filter((x) => x.code !== code);
          toast("Cliente eliminado");
          draw();
        } catch (err) {
          toastErr(err);
        }
      }
    };
  }
  function downloadCsv() {
    const rows = [["Nombre", "Teléfono", "Código", "Sellos actuales", "Sellos totales", "Premios", "Registro", "Última visita", "Notificaciones"]];
    S.customers.forEach((c) => rows.push([c.name, c.phone || "", c.code, c.stamps, c.total, c.rewards, new Date(c.created).toLocaleDateString("es-EC"), c.last ? new Date(c.last).toLocaleDateString("es-EC") : "", c.push ? "Sí" : "No"]));
    const csv = "﻿" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `clientes-${slug}-${todayYmd()}.csv`;
    a.click();
  }

  /* ================================================================ */
  /* PUBLICIDAD                                                        */
  /* ================================================================ */
  function tabPublicidad(body) {
    const b = S.business;
    const st = { title: "", body: "", image: null, btn: "none", link: "", linkLabel: "", days: 7, aud: "all", target: "", push: true };
    const pending = ls.get("promo_target_" + slug);
    if (pending) {
      st.aud = "one";
      st.target = pending;
      ls.del("promo_target_" + slug);
    }
    const audCount = () => ({
      all: S.customers.length,
      near: S.customers.filter((c) => S.goal - c.stamps <= 2).length,
      inactive: S.customers.filter(isInactive).length,
      one: 1,
    });
    const targetsOf = (aud) =>
      aud === "one" ? S.customers.filter((c) => c.code === st.target) : aud === "near" ? S.customers.filter((c) => S.goal - c.stamps <= 2) : aud === "inactive" ? S.customers.filter(isInactive) : S.customers;
    const pushIn = (aud) => targetsOf(aud).filter((c) => c.push).length;
    const linkOf = () => (st.btn === "wa" ? (b.contact?.whatsapp ? waLink(b.contact.whatsapp, `Hola ${b.name} 👋 Vi la promo: ${st.title}`, cc()) : "") : st.btn === "url" ? st.link.trim() : "");

    function previewHTML() {
      return html`<div class="stack" style="--gap:14px">
        <div><p class="small strong muted">Así llega a su celular</p>
          <div class="notif-preview mt-2"><div class="notif">
            <div class="notif__ic" style="background:${b.design.color};color:${contrastOn(b.design.color)};overflow:hidden">${b.design.logoSmall ? html`<img src="${b.design.logoSmall}" style="width:100%;height:100%;object-fit:cover">` : initials(b.name)}</div>
            <div><div class="notif__app"><span>${b.name.toUpperCase()}</span><span>ahora</span></div><b>${b.name}: ${st.title || "Título de tu promoción"}</b><p>${st.body || b.reward}</p></div>
          </div></div>
        </div>
        <div><p class="small strong muted">Y así se ve en su tarjeta</p>
          <div class="card promo mt-2" style="--brand:${b.design.color}">
            ${st.image ? html`<img class="promo__img" src="${st.image}" alt="">` : ""}
            <div class="promo__bd"><span class="promo__tag">${ic("megaphone", "", 13)} Promoción</span>
              <p class="h3 mt-1" style="font-size:16px">${st.title || "Título de tu promoción"}</p>
              ${st.body ? html`<p class="muted mt-1 small" style="white-space:pre-line">${st.body}</p>` : ""}
              ${linkOf() ? html`<span class="btn btn--brand btn--sm mt-3" style="--brand:${b.design.color};--brand-on:${contrastOn(b.design.color)}">${st.btn === "wa" ? "Pedir por WhatsApp" : st.linkLabel || "Ver más"}</span>` : ""}
            </div>
          </div>
        </div>
      </div>`;
    }

    function promoRow(p) {
      const audLabel = { all: "Todos", near: "Cerca del premio", inactive: "Inactivos", one: `Solo ${p.target || "1 cliente"}` }[p.aud] || p.aud;
      const expired = p.expires < Date.now();
      return html`<div class="list__row" data-pid="${p.id}" style="align-items:flex-start">
        ${p.img ? html`<img src="${p.img}" alt="" style="width:54px;height:54px;border-radius:10px;object-fit:cover;flex:none">` : html`<span class="icon-bubble icon-bubble--soft">${ic("megaphone", "", 18)}</span>`}
        <div class="list__main">
          <div class="list__t">${p.title} ${expired ? html`<span class="badge">Terminó</span>` : ""}</div>
          ${p.body ? html`<div class="list__s" style="white-space:pre-line">${p.body.length > 140 ? p.body.slice(0, 140) + "…" : p.body}</div>` : ""}
          <div class="cluster mt-2" style="--gap:6px">
            <span class="badge">${ic("users", "", 12)} ${audLabel} · ${p.reach}</span>
            <span class="badge badge--info">${ic("bell-ring", "", 12)} ${p.push?.ok || 0} notificaciones</span>
            <span class="badge">${ic("eye", "", 12)} ${p.views} vistas</span>
            <span class="badge">${ic("mouse-pointer-click", "", 12)} ${p.clicks} aperturas</span>
          </div>
          <div class="xs muted mt-1">${fmtDate(p.created, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${expired ? "terminó" : "vigente hasta"} ${fmtDate(p.expires, { day: "numeric", month: "short" })}</div>
        </div>
        <div class="cluster" style="--gap:4px;flex-wrap:nowrap">
          <button class="btn btn--outline btn--xs" data-p="wa" title="Enviar por WhatsApp">${ic("message-circle", "", 14)}</button>
          <button class="btn btn--ghost btn--xs btn--icon" data-p="del" title="Eliminar">${ic("trash-2", "", 14)}</button>
        </div>
      </div>`;
    }

    function draw() {
      const k = audCount();
      const blocked = S.status.blocked;
      const targetC = S.customers.find((c) => c.code === st.target);
      mount(
        body,
        html`<div class="stack fade-in" style="--gap:16px">
          <div class="designer">
            <form class="card card__bd stack" style="--gap:16px" data-form novalidate>
              <div><p class="h3">Nueva publicidad</p><p class="muted small mt-1">La promoción aparece en la tarjeta de tus clientes y, si lo han activado, también llega como notificación a su teléfono.</p></div>
              ${blocked ? html`<div class="alert alert--danger">${ic("circle-pause", "", 18)}<div>Tu cuenta está pausada: no puedes enviar publicidad hasta renovar.</div></div>` : ""}
              <div class="field"><label class="label">Título</label><input class="input" name="title" maxlength="70" placeholder="Ej: Hoy 2x1 en cafés de 16:00 a 18:00" value="${st.title}"></div>
              <div class="field"><label class="label">Mensaje <span class="muted" style="font-weight:400">(opcional)</span></label><textarea class="input" name="body" maxlength="300" placeholder="Ej: Solo hoy. Muestra tu tarjeta en caja.">${st.body}</textarea></div>
              <div class="field"><span class="label">Imagen <span class="muted" style="font-weight:400">(opcional)</span></span>
                <div class="upload">
                  <div class="upload__thumb">${st.image ? html`<img src="${st.image}" alt="">` : ic("image", "", 20)}</div>
                  <label class="btn btn--outline btn--sm">${ic("upload", "", 15)} ${st.image ? "Cambiar" : "Subir foto"}<input type="file" accept="image/*" data-img hidden></label>
                  ${st.image ? html`<button class="btn btn--ghost btn--sm" type="button" data-p="noimg">Quitar</button>` : ""}
                </div>
              </div>
              <div class="field"><span class="label">Botón</span>
                <div class="seg" data-seg="btn">${[["none", "Sin botón"], ["wa", "Pedir por WhatsApp"], ["url", "Enlace"]].map(([v, l]) => html`<button type="button" class="${st.btn === v ? "is-on" : ""}" data-v="${v}">${l}</button>`)}</div>
                ${st.btn === "wa" && !b.contact?.whatsapp ? html`<p class="hint" style="color:var(--warn)">Primero agrega el WhatsApp de tu local en Ajustes.</p>` : ""}
                ${st.btn === "url" ? html`<div class="form-row mt-2"><input class="input" name="link" placeholder="https://..." value="${st.link}"><input class="input" name="linkLabel" maxlength="30" placeholder="Texto del botón (ej: Ver menú)" value="${st.linkLabel}"></div>` : ""}
              </div>
              <div class="form-row">
                <div class="field"><label class="label">Vigencia</label>
                  <select class="input" name="days">${[1, 3, 7, 15, 30].map((d) => html`<option value="${d}" ${st.days === d ? "selected" : ""}>${d === 1 ? "Solo hoy (24 h)" : `${d} días`}</option>`)}</select></div>
                <div class="field"><label class="label">¿A quién?</label>
                  <select class="input" name="aud">
                    <option value="all" ${st.aud === "all" ? "selected" : ""}>Todos mis clientes (${k.all})</option>
                    <option value="near" ${st.aud === "near" ? "selected" : ""}>Cerca del premio (${k.near})</option>
                    <option value="inactive" ${st.aud === "inactive" ? "selected" : ""}>No vienen hace 15+ días (${k.inactive})</option>
                    <option value="one" ${st.aud === "one" ? "selected" : ""}>Un cliente específico</option>
                  </select></div>
              </div>
              ${st.aud === "one"
                ? html`<div class="field"><label class="label">Cliente</label><select class="input" name="target"><option value="">Elige…</option>${S.customers.map((c) => html`<option value="${c.code}" ${st.target === c.code ? "selected" : ""}>${c.name}${c.phone ? ` · ${c.phone}` : ""}</option>`)}</select></div>`
                : ""}
              <label class="switch"><input type="checkbox" name="push" ${st.push ? "checked" : ""}><span class="track"></span><span>Enviar también como notificación al celular <span class="muted">(${pushIn(st.aud)} ${pushIn(st.aud) === 1 ? "cliente la recibirá" : "clientes la recibirán"})</span></span></label>
              <button class="btn btn--accent btn--lg btn--block" type="submit" ${blocked ? "disabled" : ""}>${ic("send", "", 18)} Publicar y enviar</button>
              ${st.aud === "one" && targetC ? html`<p class="hint center">Solo ${targetC.name} verá esta publicidad.</p>` : ""}
            </form>
            <div class="designer__preview"><div class="card card__bd"><p class="h4">Vista previa</p><div class="mt-3" data-prev>${previewHTML()}</div></div></div>
          </div>
          <div class="card card__bd">
            <div class="between"><p class="h4">Promociones publicadas</p><span class="badge">${S.promos.length}</span></div>
            <div class="list mt-2">${S.promos.length ? S.promos.map(promoRow) : html`<div class="empty">No hay promociones todavía.</div>`}</div>
          </div>
        </div>`
      );
      const f = $("[data-form]", body);
      f.addEventListener("input", (e) => {
        const n = e.target.name;
        if (!n) return;
        if (n === "push") st.push = e.target.checked;
        else if (n === "days") st.days = +e.target.value;
        else if (n === "aud") {
          st.aud = e.target.value;
          return draw();
        } else if (n === "target") {
          st.target = e.target.value;
          return draw();
        } else st[n] = e.target.value;
        $("[data-prev]", body).innerHTML = previewHTML().s;
      });
      $("[data-img]", body).addEventListener("change", async (e) => {
        try {
          const img = await loadImage(e.target.files[0]);
          st.image = fitImage(img, 1000, 0.8);
          draw();
        } catch (err) {
          toastErr(err);
        }
      });
      $("[data-seg=btn]", body).addEventListener("click", (e) => {
        const v = e.target.closest("[data-v]")?.dataset.v;
        if (!v) return;
        st.btn = v;
        draw();
      });
      f.addEventListener("submit", (e) => {
        e.preventDefault();
        send(f.querySelector("[type=submit]"));
      });
    }

    async function send(btn) {
      if (st.title.trim().length < 3) return toastErr("Escribe un título (mínimo 3 letras)");
      if (st.aud === "one" && !st.target) return toastErr("Elige el cliente");
      if (st.btn === "url" && !/^https?:\/\//i.test(st.link.trim())) return toastErr("El enlace debe empezar con https://");
      if (st.btn === "wa" && !b.contact?.whatsapp) return toastErr("Agrega el WhatsApp de tu local en Ajustes");
      const audience = targetsOf(st.aud);
      await busy(btn, async () => {
        try {
          const r = await call("/promo", {
            method: "POST",
            body: { title: st.title.trim(), body: st.body.trim(), image: st.image || undefined, link: linkOf(), linkLabel: st.btn === "wa" ? "Pedir por WhatsApp" : st.linkLabel, days: st.days, aud: st.aud, target: st.target, push: st.push },
          });
          S.promos.unshift(r.promo);
          const sentTitle = st.title.trim();
          const sentBody = st.body.trim();
          Object.assign(st, { title: "", body: "", image: null, btn: "none", link: "", linkLabel: "" });
          draw();
          resultModal(r, audience, sentTitle, sentBody);
        } catch (err) {
          toastErr(err);
        }
      });
    }

    function resultModal(r, audience, title, text, resend) {
      const noPush = audience.filter((c) => !c.push && c.phone);
      const msg = (c) => `*${title}*${text ? `\n${text}` : ""}\n\n${b.name} · Tu tarjeta: ${cardUrl(c.code)}`;
      modal({
        title: resend ? "Enviar por WhatsApp" : "¡Publicidad enviada!",
        wide: true,
        body: html`<div class="stack" style="--gap:12px">
          ${resend ? "" : html`<div class="alert alert--ok">${ic("circle-check", "", 18)}<div>Publicada en <b>${plural(r.promo.reach, "tarjeta", "tarjetas")}</b>${r.push.ok ? html` · llegó como notificación a <b>${plural(r.push.ok, "teléfono", "teléfonos")}</b>` : ""}.</div></div>`}
          ${resend ? "" : r.push.failed ? html`<p class="hint">${plural(r.push.failed, "teléfono ya no acepta", "teléfonos ya no aceptan")} notificaciones (desinstalaron o bloquearon). Los quitamos solos.</p>` : ""}
          ${isAdmin() && noPush.length
            ? html`<div><p class="h4">${resend ? "Tus clientes" : "Que les llegue también por WhatsApp"}</p><p class="hint mt-1">${resend ? "Toca cada cliente para enviarle la promo por WhatsApp:" : html`${plural(noPush.length, "cliente no tiene", "clientes no tienen")} notificaciones activadas. Toca cada uno para enviarle la promo por WhatsApp:`}</p>
              <div class="list mt-2" style="max-height:320px;overflow:auto">${noPush.slice(0, 200).map(
                (c) => html`<div class="list__row"><div class="list__main"><div class="list__t">${c.name}</div><div class="list__s">${c.phone}</div></div><a class="btn btn--wa btn--xs" target="_blank" rel="noopener" href="${waLink(c.phone, msg(c), cc())}" data-sent>${ic("message-circle", "", 14)} Enviar</a></div>`
              )}</div></div>`
            : ""}
        </div>`,
        actions: [{ label: "Listo", cls: "btn--primary" }],
        onOpen: (m) => m.addEventListener("click", (e) => {
          const a = e.target.closest("[data-sent]");
          if (a) setTimeout(() => (a.outerHTML = `<span class="badge badge--ok">Enviado ✓</span>`), 400);
        }),
      });
    }

    body.onclick = async (e) => {
      const t = e.target.closest("[data-p]");
      if (!t) return;
      if (t.dataset.p === "noimg") {
        st.image = null;
        return draw();
      }
      const id = t.closest("[data-pid]")?.dataset.pid;
      const p = S.promos.find((x) => x.id === id);
      if (!p) return;
      if (t.dataset.p === "del") {
        if (!(await confirmBox("Eliminar promoción", `“${p.title}” dejará de aparecer en las tarjetas.`, "Eliminar", "btn--accent"))) return;
        try {
          await call(`/promo/${id}`, { method: "DELETE" });
          S.promos = S.promos.filter((x) => x.id !== id);
          toast("Promoción eliminada");
          draw();
        } catch (err) {
          toastErr(err);
        }
      }
      if (t.dataset.p === "wa") {
        const aud = (p.aud === "one" ? S.customers.filter((c) => c.name === p.target) : targetsOf(p.aud)).map((c) => ({ ...c, push: false }));
        if (!aud.some((c) => c.phone)) return toastErr("No hay clientes con teléfono en ese grupo");
        resultModal({ promo: p, push: { ok: 0, failed: 0 } }, aud, p.title, p.body, true);
      }
    };
    const onTarget = (e) => {
      st.aud = "one";
      st.target = e.detail;
      draw();
    };
    window.addEventListener("fz:promo-target", onTarget);
    cleanups.push(() => window.removeEventListener("fz:promo-target", onTarget));
    draw();
  }

  /* ================================================================ */
  /* MI TARJETA (diseñador)                                            */
  /* ================================================================ */
  function tabTarjeta(body) {
    const b = S.business;
    const D = {
      ...b.design,
      stampsGoal: b.stampsGoal,
      reward: b.reward,
      bonusJoin: !!b.bonusJoin,
      nearMsg: b.nearMsg,
    };
    let previewMode = "mitad";
    let dirty = false;
    const bizFromDraft = () => ({ ...b, stampsGoal: D.stampsGoal, reward: D.reward, design: { ...D } });
    const previewStamps = () => (previewMode === "nueva" ? (D.bonusJoin ? 1 : 0) : previewMode === "completa" ? D.stampsGoal : Math.max(1, Math.floor(D.stampsGoal / 2)));

    function previewHTML() {
      const bb = bizFromDraft();
      const st = previewStamps();
      const left = D.stampsGoal - st;
      const near = fillTemplate(D.nearMsg, { nombre: "María", negocio: b.name, faltan: left || 1, premio: D.reward, distancia: "80 m", sellos: st });
      return html`<div class="preview-phone">
        <div class="seg" data-pv>${[["nueva", "Nueva"], ["mitad", "A medio camino"], ["completa", "Completa"]].map(([v, l]) => html`<button type="button" class="${previewMode === v ? "is-on" : ""}" data-v="${v}">${l}</button>`)}</div>
        ${cardHTML(bb, { name: "María Pérez", stamps: st, code: "ABC123" })}
        <div class="status-line mt-3${left <= 0 ? " status-line--full" : ""}" style="font-size:13px">${left <= 0 ? html`<span>🎉 ¡Tarjeta completa! Reclama: <b>${D.reward}</b></span>` : html`${ic("gift", "", 16)}<span>Te faltan <b>${plural(left, "sello", "sellos")}</b> para: <b>${D.reward}</b></span>`}</div>
        <div class="card mt-3" style="padding:12px 14px"><p class="xs strong muted">${ic("map-pin", "", 12)} Aviso al pasar a ${b.location?.radius || 100} m</p><p class="small strong mt-1">${near}</p></div>
      </div>`;
    }
    const refreshPreview = () => ($("[data-preview]", body).innerHTML = previewHTML().s);

    function draw() {
      mount(
        body,
        html`<div class="designer fade-in">
          <div class="stack" style="--gap:16px">
            <div class="card card__bd stack" style="--gap:14px">
              <div><p class="h3">Diseño de la tarjeta</p><p class="muted small mt-1">Así la verán tus clientes en su celular. Los cambios se ven al instante en la vista previa.</p></div>
              <div class="tpls">${TEMPLATES.map((t) => html`<button type="button" class="tpl${D.template === t.id ? " is-on" : ""}" data-tpl="${t.id}"><div class="tpl__sw" style="${templateSwatch(t.id, D.color, D.color2)}"></div>${t.name}</button>`)}</div>
              <div class="field"><span class="label">Color principal</span>
                <div class="cluster">${COLORS.map((c) => html`<button type="button" data-color="${c}" aria-label="${c}" style="width:30px;height:30px;border-radius:50%;background:${c};border:${D.color === c ? "3px solid #fff;box-shadow:0 0 0 2px #09090b" : "1px solid rgba(0,0,0,.1)"};cursor:pointer"></button>`)}
                <input type="color" class="swatch-input" data-in="color" value="${D.color}" title="Otro color"></div>
              </div>
              ${D.template === "degradado" ? html`<div class="field"><span class="label">Segundo color del degradado</span><div class="cluster"><input type="color" class="swatch-input" data-in="color2" value="${D.color2}"><span class="xs muted">Elige un tono que combine con el principal.</span></div></div>` : ""}
              <div class="field"><span class="label">Logo</span>
                <div class="upload">
                  <div class="upload__thumb">${D.logo ? html`<img src="${D.logo}" alt="">` : ic("image", "", 20)}</div>
                  <label class="btn btn--outline btn--sm">${ic("upload", "", 15)} ${D.logo ? "Cambiar logo" : "Subir logo"}<input type="file" accept="image/*" data-up="logo" hidden></label>
                  ${D.logo ? html`<button type="button" class="btn btn--ghost btn--sm" data-rm="logo">Quitar</button>` : ""}
                </div>
                <p class="hint">Cuadrado de preferencia. También será el ícono cuando tu cliente guarde la tarjeta en su pantalla de inicio.</p>
              </div>
              ${D.template === "foto"
                ? html`<div class="field"><span class="label">Foto de fondo</span>
                  <div class="upload">
                    <div class="upload__thumb" style="width:84px">${D.bg ? html`<img src="${D.bg}" alt="">` : ic("image", "", 20)}</div>
                    <label class="btn btn--outline btn--sm">${ic("upload", "", 15)} ${D.bg ? "Cambiar foto" : "Subir foto"}<input type="file" accept="image/*" data-up="bg" hidden></label>
                    ${D.bg ? html`<button type="button" class="btn btn--ghost btn--sm" data-rm="bg">Quitar</button>` : ""}
                  </div><p class="hint">Una foto de tu local o tu producto estrella. Le ponemos sombra para que el texto se lea.</p></div>`
                : ""}
            </div>

            <div class="card card__bd stack" style="--gap:14px">
              <p class="h3">Sellos y premio</p>
              <div class="field"><span class="label">Ícono del sello</span>
                <div class="emoji-grid">${ICONS.map((x) => html`<button type="button" class="${D.icon === x ? "is-on" : ""}" data-icon="${x}">${x}</button>`)}</div>
              </div>
              <div class="field"><label class="label">Sellos necesarios: <b data-goal-v>${D.stampsGoal}</b></label><input type="range" min="3" max="15" value="${D.stampsGoal}" data-in="stampsGoal"></div>
              <div class="field"><label class="label">Premio al completar la tarjeta</label><input class="input" maxlength="60" data-in="reward" value="${D.reward}" placeholder="Ej: Un café gratis"></div>
              <label class="switch"><input type="checkbox" data-in="bonusJoin" ${D.bonusJoin ? "checked" : ""}><span class="track"></span><span>Regalar el primer sello al registrarse <span class="muted">(se registran más)</span></span></label>
            </div>

            <div class="card card__bd stack" style="--gap:14px">
              <p class="h3">Textos</p>
              <div class="field"><label class="label">Nombre de la tarjeta</label><input class="input" maxlength="40" data-in="title" value="${D.title}" placeholder="Ej: Club del Pan"></div>
              <div class="field"><label class="label">Mensaje de bienvenida</label><textarea class="input" maxlength="160" data-in="welcome" placeholder="Ej: ¡Gracias por visitarnos!">${D.welcome}</textarea></div>
              <div class="field"><label class="label">Mensaje cuando pasa cerca de tu local</label>
                <textarea class="input" maxlength="220" data-in="nearMsg">${D.nearMsg}</textarea>
                <div class="cluster" style="--gap:6px">${["nombre", "negocio", "faltan", "premio", "distancia"].map((v) => html`<button type="button" class="chip" style="height:28px" data-var="${v}">{${v}}</button>`)}</div>
                <p class="hint">Toca una etiqueta para insertarla: se reemplaza con el nombre del cliente, los sellos que le faltan, etc.</p>
              </div>
              <div class="field"><label class="label">Letra pequeña <span class="muted" style="font-weight:400">(opcional)</span></label><textarea class="input" maxlength="240" data-in="terms" placeholder="Ej: Un sello por compra mayor a $3. No acumulable con otras promociones.">${D.terms}</textarea></div>
            </div>
            <div class="cluster" style="position:sticky;bottom:12px;z-index:5"><button class="btn btn--lg btn--accent" data-save style="box-shadow:var(--shadow-lg)">${ic("check", "", 18)} Guardar diseño</button><span class="small muted" data-dirty></span></div>
          </div>
          <div class="designer__preview"><div class="card card__bd"><div class="between"><p class="h4">Vista previa</p><span class="xs muted">Celular del cliente</span></div><div class="mt-3" data-preview>${previewHTML()}</div></div></div>
        </div>`
      );
    }
    const markDirty = () => {
      dirty = true;
      const el = $("[data-dirty]", body);
      if (el) el.textContent = "Tienes cambios sin guardar";
    };
    draw();

    body.oninput = (e) => {
      const k = e.target.dataset.in;
      if (!k) return;
      if (k === "stampsGoal") {
        D.stampsGoal = +e.target.value;
        $("[data-goal-v]", body).textContent = D.stampsGoal;
      } else if (k === "bonusJoin") D.bonusJoin = e.target.checked;
      else D[k] = e.target.value;
      markDirty();
      refreshPreview();
    };
    body.onclick = async (e) => {
      const t = e.target;
      const tpl = t.closest("[data-tpl]");
      if (tpl) {
        D.template = tpl.dataset.tpl;
        markDirty();
        return draw();
      }
      const col = t.closest("[data-color]");
      if (col) {
        D.color = col.dataset.color;
        markDirty();
        return draw();
      }
      const icn = t.closest("[data-icon]");
      if (icn) {
        D.icon = icn.dataset.icon;
        $$("[data-icon]", body).forEach((x) => x.classList.toggle("is-on", x === icn));
        markDirty();
        return refreshPreview();
      }
      const pv = t.closest("[data-pv] [data-v]");
      if (pv) {
        previewMode = pv.dataset.v;
        return refreshPreview();
      }
      const v = t.closest("[data-var]");
      if (v) {
        const ta = $('[data-in="nearMsg"]', body);
        const s = ta.selectionStart ?? ta.value.length;
        ta.value = ta.value.slice(0, s) + `{${v.dataset.var}}` + ta.value.slice(ta.selectionEnd ?? s);
        D.nearMsg = ta.value;
        markDirty();
        return refreshPreview();
      }
      const rm = t.closest("[data-rm]");
      if (rm)
        return busy(rm, async () => {
          try {
            const r = await call(`/image/${rm.dataset.rm}`, { method: "DELETE" });
            S.business = r.business;
            Object.assign(b, r.business);
            D.logo = r.business.design.logo;
            D.logoSmall = r.business.design.logoSmall;
            D.bg = r.business.design.bg;
            draw();
            toast("Imagen quitada");
          } catch (err) {
            toastErr(err);
          }
        });
      if (t.closest("[data-save]"))
        return busy(t.closest("[data-save]"), async () => {
          try {
            const r = await call("/settings", {
              method: "PUT",
              body: {
                stampsGoal: D.stampsGoal,
                reward: D.reward,
                bonusJoin: D.bonusJoin,
                nearMsg: D.nearMsg,
                design: { template: D.template, color: D.color, color2: D.color2, icon: D.icon, title: D.title, welcome: D.welcome, terms: D.terms },
              },
            });
            S.business = { ...S.business, ...r.business };
            Object.assign(b, r.business);
            S.goal = r.business.stampsGoal;
            dirty = false;
            $("[data-dirty]", body).textContent = "";
            toast("¡Diseño guardado! Tus clientes ya lo ven");
          } catch (err) {
            toastErr(err);
          }
        });
    };
    body.onchange = async (e) => {
      const up = e.target.dataset.up;
      if (!up || !e.target.files?.[0]) return;
      try {
        const img = await loadImage(e.target.files[0]);
        toast("Subiendo imagen…");
        let r;
        if (up === "logo") {
          const sq = (size) => {
            const cv = document.createElement("canvas");
            cv.width = cv.height = size;
            const g = cv.getContext("2d");
            const s = Math.min(img.naturalWidth, img.naturalHeight);
            g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
            let out = cv.toDataURL("image/png");
            if (out.length > 500_000) {
              g.globalCompositeOperation = "destination-over";
              g.fillStyle = "#ffffff";
              g.fillRect(0, 0, size, size);
              out = cv.toDataURL("image/jpeg", 0.88);
            }
            return out;
          };
          r = await call("/image/logo", { method: "PUT", body: { large: sq(512), small: sq(192) } });
        } else {
          r = await call("/image/bg", { method: "PUT", body: { data: coverImage(img, 900, 560, 0.8) } });
        }
        S.business = { ...S.business, ...r.business };
        Object.assign(b, r.business);
        D.logo = r.business.design.logo;
        D.logoSmall = r.business.design.logoSmall;
        D.bg = r.business.design.bg;
        draw();
        toast("¡Imagen lista!");
        if (up === "logo") {
          const who = $(".panel__who .logo", app);
          if (who) who.outerHTML = logoEl(S.business).s;
        }
      } catch (err) {
        toastErr(err);
      }
    };
    const warn = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    cleanups.push(() => {
      window.removeEventListener("beforeunload", warn);
      body.oninput = body.onchange = null;
    });
  }

  /* ================================================================ */
  /* AJUSTES                                                           */
  /* ================================================================ */
  function tabAjustes(body) {
    const b = S.business;
    let loc = b.location ? { ...b.location } : null;
    let radius = b.location?.radius || 100;

    function mapHTML() {
      if (!loc) return html`<div class="map-frame" style="display:grid;place-items:center;color:var(--muted);font-size:14px">Sin ubicación todavía</div>`;
      const d = 0.0035;
      const src = `https://www.openstreetmap.org/export/embed.html?bbox=${loc.lng - d},${loc.lat - d},${loc.lng + d},${loc.lat + d}&layer=mapnik&marker=${loc.lat},${loc.lng}`;
      return html`<iframe class="map-frame" src="${src}" loading="lazy" title="Mapa del local"></iframe>`;
    }
    function parseCoords(t) {
      t = String(t || "");
      const pats = [/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /[?&](?:q|ll|query|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /^\s*(-?\d+\.\d+)\s*[, ]\s*(-?\d+\.\d+)\s*$/];
      for (const p of pats) {
        const m = p.exec(t);
        if (m) return { lat: +m[1], lng: +m[2] };
      }
      return null;
    }

    function draw() {
      const ct = b.contact || {};
      mount(
        body,
        html`<div class="grid g2 fade-in" style="align-items:start">
          <div class="stack" style="--gap:16px">
            <form class="card card__bd stack" style="--gap:14px" data-f="datos">
              <p class="h3">Datos del negocio</p>
              <div class="field"><label class="label">Nombre del negocio</label><input class="input" name="name" value="${b.name}" maxlength="60"></div>
              <div class="form-row">
                <div class="field"><label class="label">WhatsApp del local</label><input class="input" name="whatsapp" type="tel" value="${ct.whatsapp || ""}" placeholder="0991234567"></div>
                <div class="field"><label class="label">Instagram</label><input class="input" name="instagram" value="${ct.instagram || ""}" placeholder="@tunegocio"></div>
              </div>
              <div class="field"><label class="label">Dirección</label><input class="input" name="address" value="${ct.address || ""}" maxlength="120" placeholder="Ej: Av. Quito y García Moreno, Milagro"></div>
              <div class="field"><label class="label">País (para los enlaces de WhatsApp)</label><select class="input" name="cc">${COUNTRIES.map(([v, l]) => html`<option value="${v}" ${(b.cc || "593") === v ? "selected" : ""}>${l}</option>`)}</select></div>
              <button class="btn" type="submit">Guardar cambios</button>
            </form>

            <div class="card card__bd stack" style="--gap:14px">
              <div><p class="h3">Ubicación del local</p><p class="muted small mt-1">Para el aviso “estás cerca”: cuando un cliente pase a esta distancia con su tarjeta abierta, le aparece y lo invita a entrar.</p></div>
              <button class="btn btn--outline" data-a="here">${ic("locate-fixed", "", 17)} Usar mi ubicación actual</button>
              <p class="hint" style="margin-top:-6px">Hazlo parado dentro de tu local, con el GPS del celular encendido.</p>
              <div class="input-group"><input class="input" data-coords placeholder="O pega un link de Google Maps o “-2.1347, -79.5872”"><button class="btn btn--outline" data-a="paste">Usar</button></div>
              <div data-map>${mapHTML()}</div>
              <div class="field"><label class="label">Distancia del aviso: <b data-rv>${radius} m</b></label><input type="range" min="50" max="500" step="10" value="${radius}" data-radius></div>
              <div class="cluster">
                <button class="btn" data-a="saveloc" ${loc ? "" : "disabled"}>Guardar ubicación</button>
                ${b.location ? html`<button class="btn btn--ghost" data-a="rmloc">Quitar</button>` : ""}
                ${b.location ? html`<span class="badge badge--ok">${ic("check", "", 12)} Activa</span>` : html`<span class="badge badge--warn">Sin configurar</span>`}
              </div>
            </div>
          </div>

          <div class="stack" style="--gap:16px">
            <div class="card card__bd stack" style="--gap:14px">
              <div><p class="h3">QR para tus clientes</p><p class="muted small mt-1">Imprime este código y colócalo en tu local. Tus clientes lo escanean, escriben su nombre y teléfono una vez, y cada visita verán su misma tarjeta.</p></div>
              <div style="width:180px;height:180px;margin:0 auto;padding:10px;border:1px solid var(--line);border-radius:16px">${raw(qrSvg(joinUrl()))}</div>
              <div class="keybox"><span class="ellipsis" style="font-family:var(--font);letter-spacing:0;font-size:14px">${joinUrl()}</span><button class="btn btn--ghost btn--xs" data-a="copy">${ic("copy", "", 14)} Copiar enlace</button></div>
              <div class="cluster">
                <button class="btn" data-a="poster">${ic("printer", "", 16)} Imprimir cartel</button>
                <button class="btn btn--outline" data-a="dlqr">${ic("download", "", 16)} Descargar QR</button>
              </div>
            </div>

            <form class="card card__bd stack" style="--gap:14px" data-f="claves">
              <p class="h3">Claves</p>
              <div class="field"><span class="label">Clave de empleado actual:</span><div class="keybox"><span>${b.staffKey || "—"}</span><button type="button" class="btn btn--ghost btn--xs" data-a="copykey">${ic("copy", "", 14)} Copiar</button></div>
                <p class="hint">Comparte solo la clave de empleado con tu personal: pueden sumar sellos pero no ver teléfonos ni cambiar la configuración.</p></div>
              <p class="h4">Cambiar claves (opcional)</p>
              <div class="form-row">
                <div class="field"><label class="label">Nueva clave de administrador</label><input class="input" name="admin" type="password" autocomplete="new-password" placeholder="Dejar vacío para no cambiar"></div>
                <div class="field"><label class="label">Nueva clave de empleado</label><input class="input" name="staff" placeholder="Dejar vacío para no cambiar"></div>
              </div>
              <button class="btn btn--outline" type="submit">Guardar claves</button>
            </form>

            <div class="card card__bd">
              <p class="h3">Tu plan</p>
              <p class="mt-2 small">${planLine()}</p>
            </div>
          </div>
        </div>`
      );
      $("[data-radius]", body).addEventListener("input", (e) => {
        radius = +e.target.value;
        $("[data-rv]", body).textContent = radius + " m";
      });
    }
    draw();

    body.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector("[type=submit]");
      if (f.dataset.f === "datos")
        return busy(btn, async () => {
          try {
            const r = await call("/settings", { method: "PUT", body: { name: f.name.value, cc: f.cc.value, contact: { whatsapp: f.whatsapp.value, instagram: f.instagram.value, address: f.address.value } } });
            Object.assign(b, r.business);
            S.business = { ...S.business, ...r.business };
            $(".panel__name", app).textContent = b.name;
            toast("Datos guardados");
          } catch (err) {
            toastErr(err);
          }
        });
      if (f.dataset.f === "claves")
        return busy(btn, async () => {
          const admin = f.admin.value.trim();
          const staff = f.staff.value.trim();
          if (!admin && !staff) return toastErr("Escribe al menos una clave nueva");
          try {
            const r = await call("/keys", { method: "PUT", body: { admin, staff } });
            b.staffKey = r.staffKey;
            if (admin && S.role === "admin") {
              ls.set("biz_" + slug, { ...ls.get("biz_" + slug), key: admin });
              auth.key = admin;
            }
            toast("Claves actualizadas");
            draw();
          } catch (err) {
            toastErr(err);
          }
        });
    };
    body.onclick = async (e) => {
      const t = e.target.closest("[data-a]");
      if (!t) return;
      const a = t.dataset.a;
      if (a === "copy") return copyText(joinUrl());
      if (a === "copykey") return copyText(b.staffKey || "");
      if (a === "dlqr") {
        const cv = qrCanvas(joinUrl(), 1200);
        const link = document.createElement("a");
        link.download = `qr-${slug}.png`;
        link.href = cv.toDataURL("image/png");
        return link.click();
      }
      if (a === "poster") return posterModal();
      if (a === "here") {
        if (!navigator.geolocation) return toastErr("Este dispositivo no permite ubicación");
        return busy(t, () =>
          new Promise((res) =>
            navigator.geolocation.getCurrentPosition(
              (p) => {
                loc = { lat: p.coords.latitude, lng: p.coords.longitude };
                draw();
                toast(`Ubicación tomada (precisión ±${Math.round(p.coords.accuracy)} m). Revisa el mapa y guarda.`);
                res();
              },
              (err) => {
                toastErr(err.code === 1 ? "Permite el acceso a tu ubicación en el navegador" : "No se pudo obtener la ubicación. Intenta de nuevo.");
                res();
              },
              { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
            )
          )
        );
      }
      if (a === "paste") {
        const c = parseCoords($("[data-coords]", body).value);
        if (!c) return toastErr("No encontramos coordenadas. En Google Maps mantén presionado tu local y copia los números.");
        loc = c;
        draw();
        return toast("Ubicación cargada. Revisa el mapa y guarda.");
      }
      if (a === "saveloc" && loc)
        return busy(t, async () => {
          try {
            const r = await call("/settings", { method: "PUT", body: { location: { lat: loc.lat, lng: loc.lng, radius } } });
            Object.assign(b, r.business);
            S.business = { ...S.business, ...r.business };
            loc = { ...r.business.location };
            draw();
            toast(`¡Listo! El aviso se activa a ${radius} m de tu local`);
          } catch (err) {
            toastErr(err);
          }
        });
      if (a === "rmloc")
        return busy(t, async () => {
          try {
            const r = await call("/settings", { method: "PUT", body: { location: null } });
            Object.assign(b, r.business);
            S.business = { ...S.business, ...r.business };
            loc = null;
            draw();
            toast("Ubicación quitada");
          } catch (err) {
            toastErr(err);
          }
        });
    };
    cleanups.push(() => (body.onsubmit = null));
  }

  function posterModal() {
    const b = S.business;
    const dz = b.design;
    const on = dz.template === "premium" ? "#fafaf9" : contrastOn(dz.color);
    const bg = dz.template === "degradado" ? `linear-gradient(135deg,${dz.color},${dz.color2})` : dz.template === "premium" ? `linear-gradient(150deg,#27272a,#0c0a09 60%,#1c1917)` : dz.color;
    modal({
      title: "Cartel para tu local",
      wide: true,
      body: html`<div class="print-area"><div class="poster" style="--c1:${dz.color};--on:${on};background:${bg};color:${on}">
          <div style="display:flex;align-items:center;justify-content:center;gap:12px">
            ${b.design.logo ? html`<img src="${b.design.logo}" alt="" style="width:56px;height:56px;border-radius:14px;object-fit:cover;background:#fff">` : ""}
            <span style="font-size:24px;font-weight:800;letter-spacing:-.02em">${b.name}</span>
          </div>
          <p style="font-size:40px;font-weight:800;letter-spacing:-.03em;line-height:1.05;margin-top:18px">Escanea y gana ${b.design.icon || "🎁"}</p>
          <p style="font-size:18px;margin-top:10px;opacity:.92">Junta ${b.stampsGoal} sellos y llévate <b>${b.reward}</b></p>
          <div class="poster__qr">${raw(qrSvg(joinUrl()))}</div>
          <p style="font-size:15px;opacity:.9">1. Abre la cámara · 2. Escanea · 3. Escribe tu nombre y número</p>
          <p style="font-size:13px;margin-top:14px;opacity:.75">Sin descargar apps · Tu tarjeta queda en tu celular</p>
        </div></div>`,
      actions: [
        { label: "Cerrar", cls: "btn--outline" },
        { label: "Imprimir o guardar PDF", cls: "btn--primary", icon: "printer", close: false, onClick: () => window.print() },
      ],
    });
  }

  /* ---------- arranque ---------- */
  shell();
  app.onclick = (e) => {
    const x = e.target.closest("[data-x]");
    if (!x) return;
    if (x.dataset.x === "reload") return busy(x, () => reload(true));
    if (x.dataset.x === "logout") {
      ls.del("biz_" + slug);
      go("/acceso");
    }
  };
  const onHash = () => setTab(location.hash.slice(1));
  window.addEventListener("hashchange", onHash);
  setTab(location.hash.slice(1));
  return () => {
    destroyed = true;
    clearInterval(timer);
    while (cleanups.length) cleanups.pop()();
    window.removeEventListener("hashchange", onHash);
    app.onclick = null;
  };
}
