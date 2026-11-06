// Fideliza — página de inicio con demo animada
import { html, raw, ic, mount, $, $$, api, qrSvg, setHead, waLink } from "./core.js";
import { cardHTML } from "./cardview.js";

const DEMO_BIZ = {
  name: "Café Aroma",
  stampsGoal: 6,
  reward: "Un capuchino gratis",
  design: { template: "degradado", color: "#7c2d12", color2: "#f59e0b", icon: "☕", title: "Club Café Aroma" },
};

const STEPS = [
  { t: "Escanea el QR del local", s: "Con la cámara del celular. No descarga ninguna app.", ms: 3600 },
  { t: "Se registra una sola vez", s: "Nombre y número. Su número es su tarjeta: nunca se duplica.", ms: 4200 },
  { t: "Recibe su tarjeta con tu marca", s: "Tus colores, tu logo y tu premio.", ms: 3400 },
  { t: "Suma un sello en cada compra", s: "En caja escanean su código y listo.", ms: 3600 },
  { t: "Le llega tu publicidad al celular", s: "Como notificación, a todos o solo a quien elijas.", ms: 4000 },
  { t: "Pasa a 100 m y su tarjeta aparece", s: "Le recuerda cuánto le falta y lo invita a entrar.", ms: 5600 },
  { t: "Gana su premio y vuelve", s: "Clientes que regresan una y otra vez.", ms: 4000 },
];

const FEATURES = [
  ["qr-code", "Un QR, siempre la misma tarjeta", "El teléfono identifica al cliente: no se crean cuentas duplicadas aunque escanee mil veces."],
  ["stamp", "Sellos y premios", "Define cuántos sellos necesita tu cliente y cuál es la recompensa."],
  ["megaphone", "Tu publicidad en su celular", "Envía promociones que llegan como notificación al teléfono de cada cliente: a todos o solo a quien tú elijas.", true],
  ["palette", "Tarjeta con tu marca", "Elige diseño, colores, logo e ícono de sello. Tu cliente ve tu marca.", true],
  ["map-pin", "Aparece a 100 m de tu local", "Cuando tu cliente pasa cerca con su tarjeta, le aparece y lo motiva a entrar.", true],
  ["chart-column", "Mira qué funciona", "Sellos por día, clientes que vuelven y quién está a punto de ganar.", true],
  ["smartphone", "Se guarda como app", "Tu cliente la agrega a su pantalla de inicio con tu logo."],
  ["shield-check", "Paneles protegidos", "Cada negocio tiene su clave de administrador y su clave de empleado."],
];

