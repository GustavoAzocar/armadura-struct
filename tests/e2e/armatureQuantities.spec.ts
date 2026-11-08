import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject, newBar, schedule } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import { setDetailRepetition } from '../../src/domain/detailRepetition';
import { groupFabrication } from '../../src/domain/fabrication';
import { placeDrawing, duplicatePlacement } from '../../src/domain/sheets';
import type { Project } from '../../src/domain/types';
function fixture(range = false) {
  let p = completeOwnership({
    ...emptyProject(),
    bars: [
      {
        ...newBar('N1'),
        id: 'quantity-bar',
        quantity: 2,
        diameter: 10,
        ...(range ? { distribution: { end: { x: 1000, y: 0 } } } : {}),
      },
    ],
  });
  p = setDetailRepetition(p, p.hierarchy.details[0].id, {
    factor: 4,
    elements: [],
  });
  p.hierarchy.details[0].grouped = false;
  p = completeOwnership({
    ...p,
    details: [
      { id: 'rebatimento', barId: 'quantity-bar', origin: { x: 0, y: -400 } },
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
    name: 'quantities.json',
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
async function select(page: Page, index = 0) {
  await closeToast(page);
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page.locator('.bar-row').nth(index).click();
}
async function fill(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel(label, { exact: true }).press('Tab');
}
async function undo(page: Page, name = 'Desfazer') {
  await closeToast(page);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name, exact: true })
    .click();
}
const pieces = (p: Project) => schedule(p).reduce((n, r) => n + r.quantity, 0);
test('2 by 3 by 4 remains 24 across two views; assembly metadata is searchable and survives undo and reopening', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, fixture());
  await select(page);
  await fill(page, 'Multiplicador da armadura', '3');
  await expect(page.getByTestId('bar-effective-quantity')).toContainText(
    '24 peças efetivas',
  );
  await page.locator('.assembly-fields > summary').click();
  await fill(page, 'Observação da armadura', 'Montagem alternada');
  await fill(page, 'Referência ao lance', 'L2-L3');
  await page.getByLabel('Armadura por nervura', { exact: true }).check();
  await page
    .getByLabel('Mostrar indicação por nervura', { exact: true })
    .check();
  let p = await save(page);
  expect(pieces(p)).toBe(24);
  expect(p.bars[0]).toMatchObject({
    quantity: 2,
    multiplier: 3,
    comment: 'Montagem alternada',
    columnLevel: 'L2-L3',
    ribbed: true,
    showRibbed: true,
  });
  expect(p.hierarchy.placements).toHaveLength(2);
  await page.locator('.inspector .panel-scroll').evaluate((el) => {
    el.scrollTop = 150;
  });
  await closeToast(page);
  await page.screenshot({ path: 'docs/armature-quantities.png' });
  await page
    .getByLabel('Descrição da quantidade', { exact: true })
    .selectOption('total');
  expect(pieces(await save(page))).toBe(24);
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page
    .getByLabel('Pesquisar no projeto', { exact: true })
    .fill('Montagem alternada');
  await expect(page.locator('.bar-row')).toHaveCount(1);
  await page.getByLabel('Pesquisar no projeto', { exact: true }).fill('L2-L3');
  await expect(page.locator('.bar-row')).toHaveCount(1);
  await page.getByLabel('Pesquisar no projeto', { exact: true }).fill('');
  await page
    .locator('.document-tabs')
    .getByRole('button', { name: /Quadro de aço/ })
    .click();
  await expect(page.locator('.schedule-table')).toContainText('2 × 3 × 4 = 24');
  await page.getByText('1 ocorrências · origens', { exact: true }).click();
  await expect(page.locator('.fabrication-contributions')).toContainText(
    'Montagem alternada',
  );
  await expect(page.locator('.fabrication-contributions')).toContainText(
    'L2-L3',
  );
  await select(page);
  await fill(page, 'Multiplicador da armadura', '1');
  expect(pieces(await save(page))).toBe(8);
  await undo(page);
  expect(pieces(await save(page))).toBe(24);
  await undo(page, 'Refazer');
  expect(pieces(await save(page))).toBe(8);
  p = await save(page);
  await load(page, p);
  expect(await save(page)).toEqual(p);
  expect(errors).toEqual([]);
});
test('range spacing controls only the base and visual edits preserve source, spacing and factors', async ({
  page,
}) => {
  await load(page, fixture(true));
  await select(page);
  await fill(page, 'Multiplicador da armadura', '3');
  await page
    .getByLabel('Origem da quantidade base', { exact: true })
    .selectOption('spacing');
  await expect(page.getByLabel('Quantidade', { exact: true })).toBeDisabled();
  await fill(page, 'Espaçamento máximo', '200');
  let p = await save(page);
  expect(p.bars[0]).toMatchObject({
    quantity: 6,
    multiplier: 3,
    quantitySource: { kind: 'distribution', mode: 'spacing', spacing: 200 },
  });
  expect(pieces(p)).toBe(72);
  await page
    .getByLabel('Representação da faixa', { exact: true })
    .selectOption('bars');
  p = await save(page);
  expect(p.bars[0].quantitySource).toEqual({
    kind: 'distribution',
    mode: 'spacing',
    spacing: 200,
  });
  expect(pieces(p)).toBe(72);
  await page
    .getByLabel('Origem da quantidade base', { exact: true })
    .selectOption('manual');
  await expect(page.getByLabel('Quantidade', { exact: true })).toBeEnabled();
  await fill(page, 'Quantidade', '2');
  expect(pieces(await save(page))).toBe(24);
  await page
    .getByRole('button', { name: 'Remover distribuição', exact: true })
    .click();
  p = await save(page);
  expect(p.bars[0].distribution).toBeUndefined();
  expect(p.bars[0].quantitySource).toEqual({ kind: 'manual' });
  expect(pieces(p)).toBe(24);
  await load(page, p);
  expect(await save(page)).toEqual(p);
});
test('nervure text and invalid factors do not change the total or enter history', async ({
  page,
}) => {
  await load(page, fixture());
  await select(page);
  const baseline = await save(page);
  await fill(page, 'Multiplicador da armadura', '2.5');
  await expect(
    page.getByLabel('Multiplicador da armadura', { exact: true }),
  ).toHaveValue('1');
  expect(await save(page)).toEqual(baseline);
  await page.locator('.assembly-fields > summary').click();
  await page
    .getByLabel('Mostrar indicação por nervura', { exact: true })
    .check();
  let p = await save(page);
  expect(pieces(p)).toBe(8);
  expect(p.bars[0].ribbed).toBeUndefined();
  await page.getByLabel('Armadura por nervura', { exact: true }).check();
  p = await save(page);
  expect(pieces(p)).toBe(8);
  await undo(page);
  expect(pieces(await save(page))).toBe(8);
  await undo(page);
  expect(await save(page)).toEqual(baseline);
});
test('a shared fabrication position retains distinct occurrence multipliers and metadata', async ({
  page,
}) => {
  let p = fixture();
  p = completeOwnership({
    ...p,
    bars: [...p.bars, { ...p.bars[0], id: 'other', mark: 'N2' }],
  });
  p = groupFabrication(p, ['quantity-bar', 'other'], 'quantity-bar');
  await load(page, p);
  await select(page, 1);
  await fill(page, 'Multiplicador da armadura', '3');
  const q = await save(page);
  expect(schedule(q)).toHaveLength(1);
  expect(pieces(q)).toBe(8 + 24);
  expect(q.bars[0].multiplier).toBe(1);
  expect(q.bars[1].multiplier).toBe(3);
  expect(q.bars.map((b) => b.mark)).toEqual(['N1', 'N1']);
  await undo(page);
  expect(await save(page)).toEqual(p);
});
