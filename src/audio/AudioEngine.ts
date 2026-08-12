import type { Message, WorldState } from "../sim/types";

type Cue = "build" | "gather" | "craft" | "objective" | "warning" | "arrival" | "click";

interface CueSpec {
  /** Frequencies in Hz, played as a short arpeggio. */
  notes: number[];
  duration: number;
  type: OscillatorType;
  gain: number;
}

const CUES: Record<Cue, CueSpec> = {
  click: { notes: [660], duration: 0.05, type: "triangle", gain: 0.05 },
  build: { notes: [294, 392, 587], duration: 0.11, type: "triangle", gain: 0.1 },
  gather: { notes: [523, 784], duration: 0.07, type: "sine", gain: 0.08 },
  craft: { notes: [392, 523, 659, 784], duration: 0.1, type: "triangle", gain: 0.09 },
  objective: { notes: [523, 659, 784, 1047], duration: 0.13, type: "sine", gain: 0.11 },
  arrival: { notes: [440, 554, 659], duration: 0.12, type: "sine", gain: 0.08 },
  warning: { notes: [311, 233], duration: 0.16, type: "sawtooth", gain: 0.06 },
};

/** Ambient drone root note per phase — the bed shifts with the time of day. */
const PHASE_TONE: Record<WorldState["phase"], { root: number; fifth: number; gain: number }> = {
  dawn: { root: 146.83, fifth: 220.0, gain: 0.035 },
  day: { root: 164.81, fifth: 246.94, gain: 0.03 },
  dusk: { root: 130.81, fifth: 196.0, gain: 0.038 },
  night: { root: 110.0, fifth: 164.81, gain: 0.042 },
};

/**
 * A tiny synthesised audio bed. Everything is generated with oscillators so the
 * game ships no audio files and the bundle stays small.
 *
 * Browsers require a user gesture before audio may start, so the context is
 * created lazily on the first interaction and `enabled` defaults to on but
 * silent until then.
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientVoices: OscillatorNode[] = [];
  private currentPhase: WorldState["phase"] | null = null;
  private lastHarmony = -1;
  private muted: boolean;
  private lastMessageId = 0;

  constructor() {
    this.muted = localStorage.getItem("mosslight.muted") === "true";
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Must be called from a user gesture handler the first time. */
  resume(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    try {
      const context = new AudioContext();
      const master = context.createGain();
      master.gain.value = this.muted ? 0 : 0.6;
      master.connect(context.destination);

      const ambientGain = context.createGain();
      ambientGain.gain.value = 0;
      ambientGain.connect(master);

      this.context = context;
      this.master = master;
      this.ambientGain = ambientGain;
    } catch {
      // Audio is a nicety; a blocked or unavailable AudioContext must never
      // break the game.
      this.context = null;
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem("mosslight.muted", String(this.muted));
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.context.currentTime, 0.05);
    }
    return this.muted;
  }

  play(cue: Cue): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || this.muted || context.state !== "running") return;

    const spec = CUES[cue];
    spec.notes.forEach((frequency, index) => {
      const start = context.currentTime + index * spec.duration * 0.6;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = spec.type;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(spec.gain, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.duration);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(start);
      oscillator.stop(start + spec.duration + 0.02);
    });
  }

  /** Crossfades the ambient drone when the day phase changes. */
  setPhase(phase: WorldState["phase"]): void {
    const context = this.context;
    const ambientGain = this.ambientGain;
    if (!context || !ambientGain || context.state !== "running") return;
    if (phase === this.currentPhase) return;
    this.currentPhase = phase;

    for (const voice of this.ambientVoices) {
      try {
        voice.stop(context.currentTime + 1.2);
      } catch {
        // Already stopped.
      }
    }

    const tone = PHASE_TONE[phase];
    const voices: OscillatorNode[] = [];
    for (const frequency of [tone.root, tone.fifth, tone.root * 2]) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = (Math.random() - 0.5) * 8;
      oscillator.connect(ambientGain);
      oscillator.start();
      voices.push(oscillator);
    }
    this.ambientVoices = voices;
    ambientGain.gain.setTargetAtTime(tone.gain, context.currentTime, 1.5);
  }

  /** Extra chime voices as harmony rises — denser, not louder. */
  setHarmony(harmony: number): void {
    const context = this.context;
    const ambientGain = this.ambientGain;
    if (!context || !ambientGain || context.state !== "running" || this.muted) return;
    const band = Math.floor(harmony / 25);
    if (band === this.lastHarmony || band < 2) {
      this.lastHarmony = band;
      return;
    }
    this.lastHarmony = band;
    const extra = band === 3 ? [329.63, 392] : [329.63];
    for (const frequency of extra) {
      const oscillator = context.createOscillator();
      oscillator.type = "triangle";
      oscillator.frequency.value = frequency;
      oscillator.connect(ambientGain);
      oscillator.start();
      this.ambientVoices.push(oscillator);
    }
  }

  /**
   * Watches the message ledger and fires the matching cue for anything new.
   * Keeping this message-driven means every sim event that is worth telling the
   * player about is automatically worth hearing.
   */
  reactToMessages(messages: Message[]): void {
    const fresh = messages.filter((message) => message.id > this.lastMessageId);
    if (fresh.length === 0) return;
    this.lastMessageId = Math.max(...messages.map((message) => message.id));

    // Only sound the most recent event; a burst of ledger lines should not
    // turn into a chord stack.
    const newest = fresh[0]!;
    const text = newest.text;
    if (text.startsWith("OBJECTIVE")) this.play("objective");
    else if (text.startsWith("BUILD ·")) this.play("build");
    else if (text.startsWith("GATHER")) this.play("gather");
    else if (text.startsWith("CRAFT ·")) this.play("craft");
    else if (text.startsWith("ARRIVAL")) this.play("arrival");
    else if (newest.tone === "warning") this.play("warning");
  }
}
