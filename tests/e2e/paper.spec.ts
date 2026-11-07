import { expect, test, type Page } from '@playwright/test';
import { copyFileSync, readFileSync } from 'node:fs';
import { emptyProject, newBar } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import {
  duplicatePlacement,
  placeDrawing,
  updatePlacement,
} from '../../src/domain/sheets';
import { alignPlacement } from '../../src/domain/paper';

function seed() {
  let p = emptyProject();
  p.name = 'Escalas independentes - barra de 1000 mm';
  p.author = 'Ricardo Corsini';
  p = completeOwnership({
    ...p,
    bars: [{ ...newBar('N1'), quantity: 3 }],
    annotations: [
      {
        id: 'dimension',
        kind: 'dimension-orthogonal',
        points: [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
          { x: 500, y: 400 },
        ],
        textHeight: 40,
        label: '',
        color: '#777777',
      },
    ],
  });
  const a = placeDrawing(p, p.sheets[0].id, p.hierarchy.drawings[0].id);
  p = a.project;
  p = alignPlacement(
    updatePlacement(p, a.id, {
      scale: 50,
      origin: { x: 30, y: 90 },
      frame: { width: 160, height: 80 },
      title: 'Barra em 1:50',
    }),
    a.id,
  );
  const b = duplicatePlacement(p, a.id);
  p = b.project;
  p = alignPlacement(
    updatePlacement(p, b.id, {
      scale: 100,
      origin: { x: 225, y: 90 },
      title: 'Barra em 1:100',
    }),
    b.id,
  );
  return p;
}
async function setup(page: Page) {
  const p = seed();
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'papel.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await page.getByRole('tab', { name: 'Pranchas', exact: true }).click();
  await page
    .getByRole('button', { name: 'Abrir Folha 1', exact: true })
    .click();
  await expect(page.getByTestId('sheet-view')).toHaveCount(2);
  return p;
}
async function save(page: Page) {
  const event = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
}
async function field(page: Page, name: string, value: string) {
  const input = page.getByLabel(name, { exact: true });
  await input.fill(value);
  await input.press('Tab');
}
async function selectFirst(page: Page) {
  await page
    .locator('.sheet-view-list > div')
    .first()
    .getByRole('button')
    .first()
    .click();
}
async function paperLength(page: Page, index: number) {
  return page
    .getByTestId('sheet-view')
    .nth(index)
    .locator('[data-layer="ARMADURAS"]')
    .first()
    .evaluate((path) => (path as SVGPathElement).getTotalLength());
}

