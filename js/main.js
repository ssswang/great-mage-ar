/**
 * Journey to Be the Great Mage — Mid-Fidelity AR Demo
 * Task 3: Learn a new spell (Observe → Trace → Combine & Cast)
 *
 * Incorporates low-fi user testing feedback:
 * - Geometric straight-line runes
 * - Ancient leather spellbook with glow / page life
 * - Fireball reward
 * - Live color feedback (idle / tracing / off-path)
 * - Glowing fingertip (not mouse cursor)
 * - Bottom captions
 * - Auto-retry / auto-advance (no Retry button)
 * - Unguided practice mode
 * - Minimal scores (no anxiety-inducing accuracy %)
 */

import { ARRenderer } from "./renderer.js";
import { SPELLS, RuneTracer, createDemoAnimator } from "./runes.js";
import { InputManager, VoiceCommands } from "./input.js";

const $ = (id) => document.getElementById(id);

const PHASE = {
  IDLE: "idle",
  BOOK_APPEAR: "book_appear",
  BOOK_OPEN: "book_open",
  PAGE_FLIP: "page_flip",
  DEMO: "demo",
  TRACE: "trace",
  SUCCESS_FLASH: "success_flash",
  PRACTICE: "practice",
  COMBINE: "combine",
  CAST: "cast",
  DONE: "done",
};

class Game {
  constructor() {
    this.canvas = $("ar-canvas");
    this.video = $("camera");
    this.fallback = $("camera-fallback");
    this.fingertip = $("fingertip");
    this.caption = $("caption");
    this.hint = $("hint");
    this.spellProgress = $("spell-progress");
    this.runeDots = $("rune-dots");
    this.spellName = $("spell-name");
    this.startPanel = $("start-panel");
    this.endPanel = $("end-panel");
    this.softControls = $("soft-controls");
    this.inputStatus = $("input-status");
    this.inputLabel = $("input-label");
    this.btnVoice = $("btn-voice");

    this.renderer = new ARRenderer(this.canvas);
    this.tracer = new RuneTracer();
    this.spell = SPELLS.flame;
    this.runeIndex = 0;
    this.phase = PHASE.IDLE;
    this.useCamera = false;
    this.unguided = false;
    this.phaseT = 0;
    this.demoAnim = null;
    this.lastTs = 0;
    this.captionQueue = null;
    this.canTrace = false;
    this.combinePaths = [];
    this.bookReadyForSwipe = false;
    this.bookSwipeStart = null;

    this.input = new InputManager({
      onMove: (x, y, down) => this._onMove(x, y, down),
      onDown: (x, y) => this._onDown(x, y),
      onUp: (x, y) => this._onUp(x, y),
    });

    this.voice = new VoiceCommands((cmd) => this._onVoice(cmd));

    this._bindUI();
    this._loop = this._loop.bind(this);
  }

  _bindUI() {
    $("btn-start-ar").addEventListener("click", () => this.start(true));
    $("btn-start-mouse").addEventListener("click", () => this.start(false));
    $("btn-again").addEventListener("click", () => this.restart(false));
    $("btn-practice").addEventListener("click", () => this.restart(true));
    $("btn-restart").addEventListener("click", () => this.restart(this.unguided));
    this.btnVoice.addEventListener("click", () => {
      if (!this.voice.supported) {
        this.setCaption("Voice commands are not supported in this browser.");
        return;
      }
      const on = this.voice.toggle();
      this.btnVoice.classList.toggle("active", on);
      this.setCaption(on ? "Voice on — try “next”, “again”, or “cast”." : "Voice off.");
    });
  }

