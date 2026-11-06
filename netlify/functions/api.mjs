// Fideliza — API (Netlify Functions v2 + Netlify Blobs)
// Una sola función atiende todo /api/*. Los datos viven en Netlify Blobs (sin base de datos externa).

import { getStore } from "@netlify/blobs";
import { generateVAPIDKeys, generateRequestDetails } from "web-push";
import crypto from "node:crypto";

export const config = { path: "/api/*" };

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

const TZ_OFFSET_H = -5; // Ecuador (sin horario de verano)
const MAX_BODY = 3_000_000;
const CODE_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 símbolos, sin 0/O/1/I
const KEY_ALPHA = "abcdefghijkmnpqrstuvwxyz23456789"; // 32 símbolos, sin l/o/0/1
const TEMPLATES = ["clasica", "color", "degradado", "premium", "foto"];
const SKIP = Symbol("skip");

let _store;
const store = () => (_store ||= getStore({ name: "fideliza", consistency: "strong" }));

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const fail = (status, message, extra) => {
  throw new HttpError(status, message, extra);
};
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

function ymd(ts = Date.now()) {
  return new Date(ts + TZ_OFFSET_H * 3600e3).toISOString().slice(0, 10);
}
function addDays(d, n) {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function addMonths(d, n) {
  const [y, m, day] = d.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
const isYmd = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));

function randFrom(alpha, len) {
  const bytes = crypto.randomBytes(len);
  let s = "";
  for (const b of bytes) s += alpha[b % 32];
  return s;
}
const randCode = () => randFrom(CODE_ALPHA, 6);
const randKey = (len = 8) => randFrom(KEY_ALPHA, len);
const randId = () => crypto.randomBytes(6).toString("hex");
const hashKey = (key, salt) => crypto.createHash("sha256").update(salt + ":" + String(key)).digest("hex");
function safeEq(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
function slugify(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
const digits = (s) => String(s || "").replace(/\D/g, "");
function phoneKey(p) {
  const d = digits(p);
  return d.length > 9 ? d.slice(-9) : d;
}
function str(v, max, min = 0) {
  if (v == null) v = "";
  if (typeof v !== "string" && typeof v !== "number") fail(400, "Dato inválido");
  const s = String(v).trim().replace(/\s+/g, " ");
  if (s.length < min) fail(400, `Mínimo ${min} caracteres`);
  return s.slice(0, max);
}
function text(v, max) {
  if (v == null) return "";
  if (typeof v !== "string") fail(400, "Dato inválido");
  return v.replace(/\r/g, "").trim().slice(0, max);
}
function int(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.round(n)));
}
const hex = (v, def) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : def);
const hashIp = (ip) => crypto.createHash("sha256").update("fz:" + (ip || "?")).digest("hex").slice(0, 16);

let warnedEtag = false;
/* Escritura con control de concurrencia (ETag). fn modifica el objeto y devuelve un resultado.
   Si fn devuelve SKIP no se escribe nada. */
async function mutate(key, fn, init) {
  for (let i = 0; i < 10; i++) {
    const cur = await store().getWithMetadata(key, { type: "json" });
    let data;
    if (cur) data = cur.data;
    else if (init !== undefined) data = typeof init === "function" ? init() : structuredClone(init);
    else fail(404, "No encontrado");
    const out = await fn(data);
    if (out === SKIP || (out && out[SKIP])) return out && out[SKIP] !== undefined ? out.value : undefined;
    if (cur && !cur.etag && !warnedEtag) {
      warnedEtag = true;
      console.warn("Blobs no devolvió ETag; escritura sin control de concurrencia");
    }
    const res = await store().setJSON(key, data, cur ? (cur.etag ? { onlyIfMatch: cur.etag } : {}) : { onlyIfNew: true });
    if (res.modified) return out;
    await sleep(25 + Math.random() * 150 * (i + 1));
  }
  fail(503, "Hay mucho movimiento en este momento, intenta otra vez");
}
const skipWith = (value) => ({ [SKIP]: true, value });

const getJSON = (key) => store().get(key, { type: "json" });

/* ------------------------------------------------------------------ */
/* Configuración del dueño de la plataforma                            */
/* ------------------------------------------------------------------ */

let ownerCache = { t: 0, v: null };
async function ownerCfg(fresh = false) {
  if (!fresh && now() - ownerCache.t < 30_000) return ownerCache.v;
  const v = (await getJSON("cfg/owner")) || null;
  ownerCache = { t: now(), v };
  return v;
}
const ownerSettings = (cfg) => ({
  whatsapp: cfg?.whatsapp || "",
  graceDays: cfg?.graceDays ?? 3,
  autoSuspend: cfg?.autoSuspend ?? true,
  currency: cfg?.currency || "$",
  brand: cfg?.brand || "Fideliza",
  defaultFee: cfg?.defaultFee ?? 20,
});

async function isOwner(req) {
  const k = req.headers.get("x-owner-key");
  if (!k) return false;
  if (process.env.OWNER_KEY && safeEq(k, process.env.OWNER_KEY)) return true;
  const cfg = await ownerCfg();
  if (!cfg?.hash) return false;
  return safeEq(hashKey(k, cfg.salt), cfg.hash);
}
async function requireOwner(req) {
  if (!(await isOwner(req))) {
    await sleep(350);
    fail(401, "Clave de dueño incorrecta");
  }
}

/* Límite de intentos fallidos (anti fuerza bruta) */
async function rateCheck(ip, scope) {
  const key = `rl/${scope}/${hashIp(ip)}`;
  const r = await getJSON(key);
  if (r && r.n >= 10 && now() - r.t < 15 * 60e3) fail(429, "Demasiados intentos. Espera 15 minutos.");
  return { key, r };
}
async function rateFail({ key, r }) {
  const fresh = !r || now() - r.t >= 15 * 60e3;
  await store().setJSON(key, { n: fresh ? 1 : r.n + 1, t: fresh ? now() : r.t });
}

/* ------------------------------------------------------------------ */
/* Estado de pago                                                      */
/* ------------------------------------------------------------------ */

