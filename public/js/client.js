// Fideliza — lado del cliente: registrarse y su tarjeta
import {
  html, raw, ic, mount, $, $$, api, ls, go, toast, toastErr, modal, busy, ago, fmtDate, firstName, plural,
  qrSvg, setHead, brandVars, distanceM, fmtDist, fillTemplate, isIOS, isInApp, isStandalone, vibrate,
  confettiBurst, waLink, errorPage, loading, initials,
} from "./core.js";
import { cardHTML } from "./cardview.js";

const notFound = (el) =>
  errorPage(el, { title: "Tarjeta no encontrada", text: "Escanea de nuevo el código QR del local." });

function pausedPage(el, b) {
  setHead({ title: b.name });
  mount(
    el,
    html`<div class="auth"><div class="center fade-in" style="max-width:380px">
      <div class="icon-bubble icon-bubble--dark" style="margin:0 auto 14px">${ic("clock", "", 22)}</div>
      <p class="h3">${b.name}</p>
      <p class="muted mt-2">Esta tarjeta está en pausa por ahora. Tus sellos están guardados y vuelven apenas se reactive.</p>
    </div></div>`
  );
}

function logoHTML(b, size = 30) {
  const d = b.design || {};
  return d.logoSmall || d.logo
    ? html`<img src="${d.logoSmall || d.logo}" alt="" style="width:${size}px;height:${size}px;border-radius:${size / 3.5}px;object-fit:cover">`
    : html`<span class="ph" style="width:${size}px;height:${size}px;border-radius:${size / 3.5}px;background:${d.color};display:grid;place-items:center;color:#fff;font-weight:800;font-size:${size / 2.6}px">${initials(b.name)}</span>`;
}

/* ================================================================== */
/* /unirse/:slug                                                       */
/* ================================================================== */
export async function join(app, slug) {
  slug = slug.toLowerCase();
  const saved = ls.get("card_" + slug);
  if (saved && !new URLSearchParams(location.search).has("nuevo")) {
    go(`/tarjeta/${saved}`, true);
    return;
  }
  loading(app);
  let data;
  try {
    data = await api(`/b/${slug}`);
  } catch (e) {
    if (e.status === 404)
      return errorPage(app, { title: "Negocio no encontrado", text: "Revisa que el código QR sea el correcto." });
    return errorPage(app, { text: e.message });
  }
  if (data.paused) return pausedPage(app, data.business);
  const b = data.business;
  const d = b.design;
  setHead({ title: `${b.name} · Tarjeta de cliente`, theme: d.color });
  const bonus = b.bonusJoin ? 1 : 0;
  const us = b.cc === "1";
  mount(
    app,
    html`<div class="client" style="${brandVars(d.color)}">
      <div class="narrow fade-in" style="padding-top:28px">
        <div class="center">
          <div style="display:inline-block">${logoHTML(b, 64)}</div>
          <h1 class="h3 mt-3" style="font-size:22px">${b.name}</h1>
          ${d.welcome ? html`<p class="muted mt-1" style="font-size:15px">${d.welcome}</p>` : ""}
        </div>
        <div class="mt-6" data-preview>${cardHTML(b, { name: "", stamps: bonus })}</div>
        <form class="card card__bd mt-6 stack" style="--gap:14px" novalidate>
          <div class="field"><label class="label" for="j-name">Tu nombre</label>
            <input class="input" id="j-name" name="name" placeholder="Ej: María Pérez" autocomplete="name" maxlength="40" required></div>
          <div class="field"><label class="label" for="j-phone">Tu número de celular</label>
            <input class="input" id="j-phone" name="phone" type="tel" inputmode="tel" placeholder="${us ? "Ej: (305) 555-1234" : "Ej: 0991234567"}" autocomplete="tel" maxlength="20" required></div>
          <p class="hint">Tu número identifica tu tarjeta: aunque vuelvas a escanear el código, siempre verás la misma tarjeta con tus sellos.</p>
          <button class="btn btn--brand btn--lg btn--block" type="submit">Crear mi tarjeta</button>
          ${bonus ? html`<p class="center small strong">🎁 Te regalamos tu primer sello</p>` : ""}
        </form>
        ${d.terms ? html`<p class="center xs muted mt-4" style="white-space:pre-line">${d.terms}</p>` : ""}
        <p class="center xs muted mt-6">Tarjeta digital por Fideliza</p>
      </div>
    </div>`
  );
  const form = $("form", app);
  const prev = $("[data-preview]", app);
  form.name.addEventListener("input", () => (prev.innerHTML = cardHTML(b, { name: form.name.value.trim(), stamps: bonus }).s));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    const phone = form.phone.value.trim();
    if (name.length < 2) return toastErr("Escribe tu nombre");
    if (phone.replace(/\D/g, "").length < 7) return toastErr("Escribe tu número de celular");
    const btn = form.querySelector("button");
    await busy(btn, async () => {
      try {
        const r = await api(`/b/${slug}/join`, { method: "POST", body: { name, phone } });
        ls.set("card_" + slug, r.code);
        go(`/tarjeta/${r.code}${r.existing ? "?hola=1" : "?nuevo=1"}`, true);
      } catch (err) {
        toastErr(err);
      }
    });
  });
}

