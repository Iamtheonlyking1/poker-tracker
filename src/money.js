// Active-currency money formatting + world currency list.
// Amounts are always integers (whole chips). No decimals anywhere.

const POPULAR = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'JPY', 'SGD', 'CNY', 'CHF', 'ZAR'];

// Used only when Intl.supportedValuesOf('currency') is unavailable (very old engines).
const FALLBACK_CODES = [
  'AED', 'AFN', 'ALL', 'AMD', 'ARS', 'AUD', 'AZN', 'BDT', 'BGN', 'BHD', 'BND', 'BRL', 'BWP', 'CAD',
  'CHF', 'CLP', 'CNY', 'COP', 'CZK', 'DKK', 'EGP', 'EUR', 'GBP', 'GEL', 'GHS', 'HKD', 'HUF', 'IDR',
  'ILS', 'INR', 'IQD', 'IRR', 'ISK', 'JOD', 'JPY', 'KES', 'KRW', 'KWD', 'KZT', 'LKR', 'MAD', 'MMK',
  'MXN', 'MYR', 'NGN', 'NOK', 'NPR', 'NZD', 'OMR', 'PHP', 'PKR', 'PLN', 'QAR', 'RON', 'RSD', 'RUB',
  'SAR', 'SEK', 'SGD', 'THB', 'TND', 'TRY', 'TWD', 'TZS', 'UAH', 'UGX', 'USD', 'UZS', 'VND', 'ZAR',
];

// 'en-IN' gives Indian digit grouping for ₹ (1,20,000); 'en' keeps familiar
// currency symbols ($, ¥, €, £) rather than locale-prefixed ones (US$, JP¥).
const localeFor = (code) => (code === 'INR' ? 'en-IN' : 'en');

function makeFmt(code) {
  try {
    return new Intl.NumberFormat(localeFor(code), { style: 'currency', currency: code, maximumFractionDigits: 0 });
  } catch (e) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  }
}

let _code = 'INR';
let _fmt = makeFmt('INR');

export function setCurrency(code) {
  _code = code && /^[A-Z]{3}$/.test(code) ? code : 'INR';
  _fmt = makeFmt(_code);
}

export function currencyCode() {
  return _code;
}

export function fmtMoney(n) {
  return _fmt.format(Math.round(n || 0));
}

export function currencySymbol(code) {
  try {
    const parts = new Intl.NumberFormat(localeFor(code), {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
    }).formatToParts(0);
    const sym = parts.find((p) => p.type === 'currency');
    return sym ? sym.value : code;
  } catch (e) {
    return code;
  }
}

export function currencyName(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) || code;
  } catch (e) {
    return code;
  }
}

let _cache = null;

/** All world currencies: [{ code, name, symbol }], popular ones first. */
export function allCurrencies() {
  if (_cache) return _cache;
  let codes;
  try {
    codes = Intl.supportedValuesOf('currency');
  } catch (e) {
    codes = null;
  }
  if (!codes || !codes.length) codes = FALLBACK_CODES;

  const rest = codes
    .filter((c) => !POPULAR.includes(c))
    .map((code) => ({ code, name: currencyName(code), symbol: currencySymbol(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const top = POPULAR.filter((c) => codes.includes(c)).map((code) => ({
    code,
    name: currencyName(code),
    symbol: currencySymbol(code),
    popular: true,
  }));

  _cache = [...top, ...rest];
  return _cache;
}
