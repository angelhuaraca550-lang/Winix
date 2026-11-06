// Fideliza — panel del dueño de la plataforma (cobros, suspensión, negocios)
import {
  html, raw, ic, mount, $, $$, api, ls, go, toast, toastErr, modal, busy, fmtDate, money, plural, initials, firstName,
  slugify, qrSvg, setHead, waLink, copyText, todayYmd, contrastOn, errorPage, loading,
} from "./core.js";
import { COLORS } from "./cardview.js";

const STATUS = {
  activo: ["Activo", "badge--ok"],
  por_vencer: ["Vence pronto", "badge--info"],
  gracia: ["Vencido · en gracia", "badge--warn"],
  vencido: ["Vencido", "badge--warn"],
  suspendido: ["Suspendido", "badge--danger"],
};
function statusBadge(st) {
  if (st.code === "vencido" && st.blocked) return html`<span class="badge badge--danger"><span class="dot"></span>Pausado por falta de pago</span>`;
  const [l, c] = STATUS[st.code] || [st.code, ""];
  return html`<span class="badge ${c}"><span class="dot"></span>${l}</span>`;
}
const relDue = (st) =>
  st.daysLeft >= 0 ? (st.daysLeft === 0 ? "vence hoy" : st.daysLeft === 1 ? "vence mañana" : `vence en ${st.daysLeft} días`) : `venció hace ${plural(-st.daysLeft, "día", "días")}`;
function addMonths(d, n) {
  const [y, m, day] = d.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);

function authCard(app, { title, sub, fields, button, foot, onSubmit, iconName = "crown" }) {
  mount(
    app,
    html`<div class="auth"><form class="card auth__card fade-in" novalidate>
      <div class="icon-bubble icon-bubble--dark" style="margin:0 auto 14px">${ic(iconName, "", 26)}</div>
      <h1 class="auth__title" style="font-size:20px">${title}</h1>
      ${sub ? html`<p class="muted small center mt-2">${sub}</p>` : ""}
      <div class="stack mt-6" style="--gap:14px">${fields}<button class="btn btn--block" type="submit">${button}</button>${foot}</div>
    </form></div>`
  );
  const f = $("form", app);
  f.querySelector("input")?.focus();
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    await busy(f.querySelector("[type=submit]"), () => onSubmit(f).catch(toastErr));
  });
}

export async function owner(app) {
  let stop = null;
  await ownerFlow(app, async (k) => {
    stop?.();
    stop = await dashboard(app, k);
  });
  return () => stop?.();
}

async function ownerFlow(app, enter) {
  setHead({ title: "Panel de dueño · Fideliza" });
  loading(app);
  const saved = ls.get("owner");
  if (saved) {
    try {
      await api("/owner/login", { method: "POST", owner: saved });
      return enter(saved);
    } catch (e) {
      if (e.status !== 401) return errorPage(app, { text: e.message });
      ls.del("owner");
    }
  }
  let st;
  try {
    st = await api("/owner/status");
  } catch (e) {
    return errorPage(app, { text: e.message });
  }
  const back = html`<a class="btn btn--ghost btn--block" href="/" data-go>Volver al inicio</a>`;
  if (!st.setup) {
    return authCard(app, {
      title: "Crea tu clave de dueño",
      sub: "Es la primera vez que entras. Esta clave te da control de todos los negocios: guárdala bien.",
      fields: html`
        <div class="field"><label class="label">Clave de dueño</label><input class="input" name="k1" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres"></div>
        <div class="field"><label class="label">Repite la clave</label><input class="input" name="k2" type="password" autocomplete="new-password"></div>
        <div class="field"><label class="label">Tu WhatsApp</label><input class="input" name="wa" type="tel" placeholder="0991234567"><p class="hint">Los negocios lo verán para pagarte o pedir soporte.</p></div>`,
      button: "Crear y entrar",
      foot: back,
      onSubmit: async (f) => {
        if (f.k1.value.length < 8) throw new Error("La clave debe tener al menos 8 caracteres");
        if (f.k1.value !== f.k2.value) throw new Error("Las claves no coinciden");
        await api("/owner/setup", { method: "POST", body: { key: f.k1.value, whatsapp: f.wa.value } });
        ls.set("owner", f.k1.value);
        toast("¡Listo! Ya eres el dueño de la plataforma");
        enter(f.k1.value);
      },
    });
  }
  authCard(app, {
    title: "Panel de dueño",
    fields: html`<div class="field"><label class="label">Clave de dueño</label><input class="input" name="k" type="password" autocomplete="current-password"></div>`,
    button: "Entrar",
    foot: back,
    onSubmit: async (f) => {
      await api("/owner/login", { method: "POST", owner: f.k.value });
      ls.set("owner", f.k.value);
      enter(f.k.value);
    },
  });
}

