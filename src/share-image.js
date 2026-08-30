// Renders a results card to a PNG. Pure: the caller passes a normalized object,
// this module only draws. Works for cash games and tournaments.
//
// data = {
//   title, dateMs, subtitle,
//   nets:      [{ name, net }],            // net > 0 win, < 0 loss
//   transfers: [{ from, to, amount }],
//   kitty:     { label, lines: [{ name, amount }] } | null,
//   fmt:       (n) => string,              // money formatter (already currency-bound)
// }

const W = 1080;
const PAD = 72;
const FELT = '#0c2a1c';
const FELT_EDGE = '#061009';
const GOLD = '#e7bd5c';
const TEXT = '#f3efe2';
const MUTED = 'rgba(243,239,226,0.6)';
const WIN = '#4ce08a';
const LOSS = '#ff6b6b';
const LINE = 'rgba(231,189,92,0.22)';

const DISPLAY = '"Fraunces", "Georgia", serif';
const BODY = '-apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

function measureHeight(data) {
  let h = PAD + 46 + 96 + 44; // brand + title + subtitle
  h += 40 + data.nets.length * 64 + 40; // Net section
  if (data.kitty && data.kitty.lines.length) h += 64 + data.kitty.lines.length * 48 + 24;
  h += 40 + Math.max(1, data.transfers.length) * 60 + 40; // Settle section
  h += 96; // footer
  return Math.ceil(h);
}

async function ensureFont() {
  try {
    if (document.fonts && document.fonts.load) {
      await Promise.race([
        Promise.all([
          document.fonts.load('600 84px "Fraunces"'),
          document.fonts.load('600 34px "Fraunces"'),
        ]),
        new Promise((r) => setTimeout(r, 1200)),
      ]);
    }
  } catch (e) {
    /* fall back to Georgia */
  }
}

export async function resultsImageBlob(data) {
  await ensureFont();
  const H = measureHeight(data);
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';

  // felt background
  const g = ctx.createRadialGradient(W / 2, -H * 0.1, W * 0.1, W / 2, -H * 0.1, H * 1.2);
  g.addColorStop(0, FELT);
  g.addColorStop(0.55, FELT_EDGE);
  g.addColorStop(1, '#08130d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // spade watermark
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = GOLD;
  ctx.font = `${W * 0.9}px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.fillText('♠', W / 2, H * 0.92);
  ctx.restore();

  let y = PAD;
  ctx.textAlign = 'left';

  // brand
  ctx.fillStyle = GOLD;
  ctx.font = `600 30px ${BODY}`;
  ctx.fillText('♠  POKER NIGHT', PAD, y + 24);
  y += 64;

  // title
  ctx.fillStyle = TEXT;
  ctx.font = `600 84px ${DISPLAY}`;
  y += 70;
  ctx.fillText(clip(ctx, data.title || 'Game', W - PAD * 2), PAD, y);
  y += 30;

  // subtitle
  ctx.fillStyle = MUTED;
  ctx.font = `400 30px ${BODY}`;
  const date = new Date(data.dateMs || Date.now()).toLocaleDateString('en-IN', { dateStyle: 'long' });
  ctx.fillText([date, data.subtitle].filter(Boolean).join('   ·   '), PAD, y + 24);
  y += 64;

  y = section(ctx, 'NET', y);
  const sorted = data.nets.slice().sort((a, b) => b.net - a.net);
  for (const r of sorted) {
    ctx.fillStyle = TEXT;
    ctx.font = `500 36px ${BODY}`;
    ctx.textAlign = 'left';
    ctx.fillText(clip(ctx, r.name, W * 0.6), PAD, y + 34);
    ctx.textAlign = 'right';
    ctx.font = `600 38px ${BODY}`;
    ctx.fillStyle = r.net > 0 ? WIN : r.net < 0 ? LOSS : MUTED;
    const s = r.net === 0 ? 'even' : (r.net > 0 ? '+' : '−') + data.fmt(Math.abs(r.net));
    ctx.fillText(s, W - PAD, y + 34);
    y += 64;
  }
  y += 24;

  if (data.kitty && data.kitty.lines.length) {
    y = section(ctx, 'KITTY' + (data.kitty.label ? '  ·  ' + data.kitty.label.toUpperCase() : ''), y);
    for (const l of data.kitty.lines) {
      ctx.fillStyle = TEXT;
      ctx.font = `400 32px ${BODY}`;
      ctx.textAlign = 'left';
      ctx.fillText(clip(ctx, l.name, W * 0.6), PAD, y + 30);
      ctx.textAlign = 'right';
      ctx.fillText(data.fmt(l.amount), W - PAD, y + 30);
      y += 48;
    }
    y += 24;
  }

  y = section(ctx, 'SETTLE UP', y);
  ctx.textAlign = 'left';
  if (!data.transfers.length) {
    ctx.fillStyle = WIN;
    ctx.font = `500 34px ${BODY}`;
    ctx.fillText('Everyone square. Nothing to pay.', PAD, y + 32);
    y += 60;
  } else {
    for (const t of data.transfers) {
      ctx.fillStyle = TEXT;
      ctx.font = `400 34px ${BODY}`;
      ctx.fillText(clip(ctx, t.from, W * 0.32), PAD, y + 32);
      ctx.fillStyle = GOLD;
      ctx.fillText('→', PAD + W * 0.34, y + 32);
      ctx.fillStyle = TEXT;
      ctx.fillText(clip(ctx, t.to, W * 0.3), PAD + W * 0.4, y + 32);
      ctx.textAlign = 'right';
      ctx.font = `600 34px ${BODY}`;
      ctx.fillText(data.fmt(t.amount), W - PAD, y + 32);
      ctx.textAlign = 'left';
      y += 60;
    }
  }
  y += 30;

  // footer
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  ctx.fillStyle = MUTED;
  ctx.font = `400 26px ${BODY}`;
  ctx.fillText('Tracked with Poker Night', PAD, y + 44);
  ctx.textAlign = 'right';
  ctx.fillText('iamtheonlyking1.github.io/poker-tracker', W - PAD, y + 44);

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

export async function resultsImageFile(data, name) {
  const blob = await resultsImageBlob(data);
  return new File([blob], name || 'poker-night.png', { type: 'image/png' });
}

function section(ctx, label, y) {
  ctx.fillStyle = LINE;
  ctx.fillRect(PAD, y, W - PAD * 2, 2);
  ctx.fillStyle = GOLD;
  ctx.font = `600 26px ${BODY}`;
  ctx.textAlign = 'left';
  ctx.fillText(label, PAD, y + 36);
  return y + 62;
}

function clip(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
