/**
 * The single owner of keyboard input.
 *
 * There used to be three independent `keydown` listeners: two installed by the
 * HUD (one on `#hud`, one on `window`) and one installed by `main.ts`. Because
 * anything typed inside `#hud` bubbles to `window`, the HUD's own handler ran
 * twice for the same press. The title screen got away with it by calling
 * `stopPropagation`, but the first-run coach did not, so pressing Enter with
 * focus inside the HUD advanced the walkthrough two steps at a time and
 * silently skipped a card.
 *
 * Now there is one listener and an explicit precedence chain. Layers are tried
 * from highest priority down, and the first layer to claim the event stops the
 * walk. Nothing can double-fire because nothing else is listening.
 */

/** A layer returns true when it has consumed the event. */
export interface KeyLayer {
  readonly name: string;
  readonly priority: number;
  handle(event: KeyboardEvent, chord: string): boolean;
}

export type BindingGroup = "Time" | "View" | "World" | "Session";

export interface Binding {
  readonly id: string;
  /** Normalized chords, any of which triggers this binding. */
  readonly chords: string[];
  /** How the chord is shown in the shortcuts overlay. */
  readonly display: string;
  readonly description: string;
  readonly group: BindingGroup;
  readonly run: () => void;
  /**
   * Bindings are suppressed while a control has focus, because Space and Enter
   * belong to the control. Set this for bindings that should fire anyway.
   */
  readonly allowOnControl?: boolean;
  /** Suppress the browser default (page scroll, zoom, save dialog). */
  readonly preventDefault?: boolean;
}

/** Text entry owns every key while it has focus. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    // Coerced: `isContentEditable` is undefined rather than false on elements
    // that never had the attribute, and this is a predicate, not a hint.
    || (target instanceof HTMLElement && target.isContentEditable === true)
  );
}

/**
 * Space and Enter activate a focused button. A global binding on either key
 * must not also fire, or tabbing to PAUSE and pressing Space would toggle the
 * clock twice — once via the click, once via the shortcut.
 */
export function isActivationOnControl(target: EventTarget | null, chord: string): boolean {
  if (chord !== "space" && chord !== "enter") return false;
  return target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement;
}

/**
 * Reduces an event to a comparable string: `mod+s`, `shift+?`, `space`, `escape`.
 * `mod` is Command on Apple platforms and Control everywhere else, collapsed to
 * one name so bindings do not have to be declared twice.
 */
export function chordOf(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.altKey) parts.push("alt");

  let key = event.key;
  if (key === " ") key = "space";
  else if (key.length === 1) key = key.toLowerCase();
  else key = key.toLowerCase();

  // Shift is only meaningful for keys it does not already transform.
  if (event.shiftKey && (key.length > 1 || key === "space")) parts.push("shift");

  parts.push(key);
  return parts.join("+");
}

export class KeyboardRouter {
  private readonly layers: KeyLayer[] = [];
  private attached = false;

  /** Registers a layer. Returns an unregister function. */
  register(layer: KeyLayer): () => void {
    this.layers.push(layer);
    this.layers.sort((a, b) => b.priority - a.priority);
    return () => {
      const index = this.layers.indexOf(layer);
      if (index >= 0) this.layers.splice(index, 1);
    };
  }

  attach(target: Window | HTMLElement = window): void {
    if (this.attached) return;
    this.attached = true;
    target.addEventListener("keydown", this.onKeyDown as EventListener);
    this.detach = () => {
      target.removeEventListener("keydown", this.onKeyDown as EventListener);
      this.attached = false;
    };
  }

  detach: () => void = () => {
    this.attached = false;
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const chord = chordOf(event);
    for (const layer of this.layers) {
      if (layer.handle(event, chord)) return;
    }
  };
}

/**
 * Wraps a flat binding list as a layer. Used for the base game bindings, which
 * sit below every modal layer.
 */
export function bindingLayer(
  name: string,
  priority: number,
  bindings: readonly Binding[],
): KeyLayer & { bindings: readonly Binding[] } {
  const byChord = new Map<string, Binding>();
  for (const binding of bindings) {
    for (const chord of binding.chords) byChord.set(chord, binding);
  }

  return {
    name,
    priority,
    bindings,
    handle(event: KeyboardEvent, chord: string): boolean {
      if (isTypingTarget(event.target)) return false;
      const binding = byChord.get(chord);
      if (!binding) return false;
      if (!binding.allowOnControl && isActivationOnControl(event.target, chord)) return false;
      if (binding.preventDefault) event.preventDefault();
      binding.run();
      return true;
    },
  };
}
