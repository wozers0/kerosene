// dad's panel, bottom-left on octane.wtf (only for S.ADMIN_ID): players in
// game and the busiest games, how many of Supa Games / your friends / Octane
// are on, your waiting trades, new members, and a button to the dashboard.
// The numbers come from the background (refreshWidget), at most every 45s.
(() => {
  if (window.top !== window) return;
  const S = globalThis.KeroseneSettings;
  const HOST_ID = "kero-admin-widget"; // not "kerosene-": the theme engine clears those
  const FONT_ID = "kero-admin-font";
  const ASK_EVERY = 60 * 1000;

  const CSS = `
    :host { all: initial; }
    .wrap { position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; pointer-events: none;
      font-family: "Josefin Sans", "Avenir Next", "Segoe UI", system-ui, sans-serif; color: #f2f2f2; -webkit-font-smoothing: antialiased; }
    .card { pointer-events: auto; width: 318px; padding: 16px 16px 14px; border-radius: 16px; background: rgba(28, 28, 30, 0.94); border: 1px solid rgba(255, 255, 255, 0.06);
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55); backdrop-filter: blur(14px); display: flex; flex-direction: column; gap: 14px;
      transform-origin: bottom left; transition: transform .22s ease, opacity .22s ease, visibility 0s; }
    .collapsed .card { opacity: 0; transform: scale(.92) translateY(8px); visibility: hidden; position: absolute; bottom: 38px;
      transition: transform .22s ease, opacity .22s ease, visibility 0s linear .22s; }
    .cap { font-size: 11px; font-weight: 700; letter-spacing: 1.6px; text-transform: uppercase; color: #9a9a9e; }
    .cap b { color: #fff; margin-left: 2px; }
    .games { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .game { position: relative; display: block; aspect-ratio: 1; border-radius: 13px; overflow: hidden; background: #2c2c2f; text-decoration: none; }
    .game img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .game img[hidden] { display: none; }
    .game span { position: absolute; inset: 0; display: grid; place-items: center; font-size: 34px; font-weight: 700; color: rgba(255, 255, 255, .86);
      text-shadow: 0 2px 10px rgba(0, 0, 0, .55); line-height: 1; padding-top: 4px; }
    .game:hover { outline: 2px solid rgba(255, 255, 255, .5); }
    .game:focus-visible, .tile:focus-visible, .open:focus-visible, .toggle:focus-visible { outline: 2px solid #8bc34a; outline-offset: 2px; }
    .game.empty { background: rgba(255, 255, 255, .04); }
    .gauges { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .gauge { display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .meters { display: flex; gap: 5px; }
    .meter { display: flex; flex-direction: column; align-items: center; gap: 5px; }
    .bar { position: relative; width: 42px; height: 40px; border-radius: 11px; overflow: hidden; background: #2c2c2f; }
    .fill { position: absolute; left: 0; right: 0; bottom: 0; background: #8bc34a; transition: height .5s ease; }
    .fill.busy { background: #c9b53c; }
    .pct { position: absolute; inset: 0; display: grid; place-items: center; font-size: 11.5px; font-weight: 700; color: #fff; text-shadow: 0 1px 3px rgba(0, 0, 0, .6); padding-top: 2px; }
    .lab { font-size: 9.5px; font-weight: 700; letter-spacing: 1.3px; color: #8e8e93; text-transform: uppercase; }
    .counts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .tile { display: flex; align-items: baseline; gap: 10px; padding: 14px 14px 11px; border-radius: 12px; background: #2a2a2d; color: #fff; text-decoration: none; cursor: pointer; border: 0; font: inherit; text-align: left; }
    .tile:hover, .open:hover { background: #333337; }
    .tile b { font-size: 21px; font-weight: 700; }
    .tile span { font-size: 10.5px; font-weight: 700; letter-spacing: 1.6px; color: #a5a5aa; text-transform: uppercase; }
    .open { padding: 14px 0 11px; border-radius: 12px; background: #2a2a2d; color: #fff; border: 0; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
    .toggle { pointer-events: auto; width: 30px; height: 30px; border-radius: 50%; border: 1px solid rgba(255, 255, 255, .08); background: rgba(28, 28, 30, .94); color: #d0d0d4;
      display: grid; place-items: center; cursor: pointer; box-shadow: 0 6px 18px rgba(0, 0, 0, .45); padding: 0; }
    .toggle svg { transition: transform .22s ease; }
    .collapsed .toggle svg { transform: rotate(180deg); }
    .stale { opacity: .55; }
    @media (prefers-reduced-motion: reduce) { .card, .collapsed .card, .fill, .toggle svg { transition: none; } }
  `;

  const STALE = 5 * 60 * 1000;
  // "Total in game" and the game tiles come straight from Octane every 5 seconds
  // (one small request, only in the visible tab while the panel is open)
  const LIVE_EVERY = 5000;
  let host = null, root = null, timer = null, last = null;
  let fast = null, liveTimer = null, liveBusy = false, livePausedUntil = 0;
  const icons = {}; // placeId -> icon URL

  function mount() {
    if (host) return;
    if (!document.getElementById(FONT_ID)) {
      const link = document.createElement("link");
      link.id = FONT_ID;
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@400;600;700&display=swap";
      (document.head || document.documentElement).append(link);
    }
    host = document.createElement("div");
    host.id = HOST_ID;
    root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = CSS;
    const tpl = document.createElement("template");
    // fixed markup; every value is filled in later with textContent
    tpl.innerHTML = `<div class="wrap">
    <section class="card" aria-label="Kerosene admin panel">
      <div class="cap">Total in game · <b class="total">—</b></div>
      <div class="games"></div>
      <div class="gauges">
        <div class="gauge"><span class="cap g-supa">Supa</span><div class="meters">
          <div class="meter"><div class="bar"><div class="fill"></div><span class="pct">—</span></div><span class="lab">On</span></div>
          <div class="meter"><div class="bar"><div class="fill"></div><span class="pct">—</span></div><span class="lab">Play</span></div>
        </div></div>
        <div class="gauge"><span class="cap">Friends</span><div class="meters">
          <div class="meter"><div class="bar"><div class="fill"></div><span class="pct">—</span></div><span class="lab">On</span></div>
          <div class="meter"><div class="bar"><div class="fill"></div><span class="pct">—</span></div><span class="lab">Play</span></div>
        </div></div>
        <div class="gauge"><span class="cap">Octane</span><div class="meters">
          <div class="meter"><div class="bar"><div class="fill"></div><span class="pct">—</span></div><span class="lab">Now</span></div>
          <div class="meter"><div class="bar"><div class="fill"></div><span class="pct">—</span></div><span class="lab">Day</span></div>
        </div></div>
      </div>
      <div class="counts">
        <a class="tile t-trades" href="/trades"><b>—</b><span>Trades</span></a>
        <button class="tile t-joins" type="button"><b>—</b><span>Joined</span></button>
      </div>
      <button class="open" type="button">Admin Panel</button>
    </section>
    <button class="toggle" type="button" aria-label="Hide the admin panel" aria-expanded="true">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></svg>
    </button>
  </div>`;
    root.append(style, tpl.content);
    (document.body || document.documentElement).append(host);

    root.querySelector(".open").addEventListener("click", () => ext.runtime.sendMessage({ type: "open-admin" }).catch(() => {}));
    root.querySelector(".t-joins").addEventListener("click", () => ext.runtime.sendMessage({ type: "open-admin" }).catch(() => {}));
    root.querySelector(".toggle").addEventListener("click", async () => {
      const collapsed = !root.querySelector(".wrap").classList.contains("collapsed");
      setCollapsed(collapsed);
      if (!collapsed) liveTick();
      await ext.storage.local.set({ adminWidgetCollapsed: collapsed }).catch(() => {});
    });
  }

  function unmount() {
    host?.remove();
    host = root = null;
    clearInterval(timer);
    clearInterval(liveTimer);
    timer = liveTimer = null;
  }

  function setCollapsed(collapsed) {
    if (!root) return;
    root.querySelector(".wrap").classList.toggle("collapsed", collapsed);
    const t = root.querySelector(".toggle");
    t.setAttribute("aria-expanded", String(!collapsed));
    t.setAttribute("aria-label", collapsed ? "Show the admin panel" : "Hide the admin panel");
  }

  const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : null);

  function meter(el, value) {
    const fill = el.querySelector(".fill");
    fill.style.height = `${value == null ? 0 : Math.max(0, Math.min(100, value))}%`;
    fill.classList.toggle("busy", value != null && value >= 60);
    el.querySelector(".pct").textContent = value == null ? "—" : `${value}%`;
  }

  // dim when Octane hasn't answered for a while (checked again on every tick)
  function markStale() {
    const fresh = Math.max(last?.dataAt || 0, fast?.at || 0);
    root?.querySelector(".card").classList.toggle("stale", !fresh || Date.now() - fresh > STALE);
  }

  // the newer of the 5-second look and the background's snapshot
  const liveSource = () => (fast && fast.at > (last?.dataAt || 0) ? fast : last);

  // total, tiles and the Octane "now" gauge; tiles are updated in place so icons don't flicker
  function renderGames() {
    if (!root) return;
    const src = liveSource();
    root.querySelector(".total").textContent = src?.total == null ? "—" : String(src.total);
    const grid = root.querySelector(".games");
    while (grid.children.length < 8) {
      const a = document.createElement("a");
      a.className = "game empty";
      const img = document.createElement("img");
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.hidden = true;
      a.append(img, document.createElement("span"));
      grid.append(a);
    }
    for (let i = 0; i < 8; i++) {
      const a = grid.children[i];
      const g = src?.games?.[i];
      const img = a.querySelector("img");
      const span = a.querySelector("span");
      a.classList.toggle("empty", !g);
      if (!g) {
        a.removeAttribute("href");
        a.removeAttribute("title");
        img.hidden = true;
        span.textContent = "";
        continue;
      }
      const href = `/games/${encodeURIComponent(g.placeId)}/`;
      if (a.getAttribute("href") !== href) a.setAttribute("href", href);
      a.title = `${g.name} · ${g.playing} playing`;
      const icon = g.icon && /^https:\/\//.test(g.icon) ? g.icon : "";
      if (icon && img.getAttribute("src") !== icon) img.src = icon;
      img.hidden = !icon;
      span.textContent = String(g.playing);
    }
    const oct = last?.octane;
    if (oct && src?.total != null) {
      const peak = Math.max(oct.peak7, src.total);
      const m = root.querySelectorAll(".meter")[4];
      meter(m, pct(src.total, peak));
      m.title = `${src.total} playing now; this week's peak is ${peak}`;
    }
  }

  async function liveTick() {
    if (!root || document.hidden || liveBusy || Date.now() < livePausedUntil) return;
    if (root.querySelector(".wrap").classList.contains("collapsed")) return;
    liveBusy = true;
    try {
      const games = (await S.fetchTopGames(100)).filter((g) => g.playing);
      const top = games.slice(0, 8);
      const missing = top.filter((g) => !(g.placeId in icons));
      if (missing.length) {
        for (const g of missing) icons[g.placeId] = "";
        const got = await S.fetchGameIcons(missing.map((g) => g.universeId)).catch(() => ({}));
        for (const g of missing) icons[g.placeId] = got[g.universeId] || "";
      }
      fast = {
        at: Date.now(),
        total: games.reduce((n, g) => n + g.playing, 0),
        games: top.map((g) => ({ name: g.name, placeId: g.placeId, playing: g.playing, icon: icons[g.placeId] })),
      };
      renderGames();
      markStale();
    } catch {
      livePausedUntil = Date.now() + 60000; // Octane said no or is down: try again in a minute
    } finally {
      liveBusy = false;
    }
  }

  function render(snap) {
    if (!root) return;
    last = snap;
    markStale();
    if (!snap) return;
    for (const g of snap.games || []) if (g.icon && !icons[g.placeId]) icons[g.placeId] = g.icon;

    const meters = root.querySelectorAll(".meter");
    const { supa, friends, octane } = snap;
    meter(meters[0], supa ? pct(supa.online, supa.members) : null);
    meter(meters[1], supa ? pct(supa.ingame, supa.members) : null);
    meter(meters[2], friends ? pct(friends.online, friends.total) : null);
    meter(meters[3], friends ? pct(friends.ingame, friends.total) : null);
    meter(meters[4], octane ? pct(octane.now, octane.peak7) : null);
    meter(meters[5], octane ? pct(octane.peakToday, octane.peak7) : null);
    meters[0].title = supa ? `${supa.online} of ${supa.members} Supa Games members online` : "";
    meters[1].title = supa ? `${supa.ingame} of ${supa.members} members in a game` : "";
    meters[2].title = friends ? `${friends.online} of ${friends.total} friends online` : "";
    meters[3].title = friends ? `${friends.ingame} of ${friends.total} friends in a game` : "";
    meters[4].title = octane ? `${octane.now} playing now; this week's peak is ${octane.peak7}` : "";
    meters[5].title = octane ? `Today's peak ${octane.peakToday} against this week's ${octane.peak7}` : "";
    renderGames();

    root.querySelector(".t-trades b").textContent = snap.trades == null ? "—" : String(snap.trades);
    root.querySelector(".t-trades").title = snap.trades == null ? "Sign in to Octane to see your trades" : `${snap.trades} trades waiting for you`;
    root.querySelector(".t-joins b").textContent = String(snap.joins24 ?? 0);
    root.querySelector(".t-joins").title = "New Supa Games members in the last 24 hours";
  }

  function ask(force = false) {
    if (document.hidden) return;
    ext.runtime.sendMessage({ type: "admin-widget", force }).catch(() => {});
  }

  async function update() {
    const got = await ext.storage.local.get({ viewer: null, enabled: true, adminWidget: null, adminWidgetCollapsed: false }).catch(() => null);
    if (!got || !S.isAdmin(got.viewer) || !got.enabled) return unmount();
    mount();
    setCollapsed(got.adminWidgetCollapsed);
    render(got.adminWidget);
    if (!got.adminWidget || Date.now() - got.adminWidget.at > ASK_EVERY) ask();
    timer ??= setInterval(() => { markStale(); ask(); }, ASK_EVERY);
    if (!liveTimer) {
      liveTimer = setInterval(liveTick, LIVE_EVERY);
      liveTick();
    }
  }

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.viewer || changes.enabled) update();
    else if (changes.adminWidget && root) render(changes.adminWidget.newValue);
    else if (changes.adminWidgetCollapsed) setCollapsed(Boolean(changes.adminWidgetCollapsed.newValue));
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !host) return;
    ask();
    liveTick();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", update, { once: true });
  else update();
})();