function billingStatus(biz, cfg) {
  if (biz.demo) return { code: "activo", blocked: false, daysLeft: 999, paidUntil: null };
  const s = ownerSettings(cfg);
  const b = biz.billing || {};
  const paidUntil = b.paidUntil || ymd();
  const left = daysBetween(ymd(), paidUntil);
  if (b.suspended) return { code: "suspendido", blocked: true, daysLeft: left, paidUntil };
  if (left >= 0) return { code: left <= 5 ? "por_vencer" : "activo", blocked: false, daysLeft: left, paidUntil };
  if (-left <= s.graceDays) return { code: "gracia", blocked: false, daysLeft: left, graceLeft: s.graceDays + left, paidUntil };
  return { code: "vencido", blocked: s.autoSuspend, daysLeft: left, paidUntil };
}

/* ------------------------------------------------------------------ */
/* Negocios                                                            */
/* ------------------------------------------------------------------ */

const DEFAULT_NEAR = "¡{nombre}, estás a {distancia} de {negocio}! Te faltan {faltan} sellos para {premio}. ¡Pasa hoy y suma uno más!";

function defaultDesign(o = {}) {
  return {
    template: TEMPLATES.includes(o.template) ? o.template : "clasica",
    color: hex(o.color, "#991b1b"),
    color2: hex(o.color2, "#f97316"),
    icon: o.icon || "★",
    title: o.title || "Tarjeta de cliente frecuente",
    welcome: o.welcome || "¡Gracias por visitarnos! Junta tus sellos y gana.",
    terms: o.terms || "",
    logoV: 0,
    bgV: 0,
  };
}

function newBusiness({ name, slug, stampsGoal, reward, fee, paidUntil, ownerName, ownerPhone, cc, demo, design }) {
  const salt = crypto.randomBytes(8).toString("hex");
  const adminKey = randKey(8);
  const staffKey = randKey(6);
  const biz = {
    slug,
    name,
    createdAt: now(),
    demo: !!demo,
    adminSalt: salt,
    adminHash: hashKey(adminKey, salt),
    staffKey,
    stampsGoal: stampsGoal || 8,
    reward: reward || "Un producto gratis",
    bonusJoin: 0,
    cc: cc || "593",
    design: defaultDesign(design),
    contact: { whatsapp: "", instagram: "", address: "" },
    location: null,
    nearMsg: DEFAULT_NEAR,
    billing: {
      fee: fee ?? 20,
      paidUntil: paidUntil || addMonths(ymd(), 1),
      suspended: false,
      ownerName: ownerName || "",
      ownerPhone: ownerPhone || "",
      notes: "",
      since: ymd(),
      payments: [],
    },
  };
  return { biz, keys: { admin: adminKey, staff: staffKey } };
}

async function getBiz(slug) {
  if (!slug || !/^[a-z0-9-]{1,40}$/.test(slug)) fail(404, "Negocio no encontrado");
  if (slug === "demo") return ensureDemo();
  const biz = await getJSON(`biz/${slug}`);
  if (!biz) fail(404, "Negocio no encontrado");
  return biz;
}

async function ensureDemo() {
  const cur = await getJSON("biz/demo");
  if (cur) return cur;
  const { biz } = newBusiness({
    name: "Café Aroma",
    slug: "demo",
    stampsGoal: 6,
    reward: "Un capuchino gratis",
    demo: true,
    design: {
      template: "degradado",
      color: "#7c2d12",
      color2: "#f59e0b",
      icon: "☕",
      title: "Club Café Aroma",
      welcome: "Esta es una tarjeta de prueba: así la verán tus clientes.",
    },
  });
  biz.bonusJoin = 1;
  biz.nearMsg = "¡{nombre}, estás a {distancia} de {negocio}! Te faltan {faltan} sellos para {premio} ☕";
  biz.contact = { whatsapp: "", instagram: "", address: "Tu local aquí" };
  await store().setJSON("biz/demo", biz, { onlyIfNew: true });
  return (await getJSON("biz/demo")) || biz;
}

const imgUrl = (slug, name, v) => (v ? `/api/img/${slug}/${name}?v=${v}` : null);

function publicBiz(biz) {
  const d = biz.design || defaultDesign();
  return {
    slug: biz.slug,
    name: biz.name,
    demo: !!biz.demo,
    stampsGoal: biz.stampsGoal,
    reward: biz.reward,
    bonusJoin: biz.bonusJoin || 0,
    cc: biz.cc || "593",
    design: {
      template: d.template,
      color: d.color,
      color2: d.color2,
      icon: d.icon,
      title: d.title,
      welcome: d.welcome,
      terms: d.terms,
      logo: imgUrl(biz.slug, "logo512", d.logoV),
      logoSmall: imgUrl(biz.slug, "logo192", d.logoV),
      bg: imgUrl(biz.slug, "bg", d.bgV),
    },
    contact: biz.contact || {},
    location: biz.location || null,
    nearMsg: biz.nearMsg || DEFAULT_NEAR,
  };
}

function adminBiz(biz, role) {
  const pub = publicBiz(biz);
  const b = biz.billing || {};
  return {
    ...pub,
    staffKey: role === "staff" ? undefined : biz.staffKey,
    billing: { fee: b.fee, paidUntil: b.paidUntil, since: b.since },
  };
}

/* Datos de clientes de un negocio (un solo documento por negocio) */
const emptyData = () => ({ v: 1, cs: {}, log: [], days: {} });
async function getData(slug) {
  return (await getJSON(`data/${slug}`)) || emptyData();
}
function bumpDay(d, idx, n = 1) {
  const day = ymd();
  const row = (d.days[day] ||= [0, 0, 0]); // [sellos, canjes, registros]
  row[idx] += n;
  const keys = Object.keys(d.days).sort();
  while (keys.length > 70) delete d.days[keys.shift()];
}
function addLog(d, kind, code, name, by, n = 1) {
  d.log.unshift([now(), kind, code, name, by, n]);
  if (d.log.length > 200) d.log.length = 200;
}
function custView(code, c, { phone = false, push = 0 } = {}) {
  return {
    code,
    name: c.n,
    phone: phone ? c.p : undefined,
    stamps: c.s,
    total: c.t,
    rewards: c.r,
    created: c.c,
    last: c.l,
    push: phone ? push : undefined,
    hist: (c.h || []).map(([t, k, n]) => ({ t, k, n })),
  };
}
const logView = (d) => d.log.slice(0, 60).map(([t, k, code, name, by, n]) => ({ t, k, code, name, by, n }));

/* ------------------------------------------------------------------ */
/* Notificaciones push                                                  */
/* ------------------------------------------------------------------ */