async function dashboard(app, key) {
  let D;
  let tab = location.hash.slice(1) || "negocios";
  let filter = "todos";
  let q = "";
  const call = (path, opts = {}) => api(path, { ...opts, owner: key });
  const origin = location.origin;
  const cur = () => D.settings.currency || "$";
  async function load() {
    D = await call("/owner/overview");
  }
  loading(app);
  try {
    await load();
  } catch (e) {
    if (e.status === 401) {
      ls.del("owner");
      return go("/dueno", true);
    }
    return errorPage(app, { text: e.message });
  }

  const B = () => D.businesses;
  const findB = (slug) => B().find((b) => b.slug === slug);
  const isOverdue = (b) => b.status.daysLeft < 0 || b.status.code === "suspendido";
  const due = (b) => b.status.daysLeft <= 5;

  function chargeMsg(b) {
    const name = b.billing.ownerName ? " " + firstName(b.billing.ownerName) : "";
    const st = b.status;
    const until = fmtDate(b.billing.paidUntil, { day: "numeric", month: "long" });
    const fee = money(b.billing.fee, cur());
    if (st.code === "suspendido" || st.blocked)
      return `Hola${name} 👋 La tarjeta de clientes de *${b.name}* está en pausa porque la mensualidad (${fee}) venció el ${until}. Apenas confirmes el pago la reactivo al instante y tus clientes conservan todos sus sellos. 🙌`;
    if (st.daysLeft < 0)
      return `Hola${name} 👋 La mensualidad de *${b.name}* (${fee}) venció el ${until}. Para que tus clientes no pierdan su tarjeta, ¿me confirmas el pago hoy? 🙏`;
    return `Hola${name} 👋 Te recuerdo que la mensualidad de *${b.name}* (${fee}) vence el ${until}. ¿Me confirmas el pago para que tu tarjeta de clientes siga activa? 🙌`;
  }
  function accessMsg(b, keys) {
    const name = b.billing?.ownerName ? " " + firstName(b.billing.ownerName) : "";
    return `Hola${name} 👋 Ya está lista la tarjeta de fidelidad de *${b.name}*.\n\n📲 Tu panel: ${origin}/acceso\n• Negocio: ${b.slug}\n• Clave de administrador: ${keys.admin}\n• Clave de empleado (caja): ${keys.staff}\n\n🧾 Enlace del QR para tus clientes: ${origin}/unirse/${b.slug}\n\nCualquier duda me escribes.`;
  }
  const bizLogo = (b, size = 40) =>
    html`<span class="biz-row__logo" style="width:${size}px;height:${size}px;background:${b.design.color};color:${contrastOn(b.design.color)}">${b.design.logoSmall ? html`<img src="${b.design.logoSmall}" alt="">` : initials(b.name)}</span>`;

  function shell() {
    mount(
      app,
      html`<div class="panel">
        <header class="panel__hd"><div class="container">
          <div class="panel__top">
            <div class="panel__who"><span class="icon-bubble icon-bubble--dark icon-bubble--sm">${ic("crown", "", 17)}</span><div><div class="panel__name">Panel de dueño</div><div class="xs muted">${D.settings.brand} · ${B().length} ${B().length === 1 ? "negocio" : "negocios"}</div></div></div>
            <div class="cluster" style="--gap:4px;flex-wrap:nowrap">
              <a class="btn btn--ghost btn--sm" href="/negocio/demo?dueno=1" data-go title="Panel de la demo para mostrar a prospectos">${ic("sparkles", "", 15)}<span class="hide-sm">Panel demo</span></a>
              <button class="btn btn--ghost btn--sm btn--icon" data-o="reload" aria-label="Actualizar">${ic("refresh-cw", "", 16)}</button>
              <button class="btn btn--outline btn--sm" data-o="logout">${ic("log-out", "", 15)}<span class="hide-sm">Salir</span></button>
            </div>
          </div>
          <nav class="tabs">${[["negocios", "Negocios", "store"], ["cobros", "Cobros", "banknote"], ["nuevo", "Nuevo negocio", "plus"], ["ajustes", "Ajustes", "settings"]].map(
            ([id, l, i]) => html`<a class="tab" href="#${id}" data-tab="${id}">${ic(i, "", 16)} ${l}${id === "cobros" && B().filter(due).length ? html` <span class="badge badge--warn">${B().filter(due).length}</span>` : ""}</a>`
          )}</nav>
        </div></header>
        <div class="container panel__bd" data-body></div>
      </div>`
    );
    setTab(tab);
  }
  function setTab(id) {
    tab = ["negocios", "cobros", "nuevo", "ajustes"].includes(id) ? id : "negocios";
    $$("[data-tab]", app).forEach((t) => t.classList.toggle("is-on", t.dataset.tab === tab));
    const body = $("[data-body]", app);
    ({ negocios: tabNegocios, cobros: tabCobros, nuevo: tabNuevo, ajustes: tabAjustes })[tab](body);
  }
  async function reload(manual) {
    try {
      await load();
      shell();
      if (manual) toast("Actualizado");
    } catch (e) {
      toastErr(e);
    }
  }

  /* ---------- NEGOCIOS ---------- */
  function bizRow(b) {
    const st = b.status;
    return html`<div class="biz-row" data-slug="${b.slug}">
      <div class="biz-row__name">${bizLogo(b)}<div style="min-width:0"><div class="list__t ellipsis">${b.name}</div><div class="list__s ellipsis">/${b.slug}${b.billing.ownerName ? ` · ${b.billing.ownerName}` : ""}</div></div></div>
      <div><div class="cluster" style="--gap:6px">${statusBadge(st)}</div><div class="list__s mt-1">Pagado hasta ${fmtDate(b.billing.paidUntil)} · ${relDue(st)}</div></div>
      <div class="list__s"><b class="money" style="color:var(--fg)">${money(b.billing.fee, cur())}</b>/mes<br>${plural(b.customers, "cliente", "clientes")} · ${b.stamps30} sellos (30 d)</div>
      <div class="cluster" style="--gap:6px">
        <button class="btn btn--sm" data-o="pay">${ic("banknote", "", 15)} Registrar pago</button>
        ${b.billing.ownerPhone ? html`<a class="btn btn--outline btn--sm btn--icon" target="_blank" rel="noopener" href="${waLink(b.billing.ownerPhone, chargeMsg(b))}" title="Cobrar por WhatsApp">${ic("message-circle", "", 15)}</a>` : ""}
        <a class="btn btn--outline btn--sm btn--icon" href="/negocio/${b.slug}?dueno=1" data-go title="Abrir panel">${ic("external-link", "", 15)}</a>
        <button class="btn btn--ghost btn--sm btn--icon" data-o="edit" title="Editar">${ic("pencil", "", 15)}</button>
      </div>
    </div>`;
  }
  function tabNegocios(body) {
    const list = B();
    const active = list.filter((b) => !b.status.blocked);
    const income = active.reduce((a, b) => a + (b.billing.suspended ? 0 : b.billing.fee || 0), 0);
    const toCollect = list.filter(due).reduce((a, b) => a + (b.billing.fee || 0), 0);
    const clients = list.reduce((a, b) => a + b.customers, 0);
    const F = {
      todos: () => true,
      activos: (b) => ["activo", "por_vencer"].includes(b.status.code),
      porvencer: (b) => b.status.code === "por_vencer",
      vencidos: (b) => ["gracia", "vencido"].includes(b.status.code),
      suspendidos: (b) => b.status.blocked,
    };
    const counts = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, list.filter(f).length]));
    const rows = list.filter(F[filter]).filter((b) => !q || (b.name + " " + b.slug + " " + (b.billing.ownerName || "")).toLowerCase().includes(q.toLowerCase()));
    mount(
      body,
      html`<div class="stack fade-in" style="--gap:16px">
        <div class="grid g4" style="--gap:12px">
          <div class="card kpi"><div class="kpi__l">${ic("store", "", 15)} Negocios activos</div><div class="kpi__v">${active.length}<span class="muted" style="font-size:18px;font-weight:600"> / ${list.length}</span></div><div class="kpi__s">${list.length - active.length} pausados</div></div>
          <div class="card kpi"><div class="kpi__l">${ic("banknote", "", 15)} Ingreso mensual</div><div class="kpi__v money">${money(income, cur())}</div><div class="kpi__s">de negocios activos</div></div>
          <div class="card kpi"><div class="kpi__l">${ic("hand-coins", "", 15)} Por cobrar</div><div class="kpi__v money">${money(toCollect, cur())}</div><div class="kpi__s">${list.filter(due).length === 1 ? "1 negocio vence pronto o ya venció" : `${list.filter(due).length} negocios vencen pronto o ya vencieron`}</div></div>
          <div class="card kpi"><div class="kpi__l">${ic("users", "", 15)} Clientes en total</div><div class="kpi__v">${clients}</div><div class="kpi__s">en todos tus negocios</div></div>
        </div>
        <div class="card">
          <div class="card__bd stack" style="--gap:12px;padding-bottom:6px">
            <div class="between" style="flex-wrap:wrap"><p class="h3">Tus negocios</p><a class="btn btn--sm" href="#nuevo">${ic("plus", "", 15)} Nuevo negocio</a></div>
            <input class="input" data-q placeholder="Buscar negocio o dueño" value="${q}">
            <div class="chips">${[["todos", "Todos"], ["activos", "Activos"], ["porvencer", "Vencen pronto"], ["vencidos", "Vencidos"], ["suspendidos", "Pausados"]].map(
              ([k, l]) => html`<button class="chip${filter === k ? " is-on" : ""}" data-f="${k}">${l} <span class="n">${counts[k]}</span></button>`
            )}</div>
          </div>
          <div>${rows.map(bizRow)}${!rows.length ? html`<div class="empty">${list.length ? "Ningún negocio coincide." : html`Aún no tienes negocios. <a class="link" href="#nuevo">Crea el primero</a>.`}</div>` : ""}</div>
        </div>
        <p class="hint center">Los negocios se pausan solos ${D.settings.autoSuspend ? `${plural(D.settings.graceDays, "día", "días")} después de vencer` : "solo si tú los suspendes (pausa automática apagada)"}. Al registrar el pago se reactivan al instante y sus clientes conservan los sellos.</p>
      </div>`
    );
    const input = $("[data-q]", body);
    input.addEventListener("input", () => {
      q = input.value;
      const pos = input.selectionStart;
      tabNegocios(body);
      const n = $("[data-q]", body);
      n.focus();
      n.setSelectionRange(pos, pos);
    });
  }

  /* ---------- COBROS ---------- */
  function tabCobros(body) {
    const list = [...B()].sort((a, b) => a.status.daysLeft - b.status.daysLeft);
    const pending = list.filter(due);
    const payments = B()
      .flatMap((b) => (b.billing.payments || []).map((p) => ({ ...p, biz: b })))
      .sort((a, b) => b.at - a.at);
    const ym = (t) => new Date(t - 5 * 3600e3).toISOString().slice(0, 7);
    const thisM = todayYmd().slice(0, 7);
    const lastMd = new Date(thisM + "-15T12:00:00");
    lastMd.setMonth(lastMd.getMonth() - 1);
    const lastM = lastMd.toISOString().slice(0, 7);
    const sumM = (m) => payments.filter((p) => ym(p.at) === m).reduce((a, p) => a + (p.amount || 0), 0);
    mount(
      body,
      html`<div class="stack fade-in" style="--gap:16px">
        <div class="grid g4" style="--gap:12px">
          <div class="card kpi"><div class="kpi__l">Cobrado este mes</div><div class="kpi__v money">${money(sumM(thisM), cur())}</div></div>
          <div class="card kpi"><div class="kpi__l">Mes pasado</div><div class="kpi__v money">${money(sumM(lastM), cur())}</div></div>
          <div class="card kpi"><div class="kpi__l">Por cobrar</div><div class="kpi__v money">${money(pending.reduce((a, b) => a + (b.billing.fee || 0), 0), cur())}</div></div>
          <div class="card kpi"><div class="kpi__l">Pausados</div><div class="kpi__v">${B().filter((b) => b.status.blocked).length}</div></div>
        </div>
        <div class="card">
          <div class="card__bd" style="padding-bottom:6px"><p class="h3">Por cobrar</p><p class="muted small mt-1">Vencen en los próximos 5 días o ya vencieron. Toca WhatsApp para enviarles el recordatorio ya escrito.</p></div>
          ${pending.length ? pending.map(bizRow) : html`<div class="empty">${ic("circle-check", "", 28)}Todo al día. No hay cobros pendientes.</div>`}
        </div>
        <div class="card card__bd">
          <p class="h3">Pagos registrados</p>
          <div class="list mt-2">${payments.slice(0, 60).map(
            (p) => html`<div class="list__row"><span class="icon-bubble icon-bubble--sm icon-bubble--soft">${ic("banknote", "", 16)}</span>
              <div class="list__main"><div class="list__t">${p.biz.name}</div><div class="list__s">${fmtDate(p.at)} · ${plural(p.months, "mes", "meses")} · hasta ${fmtDate(p.until)}${p.note ? ` · ${p.note}` : ""}</div></div>
              <b class="money">${money(p.amount, cur())}</b></div>`
          )}${!payments.length ? html`<div class="empty">Aún no registras pagos.</div>` : ""}</div>
        </div>
      </div>`
    );
  }

  /* ---------- NUEVO NEGOCIO ---------- */
  function tabNuevo(body) {
    let start = "paid";
    let color = "#991b1b";
    mount(
      body,
      html`<form class="card card__bd stack fade-in" style="--gap:16px;max-width:760px" novalidate>
        <div><p class="h3">Nuevo negocio</p><p class="muted small mt-1">Se crean sus claves y su QR al instante. Luego le envías los accesos por WhatsApp.</p></div>
        <div class="form-row">
          <div class="field"><label class="label">Nombre del negocio</label><input class="input" name="name" placeholder="Ej: Panadería Jerusalén" maxlength="60"></div>
          <div class="field"><label class="label">Enlace</label><input class="input" name="slug" placeholder="panaderia-jerusalen" maxlength="40"><p class="hint" data-slug-prev>${origin}/unirse/…</p></div>
        </div>
        <div class="form-row">
          <div class="field"><label class="label">Mensualidad (${cur()})</label><input class="input" name="fee" type="number" min="0" step="0.5" value="${D.settings.defaultFee}"></div>
          <div class="field"><label class="label">País</label><select class="input" name="cc"><option value="593">Ecuador</option><option value="1">EE. UU.</option><option value="57">Colombia</option><option value="51">Perú</option><option value="52">México</option></select></div>
        </div>
        <div class="field"><span class="label">Inicio del plan</span>
          <div class="seg" data-start>${[["paid", "Ya pagó el primer mes"], ["trial", "Prueba gratis"], ["date", "Pagado hasta una fecha"]].map(([v, l]) => html`<button type="button" class="${start === v ? "is-on" : ""}" data-v="${v}">${l}</button>`)}</div>
          <div data-start-extra></div>
        </div>
        <div class="form-row">
          <div class="field"><label class="label">Dueño del negocio</label><input class="input" name="ownerName" placeholder="Ej: José Andrade" maxlength="60"></div>
          <div class="field"><label class="label">WhatsApp del dueño</label><input class="input" name="ownerPhone" type="tel" placeholder="0987654321" maxlength="20"><p class="hint">Para enviarle accesos y recordatorios de pago.</p></div>
        </div>
        <div class="form-row">
          <div class="field"><label class="label">Premio</label><input class="input" name="reward" placeholder="Ej: Un café gratis" maxlength="60"></div>
          <div class="field"><label class="label">Sellos necesarios</label><input class="input" name="stampsGoal" type="number" min="3" max="20" value="8"></div>
        </div>
        <div class="field"><span class="label">Color de la marca</span><div class="cluster" data-colors>${COLORS.map((c) => html`<button type="button" data-c="${c}" style="width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;border:${c === color ? "3px solid #fff;box-shadow:0 0 0 2px #09090b" : "1px solid rgba(0,0,0,.1)"}"></button>`)}</div><p class="hint">El negocio puede cambiar todo el diseño después desde su panel.</p></div>
        <button class="btn btn--lg btn--accent" type="submit">${ic("plus", "", 18)} Crear negocio</button>
      </form>`
    );
    const f = $("form", body);
    const extra = () => {
      mount(
        $("[data-start-extra]", body),
        start === "trial"
          ? html`<div class="cluster mt-2"><input class="input" name="trialDays" type="number" min="1" max="60" value="7" style="width:90px"><span class="small muted">días gratis</span></div>`
          : start === "date"
            ? html`<input class="input mt-2" name="paidUntil" type="date" style="max-width:220px" value="${addMonths(todayYmd(), 1)}">`
            : html`<p class="hint mt-2">Activo hasta ${fmtDate(addMonths(todayYmd(), 1))} y se registra el primer pago.</p>`
      );
    };
    extra();
    let slugTouched = false;
    const prev = () => ($("[data-slug-prev]", body).textContent = `${origin}/unirse/${slugify(f.slug.value || f.name.value) || "…"}`);
    f.name.addEventListener("input", () => {
      if (!slugTouched) f.slug.value = slugify(f.name.value);
      prev();
    });
    f.slug.addEventListener("input", () => {
      slugTouched = true;
      prev();
    });
    $("[data-start]", body).addEventListener("click", (e) => {
      const v = e.target.closest("[data-v]")?.dataset.v;
      if (!v) return;
      start = v;
      $$("[data-start] button", body).forEach((b) => b.classList.toggle("is-on", b.dataset.v === v));
      extra();
    });
    $("[data-colors]", body).addEventListener("click", (e) => {
      const c = e.target.closest("[data-c]")?.dataset.c;
      if (!c) return;
      color = c;
      $$("[data-colors] button", body).forEach((b) => (b.style.border = b.dataset.c === c ? "3px solid #fff" : "1px solid rgba(0,0,0,.1)") || (b.style.boxShadow = b.dataset.c === c ? "0 0 0 2px #09090b" : "none"));
      $$("[data-colors] button", body).forEach((b) => (b.style.boxShadow = b.dataset.c === c ? "0 0 0 2px #09090b" : "none"));
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (f.name.value.trim().length < 2) return toastErr("Escribe el nombre del negocio");
      await busy(f.querySelector("[type=submit]"), async () => {
        try {
          const r = await call("/owner/business", {
            method: "POST",
            body: {
              name: f.name.value,
              slug: f.slug.value,
              fee: f.fee.value,
              cc: f.cc.value,
              start,
              trialDays: f.trialDays?.value,
              paidUntil: f.paidUntil?.value,
              ownerName: f.ownerName.value,
              ownerPhone: f.ownerPhone.value,
              reward: f.reward.value,
              stampsGoal: f.stampsGoal.value,
              color,
            },
          });
          await load();
          keysModal(r.business, r.keys, true);
          location.hash = "negocios";
        } catch (err) {
          toastErr(err);
        }
      });
    });
  }

  function keysModal(b, keys, isNew) {
    const text = accessMsg(b, keys);
    modal({
      title: isNew ? "¡Negocio creado!" : "Claves nuevas",
      wide: true,
      body: html`<div class="stack" style="--gap:14px">
        <p class="muted small">Negocio creado. Guarda estas claves: la de administrador no se vuelve a mostrar.</p>
        <div class="grid g2" style="--gap:10px">
          <div class="field"><span class="label">Negocio (enlace)</span><div class="keybox"><span>${b.slug}</span></div></div>
          <div class="field"><span class="label">Clave de administrador</span><div class="keybox"><span>${keys.admin}</span></div></div>
          <div class="field"><span class="label">Clave de empleado</span><div class="keybox"><span>${keys.staff}</span></div></div>
          <div class="field"><span class="label">QR para sus clientes</span><div style="width:120px;height:120px;padding:6px;border:1px solid var(--line);border-radius:12px">${raw(qrSvg(`${origin}/unirse/${b.slug}`))}</div></div>
        </div>
        <div class="cluster">
          ${b.billing?.ownerPhone ? html`<a class="btn btn--wa" target="_blank" rel="noopener" href="${waLink(b.billing.ownerPhone, text)}">${ic("message-circle", "", 16)} Enviar accesos por WhatsApp</a>` : ""}
          <button class="btn btn--outline" data-copy>${ic("copy", "", 16)} Copiar mensaje</button>
          <a class="btn btn--outline" href="/negocio/${b.slug}?dueno=1#tarjeta" data-go>${ic("palette", "", 16)} Diseñar su tarjeta</a>
        </div>
      </div>`,
      actions: [{ label: "Listo", cls: "btn--primary" }],
      onOpen: (m) => $("[data-copy]", m).addEventListener("click", () => copyText(text)),
      onClose: () => shell(),
    });
  }

  /* ---------- PAGO ---------- */
  function payModal(b) {
    let months = 1;
    const today = todayYmd();
    const calcUntil = () => {
      let base = b.billing.paidUntil || today;
      if (daysBetween(base, today) > 30) base = today;
      return addMonths(base, months);
    };
    const m = modal({
      title: `Registrar pago · ${b.name}`,
      body: html`<div class="stack" style="--gap:14px">
        <div class="field"><span class="label">Meses pagados</span><div class="seg" data-m>${[1, 2, 3, 6, 12].map((n) => html`<button type="button" class="${n === 1 ? "is-on" : ""}" data-v="${n}">${n === 12 ? "1 año" : plural(n, "mes", "meses")}</button>`)}</div></div>
        <div class="field"><label class="label">Monto recibido (${cur()})</label><input class="input" name="amount" type="number" min="0" step="0.5" value="${b.billing.fee}"></div>
        <div class="field"><label class="label">Nota <span class="muted" style="font-weight:400">(opcional)</span></label><input class="input" name="note" placeholder="Ej: Transferencia Pichincha" maxlength="80"></div>
        <div class="alert alert--ok">${ic("calendar", "", 18)}<div>Quedará activo hasta el <b data-until>${fmtDate(calcUntil())}</b>${b.status.blocked ? " y se reactiva al instante" : ""}.</div></div>
      </div>`,
      actions: [
        { label: "Cancelar", cls: "btn--outline" },
        {
          label: "Registrar pago",
          cls: "btn--ok",
          onClick: async ({ el }) => {
            await call(`/owner/business/${b.slug}/payment`, { method: "POST", body: { months, amount: $("[name=amount]", el).value, note: $("[name=note]", el).value } });
            await load();
            shell();
            toast(`Pago registrado. ${b.name} activo hasta ${fmtDate(calcUntil())}`);
          },
        },
      ],
    });
    $("[data-m]", m.el).addEventListener("click", (e) => {
      const v = e.target.closest("[data-v]")?.dataset.v;
      if (!v) return;
      months = +v;
      $$("[data-m] button", m.el).forEach((x) => x.classList.toggle("is-on", x.dataset.v === v));
      $("[name=amount]", m.el).value = (b.billing.fee || 0) * months;
      $("[data-until]", m.el).textContent = fmtDate(calcUntil());
    });
  }

  /* ---------- EDITAR ---------- */
  function editModal(b) {
    modal({
      title: b.name,
      wide: true,
      body: html`<div class="stack" style="--gap:14px">
        <div class="cluster">${statusBadge(b.status)}<span class="small muted">Pagado hasta ${fmtDate(b.billing.paidUntil)} · ${relDue(b.status)}</span></div>
        <div class="form-row">
          <div class="field"><label class="label">Nombre</label><input class="input" name="name" value="${b.name}"></div>
          <div class="field"><label class="label">Mensualidad (${cur()})</label><input class="input" name="fee" type="number" min="0" step="0.5" value="${b.billing.fee}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label class="label">Pagado hasta</label><input class="input" name="paidUntil" type="date" value="${b.billing.paidUntil}"></div>
          <div class="field"><label class="label">Dueño</label><input class="input" name="ownerName" value="${b.billing.ownerName || ""}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label class="label">WhatsApp del dueño</label><input class="input" name="ownerPhone" type="tel" value="${b.billing.ownerPhone || ""}"></div>
          <div class="field"><label class="label">Notas</label><input class="input" name="notes" value="${b.billing.notes || ""}"></div>
        </div>
        <label class="switch"><input type="checkbox" name="suspended" ${b.billing.suspended ? "checked" : ""}><span class="track"></span><span><b>Suspender ahora</b> <span class="muted">(sus clientes ven la tarjeta en pausa; los datos se guardan)</span></span></label>
        ${b.billing.payments?.length
          ? html`<div><p class="h4">Últimos pagos</p><div class="list mt-1">${b.billing.payments.slice(0, 6).map((p) => html`<div class="list__row"><div class="list__main"><div class="list__s">${fmtDate(p.at)} · ${plural(p.months, "mes", "meses")}${p.note ? ` · ${p.note}` : ""}</div></div><b class="money small">${money(p.amount, cur())}</b></div>`)}</div></div>`
          : ""}
        <hr class="divider">
        <div class="cluster">
          <button class="btn btn--outline btn--sm" data-e="keys">${ic("key-round", "", 15)} Generar claves nuevas</button>
          <a class="btn btn--outline btn--sm" href="/negocio/${b.slug}?dueno=1" data-go>${ic("external-link", "", 15)} Abrir su panel</a>
          <button class="btn btn--danger btn--sm" data-e="del">${ic("trash-2", "", 15)} Eliminar negocio</button>
        </div>
      </div>`,
      actions: [
        { label: "Cancelar", cls: "btn--outline" },
        {
          label: "Guardar",
          cls: "btn--primary",
          onClick: async ({ el }) => {
            const v = (n) => $(`[name=${n}]`, el);
            await call(`/owner/business/${b.slug}`, {
              method: "PUT",
              body: { name: v("name").value, fee: v("fee").value, paidUntil: v("paidUntil").value, ownerName: v("ownerName").value, ownerPhone: v("ownerPhone").value, notes: v("notes").value, suspended: v("suspended").checked },
            });
            await load();
            shell();
            toast("Cambios guardados");
          },
        },
      ],
      onOpen: (el, close) =>
        el.addEventListener("click", async (e) => {
          const t = e.target.closest("[data-e]");
          if (!t) return;
          if (t.dataset.e === "keys")
            return busy(t, async () => {
              try {
                const r = await call(`/owner/business/${b.slug}/reset-keys`, { method: "POST" });
                close();
                keysModal(b, r.keys, false);
              } catch (err) {
                toastErr(err);
              }
            });
          if (t.dataset.e === "del") {
            close();
            delModal(b);
          }
        }),
    });
  }
  function delModal(b) {
    modal({
      title: "Eliminar negocio",
      body: html`<div class="stack" style="--gap:12px"><div class="alert alert--danger">${ic("triangle-alert", "", 18)}<div>Se borrarán <b>${b.name}</b>, sus ${plural(b.customers, "cliente", "clientes")}, sellos y promociones. No se puede deshacer.</div></div>
        <div class="field"><label class="label">Escribe <b>${b.slug}</b> para confirmar</label><input class="input" name="confirm" autocomplete="off"></div></div>`,
      actions: [
        { label: "Cancelar", cls: "btn--outline" },
        {
          label: "Eliminar para siempre",
          cls: "btn--accent",
          onClick: async ({ el }) => {
            await call(`/owner/business/${b.slug}`, { method: "DELETE", body: { confirm: $("[name=confirm]", el).value.trim() } });
            await load();
            shell();
            toast("Negocio eliminado");
          },
        },
      ],
    });
  }

  /* ---------- AJUSTES ---------- */
  function tabAjustes(body) {
    const s = D.settings;
    mount(
      body,
      html`<div class="grid g2 fade-in" style="align-items:start">
        <form class="card card__bd stack" style="--gap:14px" data-f="cfg">
          <p class="h3">Cobros y suspensión</p>
          <div class="field"><label class="label">Tu WhatsApp</label><input class="input" name="whatsapp" type="tel" value="${s.whatsapp}" placeholder="0991234567"><p class="hint">Aparece en el panel de cada negocio para renovar o pedir soporte, y en la página de inicio.</p></div>
          <div class="form-row">
            <div class="field"><label class="label">Moneda</label><input class="input" name="currency" value="${s.currency}" maxlength="4"></div>
            <div class="field"><label class="label">Mensualidad por defecto</label><input class="input" name="defaultFee" type="number" min="0" step="0.5" value="${s.defaultFee}"></div>
          </div>
          <div class="field"><label class="label">Días de gracia después de vencer</label><input class="input" name="graceDays" type="number" min="0" max="30" value="${s.graceDays}"><p class="hint">Durante esos días el negocio sigue funcionando pero ve el aviso de pago.</p></div>
          <label class="switch"><input type="checkbox" name="autoSuspend" ${s.autoSuspend ? "checked" : ""}><span class="track"></span><span><b>Pausar automáticamente</b> a los negocios que no pagan</span></label>
          <button class="btn" type="submit">Guardar</button>
        </form>
        <div class="stack" style="--gap:16px">
          <form class="card card__bd stack" style="--gap:14px" data-f="key">
            <p class="h3">Cambiar clave de dueño</p>
            <div class="field"><label class="label">Nueva clave</label><input class="input" name="k1" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres"></div>
            <div class="field"><label class="label">Repite la clave</label><input class="input" name="k2" type="password" autocomplete="new-password"></div>
            <button class="btn btn--outline" type="submit">Cambiar clave</button>
          </form>
          <div class="card card__bd">
            <p class="h3">Cómo funciona la mensualidad</p>
            <ul class="small muted mt-2" style="padding-left:18px;margin-bottom:0;line-height:1.7">
              <li>Cada negocio tiene una fecha “pagado hasta”.</li>
              <li>5 días antes ve un aviso para renovar con tu WhatsApp.</li>
              <li>Si vence, tiene ${plural(s.graceDays, "día", "días")} de gracia; después ${s.autoSuspend ? "se pausa solo" : "sigue funcionando hasta que lo suspendas tú"}.</li>
              <li>Pausado: sus clientes ven “tarjeta en pausa” y no se suman sellos. No se borra nada.</li>
              <li>Al registrar el pago, se reactiva al instante.</li>
            </ul>
          </div>
        </div>
      </div>`
    );
    body.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      await busy(f.querySelector("[type=submit]"), async () => {
        try {
          if (f.dataset.f === "cfg") {
            const r = await call("/owner/settings", { method: "PUT", body: { whatsapp: f.whatsapp.value, currency: f.currency.value, defaultFee: f.defaultFee.value, graceDays: f.graceDays.value, autoSuspend: f.autoSuspend.checked } });
            D.settings = r.settings;
            await load();
            toast("Ajustes guardados");
          } else {
            if (f.k1.value.length < 8) throw new Error("Mínimo 8 caracteres");
            if (f.k1.value !== f.k2.value) throw new Error("Las claves no coinciden");
            await call("/owner/settings", { method: "PUT", body: { newKey: f.k1.value } });
            key = f.k1.value;
            ls.set("owner", key);
            f.reset();
            toast("Clave de dueño cambiada");
          }
        } catch (err) {
          toastErr(err);
        }
      });
    };
  }

  /* ---------- eventos ---------- */
  shell();
  app.onclick = (e) => {
    const f = e.target.closest("[data-f]");
    if (f && f.classList.contains("chip")) {
      filter = f.dataset.f;
      return tabNegocios($("[data-body]", app));
    }
    const t = e.target.closest("[data-o]");
    if (!t) return;
    const b = findB(t.closest("[data-slug]")?.dataset.slug);
    const o = t.dataset.o;
    if (o === "reload") return busy(t, () => reload(true));
    if (o === "logout") {
      ls.del("owner");
      return go("/");
    }
    if (o === "pay" && b) return payModal(b);
    if (o === "edit" && b) return editModal(b);
  };
  const onHash = () => setTab(location.hash.slice(1));
  window.addEventListener("hashchange", onHash);
  return () => {
    window.removeEventListener("hashchange", onHash);
    app.onclick = null;
  };
}
