# 🃏 Poker Night — Buy-in Tracker

Tiny web app for tracking a home poker game in ₹. One phone runs it during the
night; at the end it shows each player's net and the shortest set of payments to
settle up. Share the results with a link or straight to WhatsApp.

No accounts, no backend, no build step. Just static files — hostable free on
GitHub Pages. Installable as a phone app (works offline).

## Use it

1. **Setup** — name the session, pick a **currency** (defaults to ₹ INR; the
   picker searches every ISO-4217 currency by name or code and remembers your
   last choice), set a default buy-in, add players. Everyone starts with one
   buy-in.
2. **Live** — tap `+ ₹500` for a rebuy or enter a custom amount. **Round for
   everyone** adds one buy-in to every player at once. Tap the pencil to rename a
   player, add a late arrival any time. Sticky header shows pot / players / avg
   stack; a pill shows how long you've been playing. **Undo** reverses the last
   change (last 20 actions).
3. **End game → Cash out** — enter each player's ending stack in ₹. A banner
   tracks the difference between chips claimed and money bought in — aim for
   "Pot balanced" (it buzzes when you hit it).
4. **Results** — net ±₹ per player (biggest winner gets a crown), session stats,
   and a plain settlement list like `Rahul pays Ankit ₹1,200`. Buttons: **Share
   to WhatsApp**, **Copy summary**, **Copy link**, **Save to history**.
5. **History** — past games plus a lifetime profit/loss leaderboard (players
   matched by name, case-insensitive).

State autosaves to the browser on every change, so a refresh or phone lock
won't lose the night. Everything lives in that one browser only — clearing site
data wipes it.

### Install on a phone

Open the site, then "Add to Home Screen" (Safari share menu / Chrome menu). It
launches full-screen, no browser chrome, and works with no signal — a service
worker caches the app shell.

## Home hub & poker tools

The app opens to a **Home hub**: "Start / Resume game" plus a grid of tool
tiles. Every tool is a native screen in the same felt-and-gold theme with a
back-to-home header; the live and cash-out screens have a small tools button so
you can peek mid-game (the game autosaves). `toolkit.html` now just redirects
here.

- **BB Calc** — stack ÷ big blind, plus a stack-depth guide
- **Ranges** — 13×13 preflop opening grid by table size, position, stack depth
- **Action** — rules-based preflop advisor (RFI / vs open / vs 3-bet)
- **Odds & SPR** — pot odds, equity (rule of 2/4), EV, outs table, SPR
- **Range Quiz** — flashcards, score saved locally
- **Equity** — Monte-Carlo hand-vs-range equity (1,500 sims, in-browser)
- **Study** — bet sizing, blockers, MDF/alpha and other concepts
- **My Sessions** — a personal cash-game log ($/hr, ROI, P&L charts) in the
  currency you picked for the game
- **Players** — a saved roster of regulars with a private per-player note
  ("overfolds to 3-bets"). Saved players appear as one-tap chips on the setup
  screen; the note shows on their card during the game.
- **Data** — download a backup of everything (history, sessions, roster,
  settings) to a JSON file, and restore it — replace or merge. The only way to
  move your data to a new phone or recover it after a browser wipe.

Old `ptk_sessions` / `ptk_quiz` localStorage data from the standalone toolkit is
migrated on first load.

### Share links

"Copy link" encodes the whole session into the URL after `#s=`. Anyone who opens
it sees a read-only results screen; they can tap "Open as my session" to pull it
into their own device. Works for ~8 players well within URL length limits.

## Settlement logic

`sum(ending stacks)` should equal `sum(buy-ins)`. If it doesn't, the app shows
the delta and still lets you continue (real games lose chips).

Payments are computed by pairing exact opposite balances first, then greedily
matching the largest debtor to the largest creditor. This yields at most
_n − 1_ transfers and, for realistic home-game numbers, the minimum. True
minimum-transaction settlement is NP-hard, so this is not sold as provably
optimal — but you will not find a shorter list at a kitchen table.

## Develop

```bash
npm test        # settlement unit tests (node --test, no deps)
npm run serve   # python3 -m http.server 8000, open http://localhost:8000
```

| Path | Role |
|------|------|
| `index.html` | single page, loads the module graph + registers the service worker |
| `src/settle.js` | net calc + settlement algorithm (pure, unit-tested) |
| `src/poker.js` | ranges, action advisor, odds/SPR math, MC equity (pure, unit-tested) |
| `src/state.js` | session model, localStorage, undo, currency pref, session log, quiz score |
| `src/money.js` | active-currency formatting + world currency list (`Intl`) |
| `src/share.js` | URL snapshot encode/decode, WhatsApp/plain-text summary |
| `src/ui.js` | presentation helpers (`h`, avatars, formatting) |
| `src/fx.js` | SVG icons, motion, haptics — all gated on `prefers-reduced-motion` |
| `src/charts.js` | tiny canvas P&L charts for the session log |
| `src/tools.js` | the 8 study-tool views + Home hub |
| `src/app.js` | game views + render loop + navigation |
| `manifest.json`, `sw.js`, `icon-*.png` | PWA / offline |
| `tests/*.test.js` | `node --test` suites (settlement + poker logic) |

## Deploy / redeploy (GitHub Pages)

```bash
git add -A && git commit -m "your message"
git push
```

Pages serves `main` at the repo root. Live at
`https://iamtheonlyking1.github.io/poker-tracker/` within a minute of pushing.

**When you change any cached file** (anything in `sw.js`'s `ASSETS` list), bump
the `CACHE` version in `sw.js` (`poker-v2` → `poker-v3`, …) or installed phones
keep serving the old version until the cache is cleared.
