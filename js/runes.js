/**
 * Geometric rune definitions + live path scoring.
 * Feedback: sharp straight lines (not complex curves) for MR tracking reliability.
 */

/** Normalize points into a unit square centered at origin-ish, for scoring. */
function normalizePath(points) {
  if (!points.length) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const s = Math.max(w, h);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return points.map((p) => ({
    x: (p.x - cx) / s,
    y: (p.y - cy) / s,
  }));
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** Sample polyline at roughly equal arc-length steps. */
function resample(points, n = 32) {
  if (points.length < 2) return points.slice();
  const lengths = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += dist(points[i - 1], points[i]);
    lengths.push(total);
  }
  if (total < 1e-6) return Array(n).fill({ ...points[0] });

  const out = [];
  const step = total / (n - 1);
  let i = 0;
  for (let s = 0; s < n; s++) {
    const target = s * step;
    while (i < lengths.length - 1 && lengths[i + 1] < target) i++;
    const t0 = lengths[i];
    const t1 = lengths[i + 1] ?? t0 + 1e-6;
    const u = (target - t0) / (t1 - t0 || 1);
    const a = points[i];
    const b = points[Math.min(i + 1, points.length - 1)];
    out.push({
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
    });
  }
  return out;
}

/** Average point-to-point distance between two equal-length paths. */
function pathDistance(a, b) {
  const n = Math.min(a.length, b.length);
  if (!n) return 1;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += dist(a[i], b[i]);
  return sum / n;
}

/**
 * Rune templates in normalized 0..1 design space (will be mapped to screen rect).
 * All segments are straight geometric lines.
 */
export const SPELLS = {
  flame: {
    id: "flame",
    name: "Flame Sigil",
    description: "Ignite a fireball from three geometric runes.",
    runes: [
      {
        id: "ignite",
        label: "Ignite",
        // Upward triangle — classic fire mark
        points: [
          { x: 0.5, y: 0.12 },
          { x: 0.88, y: 0.82 },
          { x: 0.12, y: 0.82 },
          { x: 0.5, y: 0.12 },
        ],
      },
      {
        id: "focus",
        label: "Focus",
        // Chevron / arrow-up
        points: [
          { x: 0.2, y: 0.7 },
          { x: 0.5, y: 0.2 },
          { x: 0.8, y: 0.7 },
        ],
      },
      {
        id: "release",
        label: "Release",
        // Vertical bolt with base cross
        points: [
          { x: 0.5, y: 0.15 },
          { x: 0.5, y: 0.85 },
          { x: 0.28, y: 0.85 },
          { x: 0.72, y: 0.85 },
        ],
      },
    ],
  },
};

export class RuneTracer {
  constructor() {
    this.userPath = [];
    this.isDrawing = false;
    this.currentRune = null;
    this.layout = null; // { x, y, w, h } screen rect for rune plane
    this.thresholdGood = 0.14;
    this.thresholdOk = 0.2;
    this.minPathPoints = 8;
  }

  setLayout(rect) {
    this.layout = rect;
  }

  setRune(rune) {
    this.currentRune = rune;
    this.resetPath();
  }

  resetPath() {
    this.userPath = [];
    this.isDrawing = false;
  }

  /** Map design-space 0..1 point to screen pixels. */
  toScreen(p) {
    const L = this.layout;
    if (!L) return { x: p.x, y: p.y };
    return {
      x: L.x + p.x * L.w,
      y: L.y + p.y * L.h,
    };
  }

  getTargetScreenPoints() {
    if (!this.currentRune) return [];
    return this.currentRune.points.map((p) => this.toScreen(p));
  }

  start(x, y) {
    this.isDrawing = true;
    this.userPath = [{ x, y, t: performance.now() }];
  }

  move(x, y) {
    if (!this.isDrawing) return;
    const last = this.userPath[this.userPath.length - 1];
    if (last && dist(last, { x, y }) < 2) return;
    this.userPath.push({ x, y, t: performance.now() });
  }

  end() {
    this.isDrawing = false;
  }

