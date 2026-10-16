// Storage side of the avatar Sandbox (see content/avatar-main.js, which runs
// in the page's own world and can't reach extension storage). Answers its
// requests over DOM events. Only active in Octane's avatar editor frame.
(() => {
  if (!/^\/theme2020\/avatar\/?$/i.test(location.pathname)) return;
  const S = globalThis.KeroseneSettings;

  const reply = (id, ok, data, error) => {
    document.dispatchEvent(new CustomEvent("kerosene:sandbox-res", { detail: JSON.stringify({ id, ok, data, error }) }));
  };
  const push = (data) => {
    document.dispatchEvent(new CustomEvent("kerosene:sandbox-push", { detail: JSON.stringify(data) }));
  };

  // keep what the page sends small and well-formed
  const cleanItem = (i) => ({
    id: Number(i.id) || 0,
    name: String(i.name || "").slice(0, 200),
    type: Number(i.type) || 0,
    restriction: i.restriction === "limited" || i.restriction === "limited-unique" ? i.restriction : "",
    price: {
      kind: String(i.price?.kind || "offsale").slice(0, 16),
      ...(Number.isFinite(i.price?.robux) ? { robux: i.price.robux } : {}),
      ...(Number.isFinite(i.price?.tix) ? { tix: i.price.tix } : {}),
    },
    slug: String(i.slug || "").slice(0, 200),
  });
  const cleanItems = (items) => (Array.isArray(items) ? items.slice(0, 100).map(cleanItem).filter((i) => i.id) : []);
  const cleanOutfit = (o) => ({
    id: String(o.id || "").slice(0, 40),
    name: String(o.name || "Outfit").slice(0, 60),
    items: cleanItems(o.items),
    created: Number(o.created) || Date.now(),
    updated: Number(o.updated) || Date.now(),
  });

  const handlers = {
    async init() {
      const settings = await S.load();
      const got = await ext.storage.local.get(["sandboxOutfits", "sandboxDraft", "viewer"]);
      return {
        enabled: settings.enabled && settings.avatarSandbox,
        outfits: got.sandboxOutfits || [],
        draft: got.sandboxDraft?.draft || null,
        dirtyDraft: !!got.sandboxDraft?.dirty,
        viewer: got.viewer || null,
      };
    },
    async "save-outfits"(data) {
      const outfits = (Array.isArray(data?.outfits) ? data.outfits : []).slice(0, 500).map(cleanOutfit);
      await ext.storage.local.set({ sandboxOutfits: outfits });
      return true;
    },
    async "save-draft"(data) {
      const d = data?.draft || {};
      const draft = { id: d.id ? String(d.id).slice(0, 40) : null, name: String(d.name || "").slice(0, 60), items: cleanItems(d.items) };
      await ext.storage.local.set({ sandboxDraft: { draft, dirty: !!data?.dirty } });
      return true;
    },
  };

  document.addEventListener("kerosene:sandbox-req", async (e) => {
    let msg;
    try { msg = JSON.parse(e.detail); } catch { return; }
    const fn = handlers[msg?.op];
    if (!fn) return reply(msg?.id, false, null, "unknown op");
    try {
      reply(msg.id, true, await fn(msg.data));
    } catch (err) {
      reply(msg.id, false, null, String(err?.message || err));
    }
  });

  // outfits saved from another tab
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.sandboxOutfits) push({ outfits: changes.sandboxOutfits.newValue || [] });
  });
})();
