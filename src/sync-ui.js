// The little sync-status pill shown on the Home hub when signed in.

import { h } from './ui.js';

const LABEL = {
  syncing: 'Syncing…',
  synced: 'Synced',
  offline: 'Offline',
  error: 'Sync issue',
};

export function syncPill(status) {
  if (!status || status === 'off') return null;
  return h(
    'span',
    { class: 'sync-pill sp-' + status, title: LABEL[status] || status, role: 'status' },
    h('span', { class: 'sp-dot' }),
    h('span', { class: 'sp-txt' }, LABEL[status] || status),
  );
}
