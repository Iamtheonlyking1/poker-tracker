import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrSvg, qrMatrix, qrDebug, _rs } from '../src/qr.js';

test('qr — Reed–Solomon matches the QR spec Annex example (v1-M, "01234567")', () => {
  const data = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17];
  const ecc = _rs.remainder(data, _rs.divisor(10));
  assert.deepEqual(ecc, [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
});

// Re-derive the mask functions here so the test can strip the mask and read
// the raw data region back out — a full layout + mask + interleave round-trip.
function maskFn(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return false;
  }
}

function readCodewords({ modules, isFn, mask, codewords }) {
  const size = modules.length;
  const m = modules.map((row) => row.slice());
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (!isFn[y][x] && maskFn(mask, x, y)) m[y][x] = !m[y][x];

  const bits = [];
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let k = 0; k < 2; k++) {
        const cx = right - k;
        const upward = ((right + 1) & 2) === 0;
        const cy = upward ? size - 1 - vert : vert;
        if (!isFn[cy][cx] && bits.length < total) bits.push(m[cy][cx] ? 1 : 0);
      }
    }
  }
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    out.push(b);
  }
  return out;
}

test('qr — matrix size tracks version and has the three finder patterns', () => {
  const m = qrMatrix('hello', { ecc: 'M' });
  assert.equal(m.length, m[0].length);
  assert.equal((m.length - 17) % 4, 0);
  const finderAt = (ox, oy) => {
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++) {
        const ring = x === 0 || x === 6 || y === 0 || y === 6;
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        if ((ring || core) !== m[oy + y][ox + x]) return false;
      }
    return true;
  };
  assert.ok(finderAt(0, 0), 'top-left finder');
  assert.ok(finderAt(m.length - 7, 0), 'top-right finder');
  assert.ok(finderAt(0, m.length - 7), 'bottom-left finder');
});

test('qr — timing pattern alternates', () => {
  const m = qrMatrix('poker night', { ecc: 'Q' });
  for (let i = 8; i < m.length - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0);
    assert.equal(m[i][6], i % 2 === 0);
  }
});

test('qr — data region round-trips through layout, mask and interleave', () => {
  for (const s of ['a', 'https://iamtheonlyking1.github.io/poker-tracker/#s=AbCdEf', 'x'.repeat(300)]) {
    const dbg = qrDebug(s, { ecc: 'M' });
    assert.deepEqual(readCodewords(dbg), dbg.codewords);
  }
});

test('qr — long share links step down to a lower ECC level rather than throw', () => {
  const huge = 'https://iamtheonlyking1.github.io/poker-tracker/#s=' + 'Q'.repeat(2500);
  assert.doesNotThrow(() => qrSvg(huge));
});

test('qr — svg is well formed and scales with the code', () => {
  const svg = qrSvg('table stakes', { ecc: 'M', border: 4 });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<path d="M/);
  const vb = svg.match(/viewBox="0 0 (\d+) \1"/);
  assert.ok(vb, 'square viewBox');
  assert.equal(Number(vb[1]), qrMatrix('table stakes', { ecc: 'M' }).length + 8);
});
