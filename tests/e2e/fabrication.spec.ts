import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject, newBar, schedule } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import { groupFabrication } from '../../src/domain/fabrication';
import { placeDrawing, duplicatePlacement } from '../../src/domain/sheets';
import type { Project } from '../../src/domain/types';
function fixture() {
  let p = emptyProject();
  p.hierarchy.floors[0].name = 'Térreo';
  p.hierarchy.elements[0].name = 'V1';
  p.hierarchy.details[0].name = 'Longitudinais';
  p = completeOwnership({
    ...p,
    bars: [
      { ...newBar('N1'), id: 'bar-a', diameter: 10, quantity: 4 },
      {
        ...newBar('N2'),
        id: 'bar-b',
        diameter: 10,
        quantity: 3,
        origin: { x: 2000, y: 600 },
      },
    ],
    details: [{ id: 'rep-b', barId: 'bar-b', origin: { x: 0, y: -700 } }],
    annotations: [
      {
        id: 'call-b',
        kind: 'leader',
        barId: 'bar-b',
        points: [
          { x: 2000, y: 600 },
          { x: 2300, y: 900 },
          { x: 2600, y: 900 },
        ],
        label: '',
        textHeight: 40,
        color: '#ffffff',
      },
    ],
  });
  p = placeDrawing(p, p.sheets[0].id, p.hierarchy.drawings[0].id).project;
  return duplicatePlacement(p, p.hierarchy.placements[0].id).project;
}
async function closeToast(page: Page) {
  const b = page.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await b.isVisible()) await b.click();
}
async function load(page: Page, p: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'positions.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
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
    .getByRole('button', { name: 'Posições de fabricação', exact: true })
    .click();
  const d = page.getByRole('dialog', {
    name: 'Posições de fabricação',
    exact: true,
  });
  await expect(d).toBeVisible();
  return d;
}
async function undo(page: Page, name = 'Desfazer') {
  await closeToast(page);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name, exact: true })
    .click();
}

test('preview selects representative, preserves physical occurrences and views, consolidates traceable schedule and persists with one undo', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, fixture());
  await page.getByRole('button', { name: 'Bloquear RA', exact: true }).click();
  const baseline = await save(page);
  let d = await open(page);
  await expect(d).toContainText('2 → 1 posições');
  await expect(d).toContainText('4 + 3 = 7 peças');
  await d.getByLabel('Pesquisar ocorrências de fabricação').fill('bar-b');
  await expect(
    d.getByRole('checkbox', { name: 'Incluir ocorrência bar-a' }),
  ).toHaveCount(0);
  await d.getByLabel('Pesquisar ocorrências de fabricação').fill('');
  await d.getByLabel('Representante de fabricação').selectOption('bar-b');
  await expect(
    d.getByLabel('Identificação da posição de fabricação'),
  ).toHaveValue('N2');
  await d.screenshot({ path: 'docs/fabrication-positions.png' });
  await d.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(await save(page)).toEqual(baseline);
  d = await open(page);
  await d.getByLabel('Representante de fabricação').selectOption('bar-b');
  await d
    .getByRole('button', { name: 'Aplicar posições', exact: true })
    .click();
  let p = await save(page);
  expect(p.bars).toHaveLength(2);
  expect(p.bars.map((b) => b.mark)).toEqual(['N2', 'N2']);
  expect(p.annotations).toEqual(baseline.annotations);
  expect(p.details).toEqual(baseline.details);
  expect(p.hierarchy.placements).toEqual(baseline.hierarchy.placements);
  expect(p.scheduleLock).toBeUndefined();
  expect(schedule(p)).toHaveLength(1);
  expect(schedule(p)[0].quantity).toBe(7);
  await page
    .locator('.document-tabs')
    .getByRole('button', { name: /Quadro de aço/ })
    .click();
  await expect(page.locator('.schedule-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.schedule-table')).toContainText('3 + 4 = 7');
  await page.getByText('2 ocorrências · origens', { exact: true }).click();
  await expect(page.locator('.fabrication-contributions')).toContainText(
    'bar-a',
  );
  await expect(page.locator('.fabrication-contributions')).toContainText(
    'bar-b',
  );
  await undo(page);
  expect(await save(page)).toEqual(baseline);
  await undo(page, 'Refazer');
  p = await save(page);
  expect(schedule(p)).toHaveLength(1);
  await load(page, p);
  expect(await save(page)).toEqual(p);
  expect(errors).toEqual([]);
});
test('editing one occurrence separates its fabrication position while other occurrences and linked calls remain intact', async ({
  page,
}) => {
  const p = groupFabrication(fixture(), ['bar-a', 'bar-b'], 'bar-a');
  await load(page, p);
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page.locator('.bar-row').nth(1).click();
  await page.getByLabel('Bitola (mm)', { exact: true }).selectOption('12.5');
  let next = await save(page);
  expect(next.bars[0]).toEqual(p.bars[0]);
  expect(next.bars[1].diameter).toBe(12.5);
  expect(next.bars[1].mark).not.toBe('N1');
  expect(schedule(next)).toHaveLength(2);
  expect(next.annotations).toEqual(p.annotations);
  expect(next.details).toEqual(p.details);
  await undo(page);
  expect(await save(page)).toEqual(p);
  await undo(page, 'Refazer');
  next = await save(page);
  await load(page, next);
  expect(await save(page)).toEqual(next);
});
test('ungroup is reversible, selecting a single occurrence never removes steel, and invalid selection cannot be applied', async ({
  page,
}) => {
  const p = groupFabrication(fixture(), ['bar-a', 'bar-b'], 'bar-a');
  await load(page, p);
  let d = await open(page);
  await d.getByRole('checkbox', { name: 'Incluir ocorrência bar-b' }).uncheck();
  await expect(
    d.getByRole('button', { name: 'Aplicar posições', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(p);
  d = await open(page);
  await d.getByLabel('Operação de fabricação').selectOption('ungroup');
  await d.getByRole('checkbox', { name: 'Incluir ocorrência bar-a' }).uncheck();
  await expect(d).toContainText('1 → 2 posições');
  await d
    .getByRole('button', { name: 'Aplicar posições', exact: true })
    .click();
  const next = await save(page);
  expect(schedule(next)).toHaveLength(2);
  expect(schedule(next).reduce((n, r) => n + r.quantity, 0)).toBe(7);
  expect(next.bars.map((b) => b.points)).toEqual(p.bars.map((b) => b.points));
  await undo(page);
  expect(await save(page)).toEqual(p);
});
