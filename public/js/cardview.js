// Dibuja la tarjeta de lealtad con el diseño del negocio
import { html, raw, esc, initials, contrastOn } from "./core.js";

export const TEMPLATES = [
  { id: "clasica", name: "Clásica" },
  { id: "color", name: "Color" },
  { id: "degradado", name: "Degradado" },
  { id: "premium", name: "Premium" },
  { id: "foto", name: "Foto" },
];
export const ICONS = ["★", "☕", "🍞", "🥐", "🎂", "🍕", "🍔", "🌮", "🍗", "🍣", "🍦", "🍩", "🧁", "🥤", "🍺", "🍷", "✂️", "💈", "💅", "💇", "🧴", "🐾", "🛒", "👟", "👕", "💊", "🌸", "⚽", "🎮", "🚗", "❤️", "⭐", "🔥", "💎", "👑", "✨"];
export const COLORS = ["#991b1b", "#b45309", "#7c2d12", "#a16207", "#15803d", "#0f766e", "#0369a1", "#1d4ed8", "#6d28d9", "#be185d", "#18181b", "#d4a017"];

export function colsFor(goal) {
  if (goal <= 6) return goal;
  if (goal <= 10) return Math.ceil(goal / 2);
  return 5;
}

/**
 * biz: { name, stampsGoal, reward, design:{template,color,color2,icon,title,logo,bg} }
 * card: { name, stamps, code }
 * opts: { compact, newFrom }  newFrom = índice desde el que los sellos se animan
 */
export function cardHTML(biz, card = {}, opts = {}) {
  const d = biz.design || {};
  const tpl = d.template || "clasica";
  const goal = Math.max(1, biz.stampsGoal || 8);
  const stamps = Math.max(0, Math.min(goal, card.stamps ?? 0));
  const full = stamps >= goal;
  const c1 = d.color || "#991b1b";
  const c2 = d.color2 || "#f97316";
  let on = contrastOn(c1);
  if (tpl === "degradado") on = contrastOn(c1) === "#111111" && contrastOn(c2) === "#111111" ? "#111111" : "#ffffff";
  if (tpl === "foto") on = "#ffffff";
  const icon = d.icon || "★";
  const style = `--c1:${c1};--c2:${c2};--on:${on};--cols:${colsFor(goal)};${tpl === "foto" && d.bg ? `--bgimg:url('${d.bg}')` : ""}`;
  const slots = [];
  for (let i = 0; i < goal; i++) {
    const isOn = i < stamps;
    const isGift = i === goal - 1;
    const isNew = isOn && opts.newFrom != null && i >= opts.newFrom;
    slots.push(
      `<span class="lc__st${isOn ? " is-on" : ""}${isGift && !isOn ? " is-gift" : ""}${isNew ? " is-new" : ""}" style="${isNew ? `animation-delay:${(i - opts.newFrom) * 0.18}s` : ""}">${isGift ? (isOn ? "🎁" : "🎁") : isOn ? esc(icon) : i + 1}</span>`
    );
  }
  const logo = d.logo ? `<img src="${esc(d.logo)}" alt="">` : esc(initials(biz.name));
  return html`<div class="lc lc--${tpl}${opts.compact ? " lc--compact" : ""}${full ? " is-full" : ""}" style="${style}">
    ${full ? raw(`<div class="lc__ribbon">Premio listo</div>`) : ""}
    <div class="lc__top">
      <div class="lc__logo">${raw(logo)}</div>
      <div class="lc__brand"><div class="lc__biz">${biz.name}</div><div class="lc__title">${d.title || "Tarjeta de cliente frecuente"}</div></div>
      ${full ? "" : html`<div class="lc__count">${stamps}/${goal}</div>`}
    </div>
    <div class="lc__member"><div class="lc__label">Cliente</div><div class="lc__name">${card.name || "Tu nombre"}</div></div>
    <div class="lc__stamps">${raw(slots.join(""))}</div>
    <div class="lc__foot">
      <div class="lc__reward">🎁 <span>${biz.reward || "Tu premio"}</span></div>
      ${card.code ? html`<div class="lc__code">${card.code}</div>` : ""}
    </div>
  </div>`;
}

export function templateSwatch(id, c1, c2) {
  const map = {
    clasica: `background:#fff;border:1px solid #e4e4e7;box-shadow:inset 0 6px 0 ${c1}`,
    color: `background:${c1}`,
    degradado: `background:linear-gradient(135deg,${c1},${c2})`,
    premium: `background:linear-gradient(150deg,#27272a,#0c0a09);box-shadow:inset 0 0 0 1.5px ${c1}`,
    foto: `background:linear-gradient(180deg,rgba(0,0,0,.2),rgba(0,0,0,.6)),url('data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50" fill="#a8a29e"/><circle cx="78" cy="14" r="8" fill="#fde68a"/><path d="M0 50 30 22l18 16 14-10 38 22z" fill="#57534e"/></svg>`
    )}') center/cover`,
  };
  return map[id] || map.clasica;
}
