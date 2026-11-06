// Fideliza — utilidades compartidas
import { icon } from "./icons.js";
export { icon };

/* ---------- plantillas seguras (todo se escapa salvo raw()) ---------- */
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Raw(String(s ?? ""));
const part = (v) => (v == null || v === false ? "" : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join("") : esc(v));
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => (out += part(v) + strings[i + 1]));
  return new Raw(out);
}
export const ic = (name, cls, size) => raw(icon(name, cls, size));
export function mount(el, tpl) {
  el.innerHTML = part(tpl);
  return el;
}
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------- API ---------- */
export async function api(path, { method = "GET", body, key, owner } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (key) headers["x-key"] = key;
  if (owner) headers["x-owner-key"] = owner;
  let r;
  try {
    r = await fetch("/api" + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    const e = new Error("Sin conexión. Revisa tu internet e intenta de nuevo.");
    e.status = 0;
    throw e;
  }
  let data = {};
  try {
    data = await r.json();
  } catch {}
  if (!r.ok) {
    const e = new Error(data.error || "Algo salió mal. Intenta de nuevo.");
    e.status = r.status;
    e.data = data;
    throw e;
  }
  return data;
}

/* ---------- almacenamiento local ---------- */
export const ls = {
  get(k, d = null) {
    try {
      const v = localStorage.getItem("fz_" + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem("fz_" + k, JSON.stringify(v));
    } catch {}
  },
  del(k) {
    try {
      localStorage.removeItem("fz_" + k);
    } catch {}
  },
};

/* ---------- navegación ---------- */
export function go(path, replace = false) {
  history[replace ? "replaceState" : "pushState"]({}, "", path);
  window.dispatchEvent(new Event("fz:route"));
  window.scrollTo(0, 0);
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-go]");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === "_blank") return;
  e.preventDefault();
  go(a.getAttribute("href"));
});

/* ---------- avisos ---------- */
let toastWrap;
export function toast(msg, type = "ok", ms = 2800) {
  if (!toastWrap) {
    toastWrap = document.createElement("div");
    toastWrap.className = "toasts";
    toastWrap.setAttribute("role", "status");
    document.body.appendChild(toastWrap);
  }
  const t = document.createElement("div");
  t.className = "toast" + (type === "err" ? " toast--err" : "");
  t.innerHTML = icon(type === "err" ? "triangle-alert" : "circle-check", "", 18) + `<span>${esc(msg)}</span>`;
  toastWrap.appendChild(t);
  setTimeout(() => {
    t.classList.add("is-out");
    setTimeout(() => t.remove(), 260);
  }, ms);
}
export const toastErr = (e) => toast(e?.message || String(e), "err", 4200);

