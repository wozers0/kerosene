// Kerosene's update window. The popup opened it with the signed .xpi, so
// Firefox is already showing its two install prompts above this page. Once
// the new version is installed it closes this window and takes over.
(async () => {
  const S = globalThis.KeroseneSettings;
  const F = globalThis.KeroseneField;
  const q = new URLSearchParams(location.search);
  const from = q.get("from") || ext.runtime.getManifest().version;
  const to = q.get("to") || "";

  const settings = await S.load().catch(() => ({ fieldColor: "blue", animatedBg: true }));
  const rgb = (F.rgb || {})[settings.fieldColor];
  if (rgb) document.documentElement.style.setProperty("--accent", rgb.join(", "));
  F.create(document.getElementById("field"), { color: settings.fieldColor, animate: settings.animatedBg !== false });

  const b = document.createElement("b");
  b.textContent = `v${to.replace(/[^\d.]/g, "")}`;
  document.getElementById("versions").replaceChildren(`v${from} \u2192 `, b);

  // Nothing happened (prompt dismissed, or Firefox missed the file): offer a
  // retry from here. A click on this page is enough for Firefox to ask again.
  const actions = document.getElementById("actions");
  setTimeout(() => {
    actions.hidden = false;
    document.getElementById("note").textContent = "No prompt, or closed it by accident? Try again.";
  }, 15000);

  document.getElementById("retry").addEventListener("click", async () => {
    let staged = await ext.runtime.sendMessage({ type: "update-staged" }).catch(() => null);
    if (!staged?.url) {
      const info = await S.fetchLatestRelease().catch(() => null);
      if (info) staged = await ext.runtime.sendMessage({ type: "update-restage", info }).catch(() => null);
    }
    if (!staged?.url) {
      document.getElementById("note").textContent = staged?.error || "Couldn't download the update. Check your connection and try again.";
      return;
    }
    location.href = staged.url; // the page stays; Firefox shows its prompts
  });
  document.getElementById("cancel").addEventListener("click", () => window.close());
})();
