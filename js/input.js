/**
 * Pointer + optional MediaPipe hand tracking.
 * Always provides a glowing fingertip position; mouse is a fallback, not a cursor metaphor.
 */

export class InputManager {
  constructor({ onMove, onDown, onUp, onHandSwipe }) {
    this.onMove = onMove;
    this.onDown = onDown;
    this.onUp = onUp;
    this.onHandSwipe = onHandSwipe;

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
    this._handSwipeStart = null;
    this._handSwipeCooldownUntil = 0;
    this._raf = null;
    this._smoothedTip = null;
    this._handSwipeStart = null;
    this._handSwipeCooldownUntil = 0;

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
    this._smoothedTip = null;
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
          const wrist = result.landmarks[0][0];
          const middleBase = result.landmarks[0][9];

          // The camera uses object-fit: cover. Map landmarks through that same
          // crop so the tracked fingertip lines up with what the user sees.
          const videoW = this._video.videoWidth || window.innerWidth;
          const videoH = this._video.videoHeight || window.innerHeight;
          const scale = Math.max(window.innerWidth / videoW, window.innerHeight / videoH);
          const renderW = videoW * scale;
          const renderH = videoH * scale;
          const left = (window.innerWidth - renderW) / 2;
          const top = (window.innerHeight - renderH) / 2;
          const rawX = Math.max(0, Math.min(window.innerWidth, left + (1 - tip.x) * renderW));
          const rawY = Math.max(0, Math.min(window.innerHeight, top + tip.y * renderH));

          // Hand landmarks naturally jitter by a few pixels. Smooth the visual
          // fingertip before it becomes a drawing point so a steady finger makes
          // a steady rune without adding noticeable lag.
          if (!this._smoothedTip) this._smoothedTip = { x: rawX, y: rawY };
          const smoothing = 0.46;
          this._smoothedTip.x += (rawX - this._smoothedTip.x) * smoothing;
          this._smoothedTip.y += (rawY - this._smoothedTip.y) * smoothing;
          const x = this._smoothedTip.x;
          const y = this._smoothedTip.y;
          this.x = x;
          this.y = y;
          this.mode = "hand";

          // Scale pinch tolerance to the detected hand. This is much more
          // reliable than a fixed distance when the hand is near or far away.
          const handSize = Math.hypot(wrist.x - middleBase.x, wrist.y - middleBase.y);
          const pinchDistance = Math.hypot(tip.x - thumb.x, tip.y - thumb.y);
          const pinch = pinchDistance < Math.max(0.075, handSize * 0.52);
          const fingertipIds = [8, 12, 16, 20];
          const jointIds = [6, 10, 14, 18];
          const extendedFingers = fingertipIds.reduce((count, fingertipId, index) => {
            const fingertipDistance = Math.hypot(
              result.landmarks[0][fingertipId].x - wrist.x,
              result.landmarks[0][fingertipId].y - wrist.y
            );
            const jointDistance = Math.hypot(
              result.landmarks[0][jointIds[index]].x - wrist.x,
              result.landmarks[0][jointIds[index]].y - wrist.y
            );
            return count + (fingertipDistance > jointDistance * 1.18 ? 1 : 0);
          }, 0);
          const openHand = !pinch && extendedFingers >= 3;
          const palmX = left + (1 - (wrist.x + middleBase.x) / 2) * renderW;
          const palmY = top + ((wrist.y + middleBase.y) / 2) * renderH;

          if (openHand && now >= this._handSwipeCooldownUntil) {
            if (!this._handSwipeStart) this._handSwipeStart = { x: palmX, y: palmY, at: now };
            const dx = palmX - this._handSwipeStart.x;
            const dy = palmY - this._handSwipeStart.y;
            if (now - this._handSwipeStart.at >= 280 && Math.abs(dx) >= 110 && Math.abs(dy) <= 85) {
              this._handSwipeStart = null;
              this._handSwipeCooldownUntil = now + 800;
              this.onHandSwipe?.(dx < 0 ? "left" : "right");
            }
          } else {
            this._handSwipeStart = null;
          }
          if (pinch && !this._pinchDown) {
            this._pinchDown = true;
            this.isDown = true;
            this.onDown?.(x, y);
            // Begin the visible stroke immediately on the pinch frame.
            this.onMove?.(x, y, true);
          } else if (!pinch && this._pinchDown) {
            this._pinchDown = false;
            this.isDown = false;
            this.onMove?.(x, y, true);
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
 * Lightweight voice commands between sequences: "open sesame", "open", "next", "previous", "study", "again", "cast".
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
      if (/study|learn/.test(text)) this.onCommand?.("study");
      else if (/open|sesame/.test(text)) this.onCommand?.("open");
      else if (/previous|prev|back/.test(text)) this.onCommand?.("previous");
      else if (/next|continue/.test(text)) this.onCommand?.("next");
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
