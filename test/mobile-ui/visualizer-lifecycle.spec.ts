import { test, expect, clickPlayerTool, revealPlayerControls } from './fixtures';
import { BUILTIN_VISUALIZER_MODES } from '../../src/types/visualizerModes';
import { openOnlineVisualizer } from './online-visualizer-fixture';
import { installVisualizerLifecycleProbe, observeVisualizerAudio, visualizerLifecycleSnapshot } from './visualizer-lifecycle-probe';

// visualizer-lifecycle.spec.ts — original renderers and settings under repeated teardown; audio and visibility are controlled fixtures.
const rasterModes = ['fume', 'lumiere', 'sonnet', 'tempera', 'diorama'];
const gpuModes = ['lumiere', 'sonnet', 'tempera', 'diorama'];
for (const [index, mode] of BUILTIN_VISUALIZER_MODES.entries()) {
  test(`${mode} stops stage sampling and drawing while settings, hidden or collapsed and resumes`, async ({ page }, info) => {
    test.setTimeout(45000);
    const errors: string[] = [];
    const warnings: string[] = [];
    const samples: { phase: string; resources: Awaited<ReturnType<typeof visualizerLifecycleSnapshot>> }[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await installVisualizerLifecycleProbe(page);
    await openOnlineVisualizer(page, index % 2 ? 'qq' : 'netease', mode);
    await observeVisualizerAudio(page);
    await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: true, position: 0 }));
    const state = await page.evaluate(() => (window as any).fixturePlayback);
    const stage = page.locator('.lyric-stage');
    const record = async (phase: string) => samples.push({ phase, resources: await visualizerLifecycleSnapshot(page) });
    const ready = async (phase: string) => {
      await expect(stage.locator('.empty-lyrics')).toHaveCount(0);
      if (rasterModes.includes(mode)) await expect(stage.locator('canvas').last()).toBeVisible();
      else await expect.poll(() => stage.textContent()).toMatch(/晚|风|轻|窗|我们|星光/);
      if (gpuModes.includes(mode)) {
        await expect.poll(async () => (await visualizerLifecycleSnapshot(page)).liveStageContexts).toBeGreaterThan(0);
      }
      const before = (await visualizerLifecycleSnapshot(page)).audioRequests;
      await expect.poll(async () => (await visualizerLifecycleSnapshot(page)).audioRequests).toBeGreaterThan(before + 2);
      await record(phase);
    };
    const stopped = async (phase: string) => {
      await expect(stage.locator('canvas')).toHaveCount(0);
      // R3F disposal is asynchronous; deleting programs or losing the context both release its programs.
      await expect.poll(async () => {
        const sample = await visualizerLifecycleSnapshot(page);
        return { programs: sample.liveStagePrograms, targets: sample.observedStageTargets };
      }).toEqual({ programs: 0, targets: 0 });
      const before = await visualizerLifecycleSnapshot(page);
      await page.waitForTimeout(350);
      const after = await visualizerLifecycleSnapshot(page);
      expect(after.audioRequests).toBe(before.audioRequests);
      expect(after.stageDraws).toBe(before.stageDraws);
      await record(phase);
    };
    try {
      await ready('initial');
      for (let cycle = 1; cycle <= 2; cycle++) {
        await clickPlayerTool(page, '歌词与动效');
        const settings = page.getByRole('dialog', { name: '歌词与动效', exact: true });
        await expect(settings.getByLabel('歌词动画', { exact: true })).toHaveValue(mode);
        await stopped(`settings-${cycle}`);
        await settings.locator(':scope > header').getByRole('button', { name: '关闭', exact: true }).tap();
        await ready(`settings-restored-${cycle}`);
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await stopped(`hidden-${cycle}`);
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, value: false });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await ready(`foreground-${cycle}`);
      }
      await revealPlayerControls(page);
      await page.getByRole('button', { name: '返回音乐库', exact: true }).tap();
      await stopped('collapsed');
      await page.locator('.mini-title').tap();
      await ready('expanded');
      await page.screenshot({ path: info.outputPath('restored.png') });
      expect(await page.evaluate(() => (window as any).fixturePlayback)).toEqual(state);
      expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
      expect(errors).toEqual([]);
      expect(warnings.filter(message => /too many.*context|context.*limit|context.*lost/i.test(message))).toEqual([]);
    } finally {
      await info.attach('stage-lifecycle', {
        body: JSON.stringify({ mode, samples, errors, warnings }, null, 2), contentType: 'application/json',
      });
    }
  });
}
