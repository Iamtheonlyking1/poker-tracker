// Visual effects + inline SVG icons. All motion respects prefers-reduced-motion.

export const reduceMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// light haptic tap; pattern in ms or array. no-op where unsupported.
export function haptic(pattern = 12) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (e) {
    /* unsupported */
  }
}

// ---------- inline icons (stroke, 24x24, currentColor) ----------

const P = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10H9"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  forward: '<path d="M9 6l6 6-6 6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  share:
    '<path d="M4 12v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/>',
  trophy:
    '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a4 4 0 0 1-4 4M7 5H4v2a4 4 0 0 0 4 4"/>',
  spade:
    '<path d="M12 3c3 4 7 6 7 10a4 4 0 0 1-6.5 3.1c.2 1.4.6 2.4 1.5 3.4h-4c.9-1 1.3-2 1.5-3.4A4 4 0 0 1 5 13c0-4 4-6 7-10z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-1.5 11h-15z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users:
    '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3.2 2.8-5.2 5.5-5.2s5.5 2 5.5 5.2"/><path d="M16.5 5.5a3.2 3.2 0 0 1 0 6"/><path d="M18.5 20c0-2.3-1-4-2.6-4.9"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  calc: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h2M8 15h2M14 11h2M14 15h2M11 18h2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  percent: '<path d="M19 5L5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.3"/><circle cx="15.5" cy="15.5" r="1.3"/><circle cx="12" cy="12" r="1.3"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 0 2 2h13"/>',
  ledger: '<path d="M6 3h11l3 3v15H6z"/><path d="M9 8h8M9 12h8M9 16h5"/>',
  graph: '<path d="M4 19V5M4 19h16"/><path d="M8 15l3-4 3 2 4-6"/>',
  scale: '<path d="M12 3v18M6 21h12M4 8l4-4 4 4M4 8a4 4 0 0 0 8 0M12 8l4-4 4 4M12 8a4 4 0 0 0 8 0"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  pause: '<rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  download: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  upload: '<path d="M12 21V9"/><path d="M7 13l5-5 5 5"/><path d="M4 4h16"/>',
  database:
    '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/>',
  qr: '<path d="M4 4h5v5H4zM15 4h5v5h-5zM4 15h5v5H4z"/><path d="M15 15h2v2h-2zM19 15v.01M15 19v.01M19 19v2h.01M19 19h-1.5"/>',
  volume:
    '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a3 3 0 0 1 0 6"/><path d="M18.5 7a6 6 0 0 1 0 10"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  cloud:
    '<path d="M7 18a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.6-1.5A3.75 3.75 0 0 1 18 18z"/>',
  logout: '<path d="M15 12H3"/><path d="M8 7l-5 5 5 5"/><path d="M14 4h6v16h-6"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// ---------- press ripple ----------

function addRipple(e) {
  const btn = e.currentTarget;
  if (reduceMotion()) return;
  const r = document.createElement('span');
  r.className = 'ripple';
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const x = (e.clientX ?? rect.left + rect.width / 2) - rect.left;
  const y = (e.clientY ?? rect.top + rect.height / 2) - rect.top;
  r.style.width = r.style.height = size + 'px';
  r.style.left = x - size / 2 + 'px';
  r.style.top = y - size / 2 + 'px';
  btn.appendChild(r);
  setTimeout(() => r.remove(), 620);
}

export function attachRipples(root) {
  root.querySelectorAll('button').forEach((b) => {
    if (b.dataset.rip) return;
    b.dataset.rip = '1';
    b.addEventListener('pointerdown', addRipple);
  });
}

// ---------- staggered entrance ----------

export function staggerIn(root) {
  if (reduceMotion()) return;
  const items = root.querySelectorAll('.card, .settle-line, .lb-row');
  items.forEach((el, i) => {
    if (typeof el.animate !== 'function') return;
    el.animate(
      [
        { opacity: 0, transform: 'translateY(10px) scale(0.99)' },
        { opacity: 1, transform: 'none' },
      ],
      {
        duration: 320,
        delay: Math.min(i, 12) * 34,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'backwards',
      },
    );
  });
}

// ---------- number pop ----------

export function pop(el) {
  if (!el || reduceMotion()) return;
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

// ---------- floating +amount ----------

export function floatUp(rect, text) {
  if (!rect || reduceMotion()) return;
  const f = document.createElement('div');
  f.className = 'floatup';
  f.textContent = text;
  f.style.left = rect.left + rect.width / 2 + 'px';
  f.style.top = rect.top + 'px';
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 900);
}

// ---------- count-up tween ----------

export function countUp(el, to, format) {
  const fmt = format || ((n) => String(Math.round(n)));
  if (reduceMotion()) {
    el.textContent = fmt(to);
    return;
  }
  const dur = 650;
  const start = performance.now();
  const from = 0;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------- confetti (suit glyphs) ----------

export function celebrate() {
  if (reduceMotion()) return;
  const suits = ['♠', '♥', '♦', '♣'];
  const wrap = document.createElement('div');
  wrap.className = 'confetti';
  document.body.appendChild(wrap);
  for (let i = 0; i < 28; i++) {
    const s = document.createElement('span');
    s.textContent = suits[i % 4];
    s.style.left = Math.random() * 92 + 4 + 'vw';
    s.style.animationDelay = Math.random() * 250 + 'ms';
    s.style.animationDuration = 1400 + Math.random() * 900 + 'ms';
    s.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
    s.style.setProperty('--drift', (Math.random() * 120 - 60) + 'px');
    if (i % 2) s.classList.add('red');
    wrap.appendChild(s);
  }
  setTimeout(() => wrap.remove(), 2600);
}

// ---------- view transition wrapper ----------

export function withTransition(fn) {
  if (reduceMotion() || !document.startViewTransition) {
    fn();
    return;
  }
  document.startViewTransition(fn);
}
