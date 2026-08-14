/**
 * The boot splash declared inline in index.html.
 *
 * There was previously nothing here at all: the page was an empty `<main>` and
 * the player watched an unexplained dark rectangle while the module graph,
 * Phaser, and the texture set loaded. Worse, if WebGL or canvas creation failed
 * the page simply stayed blank forever with no way to tell a slow load from a
 * dead one.
 */

const boot = () => document.querySelector<HTMLElement>("#boot");

/** Moves the progress bar. `value` is 0-1. */
export function setBootProgress(value: number, message?: string): void {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const bar = document.querySelector<HTMLElement>("#boot-bar");
  const track = document.querySelector<HTMLElement>("#boot-track");
  if (bar) bar.style.width = `${percent}%`;
  track?.setAttribute("aria-valuenow", String(percent));
  if (message) {
    const label = document.querySelector<HTMLElement>("#boot-message");
    if (label) label.textContent = message;
  }
}

/** Fades the splash out and removes it once the world is on screen. */
export function dismissBoot(): void {
  const element = boot();
  if (!element || element.hasAttribute("data-done")) return;
  setBootProgress(1);
  element.setAttribute("data-done", "");
  const remove = () => element.remove();
  element.addEventListener("transitionend", remove, { once: true });
  // A reduced-motion viewer gets no transitionend, so never rely on it alone.
  window.setTimeout(remove, 600);
}

/**
 * Replaces the splash with an explanation. Used when the game cannot start at
 * all, which previously presented as an indefinite blank page.
 */
export function showBootError(message: string): void {
  const element = boot();
  if (!element) return;
  element.removeAttribute("data-done");
  const track = document.querySelector<HTMLElement>("#boot-track");
  if (track) track.hidden = true;
  const label = document.querySelector<HTMLElement>("#boot-message");
  if (label) {
    label.id = "boot-error";
    label.textContent = message;
  }
}

/**
 * Whether this browser can give Phaser a drawing context at all. Phaser's own
 * failure mode is an exception during construction, which is far too late to
 * say anything useful to the player.
 */
export function canRenderGame(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const webgl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (webgl) return true;
    // Phaser falls back to a 2D canvas, which is slower but perfectly playable.
    return canvas.getContext("2d") !== null;
  } catch {
    return false;
  }
}