async function vapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  let v = await getJSON("cfg/vapid");
  if (v) return v;
  const k = generateVAPIDKeys();
  await store().setJSON("cfg/vapid", k, { onlyIfNew: true });
  return (await getJSON("cfg/vapid")) || k;
}

async function sendPush(sub, payload, vapid, origin) {
  const subject = origin.startsWith("https://") && !origin.includes("localhost") ? origin : "mailto:soporte@fideliza.app";
  const det = generateRequestDetails(sub, JSON.stringify(payload), {
    TTL: 3 * 86400,
    urgency: "normal",
    vapidDetails: { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
  });
  const headers = { ...det.headers };
  delete headers["Content-Length"];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(det.endpoint, { method: "POST", headers, body: det.body, signal: ctrl.signal });
    return r.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

/* Envía a una lista de códigos; payloadFor(code) arma el contenido de cada uno. */
async function pushToCodes(slug, codes, payloadFor, origin) {
  const subsDoc = (await getJSON(`push/${slug}`)) || {};
  const list = (codes || Object.keys(subsDoc)).filter((c) => subsDoc[c]?.length);
  const result = { phones: list.length, sent: 0, ok: 0, failed: 0 };
  if (!list.length) return result;
  const vapid = await vapidKeys();
  const jobs = [];
  for (const code of list) for (const sub of subsDoc[code]) jobs.push({ code, sub });
  const dead = [];
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const { code, sub } = jobs[i++];
      const st = await sendPush(sub, payloadFor(code), vapid, origin);
      result.sent++;
      if (st >= 200 && st < 300) result.ok++;
      else {
        result.failed++;
        if (st === 404 || st === 410) dead.push({ code, endpoint: sub.endpoint });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(24, jobs.length) }, worker));
  if (dead.length) {
    await mutate(`push/${slug}`, (doc) => {
      for (const { code, endpoint } of dead) {
        if (!doc[code]) continue;
        doc[code] = doc[code].filter((s) => s.endpoint !== endpoint);
        if (!doc[code].length) delete doc[code];
      }
    }, {}).catch(() => {});
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Imágenes                                                             */
/* ------------------------------------------------------------------ */

function parseDataUrl(s, maxBytes) {
  if (typeof s !== "string") fail(400, "Imagen inválida");
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(s);
  if (!m) fail(400, "Formato de imagen no permitido (usa JPG, PNG o WEBP)");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > maxBytes) fail(413, "La imagen es muy pesada");
  return { type: m[1], buf };
}
async function putImage(slug, name, dataUrl, maxBytes) {
  const { type, buf } = parseDataUrl(dataUrl, maxBytes);
  await store().set(`img/${slug}/${name}`, new Blob([buf], { type }), { metadata: { type } });
}

/* ------------------------------------------------------------------ */
/* Promociones                                                          */
/* ------------------------------------------------------------------ */

function promoView(p, slug, forAdmin) {
  const v = {
    id: p.id,
    title: p.title,
    body: p.body,
    link: p.link || "",
    linkLabel: p.linkLabel || "",
    img: p.img ? `/api/img/${slug}/p-${p.id}?v=1` : null,
    created: p.created,
    expires: p.expires,
  };
  if (forAdmin) Object.assign(v, { aud: p.aud, reach: p.reach, push: p.push, views: p.views || 0, clicks: p.clicks || 0, target: p.targetName || "" });
  return v;
}
const visiblePromos = (promos, code) =>
  (promos || []).filter((p) => p.expires > now() && (!p.codes || p.codes.includes(code)));

function audienceCodes(data, biz, aud, target) {
  const goal = biz.stampsGoal;
  const all = Object.entries(data.cs);
  if (aud === "one") {
    if (!target || !data.cs[target]) fail(400, "Elige el cliente");
    return [target];
  }
  if (aud === "near") return all.filter(([, c]) => goal - c.s <= 2).map(([k]) => k);
  if (aud === "inactive") return all.filter(([, c]) => now() - (c.l || c.c) > 15 * 864e5).map(([k]) => k);
  return null; // todos
}

/* ------------------------------------------------------------------ */
/* Rutas                                                                */
/* ------------------------------------------------------------------ */

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
function matchRoute(method, path) {
  const segs = path.split("/").filter(Boolean).map(decodeURIComponent);
  for (const r of routes) {
    if (r.method !== method || r.parts.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      if (r.parts[i].startsWith(":")) params[r.parts[i].slice(1)] = segs[i];
      else if (r.parts[i] !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { r, params };
  }
  return null;
}

/* ---------- Público ---------- */

route("GET", "/health", async () => json({ ok: true, t: now() }));

route("GET", "/info", async () => {
  const s = ownerSettings(await ownerCfg());
  return json({ brand: s.brand, whatsapp: s.whatsapp });
});

route("GET", "/vapid", async () => json({ publicKey: (await vapidKeys()).publicKey }));

route("GET", "/b/:slug", async ({ params }) => {
  const biz = await getBiz(params.slug);
  const st = billingStatus(biz, await ownerCfg());
  if (st.blocked) return json({ paused: true, business: { name: biz.name, design: publicBiz(biz).design } });
  return json({ business: publicBiz(biz) });
});

route("POST", "/b/:slug/join", async ({ params, body }) => {
  const biz = await getBiz(params.slug);
  if (billingStatus(biz, await ownerCfg()).blocked) fail(403, "Esta tarjeta está en pausa por ahora.", { paused: true });
  const name = str(body.name, 40, 2);
  const phone = str(body.phone, 20);
  if (digits(phone).length < 7) fail(400, "Escribe un número de teléfono válido");
  const pk = phoneKey(phone);
  let reserved = null;
  const out = await mutate(
    `data/${biz.slug}`,
    async (d) => {
      const found = Object.entries(d.cs).find(([, c]) => c.pk === pk);
      if (found) return skipWith({ code: found[0], existing: true });
      if (!reserved) {
        for (let i = 0; i < 8 && !reserved; i++) {
          const code = randCode();
          const w = await store().setJSON(`code/${code}`, { s: biz.slug }, { onlyIfNew: true });
          if (w.modified) reserved = code;
        }
        if (!reserved) fail(500, "No se pudo crear la tarjeta, intenta de nuevo");
      }
      const bonus = biz.bonusJoin ? 1 : 0;
      d.cs[reserved] = { n: name, p: phone, pk, s: bonus, t: bonus, r: 0, c: now(), l: bonus ? now() : 0, h: bonus ? [[now(), "bonus", 1]] : [] };
      bumpDay(d, 2);
      if (bonus) bumpDay(d, 0, 1);
      addLog(d, "join", reserved, name, "cliente");
      if (biz.demo) {
        // la demo no guarda más de 400 clientes
        const codes = Object.keys(d.cs);
        if (codes.length > 400) {
          const oldest = codes.sort((a, b) => d.cs[a].c - d.cs[b].c).slice(0, codes.length - 400);
          for (const c of oldest) delete d.cs[c];
        }
      }
      return { code: reserved, existing: false };
    },
    emptyData
  );
  return json(out);
});

async function resolveCode(code) {
  code = String(code || "").toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(code)) fail(404, "Tarjeta no encontrada");
  const idx = await getJSON(`code/${code}`);
  if (!idx?.s) fail(404, "Tarjeta no encontrada");
  return { code, slug: idx.s };
}

route("GET", "/c/:code", async ({ params }) => {
  const { code, slug } = await resolveCode(params.code);
  const biz = await getBiz(slug);
  const st = billingStatus(biz, await ownerCfg());
  if (st.blocked) return json({ paused: true, business: { name: biz.name, design: publicBiz(biz).design } });
  const [data, promos] = await Promise.all([getData(slug), getJSON(`pro/${slug}`)]);
  const c = data.cs[code];
  if (!c) fail(404, "Tarjeta no encontrada");
  return json({
    card: custView(code, c),
    business: publicBiz(biz),
    promos: visiblePromos(promos, code).map((p) => promoView(p, slug)),
  });
});

route("POST", "/c/:code/push", async ({ params, body }) => {
  const { code, slug } = await resolveCode(params.code);
  const sub = body.subscription;
  const devEndpoint = process.env.FZ_DEV === "1" && /^http:\/\/localhost[:/]/.test(sub?.endpoint || "");
  if (!sub || typeof sub.endpoint !== "string" || !(/^https:\/\//.test(sub.endpoint) || devEndpoint) || !sub.keys?.p256dh || !sub.keys?.auth)
    fail(400, "Suscripción inválida");
  const clean = { endpoint: sub.endpoint.slice(0, 800), keys: { p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) }, at: now() };
  await mutate(`push/${slug}`, (doc) => {
    const list = (doc[code] || []).filter((s) => s.endpoint !== clean.endpoint);
    list.unshift(clean);
    doc[code] = list.slice(0, 3);
  }, {});
  return json({ ok: true });
});

route("POST", "/c/:code/unpush", async ({ params, body }) => {
  const { code, slug } = await resolveCode(params.code);
  await mutate(`push/${slug}`, (doc) => {
    if (!doc[code]) return SKIP;
    doc[code] = doc[code].filter((s) => s.endpoint !== body.endpoint);
    if (!doc[code].length) delete doc[code];
  }, {});
  return json({ ok: true });
});

route("POST", "/c/:code/event", async ({ params, body }) => {
  const { code, slug } = await resolveCode(params.code);
  const field = body.type === "click" ? "clicks" : body.type === "view" ? "views" : null;
  if (!field || typeof body.promo !== "string") return json({ ok: false });
  await mutate(`pro/${slug}`, (list) => {
    const p = list.find((x) => x.id === body.promo);
    if (!p || (p.codes && !p.codes.includes(code))) return SKIP;
    p[field] = (p[field] || 0) + 1;
  }, []).catch(() => {});
  return json({ ok: true });
});

route("GET", "/img/:slug/:name", async ({ params }) => {
  if (!/^[a-z0-9-]{1,40}$/.test(params.slug) || !/^[a-z0-9-]{1,40}$/.test(params.name)) fail(404, "No existe");
  const r = await store().getWithMetadata(`img/${params.slug}/${params.name}`, { type: "arrayBuffer" });
  if (!r) return new Response("No existe", { status: 404 });
  return new Response(r.data, {
    headers: {
      "content-type": r.metadata?.type || "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable",
      "netlify-cdn-cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
});

route("GET", "/manifest/:code", async ({ params }) => {
  const { code, slug } = await resolveCode(params.code);
  const biz = await getBiz(slug);
  const d = publicBiz(biz).design;
  const icons = d.logo
    ? [
        { src: d.logoSmall, sizes: "192x192", type: "image/png", purpose: "any" },
        { src: d.logo, sizes: "512x512", type: "image/png", purpose: "any" },
      ]
    : [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      ];
  const manifest = {
    id: `/tarjeta/${code}`,
    name: `${biz.name} · Mi tarjeta`,
    short_name: biz.name.slice(0, 14),
    description: `Tu tarjeta de cliente de ${biz.name}`,
    start_url: `/tarjeta/${code}?app=1`,
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: d.color,
    icons,
  };
  return new Response(JSON.stringify(manifest), { headers: { "content-type": "application/manifest+json", "cache-control": "no-store" } });
});

/* ---------- Demo para prospectos ---------- */

route("POST", "/demo/:code/stamp", async ({ params }) => {
  const { code, slug } = await resolveCode(params.code);
  if (slug !== "demo") fail(403, "Solo disponible en la demo");
  const biz = await ensureDemo();
  const card = await mutate(`data/demo`, (d) => {
    const c = d.cs[code];
    if (!c) fail(404, "Tarjeta no encontrada");
    if (now() - (c.dl || 0) < 900) fail(429, "Espera un segundo");
    c.dl = now();
    if (c.s >= biz.stampsGoal) {
      c.s = 0;
      c.r++;
      c.h.unshift([now(), "redeem", 1]);
      addLog(d, "redeem", code, c.n, "demo");
    } else {
      c.s++;
      c.t++;
      c.h.unshift([now(), "stamp", 1]);
      addLog(d, "stamp", code, c.n, "demo");
    }
    c.h = c.h.slice(0, 12);
    c.l = now();
    return custView(code, c);
  });
  return json({ card });
});

route("POST", "/demo/:code/promo", async ({ params, url }) => {
  const { code, slug } = await resolveCode(params.code);
  if (slug !== "demo") fail(403, "Solo disponible en la demo");
  const id = randId();
  const promo = {
    id,
    title: "☕ Hoy 2x1 en capuchinos",
    body: "Solo de 16:00 a 18:00. Muestra tu tarjeta en caja.",
    link: "",
    linkLabel: "",
    img: false,
    aud: "one",
    codes: [code],
    reach: 1,
    created: now(),
    expires: now() + 864e5,
    push: { phones: 0, sent: 0, ok: 0, failed: 0 },
  };
  await mutate(`pro/demo`, (list) => {
    const mine = list.filter((p) => p.codes?.includes(code));
    if (mine[0] && now() - mine[0].created < 15_000) fail(429, "Espera unos segundos para enviar otra");
    list.unshift(promo);
    const keep = list.filter((p) => p.expires > now()).slice(0, 300);
    list.length = 0;
    list.push(...keep);
  }, []);
  const biz = await ensureDemo();
  const logo = publicBiz(biz).design.logoSmall;
  const push = await pushToCodes("demo", [code], () => ({
    title: `${biz.name}: ${promo.title}`,
    body: promo.body,
    url: `/tarjeta/${code}?promo=${id}`,
    tag: id,
    icon: logo || "/icons/icon-192.png",
  }), url.origin);
  return json({ promo: promoView(promo, "demo"), push });
});

/* ---------- Negocio (dueño del local / empleado) ---------- */

async function bizAuth(req, biz) {
  if (await isOwner(req)) return "owner";
  const k = req.headers.get("x-key") || "";
  if (!k) fail(401, "Necesitas la clave del negocio");
  if (safeEq(hashKey(k, biz.adminSalt), biz.adminHash)) return "admin";
  if (biz.staffKey && safeEq(k, biz.staffKey)) return "staff";
  await sleep(350);
  fail(401, "Clave incorrecta");
}
const isAdmin = (role) => role === "admin" || role === "owner";
function requireAdmin(role) {
  if (!isAdmin(role)) fail(403, "Solo el administrador puede hacer esto");
}
async function requireActive(biz) {
  const st = billingStatus(biz, await ownerCfg());
  if (st.blocked) fail(402, "La cuenta de este negocio está suspendida. Comunícate con soporte para reactivarla.", { suspended: true });
  return st;
}

route("POST", "/biz/login", async ({ req, body, context }) => {
  const rl = await rateCheck(context?.ip, "biz");
  const slug = slugify(body.slug);
  if (!slug) fail(400, "Escribe el enlace de tu negocio");
  const biz = slug === "demo" ? await ensureDemo() : await getJSON(`biz/${slug}`).catch(() => null);
  const key = String(body.key || "");
  let role = null;
  if (biz) {
    if (safeEq(hashKey(key, biz.adminSalt), biz.adminHash)) role = "admin";
    else if (biz.staffKey && safeEq(key, biz.staffKey)) role = "staff";
  }
  if (!role) {
    await rateFail(rl);
    await sleep(350);
    fail(401, biz ? "Clave incorrecta" : "No encontramos ese negocio");
  }
  return json({ slug: biz.slug, name: biz.name, role });
});

route("GET", "/biz/:slug/panel", async ({ req, params }) => {
  const biz = await getBiz(params.slug);
  const role = await bizAuth(req, biz);
  const cfg = await ownerCfg();
  const [data, promos, subs] = await Promise.all([
    getData(biz.slug),
    isAdmin(role) ? getJSON(`pro/${biz.slug}`) : null,
    isAdmin(role) ? getJSON(`push/${biz.slug}`) : null,
  ]);
  const showPhone = isAdmin(role);
  const customers = Object.entries(data.cs)
    .map(([code, c]) => custView(code, c, { phone: showPhone, push: subs?.[code]?.length || 0 }))
    .sort((a, b) => (b.last || b.created) - (a.last || a.created));
  const days = Object.entries(data.days)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-30)
    .map(([day, [s, r, j]]) => ({ day, stamps: s, redeems: r, joins: j }));
  return json({
    role,
    business: adminBiz(biz, role),
    status: billingStatus(biz, cfg),
    support: { whatsapp: ownerSettings(cfg).whatsapp, brand: ownerSettings(cfg).brand, currency: ownerSettings(cfg).currency },
    customers,
    log: logView(data),
    days,
    promos: isAdmin(role) ? (promos || []).map((p) => promoView(p, biz.slug, true)) : [],
    pushCount: subs ? Object.keys(subs).length : undefined,
  });
});

route("GET", "/biz/:slug/customer/:code", async ({ req, params }) => {
  const biz = await getBiz(params.slug);
  const role = await bizAuth(req, biz);
  const code = String(params.code).toUpperCase();
  const data = await getData(biz.slug);
  const c = data.cs[code];
  if (!c) fail(404, "Ese código no es de un cliente de este negocio");
  return json({ customer: custView(code, c, { phone: isAdmin(role) }) });
});

route("POST", "/biz/:slug/stamp", async ({ req, params, body }) => {
  const biz = await getBiz(params.slug);
  const role = await bizAuth(req, biz);
  await requireActive(biz);
  const code = String(body.code || "").toUpperCase().trim();
  let n = int(body.n, -5, 5, 1);
  if (n === 0) fail(400, "Cantidad inválida");
  if (n < 0) requireAdmin(role);
  const goal = biz.stampsGoal;
  const customer = await mutate(`data/${biz.slug}`, (d) => {
    const c = d.cs[code];
    if (!c) fail(404, "Ese código no es de un cliente de este negocio");
    if (n > 0) {
      const room = goal - c.s;
      if (room <= 0) fail(409, "Tarjeta completa: primero canjea el premio", { full: true });
      n = Math.min(n, room);
    } else {
      n = -Math.min(-n, c.s);
      if (n === 0) fail(409, "Este cliente no tiene sellos para quitar");
    }
    c.s += n;
    c.t = Math.max(0, c.t + n);
    c.l = now();
    c.h = [[now(), n > 0 ? "stamp" : "unstamp", Math.abs(n)], ...(c.h || [])].slice(0, 12);
    bumpDay(d, 0, n);
    addLog(d, n > 0 ? "stamp" : "unstamp", code, c.n, role, Math.abs(n));
    return custView(code, c, { phone: isAdmin(role) });
  });
  return json({ customer, added: n });
});

route("POST", "/biz/:slug/redeem", async ({ req, params, body }) => {
  const biz = await getBiz(params.slug);
  const role = await bizAuth(req, biz);
  await requireActive(biz);
  const code = String(body.code || "").toUpperCase().trim();
  const customer = await mutate(`data/${biz.slug}`, (d) => {
    const c = d.cs[code];
    if (!c) fail(404, "Ese código no es de un cliente de este negocio");
    if (c.s < biz.stampsGoal) fail(409, `Le faltan ${biz.stampsGoal - c.s} sellos para el premio`);
    c.s -= biz.stampsGoal;
    c.r++;
    c.l = now();
    c.h = [[now(), "redeem", 1], ...(c.h || [])].slice(0, 12);
    bumpDay(d, 1);
    addLog(d, "redeem", code, c.n, role);
    return custView(code, c, { phone: isAdmin(role) });
  });
  return json({ customer });
});

route("DELETE", "/biz/:slug/customer/:code", async ({ req, params }) => {
  const biz = await getBiz(params.slug);
  requireAdmin(await bizAuth(req, biz));
  const code = String(params.code).toUpperCase();
  await mutate(`data/${biz.slug}`, (d) => {
    if (!d.cs[code]) fail(404, "Cliente no encontrado");
    delete d.cs[code];
  });
  await store().delete(`code/${code}`);
  await mutate(`push/${biz.slug}`, (doc) => {
    if (!doc[code]) return SKIP;
    delete doc[code];
  }, {});
  return json({ ok: true });
});

route("PUT", "/biz/:slug/settings", async ({ req, params, body }) => {
  const biz0 = await getBiz(params.slug);
  requireAdmin(await bizAuth(req, biz0));
  const updated = await mutate(`biz/${biz0.slug}`, (biz) => {
    if (body.name !== undefined) biz.name = str(body.name, 60, 2);
    if (body.stampsGoal !== undefined) biz.stampsGoal = int(body.stampsGoal, 3, 20, biz.stampsGoal);
    if (body.reward !== undefined) biz.reward = str(body.reward, 60, 2);
    if (body.bonusJoin !== undefined) biz.bonusJoin = body.bonusJoin ? 1 : 0;
    if (body.cc !== undefined) biz.cc = digits(body.cc).slice(0, 3) || "593";
    if (body.nearMsg !== undefined) biz.nearMsg = text(body.nearMsg, 220) || DEFAULT_NEAR;
    if (body.contact) {
      biz.contact = {
        whatsapp: str(body.contact.whatsapp, 20),
        instagram: str(body.contact.instagram, 40).replace(/^@/, ""),
        address: str(body.contact.address, 120),
      };
    }
    if (body.location !== undefined) {
      if (body.location === null) biz.location = null;
      else {
        const lat = Number(body.location.lat);
        const lng = Number(body.location.lng);
        if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180) || (lat === 0 && lng === 0)) fail(400, "Ubicación inválida");
        biz.location = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, radius: int(body.location.radius, 30, 1000, 100) };
      }
    }
    if (body.design) {
      const d = body.design;
      const cur = biz.design || defaultDesign();
      biz.design = {
        ...cur,
        template: TEMPLATES.includes(d.template) ? d.template : cur.template,
        color: hex(d.color, cur.color),
        color2: hex(d.color2, cur.color2),
        icon: d.icon !== undefined ? str(d.icon, 4) || "★" : cur.icon,
        title: d.title !== undefined ? str(d.title, 40) : cur.title,
        welcome: d.welcome !== undefined ? text(d.welcome, 160) : cur.welcome,
        terms: d.terms !== undefined ? text(d.terms, 240) : cur.terms,
      };
    }
    biz.updatedAt = now();
    return biz;
  });
  return json({ business: adminBiz(updated, "admin") });
});

route("PUT", "/biz/:slug/image/:name", async ({ req, params, body }) => {
  const biz0 = await getBiz(params.slug);
  requireAdmin(await bizAuth(req, biz0));
  const slug = biz0.slug;
  if (params.name === "logo") {
    await putImage(slug, "logo512", body.large, 450_000);
    await putImage(slug, "logo192", body.small, 150_000);
  } else if (params.name === "bg") {
    await putImage(slug, "bg", body.data, 800_000);
  } else fail(404, "No existe");
  const biz = await mutate(`biz/${slug}`, (b) => {
    if (params.name === "logo") b.design.logoV = (b.design.logoV || 0) + 1;
    else b.design.bgV = (b.design.bgV || 0) + 1;
    return b;
  });
  return json({ business: adminBiz(biz, "admin") });
});

route("DELETE", "/biz/:slug/image/:name", async ({ req, params }) => {
  const biz0 = await getBiz(params.slug);
  requireAdmin(await bizAuth(req, biz0));
  const slug = biz0.slug;
  const names = params.name === "logo" ? ["logo512", "logo192"] : params.name === "bg" ? ["bg"] : fail(404, "No existe");
  await Promise.all(names.map((n) => store().delete(`img/${slug}/${n}`)));
  const biz = await mutate(`biz/${slug}`, (b) => {
    if (params.name === "logo") b.design.logoV = 0;
    else b.design.bgV = 0;
    return b;
  });
  return json({ business: adminBiz(biz, "admin") });
});

route("PUT", "/biz/:slug/keys", async ({ req, params, body }) => {
  const biz0 = await getBiz(params.slug);
  requireAdmin(await bizAuth(req, biz0));
  const admin = body.admin ? str(body.admin, 40) : "";
  const staff = body.staff ? str(body.staff, 40) : "";
  if (admin && admin.length < 6) fail(400, "La clave de administrador debe tener al menos 6 caracteres");
  if (staff && staff.length < 4) fail(400, "La clave de empleado debe tener al menos 4 caracteres");
  if (admin && staff && admin === staff) fail(400, "Las dos claves deben ser distintas");
  const biz = await mutate(`biz/${biz0.slug}`, (b) => {
    if (admin) {
      b.adminSalt = crypto.randomBytes(8).toString("hex");
      b.adminHash = hashKey(admin, b.adminSalt);
    }
    if (staff) {
      if (safeEq(hashKey(staff, b.adminSalt), b.adminHash)) fail(400, "La clave de empleado no puede ser igual a la de administrador");
      b.staffKey = staff;
    }
    return b;
  });
  return json({ ok: true, staffKey: biz.staffKey });
});

route("POST", "/biz/:slug/promo", async ({ req, params, body, url }) => {
  const biz = await getBiz(params.slug);
  requireAdmin(await bizAuth(req, biz));
  await requireActive(biz);
  const slug = biz.slug;
  const title = str(body.title, 70, 3);
  const pbody = text(body.body, 300);
  let link = str(body.link, 300);
  if (link && !/^https?:\/\//i.test(link)) fail(400, "El enlace debe empezar con https://");
  const linkLabel = link ? str(body.linkLabel, 30) || "Ver más" : "";
  const aud = ["all", "near", "inactive", "one"].includes(body.aud) ? body.aud : "all";
  const days = int(body.days, 1, 60, 7);
  const data = await getData(slug);
  const codes = audienceCodes(data, biz, aud, String(body.target || "").toUpperCase());
  if (codes && !codes.length) fail(400, "Todavía no hay clientes en ese grupo");
  const id = randId();
  if (body.image) await putImage(slug, `p-${id}`, body.image, 700_000);
  const promo = {
    id,
    title,
    body: pbody,
    link,
    linkLabel,
    img: !!body.image,
    aud,
    codes,
    targetName: aud === "one" ? data.cs[codes[0]]?.n || "" : "",
    reach: codes ? codes.length : Object.keys(data.cs).length,
    created: now(),
    expires: now() + days * 864e5,
    push: { phones: 0, sent: 0, ok: 0, failed: 0 },
    views: 0,
    clicks: 0,
  };
  await mutate(`pro/${slug}`, (list) => {
    list.unshift(promo);
    const keep = list.filter((p) => p.expires > now() - 30 * 864e5).slice(0, 60);
    list.length = 0;
    list.push(...keep);
  }, []);
  const d = publicBiz(biz).design;
  const push = body.push === false
    ? { phones: 0, sent: 0, ok: 0, failed: 0 }
    : await pushToCodes(slug, codes, (code) => ({
        title: `${biz.name}: ${title}`,
        body: pbody || biz.reward,
        url: `/tarjeta/${code}?promo=${id}`,
        tag: id,
        icon: d.logoSmall || "/icons/icon-192.png",
        image: promo.img ? `/api/img/${slug}/p-${id}?v=1` : undefined,
      }), url.origin);
  promo.push = push;
  await mutate(`pro/${slug}`, (list) => {
    const p = list.find((x) => x.id === id);
    if (!p) return SKIP;
    p.push = push;
  }, []);
  return json({ promo: promoView(promo, slug, true), push });
});

route("DELETE", "/biz/:slug/promo/:id", async ({ req, params }) => {
  const biz = await getBiz(params.slug);
  requireAdmin(await bizAuth(req, biz));
  let hadImg = false;
  await mutate(`pro/${biz.slug}`, (list) => {
    const i = list.findIndex((p) => p.id === params.id);
    if (i < 0) fail(404, "Promoción no encontrada");
    hadImg = list[i].img;
    list.splice(i, 1);
  }, []);
  if (hadImg) await store().delete(`img/${biz.slug}/p-${params.id}`).catch(() => {});
  return json({ ok: true });
});

/* ---------- Dueño de la plataforma (Winix) ---------- */

route("GET", "/owner/status", async () => {
  const cfg = await ownerCfg(true);
  return json({ setup: !!cfg?.hash || !!process.env.OWNER_KEY });
});

route("POST", "/owner/setup", async ({ body }) => {
  const key = String(body.key || "");
  if (key.length < 8) fail(400, "La clave debe tener al menos 8 caracteres");
  if (process.env.OWNER_KEY) fail(409, "La clave de dueño ya está configurada");
  const salt = crypto.randomBytes(8).toString("hex");
  const w = await store().setJSON(
    "cfg/owner",
    { hash: hashKey(key, salt), salt, createdAt: now(), whatsapp: digits(body.whatsapp).slice(0, 15), graceDays: 3, autoSuspend: true, currency: "$", brand: "Fideliza", defaultFee: 20 },
    { onlyIfNew: true }
  );
  if (!w.modified) fail(409, "La clave de dueño ya está configurada");
  ownerCache = { t: 0, v: null };
  return json({ ok: true });
});

route("POST", "/owner/login", async ({ req, context }) => {
  const rl = await rateCheck(context?.ip, "owner");
  if (!(await isOwner(req))) {
    await rateFail(rl);
    await sleep(350);
    fail(401, "Clave de dueño incorrecta");
  }
  return json({ ok: true });
});

function ownerBizView(biz, cfg, data, subs) {
  const b = biz.billing || {};
  return {
    slug: biz.slug,
    name: biz.name,
    demo: !!biz.demo,
    createdAt: biz.createdAt,
    design: publicBiz(biz).design,
    stampsGoal: biz.stampsGoal,
    reward: biz.reward,
    staffKey: biz.staffKey,
    status: billingStatus(biz, cfg),
    billing: { fee: b.fee, paidUntil: b.paidUntil, suspended: !!b.suspended, ownerName: b.ownerName, ownerPhone: b.ownerPhone, notes: b.notes, since: b.since, payments: (b.payments || []).slice(0, 24) },
    customers: data ? Object.keys(data.cs).length : 0,
    stamps30: data ? Object.entries(data.days).filter(([d]) => d >= addDays(ymd(), -30)).reduce((a, [, r]) => a + r[0], 0) : 0,
    pushCount: subs ? Object.keys(subs).length : 0,
    lastActivity: data?.log?.[0]?.[0] || null,
  };
}

route("GET", "/owner/overview", async ({ req }) => {
  await requireOwner(req);
  const cfg = await ownerCfg(true);
  const { blobs } = await store().list({ prefix: "biz/" });
  const slugs = blobs.map((b) => b.key.slice(4)).filter((s) => s !== "demo");
  const list = await Promise.all(
    slugs.map(async (slug) => {
      const [biz, data, subs] = await Promise.all([getJSON(`biz/${slug}`), getJSON(`data/${slug}`), getJSON(`push/${slug}`)]);
      return biz ? ownerBizView(biz, cfg, data, subs) : null;
    })
  );
  const businesses = list.filter(Boolean).sort((a, b) => a.status.daysLeft - b.status.daysLeft);
  return json({ settings: ownerSettings(cfg), businesses, today: ymd() });
});

route("POST", "/owner/business", async ({ req, body }) => {
  await requireOwner(req);
  const name = str(body.name, 60, 2);
  let base = slugify(body.slug || name) || "negocio";
  if (base === "demo") base = "demo-1";
  const fee = Math.max(0, Math.round(Number(body.fee) * 100) / 100 || 0);
  let paidUntil;
  if (body.start === "trial") paidUntil = addDays(ymd(), int(body.trialDays, 1, 60, 7));
  else if (body.start === "date" && isYmd(body.paidUntil)) paidUntil = body.paidUntil;
  else paidUntil = addMonths(ymd(), 1);
  for (let i = 0; i < 30; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const { biz, keys } = newBusiness({
      name,
      slug,
      fee,
      paidUntil,
      stampsGoal: int(body.stampsGoal, 3, 20, 8),
      reward: str(body.reward, 60) || "Un producto gratis",
      ownerName: str(body.ownerName, 60),
      ownerPhone: str(body.ownerPhone, 20),
      cc: digits(body.cc).slice(0, 3) || "593",
      design: { color: hex(body.color, "#991b1b") },
    });
    if (body.start !== "trial" && body.start !== "date") biz.billing.payments.push({ at: now(), amount: fee, months: 1, until: paidUntil, note: "Primer mes" });
    if (body.start === "trial") biz.billing.notes = "Prueba gratis";
    const w = await store().setJSON(`biz/${slug}`, biz, { onlyIfNew: true });
    if (w.modified) {
      return json({ business: ownerBizView(biz, await ownerCfg(), null, null), keys });
    }
  }
  fail(409, "Ese enlace ya existe, elige otro");
});

route("PUT", "/owner/business/:slug", async ({ req, params, body }) => {
  await requireOwner(req);
  const biz = await mutate(`biz/${slugify(params.slug)}`, (b) => {
    const bl = (b.billing ||= {});
    if (body.fee !== undefined) bl.fee = Math.max(0, Math.round(Number(body.fee) * 100) / 100 || 0);
    if (body.paidUntil !== undefined) {
      if (!isYmd(body.paidUntil)) fail(400, "Fecha inválida");
      bl.paidUntil = body.paidUntil;
    }
    if (body.suspended !== undefined) bl.suspended = !!body.suspended;
    if (body.ownerName !== undefined) bl.ownerName = str(body.ownerName, 60);
    if (body.ownerPhone !== undefined) bl.ownerPhone = str(body.ownerPhone, 20);
    if (body.notes !== undefined) bl.notes = text(body.notes, 300);
    if (body.name !== undefined) b.name = str(body.name, 60, 2);
    return b;
  });
  return json({ business: ownerBizView(biz, await ownerCfg(), null, null) });
});

route("POST", "/owner/business/:slug/payment", async ({ req, params, body }) => {
  await requireOwner(req);
  const months = int(body.months, 1, 24, 1);
  const biz = await mutate(`biz/${slugify(params.slug)}`, (b) => {
    const bl = (b.billing ||= {});
    const today = ymd();
    let base = bl.paidUntil && isYmd(bl.paidUntil) ? bl.paidUntil : today;
    if (daysBetween(base, today) > 30) base = today; // si llevaba más de un mes sin pagar, el nuevo mes cuenta desde hoy
    const until = addMonths(base, months);
    const amount = body.amount !== undefined && body.amount !== "" ? Math.max(0, Number(body.amount) || 0) : (bl.fee || 0) * months;
    bl.paidUntil = until;
    bl.suspended = false;
    bl.payments = [{ at: now(), amount, months, until, note: text(body.note, 80) }, ...(bl.payments || [])].slice(0, 36);
    return b;
  });
  return json({ business: ownerBizView(biz, await ownerCfg(), null, null) });
});

route("POST", "/owner/business/:slug/reset-keys", async ({ req, params }) => {
  await requireOwner(req);
  const admin = randKey(8);
  const staff = randKey(6);
  await mutate(`biz/${slugify(params.slug)}`, (b) => {
    b.adminSalt = crypto.randomBytes(8).toString("hex");
    b.adminHash = hashKey(admin, b.adminSalt);
    b.staffKey = staff;
  });
  return json({ keys: { admin, staff } });
});

route("DELETE", "/owner/business/:slug", async ({ req, params, body }) => {
  await requireOwner(req);
  const slug = slugify(params.slug);
  if (body.confirm !== slug) fail(400, "Escribe el enlace del negocio para confirmar");
  const biz = await getJSON(`biz/${slug}`);
  if (!biz) fail(404, "Negocio no encontrado");
  const data = await getData(slug);
  await Promise.all(Object.keys(data.cs).map((c) => store().delete(`code/${c}`)));
  const { blobs } = await store().list({ prefix: `img/${slug}/` });
  await Promise.all(blobs.map((b) => store().delete(b.key)));
  await Promise.all([`data/${slug}`, `pro/${slug}`, `push/${slug}`, `biz/${slug}`].map((k) => store().delete(k)));
  return json({ ok: true });
});

route("PUT", "/owner/settings", async ({ req, body }) => {
  await requireOwner(req);
  const cfg = await mutate("cfg/owner", (c) => {
    if (!c.hash && !process.env.OWNER_KEY) fail(400, "Primero crea tu clave de dueño");
    if (body.whatsapp !== undefined) c.whatsapp = digits(body.whatsapp).slice(0, 15);
    if (body.graceDays !== undefined) c.graceDays = int(body.graceDays, 0, 30, 3);
    if (body.autoSuspend !== undefined) c.autoSuspend = !!body.autoSuspend;
    if (body.currency !== undefined) c.currency = str(body.currency, 4) || "$";
    if (body.defaultFee !== undefined) c.defaultFee = Math.max(0, Number(body.defaultFee) || 0);
    if (body.newKey) {
      const k = String(body.newKey);
      if (k.length < 8) fail(400, "La nueva clave debe tener al menos 8 caracteres");
      c.salt = crypto.randomBytes(8).toString("hex");
      c.hash = hashKey(k, c.salt);
    }
    return c;
  }, process.env.OWNER_KEY ? {} : undefined);
  ownerCache = { t: 0, v: null };
  return json({ settings: ownerSettings(cfg) });
});

/* ------------------------------------------------------------------ */
/* Entrada                                                              */
/* ------------------------------------------------------------------ */

export default async (req, context) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    const m = matchRoute(req.method, path);
    if (!m) fail(404, "Ruta no encontrada");
    let body = {};
    if (req.method !== "GET" && req.method !== "HEAD") {
      const len = Number(req.headers.get("content-length") || 0);
      if (len > MAX_BODY) fail(413, "Archivo muy pesado");
      const t = await req.text();
      if (t.length > MAX_BODY) fail(413, "Archivo muy pesado");
      if (t) {
        try {
          body = JSON.parse(t);
        } catch {
          fail(400, "JSON inválido");
        }
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
    }
    return await m.r.handler({ req, url, params: m.params, body, context });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
    console.error(e);
    return json({ error: "Error del servidor. Intenta de nuevo." }, 500);
  }
};
