# ChainPilot seller guide

How to set up, sell, support and update ChainPilot. Everything customers see is
on GitHub (website, downloads, updates). Payments go through a small Cloudflare
Worker, because MTN MoMo needs secret keys that a static site can't hold.

```
 Customer's Windows PC                 GitHub Pages                      Cloudflare Worker (server/)
 ┌───────────────────────────┐        ┌──────────────────────────┐      ┌──────────────────────────────┐
 │ ChainPilot app            │ fetch  │ website, strategy guide   │      │ POST /v1/orders  → MoMo       │
 │  control panel (desktop/) ├───────►│ downloads/ (installer)    │      │   "Request to Pay" prompt    │
 │  bot (src/, Playwright →  │        │ revoked.json              │      │ GET /v1/orders/:id → polls    │
 │  the PC's Chrome or Edge) │        │ selectors.json (signed)   │      │   MoMo, signs a license key  │
 │  license check (offline)  │        └──────────────────────────┘      │ KV: orders, issued licenses  │
 └─────────────┬─────────────┘                                          └──────────────┬───────────────┘
               └──────────── subscribe / restore purchase ─────────────────────────────┘ → MTN MoMo API
```

- **Free:** the simulator, dry run (watch and paper-bet) and practice (the game's play money).
- **Paid:** live betting. A subscription is a license key signed with your private key,
  tied to one PC's machine ID, with an end date. The app checks it offline.
- **Renewals:** paying before a pass ends adds the days to its end.

---

## 1. One-time setup

### 1.1 Your details: `product.config.json`

| Field | What to put |
| --- | --- |
| `name`, `tagline`, `publisher` | Product and seller names. Renaming the product also renames the install folder and data folder. |
| `siteUrl` | `https://<github-user>.github.io/<repo>/` (or your custom domain), with the trailing `/` |
| `apiUrl` | Your Worker's address from step 1.3, e.g. `https://chainpilot-api.<you>.workers.dev` |
| `currency`, `country` | Set for Eswatini (SZL, +268, 8-digit numbers). Change both for another country. |
| `plans` | `id`, `name`, `days` (0 = never expires), `price`. **The prices are placeholders: set your own.** |
| `support.whatsapp`, `support.email` | Shown on the website and in the app. WhatsApp is how most customers will reach you. |
| `manualPayment` | Optional MoMo number and name for customers who can't pay online. Leave empty to hide. |
| `helplines` | Add a local problem-gambling helpline if there is one. |

The app, website and Worker all read this one file, so they can't disagree.
`siteUrl` and `apiUrl` are built into the installer, so set them **before** your first release.

### 1.2 Signing keys (already created)

`keys/license-private.pem` signs every license and `selectors.json`; `src/public-key.js`
is the matching public key, built into the app.

- **Back up `keys/` somewhere safe and private** (password manager, encrypted USB).
  Lose it and you can't issue keys that installed copies accept; leak it and anyone can.
- `keys/` is in `.gitignore`. Never commit it.
- If you'd rather make your own before the first release: `npm run keys -- --force`, then
  rebuild. Never do this after you've sold licenses.

### 1.3 The license server, with your existing MoMo credentials

You need a free Cloudflare account. From the project folder:

```sh
npx wrangler login
npx wrangler kv namespace create DB --config server/wrangler.toml
#   → copy the id it prints into server/wrangler.toml (kv_namespaces → id)
```

Check `[vars]` in `server/wrangler.toml`:

| Variable | Production (Eswatini) | Sandbox (testing) |
| --- | --- | --- |
| `MOMO_BASE_URL` | `https://proxy.momoapi.mtn.com` (or `https://momoapi.momo.africa` once MTN has moved your account to its new platform) | `https://sandbox.momodeveloper.mtn.com` |
| `MOMO_TARGET_ENV` | `mtnswaziland` | `sandbox` |
| `MOMO_CURRENCY` | `SZL` | `EUR` (the only currency the sandbox accepts) |

Use the values your other project uses. Then store the secrets. The credentials must belong to MTN's
**Collections** product, the one that receives payments:

```sh
npx wrangler secret put MOMO_SUBSCRIPTION_KEY --config server/wrangler.toml   # Collections primary key
npx wrangler secret put MOMO_API_USER --config server/wrangler.toml           # API user (new platform: User ID)
npx wrangler secret put MOMO_API_KEY --config server/wrangler.toml            # API key (new platform: Credential Token)
npm run -s keys -- --worker-secret | npx wrangler secret put LICENSE_PRIVATE_KEY --config server/wrangler.toml
openssl rand -hex 24      # copy this admin token somewhere safe, then:
npx wrangler secret put ADMIN_TOKEN --config server/wrangler.toml
npx wrangler deploy --config server/wrangler.toml
```

Put the URL it prints into `apiUrl` in `product.config.json`.

Notes on reusing credentials from another project:
- Payment status is **polled**, not received by callback, so it works whatever callback
  host your MoMo API user is registered with. Nothing changes in MTN's partner portal.
- Money lands in the same MoMo account as your other project. Each payment's note reads
  `ChainPilot <plan> <machine ID>`, so you can tell them apart in statements.
- The new MTN platform requires `X-Target-Environment` on token requests. The Worker always sends it.

Check it works: `curl https://<your-worker>/v1/plans` should list your plans.

### 1.4 GitHub: repository and Pages

```sh
git init && git add -A && git commit -m "ChainPilot 1.0.0"
# create an empty repository on github.com, then:
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The *Website* workflow then publishes the site on every change to `site/` or `product.config.json`.

> GitHub Free only publishes Pages from **public** repositories, and a public repository
> shows your source code. Your private key is never in it (`keys/` is ignored), and the
> app's code ships inside the installer anyway. To keep the repository private, use
> GitHub Pro, which can publish Pages from a private repository.

### 1.5 First release

```sh
git tag v1.0.0 && git push origin v1.0.0
```

The *Release* workflow:
1. runs the tests and builds `ChainPilot-Setup-1.0.0.exe` (Node.js 24 for Windows, checksum-verified);
2. **installs it on a real Windows machine**, runs the app's `--self-test`, and uninstalls it;
3. publishes a GitHub release with the installer and `latest.json`;
4. redeploys the website, which then serves the installer from `downloads/`.

### 1.6 Test the whole journey before you sell

1. Download the installer from your site on a Windows PC and install it (expect SmartScreen: *More info → Run anyway*).
2. Run a dry run and a practice session.
3. Subscribe to your own cheapest plan with a real MoMo number. Approve the prompt and check
   the app switches to *Subscribed* by itself.
4. Look the order up with the admin API (below), and check the money arrived in your MoMo account.
5. Uninstall, reinstall, press *Restore purchase*.

Testing in the sandbox first? Set the sandbox values in step 1.3, deploy, and use MTN's sandbox test
numbers (MTN's sandbox docs list which number gives which result). Remember to switch back and redeploy.

---

## 2. Day to day

### Support lookups

```sh
API=https://chainpilot-api.<you>.workers.dev
TOKEN=<your admin token>
curl -H "Authorization: Bearer $TOKEN" "$API/v1/admin/orders?phone=76123456"             # by MoMo number
curl -H "Authorization: Bearer $TOKEN" "$API/v1/admin/orders?machine=7F3K-9QXA-2M8D-H4PZ"
curl -H "Authorization: Bearer $TOKEN" "$API/v1/admin/orders/<order-id>"                  # full order, re-checks MoMo
```

"I paid but I'm not subscribed": ask them to press **Restore purchase**. It settles pending payments for
their machine ID. If MoMo shows the payment as successful but the order is `REVIEW`, the amount didn't
match; check it, then issue a key by hand.

### Manual payments, replacements, your own PCs

```sh
npm run license -- --machine 7F3K-9QXA-2M8D-H4PZ --plan month --note "MoMo ref 1234567890"
npm run license -- --machine 7F3K-9QXA-2M8D-H4PZ --days 12 --note "moved from old PC"
npm run license -- --self --lifetime --install      # this computer, e.g. for your own use
```

Send the printed key on WhatsApp; the customer pastes it under *Subscription → Activate key*. Every
key you issue is logged in `keys/issued.csv`.

### Cancelling a license (refund, fraud, shared key)

Add the license ID (it starts with `L`; the admin API and `issued.csv` show it) to `site/revoked.json`,
then commit and push. Apps pick it up when they start, and every 6 hours.

### When the casino changes the game

The bot finds the game through the CSS selectors in `SEL` at the top of `src/game.js`.
- **Only class names changed:** put the new selectors in `site/selectors.json` under `payload.selectors`
  (only names that exist in `SEL`), run `npm run sign-selectors`, commit and push. Every installed app
  applies the fix the next time it starts. No new installer needed. Unsigned or tampered files are ignored.
- **The page structure changed:** fix `src/game.js`, test with `npm start` (or the CLI), and release a new version.

### Releasing an update

Bump `version` in `package.json`, commit, then `git tag v1.0.1 && git push origin v1.0.1`.
Installed apps show *"Version 1.0.1 is available"* and link to the download page.
Customers run the new installer over the old one; settings and subscriptions stay.

### The video tutorial

`npm run video` makes the tutorial on the website (`site/assets/video/`): it starts the real
app, acts out every scene of `tools/video/storyboard.js` in Chrome with an annotated cursor,
spotlights and callouts, adds narration, and writes captions, chapters and a transcript. The
playing chapter uses simulated rounds (labelled on screen) and the payment chapter a test MoMo,
so no money is involved. It takes about ten minutes and needs ffmpeg (`brew install ffmpeg`).
Re-run it after changing the control panel, then commit `site/assets/video/` and push.

**Your own voice-over (e.g. Google's AI voices):**
1. `npm run video -- --script-only` writes `video/narration.md`: one paragraph per scene, each with an id.
2. Generate one audio file per scene and save it as `video/voice/<id>.wav` (or `.mp3`/`.m4a`),
   e.g. `video/voice/01-welcome.mp3`. Keep to the words; the pace doesn't matter.
3. `npm run video`. Each scene stretches to its clip, and the on-screen actions are cued from the
   words, so everything stays in sync. Scenes without a clip use the built-in voice.

To try the subscription flow yourself without real money: `npm run dev:api` in one terminal, then
`CHAINPILOT_API_URL=http://127.0.0.1:8787 npm start` (a payment is approved after 8 seconds; a
number ending in 0 is declined).

