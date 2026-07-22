/**
 * Mid-fi AR renderer: spellbook, rune plane, trail, fireball particles.
 * Canvas 2D keeps the demo light and reliable for class presentations.
 */

const GOLD = "#e8c76a";
const GOLD_B = "#ffe9a0";
const EMBER = "#ff6b2c";
const CORRECT = "#5dff9a";
const WRONG = "#ff5d6c";
const IDLE = "#9bb7ff";

export class ARRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.w = 0;
    this.h = 0;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.spellbook = {
      open: 0, // 0 closed → 1 open
      glow: 0,
      page: 0,
      visible: false,
      yOffset: 40,
    };
    // Illustrated cover has a proper book silhouette; procedural rendering is
    // retained for the open spread where pages need to animate with the runes.
    this.closedBookImage = new Image();
    this.closedBookImage.src = new URL("../assets/spellbook-closed.svg", import.meta.url).href;

    this.runeLayout = null;
    this.ghostPath = [];
    this.demoDrawn = [];
    this.demoHead = null;
    this.userPath = [];
    this.feedbackState = "idle"; // idle | tracing | offpath | success | fail
    this.showGhost = true;
    this.guideDots = [];
    this.startDot = null;

    this.particles = [];
    this.fireball = null; // { x, y, life, maxLife, scale }
    this.sparks = [];
    this.ambient = [];

    this._resize();
    window.addEventListener("resize", () => this._resize());
    this._seedAmbient();
  }

  _resize() {
    const { canvas } = this;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    canvas.width = Math.floor(this.w * this.dpr);
    canvas.height = Math.floor(this.h * this.dpr);
    canvas.style.width = `${this.w}px`;
    canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._updateRuneLayout();
  }

  _updateRuneLayout() {
    // Give hands enough room to draw. The old 19% square was sized more like an
    // icon than a gesture target, especially on a phone camera preview.
    const size = Math.min(this.w * 0.72, this.h * 0.44);
    this.runeLayout = {
      x: (this.w - size) / 2,
      y: Math.max(86, this.h * 0.16),
      w: size,
      h: size,
    };
  }

  getRuneLayout() {
    if (!this.runeLayout) this._updateRuneLayout();
    return this.runeLayout;
  }

  _seedAmbient() {
    this.ambient = Array.from({ length: 28 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.6 + Math.random() * 1.8,
      sp: 0.15 + Math.random() * 0.4,
      ph: Math.random() * Math.PI * 2,
    }));
  }

  setSpellbook({ open, glow, page, visible, yOffset }) {
    if (open != null) this.spellbook.open = open;
    if (glow != null) this.spellbook.glow = glow;
    if (page != null) this.spellbook.page = page;
    if (visible != null) this.spellbook.visible = visible;
    if (yOffset != null) this.spellbook.yOffset = yOffset;
  }

  setRuneVisual({ ghostPath, demoDrawn, demoHead, userPath, feedbackState, showGhost, guideDots, startDot }) {
    if (ghostPath !== undefined) this.ghostPath = ghostPath;
    if (demoDrawn !== undefined) this.demoDrawn = demoDrawn;
    if (demoHead !== undefined) this.demoHead = demoHead;
    if (userPath !== undefined) this.userPath = userPath;
    if (feedbackState !== undefined) this.feedbackState = feedbackState;
    if (showGhost !== undefined) this.showGhost = showGhost;
    if (guideDots !== undefined) this.guideDots = guideDots;
    if (startDot !== undefined) this.startDot = startDot;
  }

  spawnFireball(cx, cy) {
    this.fireball = {
      x: cx,
      y: cy,
      life: 0,
      maxLife: 2.4,
      scale: 0,
    };
    // Burst particles
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 220;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        life: 0.6 + Math.random() * 0.9,
        age: 0,
        r: 2 + Math.random() * 5,
        hue: 20 + Math.random() * 30,
      });
    }
    for (let i = 0; i < 20; i++) {
      this.sparks.push({
        x: cx,
        y: cy,
        vx: (Math.random() - 0.5) * 40,
        vy: -60 - Math.random() * 120,
        life: 1 + Math.random(),
        age: 0,
      });
    }
  }

  clearEffects() {
    this.particles = [];
    this.sparks = [];
    this.fireball = null;
  }

  update(dt) {
    // Particles
    for (const p of this.particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 120 * dt;
      p.vx *= 0.98;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);

    for (const s of this.sparks) {
      s.age += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 30 * dt;
    }
    this.sparks = this.sparks.filter((s) => s.age < s.life);

    if (this.fireball) {
      this.fireball.life += dt;
      const t = this.fireball.life / this.fireball.maxLife;
      // grow then float up and fade
      if (t < 0.25) this.fireball.scale = easeOutBack(t / 0.25);
      else this.fireball.scale = 1 + (t - 0.25) * 0.35;
      this.fireball.y -= 28 * dt;
      if (this.fireball.life >= this.fireball.maxLife) this.fireball = null;
    }
  }

  draw(time = 0) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);

    this._drawAmbient(time);
    if (this.spellbook.visible) this._drawSpellbook(time);
    this._drawRunePlane(time);
    this._drawParticles();
    if (this.fireball) this._drawFireball(time);
  }

  _drawAmbient(time) {
    const { ctx, w, h } = this;
    for (const a of this.ambient) {
      const x = a.x * w + Math.sin(time * a.sp + a.ph) * 12;
      const y = ((a.y * h + time * a.sp * 18) % (h + 20)) - 10;
      const alpha = 0.15 + 0.15 * Math.sin(time * 2 + a.ph);
      ctx.beginPath();
      ctx.fillStyle = `rgba(255, 200, 120, ${alpha})`;
      ctx.arc(x, y, a.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Pseudo-3D spellbook: perspective tilt, page-block thickness,
   * hinged covers, layered paper edges, contact shadow, specular leather.
   */
  _drawSpellbook(time) {
    const { ctx, w, h, spellbook } = this;
    const open = clamp(spellbook.open, 0, 1);
    const cx = w / 2;
    // Sit a bit lower so the larger open spread stays in frame
    // Lower the book to create a dedicated space above it for the active rune.
    const cy = h * 0.61 + spellbook.yOffset * 0.35;

    // A deliberately oversized, weighty grimoire. Keep it responsive enough
    // to remain fully readable on a narrow phone screen.
    // Portrait proportions: a real tome, rather than a landscape placard.
    const bw = Math.min(w * 0.56, 470);
    const bh = bw * 1.34;
    const thickness = bw * 0.15; // a substantial, old page block

    // Camera / pose — slight 3/4 view + idle sway
    const sway = Math.sin(time * 0.7) * 0.05;
    const bob = Math.sin(time * 1.1) * 3;
    const pitch = 0.7; // retain the height and presence of a standing tome
    const yaw = 0.12 + sway; // left-right perspective skew
    const roll = sway * 0.08;

    ctx.save();
    ctx.translate(cx, cy + bob);
    ctx.rotate(roll);

    // ---- Contact shadow on the "floor" of the room ----
    const shadowW = bw * (0.55 + open * 0.55);
    const shadowH = bh * (0.1 + open * 0.04) * pitch;
    ctx.save();
    ctx.translate(yaw * 18, bh * 0.38 * pitch + thickness * 0.35);
    ctx.scale(1, 0.28);
    const sh = ctx.createRadialGradient(0, 0, 4, 0, 0, shadowW);
    sh.addColorStop(0, `rgba(0,0,0,${0.45 + open * 0.12})`);
    sh.addColorStop(0.55, `rgba(0,0,0,${0.18})`);
    sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(0, 0, shadowW, shadowW * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Magical aura under / around the volume
    const pulse = 0.55 + 0.45 * Math.sin(time * 2.5);
    const g = ctx.createRadialGradient(0, -bh * 0.05, 8, 0, 0, bw * (0.75 + open * 0.25));
    g.addColorStop(0, `rgba(255, 180, 60, ${0.22 * spellbook.glow * pulse})`);
    g.addColorStop(0.45, `rgba(255, 120, 30, ${0.08 * spellbook.glow})`);
    g.addColorStop(1, "rgba(255, 80, 10, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, bw * (0.7 + open * 0.35), bh * 0.55 * pitch + thickness, 0, 0, Math.PI * 2);
    ctx.fill();

    // Project helper: design (x,y,z) → screen
    // x: right, y: up (negative is up on page), z: toward camera
    const project = (x, y, z) => {
      const yy = y * pitch + z * 0.35; // tilt: depth lifts bottom edge
      const xx = x + y * yaw * 0.15 + z * yaw * 0.4;
      return { x: xx, y: yy };
    };

    if (open < 0.12) {
      if (this.closedBookImage.complete && this.closedBookImage.naturalWidth) {
        // A large but fully readable cover, constrained by viewport height.
        const imgW = Math.min(bw * 1.18, h * 0.58);
        const imgH = imgW * (720 / 512);
        ctx.save();
        ctx.translate(8, -imgH * 0.025);
        ctx.drawImage(this.closedBookImage, -imgW / 2, -imgH / 2, imgW, imgH);
        ctx.restore();
      } else {
        this._drawClosedBook3D(project, bw, bh, thickness, time, open);
      }
    } else {
      this._drawOpenBook3D(project, bw, bh, thickness, time, open, spellbook.page);
    }

    ctx.restore();
  }

  _drawClosedBook3D(project, bw, bh, thickness, time, open) {
    const { ctx } = this;
    const hw = bw / 2;
    const hh = bh / 2;
    const t = thickness;
    // Slight pre-open: top cover lifts a hair
    const lift = open * 18;

    // Page block (bottom) — visible thickness between covers
    const pageTop = [
      project(-hw + 6, -hh + 8, 0),
      project(hw - 6, -hh + 8, 0),
      project(hw - 6, hh - 8, 0),
      project(-hw + 6, hh - 8, 0),
    ];
    const pageBot = [
      project(-hw + 6, -hh + 8, -t),
      project(hw - 6, -hh + 8, -t),
      project(hw - 6, hh - 8, -t),
      project(-hw + 6, hh - 8, -t),
    ];

    // Bottom cover (back)
    this._fillQuad(
      [
        project(-hw, -hh, -t),
        project(hw, -hh, -t),
        project(hw, hh, -t),
        project(-hw, hh, -t),
      ],
      "#1c1008"
    );

    // Page block side (fore-edge — paper stack)
    this._fillQuad(
      [pageTop[1], pageBot[1], pageBot[2], pageTop[2]],
      "#d9c89a"
    );
    // Layered page lines on fore-edge
    for (let i = 0; i < 7; i++) {
      const u = (i + 1) / 8;
      const a = lerpPt(pageTop[1], pageBot[1], u);
      const b = lerpPt(pageTop[2], pageBot[2], u);
      ctx.beginPath();
      ctx.strokeStyle = i % 2 === 0 ? "rgba(90,60,30,0.25)" : "rgba(255,245,220,0.35)";
      ctx.lineWidth = 1;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Page block bottom edge
    this._fillQuad(
      [pageTop[2], pageBot[2], pageBot[3], pageTop[3]],
      "#c4b07e"
    );

    // Spine side (left)
    this._fillQuad(
      [
        project(-hw, -hh, 0),
        project(-hw, -hh, -t),
        project(-hw, hh, -t),
        project(-hw, hh, 0),
      ],
      "#2a160c"
    );
    // Spine gold bands
    const s0 = project(-hw, -hh * 0.55, -t * 0.2);
    const s1 = project(-hw, -hh * 0.55, -t * 0.8);
    const s2 = project(-hw, hh * 0.55, -t * 0.8);
    const s3 = project(-hw, hh * 0.55, -t * 0.2);
    this._fillQuad([s0, s1, s2, s3], "rgba(232,199,106,0.35)");

    // Top cover front (with lift as it starts to open)
    const cover = [
      project(-hw, -hh - lift * 0.15, lift * 0.02),
      project(hw, -hh - lift * 0.15, lift * 0.02),
      project(hw, hh, 0),
      project(-hw, hh, 0),
    ];
    this._drawLeatherFace(cover, time, true, bw);

    // Cover top thickness rim (toward camera-top)
    this._fillQuad(
      [
        project(-hw, -hh, 0),
        project(hw, -hh, 0),
        project(hw, -hh, 4),
        project(-hw, -hh, 4),
      ],
      "#4a2e18"
    );

    // Specular streak across leather
    this._drawLeatherSpec(cover, time);
  }

  _drawOpenBook3D(project, bw, bh, thickness, time, open, page) {
    const { ctx } = this;
    const hw = bw / 2;
    const hh = bh / 2;
    const t = thickness * (1 - open * 0.35);

    // Cover open angles (0 closed → ~1 flat open). Ease for hinge feel.
    const ang = easeOutCubic(open) * 0.92;
    // When open, covers lie nearly flat; residual scale keeps perspective foreshortening
    // Keep the open spread broad; this is a large tome, not a thin notebook.
    const lSx = 0.46 + (1 - ang) * 0.54;
    const rSx = 0.46 + (1 - ang) * 0.54;
    // Spread distance from spine
    const spread = hw * (0.15 + ang * 0.95);
    // Covers tip slightly up at outer edges (curl)
    const curl = ang * 10;

    // ---- Page block base (center) ----
    const baseZ = -t * 0.5;
    this._fillQuad(
      [
        project(-hw * 0.08, -hh * 0.92, baseZ),
        project(hw * 0.08, -hh * 0.92, baseZ),
        project(hw * 0.08, hh * 0.92, baseZ),
        project(-hw * 0.08, hh * 0.92, baseZ),
      ],
      "#160c08"
    );

    // Stacked paper edges in the gutter
    for (let i = 0; i < 5; i++) {
      const z = -t * (0.15 + i * 0.12);
      const inset = 2 + i;
      ctx.beginPath();
      const a = project(-4, -hh * 0.9 + inset, z);
      const b = project(4, -hh * 0.9 + inset, z);
      const c = project(4, hh * 0.9 - inset, z);
      const d = project(-4, hh * 0.9 - inset, z);
      ctx.fillStyle = i % 2 ? "#d5bd82" : "#bfa36a";
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fill();
    }

    // ---- Left cover (outer leather) behind left page ----
    const leftOuter = [
      project(-spread * lSx - hw * lSx, -hh - curl * 0.2, ang * 2),
      project(-spread * 0.05, -hh, 0),
      project(-spread * 0.05, hh, 0),
      project(-spread * lSx - hw * lSx, hh + curl * 0.1, ang * 2),
    ];
    // Decorated leather boards remain visibly broad around the open pages.
    // This makes the grimoire feel like a physical object throughout tracing,
    // rather than turning into two anonymous sheets of paper when opened.
    this._drawLeatherFace(leftOuter, time, false, bw);
    // Thickness rim on left cover outer edge
    const leftRim = [
      leftOuter[0],
      offsetPt(leftOuter[0], -6, 3),
      offsetPt(leftOuter[3], -6, 3),
      leftOuter[3],
    ];
    this._fillQuad(leftRim, "#3b1b12");

    // ---- Right cover ----
    const rightOuter = [
      project(spread * 0.05, -hh, 0),
      project(spread * rSx + hw * rSx, -hh - curl * 0.2, ang * 2),
      project(spread * rSx + hw * rSx, hh + curl * 0.1, ang * 2),
      project(spread * 0.05, hh, 0),
    ];
    this._drawLeatherFace(rightOuter, time, false, bw);
    const rightRim = [
      rightOuter[1],
      offsetPt(rightOuter[1], 6, 3),
      offsetPt(rightOuter[2], 6, 3),
      rightOuter[2],
    ];
    this._fillQuad(rightRim, "#3b1b12");

    // Two old leather straps wrap the exposed outer boards. They sit behind
    // the pages but are clearly visible on the generous cover margins.
    const strapY = [-hh * 0.48, hh * 0.48];
    for (const y of strapY) {
      const leftA = project(-spread * lSx - hw * lSx, y - 8, ang * 2 + 2);
      const leftB = project(-spread * 0.05, y - 8, 2);
      const leftC = project(-spread * 0.05, y + 8, 2);
      const leftD = project(-spread * lSx - hw * lSx, y + 8, ang * 2 + 2);
      this._fillQuad([leftA, leftB, leftC, leftD], "rgba(24, 9, 8, 0.78)");
      ctx.beginPath();
      this._pathQuad([leftA, leftB, leftC, leftD]);
      ctx.strokeStyle = "rgba(181, 123, 58, 0.7)";
      ctx.lineWidth = 1;
      ctx.stroke();

      const rightA = project(spread * 0.05, y - 8, 2);
      const rightB = project(spread * rSx + hw * rSx, y - 8, ang * 2 + 2);
      const rightC = project(spread * rSx + hw * rSx, y + 8, ang * 2 + 2);
      const rightD = project(spread * 0.05, y + 8, 2);
      this._fillQuad([rightA, rightB, rightC, rightD], "rgba(24, 9, 8, 0.78)");
      ctx.beginPath();
      this._pathQuad([rightA, rightB, rightC, rightD]);
      ctx.strokeStyle = "rgba(181, 123, 58, 0.7)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // ---- Open pages (slight Y curl via quadratic edge) ----
    this._drawOpenPage3D(
      project,
      -spread * 0.02,
      // Extend the paper nearly to the outer board, leaving a slim leather
      // reveal. Previously this stopped halfway across the cover, producing
      // two narrow paper strips between oversized boards.
      -spread * lSx - hw * lSx + 14,
      hh,
      "left",
      page,
      time,
      ang,
      lSx
    );
    this._drawOpenPage3D(
      project,
      spread * 0.02,
      spread * rSx + hw * rSx - 14,
      hh,
      "right",
      page,
      time,
      ang,
      rSx
    );

    // Spine highlight / gold ribbon in gutter
    const g0 = project(-3, -hh * 0.88, 2);
    const g1 = project(3, -hh * 0.88, 2);
    const g2 = project(3, hh * 0.88, 2);
    const g3 = project(-3, hh * 0.88, 2);
    const spineGrad = ctx.createLinearGradient(g0.x, g0.y, g1.x, g1.y);
    spineGrad.addColorStop(0, "rgba(232,199,106,0.15)");
    spineGrad.addColorStop(0.5, `rgba(255,220,120,${0.55 + 0.2 * Math.sin(time * 3)})`);
    spineGrad.addColorStop(1, "rgba(232,199,106,0.15)");
    this._fillQuad([g0, g1, g2, g3], spineGrad);

    // Soft AO in the gutter
    ctx.save();
    const ao = ctx.createLinearGradient(project(-hw * 0.5, 0, 0).x, 0, project(hw * 0.5, 0, 0).x, 0);
    ao.addColorStop(0, "rgba(0,0,0,0)");
    ao.addColorStop(0.45, "rgba(0,0,0,0.22)");
    ao.addColorStop(0.55, "rgba(0,0,0,0.22)");
    ao.addColorStop(1, "rgba(0,0,0,0)");
    const aoBox = [
      project(-hw * 0.55, -hh * 0.9, 1),
      project(hw * 0.55, -hh * 0.9, 1),
      project(hw * 0.55, hh * 0.9, 1),
      project(-hw * 0.55, hh * 0.9, 1),
    ];
    this._fillQuad(aoBox, ao);
    ctx.restore();

    // Floating dust motes near open pages
    for (let i = 0; i < 6; i++) {
      const px = Math.sin(time * 1.3 + i * 1.7) * hw * 0.7;
      const py = Math.cos(time * 0.9 + i) * hh * 0.35 - 8;
      const p = project(px, py, 8 + i);
      ctx.beginPath();
      ctx.fillStyle = `rgba(255, 210, 120, ${0.15 + 0.15 * Math.sin(time * 2 + i)})`;
      ctx.arc(p.x, p.y, 1.2 + (i % 3) * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawOpenPage3D(project, spineX, outerX, hh, side, page, time, ang, sx) {
    const { ctx } = this;
    const isLeft = side === "left";
    // Page corners with slight outer lift (paper curl)
    const curlZ = 3 + ang * 6;
    const topOuterY = -hh * 0.9 - ang * 4;
    const botOuterY = hh * 0.9 + ang * 2;

    const tl = project(isLeft ? outerX : spineX, topOuterY, isLeft ? curlZ : 1);
    const tr = project(isLeft ? spineX : outerX, topOuterY, isLeft ? 1 : curlZ);
    const br = project(isLeft ? spineX : outerX, botOuterY, isLeft ? 1 : curlZ);
    const bl = project(isLeft ? outerX : spineX, botOuterY, isLeft ? curlZ : 1);

    // Paper face
    const pg = ctx.createLinearGradient(tl.x, tl.y, tr.x, tr.y);
    if (isLeft) {
      pg.addColorStop(0, "#a98450");
      pg.addColorStop(0.7, "#d8bd80");
      pg.addColorStop(1, "#c9a86b");
    } else {
      pg.addColorStop(0, "#c9a86b");
      pg.addColorStop(0.3, "#dfc58c");
      pg.addColorStop(1, "#a98450");
    }
    this._fillQuad([tl, tr, br, bl], pg);

    // Page edge thickness (outer)
    if (isLeft) {
      const edge = [
        tl,
        offsetPt(tl, -4, 2),
        offsetPt(bl, -4, 2),
        bl,
      ];
      this._fillQuad(edge, "#987745");
    } else {
      const edge = [
        tr,
        offsetPt(tr, 4, 2),
        offsetPt(br, 4, 2),
        br,
      ];
      this._fillQuad(edge, "#987745");
    }

    // Inner page border
    ctx.save();
    ctx.beginPath();
    this._pathQuad([tl, tr, br, bl]);
    ctx.clip();

    // Content in page UV space (approximate with screen positions)
    const midX = (tl.x + tr.x + br.x + bl.x) / 4;
    const midY = (tl.y + tr.y + br.y + bl.y) / 4;
    const pageW = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const pageH = Math.hypot(bl.x - tl.x, bl.y - tl.y);

    // Ruled text lines
    ctx.strokeStyle = "rgba(90, 55, 25, 0.22)";
    ctx.lineWidth = 1.2;
    const lineCount = 8;
    for (let i = 0; i < lineCount; i++) {
      const v = 0.18 + i * 0.08;
      const a = lerpPt(tl, bl, v);
      const b = lerpPt(tr, br, v);
      const inset = isLeft ? 0.12 : 0.08;
      const a2 = lerpPt(a, b, isLeft ? inset : 0.08);
      const b2 = lerpPt(a, b, isLeft ? 0.92 : 1 - inset);
      const len = 0.55 + (i % 3) * 0.1;
      const b3 = lerpPt(a2, b2, isLeft ? 1 - (1 - len) * 0.3 : len);
      ctx.beginPath();
      ctx.moveTo(a2.x, a2.y);
      ctx.lineTo(b3.x, b3.y);
      ctx.stroke();
    }

    // Decorative corner flourishes
    ctx.strokeStyle = "rgba(180, 130, 50, 0.4)";
    ctx.lineWidth = 1;
    const c0 = lerpPt(tl, br, 0.08);
    ctx.beginPath();
    ctx.arc(c0.x, c0.y, 5, 0, Math.PI * 1.5);
    ctx.stroke();

    if (isLeft) {
      ctx.fillStyle = "rgba(90, 50, 20, 0.72)";
      ctx.font = `600 ${Math.max(10, pageW * 0.07)}px Cinzel, serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const title = lerpPt(lerpPt(tl, tr, 0.5), lerpPt(bl, br, 0.5), 0.1);
      ctx.fillText("Apprentice Notes", title.x, title.y);
    } else {
      // Rune sketch with slight perspective
      const rc = lerpPt(lerpPt(tl, tr, 0.5), lerpPt(bl, br, 0.5), 0.58);
      ctx.save();
      ctx.translate(rc.x, rc.y);
      ctx.scale(sx * 0.9 + 0.3, 1);
      ctx.strokeStyle = `rgba(196, 58, 10, ${0.55 + 0.25 * Math.sin(time * 2)})`;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = EMBER;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(0, -pageH * 0.12);
      ctx.lineTo(pageW * 0.12, pageH * 0.1);
      ctx.lineTo(-pageW * 0.12, pageH * 0.1);
      ctx.closePath();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();

      ctx.fillStyle = "rgba(90, 50, 20, 0.75)";
      ctx.font = `600 ${Math.max(10, pageW * 0.065)}px Cinzel, serif`;
      ctx.textAlign = "center";
      const label = lerpPt(lerpPt(tl, tr, 0.5), lerpPt(bl, br, 0.5), 0.88);
      ctx.fillText(page === 0 ? "Flame Sigil" : "Page " + (page + 1), label.x, label.y);
    }

    // Spine-side shade (depth into gutter)
    const shade = ctx.createLinearGradient(
      isLeft ? tr.x : tl.x,
      0,
      isLeft ? lerpPt(tl, tr, 0.35).x : lerpPt(tl, tr, 0.65).x,
      0
    );
    shade.addColorStop(0, "rgba(40, 25, 10, 0.28)");
    shade.addColorStop(1, "rgba(40, 25, 10, 0)");
    this._fillQuad([tl, tr, br, bl], shade);

    // Soft paper highlight
    const hi = ctx.createLinearGradient(0, tl.y, 0, br.y);
    hi.addColorStop(0, "rgba(255,255,255,0.18)");
    hi.addColorStop(0.35, "rgba(255,255,255,0)");
    this._fillQuad([tl, tr, br, bl], hi);

    ctx.restore();

    // Page outline
    ctx.beginPath();
    this._pathQuad([tl, tr, br, bl]);
    ctx.strokeStyle = "rgba(90, 60, 30, 0.28)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  _drawLeatherFace(quad, time, withEmblem, bw) {
    const { ctx } = this;
    const [tl, tr, br, bl] = quad;
    const midX = (tl.x + tr.x) / 2;
    const midY = (tl.y + bl.y) / 2;

    // Deep oxblood leather, aged by smoke, handling, and time.
    const lg = ctx.createLinearGradient(tl.x, tl.y, br.x, br.y);
    lg.addColorStop(0, "#633326");
    lg.addColorStop(0.24, "#3d1b17");
    lg.addColorStop(0.55, "#24100f");
    lg.addColorStop(0.8, "#160909");
    lg.addColorStop(1, "#0c0607");
    this._fillQuad(quad, lg);

    // Tarnished brass edging rather than a clean gold outline.
    ctx.beginPath();
    this._pathQuad(quad);
    ctx.strokeStyle = "#9d7134";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Inner engraved frames (corners lerp toward center)
    const center = { x: midX, y: (tl.y + tr.y + br.y + bl.y) / 4 };
    const inn = quad.map((p) => lerpPt(p, center, 0.12));
    ctx.beginPath();
    this._pathQuad(inn);
    ctx.strokeStyle = "rgba(166, 111, 52, 0.6)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    const inn2 = quad.map((p) => lerpPt(p, center, 0.18));
    ctx.beginPath();
    this._pathQuad(inn2);
    ctx.strokeStyle = "rgba(132, 77, 39, 0.48)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Small scars and creases make the cover read as hand-bound leather.
    ctx.save();
    ctx.beginPath();
    this._pathQuad(quad);
    ctx.clip();
    ctx.strokeStyle = "rgba(205, 137, 82, 0.16)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const y = midY - bw * 0.19 + i * bw * 0.045;
      ctx.beginPath();
      ctx.moveTo(midX - bw * 0.28, y + Math.sin(i * 1.9) * 3);
      ctx.bezierCurveTo(midX - bw * 0.08, y - 5, midX + bw * 0.1, y + 5, midX + bw * 0.28, y - 2);
      ctx.stroke();
    }
    ctx.restore();

    // Riveted metal corners.
    for (const p of inn) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(4, bw * 0.017), 0, Math.PI * 2);
      ctx.fillStyle = "#5e3c1b";
      ctx.fill();
      ctx.strokeStyle = "#bd9148";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (withEmblem) {
      const pulse = 0.72 + 0.28 * Math.sin(time * 2.2);
      const cx = center.x;
      const cy = center.y + 4;
      const r = Math.min(bw * 0.13, 38);

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(20, 8, 7, 0.8)";
      ctx.fill();
      ctx.strokeStyle = "#b2833e";
      ctx.lineWidth = 2.4;
      ctx.shadowColor = "rgba(220, 144, 47, 0.55)";
      ctx.shadowBlur = 6 * pulse;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Etched four-point ward inside the seal.
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 2;
        const x = cx + Math.cos(a) * r * 0.68;
        const y = cy + Math.sin(a) * r * 0.68;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(222, 121, 43, ${0.62 + 0.18 * pulse})`;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = EMBER;
      ctx.shadowBlur = 8 * pulse;
      ctx.stroke();
      ctx.shadowBlur = 0;

    }
  }

  _drawLeatherSpec(quad, time) {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    this._pathQuad(quad);
    ctx.clip();
    const [tl, tr, br, bl] = quad;
    const t = (Math.sin(time * 1.4) + 1) * 0.5;
    const a = lerpPt(tl, bl, 0.15 + t * 0.1);
    const b = lerpPt(tr, br, 0.35 + t * 0.1);
    const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    grad.addColorStop(0, "rgba(255,230,180,0)");
    grad.addColorStop(0.45, "rgba(255,230,180,0.14)");
    grad.addColorStop(0.55, "rgba(255,230,180,0.14)");
    grad.addColorStop(1, "rgba(255,230,180,0)");
    ctx.fillStyle = grad;
    this._pathQuad(quad);
    ctx.fill();
    ctx.restore();
  }

  _pathQuad(quad) {
    const { ctx } = this;
    const [a, b, c, d] = quad;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
  }

  _fillQuad(quad, fill) {
    const { ctx } = this;
    if (!quad || quad.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return;
    ctx.beginPath();
    this._pathQuad(quad);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  _drawRunePlane(time) {
    const { ctx } = this;
    const L = this.getRuneLayout();

    // Soft plane glow
    const rg = ctx.createRadialGradient(
      L.x + L.w / 2,
      L.y + L.h / 2,
      10,
      L.x + L.w / 2,
      L.y + L.h / 2,
      L.w * 0.65
    );
    rg.addColorStop(0, "rgba(80, 120, 255, 0.08)");
    rg.addColorStop(1, "rgba(80, 120, 255, 0)");
    ctx.fillStyle = rg;
    ctx.fillRect(L.x - 40, L.y - 40, L.w + 80, L.h + 80);

    // Ghost path (tutorial guide)
    if (this.showGhost && this.ghostPath.length > 1) {
      this._strokePath(this.ghostPath, IDLE, 6, 0.28, true);
    }

    // Demo animated stroke
    if (this.demoDrawn.length > 1) {
      this._strokePath(this.demoDrawn, GOLD_B, 5, 0.95, false);
      if (this.demoHead) {
        ctx.beginPath();
        ctx.fillStyle = GOLD_B;
        ctx.shadowColor = GOLD;
        ctx.shadowBlur = 16;
        ctx.arc(this.demoHead.x, this.demoHead.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // User path with state color
    if (this.userPath.length > 1) {
      let color = IDLE;
      if (this.feedbackState === "tracing" || this.feedbackState === "almost") color = CORRECT;
      if (this.feedbackState === "offpath") color = WRONG;
      if (this.feedbackState === "success") color = CORRECT;
      if (this.feedbackState === "fail") color = WRONG;
      this._strokePath(this.userPath, color, 5.5, 0.95, false);
    }

    // Guide vertices
    for (let i = 0; i < this.guideDots.length; i++) {
      const d = this.guideDots[i];
      const pulse = 0.7 + 0.3 * Math.sin(time * 3 + i);
      ctx.beginPath();
      ctx.fillStyle = i === 0 ? CORRECT : `rgba(155, 183, 255, ${0.55 * pulse})`;
      ctx.shadowColor = i === 0 ? CORRECT : IDLE;
      ctx.shadowBlur = i === 0 ? 14 : 6;
      ctx.arc(d.x, d.y, i === 0 ? 8 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Start green dot emphasis (David feedback)
    if (this.startDot) {
      const p = 0.65 + 0.35 * Math.sin(time * 4);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(93, 255, 154, ${0.5 * p})`;
      ctx.lineWidth = 2;
      ctx.arc(this.startDot.x, this.startDot.y, 14 + 4 * p, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  _strokePath(points, color, width, alpha, dashed) {
    const { ctx } = this;
    if (points.length < 2) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = color;
    ctx.shadowBlur = dashed ? 4 : 12;
    if (dashed) ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
    ctx.restore();
  }

  _drawParticles() {
    const { ctx } = this;
    for (const p of this.particles) {
      const t = 1 - p.age / p.life;
      ctx.beginPath();
      ctx.fillStyle = `hsla(${p.hue}, 100%, ${50 + t * 20}%, ${t})`;
      ctx.arc(p.x, p.y, p.r * t, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const s of this.sparks) {
      const t = 1 - s.age / s.life;
      ctx.beginPath();
      ctx.strokeStyle = `rgba(255, 220, 120, ${t})`;
      ctx.lineWidth = 1.5;
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * 0.05, s.y - s.vy * 0.05);
      ctx.stroke();
    }
  }

  _drawFireball(time) {
    const { ctx, fireball } = this;
    if (!fireball) return;
    const t = fireball.life / fireball.maxLife;
    const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    const r = 36 * fireball.scale;

    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(fireball.x, fireball.y);

    // Outer glow
    const g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 2.2);
    g.addColorStop(0, "rgba(255, 220, 100, 0.9)");
    g.addColorStop(0.35, "rgba(255, 100, 30, 0.65)");
    g.addColorStop(1, "rgba(255, 40, 0, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Core
    const core = ctx.createRadialGradient(-r * 0.2, -r * 0.2, 0, 0, 0, r);
    core.addColorStop(0, "#fff6d0");
    core.addColorStop(0.35, "#ffb040");
    core.addColorStop(0.7, "#ff4a10");
    core.addColorStop(1, "#a01000");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Flicker lobes
    for (let i = 0; i < 5; i++) {
      const a = time * 6 + i * 1.2;
      const lx = Math.cos(a) * r * 0.35;
      const ly = Math.sin(a * 1.3) * r * 0.4 - r * 0.2;
      ctx.beginPath();
      ctx.fillStyle = `rgba(255, 180, 40, ${0.35 + 0.2 * Math.sin(a)})`;
      ctx.ellipse(lx, ly, r * 0.35, r * 0.55, a, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function easeOutBack(t) {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function lerpPt(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function offsetPt(p, dx, dy) {
  return { x: p.x + dx, y: p.y + dy };
}
