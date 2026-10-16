// The Octane page's part of an update: while Firefox asks the user to approve
// it, the page turns into Kerosene's loading screen; when the new version has
// reloaded the page, that screen finishes and opens up onto it.
(() => {
  if (window.top !== window) return;
  const F = globalThis.KeroseneField;
  const S = globalThis.KeroseneSettings;
  const HOST_ID = "kero-update-fx"; // not "kerosene-": the theme engine clears those

  const CSS = `
    :host { all: initial; }
    .wrap { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; background: #000;
      font: 13px ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace; color: #ececec;
      animation: in .35s ease both; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    .card { position: relative; width: min(340px, calc(100% - 32px)); padding: 26px 22px 20px; text-align: center;
      border: 1px solid rgba(255,255,255,.08); border-radius: 16px; background: rgba(10,10,11,.8); backdrop-filter: blur(10px);
      animation: card .5s cubic-bezier(.2,.8,.2,1) both; }
    .logo { position: relative; display: grid; place-items: center; width: 84px; height: 84px; margin: 0 auto 14px; color: rgb(var(--a)); }
    .flame { filter: drop-shadow(0 0 12px rgba(var(--a), .75)); transition: transform .4s, opacity .3s; }
    .ring { position: absolute; inset: 0; animation: spin 1.2s linear infinite; transition: opacity .3s; }
    .check { position: absolute; color: #6ec878; opacity: 0; transform: scale(.4); transition: transform .45s cubic-bezier(.3,1.6,.5,1), opacity .25s; }
    h1 { margin: 0; font-size: 16px; letter-spacing: .3px; font-weight: 700; }
    .ver { margin: 6px 0 0; color: #8d8d8d; }
    .ver b { color: rgb(var(--a)); }
    .msg { margin: 12px 0 0; color: #8d8d8d; font-size: 11.5px; line-height: 1.5; }
    .msg b { color: #ececec; }
    button { margin-top: 14px; height: 28px; padding: 0 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.1);
      background: rgba(255,255,255,.04); color: #ececec; font: inherit; font-size: 11.5px; cursor: pointer; }
    button:hover { background: rgba(255,255,255,.1); }
    .done .ring, .done .flame { opacity: 0; }
    .done .flame { transform: scale(.6); }
    .done .check { opacity: 1; transform: scale(1); }
    .done .logo { color: #6ec878; }
    .out { animation: out .6s cubic-bezier(.7,0,.3,1) both; }
    .toast { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; display: flex; align-items: center; gap: 8px;
      padding: 9px 13px; border-radius: 10px; border: 1px solid rgba(255,255,255,.1); background: rgba(10,10,11,.92); color: #ececec;
      font: 12px ui-monospace, "SF Mono", Menlo, Consolas, monospace; box-shadow: 0 8px 28px rgba(0,0,0,.45);
      animation: toast 4.2s ease both; }
    .toast svg { color: #6ec878; }
    @keyframes in { from { opacity: 0; } }
    @keyframes card { from { opacity: 0; transform: translateY(10px) scale(.96); } }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes out { from { clip-path: circle(75% at 50% 45%); } to { clip-path: circle(0% at 50% 45%); } }
    @keyframes toast { 0% { opacity: 0; transform: translateY(8px); } 8%, 85% { opacity: 1; transform: none; } 100% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .wrap, .card, .ring, .out, .toast { animation: none !important; } }
  `;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ver = (v) => String(v).replace(/[^\d.]/g, "");

  let current = null; // { host, root, wrap, field }

  function remove() {
    current?.field?.destroy();
    current?.host.remove();
    current = null;
  }

  function styleEl() {
    const style = document.createElement("style");
    style.textContent = CSS;
    return style;
  }

  // The loading screen: fixed markup, text filled in afterwards
  async function mount(from, to) {
    remove();
    const settings = S ? await S.load().catch(() => null) : null;
    const color = settings?.fieldColor || "blue";
    const rgb = (F?.rgb || {})[color] || [79, 163, 224];
    const host = document.createElement("div");
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: "closed" });
    const tpl = document.createElement("template");
    tpl.innerHTML = `<div class="wrap"><canvas></canvas><div class="card">
      <div class="logo">
        <svg class="flame" viewBox="0 0 24 24" width="30" height="30"><path fill="currentColor" d="M12 2c.6 3.2-1.1 4.9-2.6 6.6C7.9 10.3 6.5 12 6.5 14.6 6.5 18.4 9 21 12 21s5.5-2.6 5.5-6.2c0-2.3-1-4-2.2-5.4-.3 1.6-1.1 2.7-2.3 3.2.5-2.9-.1-6.6-1-10.6Z"/></svg>
        <svg class="ring" viewBox="0 0 24 24" width="84" height="84"><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-width=".9" stroke-dasharray="16 50" stroke-linecap="round"/></svg>
        <svg class="check" viewBox="0 0 24 24" width="26" height="26"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7.5"/></svg>
      </div>
      <h1>Updating Kerosene</h1>
      <p class="ver"><span class="from"></span> &rarr; <b class="to"></b></p>
      <p class="msg"></p>
      <button type="button" hidden>Hide</button>
    </div></div>`;
    root.append(styleEl(), tpl.content);
    const wrap = root.querySelector(".wrap");
    wrap.style.setProperty("--a", rgb.join(", "));
    root.querySelector(".from").textContent = `v${ver(from)}`;
    root.querySelector(".to").textContent = `v${ver(to)}`;
    (document.body || document.documentElement).append(host);
    const canvas = root.querySelector("canvas");
    const field = F ? F.create(canvas, { color, animate: settings?.animatedBg !== false }) : null;
    current = { host, root, wrap, field };
    return current;
  }

  // message text; **this** comes out bold
  function say(c, text) {
    c.root.querySelector(".msg").replaceChildren(...String(text).split("**").map((part, i) => {
      if (!(i % 2)) return part;
      const b = document.createElement("b");
      b.textContent = part;
      return b;
    }));
  }

  // While the update is being approved in the Kerosene window
  async function installing(from, to) {
    const c = await mount(from, to);
    say(c, "Approve it in the **Kerosene window**: **Continue to Installation**, then **Add**. This page refreshes into the new version.");
    const hide = c.root.querySelector("button");
    hide.hidden = false;
    hide.addEventListener("click", remove);
  }

  // Back after the reload: finish the screen, then open it up onto the page
  async function reveal(from, to) {
    const c = await mount(from, to);
    say(c, "Loading the new version…");
    // the theme engine keeps the page hidden for a moment while it restyles it
    const until = Date.now() + 1800;
    while (Date.now() < until && Number(getComputedStyle(document.documentElement).opacity) < 0.99) await sleep(50);
    await sleep(reduced() ? 100 : 450);
    c.wrap.classList.add("done");
    c.root.querySelector("h1").textContent = `Kerosene ${ver(to)}`;
    say(c, "Updated and ready.");
    c.field?.ripple?.();
    await sleep(reduced() ? 300 : 1100);
    c.wrap.classList.add("out");
    await sleep(reduced() ? 0 : 620);
    remove();
  }

  // An update Firefox installed by itself: just say so
  function toast(to) {
    const host = document.createElement("div");
    host.id = HOST_ID + "-toast";
    const root = host.attachShadow({ mode: "closed" });
    const tpl = document.createElement("template");
    tpl.innerHTML = `<div class="toast"><svg viewBox="0 0 24 24" width="15" height="15"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7.5"/></svg><span></span></div>`;
    root.append(styleEl(), tpl.content);
    root.querySelector("span").textContent = `Kerosene updated to v${ver(to)}`;
    (document.body || document.documentElement).append(host);
    setTimeout(() => host.remove(), 4400);
  }

  ext.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "kerosene-update-screen") return;
    if (msg.state === "installing") installing(msg.from, msg.to);
    if (msg.state === "hide") remove();
  });

  ext.storage.local.get("justUpdated").then(({ justUpdated: u }) => {
    if (!u || Date.now() - u.at > 45000) return;
    const key = `kero-updated-${u.to}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch { /* storage blocked: show it anyway */ }
    const go = () => (u.asked ? reveal(u.from, u.to) : toast(u.to));
    if (u.asked) go();
    else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go, { once: true });
    else go();
  }, () => {});
})();