### Building on this Mac

```sh
brew install makensis      # once
npm run build:win          # → dist/windows/ChainPilot-Setup-<version>.exe and latest.json
npm run site               # preview the website at http://127.0.0.1:8080
npm start                  # run the app itself (macOS works for testing)
npm test
```

After changing the icon or product name: `npm run icons && npm run screenshots`.

---

## 3. Things you should know

**Be honest in every advert, post and message.** The strategy does not beat the game: every bet
loses about 3% on average, and most sessions end down. Your own live logs (273 bets) show
−62.33 on 479.95 staked (−13%). Claims like "win daily", "guaranteed profit", or anything that
sounds like a predictor would mislead customers, and could expose you to consumer-protection or
fraud claims. The website and app copy is written to be accurate. Keep it that way.

**Casino rules.** Most casinos forbid bots. Customers' accounts can be restricted, and the casino
can change or block the game at any time, which affects everyone who paid. The terms say so. Don't
promise otherwise.

**Legal.** Selling gambling-related software, and gambling advertising, may be regulated where you
and your customers are (in Eswatini, the Gaming Control Board). Get local advice. The terms,
privacy and responsible-gambling pages are a starting point, not legal advice. Have them reviewed.

**Licensing limits.** The app is JavaScript, so a determined person can patch out the license check.
Signed, machine-bound keys stop casual sharing, not cracking. Treat it as a deterrent.

