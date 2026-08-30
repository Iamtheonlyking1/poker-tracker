// Dependency-free QR Code generator — byte mode, all 40 versions, auto ECC.
// Condensed port of Project Nayuki's QR Code generator (MIT License).
// Exposes qrSvg(text, opts) -> SVG string, and qrMatrix(text, opts) -> boolean[][].

const ECC = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT_BITS = { 0: 1, 1: 0, 2: 3, 3: 2 }; // eccIndex -> format field value

// Per-version, per-ECC error-correction codewords per block.
const ECC_CW_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_ECC_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const PENALTY_N1 = 3, PENALTY_N2 = 3, PENALTY_N3 = 40, PENALTY_N4 = 10;

// ----- Galois field GF(256) arithmetic (primitive polynomial 0x11D) -----

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMul(coef, factor)));
  }
  return result;
}

// ----- capacity helpers -----

function numRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(ver, eccIdx) {
  return (
    Math.floor(numRawDataModules(ver) / 8) -
    ECC_CW_PER_BLOCK[eccIdx][ver] * NUM_ECC_BLOCKS[eccIdx][ver]
  );
}

function alignPositions(ver) {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

// ----- data encoding (byte mode only) -----

function encodeData(text, eccIdx) {
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = 0;
  for (let v = 1; v <= 40; v++) {
    const cap = numDataCodewords(v, eccIdx) * 8;
    const ccBits = v <= 9 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= cap) {
      ver = v;
      break;
    }
  }
  if (ver === 0) return null; // does not fit at this ECC level

  const bits = [];
  const push = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0x4, 4); // byte mode
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);

  const capacity = numDataCodewords(ver, eccIdx) * 8;
  push(0, Math.min(4, capacity - bits.length)); // terminator
  push(0, (8 - (bits.length % 8)) % 8); // byte-align
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);

  const dataCw = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    dataCw.push(b);
  }
  return { ver, codewords: addEccAndInterleave(dataCw, ver, eccIdx) };
}

function addEccAndInterleave(data, ver, eccIdx) {
  const numBlocks = NUM_ECC_BLOCKS[eccIdx][ver];
  const blockEccLen = ECC_CW_PER_BLOCK[eccIdx][ver];
  const rawCw = Math.floor(numRawDataModules(ver) / 8);
  const numShort = numBlocks - (rawCw % numBlocks);
  const shortLen = Math.floor(rawCw / numBlocks);
  const divisor = rsDivisor(blockEccLen);

  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const datLen = shortLen - blockEccLen + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + datLen);
    k += datLen;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }

  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - blockEccLen || j >= numShort) result.push(block[i]);
    });
  }
  return result;
}

// ----- matrix construction -----

function buildMatrix(ver, eccIdx, codewords) {
  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => {
    modules[y][x] = dark;
    isFn[y][x] = true;
  };

  // timing patterns
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // finder patterns + separators
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  // alignment patterns
  const pos = alignPositions(ver);
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      const skipCorner =
        (i === 0 && j === 0) ||
        (i === 0 && j === pos.length - 1) ||
        (i === pos.length - 1 && j === 0);
      if (skipCorner) continue;
      const cx = pos[i], cy = pos[j];
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  // dark module + reserve format areas
  drawFormat(modules, isFn, size, eccIdx, 0);

  // version info (v >= 7)
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vbits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vbits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit);
      set(b, a, bit);
    }
  }

  // place data codewords (zigzag)
  let bit = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let k = 0; k < 2; k++) {
        const x = right - k;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFn[y][x] && bit < total) {
          modules[y][x] = ((codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
          bit++;
        }
      }
    }
  }

  // pick the mask with the lowest penalty
  let bestMask = 0, bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(modules, isFn, size, mask);
    drawFormat(modules, isFn, size, eccIdx, mask);
    const p = penalty(modules, size);
    if (p < bestPenalty) {
      bestPenalty = p;
      bestMask = mask;
    }
    applyMask(modules, isFn, size, mask); // toggle back off
  }
  applyMask(modules, isFn, size, bestMask);
  drawFormat(modules, isFn, size, eccIdx, bestMask);

  return { modules, mask: bestMask, isFn };
}

