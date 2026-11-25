// Bulk unfriend on Octane's friends page (/friends): a "Remove friends" button
// opens a list of all your friends with checkboxes, search and quick filters
// (long offline, deleted or banned). Unfriending goes one at a time through
// the background (the same request Octane's friends page sends), with a
// progress bar and a Stop button.
(() => {
  if (window.top !== window || !/^\/(users\/)?friends\/?$/i.test(location.pathname)) return;
  const S = globalThis.KeroseneSettings;
  const HOST_ID = "kero-bulk-friends"; // not "kerosene-": the theme engine clears those
  const DAY = 86400000;
  const GAP = 700; // between unfriends, gentle on Octane

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .fab { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; display: inline-flex; align-items: center; gap: 8px;
      height: 38px; padding: 0 14px; border-radius: 999px; border: 1px solid rgba(229, 120, 109, .45); background: rgba(24, 24, 27, .95);
      color: #f2c4bf; font: 600 13px system-ui, -apple-system, "Segoe UI", sans-serif; cursor: pointer; box-shadow: 0 10px 28px rgba(0, 0, 0, .45); }
    .fab:hover { background: #2a1e1d; }
    .fab:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid #4fa3e0; outline-offset: 2px; }
    .shade { position: fixed; inset: 0; z-index: 2147483001; background: rgba(0, 0, 0, .6); display: grid; place-items: center; padding: 16px; }
    .box { width: min(560px, 100%); max-height: min(720px, calc(100vh - 32px)); display: flex; flex-direction: column; border-radius: 16px; background: #111214;
      border: 1px solid rgba(255, 255, 255, .08); box-shadow: 0 24px 60px rgba(0, 0, 0, .6); color: #ececec; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; overflow: hidden; }
    .head { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; }
    .head h2 { margin: 0; font: 700 15px ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: #4fa3e0; }
    .head span { color: #8d8d8d; font-size: 12px; }
    .x { margin-left: auto; width: 28px; height: 28px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, .08); background: transparent; color: #bbb; cursor: pointer; font-size: 16px; }
    .tools { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 10px; }
    .tools input { flex: 1 1 180px; height: 30px; padding: 0 10px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, .1); background: #1a1b1e; color: #ececec; font: inherit; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 10px; }
    .chip { height: 26px; padding: 0 10px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, .1); background: transparent; color: #c3c2b7; font: inherit; font-size: 12px; cursor: pointer; }
    .chip:hover { background: rgba(255, 255, 255, .05); }
    .chip[aria-pressed="true"] { border-color: rgba(79, 163, 224, .6); background: rgba(79, 163, 224, .15); color: #fff; }
    .chip.link { margin-left: auto; }
    .list { flex: 1; overflow: auto; border-top: 1px solid rgba(255, 255, 255, .06); border-bottom: 1px solid rgba(255, 255, 255, .06); }
    .row { display: flex; align-items: center; gap: 10px; padding: 7px 16px; cursor: pointer; }
    .row:hover { background: rgba(255, 255, 255, .03); }
    .row input { width: 16px; height: 16px; accent-color: #e5786d; flex-shrink: 0; }
    .row img, .row .ph { width: 30px; height: 30px; border-radius: 50%; background: #222; flex-shrink: 0; object-fit: cover; }
    .who { flex: 1; min-width: 0; }
    .who b { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .who span { color: #8d8d8d; font-size: 11.5px; }
    .tag { flex-shrink: 0; font-size: 10.5px; font-weight: 700; letter-spacing: .3px; padding: 1px 6px; border-radius: 5px; color: #f08f8f; border: 1px solid rgba(229, 120, 109, .4); }
    .on { color: #6ec878 !important; }
    .play { color: #6fbfff !important; }
    .empty { padding: 24px 16px; color: #8d8d8d; text-align: center; }
    .foot { display: flex; align-items: center; gap: 10px; padding: 12px 16px 14px; flex-wrap: wrap; }
    .foot .count { color: #c3c2b7; }
    .foot .msg { flex-basis: 100%; color: #c3c2b7; }
    .foot .msg.err { color: #f08f8f; }
    .btn { height: 32px; padding: 0 14px; border-radius: 9px; border: 1px solid rgba(255, 255, 255, .1); background: #1d1e21; color: #ececec; font: inherit; font-weight: 600; cursor: pointer; }
    .btn:disabled { opacity: .5; cursor: default; }
    .btn.danger { margin-left: auto; border-color: rgba(229, 120, 109, .55); background: rgba(229, 120, 109, .14); color: #f6b3ab; }
    .btn.danger:hover:not(:disabled) { background: rgba(229, 120, 109, .26); }
    .bar { flex-basis: 100%; height: 6px; border-radius: 3px; background: #222; overflow: hidden; }
    .bar i { display: block; height: 100%; width: 0; background: #e5786d; transition: width .3s; }
    @media (prefers-reduced-motion: reduce) { .bar i { transition: none; } }
  `;

  let host = null, root = null;
  let viewer = null, friends = [], presence = {}, avatars = {};
  const chosen = new Set();
  let filter = "all", query = "";
  let phase = "pick"; // pick | confirm | running | done
  let stopAsked = false, progress = { done: 0, failed: 0, total: 0, current: "" }, failures = [];

  const h = (tag, props = {}, children = []) => {
    const n = Object.assign(document.createElement(tag), props);
    for (const c of [].concat(children)) if (c != null) n.append(c);
    return n;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nameOf = (f) => f.displayName || f.name || `#${f.id}`;

  function offlineDays(f) {
    const p = presence[f.id];
    if (!p || p.status !== "offline") return 0;
    return p.lastOnline ? Math.floor((Date.now() - p.lastOnline) / DAY) : Infinity;
  }
  function statusText(f) {
    if (f.deleted) return "deleted account";
    const p = presence[f.id];
    if (p?.status === "ingame") return "playing now";
    if (p?.status === "online" || p?.status === "studio" || (!p && f.online)) return "online";
    const d = offlineDays(f);
    if (d === Infinity) return "offline";
    return d < 1 ? "offline today" : `offline ${d} day${d === 1 ? "" : "s"}`;
  }

  const FILTERS = {
    all: { label: "All", test: () => true },
    off30: { label: "Offline 30+ days", test: (f) => !f.deleted && offlineDays(f) >= 30 },
    off90: { label: "Offline 90+ days", test: (f) => !f.deleted && offlineDays(f) >= 90 },
    gone: { label: "Deleted or banned", test: (f) => f.deleted || f.banned },
  };
  function shown() {
    const q = query.trim().toLowerCase();
    return friends.filter((f) => FILTERS[filter].test(f) && (!q || `${f.displayName} ${f.name} ${f.id}`.toLowerCase().includes(q)));
  }

  // ---------- the button ----------
  function mount() {
    if (host) return;
    host = h("div", { id: HOST_ID });
    root = host.attachShadow({ mode: "open" });
    const style = h("style", { textContent: CSS });
    const fab = h("button", { className: "fab", type: "button", textContent: "Remove friends" });
    fab.addEventListener("click", open);
    root.append(style, fab);
    (document.body || document.documentElement).append(host);
  }
  function unmount() {
    host?.remove();
    host = root = null;
  }

  // ---------- the window ----------
  async function open() {
    if (root.querySelector(".shade")) return;
    phase = "pick";
    chosen.clear();
    const shade = h("div", { className: "shade" });
    shade.addEventListener("click", (e) => { if (e.target === shade && phase !== "running") close(); });
    shade.addEventListener("keydown", (e) => { if (e.key === "Escape" && phase !== "running") close(); });
    const box = h("div", { className: "box", role: "dialog", ariaModal: "true", ariaLabel: "Remove friends" });
    shade.append(box);
    root.append(shade);
    box.append(h("div", { className: "empty", textContent: "Loading your friends…" }));
    try {
      friends = await S.fetchFriendList(viewer.id);
    } catch (err) {
      box.replaceChildren(h("div", { className: "empty", textContent: `Couldn't load your friends (${err.message || err}).` }));
      return;
    }
    render();
    // last online and avatars fill in after the list is up
    const ids = friends.map((f) => f.id);
    S.fetchPresence(ids).then((p) => { presence = p; friends.sort(byLongestOffline); render(); }).catch(() => {});
    S.fetchHeadshots(ids).then((a) => { avatars = a; render(); }).catch(() => {});
  }

  function close() {
    root?.querySelector(".shade")?.remove();
    if (phase === "done" && progress.done) location.reload(); // the page shows the new list
  }

  const byLongestOffline = (a, b) => (b.deleted - a.deleted) || (offlineDays(b) - offlineDays(a)) || nameOf(a).localeCompare(nameOf(b));

  function render() {
    const box = root?.querySelector(".box");
    if (!box) return;
    const keepFocus = root.activeElement?.dataset?.focus;
    box.replaceChildren();

    const head = h("div", { className: "head" }, [h("h2", { textContent: "Remove friends" }), h("span", { textContent: `${friends.length} friends` })]);
    const x = h("button", { className: "x", type: "button", textContent: "×", title: "Close", ariaLabel: "Close", disabled: phase === "running" });
    x.addEventListener("click", close);
    head.append(x);
    box.append(head);

    const locked = phase !== "pick";
    const search = h("input", { type: "search", placeholder: "Search your friends…", value: query, disabled: locked });
    search.dataset.focus = "search";
    search.addEventListener("input", () => { query = search.value; render(); });
    box.append(h("div", { className: "tools" }, search));

    const chips = h("div", { className: "chips" });
    for (const [key, f] of Object.entries(FILTERS)) {
      const c = h("button", { className: "chip", type: "button", textContent: f.label, disabled: locked });
      c.setAttribute("aria-pressed", String(filter === key));
      c.addEventListener("click", () => { filter = key; render(); });
      chips.append(c);
    }
    const list = shown();
    const allOn = list.length > 0 && list.every((f) => chosen.has(f.id));
    const pick = h("button", { className: "chip link", type: "button", textContent: allOn ? "Clear these" : `Select these (${list.length})`, disabled: locked || !list.length });
    pick.addEventListener("click", () => { for (const f of list) allOn ? chosen.delete(f.id) : chosen.add(f.id); render(); });
    chips.append(pick);
    box.append(chips);

    const ul = h("div", { className: "list", role: "list" });
    for (const f of list) {
      const cb = h("input", { type: "checkbox", checked: chosen.has(f.id), disabled: locked, ariaLabel: `Remove ${nameOf(f)}` });
      cb.dataset.focus = `cb-${f.id}`;
      cb.addEventListener("change", () => { cb.checked ? chosen.add(f.id) : chosen.delete(f.id); render(); });
      const img = avatars[f.id] && /^https:\/\//.test(avatars[f.id]) ? h("img", { src: avatars[f.id], alt: "", referrerPolicy: "no-referrer", loading: "lazy" }) : h("span", { className: "ph" });
      const st = statusText(f);
      const row = h("label", { className: "row", role: "listitem" }, [
        cb, img,
        h("span", { className: "who" }, [h("b", { textContent: nameOf(f) }), h("span", { className: st === "online" ? "on" : st === "playing now" ? "play" : "", textContent: `@${f.name} · ${st}` })]),
        f.deleted ? h("span", { className: "tag", textContent: "DELETED" }) : f.banned ? h("span", { className: "tag", textContent: "BANNED" }) : null,
      ]);
      ul.append(row);
    }
    if (!list.length) ul.append(h("div", { className: "empty", textContent: friends.length ? "Nobody matches." : "You have no friends on Octane yet." }));
    box.append(ul);

    box.append(footer());
    if (keepFocus) root.querySelector(`[data-focus="${keepFocus}"]`)?.focus();
  }

  function footer() {
    const foot = h("div", { className: "foot" });
    const n = chosen.size;
    if (phase === "pick") {
      const go = h("button", { className: "btn danger", type: "button", textContent: n ? `Unfriend ${n}` : "Unfriend", disabled: !n });
      go.addEventListener("click", () => { phase = "confirm"; render(); root.querySelector(".btn.danger")?.focus(); });
      foot.append(h("span", { className: "count", textContent: `${n} selected` }), go);
    } else if (phase === "confirm") {
      const yes = h("button", { className: "btn danger", type: "button", textContent: `Yes, unfriend ${n}` });
      const no = h("button", { className: "btn", type: "button", textContent: "Back" });
      yes.addEventListener("click", run);
      no.addEventListener("click", () => { phase = "pick"; render(); });
      foot.append(h("span", { className: "msg", textContent: `Unfriend ${n} ${n === 1 ? "person" : "people"}? This can't be undone; you'd have to send new friend requests.` }), no, yes);
    } else {
      const bar = h("div", { className: "bar" }, h("i"));
      bar.firstChild.style.width = `${progress.total ? Math.round(((progress.done + progress.failed) / progress.total) * 100) : 0}%`;
      if (phase === "running") {
        const stop = h("button", { className: "btn", type: "button", textContent: stopAsked ? "Stopping…" : "Stop", disabled: stopAsked });
        stop.addEventListener("click", () => { stopAsked = true; render(); });
        foot.append(bar, h("span", { className: "count", textContent: `Unfriending ${progress.done + progress.failed + 1} of ${progress.total}: ${progress.current}` }), stop);
      } else {
        const lines = [`Removed ${progress.done} of ${progress.total}.`];
        if (progress.failed) lines.push(`${progress.failed} didn't go through. ${failures.slice(0, 3).join(" ")}${failures.length > 3 ? " …" : ""}`);
        const done = h("button", { className: "btn danger", type: "button", textContent: progress.done ? "Close and refresh" : "Close" });
        done.addEventListener("click", close);
        foot.append(bar, h("span", { className: `msg${progress.failed ? " err" : ""}`, textContent: lines.join(" ") }), done);
      }
    }
    return foot;
  }

  async function run() {
    const queue = friends.filter((f) => chosen.has(f.id));
    phase = "running";
    stopAsked = false;
    failures = [];
    progress = { done: 0, failed: 0, total: queue.length, current: "" };
    for (const f of queue) {
      if (stopAsked) break;
      progress.current = nameOf(f);
      render();
      const res = await ext.runtime.sendMessage({ type: "unfriend", userId: f.id }).catch((err) => ({ error: String(err?.message || err) }));
      if (res?.ok) {
        progress.done++;
        chosen.delete(f.id);
        friends = friends.filter((x) => x.id !== f.id);
      } else {
        progress.failed++;
        failures.push(`${nameOf(f)}: ${res?.error || "no answer"}`);
        if (/signed out/i.test(res?.error || "")) break; // the rest would fail the same way
      }
      await sleep(GAP);
    }
    progress.total = progress.done + progress.failed; // after a Stop, count what was tried
    phase = "done";
    render();
  }

  async function update() {
    const got = await ext.storage.local.get({ viewer: null, enabled: true }).catch(() => null);
    viewer = got?.viewer || null;
    if (!viewer?.id || !got.enabled) return unmount();
    mount();
  }
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.viewer || changes.enabled)) update();
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", update, { once: true });
  else update();
})();
