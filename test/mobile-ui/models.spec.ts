import { expect, test, clickPlayerTool } from './fixtures';

// models.spec.ts — original rows through a controlled native bridge; actual model QA is in XCTest.
test('model preparation, cancellation, import and removal stay usable by touch after rotation', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const win = window as any; win.fixtureNoServer = true;
    win.fixtureModelBridge = async (method: string, options: any) => {
      if (method === 'getModels') return structuredClone(win.fixtureModels);
      if (win.fixtureModelFail) throw new Error('model-hash-mismatch');
      const model = win.fixtureModels.models.find((item: any) => item.name === options?.name) ?? win.fixtureModels.models[0];
      if (method === 'downloadModel') Object.assign(model, { phase: 'downloading', received: 20000000, host: 'fixture.invalid' });
      if (method === 'cancelModel') Object.assign(model, { phase: 'absent', received: 0, host: '' });
      if (method === 'importModel') Object.assign(model, { installed: true, phase: 'installed', received: model.bytes });
      if (method === 'removeModels') for (const value of win.fixtureModels.models) Object.assign(value, { installed: false, phase: 'absent', received: 0 });
      win.fixtureModels.capabilities.beatGrid = win.fixtureModels.models[0].installed;
      win.fixtureEmitModels(); return method === 'importModel' ? { cancelled: false } : structuredClone(win.fixtureModels);
    };
  });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).tap();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).tap();
  await clickPlayerTool(page, 'Folia 智能过渡');
  const section = page.getByRole('region', { name: '分析模型' });
  await section.getByRole('button', { name: '下载', exact: true }).first().tap();
  await expect(section.getByText('fixture.invalid')).toBeVisible();
  await section.getByRole('button', { name: '取消', exact: true }).tap();
  await expect(section.getByRole('button', { name: '下载', exact: true })).toHaveCount(2);
  await page.evaluate(() => { (window as any).fixtureModelFail = true; });
  await section.getByRole('button', { name: '导入模型文件' }).tap();
  await expect(section.getByRole('alert')).toBeVisible();
  await page.evaluate(() => { (window as any).fixtureModelFail = false; });
  await section.getByRole('button', { name: '导入模型文件' }).tap();
  await expect(section.getByText('已安装', { exact: true }).first()).toBeVisible();
  await page.setViewportSize(info.project.name === 'phone' ? { width: 844, height: 390 } : { width: 834, height: 1194 });
  expect(await section.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const button = section.getByRole('button', { name: '导入模型文件' });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await section.getByRole('button', { name: '删除所有模型' }).tap();
  const confirm = page.getByRole('dialog', { name: '删除所有模型' });
  await confirm.getByRole('button', { name: '确定', exact: true }).tap();
  await expect(section.getByRole('button', { name: '下载', exact: true })).toHaveCount(2);
  await expect(page.getByRole('heading', { name: '删除所有模型', exact: true })).not.toBeVisible();
  await page.screenshot({ path: '.mobile-test-results/model-queue-integration/models-' + info.project.name + '.png' });
  expect(errors).toEqual([]);
});
