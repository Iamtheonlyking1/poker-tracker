# 🃏 Poker Night — Buy-in Tracker

Tiny web app for tracking a home poker game in ₹. One phone runs it during the
night; at the end it shows each player's net and the shortest set of payments to
settle up. Share the results with a link or straight to WhatsApp.

No accounts, no backend, no build step. Just static files — hostable free on
GitHub Pages.

## Use it

1. **Setup** — name the session, pick a default buy-in (₹100 / 200 / 500 / 1000
   or custom), add players. Everyone starts with one buy-in.
2. **Live** — tap `+ ₹500` for a rebuy, or `Add` a custom amount. A late arrival
   can be added any time. Sticky header shows pot size, player count, average
   stack. **Undo** reverses the last change (last 20 actions).
3. **End game → Cash out** — enter each player's ending stack in ₹. A banner
   tracks the difference between chips claimed and money bought in — aim for
   "Pot balanced".
4. **Results** — net ±₹ per player and a plain list like
   `Rahul pays Ankit ₹1,200`. Buttons: **Share to WhatsApp**, **Copy summary**,
   **Copy link**, **Save to history**.
5. **History** — past games plus a lifetime profit/loss leaderboard (players
   matched by name, case-insensitive).

State autosaves to the browser on every change, so a refresh or phone lock
won't lose the night. Everything lives in that one browser only — clearing site
data wipes it.

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

Files:

| Path | Role |
|------|------|
| `index.html` | single page, loads the module graph |
| `src/settle.js` | net calc + settlement algorithm (pure, unit-tested) |
| `src/state.js` | session model, localStorage, undo stack |
| `src/share.js` | URL snapshot encode/decode, WhatsApp/plain-text summary |
| `src/app.js` | views + event wiring |
| `tests/settle.test.js` | `node --test` suite |

## Deploy / redeploy (GitHub Pages)

```bash
git add -A && git commit -m "your message"
git push
```

Pages serves `main` at the repo root. Live at
`https://iamtheonlyking1.github.io/poker-tracker/` within a minute of pushing.