test('paper controls, SVG and the exported vector PDF agree on two independent scales, with undo and persistence', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setup(page);
  await expect(
    page.getByRole('region', { name: 'Validação da composição' }),
  ).toContainText('Composição válida');
  expect(await paperLength(page, 0)).toBeCloseTo(20, 4);
  expect(await paperLength(page, 1)).toBeCloseTo(10, 4);
  await selectFirst(page);
  await expect(
    page.getByLabel('Escala da vista 1:N', { exact: true }),
  ).toHaveValue('50');
  const before = await save(page);
  await field(page, 'Escala da vista 1:N', '100');
  await page
    .getByRole('button', { name: 'Centralizar conteúdo', exact: true })
    .click();
  expect(await paperLength(page, 0)).toBeCloseTo(10, 4);
  expect((await save(page)).bars).toEqual(before.bars);
  for (let i = 0; i < 2; i++)
    await page
      .locator('.quick-tools')
      .getByRole('button', { name: 'Desfazer', exact: true })
      .click();
  expect(await save(page)).toEqual(before);
  expect(await paperLength(page, 0)).toBeCloseTo(20, 4);
  const event = page.waitForEvent('download');
  await page
    .locator('.document-toolbar')
    .getByRole('button', { name: 'PDF desta folha', exact: true })
    .click();
  const download = await event,
    path = (await download.path())!;
  const pdf = readFileSync(path).toString('latin1');
  expect(pdf).toContain('Escala 1:50');
  expect(pdf).toContain('Escala 1:100');
  expect(pdf).not.toContain('/Subtype /Image');
  copyFileSync(path, 'test-results/paper-composition.pdf');
  const close = page.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await close.isVisible()) await close.click();
  await page.screenshot({ path: 'docs/paper-composition.png' });
  await page.getByTestId('project-input').setInputFiles({
    name: 'salvo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(before)),
  });
  expect(await save(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('mixed custom/ISO pages, margins and rotation keep scales and steel independent of the paper size', async ({
  page,
}) => {
  await setup(page);
  const initial = await save(page);
  await page.getByLabel('Formato da folha', { exact: true }).selectOption('A1');
  expect(await paperLength(page, 0)).toBeCloseTo(20, 4);
  await selectFirst(page);
  await field(page, 'Vista X', '120');
  await field(page, 'Vista Y', '160');
  await field(page, 'Rotação da vista', '37');
  expect(await paperLength(page, 0)).toBeCloseTo(20, 4);
  await page
    .getByLabel('Nome da nova folha', { exact: true })
    .fill('Personalizada');
  await page
    .getByRole('button', { name: 'Criar folha vazia', exact: true })
    .click();
  await page
    .getByLabel('Formato da folha', { exact: true })
    .selectOption('custom');
  await field(page, 'Lado A do papel', '320');
  await field(page, 'Lado B do papel', '650');
  await page
    .getByLabel('Orientação da folha', { exact: true })
    .selectOption('portrait');
  await page.getByText('Área útil e reserva do selo', { exact: true }).click();
  await field(page, 'Margem esquerda', '12');
  const p = await save(page);
  expect(p.bars).toEqual(initial.bars);
  expect(p.sheets[1].customSize).toEqual({ width: 320, height: 650 });
  expect(p.sheets[1].margins.left).toBe(12);
  const event = page.waitForEvent('download');
  await page
    .getByRole('button', {
      name: 'Exportar todas as folhas em PDF',
      exact: true,
    })
    .click();
  const pdf = readFileSync((await (await event).path())!).toString('latin1');
  expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(2);
  const boxes = [...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(
    (m) => [(Number(m[1]) * 25.4) / 72, (Number(m[2]) * 25.4) / 72],
  );
  expect(boxes[0][0]).toBeCloseTo(841, 5);
  expect(boxes[0][1]).toBeCloseTo(594, 5);
  expect(boxes[1][0]).toBeCloseTo(320, 5);
  expect(boxes[1][1]).toBeCloseTo(650, 5);
});

test('paper and title-block overflow stay visible and block PDF output instead of cropping', async ({
  page,
}) => {
  await setup(page);
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await page.getByLabel('Formato da folha', { exact: true }).selectOption('A4');
  await expect(
    page.getByRole('region', { name: 'Validação da composição' }),
  ).toContainText('fora da área útil');
  await expect(page.locator('[data-testid="sheet-view"].invalid')).toHaveCount(
    1,
  );
  await page
    .locator('.document-toolbar')
    .getByRole('button', { name: 'PDF desta folha', exact: true })
    .click();
  await expect(page.locator('.toast')).toContainText('PDF não exportado');
  expect(downloads).toEqual([]);
  await page.getByLabel('Formato da folha', { exact: true }).selectOption('A3');
  await selectFirst(page);
  await field(page, 'Vista X', '250');
  await field(page, 'Vista Y', '10');
  await expect(
    page.getByRole('region', { name: 'Validação da composição' }),
  ).toContainText('sobre a reserva do selo');
  await page
    .locator('.document-toolbar')
    .getByRole('button', { name: 'PDF desta folha', exact: true })
    .click();
  await expect(page.locator('.toast')).toContainText('selo');
  expect(downloads).toEqual([]);
});
