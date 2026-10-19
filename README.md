# kerosene

Fuel for [Octane](https://octane.wtf). Kerosene is a browser extension for the Octane Roblox revival (2021–2022 era). Works in **Chrome, Brave, Edge, Opera, Firefox and Zen**.

## Features

**Supa Games perks.** Themes, backgrounds, custom fonts, hide ads, price alerts and "can I afford it" alerts are for members of the [Supa Games](https://octane.wtf/groups/428/supa-games) group on Octane (joining is free). Everything else is for everyone.

- **Era themes for octane.wtf** — Classic 2018 (light, blue top bar, Source Sans), Dark 2020 (Roblox 2020 dark, Gotham) and Modern 2026 (near-black, soft corners, Inter). Themes switch Octane's own light/dark mode, recolour its stylesheets and add era touches; going back to Original restores your own light/dark setting.
- **Custom backgrounds** — the animated character field, Baseplate, Midnight, Aurora, Sunset and Ocean presets, or your own image / GIF / video (link or upload), with dim and blur sliders.
- **Custom font** *(Supa Games)*: pick a font for all of Octane: one of the presets, any Google Font or a font on your computer by name, or upload a font file (.ttf, .otf, .woff, .woff2).
- **Playtime**: how long you've played each game, today, over the last 7 days and in total, plus what you're playing right now. Kerosene checks your status every minute while your browser is open, so time with the browser closed isn't counted.
- **Item values** from [Octomons](https://octomons.wtf) — value, demand, trend, projected and rare badges on limited item cards; a value panel on every limited's item page; total value on limiteds pages.
- **Trade helpers** — Value and RAP totals for both sides of every trade (and while you build one), plus a **WIN / LOSS / FAIR** banner with warnings for projected items, low demand, and rares you're giving away. Robux is counted after Octane's 30% fee.
- **Avatar Sandbox** — a **Sandbox** tab in Octane's avatar editor (octane.wtf/my/avatar) that looks like the rest of the editor but lists every item in Octane's catalog, on sale or not, by category, with search and sorting. The price sits under every item (cheapest reseller for limiteds), click to try it on (the preview renders it on your own avatar, in 2D or 3D), and the outfit's total shows next to your balance with **how much Robux you still need**. Save as many outfits as you like; they're stored locally, each with its price and what you'd still need.
- **Trade alerts**: a notification as soon as someone sends you a trade, already showing WIN / LOSS / FAIR and the value difference.
- **Price-drop alerts** *(Supa Games)*: watch any limited and get pinged when someone lists it at or under your price, or below its Octomons value.
- **"Can I afford it" alerts** *(Supa Games)*: a notification when your Robux covers one of your saved Sandbox outfits.
- **Hide ads** *(Supa Games)*: removes Octane's sponsor ads from every page.
- **Favourite games bar**: your Octane favourites at the top of the popup with live player counts; one click opens the game.
- **Trade calculator** in the popup — add items to each side by name or acronym, add Robux, see the verdict.
- **Your limiteds' worth** — item count, total value and RAP in the popup.
- **Friends** — syncs your Octane friends list automatically, with avatars and live status: online, in Studio, or *playing &lt;game&gt;* (and for how long) with a Join button. Watch extra people by username or ID. Toolbar badge shows how many are online; optional alerts when a friend comes online or starts a game.
- **User lookup** by username or ID, **quick links**, and a **seasonal toggle** for Octane's Halloween decorations.
- **Interactive popup** — OLED-black background of drifting characters that light up around your cursor; click for a ripple.

## Privacy

Kerosene asks once, in its menu, whether you want to share anonymous usage stats with its maker. Nothing is sent unless you say yes, and Firefox asks you again with its own data-sharing prompt.

If you say yes, once a day Kerosene sends: your browser (Chrome, Brave, Edge, Opera, Firefox or Zen), your operating system, the Kerosene version, your theme, background type, font type, menu colour, whether Supa Games perks are unlocked, and which features are switched on. They're sent under a random install number made on your computer. Your Octane account, your friends, your trades and the pages you visit are never sent, and the stats server doesn't store your IP address. Reports are deleted 40 days after your last one.

You can change your answer any time in **Settings → Share anonymous stats**. Turning it off also deletes what was already sent. The server's code is in [`stats/worker.js`](stats/worker.js).

## Install

Download the file for your browser from the [`dist`](dist) folder:

| Browser | File |
| --- | --- |
| Brave, Chrome, Edge, Opera | `dist/kerosene-chrome.zip` |
| Firefox, Zen | `dist/kerosene-firefox.xpi` |

### Brave (also Chrome / Edge / Opera)

1. Unzip `kerosene-chrome.zip` into a folder you'll keep (e.g. `Documents/kerosene`). Don't delete it afterwards — Brave loads the extension from there.
2. Go to `brave://extensions` (Chrome: `chrome://extensions`).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the unzipped folder (the one containing `manifest.json`).
5. Click the puzzle-piece icon in the toolbar and **pin** Kerosene. Open octane.wtf once while signed in so it can find your account.

**Updating:** replace the folder's contents with the new zip, then press the ↻ reload button on Kerosene in `brave://extensions`.

### Firefox / Zen

Firefox only installs extensions permanently when they're signed by Mozilla. Pick one:

**Quick try (until you restart the browser)** — works in every Firefox and Zen:
1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `kerosene-firefox.xpi`.

**Keep it installed — Zen, Firefox Developer Edition, Nightly or ESR:**
1. Go to `about:config`, search `xpinstall.signatures.required`, set it to **false**.
2. Go to `about:addons` → ⚙️ → **Install Add-on From File…** → choose `kerosene-firefox.xpi`.

**Keep it installed — regular Firefox:** get a free signature from Mozilla. Sign in at [addons.mozilla.org/developers](https://addons.mozilla.org/developers/), click **Submit a New Add-on**, choose **On your own**, and upload `kerosene-firefox.xpi`. Mozilla sends back a signed `.xpi` (usually within minutes); install that from `about:addons` → ⚙️ → **Install Add-on From File…**.

**Updating (Firefox / Zen):** click the ↻ button in the Kerosene popup. Kerosene downloads the new signed version, a small Kerosene window opens and Firefox asks twice (**Continue to Installation**, then **Add**); your Octane page refreshes into the new version. Firefox also installs updates by itself about once a day.

After installing, pin Kerosene from the Extensions (puzzle-piece) menu. If the popup shows **"Kerosene needs permission…"**, click **Allow**.

## Using it

- **Themes / backgrounds:** open the popup → Themes or Backgrounds. Changes apply to open octane.wtf tabs instantly.
- **Trades:** open a trade on octane.wtf/trades — the WIN/LOSS banner sits above the offers and each side shows its Value and RAP. It updates live while you build a trade or type Robux.
- **Item values:** limited item cards show `V` (Octomons value) and demand badges; item pages get a value panel with a link to Octomons. Values refresh every 10 minutes.
- **Friends:** popup → Friends. Click **Join** to open the game a friend is playing.
- **Avatar Sandbox:** go to octane.wtf/my/avatar, hover **Sandbox** and pick a category. Click items to try them on and click again to take them off. **Copy My Avatar** starts from what you're wearing. **Save Outfit** keeps it, and **Sandbox → Saved Outfits** lists them with their prices. Nothing is bought or changed on your real avatar.

## Development

- `manifest.json` is the Chrome/Brave manifest; load the repo folder unpacked to develop.
- `python3 build.py` builds `dist/kerosene-chrome.zip` and `dist/kerosene-firefox.xpi` (the Firefox build swaps the service worker for background scripts and adds a Gecko ID).
- `popup/` — the toolbar menu
- `content/engine.js` — themes and backgrounds on octane.wtf
- `content/values.js` — item values and trade helpers (runs inside Octane's `/theme2020/` iframes too)
- `content/avatar-main.js` — the avatar Sandbox; runs in the editor page's own world so it can build the tab with the page's AngularJS. `content/avatar-sandbox.js` stores its outfits in extension storage
- `update/` — the small window Firefox's installer runs in when you press the update button; `content/update-fx.js` shows the loading screen and the refresh animation on Octane pages
- `background.js` — friend polling, notifications, Octomons value cache, cross-origin stylesheet fetches
- `shared/` — settings + Octane API helpers, theme definitions, values maths, the character-field animation, and the `ext` browser-API shim