  /**
   * Live progress: how far along the target path the user has traveled,
   * and whether the latest segment is near the ideal corridor.
   */
  liveFeedback() {
    const target = this.getTargetScreenPoints();
    if (!target.length || this.userPath.length < 2) {
      return { progress: 0, state: "idle", nearPath: true, nextIndex: 0 };
    }

    const user = this.userPath;
    // Find closest target vertex progression
    let nextIndex = 0;
    let covered = 0;
    const corridor = Math.max(this.layout?.w || 200, this.layout?.h || 200) * 0.12;

    // Greedy advance along target vertices based on proximity
    for (let i = 0; i < user.length; i++) {
      const p = user[i];
      // Look ahead a few vertices
      for (let j = nextIndex; j < Math.min(nextIndex + 2, target.length); j++) {
        if (dist(p, target[j]) < corridor) {
          nextIndex = Math.min(j + 1, target.length - 1);
          covered = j;
        }
      }
    }

    const last = user[user.length - 1];
    // Distance to nearest point on remaining polyline
    let minD = Infinity;
    for (let i = 0; i < target.length - 1; i++) {
      minD = Math.min(minD, distToSegment(last, target[i], target[i + 1]));
    }
    minD = Math.min(minD, ...target.map((t) => dist(last, t)));

    const nearPath = minD < corridor * 1.35;
    const progress = covered / Math.max(target.length - 1, 1);

    let state = "tracing";
    if (!nearPath) state = "offpath";
    else if (progress > 0.95 && nearPath) state = "almost";

    return { progress, state, nearPath, nextIndex: covered, corridor };
  }

  /**
   * Final evaluation after stroke ends.
   * Returns { ok, score, grade } — no anxiety-inducing % label in UI by default.
   */
  evaluate() {
    const target = this.getTargetScreenPoints();
    if (!target.length || this.userPath.length < this.minPathPoints) {
      return { ok: false, score: 0, grade: "incomplete", reason: "too_short" };
    }

    // Require path to span a reasonable portion of the rune plane
    const userNorm = normalizePath(this.userPath);
    const targetNorm = normalizePath(target);
    const u = resample(userNorm, 48);
    const t = resample(targetNorm, 48);

    const d = pathDistance(u, t);
    // Also try reversed? No — order matters for casting.
    // Score: lower distance better. Map to 0..1 quality.
    const score = Math.max(0, 1 - d / 0.45);

    // Endpoint proximity bonus/penalty
    const startOk = dist(this.userPath[0], target[0]) < (this.layout?.w || 200) * 0.22;
    const endOk =
      dist(this.userPath[this.userPath.length - 1], target[target.length - 1]) <
      (this.layout?.w || 200) * 0.22;

    let ok = score >= 0.45 && startOk;
    // Soften end requirement if overall shape is good
    if (score >= 0.62) ok = true;
    if (!startOk && score < 0.7) ok = false;

    let grade = "miss";
    if (ok && score >= 0.75) grade = "great";
    else if (ok) grade = "good";
    else if (score >= 0.35) grade = "close";

    return { ok, score, grade, startOk, endOk };
  }
}

function distToSegment(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const ab2 = abx * abx + aby * aby || 1e-6;
  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + abx * t, y: a.y + aby * t });
}

/** Demo animation: interpolate along target path over duration. */
export function createDemoAnimator(rune, layout, durationMs = 2200) {
  const pts = rune.points.map((p) => ({
    x: layout.x + p.x * layout.w,
    y: layout.y + p.y * layout.h,
  }));
  // densify
  const dense = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const steps = 16;
    for (let s = 0; s < steps; s++) {
      const u = s / steps;
      dense.push({
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * u,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * u,
      });
    }
  }
  dense.push(pts[pts.length - 1]);

  return {
    durationMs,
    dense,
    at(t01) {
      const i = Math.min(dense.length - 1, Math.floor(t01 * (dense.length - 1)));
      const head = dense[i];
      const drawn = dense.slice(0, i + 1);
      return { head, drawn, done: t01 >= 1 };
    },
  };
}