function phoneHTML() {
  const confetti = Array.from({ length: 26 }, (_, i) => `<i style="left:${(i * 37) % 100}%;background:${["#f59e0b", "#7c2d12", "#16a34a", "#2563eb", "#db2777"][i % 5]};animation-delay:${(i % 7) * 0.12}s"></i>`).join("");
  return html`<div class="phone" style="--demo-c1:#7c2d12" aria-label="Demostración animada de Fideliza">
    <div class="phone__screen">
      <div class="phone__status" data-status><span>9:41</span><span class="sig"><i style="height:5px"></i><i style="height:7px"></i><i style="height:9px"></i><i style="height:11px"></i><span class="batt"></span></span></div>

      <div class="scr scr--dark" data-scr="0">
        <div class="cam">
          <div class="cam__counter"></div>
          <div class="cam__sign"><div class="q">${raw(qrSvg("https://fideliza.app/unirse/demo"))}</div><b>Escanea y gana ☕</b><small>Café Aroma</small></div>
        </div>
        <div class="cam__frame"><i></i><i></i><i></i><i></i><div class="cam__line"></div></div>
        <div class="cam__pill">${ic("circle-check", "", 15)} Café Aroma · Abrir tarjeta</div>
      </div>

      <div class="scr" data-scr="1">
        <div class="scr__title">Café Aroma</div>
        <div data-join-card></div>
        <div class="mini-form">
          <div class="mini-field"><label>Tu nombre</label><div class="mini-input" data-type="name"><span></span><i class="caret"></i></div></div>
          <div class="mini-field"><label>Tu número de WhatsApp</label><div class="mini-input" data-type="phone"><span></span></div></div>
          <div class="mini-btn" data-press>Crear mi tarjeta</div>
          <div class="mini-note">🎁 Te regalamos tu primer sello</div>
        </div>
      </div>

      <div class="scr" data-scr="2" style="background:#fafafa">
        <div data-card2></div>
        <p class="mini-note" style="margin-top:12px;font-size:12px">¡Bienvenida, María! Muestra este código en caja para sumar sellos.</p>
        <div style="margin:10px auto 0;width:118px;height:118px;padding:8px;background:#fff;border-radius:12px;border:1px solid #e4e4e7">${raw(qrSvg("DEMO42"))}</div>
      </div>

      <div class="scr" data-scr="3" style="background:#fafafa">
        <div data-card3></div>
        <div class="demo-toast" data-toast3>+1 sello ☕</div>
        <p class="mini-note" style="margin-top:14px;font-size:12px" data-left3>Te faltan 3 para tu capuchino gratis</p>
      </div>

      <div class="scr" data-scr="4">
        <div class="lock"></div>
        <div class="lock__time"><b>9:41</b><small>viernes, 6 de noviembre</small></div>
        <div class="notif"><div class="notif__ic">☕</div><div><div class="notif__app"><span>CAFÉ AROMA</span><span>ahora</span></div><b>Hoy 2x1 en capuchinos ☕</b><p>Solo de 16:00 a 18:00. Muestra tu tarjeta en caja.</p></div></div>
        <div class="notif notif--2"><div class="notif__ic">🎁</div><div><div class="notif__app"><span>CAFÉ AROMA</span><span>ahora</span></div><b>María, te faltan 2 sellos</b><p>Ven esta semana y llévate tu capuchino gratis.</p></div></div>
      </div>

      <div class="scr" data-scr="5">
        <div class="map">
          <div class="map__park" style="left:-6%;top:6%;width:42%;height:22%"></div>
          <div class="map__block" style="left:66%;top:52%;width:40%;height:18%"></div>
          <div class="map__block" style="left:4%;top:44%;width:30%;height:14%"></div>
          <div class="map__road map__road--h" style="top:31%"></div>
          <div class="map__road map__road--h" style="top:62%"></div>
          <div class="map__road map__road--v" style="left:40%"></div>
          <div class="map__road map__road--v" style="left:78%"></div>
          <div class="map__ring"><b>100 m</b></div>
          <div class="map__store"><div class="pin"><span>☕</span></div><small>Café Aroma</small></div>
          <div class="map__me"></div>
        </div>
        <div class="map__dist">${ic("navigation", "", 14)} <span data-dist>350 m</span></div>
        <div class="near-pop">
          <div data-card5></div>
          <b style="margin-top:10px">¡María, estás a 80 m de Café Aroma! ☕</b>
          <p>Te faltan 2 sellos para tu capuchino gratis. ¡Pasa hoy y suma uno más!</p>
        </div>
      </div>

      <div class="scr" data-scr="6" style="background:#fafafa">
        <div class="confetti">${raw(confetti)}</div>
        <div data-card6></div>
        <div style="margin-top:14px;padding:12px;border-radius:12px;background:#fefce8;border:1px solid #fde047;color:#713f12;font-size:12.5px;font-weight:700;text-align:center">🎉 ¡Premio listo! Muéstralo en caja</div>
        <p class="mini-note" style="margin-top:10px">Y la tarjeta vuelve a empezar: tu cliente regresa por el siguiente.</p>
      </div>
    </div>
  </div>`;
}

