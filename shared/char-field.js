// Interactive character field (claude.ai/code style): a grid of dim glyphs on
// OLED black whose density follows drifting simplex noise. Glyphs keep
// scrambling, the brightest patches glow in the accent colour, the cursor
// stirs and lights up the field, and clicks send out a ripple.
(() => {
  const GLYPHS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const LEVELS = 10;

  const COLORS = {
    blue: [79, 163, 224],
    orange: [217, 119, 87],
    purple: [139, 108, 240],
    green: [110, 200, 120],
    white: [235, 235, 235],
  };

  // ---------- 3D simplex noise (after Stefan Gustavson) ----------
  const GRAD3 = new Int8Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
  ]);

  function makeNoise() {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [p[i], p[j]] = [p[j], p[i]];
    }
    const perm = new Uint8Array(512);
    const pm12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      perm[i] = p[i & 255];
      pm12[i] = perm[i] % 12;
    }
    const F3 = 1 / 3, G3 = 1 / 6;

    function corner(t, gi, x, y, z) {
      if (t < 0) return 0;
      t *= t;
      return t * t * (GRAD3[gi] * x + GRAD3[gi + 1] * y + GRAD3[gi + 2] * z);
    }

    return function noise3(xin, yin, zin) {
      const s = (xin + yin + zin) * F3;
      const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
      const t = (i + j + k) * G3;
      const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
      let i1, j1, k1, i2, j2, k2;
      if (x0 >= y0) {
        if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
        else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
        else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
      } else {
        if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
        else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
        else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      }
      const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
      const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
      const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
      const ii = i & 255, jj = j & 255, kk = k & 255;
      const n0 = corner(0.6 - x0 * x0 - y0 * y0 - z0 * z0, pm12[ii + perm[jj + perm[kk]]] * 3, x0, y0, z0);
      const n1 = corner(0.6 - x1 * x1 - y1 * y1 - z1 * z1, pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3, x1, y1, z1);
      const n2 = corner(0.6 - x2 * x2 - y2 * y2 - z2 * z2, pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3, x2, y2, z2);
      const n3 = corner(0.6 - x3 * x3 - y3 * y3 - z3 * z3, pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3, x3, y3, z3);
      return 32 * (n0 + n1 + n2 + n3);
    };
  }

  // ---------- field ----------
  function create(canvas, opts = {}) {
    const fontSize = opts.fontSize || 10;
    const bg = opts.background || "#0a0a0a";
    let accent = COLORS[opts.color] || COLORS.blue;
    const interactive = opts.interactive !== false;

    const ctx = canvas.getContext("2d");
    const noise = makeNoise();
    const atlas = document.createElement("canvas");
    const actx = atlas.getContext("2d");

    let dpr = 1, cw = 0, ch = 0, cols = 0, rows = 0;
    let glyphs = new Uint8Array(0);
    let running = true, rafId = null, lastFrame = 0;
    const t0 = performance.now();

    const mouse = { x: -9999, y: -9999, energy: 0, target: 0 };
    const ripples = [];

    function buildAtlas() {
      const tones = [[200, 200, 200], accent];
      atlas.width = GLYPHS.length * cw;
      atlas.height = tones.length * LEVELS * ch;
      actx.clearRect(0, 0, atlas.width, atlas.height);
      actx.font = `${fontSize * dpr}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
      actx.textBaseline = "middle";
      actx.textAlign = "center";
      tones.forEach((rgb, tone) => {
        for (let lv = 0; lv < LEVELS; lv++) {
          const f = (lv + 1) / LEVELS;
          // grey glyphs stay dim; accent glyphs are allowed to glow
          const a = tone === 0 ? 0.03 + 0.34 * Math.pow(f, 1.6) : 0.25 + 0.75 * f;
          actx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`;
          const y = (tone * LEVELS + lv) * ch + ch / 2;
          for (let g = 0; g < GLYPHS.length; g++) {
            actx.fillText(GLYPHS[g], g * cw + cw / 2, y);
          }
        }
      });
    }

    function resize() {
      dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      cw = Math.round(fontSize * 0.68 * dpr);
      ch = Math.round(fontSize * 1.15 * dpr);
      cols = Math.ceil(canvas.width / cw);
      rows = Math.ceil(canvas.height / ch);
      glyphs = new Uint8Array(cols * rows);
      for (let i = 0; i < glyphs.length; i++) glyphs[i] = (Math.random() * GLYPHS.length) | 0;
      buildAtlas();
      draw(performance.now());
    }

    function draw(now) {
      const t = (now - t0) / 1000;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      mouse.energy += (mouse.target - mouse.energy) * 0.08;
      const mx = mouse.x * dpr, my = mouse.y * dpr;
      const mr = 75 * dpr, mr2 = 2 * mr * mr;

      for (let i = ripples.length - 1; i >= 0; i--) {
        if (now - ripples[i].start > 1600) ripples.splice(i, 1);
      }

      // a little background shimmer: random glyphs swap every frame
      const swaps = (glyphs.length * 0.012) | 0;
      for (let s = 0; s < swaps; s++) {
        glyphs[(Math.random() * glyphs.length) | 0] = (Math.random() * GLYPHS.length) | 0;
      }

      const sx = 0.045 * (11 / fontSize), sy = 0.075 * (11 / fontSize);
      const drift = t * 0.35, tz = t * 0.12;

      for (let r = 0; r < rows; r++) {
        const py = r * ch;
        const cy = py + ch / 2;
        for (let c = 0; c < cols; c++) {
          const px = c * cw;
          const nx = c * sx + drift, ny = r * sy;
          let n = noise(nx, ny, tz) * 0.65 + noise(nx * 2.3, ny * 2.3, tz * 1.7) * 0.35;
          // low noise stays empty, high noise forms the drifting patches
          let v = (n + 0.02) / 0.85;
          if (v < 0) v = 0;
          v = Math.pow(v, 1.7);

          let boost = 0;
          if (interactive && mouse.energy > 0.01) {
            const dx = px + cw / 2 - mx, dy = cy - my;
            boost = Math.exp(-(dx * dx + dy * dy) / mr2) * mouse.energy;
          }
          for (let k = 0; k < ripples.length; k++) {
            const rp = ripples[k];
            const age = (now - rp.start) / 1600;
            const rad = age * 340 * dpr;
            const dx = px + cw / 2 - rp.x * dpr, dy = cy - rp.y * dpr;
            const d = Math.sqrt(dx * dx + dy * dy) - rad;
            boost += Math.exp(-(d * d) / (2 * 220 * dpr)) * (1 - age) * 0.9;
          }

          const idx = r * cols + c;
          if (boost > 0.25 && Math.random() < boost * 0.35) {
            glyphs[idx] = (Math.random() * GLYPHS.length) | 0;
          }

          const total = v * 0.8 + boost * 0.85;
          if (total < 0.035) continue;

          let tone = 0, lv;
          if (total > 0.72 || boost > 0.4) {
            tone = 1;
            lv = Math.min(LEVELS - 1, ((total - 0.35) * 1.4 * LEVELS) | 0);
          } else {
            lv = Math.min(LEVELS - 1, ((total / 0.72) * LEVELS) | 0);
          }
          if (lv < 0) lv = 0;
          ctx.drawImage(
            atlas,
            glyphs[idx] * cw, (tone * LEVELS + lv) * ch, cw, ch,
            px, py, cw, ch,
          );
        }
      }
    }

    function frame(now) {
      rafId = null;
      if (!running) return;
      // ~30fps is plenty for this effect and keeps the CPU cool
      if (now - lastFrame >= 32) {
        lastFrame = now;
        draw(now);
      }
      rafId = requestAnimationFrame(frame);
    }

    function setRunning(on) {
      running = on;
      if (on && rafId === null) rafId = requestAnimationFrame(frame);
      if (!on && rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    function setColor(name) {
      accent = COLORS[name] || COLORS.blue;
      buildAtlas();
      if (!running) draw(performance.now());
    }

    const local = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onMove = (e) => {
      const p = local(e);
      mouse.x = p.x; mouse.y = p.y; mouse.target = 1;
    };
    const onLeave = (e) => { if (!e.relatedTarget) mouse.target = 0; };
    // touch: pointermove stops once the browser starts scrolling, touchmove doesn't
    const onTouch = (e) => {
      const t = e.touches[0];
      if (t) onMove({ clientX: t.clientX, clientY: t.clientY });
    };
    const onRelease = (e) => { if (e.pointerType !== "mouse") mouse.target = 0; };
    const onTouchEnd = () => { mouse.target = 0; };
    const onDown = (e) => {
      const p = local(e);
      ripples.push({ x: p.x, y: p.y, start: performance.now() });
      if (ripples.length > 4) ripples.shift();
    };

    if (interactive) {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onDown, { passive: true });
      document.addEventListener("mouseout", onLeave);
      window.addEventListener("touchstart", onTouch, { passive: true });
      window.addEventListener("touchmove", onTouch, { passive: true });
      window.addEventListener("touchend", onTouchEnd, { passive: true });
      window.addEventListener("touchcancel", onTouchEnd, { passive: true });
      window.addEventListener("pointerup", onRelease, { passive: true });
    }
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setRunning(!reduced && opts.animate !== false);

    function destroy() {
      setRunning(false);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.removeEventListener("mouseout", onLeave);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("pointerup", onRelease);
    }

    return { setRunning, setColor, destroy };
  }

  window.KeroseneField = { create, colors: Object.keys(COLORS), rgb: COLORS };
})();
