// Small plan-status + upgrade-prompt bits. The actual checkout call
// (src/billing.js) and its loading/error state live with the caller
// (tools.js's Account view) — this module stays presentational.

import { h } from './ui.js';
import * as fx from './fx.js';
import { isPro, current } from './entitlements.js';

export const PRO_PRICE = '₹300/mo';
export const PRO_PRICE_ORIGINAL = '₹499/mo';
export const PRO_DISCOUNT_LABEL = '40% off launch price';

export function planBadge() {
  return h('span', { class: 'plan-badge' + (isPro() ? ' pro' : '') }, isPro() ? 'Pro' : 'Free');
}

/**
 * `state`: { busy, err, onUpgrade, onManage }. onUpgrade/onManage are called
 * with no args; this module doesn't know how billing.js works, just renders
 * whatever state the caller hands it.
 */
export function proCard(state = {}) {
  const { busy, err, onUpgrade, onManage } = state;
  const ent = current();

  if (isPro()) {
    const endsAt = ent.current_period_end ? new Date(ent.current_period_end) : null;
    return h('div', { class: 'card pro-card' },
      h('div', { class: 'pname sm', html: fx.icon('cloud') + 'Pro' }),
      h('div', { class: 'pmeta' }, 'Whole history synced · unlimited shared games · everything unlocked'),
      endsAt
        ? h('div', { class: 'pmeta' }, `Renews ${endsAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`)
        : null,
      err ? h('div', { class: 'banner warn' }, err) : null,
      onManage
        ? h('button', { class: 'ghost wide', disabled: busy ? 'true' : null, html: busy ? 'Working…' : 'Cancel subscription', onclick: onManage })
        : null,
    );
  }

  return h('div', { class: 'card pro-card' },
    h('h2', {}, 'Poker Night Pro'),
    h('ul', { class: 'pro-list' },
      h('li', {}, 'Your whole game history synced — not just the last 10'),
      h('li', {}, 'Unlimited shared games, no 8-seat cap'),
      h('li', {}, 'Hand logging, leagues, full stats & AI review as they land'),
    ),
    h('p', { class: 'muted small', html: `<s>${PRO_PRICE_ORIGINAL}</s> ${PRO_PRICE} · ${PRO_DISCOUNT_LABEL} · cancel anytime` }),
    err ? h('div', { class: 'banner warn' }, err) : null,
    onUpgrade
      ? h('button', { class: 'primary wide', disabled: busy ? 'true' : null, html: busy ? 'Opening checkout…' : `Upgrade to Pro — ${PRO_PRICE}`, onclick: onUpgrade })
      : null,
  );
}

export function capNotice(text) {
  return h('div', { class: 'banner info cap-notice', html: fx.icon('cloud') + text });
}
