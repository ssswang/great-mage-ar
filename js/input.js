/**
 * Pointer + optional MediaPipe hand tracking.
 * Always provides a glowing fingertip position; mouse is a fallback, not a cursor metaphor.
 */

export class InputManager {
  constructor({ onMove, onDown, onUp }) {
    this.onMove = onMove;
    this.onDown = onDown;
    this.onUp = onUp;

    this.mode = "pointer"; // pointer | hand
    this.x = window.innerWidth / 2;
    this.y = window.innerHeight / 2;
    this.isDown = false;
    this.enabled = false;

    this._hands = null;
    this._camera = null;
    this._video = null;
    this._handActive = false;
    this._pinchDown = false;
    this._raf = null;

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
  }

  enablePointer() {
    this.enabled = true;
    this.mode = "pointer";
    window.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerdown", this._onPointerDown);
    window.addEventListener("pointerup", this._onPointerUp);
    window.addEventListener("pointercancel", this._onPointerUp);
  }

  disable() {
    this.enabled = false;
    window.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("pointerdown", this._onPointerDown);
    window.removeEventListener("pointerup", this._onPointerUp);
    window.removeEventListener("pointercancel", this._onPointerUp);
    this.stopHands();
  }

  _ignoredTarget(t) {
    if (!t || !t.closest) return false;
    return Boolean(t.closest("button, .panel, .chip, a, input"));
  }

  _onPointerMove(e) {
    if (!this.enabled || this.mode === "hand") return;
    this.x = e.clientX;
    this.y = e.clientY;
    this.onMove?.(this.x, this.y, this.isDown);
  }

  _onPointerDown(e) {
    if (!this.enabled || this.mode === "hand") return;
    if (this._ignoredTarget(e.target)) return;
    this.isDown = true;
    this.x = e.clientX;
    this.y = e.clientY;
    this.onDown?.(this.x, this.y);
  }

  _onPointerUp(e) {
    if (!this.enabled || this.mode === "hand") return;
    if (!this.isDown) return;
    this.isDown = false;
    this.onUp?.(this.x, this.y);
  }

  /**
   * Optional MediaPipe Hands via CDN dynamic import.
   * Pinch (thumb–index) = draw.
   */
  async tryEnableHands(videoEl) {
    this._video = videoEl;
    try {
      // MediaPipe vision tasks — loaded only if available
      const vision = await import(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm"
      );
      const { FilesetResolver, HandLandmarker } = vision;
      const fileset = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      );
      this._hands = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 1,
      });
      this.mode = "hand";
      // Keep pointer as soft fallback when no hand detected
      window.addEventListener("pointermove", this._onPointerMove);
      window.addEventListener("pointerdown", this._onPointerDown);
      window.addEventListener("pointerup", this._onPointerUp);
      this._loopHands();
      return true;
    } catch (err) {
      console.warn("Hand tracking unavailable, using pointer:", err);
      this.mode = "pointer";
      return false;
    }
  }

  stopHands() {
    this._handActive = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    try {
      this._hands?.close?.();
    } catch (_) {
      /* ignore */
    }
    this._hands = null;
  }

  _loopHands() {
    this._handActive = true;
    const tick = () => {
      if (!this._handActive || !this._hands || !this._video) return;
      if (this._video.readyState >= 2) {
        const now = performance.now();
        const result = this._hands.detectForVideo(this._video, now);
        if (result?.landmarks?.length) {
          // Index fingertip = landmark 8
          const tip = result.landmarks[0][8];
          const thumb = result.landmarks[0][4];
          // Video is mirrored in CSS; map accordingly
          const x = (1 - tip.x) * window.innerWidth;
          const y = tip.y * window.innerHeight;
          this.x = x;
          this.y = y;
          this.mode = "hand";

          const pinch =
            Math.hypot(tip.x - thumb.x, tip.y - thumb.y) < 0.07;

          if (pinch && !this._pinchDown) {
            this._pinchDown = true;
            this.isDown = true;
            this.onDown?.(x, y);
          } else if (!pinch && this._pinchDown) {
            this._pinchDown = false;
            this.isDown = false;
            this.onUp?.(x, y);
          } else if (this.isDown) {
            this.onMove?.(x, y, true);
          } else {
            this.onMove?.(x, y, false);
          }
        }
      }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }
}

/**
 * Lightweight voice commands between sequences: "next", "again", "cast", "open".
 */
export class VoiceCommands {
  constructor(onCommand) {
    this.onCommand = onCommand;
    this.active = false;
    this.rec = null;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    this.rec = new SR();
    this.rec.continuous = true;
    this.rec.interimResults = false;
    this.rec.lang = "en-US";
    this.rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (!last?.isFinal) return;
      const text = last[0].transcript.toLowerCase().trim();
      if (/next|continue|open/.test(text)) this.onCommand?.("next");
      else if (/again|retry|restart/.test(text)) this.onCommand?.("again");
      else if (/cast|fire|spell/.test(text)) this.onCommand?.("cast");
    };
    this.rec.onerror = () => {
      /* auto-restart handled in start */
    };
    this.rec.onend = () => {
      if (this.active) {
        try {
          this.rec.start();
        } catch (_) {
          /* ignore */
        }
      }
    };
  }

  get supported() {
    return Boolean(this.rec);
  }

  start() {
    if (!this.rec || this.active) return false;
    this.active = true;
    try {
      this.rec.start();
      return true;
    } catch {
      this.active = false;
      return false;
    }
  }

  stop() {
    this.active = false;
    try {
      this.rec?.stop();
    } catch {
      /* ignore */
    }
  }

  toggle() {
    if (this.active) {
      this.stop();
      return false;
    }
    return this.start();
  }
}