function startDemo(root) {
  const scrs = $$("[data-scr]", root);
  const items = $$(".demo__step", root);
  const status = $("[data-status]", root);
  let step = 0;
  let t0 = 0;
  let elapsed = 0;
  let paused = false;
  let visible = true;
  let raf = 0;
  let timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const clear = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const card = (sel, stamps, extra = {}) => {
    const el = $(sel, root);
    if (el) el.innerHTML = cardHTML(DEMO_BIZ, { name: "María", stamps, ...extra.card }, { compact: true, ...extra }).s;
  };

  function typeInto(el, text, speed, done) {
    const span = el.querySelector("span");
    span.textContent = "";
    [...text].forEach((ch, i) => later(() => (span.textContent += ch), i * speed));
    later(done || (() => {}), text.length * speed + 120);
  }

  const enter = {
    1() {
      const name = $('[data-type="name"]', root);
      const phone = $('[data-type="phone"]', root);
      const caret = name.querySelector(".caret");
      phone.querySelector("span").textContent = "";
      card("[data-join-card]", 0, { card: { name: "" } });
      typeInto(name, "María", 120, () => {
        card("[data-join-card]", 0, { card: { name: "María" } });
        caret.remove();
        phone.appendChild(caret);
        typeInto(phone, "099 123 4567", 90, () => {
          const b = $("[data-press]", root);
          b.classList.add("is-press");
          later(() => b.classList.remove("is-press"), 220);
        });
      });
    },
    2() {
      card("[data-card2]", 1, { newFrom: 0 });
    },
    3() {
      card("[data-card3]", 3);
      $("[data-left3]", root).textContent = "Te faltan 3 para tu capuchino gratis";
      later(() => {
        card("[data-card3]", 4, { newFrom: 3 });
        $("[data-toast3]", root).classList.add("is-on");
        $("[data-left3]", root).textContent = "¡Bien! Te faltan 2 para tu capuchino gratis";
      }, 900);
      later(() => $("[data-toast3]", root).classList.remove("is-on"), 2600);
    },
    5() {
      card("[data-card5]", 4);
      const d = $("[data-dist]", root);
      const vals = [350, 300, 240, 190, 150, 120, 100, 90, 80];
      vals.forEach((v, i) => later(() => (d.textContent = v + " m"), 250 + i * 300));
    },
    6() {
      card("[data-card6]", 6, { newFrom: 4 });
    },
  };

  function show(i) {
    clear();
    step = i;
    elapsed = 0;
    t0 = performance.now();
    scrs.forEach((s) => s.classList.toggle("is-on", +s.dataset.scr === i));
    items.forEach((it, k) => {
      it.classList.toggle("is-on", k === i);
      it.classList.toggle("is-done", k < i);
      const bar = it.querySelector(".bar i");
      if (bar) bar.style.width = "0%";
    });
    status.classList.toggle("is-light", i === 0 || i === 4);
    enter[i]?.();
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (paused || !visible) {
      t0 = now - elapsed;
      return;
    }
    elapsed = now - t0;
    const dur = STEPS[step].ms;
    const bar = items[step]?.querySelector(".bar i");
    if (bar) bar.style.width = Math.min(100, (elapsed / dur) * 100) + "%";
    if (elapsed >= dur) show((step + 1) % STEPS.length);
  }

  items.forEach((it, k) => it.addEventListener("click", () => show(k)));
  const pauseBtn = $("[data-pause]", root);
  pauseBtn?.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.innerHTML = (paused ? ic("circle-play", "", 16) : ic("circle-pause", "", 16)).s + (paused ? " Reanudar" : " Pausar");
  });
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0.2 });
  io.observe(root);
  const onVis = () => (visible = !document.hidden);
  document.addEventListener("visibilitychange", onVis);
  show(0);
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    clear();
    io.disconnect();
    document.removeEventListener("visibilitychange", onVis);
  };
}

