import { expect, type Page } from '@playwright/test';

// music-features-navigation.ts — follow the visible disclosure before testing the existing optional entries.
export async function revealMusicFeatures(page: Page) {
  const section = page.locator('.online-library-extras');
  await expect(section).toBeVisible();
  if (await section.getAttribute('open') === null) await section.locator('summary').tap();
}
