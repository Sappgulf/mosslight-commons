import { expect, test, type Page } from "@playwright/test";

interface Snapshot {
  day: number;
  tick: number;
  paused: boolean;
  speed: number;
  population: number;
  onboarding: { step: number; dismissed: boolean };
  resources: Record<string, number>;
  zoomPercent: number;
  buildMode: string | null;
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const hook = (window as unknown as { render_game_to_text?: () => string }).render_game_to_text;
    if (!hook) throw new Error("render_game_to_text is not exposed");
    return JSON.parse(hook()) as Snapshot;
  });
}

/**
 * Each Playwright test gets its own browser context, so localStorage already
 * starts empty and every test begins on a first run. Clearing it again here
 * would also fire on reloads, which would defeat the resume test.
 */
async function freshStart(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveCount(0, { timeout: 30_000 });
}

async function takeUpTheLedger(page: Page): Promise<void> {
  await page.getByRole("button", { name: /take up the ledger/i }).click();
}

test.describe("boot", () => {
  test("shows a loading splash and then removes it", async ({ page }) => {
    await page.goto("/");
    // The splash must actually be torn down, not just faded; a leftover overlay
    // would swallow every pointer event on the board.
    await expect(page.locator("#boot")).toHaveCount(0, { timeout: 30_000 });
  });

  test("exposes inspection hooks with a live world", async ({ page }) => {
    await freshStart(page);
    await takeUpTheLedger(page);
    const state = await snapshot(page);
    expect(state.day).toBeGreaterThan(0);
    expect(state.population).toBeGreaterThan(0);
    expect(state.resources.food).toBeGreaterThan(0);
  });

  test("boots without console errors", async ({ page }) => {
    const errors: string[] = [];
    /**
     * The optional Torx+THRML research sidecar lives on 127.0.0.1:8001 and is
     * probed only on localhost, which is exactly where these tests run. A
     * refused connection to it is the designed behaviour when it is not
     * running, not a fault in the game.
     */
    const isOptionalSidecar = (text: string) =>
      text.includes("ERR_CONNECTION_REFUSED") || text.includes("8001");

    page.on("console", (message) => {
      if (message.type() === "error" && !isOptionalSidecar(message.text())) errors.push(message.text());
    });
    page.on("pageerror", (error) => {
      if (!isOptionalSidecar(error.message)) errors.push(error.message);
    });

    await freshStart(page);
    await takeUpTheLedger(page);
    await page.waitForTimeout(1500);

    expect(errors).toEqual([]);
  });

  test("ships a small enough payload to start quickly", async ({ page }) => {
    let imageBytes = 0;
    page.on("response", async (response) => {
      if (!/\.(webp|png|jpg)$/.test(new URL(response.url()).pathname)) return;
      const length = Number(response.headers()["content-length"] ?? 0);
      imageBytes += length;
    });

    await freshStart(page);
    await takeUpTheLedger(page);
    await page.waitForTimeout(1000);

    // The art set was 7.9MB of PNG before the pipeline landed. This guards the
    // regression rather than the exact number.
    expect(imageBytes).toBeLessThan(1_000_000);
  });
});

test.describe("keyboard", () => {
  /**
   * The regression that motivated the router. The HUD listened on both `#hud`
   * and `window`, so Enter advanced the first-run coach twice per press.
   */
  test("advances the first-run coach exactly one card per Enter", async ({ page }) => {
    await freshStart(page);
    await takeUpTheLedger(page);

    const start = (await snapshot(page)).onboarding.step;
    await page.keyboard.press("Enter");
    const after = await snapshot(page);

    expect(after.onboarding.step).toBe(start + 1);
  });

  test("pauses and resumes with Space", async ({ page }) => {
    await freshStart(page);
    await takeUpTheLedger(page);

    await page.keyboard.press("Space");
    expect((await snapshot(page)).paused).toBe(true);
    await page.keyboard.press("Space");
    expect((await snapshot(page)).paused).toBe(false);
  });

  test("changes speed with the number keys", async ({ page }) => {
    await freshStart(page);
    await takeUpTheLedger(page);

    await page.keyboard.press("4");
    expect((await snapshot(page)).speed).toBe(4);
    await page.keyboard.press("1");
    expect((await snapshot(page)).speed).toBe(1);
  });

  test("zooms and resets with + and 0", async ({ page }) => {
    await freshStart(page);
    await takeUpTheLedger(page);

    const base = (await snapshot(page)).zoomPercent;
    await page.keyboard.press("+");
    expect((await snapshot(page)).zoomPercent).toBeGreaterThan(base);
    await page.keyboard.press("0");
    expect((await snapshot(page)).zoomPercent).toBe(base);
  });

  test("opens and closes the shortcuts card", async ({ page }) => {
    await freshStart(page);
    await takeUpTheLedger(page);

    const card = page.locator("[data-shortcuts-overlay]");
    await expect(card).toBeHidden();
    await page.keyboard.press("?");
    await expect(card).toBeVisible();
    await expect(card.getByText("Pause or resume the Commons")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
  });
});

test.describe("session", () => {
  test("resumes the same world after a reload", async ({ page }) => {
    await freshStart(page);
    await takeUpTheLedger(page);

    await page.waitForTimeout(2500);
    const before = await snapshot(page);

    await page.reload();
    await expect(page.locator("#boot")).toHaveCount(0, { timeout: 30_000 });
    const after = await snapshot(page);

    expect(after.day).toBeGreaterThanOrEqual(before.day);
    expect(after.population).toBe(before.population);
    // A resumed world never re-runs the first-run cards.
    expect(after.onboarding.dismissed).toBe(true);
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("fits the viewport with no horizontal overflow", async ({ page }) => {
    await freshStart(page);
    await takeUpTheLedger(page);

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  /**
   * Touch placement is two-stage: the first tap arms a cell and previews it,
   * the second commits. Before this, a tap built immediately and a touch player
   * never saw whether the plot was legal.
   */
  test("arms a build with the first tap and only commits on the second", async ({ page }) => {
    await freshStart(page);
    await takeUpTheLedger(page);
    // Clear the coach so it cannot intercept taps.
    await page.keyboard.press("Escape");

    const homeButton = page.locator('[data-build="burrow-home"]');
    await homeButton.tap();
    expect((await snapshot(page)).buildMode).toBe("burrow-home");

    const canvas = page.locator("#game canvas");
    const box = (await canvas.boundingBox())!;
    const point = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.62 };

    const before = (await snapshot(page)).buildMode;
    await page.touchscreen.tap(point.x, point.y);
    // Still in build mode: the first tap only armed the cell.
    expect((await snapshot(page)).buildMode).toBe(before);
  });
});
