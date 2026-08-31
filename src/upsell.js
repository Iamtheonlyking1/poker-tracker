// Small plan-status + upgrade-prompt bits. Pro isn't purchasable yet (Phase 5
// wires Razorpay) — for now the card explains what it is and points at support.

import { h } from './ui.js';
import * as fx from './fx.js';
import { isPro } from './entitlements.js';

export const PRO_PRICE = '₹349/mo';

export function planBadge() {
  return h('span', { class: 'plan-badge' + (isPro() ? ' pro' : '') }, isPro() ? 'Pro' : 'Free');
}

export function proCard() {
  if (isPro()) {
    return h('div', { class: 'card' },
      h('div', { class: 'pname sm', html: fx.icon('cloud') + 'Pro' }),
      h('div', { class: 'pmeta' }, 'Whole history synced · unlimited shared games · everything unlocked'),
    );
  }
  return h('div', { class: 'card pro-card' },
    h('h2', {}, 'Poker Night Pro'),
    h('ul', { class: 'pro-list' },
      h('li', {}, 'Your whole game history synced — not just the last 10'),
      h('li', {}, 'Unlimited shared games, no 8-seat cap'),
      h('li', {}, 'Hand logging, leagues, full stats & AI review as they land'),
    ),
    h('p', { class: 'muted small' },
      `Planned at ${PRO_PRICE}. Not on sale yet — reply to your sign-in email to get on the early list.`),
  );
}

export function capNotice(text) {
  return h('div', { class: 'banner info cap-notice', html: fx.icon('cloud') + text });
}
