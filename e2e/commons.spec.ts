import { expect, test } from "@playwright/test";

test("boots the Commons and exposes inspection hooks", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /take up the ledger/i }).click();
  const snapshot = await page.evaluate(() => {
    const hook = (window as unknown as { render_game_to_text?: () => string }).render_game_to_text;
    return hook ? JSON.parse(hook()) : null;
  });
  expect(snapshot).toBeTruthy();
  expect(snapshot.day).toBeGreaterThan(0);
  expect(snapshot.population).toBeGreaterThan(0);
  expect(snapshot.resources.food).toBeGreaterThan(0);
});