/* ================================================================== */
/* /tarjeta/:code                                                      */
/* ================================================================== */
function b64ToU8(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
const sameKey = (sub, u8) => {
  const k = sub?.options?.applicationServerKey;
  if (!k) return true;
  const a = new Uint8Array(k);
  return a.length === u8.length && a.every((v, i) => v === u8[i]);
};

export async function card(app, codeRaw) {
  const code = String(codeRaw).toUpperCase();
  const params = new URLSearchParams(location.search);
  const isNew = params.has("nuevo");
  const openedPromo = params.get("promo");
  if (params.toString()) history.replaceState({}, "", `/tarjeta/${code}`);
  loading(app);

  let data;
  try {
    data = await api(`/c/${code}`);
  } catch (e) {
    if (e.status === 404) return notFound(app);
    return errorPage(app, { text: e.message, action: html`<button class="btn btn--outline mt-6" onclick="location.reload()">Reintentar</button>` });
  }
  if (data.paused) return pausedPage(app, data.business);

  let { card: c, business: b, promos } = data;
  const d = b.design;
  ls.set("card_" + b.slug, code);
  setHead({ title: `${b.name} · Mi tarjeta`, theme: d.color, manifest: `/api/manifest/${code}`, appleIcon: d.logoSmall || undefined });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

  let lastStamps = ls.get("seen_" + code, null);
  let lastRewards = ls.get("rew_" + code, c.rewards);
  let geoWatch = null;
  let geoDist = null;
  let pollTimer = null;
  let destroyed = false;
  const started = Date.now();
  const dismissed = new Set(ls.get("dis_" + code, []));
  const seen = new Set(ls.get("pv_" + code, []));

  const goal = () => b.stampsGoal;
  const left = () => Math.max(0, goal() - c.stamps);
  const pushOn = () => ls.get("push_" + code) && typeof Notification !== "undefined" && Notification.permission === "granted";
  const geoOn = () => !!ls.get("geo_" + code);
  const mapsUrl = () => (b.location ? `https://www.google.com/maps/dir/?api=1&destination=${b.location.lat},${b.location.lng}` : null);

  function promoHTML(p) {
    return html`<div class="card promo${openedPromo === p.id ? " is-highlight" : ""}" data-promo="${p.id}">
      ${p.img ? html`<img class="promo__img" src="${p.img}" alt="">` : ""}
      <button class="promo__x" data-dismiss="${p.id}" aria-label="Ocultar">${ic("x", "", 16)}</button>
      <div class="promo__bd">
        <span class="promo__tag">${ic("megaphone", "", 13)} Promoción</span>
        <p class="h3 mt-1" style="font-size:17px">${p.title}</p>
        ${p.body ? html`<p class="muted mt-1" style="white-space:pre-line;font-size:14.5px">${p.body}</p>` : ""}
        <div class="between mt-3">
          <span class="xs muted">Válida hasta ${fmtDate(p.expires, { day: "numeric", month: "short" })}</span>
          ${p.link ? html`<a class="btn btn--brand btn--sm" href="${p.link}" target="_blank" rel="noopener" data-plink="${p.id}">${p.linkLabel || "Ver más"} ${ic("external-link", "", 14)}</a>` : ""}
        </div>
      </div>
    </div>`;
  }

  function actionsHTML() {
    const pushDone = pushOn();
    const installed = isStandalone();
    return html`<div class="card">
      <div class="action">
        <span class="icon-bubble">${ic("bell-ring", "", 18)}</span>
        <div><b>Recibe promociones en tu celular</b><small>Opcional. Las promociones siempre aparecen arriba en tu tarjeta.</small></div>
        ${pushDone ? html`<span class="done">${ic("check", "", 15)} Activadas</span>` : html`<button class="btn btn--brand btn--sm" data-act="push">Activar</button>`}
      </div>
      ${b.location
        ? html`<div class="action">
          <span class="icon-bubble">${ic("map-pin", "", 18)}</span>
          <div><b>Avísame cuando esté cerca</b><small>Si pasas a menos de ${b.location.radius} m del local con tu tarjeta abierta, te avisamos cuánto te falta.</small></div>
          ${geoOn() ? html`<span class="done">${ic("check", "", 15)} Activo</span>` : html`<button class="btn btn--brand btn--sm" data-act="geo">Activar</button>`}
        </div>`
        : ""}
      <div class="action">
        <span class="icon-bubble">${ic("smartphone", "", 18)}</span>
        <div><b>Guárdala en tu pantalla de inicio</b><small>Ábrela con un toque, como una app, con el logo de ${b.name}.</small></div>
        ${installed ? html`<span class="done">${ic("check", "", 15)} Guardada</span>` : html`<button class="btn btn--outline btn--sm" data-act="install">Guardar</button>`}
      </div>
    </div>`;
  }

  function nearChipHTML() {
    if (geoDist == null || !b.location) return "";
    const near = geoDist <= b.location.radius;
    return html`<div class="center"><span class="near-chip${near ? " is-near" : ""}">${ic(near ? "map-pin" : "navigation", "", 15)} ${near ? `¡Estás en ${b.name}!` : `Estás a ${fmtDist(geoDist)} de ${b.name}`}</span></div>`;
  }

  function statusHTML() {
    if (c.stamps >= goal())
      return html`<div class="status-line status-line--full">🎉 <span>¡Tarjeta completa! Muestra este código en caja para reclamar: <b>${b.reward}</b></span></div>`;
    return html`<div class="status-line">${ic("gift", "", 18)}<span>Te ${left() === 1 ? "falta" : "faltan"} <b>${plural(left(), "sello", "sellos")}</b> para: <b>${b.reward}</b></span></div>`;
  }

  function contactHTML() {
    const ct = b.contact || {};
    const btns = [];
    if (ct.whatsapp) btns.push(html`<a class="btn btn--outline btn--sm" target="_blank" rel="noopener" href="${waLink(ct.whatsapp, `Hola ${b.name} 👋`, b.cc)}">${ic("message-circle", "", 15)} WhatsApp</a>`);
    if (ct.instagram) btns.push(html`<a class="btn btn--outline btn--sm" target="_blank" rel="noopener" href="https://instagram.com/${ct.instagram}">${ic("at-sign", "", 15)} Instagram</a>`);
    if (mapsUrl()) btns.push(html`<a class="btn btn--outline btn--sm" target="_blank" rel="noopener" href="${mapsUrl()}">${ic("navigation", "", 15)} Cómo llegar</a>`);
    if (!btns.length && !ct.address) return "";
    return html`<div class="center">${ct.address ? html`<p class="small muted">${ic("map-pin", "", 14)} ${ct.address}</p>` : ""}<div class="cluster mt-2" style="justify-content:center">${btns}</div></div>`;
  }

  function histHTML() {
    const label = { stamp: "Sello", bonus: "Sello de bienvenida", redeem: "Premio canjeado 🎁", unstamp: "Sello corregido" };
    if (!c.hist?.length) return "";
    return html`<div class="card card__bd"><p class="h4">Tus últimas visitas</p>
      <ul class="hist mt-2">${c.hist.slice(0, 8).map((h) => html`<li><span>${label[h.k] || h.k}${h.n > 1 ? ` ×${h.n}` : ""}</span><span class="muted">${ago(h.t)}</span></li>`)}</ul>
    </div>`;
  }

  function render(newFrom) {
    const vis = promos.filter((p) => !dismissed.has(p.id));
    mount(
      app,
      html`<div class="client${b.demo ? " client--demo" : ""}" style="${brandVars(d.color)}">
        <div class="client__bar"><div class="narrow">
          <div class="client__biz">${logoHTML(b)}<span class="ellipsis">${b.name}</span></div>
          <button class="btn btn--ghost btn--sm btn--icon" data-act="refresh" aria-label="Actualizar">${ic("refresh-cw", "", 17)}</button>
        </div></div>
        <div class="narrow stack" style="--gap:14px;padding-top:6px">
          ${vis.map(promoHTML)}
          <div data-card>${cardHTML(b, c, { newFrom })}</div>
          ${statusHTML()}
          <div data-near>${nearChipHTML()}</div>
          <div class="card qrbox">
            <p class="small strong center">Muestra este código en caja para sumar sellos</p>
            <div class="qrbox__qr">${raw(qrSvg(`${location.origin}/tarjeta/${code}`))}</div>
            <div class="qrbox__code">${code}</div>
          </div>
          <div data-actions>${actionsHTML()}</div>
          ${contactHTML()}
          ${histHTML()}
          <p class="center xs muted mt-2">¿No eres ${firstName(c.name)}? <button class="link" data-act="other">Usar otro número</button></p>
          <p class="center xs muted">Tarjeta digital por Fideliza</p>
        </div>
        ${b.demo
          ? html`<div class="demo-bar"><div class="narrow">
            <div class="demo-bar__t">${ic("sparkles", "", 14)} Modo demo · así lo vivirá tu cliente</div>
            <div class="demo-bar__b">
              <button class="btn" data-demo="stamp">${ic("stamp", "", 15)} Sumar sello</button>
              <button class="btn" data-demo="promo">${ic("megaphone", "", 15)} Recibir promo</button>
              <button class="btn" data-demo="near">${ic("map-pin", "", 15)} Estar cerca</button>
            </div>
          </div></div>`
          : ""}
      </div>`
    );
    vis.forEach((p) => {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        api(`/c/${code}/event`, { method: "POST", body: { type: "view", promo: p.id } }).catch(() => {});
      }
    });
    ls.set("pv_" + code, [...seen].slice(-50));
  }

  async function refresh(manual) {
    try {
      const r = await api(`/c/${code}`);
      if (destroyed) return;
      if (r.paused) return pausedPage(app, r.business);
      const before = c.stamps;
      const rewardsBefore = c.rewards;
      c = r.card;
      b = r.business;
      const promoChanged = JSON.stringify(r.promos.map((p) => p.id)) !== JSON.stringify(promos.map((p) => p.id));
      promos = r.promos;
      if (c.rewards > rewardsBefore) {
        render();
        toast("🎁 ¡Premio canjeado! Tu tarjeta empieza de nuevo");
        confettiBurst();
      } else if (c.stamps > before) {
        render(before);
        vibrate();
        if (c.stamps >= goal()) {
          toast("🎉 ¡Completaste tu tarjeta!");
          confettiBurst();
        } else toast(`¡+${c.stamps - before} ${c.stamps - before === 1 ? "sello" : "sellos"}! Te ${left() === 1 ? "falta" : "faltan"} ${left()}`);
      } else if (c.stamps !== before || promoChanged || manual) render();
      ls.set("seen_" + code, c.stamps);
      ls.set("rew_" + code, c.rewards);
      if (manual) toast("Tarjeta actualizada");
    } catch (e) {
      if (manual) toastErr(e);
    }
  }

  function schedule() {
    clearTimeout(pollTimer);
    if (destroyed || document.hidden) return;
    const fast = Date.now() - started < 4 * 60e3;
    pollTimer = setTimeout(async () => {
      await refresh();
      schedule();
    }, fast ? 10_000 : 45_000);
  }

  /* ----- notificaciones ----- */
  async function enablePush(btn) {
    if (isInApp) return openInBrowserGuide();
    if (isIOS && !isStandalone()) return iosGuide(true);
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined")
      return toastErr("Este navegador no permite notificaciones. Prueba con Chrome o Safari.");
    await busy(btn, async () => {
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return toastErr("No diste permiso. Puedes activarlo en los ajustes del navegador.");
        const reg = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        const { publicKey } = await api("/vapid");
        const key = b64ToU8(publicKey);
        let sub = await reg.pushManager.getSubscription();
        if (sub && !sameKey(sub, key)) {
          await sub.unsubscribe();
          sub = null;
        }
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        await api(`/c/${code}/push`, { method: "POST", body: { subscription: sub.toJSON() } });
        ls.set("push_" + code, 1);
        ls.set("pushsync_" + code, Date.now());
        toast("¡Listo! Te llegarán las promociones de " + b.name);
        $("[data-actions]", app).innerHTML = actionsHTML().s;
      } catch (e) {
        console.error(e);
        toastErr(e.message?.includes("permission") ? "No diste permiso para notificaciones" : "No se pudieron activar las notificaciones. Intenta de nuevo.");
      }
    });
  }
  async function resyncPush() {
    try {
      if (!pushOn() || !("serviceWorker" in navigator)) return;
      if (Date.now() - ls.get("pushsync_" + code, 0) < 5 * 864e5) return;
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return ls.del("push_" + code);
      await api(`/c/${code}/push`, { method: "POST", body: { subscription: sub.toJSON() } });
      ls.set("pushsync_" + code, Date.now());
    } catch {}
  }

  /* ----- instalar ----- */
  function iosGuide(forPush) {
    modal({
      title: forPush ? "Activa las promociones en tu iPhone" : "Guarda tu tarjeta en tu iPhone",
      body: html`<ol class="stack" style="--gap:12px;padding-left:18px;margin:0">
        <li>Toca el botón <b>Compartir</b> ${ic("share", "", 15)} en la barra de Safari.</li>
        <li>Elige <b>“Agregar a inicio”</b> y confirma.</li>
        <li>Abre tu tarjeta desde el nuevo ícono${forPush ? html` y toca <b>“Activar”</b> en promociones` : ""}.</li>
      </ol>
      <p class="hint mt-4">En iPhone las notificaciones solo funcionan con la tarjeta guardada en inicio (iOS 16.4 o superior). Si abriste el enlace desde Instagram o WhatsApp, ábrelo primero en Safari.</p>`,
      actions: [{ label: "Entendido", cls: "btn--brand" }],
    });
  }
  function openInBrowserGuide() {
    modal({
      title: "Abre tu tarjeta en el navegador",
      body: html`<p class="muted">Estás dentro de otra app. Toca el menú <b>⋯</b> arriba y elige <b>“Abrir en el navegador”</b> (Safari o Chrome). Desde ahí podrás guardar la tarjeta y activar las promociones.</p>`,
      actions: [{ label: "Entendido", cls: "btn--brand" }],
    });
  }
  async function install() {
    if (isStandalone()) return toast("Ya la tienes guardada");
    if (window.__bip) {
      const ev = window.__bip;
      window.__bip = null;
      ev.prompt();
      const r = await ev.userChoice.catch(() => ({}));
      if (r.outcome === "accepted") toast("¡Listo! Búscala en tu pantalla de inicio");
      return;
    }
    if (isInApp) return openInBrowserGuide();
    if (isIOS) return iosGuide(false);
    modal({
      title: "Guarda tu tarjeta",
      body: html`<ol class="stack" style="--gap:12px;padding-left:18px;margin:0"><li>Toca el menú <b>⋮</b> de Chrome (arriba a la derecha).</li><li>Elige <b>“Agregar a la pantalla principal”</b> o <b>“Instalar app”</b>.</li></ol>`,
      actions: [{ label: "Entendido", cls: "btn--brand" }],
    });
  }

  /* ----- cercanía (100 m) ----- */
  function showNear(dist, simulated) {
    const nearKey = "near_" + code;
    if (!simulated && Date.now() - ls.get(nearKey, 0) < 3 * 3600e3) return;
    ls.set(nearKey, Date.now());
    const vars = { nombre: firstName(c.name), negocio: b.name, faltan: left(), premio: b.reward, distancia: fmtDist(dist), sellos: c.stamps };
    const msg = left() === 0
      ? `🎁 ¡${vars.nombre}, tu premio te espera a ${vars.distancia}! Pasa a reclamar: ${b.reward}.`
      : fillTemplate(b.nearMsg, vars);
    vibrate([90, 50, 90, 50, 140]);
    modal({
      body: html`<div class="near-modal">
        <span class="near-modal__dist">${ic("map-pin", "", 15)} Estás a ${fmtDist(dist)}</span>
        <div class="mt-4">${cardHTML(b, c, { compact: true })}</div>
        <h3>${msg}</h3>
        <p>Llevas ${c.stamps} de ${goal()} sellos.</p>
      </div>`,
      actions: [
        ...(mapsUrl() ? [{ label: "Cómo llegar", cls: "btn--outline", icon: "navigation", onClick: () => window.open(mapsUrl(), "_blank") }] : []),
        { label: "Ver mi tarjeta", cls: "btn--brand" },
      ],
      onOpen: (m) => confettiBurst(),
    });
    if (document.hidden && pushOn() && "serviceWorker" in navigator) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification(`📍 ${b.name} está a ${fmtDist(dist)}`, { body: msg, icon: d.logoSmall || "/icons/icon-192.png", badge: "/icons/badge-96.png", tag: "near-" + code, data: { url: `/tarjeta/${code}` } }))
        .catch(() => {});
    }
  }
  function startGeo(manual) {
    if (!b.location || geoWatch != null) return;
    if (!("geolocation" in navigator)) return manual && toastErr("Tu celular no permite ubicación en el navegador");
    geoWatch = navigator.geolocation.watchPosition(
      (p) => {
        geoDist = distanceM({ lat: p.coords.latitude, lng: p.coords.longitude }, b.location);
        if (!geoOn()) {
          ls.set("geo_" + code, 1);
          $("[data-actions]", app) && ($("[data-actions]", app).innerHTML = actionsHTML().s);
          if (manual && geoDist > b.location.radius) toast(`Listo. Estás a ${fmtDist(geoDist)} de ${b.name}`);
        }
        const near = $("[data-near]", app);
        if (near) near.innerHTML = nearChipHTML().s;
        if (geoDist <= b.location.radius) showNear(geoDist);
      },
      (err) => {
        navigator.geolocation.clearWatch(geoWatch);
        geoWatch = null;
        if (err.code === 1) {
          ls.del("geo_" + code);
          if (manual) toastErr("No diste permiso de ubicación. Actívalo en los ajustes del navegador.");
        } else if (manual) toastErr("No pudimos ver tu ubicación. Intenta al aire libre.");
      },
      { enableHighAccuracy: true, maximumAge: 20_000, timeout: 30_000 }
    );
  }
  async function autoGeo() {
    if (!geoOn() || !b.location) return;
    try {
      const st = await navigator.permissions?.query({ name: "geolocation" });
      if (st && st.state !== "granted") return;
    } catch {}
    startGeo(false);
  }

  /* ----- eventos ----- */
  app.addEventListener("click", onClick);
  async function onClick(e) {
    const t = e.target.closest("[data-act],[data-dismiss],[data-plink],[data-demo]");
    if (!t) return;
    if (t.dataset.dismiss) {
      dismissed.add(t.dataset.dismiss);
      ls.set("dis_" + code, [...dismissed].slice(-50));
      t.closest(".promo")?.remove();
      return;
    }
    if (t.dataset.plink) {
      api(`/c/${code}/event`, { method: "POST", body: { type: "click", promo: t.dataset.plink } }).catch(() => {});
      return;
    }
    const act = t.dataset.act;
    if (act === "refresh") return busy(t, () => refresh(true));
    if (act === "push") return enablePush(t);
    if (act === "geo") return startGeo(true);
    if (act === "install") return install();
    if (act === "other") {
      ls.del("card_" + b.slug);
      return go(`/unirse/${b.slug}?nuevo=1`);
    }
    const demo = t.dataset.demo;
    if (demo === "stamp")
      return busy(t, async () => {
        try {
          const before = c.stamps;
          const wasRewards = c.rewards;
          const r = await api(`/demo/${code}/stamp`, { method: "POST" });
          c = r.card;
          if (c.rewards > wasRewards) {
            render();
            toast("🎁 Premio canjeado. ¡Así de fácil!");
          } else {
            render(before);
            vibrate();
            if (c.stamps >= goal()) {
              toast("🎉 ¡Tarjeta completa! Toca otra vez para canjear");
              confettiBurst();
            } else toast("¡+1 sello!");
          }
          ls.set("seen_" + code, c.stamps);
        } catch (err) {
          toastErr(err);
        }
      });
    if (demo === "promo")
      return busy(t, async () => {
        try {
          const r = await api(`/demo/${code}/promo`, { method: "POST" });
          await refresh();
          if (r.push.ok) toast("📲 Revisa las notificaciones de tu celular");
          else toast(pushOn() ? "Promo enviada" : "La promo apareció arriba. Activa las notificaciones para recibirla en tu celular", "ok", 4500);
          window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (err) {
          toastErr(err);
        }
      });
    if (demo === "near") return showNear(80, true);
  }
  const onVis = () => {
    if (!document.hidden) {
      refresh();
      schedule();
    } else clearTimeout(pollTimer);
  };
  document.addEventListener("visibilitychange", onVis);
  const onInstallable = () => $("[data-actions]", app) && ($("[data-actions]", app).innerHTML = actionsHTML().s);
  window.addEventListener("fz:installable", onInstallable);

  document.body.classList.toggle("has-demo-bar", !!b.demo);

  /* ----- primer render ----- */
  const anim = lastStamps != null && c.stamps > lastStamps ? lastStamps : isNew ? 0 : undefined;
  render(anim);
  ls.set("seen_" + code, c.stamps);
  ls.set("rew_" + code, c.rewards);
  if (isNew) {
    toast(`¡Bienvenido${b.bonusJoin ? "! Ya tienes tu primer sello" : "! Tu tarjeta está lista"}`);
    confettiBurst();
  } else if (params.has("hola")) toast(`¡Hola de nuevo, ${firstName(c.name)}! Esta es tu tarjeta`);
  if (openedPromo) {
    api(`/c/${code}/event`, { method: "POST", body: { type: "click", promo: openedPromo } }).catch(() => {});
    setTimeout(() => $(`[data-promo="${openedPromo}"]`, app)?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
  }
  schedule();
  autoGeo();
  resyncPush();

  return () => {
    destroyed = true;
    document.body.classList.remove("has-demo-bar");
    clearTimeout(pollTimer);
    if (geoWatch != null) navigator.geolocation.clearWatch(geoWatch);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("fz:installable", onInstallable);
    app.removeEventListener("click", onClick);
  };
}
