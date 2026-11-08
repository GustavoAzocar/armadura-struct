import { test, expect, type Page } from '@playwright/test';
import { readFileSync, copyFileSync } from 'node:fs';
import { emptyProject, newBar, schedule } from '../../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
  moveObjectsToDetail,
} from '../../src/domain/hierarchy';
import {
  createSheet,
  placeDrawing,
  updatePlacement,
  duplicatePlacement,
} from '../../src/domain/sheets';
import { alignPlacement } from '../../src/domain/paper';
import {
  defaultSheetSchedule,
  setSheetSchedule,
  sheetScheduleData,
} from '../../src/domain/sheetSchedule';
import type { Project } from '../../src/domain/types';
function fixture() {
  let p = completeOwnership({
    ...emptyProject(),
    name: 'Quadro de aço por prancha',
    bars: Array.from({ length: 17 }, (_, i) => ({
      ...newBar(`N${i + 1}`),
      id: `bar${i}`,
      quantity: i === 0 ? 4 : 2 + i,
      steel: i < 4 ? 'CA-60' : 'CA-50',
      diameter: i < 4 ? 5 : i < 9 ? 10 : i < 12 ? 12.5 : 16,
      points: [
        { x: 0, y: 0 },
        { x: 870 + i * 30, y: 0 },
      ],
      origin: { x: 0, y: i * 250 },
    })),
  });
  p = {
    ...p,
    hierarchy: {
      ...p.hierarchy,
      details: p.hierarchy.details.map((d) => ({ ...d, name: 'V1=V2=V3' })),
    },
  };
  const made = createHierarchyNode(
    p,
    'detail',
    'P1-L1',
    p.hierarchy.elements[0].id,
  );
  p = moveObjectsToDetail(made.project, ['bar16'], made.id);
  const second = createSheet(p, 'Pilares');
  p = second.project;
  for (let i = 0; i < 2; i++) {
    const detail = p.hierarchy.objectDetails[i ? 'bar16' : 'bar0'];
    const placed = placeDrawing(
      p,
      p.sheets[i].id,
      p.hierarchy.drawings.find((d) => d.detailId === detail)!.id,
    );
    p = updatePlacement(placed.project, placed.id, {
      origin: { x: 30, y: 155 },
      scale: 50,
      frame: { width: 150, height: 120 },
    });
    p = alignPlacement(p, placed.id);
  }
  p = duplicatePlacement(p, p.hierarchy.placements[0].id).project;
  p = updatePlacement(p, p.hierarchy.placements.at(-1)!.id, {
    origin: { x: 30, y: 20 },
    frame: { width: 150, height: 120 },
    scale: 50,
  });
  p = alignPlacement(p, p.hierarchy.placements.at(-1)!.id);
  return p;
}
async function load(page: Page, p: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'sheet-schedule.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await expect(
    page.getByRole('banner').getByText(p.name, { exact: true }),
  ).toBeVisible();
}
async function save(page: Page): Promise<Project> {
  const c = page.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await c.isVisible()) await c.click();
  const event = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
}
async function point(page: Page, x: number, y: number) {
  return page
    .getByTestId('sheet-canvas')
    .locator(':scope > g')
    .evaluate(
      (g, at) => {
        const p = new DOMPoint(at.x, at.y).matrixTransform(
          (g as SVGGElement).getScreenCTM()!,
        );
        return { x: p.x, y: p.y };
      },
      { x, y },
    );
}
async function place(page: Page, x = 270, y = 280) {
  const at = await point(page, x, y);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
}
async function start(page: Page) {
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  await page
    .locator('.ribbon-content')
    .getByRole('button', { name: 'Inserir quadro na prancha', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Inserir quadro na prancha' }),
  ).toBeVisible();
}
const mass = (p: Project) => schedule(p).reduce((s, r) => s + r.weight, 0);
test('duas opções da RA, quadro no cursor, aço da folha, PDF vetorial, desfazer/refazer e persistência', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const p = fixture();
  await load(page, p);
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  await page
    .locator('.ribbon-content')
    .getByRole('button', { name: 'Quadro de aço', exact: true })
    .click();
  await expect(page.getByRole('table')).toBeVisible();
  await start(page);
  await expect(page.getByTestId('sheet-canvas')).toBeVisible();
  await expect(page.getByTestId('sheet-schedule-preview')).toBeVisible();
  expect(await save(page)).toEqual(p);
  const at = await point(page, 270, 280);
  await page.mouse.move(at.x, at.y);
  await expect(page.getByTestId('sheet-schedule-preview')).toContainText(
    'RESUMO DO AÇO',
  );
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('sheet-steel-schedule')).toHaveCount(1);
  await expect(page.getByTestId('sheet-schedule-preview')).toHaveCount(0);
  const q = await save(page);
  expect(q.sheets[0].steelSchedule?.origin.x).toBeCloseTo(270, 0);
  expect(q.sheets[1].steelSchedule).toBeUndefined();
  expect(mass(q)).toBe(mass(p));
  expect(sheetScheduleData(q, q.sheets[0].id).barIds).toHaveLength(16);
  await expect(page.getByTestId('sheet-steel-schedule')).toContainText('N16');
  await expect(page.getByTestId('sheet-steel-schedule')).not.toContainText(
    'N17',
  );
  const close = page.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await close.isVisible()) await close.click();
  await page.screenshot({ path: 'docs/sheet-steel-schedule.png' });
  const event = page.waitForEvent('download');
  await page
    .locator('.document-toolbar')
    .getByRole('button', { name: 'PDF desta folha', exact: true })
    .click();
  const file = (await (await event).path())!;
  const pdf = readFileSync(file).toString('latin1');
  expect(pdf).toContain('C.TOTAL');
  expect(pdf).not.toContain('/Subtype /Image');
  copyFileSync(file, 'test-results/sheet-steel-schedule.pdf');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  expect(await save(page)).toEqual(p);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Refazer', exact: true })
    .click();
  expect(await save(page)).toEqual(q);
  await load(page, q);
  await page.getByRole('tab', { name: 'Pranchas', exact: true }).click();
  await page
    .getByRole('button', { name: 'Abrir Folha 1', exact: true })
    .click();
  await expect(page.getByTestId('sheet-steel-schedule')).toBeVisible();
  expect(await save(page)).toEqual(q);
  expect(errors).toEqual([]);
});
test('cancelar, área inválida, troca de destino e remover quadro não mudam armaduras', async ({
  page,
}) => {
  const p = fixture();
  await load(page, p);
  await start(page);
  await place(page, 400, 25);
  await expect(page.getByTestId('sheet-steel-schedule')).toHaveCount(0);
  await expect(page.getByTestId('sheet-schedule-preview')).toBeVisible();
  expect(await save(page)).toEqual(p);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sheet-schedule-preview')).toHaveCount(0);
  await start(page);
  await page
    .getByLabel('Prancha do quadro', { exact: true })
    .selectOption(p.sheets[1].id);
  await place(page);
  const q = await save(page);
  expect(q.sheets[0].steelSchedule).toBeUndefined();
  expect(q.sheets[1].steelSchedule).toBeDefined();
  await expect(page.getByTestId('sheet-steel-schedule')).toContainText('N17');
  await expect(page.getByTestId('sheet-steel-schedule')).not.toContainText(
    'N16',
  );
  await page
    .getByRole('button', { name: 'Retirar quadro da folha', exact: true })
    .click();
  expect((await save(page)).bars).toEqual(p.bars);
  await expect(page.getByTestId('sheet-steel-schedule')).toHaveCount(0);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  expect(await save(page)).toEqual(q);
  await start(page);
  const at = await point(page, 270, 280);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(page.getByTestId('sheet-schedule-preview')).toHaveCount(0);
  expect(await save(page)).toEqual(q);
});
test('edição física atualiza o quadro vinculado, arraste/edição de papel e reposicionamento não duplicam aço', async ({
  page,
}) => {
  let p = fixture();
  p = setSheetSchedule(
    p,
    p.sheets[0].id,
    defaultSheetSchedule({ x: 270, y: 280 }),
  );
  await load(page, p);
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page
    .locator('.bar-row')
    .filter({ has: page.getByText('N1', { exact: true }) })
    .click();
  const qty = page.getByLabel('Quantidade', { exact: true });
  await qty.fill('8');
  await qty.press('Tab');
  await page.getByRole('tab', { name: 'Pranchas', exact: true }).click();
  await page
    .getByRole('button', { name: 'Abrir Folha 1', exact: true })
    .click();
  const changed = await save(page);
  expect(
    sheetScheduleData(changed, changed.sheets[0].id).rows.find(
      (r) => r.mark === 'N1',
    )?.quantity,
  ).toBe(8);
  await start(page);
  await place(page, 260, 275);
  await expect(page.getByTestId('sheet-steel-schedule')).toHaveCount(1);
  const q = await save(page);
  expect(q.bars).toEqual(changed.bars);
  const a = await point(page, 270, 260),
    b = await point(page, 280, 250);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await page.mouse.up();
  const r = await save(page);
  expect(
    r.sheets[0].steelSchedule!.origin.x - q.sheets[0].steelSchedule!.origin.x,
  ).toBeCloseTo(10, 0);
  expect(r.bars).toEqual(q.bars);
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('sheet-steel-schedule')).toHaveCount(0);
  expect((await save(page)).bars).toEqual(changed.bars);
});
