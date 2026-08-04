/** Optional browser-native narration and synthesized spell effects. */
export class AudioManager {
  constructor() {
    this.enabled = true;
    this.context = null;
    this.lastSpoken = "";
    this.speaking = false;
    this.speechCooldownUntil = 0;
    this.speechToken = 0;
  }

  start() {
    if (!this.enabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === "suspended") this.context.resume();
  }

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this.speechToken += 1;
      this.speaking = false;
      this.speechCooldownUntil = Date.now() + 600;
      window.speechSynthesis?.cancel?.();
    }
    else this.start();
    return this.enabled;
  }

  speak(text) {
    if (!this.enabled || !window.speechSynthesis || !text || text === this.lastSpoken) return Promise.resolve();
    this.lastSpoken = text;
    const token = ++this.speechToken;
    this.speaking = true;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 0.92;
    utterance.volume = 0.9;
    return new Promise((resolve) => {
      const finish = () => {
        if (token === this.speechToken) {
          this.speaking = false;
          this.speechCooldownUntil = Date.now() + 700;
        }
        resolve();
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
    });
  }

  get isNarrating() {
    return this.speaking || Date.now() < this.speechCooldownUntil;
  }

  success() {
    this._tone(523.25, 0.12, "sine", 0.07);
    this._tone(783.99, 0.24, "sine", 0.08, 0.1);
  }

  fail() {
    this._tone(180, 0.2, "triangle", 0.05);
  }

  cast() {
    this._tone(220, 0.38, "sawtooth", 0.045);
    this._tone(440, 0.3, "sine", 0.06, 0.12);
    this._tone(659.25, 0.48, "sine", 0.07, 0.22);
  }

  _tone(frequency, duration, type, volume, delay = 0) {
    if (!this.enabled) return;
    this.start();
    if (!this.context) return;
    const now = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }
}
