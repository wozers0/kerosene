// Era themes for octane.wtf.
//
// Octane's main frontend is the 2021/22 Roblox web frontend (rbx-header,
// rbx-left-col, game-card-container, btn-primary-md, body.dark-theme ...).
// A theme does three things:
//   1. picks which of Roblox's own base themes to start from (light / dark),
//      by swapping the body's light-theme / dark-theme class;
//   2. recolours the page's stylesheets: every colour is classified by role
//      relative to the detected page background (recessed, page, card,
//      raised, line, text, muted, accent) and swapped for the theme's colour;
//   3. adds era-specific tweaks against Roblox class names.
// Colours outside the blue/purple accent range (play-button greens, error
// reds, ...) are left alone so status colours keep their meaning.
(() => {
  const FONTS = {
    inter: { family: "'Inter', 'Builder Sans', 'Segoe UI', system-ui, sans-serif", url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" },
    montserrat: { family: "'HCo Gotham SSm', 'Gotham SSm', 'Montserrat', 'Segoe UI', sans-serif", url: "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" },
    sourceSans: { family: "'Source Sans 3', 'Source Sans Pro', 'Segoe UI', sans-serif", url: "https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap" },
  };

  // Roblox-frontend selectors used by the era tweaks
  const HEADER = "#header, .rbx-header";
  const LEFTNAV = "#navigation, .rbx-left-col";
  const PLAY = ".btn-growth-md, .btn-growth-lg, .btn-growth-sm, .btn-common-play-game-lg, .btn-common-play-game-md, [class*='btn-growth']";
  const INPUTS = ".form-control, .input-field, textarea.form-control, .rbx-header .navbar-search input";

  const THEMES = {
    original: {
      id: "original",
      label: "Original",
      year: "2021–22",
      blurb: "Octane as it ships",
      swatch: { page: "#232527", card: "#393b3d", accent: "#00a2ff", text: "#ffffff", bar: "#191b1d" },
    },
    2018: {
      id: "2018",
      label: "Classic",
      year: "2018",
      blurb: "Light, blue top bar, Source Sans",
      base: "light",
      font: FONTS.sourceSans,
      radius: 3,
      palette: {
        recessed2: "#c4c4c4", recessed: "#d6d6d6", page: "#e3e3e3", card: "#ffffff", raised: "#f2f2f2", raised2: "#e8e8e8",
        line: "#c3c3c3", text: "#191919", muted: "#757575", accent: "#00a2ff", onAccent: "#ffffff",
      },
      swatch: { page: "#e3e3e3", card: "#ffffff", accent: "#00a2ff", text: "#191919", bar: "#00a2ff" },
      extraCss: `
        ${HEADER}, body > header {
          background: #00a2ff !important;
          border-bottom: 0 !important;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2) !important;
        }
        :is(${HEADER}) :is(a, span, .text-header, .font-header-2, .text-robux, .icon-text) { color: #ffffff !important; }
        :is(${HEADER}) [class*="icon-"]:not([class*="icon-robux"]) { filter: brightness(0) invert(1) !important; }
        :is(${HEADER}) .navbar-search input, :is(${HEADER}) .input-field {
          background: #ffffff !important; color: #191919 !important; border: 0 !important;
        }
        ${LEFTNAV} { background: #ffffff !important; }
        ${INPUTS} { background: #ffffff !important; color: #191919 !important; border-color: #b8b8b8 !important; }
        ${PLAY} { background-color: #02b757 !important; border-color: #02b757 !important; color: #ffffff !important; }
        .section-content, .game-card-container .game-card-thumb-container { box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12) !important; }
        h1, h2, h3, .container-header h2 { font-weight: 400 !important; }
      `,
    },
    2020: {
      id: "2020",
      label: "Dark",
      year: "2020",
      blurb: "Roblox 2020 dark theme, Gotham",
      base: "dark",
      font: FONTS.montserrat,
      radius: 8,
      palette: {
        recessed2: "#111213", recessed: "#191b1d", page: "#232527", card: "#393b3d", raised: "#4a4c4f", raised2: "#56585b",
        line: "#4f5153", text: "#ffffff", muted: "#bdbebe", accent: "#00a2ff", onAccent: "#ffffff",
      },
      swatch: { page: "#232527", card: "#393b3d", accent: "#00a2ff", text: "#ffffff", bar: "#191b1d" },
      extraCss: `
        ${HEADER}, body > header { background: #191b1d !important; box-shadow: 0 1px 0 rgba(0, 0, 0, 0.4) !important; }
        ${LEFTNAV} { background: #191b1d !important; }
        ${PLAY} { background-color: #02b757 !important; border-color: #02b757 !important; color: #ffffff !important; }
      `,
    },
    2026: {
      id: "2026",
      label: "Modern",
      year: "2026",
      blurb: "Near-black, soft corners, Inter",
      base: "dark",
      font: FONTS.inter,
      radius: 12,
      palette: {
        recessed2: "#050506", recessed: "#08080a", page: "#0b0b0d", card: "#17181c", raised: "#24262c", raised2: "#2f3138",
        line: "#26272d", text: "#f4f4f6", muted: "#9a9ca5", accent: "#335fff", onAccent: "#ffffff",
      },
      swatch: { page: "#0b0b0d", card: "#17181c", accent: "#335fff", text: "#f4f4f6", bar: "#141518" },
      extraCss: `
        ${HEADER}, body > header {
          background: rgba(11, 11, 13, 0.82) !important;
          backdrop-filter: blur(14px) saturate(1.4);
          border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
          box-shadow: none !important;
        }
        ${LEFTNAV} { background: #0b0b0d !important; border-right: 1px solid rgba(255, 255, 255, 0.05) !important; }
        .section-content, .game-card-container, .list-item, .card { border-radius: 12px !important; }
        .game-card-thumb-container, .game-card-thumb, .thumbnail-2d-container { border-radius: 10px !important; overflow: hidden; }
        [class*="btn-"], button { border-radius: 10px !important; transition: transform 0.12s ease, filter 0.12s ease !important; }
        [class*="btn-"]:hover, button:hover { filter: brightness(1.08); }
        [class*="btn-"]:active, button:active { transform: scale(0.97); }
        ${INPUTS} { border-radius: 10px !important; }
      `,
    },
  };

  // Custom background presets (the "field" preset is the animated character field)
  const BG_PRESETS = {
    field: { label: "Field", css: "background: #050505;" },
    baseplate: { label: "Baseplate", css: `
      background-color: #4b4e53;
      background-image:
        linear-gradient(rgba(0,0,0,0.22) 2px, transparent 2px),
        linear-gradient(90deg, rgba(0,0,0,0.22) 2px, transparent 2px),
        radial-gradient(circle at 50% 50%, rgba(255,255,255,0.07) 9px, transparent 10px);
      background-size: 48px 48px, 48px 48px, 48px 48px;` },
    midnight: { label: "Midnight", css: `
      background-color: #07080c;
      background-image:
        radial-gradient(1px 1px at 20px 30px, #fff, transparent),
        radial-gradient(1px 1px at 120px 80px, rgba(255,255,255,0.8), transparent),
        radial-gradient(1.5px 1.5px at 60px 150px, #fff, transparent),
        radial-gradient(1px 1px at 170px 190px, rgba(255,255,255,0.7), transparent),
        radial-gradient(1px 1px at 90px 110px, rgba(255,255,255,0.6), transparent),
        radial-gradient(ellipse at top, #1b2735 0%, #07080c 70%);
      background-size: 200px 200px, 200px 200px, 200px 200px, 200px 200px, 200px 200px, 100% 100%;` },
    aurora: { label: "Aurora", css: `
      background: linear-gradient(120deg, #0b1a2b, #0f5e5a, #2c1b5e, #0b1a2b);
      background-size: 400% 400%;
      animation: kerosene-aurora 24s ease infinite;` },
    sunset: { label: "Sunset", css: `background: linear-gradient(165deg, #140a26 0%, #4a1a5c 40%, #c2413a 80%, #f39c5a 100%);` },
    ocean: { label: "Ocean", css: `background: linear-gradient(180deg, #020f1c 0%, #053a57 55%, #137c99 100%);` },
  };

  // ---------- colour helpers ----------
  const COLOR_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black)\b/gi;
  const NAMED = { white: { r: 255, g: 255, b: 255, a: 1 }, black: { r: 0, g: 0, b: 0, a: 1 }, transparent: { r: 0, g: 0, b: 0, a: 0 } };

  function parseColor(str) {
    if (!str) return null;
    str = str.trim().toLowerCase();
    if (NAMED[str]) return { ...NAMED[str] };
    if (str[0] === "#") {
      let h = str.slice(1);
      if (!/^[0-9a-f]+$/.test(h) || ![3, 4, 6, 8].includes(h.length)) return null;
      if (h.length <= 4) h = [...h].map((c) => c + c).join("");
      const n = parseInt(h.slice(0, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
    }
    const open = str.indexOf("(");
    if (open < 0) return null;
    const fn = str.slice(0, open);
    const parts = str.slice(open + 1, -1).split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3 || parts.some((p) => p.startsWith("var"))) return null;
    const num = (v, scale) => (v.endsWith("%") ? (parseFloat(v) / 100) * scale : parseFloat(v));
    const alpha = parts[3] !== undefined ? num(parts[3], 1) : 1;
    if (fn.startsWith("rgb")) {
      return { r: num(parts[0], 255), g: num(parts[1], 255), b: num(parts[2], 255), a: alpha };
    }
    if (fn.startsWith("hsl")) {
      const { r, g, b } = hslToRgb(parseFloat(parts[0]) / 360, num(parts[1], 1), num(parts[2], 1));
      return { r, g, b, a: alpha };
    }
    return null;
  }

  function rgbToHsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h * 60, s, l };
  }

  function hslToRgb(h, s, l) {
    if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
    const hue = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return { r: hue(p, q, h + 1 / 3) * 255, g: hue(p, q, h) * 255, b: hue(p, q, h - 1 / 3) * 255 };
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  const mix = (c1, c2, t) => ({ r: lerp(c1.r, c2.r, t), g: lerp(c1.g, c2.g, t), b: lerp(c1.b, c2.b, t), a: 1 });

  function toCss({ r, g, b }, a = 1) {
    const R = Math.round(r), G = Math.round(g), B = Math.round(b);
    return a >= 1 ? `rgb(${R}, ${G}, ${B})` : `rgba(${R}, ${G}, ${B}, ${+a.toFixed(3)})`;
  }

  // Surface colours are placed by "elevation": lightness relative to the page
  // background. Roblox cards/sections sit above the page (#393b3d on #232527,
  // #fff on #f2f4f5); headers and inputs sit below it.
  const ELEVATION_STOPS = [
    [-0.12, "recessed2"], [-0.04, "recessed"], [0, "page"], [0.08, "card"], [0.15, "raised"], [0.25, "raised2"],
  ];

  // pageColor: the site's detected page background (before theming)
  function compile(theme, pageColor) {
    if (!theme.palette) return null;
    const pal = {};
    for (const [k, v] of Object.entries(theme.palette)) pal[k] = parseColor(v);
    const stops = ELEVATION_STOPS.map(([e, key]) => [e, pal[key]]);
    const accent = rgbToHsl(pal.accent);
    const P = rgbToHsl(pageColor || { r: 35, g: 37, b: 39 }).l;
    const dark = P < 0.5;

    return {
      theme, pal, P, dark,
      surface(l) {
        let e = l - P;
        // a light site has little room above its page colour: white == card
        if (!dark && e > 0) e = (e / Math.max(0.02, 1 - P)) * 0.08;
        if (e <= stops[0][0]) return stops[0][1];
        for (let i = 1; i < stops.length; i++) {
          if (e <= stops[i][0]) {
            const [e0, c0] = stops[i - 1], [e1, c1] = stops[i];
            return mix(c0, c1, (e - e0) / (e1 - e0));
          }
        }
        return stops[stops.length - 1][1];
      },
      accent(l) {
        // keep hover/pressed shades relative to a mid-lightness source accent
        const nl = Math.min(0.92, Math.max(0.08, accent.l + (l - 0.5) * 0.8));
        return hslToRgb(accent.h / 360, accent.s, nl);
      },
    };
  }

  // kind: "fg" (text colour), "bg" (fills), "line" (borders/outlines)
  // Returns { css, role } or null when the colour should be left alone.
  function mapColor(c, k, kind, onAccent) {
    if (!c || c.a === 0) return null;
    const { h, s, l } = rgbToHsl(c);

    // saturated colours: blue/purple become the theme accent, the rest keep meaning
    if (s >= 0.45 && l >= 0.25 && l <= 0.8) {
      if (h >= 185 && h <= 300) return { css: toCss(k.accent(l), c.a), role: "accent" };
      return null;
    }
    if (l < 0.06 && c.a < 0.9) return null; // translucent black overlays

    const pal = k.pal;
    let out, role;
    if (kind === "fg") {
      if (k.dark) {
        if (l >= 0.75) role = onAccent ? "onAccent" : "text";
        else if (l >= 0.4) role = "muted";
        else role = "page"; // dark text on a light element
      } else {
        if (l <= 0.3) role = "text";
        else if (l <= 0.78) role = "muted";
        else role = "onAccent"; // light text sits on a coloured fill
      }
      out = pal[role];
    } else if (kind === "line") {
      const surfaceLike = k.dark ? l < 0.25 : l > 0.85;
      const textLike = k.dark ? l >= 0.6 : l <= 0.4;
      if (surfaceLike) { out = k.surface(l); role = "surface"; }
      else if (textLike) { out = pal.text; role = "text"; }
      else { out = pal.line; role = "line"; }
    } else {
      const surfaceLike = k.dark ? l < 0.6 : l > 0.6;
      if (surfaceLike) { out = k.surface(l); role = "surface"; }
      else { out = pal.text; role = "text"; } // inverted element (white button on dark, tooltip on light)
    }
    return { css: toCss(out, c.a), role };
  }

  const COLOR_RE_NO_NAMES = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;

  function rewriteValue(value, k, kind, onAccent) {
    let changed = false;
    const roles = [];
    // don't touch words like "white" inside url(white-bg.png)
    const re = value.includes("url(") ? COLOR_RE_NO_NAMES : COLOR_RE;
    const out = value.replace(re, (tok) => {
      const m = mapColor(parseColor(tok), k, kind, onAccent);
      if (!m) return tok;
      changed = true;
      roles.push(m.role);
      return m.css;
    });
    return { value: out, changed, roles };
  }

  function kindOf(prop) {
    if (prop.startsWith("background")) return "bg";
    if (prop.startsWith("border") || prop.startsWith("outline") || prop === "column-rule-color") return "line";
    if (prop === "box-shadow" || prop === "text-shadow" || prop === "filter") return null;
    if (prop.startsWith("--")) return "bg";
    return "fg"; // color, fill, stroke, caret-color, text-decoration-color, ...
  }

  globalThis.KeroseneThemes = { THEMES, BG_PRESETS, COLOR_RE, compile, rewriteValue, kindOf, parseColor, mapColor, rgbToHsl };
})();
