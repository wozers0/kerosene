// Animated "Claude Code" style background: columns of syntax-highlighted
// code drifting upward on a dark canvas, with an occasional line being typed.
(() => {
  const canvas = document.getElementById("code-bg");
  const ctx = canvas.getContext("2d");

  const SNIPPETS = [
    "local Players = game:GetService(\"Players\")",
    "local RunService = game:GetService(\"RunService\")",
    "function ignite(fuel) return fuel * 1.21 end",
    "Players.PlayerAdded:Connect(function(plr)",
    "  print(\"[kerosene] hello, \" .. plr.Name)",
    "end)",
    "const octane = await fetch('/v1/games')",
    "for _, part in ipairs(workspace:GetChildren()) do",
    "  part.Anchored = true",
    "if not humanoid then return end",
    "export async function boot() {",
    "  await loadFeatures({ hot: true })",
    "}",
    "> claude --resume kerosene",
    "✓ Edited popup.css (+42 -3)",
    "✓ Read manifest.json",
    "● Thinking…",
    "local tween = TweenService:Create(gui, info, goal)",
    "tween:Play()",
    "chrome.storage.sync.get(\"settings\")",
    "while task.wait(0.1) do",
    "  flame.Size += Vector3.new(0, 0.05, 0)",
    "return { name = \"kerosene\", version = \"0.1.0\" }",
    "// octane revival — 2021/2022",
    "RemoteEvent:FireServer(\"refuel\", 100)",
    "const user = JSON.parse(raw) ?? {}",
    "$ npm run build",
    "local function onTouched(hit)",
  ];

  const KEYWORDS = new Set([
    "local", "function", "end", "return", "if", "then", "for", "do", "in", "not",
    "while", "const", "await", "async", "export", "let", "true", "false",
  ]);

  const COLORS = {
    plain: "rgba(240, 238, 230, 0.20)",
    keyword: "rgba(217, 119, 87, 0.55)",
    string: "rgba(166, 196, 120, 0.40)",
    number: "rgba(214, 170, 110, 0.45)",
    comment: "rgba(155, 150, 138, 0.30)",
    prompt: "rgba(217, 119, 87, 0.70)",
    ok: "rgba(127, 176, 105, 0.55)",
  };

  const FONT_SIZE = 11;
  const LINE_H = 16;
  const SPEED = 0.18; // px per frame
  const font = `${FONT_SIZE}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;

  let width = 0, height = 0, dpr = 1;
  let lines = [];
  let offset = 0;
  let typing = null;
  let running = true;
  let rafId = null;

  const pick = () => SNIPPETS[(Math.random() * SNIPPETS.length) | 0];

  function tokenize(text) {
    const t = text.trimStart();
    if (t.startsWith("//") || t.startsWith("--")) return [{ s: text, c: COLORS.comment }];
    if (t.startsWith(">") || t.startsWith("$")) return [{ s: text, c: COLORS.prompt }];
    if (t.startsWith("✓")) return [{ s: text, c: COLORS.ok }];
    if (t.startsWith("●")) return [{ s: text, c: COLORS.keyword }];

    const out = [];
    const re = /("[^"]*"|'[^']*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]+\b|\s+|.)/g;
    let m;
    while ((m = re.exec(text))) {
      const s = m[0];
      let c = COLORS.plain;
      if (s[0] === '"' || s[0] === "'") c = COLORS.string;
      else if (/^\d/.test(s)) c = COLORS.number;
      else if (KEYWORDS.has(s)) c = COLORS.keyword;
      out.push({ s, c });
    }
    return out;
  }

  function makeLine() {
    const text = pick();
    return { tokens: tokenize(text), x: 10 + ((Math.random() * 3) | 0) * 14 };
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const needed = Math.ceil(height / LINE_H) + 2;
    while (lines.length < needed) lines.push(makeLine());
  }

  function drawTokens(tokens, x, y, maxChars = Infinity) {
    let used = 0;
    for (const tok of tokens) {
      if (used >= maxChars) break;
      const s = tok.s.slice(0, maxChars - used);
      ctx.fillStyle = tok.c;
      ctx.fillText(s, x, y);
      x += ctx.measureText(s).width;
      used += s.length;
    }
    return x;
  }

  function frame() {
    ctx.clearRect(0, 0, width, height);
    ctx.font = font;
    ctx.textBaseline = "top";

    offset += SPEED;
    if (offset >= LINE_H) {
      offset -= LINE_H;
      lines.shift();
      lines.push(makeLine());
      // occasionally start "typing" a fresh line near the bottom
      if (!typing && Math.random() < 0.25) {
        typing = { idx: lines.length - 4, chars: 0 };
      }
      if (typing) typing.idx--;
    }

    for (let i = 0; i < lines.length; i++) {
      const y = i * LINE_H - offset + 6;
      const ln = lines[i];


      if (typing && typing.idx === i) {
        const total = ln.tokens.reduce((n, t) => n + t.s.length, 0);
        typing.chars = Math.min(total, typing.chars + 0.6);
        const endX = drawTokens(ln.tokens, ln.x, y, typing.chars | 0);
        ctx.fillStyle = "rgba(217, 119, 87, 0.8)";
        ctx.fillRect(endX + 1, y, 6, FONT_SIZE + 1);
        if (typing.chars >= total || typing.idx < 2) typing = null;
      } else {
        drawTokens(ln.tokens, ln.x, y);
      }
    }

    if (running) rafId = requestAnimationFrame(frame);
  }

  function setRunning(on) {
    running = on;
    canvas.style.opacity = on ? "1" : "0.35";
    if (on && rafId === null) rafId = requestAnimationFrame(frame);
    if (!on && rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  window.addEventListener("resize", resize);
  resize();

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  frame(); // paint once so the background is never blank
  if (reduced) setRunning(false);

  window.KeroseneBg = { setRunning };
})();
