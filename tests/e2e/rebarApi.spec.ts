import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRebarApiExample } from '../../docs/examples/rebar-api';
import { schedule } from '../../src/domain/model';
import type { Project } from '../../src/domain/types';

async function save(page: Page): Promise<Project> {
  const close = page.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await close.isVisible()) await close.click();
  const event = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
}
async function load(page: Page, project: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'gerado.armstruct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
}
async function select(page: Page, mark: string, additive = false) {
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  const row = page
    .locator('.bar-row')
    .filter({ has: page.getByText(mark, { exact: true }) });
  await row.click({ modifiers: additive ? ['Shift'] : [] });
}
test('script-generated set reopens with identical quantities; UI edits hook and diameter and preserves every linked representation', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { project } = createRebarApiExample();
  await load(page, project);
  expect(await save(page)).toEqual(project);
  await select(page, 'N2');
  const before = schedule(project).find((r) => r.bar.id === 'api-stirrup')!;
  await page
    .getByLabel('Prolongamento reto do gancho', { exact: true })
    .fill('85');
  await page
    .getByLabel('Prolongamento reto do gancho', { exact: true })
    .press('Tab');
  let saved = await save(page);
  expect(
    schedule(saved).find((r) => r.bar.id === 'api-stirrup')!.unitLength -
      before.unitLength,
  ).toBeCloseTo(0.04, 10);
  await page.getByLabel('Bitola (mm)', { exact: true }).selectOption('8');
  saved = await save(page);
  expect(saved.bars.find((b) => b.id === 'api-stirrup')).toMatchObject({
    hook: 85,
    diameter: 8,
    quantity: 8,
  });
  expect(saved.details).toEqual(project.details);
  expect(saved.bars).toHaveLength(2);
  expect(schedule(saved).reduce((n, r) => n + r.quantity, 0)).toBe(11);
  await load(page, saved);
  expect(await save(page)).toEqual(saved);
  expect(errors).toEqual([]);
});
test('a UI batch affecting two positions and linked graphics is one undo/redo operation', async ({
  page,
}) => {
  const { project } = createRebarApiExample();
  await load(page, project);
  const baseline = await save(page);
  await select(page, 'N1');
  await select(page, 'N2', true);
  await page.getByRole('tab', { name: 'Elementos', exact: true }).click();
  await page
    .locator('.ribbon-content')
    .getByRole('button', { name: 'Excluir', exact: true })
    .click();
  let saved = await save(page);
  expect(saved.bars).toEqual([]);
  expect(saved.details).toEqual([]);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  expect(await save(page)).toEqual(baseline);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Refazer', exact: true })
    .click();
  saved = await save(page);
  expect(saved.bars).toEqual([]);
  expect(saved.details).toEqual([]);
});
test('invalid UI physical edit is rejected by the shared API without entering history', async ({
  page,
}) => {
  const { project } = createRebarApiExample();
  await load(page, project);
  await select(page, 'N2');
  const baseline = await save(page);
  await page.getByLabel('Largura no eixo', { exact: true }).fill('1');
  await page.getByLabel('Largura no eixo', { exact: true }).press('Tab');
  await expect(page.getByRole('status')).toContainText('insuficiente');
  await expect(page.getByLabel('Largura no eixo', { exact: true })).toHaveValue(
    '220',
  );
  expect(await save(page)).toEqual(baseline);
  // The latest real operation is still loading the generated project, not a partial edit.
  await page
    .getByLabel('Prolongamento reto do gancho', { exact: true })
    .fill('85');
  await page
    .getByLabel('Prolongamento reto do gancho', { exact: true })
    .press('Tab');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  expect(await save(page)).toEqual(baseline);
});