export async function landing(app) {
  setHead({ title: "Fideliza — Tarjetas de fidelidad digitales" });
  const demoUrl = location.origin + "/unirse/demo";
  mount(
    app,
    html`
    <header class="site-hd"><div class="container">
      <a class="brand" href="/" data-go>${ic("stamp", "", 22)} Fideliza</a>
      <nav class="cluster" style="--gap:4px">
        <a class="btn btn--outline btn--sm" href="/acceso" data-go>Acceso negocio</a>
        <a class="btn btn--ghost btn--sm" href="/dueno" data-go>Dueño</a>
      </nav>
    </div></header>

    <main>
      <section class="hero"><div class="container hero__grid">
        <div class="fade-in">
          <p class="eyebrow">Para cafeterías, panaderías, barberías, restaurantes…</p>
          <h1 class="h1 mt-3">Tarjetas de fidelidad digitales, sin instalar nada.</h1>
          <p class="lead">Tus clientes escanean el código QR de tu local, escriben su nombre y teléfono una sola vez, y cada vez que vuelvan a escanear verán su misma tarjeta acumulando sellos.</p>
          <div class="cluster hero__cta" style="--gap:10px">
            <a class="btn btn--lg" href="/acceso" data-go>Abrir panel de mi negocio</a>
            <a class="btn btn--outline btn--lg" href="#probar">${ic("smartphone", "", 18)} Probar en mi celular</a>
          </div>
          <div class="hero__note">
            <span>${ic("check", "", 16)} Publicidad directo al celular</span>
            <span>${ic("check", "", 16)} Aviso a 100 m de tu local</span>
            <span>${ic("check", "", 16)} Tu marca en la tarjeta</span>
          </div>
        </div>
        <div class="demo" data-demo>
          ${phoneHTML()}
          <div style="width:100%;max-width:330px">
            <p class="eyebrow" style="padding-left:10px">Así funciona</p>
            <ol class="demo__steps mt-2">
              ${STEPS.map((s, i) => html`<li><button class="demo__step" type="button"><span class="n">${i + 1}</span><span><b>${s.t}</b><small>${s.s}</small></span><span class="bar"><i></i></span></button></li>`)}
            </ol>
            <div class="demo__controls"><button class="btn btn--ghost btn--sm" data-pause>${ic("circle-pause", "", 16)} Pausar</button></div>
          </div>
        </div>
      </div></section>

      <section class="features"><div class="container">
        <div class="grid g-feat">
          ${FEATURES.map(([i, t, d, isNew]) => html`<div class="card feature${isNew ? " feature--new" : ""}">${ic(i, "", 22)}<h3>${t}</h3><p>${d}</p></div>`)}
        </div>
      </div></section>

      <section class="section section--soft" id="probar"><div class="container">
        <div class="card try">
          <div class="try__qr">${raw(qrSvg(demoUrl))}</div>
          <div>
            <p class="eyebrow">Demo en vivo</p>
            <h2 class="h2 mt-2">Pruébalo ahora en tu celular</h2>
            <p class="lead mt-3" style="font-size:16px">Escanea este código con la cámara. Vas a crear una tarjeta de prueba de un café, sumarte sellos, recibir una publicidad en tu teléfono y ver el aviso de cercanía. Exactamente lo que vivirán tus clientes.</p>
            <div class="cluster mt-4"><a class="btn btn--accent" href="/unirse/demo" data-go>${ic("smartphone", "", 16)} Abrir la demo aquí</a></div>
          </div>
        </div>
      </div></section>

      <section class="section"><div class="container">
        <p class="eyebrow">Para tu negocio</p>
        <h2 class="h2 mt-2" style="max-width:640px">En 3 pasos tus clientes empiezan a volver</h2>
        <div class="grid g2 steps3 mt-6" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))">
          <div class="card step3"><h3>Pon tu QR en el local</h3><p>Te lo damos listo para imprimir, con tu logo y tus colores. Va en caja, en la mesa o en la puerta.</p></div>
          <div class="card step3"><h3>Tus clientes se registran</h3><p>Nombre y número una sola vez. Cada compra suma un sello y ven su avance al instante.</p></div>
          <div class="card step3"><h3>Haz que regresen</h3><p>Envía promos a su celular, premia a los fieles y deja que la tarjeta los llame cuando pasen cerca.</p></div>
        </div>
        <div class="card mt-8" style="padding:28px;background:var(--fg);color:#fff;border-color:var(--fg)">
          <div class="between" style="flex-wrap:wrap;gap:16px">
            <div><h3 class="h3" style="font-size:22px;color:#fff">¿Quieres Fideliza en tu negocio?</h3><p class="mt-1" style="color:#d4d4d8">Te lo dejamos funcionando hoy mismo, con tu QR impreso.</p></div>
            <div class="cluster" data-contact><a class="btn btn--outline" href="/acceso" data-go>Ya tengo cuenta</a></div>
          </div>
        </div>
      </div></section>
    </main>
    <footer class="site-ft">Fideliza — fidelización simple para negocios locales</footer>`
  );
  const stop = startDemo($("[data-demo]", app));
  api("/info")
    .then((info) => {
      if (!info.whatsapp) return;
      const a = document.createElement("a");
      a.className = "btn btn--wa";
      a.target = "_blank";
      a.rel = "noopener";
      a.href = waLink(info.whatsapp, "Hola 👋 Vi Fideliza y quiero la tarjeta de fidelidad para mi negocio.");
      a.innerHTML = ic("message-circle", "", 16).s + " Escríbenos por WhatsApp";
      $("[data-contact]", app)?.prepend(a);
    })
    .catch(() => {});
  return stop;
}