  async start(withCamera) {
    this.useCamera = withCamera;
    this.startPanel.classList.add("hidden");
    this.endPanel.classList.add("hidden");
    this.softControls.classList.remove("hidden");
    this.inputStatus.classList.remove("hidden");
    this.spellProgress.classList.remove("hidden");
    document.body.classList.add("playing");
    this.fingertip.classList.remove("hidden");

    this._buildRuneDots();
    this.spellName.textContent = this.spell.name;

    if (withCamera) {
      const ok = await this._initCamera();
      if (!ok) {
        this.setCaption("Camera blocked — continuing with room backdrop.");
        this.fallback.classList.add("room");
      } else {
        // Try hand tracking (optional enhancement)
        const hands = await this.input.tryEnableHands(this.video);
        this.inputLabel.textContent = hands ? "Hand tracking" : "Pointer (camera on)";
        if (!hands) this.input.enablePointer();
      }
    } else {
      this.video.classList.add("hidden");
      this.fallback.classList.add("room");
      this.input.enablePointer();
      this.inputLabel.textContent = "Pointer";
    }

    if (withCamera && this.input.mode === "hand") {
      // already enabled
    } else if (!this.input.enabled) {
      this.input.enablePointer();
    }

    this.unguided = false;
    this.runeIndex = 0;
    this.combinePaths = [];
    this.renderer.clearEffects();
    this._enter(PHASE.BOOK_APPEAR);
    this.lastTs = performance.now();
    requestAnimationFrame(this._loop);
  }

