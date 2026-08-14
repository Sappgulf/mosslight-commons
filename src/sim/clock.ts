/**
 * Wall time per simulation tick.
 *
 * This was 520ms, which put a whole day in 6.2 seconds and a season in 44. The
 * world moved faster than anyone could read it: residents teleported between
 * cells, the ledger scrolled past unread, and a forecast expired before the
 * player had finished the sentence. At 900ms a day takes about eleven seconds
 * and the 2x and 4x controls still exist for anyone who wants the old pace.
 */
export const TICK_MS = 900;

/**
 * The maximum amount of wall time a single frame is allowed to convert into
 * simulation ticks. Without this, returning to a backgrounded tab would run
 * thousands of catch-up ticks in one frame and lock the page.
 */
const MAX_FRAME_MS = TICK_MS * 4;

export interface ClockHandlers {
  onTick: () => void;
  /** Called once per frame after any ticks were consumed. */
  onFrame: (ticked: boolean) => void;
}

/**
 * Fixed-step simulation clock, deliberately independent of Phaser's scene
 * timer. The renderer can stall, the tab can blur, and the world still
 * advances in whole fixed steps — which is what makes `advanceTime` in the QA
 * hooks produce exactly the same state as real elapsed time.
 */
export class SimulationClock {
  private accumulator = 0;
  private lastTimestamp = 0;
  private frameHandle: number | null = null;
  private running = false;

  constructor(private readonly handlers: ClockHandlers) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimestamp = performance.now();
    this.accumulator = 0;
    this.frameHandle = requestAnimationFrame(this.frame);
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
    document.removeEventListener("visibilitychange", this.handleVisibility);
  }

  private handleVisibility = (): void => {
    // Drop the backlog rather than fast-forwarding it. A player who tabs away
    // should return to the world as they left it.
    if (document.visibilityState === "visible") {
      this.lastTimestamp = performance.now();
      this.accumulator = 0;
    }
  };

  private frame = (timestamp: number): void => {
    if (!this.running) return;
    const delta = Math.min(MAX_FRAME_MS, timestamp - this.lastTimestamp);
    this.lastTimestamp = timestamp;
    this.accumulator += delta;

    let ticked = false;
    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      this.handlers.onTick();
      ticked = true;
    }

    this.handlers.onFrame(ticked);
    this.frameHandle = requestAnimationFrame(this.frame);
  };
}
