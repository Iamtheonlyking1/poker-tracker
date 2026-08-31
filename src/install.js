// "Add to Home Screen" nudge. Chrome/Android/desktop get the real install
// prompt; iOS Safari gets a short walkthrough (Apple has no prompt API).
// Dismissible, and it does not nag — hidden once installed, and only re-shown
// after a couple of weeks if dismissed.

import { getRaw, setRaw } from './store.js';
import { h } from './ui.js';
import * as fx from './fx.js';

const DISMISS_KEY = 'poker.install.dismissed';
const RESHOW_MS = 14 * 24 * 60 * 60 * 1000;

let deferredPrompt = null;
let installed = false;

export function initInstall() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    setRaw(DISMISS_KEY, 'installed');
  });
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true
  );
}

export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iPhoneish = /iphone|ipad|ipod/i.test(ua);
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return iPhoneish || iPadOS;
}

/** Exposed for tests. */
export function shouldShow(now = Date.now()) {
  if (isStandalone() || installed) return false;
  const v = getRaw(DISMISS_KEY);
  if (v === 'installed') return false;
  if (v) {
    const t = Number(v);
    if (Number.isFinite(t) && now - t < RESHOW_MS) return false;
  }
  // something to offer? real prompt, or an iOS device we can walk through
  return !!deferredPrompt || isIOS();
}

function snooze() {
  setRaw(DISMISS_KEY, String(Date.now()));
}

/**
 * Home-hub banner, or null when we shouldn't nag.
 * `onGuide` is called on iOS (no prompt API) to open the walkthrough sheet.
 */
export function installBanner(onGuide) {
  if (!shouldShow()) return null;

  const banner = h('div', { class: 'install-banner' },
    h('span', { class: 'ib-ic', html: fx.icon('home') }),
    h('div', { class: 'ib-text' },
      h('div', { class: 'ib-title' }, 'Add to your home screen'),
      h('div', { class: 'ib-sub' }, 'Full-screen · works offline'),
    ),
    h('button', {
      class: 'primary sm ib-cta',
      html: fx.icon('download') + 'Install',
      onclick: async (e) => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          let outcome = 'dismissed';
          try {
            ({ outcome } = await deferredPrompt.userChoice);
          } catch (err) {
            /* ignore */
          }
          deferredPrompt = null;
          e.currentTarget.closest('.install-banner').remove();
          if (outcome !== 'accepted') snooze();
        } else if (typeof onGuide === 'function') {
          snooze();
          e.currentTarget.closest('.install-banner').remove();
          onGuide();
        }
      },
    }),
    h('button', {
      class: 'ib-x',
      'aria-label': 'Not now',
      html: fx.icon('close'),
      onclick: (e) => {
        snooze();
        e.currentTarget.closest('.install-banner').remove();
      },
    }),
  );
  return banner;
}

/** Body nodes for the iOS "Add to Home Screen" sheet (pass to openSheet). */
export function installGuideNodes() {
  return [
    h('ol', { class: 'ios-steps' },
      h('li', {},
        'Tap the ', h('b', {}, 'Share'), ' button ',
        h('span', { class: 'ios-share-glyph', html: fx.icon('share') }),
        ' in the Safari toolbar.',
      ),
      h('li', {}, 'Scroll down and tap ', h('b', {}, 'Add to Home Screen'), '.'),
      h('li', {}, 'Tap ', h('b', {}, 'Add'), ' — it lands on your home screen like any app.'),
    ),
    h('p', { class: 'muted small' },
      'It then runs full-screen and offline, and keeps your games even with no signal.'),
  ];
}