  async _initCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      this.video.srcObject = stream;
      this.video.classList.remove("hidden");
      this.fallback.style.display = "none";
      await this.video.play();
      return true;
    } catch (err) {
      console.warn(err);
      this.video.classList.add("hidden");
      this.fallback.style.display = "block";
      this.fallback.classList.add("room");
      return false;
    }
  }

  restart(unguided = false) {
    this.endPanel.classList.add("hidden");
    this.unguided = unguided;
    this.runeIndex = 0;
    this.combinePaths = [];
    this.renderer.clearEffects();
    this.renderer.setSpellbook({ visible: true, open: 1, glow: 1, yOffset: 80 });
    this._buildRuneDots();
    if (unguided) {
      this.setCaption("Unguided practice — draw from memory. No ghost path.");
      this.setHint("Hold and trace · release when done");
      this._enter(PHASE.PRACTICE);
    } else {
      this.setCaption("The spellbook remembers you. Watch the first rune.");
      this._enter(PHASE.DEMO);
    }
  }

  _buildRuneDots() {
    this.runeDots.innerHTML = "";
    this.spell.runes.forEach((_, i) => {
      const d = document.createElement("div");
      d.className = "dot" + (i === 0 ? " active" : "");
      d.dataset.i = String(i);
      this.runeDots.appendChild(d);
    });
  }

  _updateDots() {
    [...this.runeDots.children].forEach((el, i) => {
      el.classList.toggle("done", i < this.runeIndex);
      el.classList.toggle("active", i === this.runeIndex && this.phase !== PHASE.DONE);
    });
  }

  setCaption(text) {
    this.caption.style.opacity = "0";
    clearTimeout(this.captionQueue);
    this.captionQueue = setTimeout(() => {
      this.caption.textContent = text;
      this.caption.style.opacity = "1";
    }, 120);
  }

  setHint(text) {
    if (!text) {
      this.hint.classList.add("hidden");
      this.hint.textContent = "";
      return;
    }
    this.hint.textContent = text;
    this.hint.classList.remove("hidden");
  }

  _enter(phase) {
    this.phase = phase;
    this.phaseT = 0;
    this.canTrace = false;
    this.demoAnim = null;
    this.tracer.resetPath();

    const layout = this.renderer.getRuneLayout();
    this.tracer.setLayout(layout);

    switch (phase) {
      case PHASE.BOOK_APPEAR:
        this.bookReadyForSwipe = false;
        this.bookSwipeStart = null;
        this.renderer.setSpellbook({
          visible: true,
          open: 0,
          glow: 0.3,
          page: 0,
          yOffset: 60,
        });
        this.renderer.setRuneVisual({
          ghostPath: [],
          demoDrawn: [],
          demoHead: null,
          userPath: [],
          guideDots: [],
          startDot: null,
          showGhost: false,
          feedbackState: "idle",
        });
        this.setCaption("An old spellbook materializes in your room…");
        this.setHint("");
        break;

      case PHASE.BOOK_OPEN:
        this.setCaption("It opens — leather warm with old gold light.");
        break;

      case PHASE.PAGE_FLIP:
        this.renderer.setSpellbook({ page: 0, yOffset: 90 });
        this.setCaption("Flip through the apprentice notes… Flame Sigil awaits.");
        this.setHint(this.voice.supported ? 'Say “next” or wait' : "Wait a moment…");
        break;

      case PHASE.DEMO: {
        this._updateDots();
        const rune = this.spell.runes[this.runeIndex];
        this.tracer.setRune(rune);
        const ghost = this.tracer.getTargetScreenPoints();
        // Give each stroke enough time to be observed before tracing begins.
        this.demoAnim = createDemoAnimator(rune, layout, 4800);
        this.renderer.setSpellbook({ open: 1, glow: 1, yOffset: 110 });
        this.renderer.setRuneVisual({
          ghostPath: ghost,
          demoDrawn: [],
          demoHead: null,
          userPath: [],
          guideDots: ghost,
          startDot: ghost[0],
          showGhost: true,
          feedbackState: "idle",
        });
        this.setCaption(
          `Observe: ${rune.label} rune. Watch the golden path — then mirror it.`
        );
        this.setHint("Demonstration · no need to draw yet");
        break;
      }

      case PHASE.TRACE: {
        const rune = this.spell.runes[this.runeIndex];
        this.tracer.setRune(rune);
        const ghost = this.tracer.getTargetScreenPoints();
        this.canTrace = true;
        this.renderer.setRuneVisual({
          ghostPath: ghost,
          demoDrawn: [],
          demoHead: null,
          userPath: [],
          guideDots: ghost,
          startDot: ghost[0],
          showGhost: !this.unguided,
          feedbackState: "idle",
        });
        this.setCaption(
          `Trace the ${rune.label} rune. Start at the green glow.`
        );
        this.setHint(
          this.input.mode === "hand"
            ? "Pinch to draw · release to finish"
            : "Hold pointer to draw · release to finish"
        );
        break;
      }

      case PHASE.PRACTICE: {
        this.runeIndex = 0;
        this._updateDots();
        const rune = this.spell.runes[0];
        this.tracer.setRune(rune);
        this.canTrace = true;
        this.unguided = true;
        this.renderer.setRuneVisual({
          ghostPath: [],
          demoDrawn: [],
          userPath: [],
          guideDots: [],
          startDot: this.tracer.getTargetScreenPoints()[0],
          showGhost: false,
          feedbackState: "idle",
        });
        this.setCaption("From memory: draw Ignite → Focus → Release.");
        this.setHint("Only the start glow remains · no ghost path");
        break;
      }

      case PHASE.SUCCESS_FLASH:
        this.canTrace = false;
        this.renderer.setRuneVisual({ feedbackState: "success" });
        break;

      case PHASE.COMBINE: {
        // Continuous full spell: all runes chained in one motion concept —
        // for mid-fi we re-show each quickly then cast
        this.canTrace = false;
        this.setCaption("Runes aligned. Gathering flame…");
        this.setHint("");
        this.renderer.setRuneVisual({
          ghostPath: [],
          guideDots: [],
          startDot: null,
          userPath: [],
          demoDrawn: [],
          showGhost: false,
        });
        break;
      }

      case PHASE.CAST: {
        const L = layout;
        this.renderer.spawnFireball(L.x + L.w / 2, L.y + L.h * 0.45);
        this.setCaption("Flame Sigil — cast! The fireball answers your hand.");
        this.setHint("");
        break;
      }

      case PHASE.DONE:
        this.endPanel.classList.remove("hidden");
        document.body.classList.remove("playing");
        this.fingertip.classList.add("hidden");
        break;
    }
  }

  _onVoice(cmd) {
    if (cmd === "again") {
      this.restart(this.unguided);
      return;
    }
    if (cmd === "next" && this.phase === PHASE.BOOK_APPEAR && this.bookReadyForSwipe) {
      this._enter(PHASE.BOOK_OPEN);
      return;
    }
    if (cmd === "next" && (this.phase === PHASE.PAGE_FLIP || this.phase === PHASE.DEMO)) {
      if (this.phase === PHASE.PAGE_FLIP) this._enter(PHASE.DEMO);
      else if (this.phase === PHASE.DEMO) this._enter(PHASE.TRACE);
      return;
    }
    if (cmd === "cast" && this.runeIndex >= this.spell.runes.length - 1) {
      this._enter(PHASE.COMBINE);
    }
  }

  _onDown(x, y) {
    this._updateFingertip(x, y, true);
    if (this.phase === PHASE.BOOK_APPEAR && this.bookReadyForSwipe) {
      this.bookSwipeStart = { x, y };
      return;
    }
    if (!this.canTrace) return;
    // Only start if near start dot (when guided) or anywhere (practice with start glow)
    const start = this.tracer.getTargetScreenPoints()[0];
    if (start && !this.unguided) {
      const d = Math.hypot(x - start.x, y - start.y);
      const corridor = Math.max(this.tracer.layout.w, this.tracer.layout.h) * 0.18;
      if (d > corridor) {
        this.setHint("Start at the green glowing point");
        return;
      }
    }
    this.tracer.start(x, y);
    this.fingertip.classList.add("drawing");
    this.fingertip.classList.remove("offpath");
  }

  _onMove(x, y, down) {
    this._updateFingertip(x, y, down || this.tracer.isDrawing);
    if (this.tracer.isDrawing) {
      this.tracer.move(x, y);
      const fb = this.tracer.liveFeedback();
      this.renderer.setRuneVisual({
        userPath: this.tracer.userPath,
        feedbackState: fb.state === "offpath" ? "offpath" : "tracing",
      });
      this.fingertip.classList.toggle("offpath", fb.state === "offpath");
      this.fingertip.classList.toggle("drawing", fb.state !== "offpath");
    }
  }

  _onUp(x, y) {
    this._updateFingertip(x, y, false);
    this.fingertip.classList.remove("drawing", "offpath");
    if (this.phase === PHASE.BOOK_APPEAR && this.bookReadyForSwipe) {
      const start = this.bookSwipeStart;
      this.bookSwipeStart = null;
      const dx = start ? x - start.x : 0;
      const dy = start ? y - start.y : 0;
      if (dx < -65 && Math.abs(dy) < 110) {
        this._enter(PHASE.BOOK_OPEN);
      } else {
        this.setHint("Swipe left across the book to open it");
      }
      return;
    }
    if (!this.tracer.isDrawing && this.tracer.userPath.length === 0) return;
    if (!this.canTrace) return;

    this.tracer.end();
    const result = this.tracer.evaluate();

    if (result.ok) {
      this.renderer.setRuneVisual({
        userPath: this.tracer.userPath,
        feedbackState: "success",
      });
      this.combinePaths.push([...this.tracer.userPath]);
      this._enter(PHASE.SUCCESS_FLASH);
      // auto-advance — no confirm button (interaction decision)
      const finishedRune = this.runeIndex;
      setTimeout(() => {
        if (this.unguided) {
          // practice: advance through all three from memory
          if (finishedRune < this.spell.runes.length - 1) {
            this.runeIndex = finishedRune + 1;
            this._updateDots();
            const rune = this.spell.runes[this.runeIndex];
            this.tracer.setRune(rune);
            this.tracer.setLayout(this.renderer.getRuneLayout());
            this.canTrace = true;
            this.phase = PHASE.PRACTICE;
            this.phaseT = 0;
            this.renderer.setRuneVisual({
              userPath: [],
              startDot: this.tracer.getTargetScreenPoints()[0],
              feedbackState: "idle",
            });
            this.setCaption(`Good. Next from memory: ${rune.label}.`);
          } else {
            this._enter(PHASE.COMBINE);
          }
        } else if (finishedRune < this.spell.runes.length - 1) {
          this.runeIndex = finishedRune + 1;
          this._updateDots();
          this.setCaption("Rune sealed. Next pattern appears…");
          setTimeout(() => this._enter(PHASE.DEMO), 700);
        } else {
          this._enter(PHASE.COMBINE);
        }
      }, 650);
    } else {
      // Auto-retry — no Retry button
      this.renderer.setRuneVisual({
        userPath: this.tracer.userPath,
        feedbackState: "fail",
      });
      this.setCaption(
        result.reason === "too_short"
          ? "Trace the full shape — follow the path longer."
          : "The rune faltered. Path resets — try again."
      );
      setTimeout(() => {
        this.tracer.resetPath();
        this.renderer.setRuneVisual({
          userPath: [],
          feedbackState: "idle",
        });
        this.canTrace = true;
        if (this.phase === PHASE.SUCCESS_FLASH) {
          // stay in trace
        }
        // Re-enter same trace cleanly
        if (!this.unguided) {
          const ghost = this.tracer.getTargetScreenPoints();
          this.renderer.setRuneVisual({
            ghostPath: ghost,
            guideDots: ghost,
            startDot: ghost[0],
            showGhost: true,
          });
        }
      }, 900);
    }
  }

  _updateFingertip(x, y, drawing) {
    this.fingertip.style.left = `${x}px`;
    this.fingertip.style.top = `${y}px`;
    if (!drawing) {
      // idle
    }
  }

  _loop(ts) {
    const dt = Math.min(0.05, (ts - this.lastTs) / 1000 || 0.016);
    this.lastTs = ts;
    this.phaseT += dt;

    // Keep layout in sync
    this.tracer.setLayout(this.renderer.getRuneLayout());

    this._updatePhase(dt);
    this.renderer.update(dt);
    this.renderer.draw(ts / 1000);

    // fingertip from input
    this._updateFingertip(this.input.x, this.input.y, this.tracer.isDrawing);

    if (this.phase !== PHASE.DONE) {
      requestAnimationFrame(this._loop);
    } else {
      // still draw end state a bit
      requestAnimationFrame(this._loop);
    }
  }

  _updatePhase(dt) {
    const sb = this.renderer.spellbook;

    switch (this.phase) {
      case PHASE.BOOK_APPEAR: {
        // float in
        const t = Math.min(1, this.phaseT / 1.4);
        this.renderer.setSpellbook({
          glow: 0.3 + t * 0.5,
          yOffset: 60 * (1 - t),
        });
        if (t >= 1 && !this.bookReadyForSwipe) {
          this.bookReadyForSwipe = true;
          this.setCaption("The spellbook waits. Swipe left to open its cover.");
          this.setHint(
            this.input.mode === "hand"
              ? "Pinch and sweep left to open"
              : "Swipe left across the book to open"
          );
        }
        break;
      }

      case PHASE.BOOK_OPEN: {
        const t = Math.min(1, this.phaseT / 1.6);
        this.renderer.setSpellbook({
          open: easeInOut(t),
          glow: 0.8 + 0.2 * Math.sin(this.phaseT * 3),
        });
        if (t >= 1) this._enter(PHASE.PAGE_FLIP);
        break;
      }

      case PHASE.PAGE_FLIP: {
        this.renderer.setSpellbook({
          glow: 0.85 + 0.15 * Math.sin(this.phaseT * 2.5),
          yOffset: 90 + Math.sin(this.phaseT * 1.5) * 4,
        });
        // Auto advance after reading beat (or voice "next")
        if (this.phaseT > 2.8) this._enter(PHASE.DEMO);
        break;
      }

      case PHASE.DEMO: {
        if (!this.demoAnim) break;
        const t = Math.min(1, this.phaseT / (this.demoAnim.durationMs / 1000));
        const frame = this.demoAnim.at(t);
        this.renderer.setRuneVisual({
          demoDrawn: frame.drawn,
          demoHead: frame.head,
        });
        this.renderer.setSpellbook({
          yOffset: 110,
          glow: 1,
        });
        if (frame.done && this.phaseT > this.demoAnim.durationMs / 1000 + 0.45) {
          this._enter(PHASE.TRACE);
        }
        break;
      }

      case PHASE.TRACE:
      case PHASE.PRACTICE:
        this.renderer.setSpellbook({
          yOffset: 120,
          glow: 0.75 + 0.25 * Math.sin(this.phaseT * 2),
        });
        break;

      case PHASE.SUCCESS_FLASH:
        // handled by timeouts in _onUp
        break;

      case PHASE.COMBINE: {
        // Brief charge then cast
        this.renderer.setSpellbook({ glow: 1, yOffset: 130 });
        // Pulse guide dots of all runes briefly
        if (this.phaseT > 1.1) this._enter(PHASE.CAST);
        break;
      }

      case PHASE.CAST: {
        if (this.phaseT > 2.6) this._enter(PHASE.DONE);
        break;
      }

      case PHASE.DONE:
        break;
    }
  }
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// Boot
const game = new Game();
// Expose for debugging in class demos
window.__mage = game;
