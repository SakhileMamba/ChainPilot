# ChainPilot

A paid Windows app that plays a compounding plan on Aviator at mulasport.com,
with a control panel, a strategy explainer, MTN MoMo subscriptions, and a website
on GitHub Pages.

| Part | Where | What it is |
| --- | --- | --- |
| Windows app | `desktop/`, `src/`, `installer/` | Control panel (plan settings, live session, "How compounding works", subscription, help) plus the bot, packaged as a per-user installer |
| License server | `server/` | Cloudflare Worker: MoMo "Request to Pay", then a signed license key bound to the customer's PC |
| Website | `site/` | Landing page, strategy guide with the interactive explainer, download, subscribe, user guide, legal pages |
| Pipelines | `.github/workflows/` | Tests, the Windows installer (smoke-tested on real Windows), GitHub releases, Pages deployment |

**Setting up and running the business: [docs/SELLER-GUIDE.md](docs/SELLER-GUIDE.md).**

## Development

Needs Node.js 20.10+ and Google Chrome (or Microsoft Edge).

```sh
npm install
npm start            # the desktop app: opens the control panel in its own window
npm test
npm run site         # build and preview the website at http://127.0.0.1:8080
npm run build:win    # Windows installer in dist/windows (needs makensis: brew install makensis)
npm run video        # the narrated, annotated video tutorial for the website (needs ffmpeg)
npm run dev:api      # local license server with a pretend MoMo, for trying subscriptions
```

The app keeps its data (settings, license, logs, the game window's browser profile)
in `%LOCALAPPDATA%\ChainPilot` on Windows and `~/Library/Application Support/ChainPilot`
on macOS. Set `CHAINPILOT_DATA_DIR` to use another folder.

## Command-line bot

The original command-line bot is still here for development and your own use. It
isn't part of the installer.

Plays Aviator in a Chrome window with Playwright:

- Bets your initial stake with the game's own **Auto Cash Out** set to your multiplier
  (default 1.90x). The game's server cashes out at exactly that multiplier, so there is
  no click delay.
- After a win, the next bet is the **whole payout**. After `--steps` wins in a row the
  chain is complete.
- After **any loss**, it goes back to the initial stake at step 1.
- Optional random gaps: after each bet it waits a random 1 to k rounds (`--max-gap k`).
  `--max-gap 1` bets every round.
- It stops after `--chains` completed chains (default 1), before the session's net loss
  could pass `--max-loss` (default 10 x the bet), or when you press Ctrl+C.

It starts as a **dry run**: it watches real rounds and paper-trades. Add `--live` to
place real bets.

```sh
# 1. See how a plan plays out over many sessions (offline, no browser, no money)
node aviator-bot.js --bet 10 --steps 5 --simulate 10000

# 2. Dry run on the real game: no bets
node aviator-bot.js --bet 1 --steps 19 --cashout 1.9 --max-gap 10

# 3. Real bets
node aviator-bot.js --bet 1 --steps 19 --cashout 1.9 --max-gap 15 --live
```

A Chrome window opens on Aviator at mulasport.com
(`https://www.mulasport.com/?gameID=aviator-spribe&mode=real`). The first time, log in
there; the login is kept in `.browser-profile/` for later runs. If the game isn't showing,
open Aviator from the site's menu in that window; the bot finds the game by itself.

To use Playwright's own Chromium instead of Chrome, run `npx playwright-core install chromium`
and pass `--browser chromium`; `--browser msedge` uses Microsoft Edge.

To watch the bot work with play money first, try mulasport's practice mode:

```sh
node aviator-bot.js --bet 1 --steps 19 --live --url "https://www.mulasport.com/?gameID=aviator-spribe&mode=demo"
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--bet <amount>` | initial stake | required |
| `--steps <n>` | wins in a row that complete a chain | required |
| `--cashout <x>` | cash-out multiplier (1.01 to 100) | 1.9 |
| `--max-gap <k>` | wait a random 1 to k rounds between bets (1 = every round) | 1 |
| `--chains <c>` | stop after c completed chains (0 = never) | 1 |
| `--max-loss <amount>` | stop before the net loss could go past this | 10 x bet |
| `--live` | place real bets | off (dry run) |
| `--simulate <runs>` | offline simulation of that many sessions | |
| `--rtp <percent>` | return to player assumed by `--simulate` | 97 |
| `--url <url>` | page to open | `https://www.mulasport.com/?gameID=aviator-spribe&mode=real` |
| `--browser <name>` | `chrome`, `msedge` or `chromium` | chrome |
| `--profile <dir>` | browser profile folder | `.browser-profile` |

### While it runs

- **Leave the first (left) bet panel alone.** The bot switches it to the Auto tab, turns
  Auto Bet off and Auto Cash Out on, and types each stake. Don't bet with the second
  panel either: its cash-out messages look the same as the bot's.
- **Out of money?** The bot pauses and tells you. Deposit, even if that means leaving
  the game page (come back to Aviator afterwards). It carries on by itself once the game
  shows enough balance. If the game's balance hasn't updated, press **Enter** in the
  terminal to try again; the game refuses the bet if the money isn't there yet.
- **Ctrl+C once** stops after any bet in the air has settled. **Twice** quits at once;
  an open bet still cashes out at your multiplier, because that happens on the game's
  server.
- Every bet is written to `logs/<live|dry-run>-<time>.csv`.

### How it reads the game

mulasport.com loads this Aviator from `games.phoenixbet.io` (provider "Fun Games Live"),
not from Spribe's servers. Its page is not the same as Spribe's, so the selectors in
`SEL` at the top of `src/game.js` were taken from that build's code. If the game is
updated and the bot stops finding things, that is the place to fix (installed apps can
also get selector fixes from the website; see the seller guide).

The bot only presses **Bet** when the panel shows the expected stake and Auto Cash Out
is on at your multiplier. It decides each bet from what the page shows:

1. the panel going back to "Bet" while the plane is still flying (cashed out),
2. the "You have cashed out!" message,
3. the crash point compared with your multiplier,
4. the change in balance.

If none of these settle it (for example, the game reloaded mid-bet), it counts the bet
as lost and starts the chain again. It never bets more than the game actually paid out.
If Auto Cash Out ever fails to fire, it presses Cash out itself just past your multiplier.

### Odds

The casino lists this game at 97% RTP. At that rate:

- A 1.90x cash-out wins 0.97 / 1.9 = 51.1% of the time.
- A chain of n reinvested bets succeeds 0.511^n of the time. On average it returns
  0.97^n of its stake; for n = 5 that is 3.5% and 86%.
- Steps, cash-out and gaps change how results are spread, not the average: every bet
  loses 3% of its stake on average.

The 97% is the casino's own label for a third-party build, not an audited figure.
`--simulate` shows what that means in money for your settings.

Most casinos' terms forbid automated play, and accounts using bots can be restricted.
