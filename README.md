# kerosene

Fuel for [Octane](https://octane.wtf). Kerosene is a browser extension for the Octane Roblox revival (2021–2022 era).

## Features

- **Era themes for octane.wtf** — Classic 2018 (light, blue top bar, Source Sans), Dark 2020 (Roblox 2020 dark, Gotham) and Modern 2026 (near-black, soft corners, Inter). Themes switch Octane's own light/dark mode, recolour its stylesheets and add era touches; going back to Original restores your own light/dark setting. Switch live from the popup.
- **Custom backgrounds** — the animated character field, Baseplate, Midnight, Aurora, Sunset and Ocean presets, or your own image / GIF / video (link or upload), with dim and blur sliders.
- **Friends** — syncs your Octane friends list automatically (open octane.wtf once while signed in), with avatars and live status: online, in Studio, or *playing &lt;game&gt;* with a Join button. Watch extra people by username or ID. Toolbar badge shows how many are online; optional alerts when a friend comes online or starts a game.
- **User lookup** by username or ID, and **quick links** to every part of the site.
- **Seasonal toggle** — turn Octane's Halloween (and other holiday) decorations on or off.
- **Interactive popup** — OLED-black background of drifting characters that light up around your cursor; click for a ripple. Pick the glow colour in Settings.

## Install (Chrome / Edge / Brave / Opera)

1. Download this repo (**Code → Download ZIP**) and unzip it
2. Open `chrome://extensions` and turn on **Developer mode**
3. Click **Load unpacked** and select the `kerosene` folder
4. Pin Kerosene and click the flame icon

## Layout

- `popup/` — the toolbar menu
- `content/engine.js` — applies themes and backgrounds on octane.wtf
- `background.js` — friend polling, notifications, cross-origin stylesheet fetches
- `shared/` — settings, theme definitions and the character-field animation
