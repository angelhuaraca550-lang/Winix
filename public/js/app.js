// Fideliza — enrutador principal
import { html, mount, setHead } from "./core.js";

const routes = [
  [/^\/$/, () => import("./landing.js"), "landing"],
  [/^\/unirse\/([^/]+)\/?$/, () => import("./client.js"), "join"],
  [/^\/tarjeta\/([^/]+)\/?$/, () => import("./client.js"), "card"],
  [/^\/acceso\/?$/, () => import("./panel.js"), "access"],
  [/^\/negocio\/([^/]+)\/?$/, () => import("./panel.js"), "panel"],
  [/^\/dueno\/?$/, () => import("./owner.js"), "owner"],
];

// Guardamos el aviso "instalar app" de Android para usarlo desde la tarjeta
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  window.__bip = e;
  window.dispatchEvent(new Event("fz:installable"));
});

let cleanup = null;
let current = "";

async function render() {
  const app = document.getElementById("app");
  const path = location.pathname;
  if (path === current) return;
  current = path;
  try {
    cleanup?.();
  } catch {}
  cleanup = null;
  for (const [re, load, name] of routes) {
    const m = path.match(re);
    if (!m) continue;
    try {
      const mod = await load();
      if (current !== path) return;
      cleanup = (await mod[name](app, ...m.slice(1).map(decodeURIComponent))) || null;
    } catch (e) {
      console.error(e);
      mount(app, html`<div class="auth"><div class="center"><p class="h3">No se pudo cargar la página</p><p class="muted mt-2">Revisa tu conexión y vuelve a intentar.</p><button class="btn btn--outline mt-6" onclick="location.reload()">Reintentar</button></div></div>`);
    }
    return;
  }
  setHead({ title: "Página no encontrada · Fideliza" });
  mount(app, html`<div class="auth"><div class="center fade-in"><p class="h1" style="font-size:72px">404</p><p class="muted mt-2">Esta página no existe.</p><a class="btn btn--outline mt-6" href="/" data-go>Volver al inicio</a></div></div>`);
}

window.addEventListener("popstate", () => {
  if (location.pathname !== current) render();
});
window.addEventListener("fz:route", () => {
  current = "";
  render();
});
render();
