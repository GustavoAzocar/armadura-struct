import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject, newBar, schedule } from '../../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
} from '../../src/domain/hierarchy';
import { placeDrawing, duplicatePlacement } from '../../src/domain/sheets';
import type { Project } from '../../src/domain/types';

function fixture(copies = false) {
  let p = emptyProject();
  p.hierarchy.elements[0].name = 'V1';
  p.hierarchy.details[0].name = 'Armação V1';
  p = completeOwnership({
    ...p,
    bars: [{ ...newBar('N1'), id: 'bar-1', diameter: 10, quantity: 4 }],
  });
  if (copies)
    for (let i = 2; i <= 3; i++) {
      const e = createHierarchyNode(
          p,
          'element',
          `V${i}`,
          p.hierarchy.floors[0].id,
        ),
        d = createHierarchyNode(e.project, 'detail', `Armação V${i}`, e.id);
      p = completeOwnership(
        {
          ...d.project,
          bars: [
            ...p.bars,
            {
              ...newBar(`N${i}`),
              id: `bar-${i}`,
              diameter: 10,
              quantity: 4,
              origin: { x: i * 2000, y: 0 },
            },
          ],
        },
        d.id,
      );
    }
  for (const d of p.hierarchy.drawings)
    p = placeDrawing(p, p.sheets[0].id, d.id).project;
  if (!copies) p = duplicatePlacement(p, p.hierarchy.placements[0].id).project;
  return p;
}
async function load(page: Page, p: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'project.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
}
async function closeToast(page: Page) {
  const close = page.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await close.isVisible()) await close.click();
}
async function save(page: Page): Promise<Project> {
  await closeToast(page);
  const event = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
}
async function open(page: Page) {
  await closeToast(page);
  await page.getByRole('tab', { name: 'Elementos', exact: true }).click();
  await page
    .getByRole('button', { name: 'Repetições do detalhamento', exact: true })
    .click();
  const modal = page.getByRole('dialog', {
    name: 'Repetições do detalhamento',
    exact: true,
  });
  await expect(modal).toBeVisible();
  return modal;
}
const pieces = (p: Project) => schedule(p).reduce((n, r) => n + r.quantity, 0);
test('repetition multiplies physical quantities once across two views, updates names/exports and is removable with undo and persistence', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, fixture());
  await page.getByRole('button', { name: 'Bloquear RA', exact: true }).click();
  const baseline = await save(page);
  let dialog = await open(page);
  await dialog.getByLabel('Fator de repetição', { exact: true }).fill('3');
  await dialog.getByLabel('Nomes dos elementos repetidos').fill('V1\nV2\nV3');
  await expect(dialog).toContainText('4 → 12 peças');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(await save(page)).toEqual(baseline);
  dialog = await open(page);
  await dialog.getByLabel('Fator de repetição', { exact: true }).fill('3');
  await dialog.getByLabel('Nomes dos elementos repetidos').fill('V1\nV2\nV3');
  await dialog.screenshot({ path: 'docs/detail-repetition.png' });
  await dialog
    .getByRole('button', { name: 'Aplicar repetição', exact: true })
    .click();
  let saved = await save(page);
  expect(saved.bars[0].quantity).toBe(4);
  expect(pieces(saved)).toBe(12);
  expect(saved.scheduleLock).toBeUndefined();
  expect(saved.hierarchy.placements).toHaveLength(2);
  await page
    .locator('.document-tabs')
    .getByRole('button', { name: /Quadro de aço/ })
    .click();
  await expect(page.getByRole('table')).toContainText('4 × 3 = 12');
  dialog = await open(page);
  await dialog.getByLabel('Nomes dos elementos repetidos').fill('V1\nV5\nV7');
  await dialog
    .getByRole('button', { name: 'Aplicar repetição', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  await closeToast(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Quadro CSV', exact: true }).click();
  const csv = readFileSync((await (await download).path())!, 'utf8');
  expect(csv).toContain('V1 = V5 = V7');
  expect(csv).toContain('"4";"3";"12"');
  dialog = await open(page);
  await dialog.getByLabel('Fator de repetição', { exact: true }).fill('2');
  await dialog.getByLabel('Nomes dos elementos repetidos').fill('V1\nV5');
  await dialog
    .getByRole('button', { name: 'Aplicar repetição', exact: true })
    .click();
  expect(pieces(await save(page))).toBe(8);
  dialog = await open(page);
  await dialog
    .getByRole('button', { name: 'Remover repetição', exact: true })
    .click();
  expect(pieces(await save(page))).toBe(4);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  expect(pieces(await save(page))).toBe(8);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Refazer', exact: true })
    .click();
  saved = await save(page);
  expect(pieces(saved)).toBe(4);
  await load(page, saved);
  expect(await save(page)).toEqual(saved);
  expect(errors).toEqual([]);
});
test('merging existing identical details chooses the representative, redirects views and leaves one physical definition with the same total', async ({
  page,
}) => {
  const p = fixture(true),
    rep = p.hierarchy.details[1].id;
  await load(page, p);
  const baseline = await save(page);
  const dialog = await open(page);
  await dialog.getByLabel('Operação da repetição').selectOption('merge');
  await dialog.getByLabel('Representante da repetição').selectOption(rep);
  await dialog.getByRole('checkbox', { name: /Reunir.*Armação V1/ }).check();
  await dialog.getByRole('checkbox', { name: /Reunir.*Armação V3/ }).check();
  await expect(dialog).toContainText('12 → 12 peças');
  await expect(dialog.getByLabel('Fator de repetição')).toHaveValue('3');
  await dialog
    .getByRole('button', { name: 'Aplicar repetição', exact: true })
    .click();
  let saved = await save(page);
  expect(saved.bars).toHaveLength(1);
  expect(saved.bars[0]).toMatchObject({ id: 'bar-2', quantity: 4 });
  expect(pieces(saved)).toBe(12);
  expect(saved.hierarchy.drawings.every((d) => d.detailId === rep)).toBe(true);
  expect(saved.hierarchy.placements.map((v) => v.id)).toEqual(
    p.hierarchy.placements.map((v) => v.id),
  );
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
  expect(saved.bars).toHaveLength(1);
  expect(pieces(saved)).toBe(12);
  await load(page, saved);
  expect(await save(page)).toEqual(saved);
});
test('invalid factor or incomplete names block application and cancellation leaves the project intact', async ({
  page,
}) => {
  await load(page, fixture());
  const baseline = await save(page);
  const dialog = await open(page);
  await dialog.getByLabel('Fator de repetição').fill('2.5');
  await expect(
    dialog.getByRole('button', { name: 'Aplicar repetição', exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel('Fator de repetição').fill('3');
  await dialog.getByLabel('Nomes dos elementos repetidos').fill('V1\nV2');
  await expect(
    dialog.getByRole('button', { name: 'Aplicar repetição', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(baseline);
});