function drawFormat(modules, isFn, size, eccIdx, mask) {
  const data = (FORMAT_BITS[eccIdx] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const b = (i) => ((bits >>> i) & 1) === 1;
  const set = (x, y, v) => {
    modules[y][x] = v;
    isFn[y][x] = true;
  };
  for (let i = 0; i <= 5; i++) set(8, i, b(i));
  set(8, 7, b(6));
  set(8, 8, b(7));
  set(7, 8, b(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, b(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, b(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, b(i));
  set(8, size - 8, true); // always-dark module
}

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

function applyMask(modules, isFn, size, mask) {
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (!isFn[y][x] && maskFn(mask, x, y)) modules[y][x] = !modules[y][x];
}

// ----- penalty scoring (mask selection) -----

function penalty(modules, size) {
  let result = 0;

  const addHistory = (run, hist) => {
    if (hist[0] === 0) run += size; // light border for the leading run
    hist.pop();
    hist.unshift(run);
  };
  const countPatterns = (hist) => {
    const n = hist[1];
    const core = n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n;
    return (
      (core && hist[0] >= n * 4 && hist[6] >= n ? 1 : 0) +
      (core && hist[6] >= n * 4 && hist[0] >= n ? 1 : 0)
    );
  };
  const terminate = (color, run, hist) => {
    if (color) {
      addHistory(run, hist);
      run = 0;
    }
    run += size; // light border
    addHistory(run, hist);
    return countPatterns(hist);
  };

  // rows
  for (let y = 0; y < size; y++) {
    let color = false, run = 0;
    const hist = [0, 0, 0, 0, 0, 0, 0];
    for (let x = 0; x < size; x++) {
      if (modules[y][x] === color) {
        run++;
        if (run === 5) result += PENALTY_N1;
        else if (run > 5) result++;
      } else {
        addHistory(run, hist);
        if (!color) result += countPatterns(hist) * PENALTY_N3;
        color = modules[y][x];
        run = 1;
      }
    }
    result += terminate(color, run, hist) * PENALTY_N3;
  }
  // columns
  for (let x = 0; x < size; x++) {
    let color = false, run = 0;
    const hist = [0, 0, 0, 0, 0, 0, 0];
    for (let y = 0; y < size; y++) {
      if (modules[y][x] === color) {
        run++;
        if (run === 5) result += PENALTY_N1;
        else if (run > 5) result++;
      } else {
        addHistory(run, hist);
        if (!color) result += countPatterns(hist) * PENALTY_N3;
        color = modules[y][x];
        run = 1;
      }
    }
    result += terminate(color, run, hist) * PENALTY_N3;
  }

  // 2x2 blocks
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1])
        result += PENALTY_N2;
    }

  // dark/light balance
  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark++;
  const totalModules = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - totalModules * 10) / totalModules) - 1;
  result += k * PENALTY_N4;

  return result;
}

// ----- public API -----

function build(text, ecc) {
  const order = ['L', 'M', 'Q', 'H'];
  const start = order.indexOf(ecc) < 0 ? 1 : order.indexOf(ecc);
  // try the requested level, then step down to fit very long strings
  for (let e = start; e >= 0; e--) {
    const enc = encodeData(text, e);
    if (enc) {
      const m = buildMatrix(enc.ver, e, enc.codewords);
      return { ver: enc.ver, eccIdx: e, codewords: enc.codewords, ...m };
    }
  }
  throw new Error('qr: text too long');
}

export function qrMatrix(text, { ecc = 'M' } = {}) {
  return build(text, ecc).modules;
}

// Exposed for tests: full encode state so a round-trip can be verified.
export function qrDebug(text, { ecc = 'M' } = {}) {
  return build(text, ecc);
}

// Exposed for tests: raw Reed–Solomon primitives.
export const _rs = { divisor: rsDivisor, remainder: rsRemainder };

export function qrSvg(text, opts = {}) {
  const { border = 4, dark = '#0b1f16', light = '#ffffff' } = opts;
  const m = build(text, opts.ecc || 'M').modules;
  const size = m.length;
  const dim = size + border * 2;
  let path = '';
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (m[y][x]) path += `M${x + border} ${y + border}h1v1h-1z`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${dim}" height="${dim}" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/></svg>`
  );
}