/* ---------- ventana modal ---------- */
export function modal({ title = "", body = "", actions = [], wide = false, dismissible = true, onOpen, onClose } = {}) {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal${wide ? " modal--wide" : ""}" role="dialog" aria-modal="true">
    ${title ? `<div class="modal__hd"><div class="modal__t">${esc(title)}</div>${dismissible ? `<button class="btn btn--ghost btn--icon btn--sm" data-x aria-label="Cerrar">${icon("x", "", 18)}</button>` : ""}</div>` : ""}
    <div class="modal__bd">${part(body)}</div>
    ${actions.length ? `<div class="modal__ft">${actions.map((a, i) => `<button class="btn ${a.cls || "btn--outline"}" data-a="${i}">${a.icon ? icon(a.icon, "", 16) : ""}${esc(a.label)}</button>`).join("")}</div>` : ""}
  </div>`;
  const m = bg.firstElementChild;
  let closed = false;
  const close = (v) => {
    if (closed) return;
    closed = true;
    bg.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.(v);
  };
  const onKey = (e) => e.key === "Escape" && dismissible && close();
  document.addEventListener("keydown", onKey);
  bg.addEventListener("click", async (e) => {
    if (e.target === bg && dismissible) return close();
    if (e.target.closest("[data-x]")) return close();
    const b = e.target.closest("[data-a]");
    if (!b) return;
    const a = actions[+b.dataset.a];
    if (!a.onClick) return close();
    b.classList.add("is-loading");
    try {
      const r = await a.onClick({ el: m, close, btn: b });
      if (r !== false && a.close !== false) close(r);
    } catch (err) {
      toastErr(err);
    } finally {
      b.classList.remove("is-loading");
    }
  });
  document.body.appendChild(bg);
  onOpen?.(m, close);
  return { el: m, close };
}
export function confirmBox(title, text, okLabel = "Confirmar", cls = "btn--primary") {
  return new Promise((res) => {
    modal({
      title,
      body: html`<p class="muted">${text}</p>`,
      actions: [
        { label: "Cancelar", cls: "btn--outline", onClick: () => res(false) },
        { label: okLabel, cls, onClick: () => res(true) },
      ],
      onClose: () => res(false),
    });
  });
}

/* ---------- botón con estado de carga ---------- */
export async function busy(btn, fn) {
  if (!btn) return fn();
  const prev = btn.innerHTML;
  btn.classList.add("is-loading");
  btn.innerHTML = icon("loader-circle", "spin", 16) + `<span>${esc(btn.textContent.trim())}</span>`;
  try {
    return await fn();
  } finally {
    btn.classList.remove("is-loading");
    btn.innerHTML = prev;
  }
}

/* ---------- formatos ---------- */
const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
export function ago(ts) {
  if (!ts) return "—";
  const s = (ts - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 50) return "ahora";
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  return rtf.format(Math.round(s / (86400 * 30)), "month");
}
export function fmtDate(v, opts = { day: "numeric", month: "short", year: "numeric" }) {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v + "T12:00:00") : new Date(v);
  return d.toLocaleDateString("es-EC", opts);
}
export const fmtDay = (ymd) => new Date(ymd + "T12:00:00").toLocaleDateString("es-EC", { day: "numeric", month: "short" }).replace(".", "");
export function money(n, cur = "$") {
  const v = Number(n || 0);
  return cur + (Number.isInteger(v) ? v.toString() : v.toFixed(2));
}
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const initials = (s) =>
  String(s || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
export const firstName = (s) => String(s || "").trim().split(/\s+/)[0] || "";
export function todayYmd() {
  return new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
}
export function slugify(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/* ---------- teléfono / WhatsApp ---------- */
export function intlPhone(raw, cc = "593") {
  const plus = String(raw || "").trim().startsWith("+");
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (plus) return d;
  if (d.startsWith(cc) && d.length > 10) return d;
  if (d.startsWith("0")) return cc + d.slice(1);
  if (d.length <= 10) return cc + d;
  return d;
}
export const waLink = (phone, text, cc) => `https://wa.me/${phone ? intlPhone(phone, cc) : ""}?text=${encodeURIComponent(text)}`;

/* ---------- distancia ---------- */
export function distanceM(a, b) {
  const R = 6371000;
  const toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const fmtDist = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

/* ---------- QR ---------- */
export function qrSvg(text, { dark = "#09090b", light = "#ffffff", margin = 1 } = {}) {
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  let d = "";
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="Código QR"><rect width="${size}" height="${size}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
export function qrCanvas(text, px = 1024, { dark = "#09090b", light = "#ffffff", margin = 2 } = {}) {
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cell = Math.floor(px / (n + margin * 2));
  const size = cell * (n + margin * 2);
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d");
  g.fillStyle = light;
  g.fillRect(0, 0, size, size);
  g.fillStyle = dark;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
  return cv;
}

/* ---------- imágenes (se reducen en el teléfono antes de subirlas) ---------- */
export function loadImage(file) {
  return new Promise((res, rej) => {
    if (!file || !/^image\//.test(file.type)) return rej(new Error("Elige una imagen (JPG o PNG)"));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("No se pudo leer la imagen"));
    img.src = url;
  });
}
export function squareImage(img, size, type = "image/png") {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d");
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, size, size);
  g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
  return cv.toDataURL(type, 0.9);
}
export function coverImage(img, w, h, q = 0.82) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const g = cv.getContext("2d");
  const r = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / r;
  const sh = h / r;
  g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h);
  return cv.toDataURL("image/jpeg", q);
}
export function fitImage(img, maxW, q = 0.82) {
  const r = Math.min(1, maxW / img.naturalWidth);
  const cv = document.createElement("canvas");
  cv.width = Math.round(img.naturalWidth * r);
  cv.height = Math.round(img.naturalHeight * r);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", q);
}

/* ---------- varios ---------- */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
  toast("Copiado");
}
export const ua = navigator.userAgent;
export const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/i.test(ua);
export const isInApp = /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|Line\/|Snapchat/i.test(ua);
export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
export function setHead({ title, theme, manifest, appleIcon } = {}) {
  if (title) document.title = title;
  const set = (sel, make, attr, val) => {
    let el = document.head.querySelector(sel);
    if (!val) return el?.remove();
    if (!el) {
      el = make();
      document.head.appendChild(el);
    }
    el.setAttribute(attr, val);
  };
  set('meta[name="theme-color"]', () => Object.assign(document.createElement("meta"), { name: "theme-color" }), "content", theme || "#ffffff");
  set('link[rel="manifest"]', () => Object.assign(document.createElement("link"), { rel: "manifest" }), "href", manifest || "/manifest.webmanifest");
  set('link[rel="apple-touch-icon"]', () => Object.assign(document.createElement("link"), { rel: "apple-touch-icon" }), "href", appleIcon || "/icons/apple-touch-icon.png");
}
export function confettiBurst(host = document.body, colors = ["#991b1b", "#f59e0b", "#16a34a", "#2563eb", "#db2777", "#facc15"]) {
  const box = document.createElement("div");
  box.className = "confetti is-go";
  box.style.position = host === document.body ? "fixed" : "absolute";
  box.style.zIndex = 120;
  for (let i = 0; i < 42; i++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "%";
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 0.5 + "s";
    p.style.animationDuration = 1.6 + Math.random() * 1.4 + "s";
    box.appendChild(p);
  }
  host.appendChild(box);
  setTimeout(() => box.remove(), 3800);
}
export function vibrate(p = [70, 40, 70]) {
  try {
    navigator.vibrate?.(p);
  } catch {}
}
export function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement("script");
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error("No se pudo cargar " + src));
    document.head.appendChild(s);
  });
}
export function brandVars(color) {
  const on = contrastOn(color);
  return `--brand:${color};--brand-on:${on};--brand-soft:${mix(color, 0.1)}`;
}
export function contrastOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.45 ? "#111111" : "#ffffff";
}
export function mix(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "rgba(153,27,27,.1)";
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
export function fillTemplate(tpl, vars) {
  return String(tpl || "").replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}
export function errorPage(el, { title = "Algo salió mal", text = "Intenta de nuevo en un momento.", action = html`<a class="btn btn--outline mt-6" href="/" data-go>Ir al inicio</a>` } = {}) {
  mount(
    el,
    html`<div class="auth"><div class="center fade-in" style="max-width:420px">
      <p class="h3">${title}</p><p class="muted mt-2">${text}</p>${action}
    </div></div>`
  );
}
export const loading = (el) => mount(el, html`<div class="page-loading"><div class="spinner"></div></div>`);
