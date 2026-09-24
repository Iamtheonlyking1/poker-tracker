// Small plan-status + upgrade-prompt bits. The actual checkout call
// (src/billing.js) and its loading/error state live with the caller
// (tools.js's Account view) — this module stays presentational.

import { h } from './ui.js';
import * as fx from './fx.js';
import { isPro, current } from './entitlements.js';
import { pricingRows, subscriptionPrice, fmtInr, BEST_VALUE_TERM, LAUNCH_PAYMENTS } from './plans.js';

const fmtDate = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function planBadge() {
  return h('span', { class: 'plan-badge' + (isPro() ? ' pro' : '') }, isPro() ? 'Pro' : 'Free');
}

/**
 * `state`: { busy, err, quote, term, onPickTerm, onUpgrade, onManage }.
 * `quote` is { launchActive, launchEndsAt } from the server, or null while it
 * loads. onPickTerm(term) / onUpgrade() / onManage() are called by the buttons;
 * this module doesn't know how billing.js works, just renders what it's given.
 */
export function proCard(state = {}) {
  const { busy, err, quote, term, onPickTerm, onUpgrade, onManage } = state;
  const ent = current();

  if (isPro()) {
    const endsAt = ent.current_period_end ? new Date(ent.current_period_end) : null;
    const sub = subscriptionPrice(ent.plan_term, ent.price_tier, ent.paid_count);
    const every = sub && (sub.months > 1 ? `every ${sub.months} months` : 'a month');
    return h('div', { class: 'card pro-card' },
      h('div', { class: 'pname sm', html: fx.icon('cloud') + 'Pro' }),
      h('div', { class: 'pmeta' }, 'Whole history synced · unlimited shared games · everything unlocked'),
      sub ? h('div', { class: 'pmeta' }, `${sub.label} plan`) : null,
      sub && sub.launchLeft > 0
        ? h('div', { class: 'banner info' },
            `Launch price — your next renewal is ${fmtInr(sub.launchPrice)}. After that it's the regular ${fmtInr(sub.listPrice)} ${every}.`)
        : null,
      sub && sub.tier === 'launch' && sub.launchLeft === 0
        ? h('div', { class: 'pmeta' }, `Launch price used up — renews at the regular ${fmtInr(sub.listPrice)} ${every}.`)
        : null,
      sub && sub.tier === 'list'
        ? h('div', { class: 'pmeta' }, `${fmtInr(sub.listPrice)} ${every}`)
        : null,
      endsAt ? h('div', { class: 'pmeta' }, `Renews ${fmtDate(endsAt)}`) : null,
      err ? h('div', { class: 'banner warn' }, err) : null,
      onManage
        ? h('button', { class: 'ghost wide', disabled: busy ? 'true' : null, html: busy ? 'Working…' : 'Cancel subscription', onclick: onManage })
        : null,
    );
  }

  const ready = !!quote;
  const rows = ready ? pricingRows(quote.launchActive) : [];
  const picked = rows.find((r) => r.term === term) || rows.find((r) => r.term === BEST_VALUE_TERM) || rows[0];

  const options = h('div', { class: 'plan-grid', role: 'radiogroup', 'aria-label': 'Plan length' },
    ...rows.map((r) =>
      h('button', {
        type: 'button',
        class: 'plan-opt' + (picked && r.term === picked.term ? ' on' : ''),
        role: 'radio',
        'aria-checked': picked && r.term === picked.term ? 'true' : 'false',
        disabled: busy ? 'true' : null,
        onclick: () => onPickTerm && onPickTerm(r.term),
      },
        h('span', { class: 'po-top' },
          h('span', { class: 'po-label' }, r.label),
          r.term === BEST_VALUE_TERM
            ? h('span', { class: 'po-tag' }, 'Best value')
            : r.savePct > 0 ? h('span', { class: 'po-tag soft' }, `Save ${r.savePct}%`) : null,
        ),
        h('span', { class: 'po-price' },
          r.strike ? h('s', { class: 'po-strike' }, fmtInr(r.strike)) : null,
          fmtInr(r.price),
        ),
        h('span', { class: 'po-per' }, `${fmtInr(r.perMonth)}/mo`),
      )));

  return h('div', { class: 'card pro-card' },
    h('h2', {}, 'Poker Night Pro'),
    h('ul', { class: 'pro-list' },
      h('li', {}, 'Your whole game history synced — not just the last 10'),
      h('li', {}, 'Unlimited shared games, no 6-seat cap'),
      h('li', {}, 'Hand logging, leagues, full stats & AI review as they land'),
    ),
    ready ? options : h('p', { class: 'muted small' }, 'Loading prices…'),
    ready
      ? h('p', { class: 'muted small' },
          quote.launchActive
            ? `Launch price${quote.launchEndsAt ? ` until ${fmtDate(new Date(quote.launchEndsAt))}` : ''} — covers your first payment and one renewal (${LAUNCH_PAYMENTS} payments), then the regular price. Cancel anytime.`
            : 'Renews automatically. Cancel anytime.')
      : null,
    err ? h('div', { class: 'banner warn' }, err) : null,
    onUpgrade
      ? h('button', {
          class: 'primary wide',
          disabled: busy || !ready ? 'true' : null,
          html: busy ? 'Opening checkout…' : picked ? `Upgrade to Pro — ${picked.label} · ${fmtInr(picked.price)}` : 'Upgrade to Pro',
          onclick: () => onUpgrade(picked && picked.term),
        })
      : null,
  );
}

export function capNotice(text) {
  return h('div', { class: 'banner info cap-notice', html: fx.icon('cloud') + text });
}

// [label, free, pro] — true/false render as a tick/cross, a string renders
// as-is (for capped features where a bare tick would lose the actual number).
// Keep this list honest to what's actually shipped — the one exception is
// the last row, which is real Pro-roadmap copy already promised on the
// upgrade card above, marked "Coming soon" rather than a tick since it
// isn't built yet.
const FEATURE_ROWS = [
  ['Local play, fully offline', true, true],
  ['Cloud sync history', 'Last 10 games', 'Unlimited'],
  ['Live shared tables at once', '1', 'Unlimited'],
  ['Seats per live table', '6', 'Unlimited'],
  ['Study — charts & advisor', true, true],
  ['Study — quiz & theory', false, true],
  ['Calculators — BB & odds', true, true],
  ['Calculators — equity & ICM', false, true],
  ['My Sessions log', '10 entries', 'Unlimited'],
  ['Hand logging, leagues, AI review', false, 'Coming soon'],
];

function cmpCell(v) {
  if (v === true) return h('span', { class: 'cmp-yes', html: fx.icon('check'), 'aria-label': 'Included' });
  if (v === false) return h('span', { class: 'cmp-no', html: fx.icon('close'), 'aria-label': 'Not included' });
  return h('span', { class: 'cmp-text' }, v);
}

export function planCompare() {
  const t = h('table', { class: 'plan-compare' });
  t.append(h('tr', {}, h('th', {}, 'Feature'), h('th', {}, 'Free'), h('th', {}, 'Pro')));
  FEATURE_ROWS.forEach(([label, free, pro]) => {
    t.append(h('tr', {}, h('td', { class: 'pc-feat' }, label), h('td', {}, cmpCell(free)), h('td', {}, cmpCell(pro))));
  });
  return h('div', { class: 'card' },
    h('h2', {}, 'Free vs Pro'),
    h('div', { class: 'scroll-x' }, t),
  );
}
