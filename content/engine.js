// Runs on octane.wtf at document_start. Applies the selected era theme to
// Octane's Roblox 2021/22 frontend (base light/dark class, recoloured
// stylesheets, era tweaks, fonts) and paints the custom background.
(() => {
  if (window.__kerosene) return;
  window.__kerosene = true;

  const T = globalThis.KeroseneThemes;
  const S = globalThis.KeroseneSettings;
  const OWN = "kerosene-";
  const RADIUS_PROPS = new Set([
    "border-top-left-radius", "border-top-right-radius",
    "border-bottom-left-radius", "border-bottom-right-radius",
  ]);

  let settings = null;
  let activeTheme = null; // theme with a palette, while applied
  let compiled = null; // activeTheme compiled against the detected page colour
  let pageColor = null;
  let buildSeq = 0;
  let sheetSig = "";
  let bgActive = false;
  let contrastBoost = false; // light theme + custom background
  let coverWidth = 0; // viewport width the cover marks were computed for
  let basePageColor = null; // the site's page colour before Kerosene's background
  let field = null;
  let observer = null;
  let rebuildTimer = null, coverTimer = null;
  const inlineOrig = new Map(); // element -> original style attribute
  const inlineWritten = new WeakMap(); // element -> style attribute we wrote

  const root = () => document.head || document.documentElement;

  // Layered !important rules beat unlayered !important ones, so era tweaks and
  // background overrides win over both the page's CSS and our recolouring.
  function addStyle(id, css, layered = false) {
    let el = document.getElementById(OWN + id);
    if (!el) {
      el = document.createElement("style");
      el.id = OWN + id;
    }
    el.textContent = layered ? `@layer kerosene {\n${css}\n}` : css;
    root().appendChild(el); // (re)append so it stays last
    return el;
  }

  // ---------- cloak (avoid a flash of the old theme) ----------
  function cloak() {
    addStyle("cloak", "html { opacity: 0 !important; }");
    setTimeout(uncloak, 1500);
  }
  function uncloak() {
    const el = document.getElementById(OWN + "cloak");
    if (!el) return;
    addStyle("reveal", "html { transition: opacity 0.18s ease !important; }");
    el.remove();
  }

  // ---------- recolouring ----------
  // Every colour-carrying declaration is re-emitted as !important, changed or
  // not. Re-emitting only the changed ones would break the page's own
  // cascade: a recoloured light-mode rule would beat the dark-mode rule that
  // overrides it with "transparent".
  const COLOR_PROPS = new Set([
    "color", "background-color", "background-image", "fill", "stroke", "caret-color", "accent-color",
    "outline-color", "text-decoration-color", "column-rule-color",
    "-webkit-text-fill-color", "-webkit-text-stroke-color",
    "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  ]);

  // -> { decls: [[prop, value]], changed: boolean }
  function themedDecls(style) {
    const theme = compiled.theme;
    const props = [];
    for (let i = 0; i < style.length; i++) props.push(style[i]);
    // backgrounds first, so text sitting on an accent fill can stay light
    props.sort((a, b) => Number(b.startsWith("background")) - Number(a.startsWith("background")));

    const decls = [];
    let changed = false, bgAccent = false;
    for (const prop of props) {
      const val = style.getPropertyValue(prop);
      if (!val) continue;
      if (RADIUS_PROPS.has(prop)) {
        if (theme.radius == null) continue;
        let out = val;
        if (/^[\d.]+px$/.test(val.trim())) {
          const px = parseFloat(val);
          if (px > 0 && px < 40) out = `${Math.round((px * theme.radius) / 12)}px`;
        }
        changed ||= out !== val;
        decls.push([prop, out]);
        continue;
      }
      if (!COLOR_PROPS.has(prop) && !prop.startsWith("--")) continue;
      const kind = T.kindOf(prop);
      if (!kind) continue;
      const r = T.rewriteValue(val, compiled, kind, kind === "fg" && bgAccent);
      if (kind === "bg" && r.roles.includes("accent")) bgAccent = true;
      changed ||= r.changed;
      decls.push([prop, r.value]);
    }
    return { decls, changed };
  }

  function processRules(rules) {
    let css = "";
    for (const rule of rules) {
      if (rule.type === 1) { // CSSStyleRule
        const { decls } = themedDecls(rule.style);
        if (decls.length) {
          css += `${rule.selectorText}{${decls.map(([p, v]) => `${p}:${v} !important`).join(";")}}\n`;
        }
      } else if (rule.type === 4) { // @media
        const inner = processRules(rule.cssRules);
        if (inner) css += `@media ${rule.conditionText || rule.media.mediaText}{${inner}}\n`;
      } else if (rule.type === 12) { // @supports
        const inner = processRules(rule.cssRules);
        if (inner) css += `@supports ${rule.conditionText}{${inner}}\n`;
      }
    }
    return css;
  }

  // Stylesheets served from another origin (a CDN, a static. subdomain) can't
  // be read from the page, so the service worker fetches their text for us.
  const cssCache = new Map(); // href -> Promise<CSSRuleList | null>
  function fetchSheetRules(href) {
    if (!cssCache.has(href)) {
      cssCache.set(href, ext.runtime.sendMessage({ type: "fetch-css", url: href }).then((res) => {
        if (!res || res.error) {
          noteBlocked(href);
          return null;
        }
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(res.text);
        return sheet.cssRules;
      }).catch(() => null));
    }
    return cssCache.get(href);
  }

  async function noteBlocked(href) {
    let origin;
    try { origin = new URL(href).origin; } catch { return; }
    const { cssBlocked = [] } = await ext.storage.local.get("cssBlocked");
    if (!cssBlocked.includes(origin)) await ext.storage.local.set({ cssBlocked: [...cssBlocked, origin] });
  }

  async function collectRules() {
    const lists = [];
    for (const sheet of [...document.styleSheets]) {
      const owner = sheet.ownerNode;
      if (owner && owner.id && owner.id.startsWith(OWN)) continue;
      if (sheet.disabled) continue;
      if (sheet.media?.mediaText && !matchMedia(sheet.media.mediaText).matches) continue;
      try {
        lists.push(sheet.cssRules);
      } catch {
        if (sheet.href && !/fonts\.googleapis\.com/.test(sheet.href)) {
          const rules = await fetchSheetRules(sheet.href);
          if (rules) lists.push(rules);
        }
      }
    }
    return lists;
  }

  // The page background the site's CSS gives <body> (Roblox: body.dark-theme
  // #232527, body.light-theme #f2f4f5). Everything is recoloured relative to it.
  const BODY_SEL = /(^|[\s,>+~(])(html|body)(?![\w-])|#rbx-body|\.rbx-body|\.(dark|light)-theme/i;
  function pageColorFromRules(lists) {
    let found = null;
    let foundImportant = false;
    const visit = (rules) => {
      for (const r of rules) {
        if (r.type === 1) {
          if (!BODY_SEL.test(r.selectorText)) continue;
          const c = T.parseColor(r.style.getPropertyValue("background-color"));
          if (!c || c.a < 0.9) continue;
          let hit = false;
          try {
            hit = document.body.matches(r.selectorText) || document.documentElement.matches(r.selectorText);
          } catch { /* selector the DOM API can't match */ }
          // like the cascade: an !important page colour (Octane's dark-mode
          // override on its older light pages) beats later normal rules
          const important = r.style.getPropertyPriority("background-color") === "important";
          if (hit && (important || !foundImportant)) {
            found = c;
            foundImportant = foundImportant || important;
          }
        } else if (r.type === 4) {
          if (matchMedia(r.media.mediaText).matches) visit(r.cssRules);
        } else if (r.type === 12) {
          visit(r.cssRules);
        }
      }
    };
    lists.forEach(visit);
    return found;
  }

  // Measured with Kerosene's own styles switched off, so the theme's page
  // colour on <body> isn't mistaken for the site's.
  function pageColorFromLayout() {
    const own = [...document.querySelectorAll(`style[id^="${OWN}"]`)].filter((s) => !s.disabled);
    own.forEach((s) => { s.disabled = true; });
    try {
      for (const el of [document.body, document.documentElement, ...(findCovers() || [])]) {
        if (el.hasAttribute("data-kero-clear")) continue;
        const c = T.parseColor(getComputedStyle(el).backgroundColor);
        if (c && c.a >= 0.9) return c;
      }
      return null;
    } finally {
      own.forEach((s) => { s.disabled = false; });
    }
  }

  async function buildRecolor() {
    if (!activeTheme) return;
    const seq = ++buildSeq;
    const lists = await collectRules();
    if (seq !== buildSeq || !activeTheme) return;
    sheetSig = signature();

    pageColor = pageColorFromRules(lists) || pageColor || pageColorFromLayout();
    compiled = T.compile(activeTheme, pageColor, { contrast: contrastBoost });
    let css = "";
    for (const rules of lists) css += processRules(rules);
    addStyle("recolor", css);

    restoreInline();
    if (document.body) rewriteInlineTree(document.body);
    for (const el of document.querySelectorAll("[data-kero-clear]")) markClear(el);
  }

  function rewriteInline(el) {
    const orig = el.getAttribute("style");
    if (!orig || inlineWritten.get(el) === orig) return;
    const { decls, changed } = themedDecls(el.style);
    if (!changed) return;
    inlineOrig.set(el, orig);
    for (const [p, v] of decls) el.style.setProperty(p, v, "important");
    inlineWritten.set(el, el.getAttribute("style"));
    if (el.hasAttribute("data-kero-clear")) markClear(el); // stay see-through over the background
  }

  function rewriteInlineTree(node) {
    if (!compiled || node.nodeType !== 1) return;
    if (node.id && node.id.startsWith(OWN)) return;
    if (node.hasAttribute("style")) rewriteInline(node);
    for (const el of node.querySelectorAll("[style]")) {
      if (!el.closest(`#${OWN}bg-layer`)) rewriteInline(el);
    }
  }

  function restoreInline() {
    for (const [el, orig] of inlineOrig) {
      el.setAttribute("style", orig);
    }
    inlineOrig.clear();
  }

  // ---------- fonts & extras ----------
  function applyFont(theme) {
    if (!settings.themeFonts || !theme.font) return;
    let link = document.getElementById(OWN + "font-link");
    if (!link) {
      link = document.createElement("link");
      link.id = OWN + "font-link";
      link.rel = "stylesheet";
      root().appendChild(link);
    }
    link.href = theme.font.url;
    const tags = "div,span,p,a,button,input,textarea,select,label,h1,h2,h3,h4,h5,h6,li,td,th,small,strong,b,em,section,article,header,nav,footer,main,aside";
    addStyle("font", `
      html body, html body :is(${tags}):not([class*="icon" i]):not([class*="fa-" i]) {
        font-family: ${theme.font.family} !important;
      }
    `);
  }

  // ---------- background ----------
  function applyBackground() {
    const bg = settings.bg;
    if (!bg || bg.mode === "none" || (bg.mode === "image" && !bg.image)) return false;

    // Embedded Octane pages (trades, item, limiteds iframes) just go see-through
    // so the top page's background shows behind them.
    const embedded = window.top !== window;
    basePageColor = pageColorFromLayout();
    const light = pageIsLight();
    bgActive = true;
    addStyle("bg-over", `
      html, body { background: transparent !important; }
      ${embedded ? "" : "html { background-color: #000 !important; }"}
      [data-kero-clear] { background: transparent !important; }
    `, true);
    if (embedded) return true;
    addStyle("bg", `
      #${OWN}bg-layer { position: fixed; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; }
      #${OWN}bg-layer > .kero-fill { position: absolute; inset: -40px; background-position: center; background-size: cover; }
      #${OWN}bg-layer > video.kero-fill { width: calc(100% + 80px); height: calc(100% + 80px); object-fit: cover; }
      #${OWN}bg-layer > canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
      #${OWN}bg-layer > .kero-dim { position: absolute; inset: 0; }
      @keyframes kerosene-aurora { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
      @media (prefers-reduced-motion: reduce) { #${OWN}bg-layer .kero-fill { animation: none !important; } }
    `);

    const layer = document.createElement("div");
    layer.id = OWN + "bg-layer";
    layer.setAttribute("aria-hidden", "true");

    let fill;
    if (bg.mode === "preset" && bg.preset === "field") {
      fill = document.createElement("canvas");
      layer.appendChild(fill);
    } else if (bg.mode === "image" && /^data:video|\.(mp4|webm)(\?|#|$)/i.test(bg.image)) {
      fill = document.createElement("video");
      Object.assign(fill, { src: bg.image, autoplay: true, loop: true, muted: true, playsInline: true });
      fill.className = "kero-fill";
      layer.appendChild(fill);
    } else {
      fill = document.createElement("div");
      fill.className = "kero-fill";
      if (bg.mode === "image") {
        fill.style.backgroundImage = `url("${bg.image.replace(/"/g, "%22")}")`;
      } else {
        fill.style.cssText = (T.BG_PRESETS[bg.preset] || T.BG_PRESETS.midnight).css;
        fill.style.position = "absolute";
        fill.style.inset = "-40px";
      }
      layer.appendChild(fill);
    }
    if (bg.blur > 0 && fill.tagName !== "CANVAS") fill.style.filter = `blur(${bg.blur}px)`;

    const dim = document.createElement("div");
    dim.className = "kero-dim";
    dim.style.background = dimColor(light, bg.dim);
    layer.appendChild(dim);

    (document.body || document.documentElement).prepend(layer);

    if (fill.tagName === "CANVAS" && globalThis.KeroseneField) {
      field = KeroseneField.create(fill, { fontSize: 12, color: settings.fieldColor, background: "#050505" });
    }
    return true;
  }

  // Light pages get a light wash instead of a black dim so dark text stays
  // readable; the dim slider maps into 85-95% there.
  function dimColor(light, dim) {
    if (!light) return `rgba(0, 0, 0, ${dim})`;
    const c = (activeTheme && T.parseColor(activeTheme.palette.page)) || { r: 242, g: 244, b: 245 };
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${(0.85 + (dim / 0.9) * 0.1).toFixed(3)})`;
  }

  // Octane's own light/dark switch can flip the page under Original.
  function refreshDim() {
    const dim = document.querySelector(`#${OWN}bg-layer > .kero-dim`);
    if (dim) dim.style.background = dimColor(pageIsLight(), settings.bg.dim);
  }

  // Is the page (after theming) light? The active theme decides; for
  // Original, measure the site's own page colour.
  function pageIsLight() {
    const c = activeTheme ? T.parseColor(activeTheme.palette.page) : pageColorFromLayout();
    return Boolean(c) && T.rgbToHsl(c).l > 0.5;
  }

  // Page wrappers that would hide the custom background: anything covering
  // the viewport, plus large blocks painted in the page's own colour at any
  // depth (Octane's home page has a near-full-width content block a few
  // levels down). Cards and panels in other colours are left alone.
  const sameTone = (a, b) => Math.abs(a.r - b.r) <= 10 && Math.abs(a.g - b.g) <= 10 && Math.abs(a.b - b.b) <= 10;

  function pageTones() {
    const tones = [];
    if (pageColor) tones.push(pageColor);
    if (basePageColor) tones.push(basePageColor);
    if (activeTheme) tones.push(T.parseColor(activeTheme.palette.page));
    return tones;
  }

  function findCovers() {
    const out = [];
    const vw = innerWidth, vh = innerHeight;
    // hidden frame (display:none): no real viewport or layout to judge by
    if (!document.body || !vw || !vh || !document.documentElement.getBoundingClientRect().width) return null;
    const tones = pageTones();
    // The body itself always goes see-through: Octane paints it from script
    // (an inline "background: #232527" in dark mode), and a theme recolouring
    // that inline style writes it back as !important, which would otherwise
    // beat the transparent rule and cover the background.
    out.push(document.body);
    const walk = (el, depth) => {
      for (const child of el.children) {
        if (child.id && child.id.startsWith(OWN)) continue;
        const r = child.getBoundingClientRect();
        if (r.width < vw * 0.5 || r.height < vh * 0.3) continue; // too small to be a page wrapper
        const cs = getComputedStyle(child);
        const bg = T.parseColor(cs.backgroundColor);
        const painted = cs.backgroundImage !== "none" || (bg && bg.a > 0);
        if (painted) {
          const full = r.width >= vw * 0.9 && r.height >= vh * 0.85;
          // rounded corners or a shadow make it a card, not a page wrapper
          const cardLike = cs.boxShadow !== "none" || parseFloat(cs.borderTopLeftRadius) >= 6 ||
            (cs.borderTopStyle !== "none" && parseFloat(cs.borderTopWidth) > 0 && cs.borderBottomStyle !== "none");
          const pageTone = !cardLike && r.width >= vw * 0.6 && bg && bg.a > 0.5 && tones.some((t) => sameTone(bg, t));
          if (full || pageTone) out.push(child);
        }
        if (depth < 14) walk(child, depth + 1);
      }
    };
    walk(document.body, 0);
    return out;
  }

  function clearCovers() {
    if (!bgActive) return;
    const covers = findCovers();
    if (!covers) return;
    // after a width change, drop only marks on elements that are no longer
    // wide enough to be a wrapper (height can shrink with client-rendered content)
    if (innerWidth !== coverWidth) {
      for (const el of document.querySelectorAll("[data-kero-clear]")) {
        if (el.getBoundingClientRect().width < innerWidth * 0.5) unclear(el);
      }
      coverWidth = innerWidth;
    }
    for (const el of covers) markClear(el);
  }

  // [data-kero-clear] makes a wrapper see-through from our stylesheet; an inline
  // background (the page's own, or our recolouring of it) needs an inline override.
  function markClear(el) {
    el.setAttribute("data-kero-clear", "");
    if (!/background/i.test(el.getAttribute("style") || "")) return;
    if (!inlineOrig.has(el)) inlineOrig.set(el, el.getAttribute("style"));
    el.style.setProperty("background-color", "transparent", "important");
    el.style.setProperty("background-image", "none", "important");
    inlineWritten.set(el, el.getAttribute("style"));
  }
  function unclear(el) {
    el.removeAttribute("data-kero-clear");
    if (!inlineOrig.has(el)) return;
    el.setAttribute("style", inlineOrig.get(el));
    inlineOrig.delete(el);
    if (compiled) rewriteInline(el);
  }

  // Octane's login page paints its own background on a full-screen canvas.
  function hideBgCanvases() {
    for (const c of document.querySelectorAll("canvas")) {
      if (c.closest(`#${OWN}bg-layer`)) continue;
      const cs = getComputedStyle(c);
      const r = c.getBoundingClientRect();
      if ((cs.position === "absolute" || cs.position === "fixed") && r.width >= innerWidth * 0.8 && r.height >= innerHeight * 0.8) {
        c.setAttribute("data-kero-hide", "");
      }
    }
  }

  // ---------- Octane integration ----------
  // Octane's own light/dark switch: localStorage.rbx_theme_v1 plus an
  // "octane-theme-change" event (its head script swaps light-theme/dark-theme
  // classes and the *_light.css / *_dark.css files). Era themes pick a base
  // mode through it, and the user's own choice is restored afterwards.
  const SITE_THEME = "rbx_theme_v1";
  const SAVED_THEME = "kerosene_prev_rbx_theme";
  function setSiteMode(mode) {
    try {
      const ls = localStorage;
      if (mode) {
        if (ls.getItem(SAVED_THEME) === null) ls.setItem(SAVED_THEME, ls.getItem(SITE_THEME) ?? "");
        if ((ls.getItem(SITE_THEME) === "dark") === (mode === "dark")) return;
        ls.setItem(SITE_THEME, mode);
      } else {
        const prev = ls.getItem(SAVED_THEME);
        if (prev === null) return;
        ls.removeItem(SAVED_THEME);
        if (prev) ls.setItem(SITE_THEME, prev);
        else ls.removeItem(SITE_THEME);
      }
      window.dispatchEvent(new Event("octane-theme-change"));
    } catch { /* storage blocked */ }
  }

  // Octane's seasonal (Halloween) decorations: localStorage.octane_halloween_v1
  function applySeasonal() {
    try {
      const ls = localStorage;
      const off = settings.enabled && settings.seasonal === false;
      if (off && ls.getItem("octane_halloween_v1") !== "off") {
        ls.setItem("octane_halloween_v1", "off");
        ls.setItem("kerosene_seasonal_off", "1");
        document.documentElement.classList.remove("octane-halloween");
      } else if (!off && ls.getItem("kerosene_seasonal_off")) {
        ls.removeItem("octane_halloween_v1");
        ls.removeItem("kerosene_seasonal_off");
        document.documentElement.classList.add("octane-halloween");
      }
    } catch { /* storage blocked */ }
  }

  // Who's signed in: <meta name="octane-viewer" data-id data-name ...>
  async function rememberViewer() {
    const m = document.querySelector('meta[name="octane-viewer"]');
    const id = Number(m?.dataset.id);
    if (!id) return;
    const viewer = { id, name: m.dataset.name || "", displayName: m.dataset.displayname || m.dataset.name || "" };
    const { viewer: known } = await ext.storage.local.get("viewer");
    if (!known || known.id !== viewer.id || known.name !== viewer.name || known.displayName !== viewer.displayName) {
      await ext.storage.local.set({ viewer });
    }
  }

  // Octane is a Next.js app: styles also arrive via CSSOM insertRule (JSS)
  // and on client-side navigation, so watch the stylesheet rule counts.
  function signature() {
    let sig = "";
    for (const sheet of document.styleSheets) {
      const owner = sheet.ownerNode;
      if (owner?.id?.startsWith(OWN)) continue;
      try { sig += sheet.cssRules.length + ","; } catch { sig += "x,"; }
    }
    return sig;
  }

  // ---------- lifecycle ----------
  function teardown() {
    buildSeq++;
    for (const el of document.querySelectorAll(`[id^="${OWN}"]`)) {
      if (el.id !== OWN + "cloak") el.remove();
    }
    field?.destroy();
    field = null;
    for (const el of document.querySelectorAll("[data-kero-clear],[data-kero-hide]")) {
      el.removeAttribute("data-kero-clear");
      el.removeAttribute("data-kero-hide");
    }
    restoreInline();
    bgActive = false;
    coverWidth = 0;
    basePageColor = null;
    activeTheme = null;
    compiled = null;
    pageColor = null;
  }

  function scheduleRebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => activeTheme && buildRecolor(), 120);
  }
  function scheduleCovers() {
    clearTimeout(coverTimer);
    coverTimer = setTimeout(() => {
      clearCovers();
      if (activeTheme || bgActive) hideBgCanvases();
    }, 150);
  }

  async function applyAll() {
    teardown();
    applySeasonal();
    const theme = settings.enabled ? T.THEMES[settings.theme] : null;
    setSiteMode(theme?.base || null);
    if (!settings.enabled) return;

    // Hide ads (Supa Games): Octane's sponsor slots are .abp boxes holding a
    // /user-sponsorship/ frame (skyscrapers beside pages, banners above items)
    if (settings.hideAds) {
      addStyle("noads", `
        .abp, .abp-container, [id$="-Abp"], [id*="-Abp-"], [data-js-adtype="iframead"],
        iframe[src*="/user-sponsorship/"] { display: none !important; }
      `, true);
    }

    const bg = settings.bg;
    const bgWanted = bg && bg.mode !== "none" && !(bg.mode === "image" && !bg.image);
    contrastBoost = Boolean(theme?.palette && bgWanted && T.rgbToHsl(T.parseColor(theme.palette.page)).l > 0.5);
    if (theme?.palette) {
      activeTheme = theme;
      applyFont(theme);
      addStyle("page", `body { background-color: ${theme.palette.page} !important; }`, true);
      // default for text no stylesheet colours (normal priority: page CSS still wins)
      addStyle("base", `body { color: ${theme.palette.text}; }`);
      if (theme.extraCss) addStyle("extra", theme.extraCss, true);
      await buildRecolor();
    }
    const hasBg = applyBackground();
    if (activeTheme || hasBg) {
      addStyle("hide", "[data-kero-hide] { visibility: hidden !important; }", true);
      hideBgCanvases();
    }
    clearCovers();
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((muts) => {
      let sheets = false, layout = false;
      for (const m of muts) {
        if (m.type === "attributes") {
          if (compiled && inlineWritten.get(m.target) !== m.target.getAttribute("style")) {
            inlineOrig.delete(m.target);
            rewriteInline(m.target);
          }
          continue;
        }
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1 || (n.id && n.id.startsWith(OWN))) continue;
          if (n.tagName === "STYLE" || (n.tagName === "LINK" && /stylesheet/i.test(n.rel))) {
            sheets = true;
            if (n.tagName === "LINK") n.addEventListener("load", scheduleRebuild, { once: true });
          } else {
            rewriteInlineTree(n);
            layout = true;
          }
        }
      }
      if (sheets) scheduleRebuild();
      if (layout) scheduleCovers();
    });
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["style"],
    });
    // a hidden frame (display:none) shown again at the same size fires no
    // resize event, but its root box goes from 0 to real size
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(scheduleCovers).observe(document.documentElement);
    }
  }

  async function init() {
    settings = S.effective(await S.load()); // member-only features off without the perks
    const active = settings.enabled && (settings.theme !== "original" || settings.bg.mode !== "none");
    if (active) cloak();

    const ready = async () => {
      startObserver();
      rememberViewer();
      await applyAll();
      uncloak();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
    else ready();

    // late stylesheets / layout; link load events don't bubble, so capture
    window.addEventListener("load", () => { scheduleRebuild(); scheduleCovers(); });
    window.addEventListener("resize", scheduleCovers);
    document.addEventListener("load", (e) => {
      if (e.target?.tagName === "LINK") scheduleRebuild();
    }, true);
    // Octane's light/dark switch (this tab, or another tab via storage)
    const onSiteTheme = () => setTimeout(() => {
      if (bgActive) refreshDim();
      scheduleRebuild();
      scheduleCovers();
    }, 60);
    window.addEventListener("octane-theme-change", onSiteTheme);
    window.addEventListener("storage", (e) => { if (e.key === SITE_THEME) onSiteTheme(); });
    let lastUrl = location.href;
    setInterval(() => {
      if (activeTheme && signature() !== sheetSig) scheduleRebuild();
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        scheduleCovers();
      }
    }, 1000);

    const WATCHED = ["enabled", "theme", "themeFonts", "seasonal", "bg", "fieldColor", "cssRetry", "hideAds", "groupAccess"];
    ext.storage.onChanged.addListener(async (changes, area) => {
      if (area !== "local" || !WATCHED.some((k) => k in changes)) return;
      if (changes.cssRetry) cssCache.clear();
      settings = S.effective(await S.load());
      applyAll();
    });
  }

  init();
})();
