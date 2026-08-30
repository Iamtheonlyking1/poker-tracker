// Dumb presentation helpers — no state, no side effects beyond DOM creation.

import { fmtMoney } from './money.js';

export const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
};

export function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtNet(n) {
  if (n === null) return h('span', { class: 'pmeta' }, 'not cashed out');
  if (n === 0) return h('span', { class: 'pmeta' }, 'even');
  const cls = n > 0 ? 'net-win' : 'net-loss';
  return h('span', { class: cls }, (n > 0 ? '+' : '−') + fmtMoney(Math.abs(n)));
}

// net span that the results screen counts up
export function netCount(n) {
  if (n === 0) return h('span', { class: 'pmeta' }, 'even');
  const cls = n > 0 ? 'net-win' : 'net-loss';
  const sign = n > 0 ? '+' : '−';
  return h('span', { class: cls, 'data-count': String(n) }, sign + fmtMoney(Math.abs(n)));
}

// deterministic colored-initials chip for a player name
export function avatar(name, size) {
  const clean = (name || '').trim();
  const initials =
    clean
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = (hash * 31 + clean.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  const style =
    `background:hsl(${hue} 42% 30%);border-color:hsl(${hue} 55% 58%);color:hsl(${hue} 60% 85%)` +
    (size ? `;width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px` : '');
  return h('div', { class: 'avatar', style, 'aria-hidden': 'true' }, initials);
}

export function fmtDuration(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return hh ? `${hh}h ${mm}m` : `${mm}m`;
}
