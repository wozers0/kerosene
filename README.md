# kerosene

Fuel for [Octane](https://octane.wtf). Kerosene is a browser extension for the Octane Roblox revival (2021–2022 era).

## Features

- **Era themes for octane.wtf** — Classic 2018 (light, blue top bar, Source Sans), Dark 2020 (Roblox 2020 dark, Gotham-style) and Modern 2026 (near-black, soft corners, Inter). Switch live from the popup.
- **Custom backgrounds** — the animated character field, Baseplate, Midnight, Aurora, Sunset and Ocean presets, or your own image / GIF / video (link or upload), with dim and blur sliders.
- **Friends tracker** — watch Octane user IDs, see who's online in the popup, get a badge count and a notification when someone comes online.
- **Quick links** and **user lookup**.
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
