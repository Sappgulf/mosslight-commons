// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  KeyboardRouter,
  bindingLayer,
  chordOf,
  isActivationOnControl,
  isTypingTarget,
  type Binding,
  type KeyLayer,
} from "../keymap";

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function binding(overrides: Partial<Binding> & Pick<Binding, "id" | "chords" | "run">): Binding {
  return {
    display: overrides.id,
    description: overrides.id,
    group: "World",
    ...overrides,
  };
}

describe("chordOf", () => {
  it("names the space bar", () => {
    expect(chordOf(new KeyboardEvent("keydown", { key: " " }))).toBe("space");
  });

  it("lowercases letters so Shift+M and m agree", () => {
    expect(chordOf(new KeyboardEvent("keydown", { key: "M" }))).toBe("m");
  });

  it("collapses Command and Control into one modifier", () => {
    expect(chordOf(new KeyboardEvent("keydown", { key: "s", metaKey: true }))).toBe("mod+s");
    expect(chordOf(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }))).toBe("mod+s");
  });

  it("names special keys", () => {
    expect(chordOf(new KeyboardEvent("keydown", { key: "Escape" }))).toBe("escape");
    expect(chordOf(new KeyboardEvent("keydown", { key: "Enter" }))).toBe("enter");
  });
});

describe("focus guards", () => {
  it("treats text entry as owning the keyboard", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
  });

  it("treats Space and Enter on a button as that button's activation", () => {
    const button = document.createElement("button");
    expect(isActivationOnControl(button, "space")).toBe(true);
    expect(isActivationOnControl(button, "enter")).toBe(true);
    expect(isActivationOnControl(button, "m")).toBe(false);
    expect(isActivationOnControl(document.createElement("div"), "space")).toBe(false);
  });
});

describe("KeyboardRouter", () => {
  /**
   * The regression this whole module exists for. The HUD used to listen on both
   * `#hud` and `window`; anything typed inside the HUD bubbled to window and ran
   * the same handler twice, which advanced the first-run walkthrough two cards
   * per Enter. One router, one listener, one call.
   */
  it("runs a handler exactly once for a key pressed inside a nested element", () => {
    const host = document.createElement("div");
    const inner = document.createElement("div");
    host.append(inner);
    document.body.append(host);

    const run = vi.fn();
    const router = new KeyboardRouter();
    router.register(bindingLayer("game", 0, [binding({ id: "go", chords: ["enter"], run })]));
    router.attach();

    press(inner, { key: "Enter" });

    expect(run).toHaveBeenCalledTimes(1);
    router.detach();
    host.remove();
  });

  it("gives higher-priority layers first refusal", () => {
    const order: string[] = [];
    const modal: KeyLayer = {
      name: "modal",
      priority: 100,
      handle: () => {
        order.push("modal");
        return true;
      },
    };
    const run = vi.fn(() => order.push("game"));

    const router = new KeyboardRouter();
    router.register(bindingLayer("game", 0, [binding({ id: "go", chords: ["escape"], run })]));
    router.register(modal);
    router.attach();

    press(document.body, { key: "Escape" });

    expect(order).toEqual(["modal"]);
    expect(run).not.toHaveBeenCalled();
    router.detach();
  });

  it("falls through to the next layer when a layer declines", () => {
    const modal: KeyLayer = { name: "modal", priority: 100, handle: () => false };
    const run = vi.fn();

    const router = new KeyboardRouter();
    router.register(modal);
    router.register(bindingLayer("game", 0, [binding({ id: "go", chords: ["escape"], run })]));
    router.attach();

    press(document.body, { key: "Escape" });

    expect(run).toHaveBeenCalledTimes(1);
    router.detach();
  });

  it("does not fire a Space binding while a button has focus", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const run = vi.fn();

    const router = new KeyboardRouter();
    router.register(bindingLayer("game", 0, [binding({ id: "pause", chords: ["space"], run })]));
    router.attach();

    press(button, { key: " " });

    expect(run).not.toHaveBeenCalled();
    router.detach();
    button.remove();
  });

  it("still fires a binding marked allowOnControl", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const run = vi.fn();

    const router = new KeyboardRouter();
    router.register(
      bindingLayer("game", 0, [binding({ id: "save", chords: ["space"], allowOnControl: true, run })]),
    );
    router.attach();

    press(button, { key: " " });

    expect(run).toHaveBeenCalledTimes(1);
    router.detach();
    button.remove();
  });

  it("stays out of the way while the player is typing", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const run = vi.fn();

    const router = new KeyboardRouter();
    router.register(bindingLayer("game", 0, [binding({ id: "mute", chords: ["m"], run })]));
    router.attach();

    press(input, { key: "m" });

    expect(run).not.toHaveBeenCalled();
    router.detach();
    input.remove();
  });

  it("suppresses the browser default only where a binding asks for it", () => {
    const router = new KeyboardRouter();
    router.register(
      bindingLayer("game", 0, [
        binding({ id: "zoom", chords: ["+"], preventDefault: true, run: () => {} }),
        binding({ id: "mute", chords: ["m"], run: () => {} }),
      ]),
    );
    router.attach();

    expect(press(document.body, { key: "+" }).defaultPrevented).toBe(true);
    expect(press(document.body, { key: "m" }).defaultPrevented).toBe(false);
    router.detach();
  });

  it("stops dispatching to an unregistered layer", () => {
    const run = vi.fn();
    const router = new KeyboardRouter();
    const remove = router.register(bindingLayer("game", 0, [binding({ id: "go", chords: ["g"], run })]));
    router.attach();

    press(document.body, { key: "g" });
    remove();
    press(document.body, { key: "g" });

    expect(run).toHaveBeenCalledTimes(1);
    router.detach();
  });
});