**Windows warnings.** The installer isn't code-signed, so Windows SmartScreen shows "Windows protected
your PC" until it builds a reputation. A code-signing certificate (or Microsoft's Trusted/Artifact
Signing service, if you qualify) removes most of that. Sign `dist/windows/*.exe` before publishing.

**Capacity.** Cloudflare's free tier allows about 1,000 KV writes a day, roughly 200 paid orders a
day. Beyond that, Workers Paid (about $5 a month) raises the limits a lot.

**Responsible gambling.** The loss limit and time limit are on by default, and live betting needs a
confirmation. If a customer asks you to stop selling to them, revoke their license and don't take
new payments from their number.

---

## 4. Where things are

| Path | What |
| --- | --- |
| `product.config.json` | Names, URLs, prices, contacts: shared by app, site and Worker |
| `desktop/` | The Windows app: `main.js` (start), `server.js` (local API), `controller.js` (runs the bot), `ui/` (control panel) |
| `src/` | The bot (`game.js`, `runner.js`, `strategy.js`, `session.js`), licensing, compounding maths, shared UI modules (`web/`) |
| `server/` | License server: `worker.js`, `momo.js`, `wrangler.toml` |
| `site/` | Website templates, assets, `revoked.json`, `selectors.json` |
| `installer/` | NSIS script, icon, the license text shown during install |
| `tools/` | keys, licenses, selector signing, icons, screenshots, site and installer builds, local test license server |
| `tools/video/` | the video tutorial: storyboard (narration + actions), director, overlay, concept scenes |
| `video/` | the narration script, and your own voice clips in `video/voice/` |
| `.github/workflows/` | `ci.yml`, `release.yml` (installer + Windows smoke test + release), `pages.yml` |
| `aviator-bot.js` | The original command-line bot (developer tool, not shipped) |
| `keys/` | **Secret.** Private key and the log of issued keys. Not in git. |
