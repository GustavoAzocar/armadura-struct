import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject, newBar, schedule } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import { placeDrawing, updatePlacement } from '../../src/domain/sheets';
import { alignPlacement } from '../../src/domain/paper';
import { dxfStyleTables } from '../../src/cad/layerStyles';
import DxfParser from 'dxf-parser';
import type { Project } from '../../src/domain/types';

const mass = (p: Project) => schedule(p).reduce((v, r) => v + r.weight, 0);
function fixture() {
  let p = completeOwnership({
    ...emptyProject(),
    name: 'AS-21 · impressão',
    bars: [
      {
        ...newBar('N1'),
        id: 'a',
        points: [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
        ],
        quantity: 8,
      },
      {
        ...newBar('N2'),
        id: 'b',
        origin: { x: 0, y: 1200 },
        layerId: 'layer:DESENHO',
        style: { color: '#ff0000' },
        quantity: 2,
      },
    ],
  });
  const view = placeDrawing(p, p.sheets[0].id, p.hierarchy.drawings[0].id);
  p = updatePlacement(view.project, view.id, {
    scale: 50,
    origin: { x: 30, y: 80 },
    frame: { width: 160, height: 100 },
  });
  return alignPlacement(p, view.id);
}
async function load(page: Page, p: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'plot.armstruct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await expect(
    page.getByRole('banner').getByText(p.name, { exact: true }),
  ).toBeVisible();
}
async function command(page: Page, value: string) {
  const input = page.getByRole('textbox', { name: 'Comando CAD' });
  await input.fill(value);
  await input.press('Enter');
}
async function closeNotice(page: Page) {
  const close = page.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await close.isVisible()) await close.click();
}
async function save(page: Page): Promise<Project> {
  await closeNotice(page);
  const event = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
}
async function exportFile(page: Page, name: string) {
  await closeNotice(page);
  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  return readFileSync((await (await event).path())!);
}
async function layerStyle(page: Page) {
  await command(page, 'LAYERS');
  const dialog = page.getByRole('dialog', { name: 'Layers do projeto' });
  await dialog
    .getByRole('button', { name: 'Editar layer ARMADURAS', exact: true })
    .click();
  await dialog.locator('.plot-fields summary').click();
  return dialog;
}
const previewLine = (page: Page, name: string, id = 'layer:ARMADURAS') =>
  page
    .getByLabel(name, { exact: true })
    .locator(`g[data-layer-id="${id}"] polyline`)
    .first();

test('plotagem por layer, presets e prévia conservam cores do CAD, penas e quantitativos no PDF/DXF', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const p = fixture();
  await load(page, p);
  const d = await layerStyle(page);
  await d
    .getByLabel('Cor de impressão · herança', { exact: true })
    .selectOption('own');
  await d.getByLabel('Cor de impressão', { exact: true }).fill('#000000');
  await d
    .getByLabel('Espessura de impressão · herança', { exact: true })
    .selectOption('own');
  await d
    .getByLabel('Linha de impressão', { exact: true })
    .selectOption({ label: 'Tracejada · 2 / 1 mm' });
  await d
    .getByRole('button', {
      name: 'Aplicar aos layers selecionados',
      exact: true,
    })
    .click();
  await d.getByRole('button', { name: 'Concluir', exact: true }).click();
  await expect(page.locator('[data-bar-id="a"] path').last()).toHaveAttribute(
    'stroke',
    '#4a88ff',
  );
  await command(page, 'PLOT');
  const dialog = page.getByRole('dialog', { name: 'Estilos de impressão' });
  await expect(previewLine(page, 'Prévia de tela')).toHaveAttribute(
    'stroke',
    '#4a88ff',
  );
  await expect(previewLine(page, 'Prévia de impressão')).toHaveAttribute(
    'stroke',
    '#000000',
  );
  await expect(previewLine(page, 'Prévia de impressão')).toHaveAttribute(
    'stroke-width',
    '0.35',
  );
  await expect(previewLine(page, 'Prévia de impressão')).toHaveAttribute(
    'stroke-dasharray',
    '2 1',
  );
  await dialog
    .getByLabel('Preset de impressão', { exact: true })
    .selectOption('grayscale');
  await expect(
    previewLine(page, 'Prévia de impressão', 'layer:DESENHO'),
  ).toHaveAttribute('stroke', '#363636');
  await expect(
    previewLine(page, 'Prévia de tela', 'layer:DESENHO'),
  ).toHaveAttribute('stroke', '#ff0000');
  await dialog
    .getByLabel('Preset de impressão', { exact: true })
    .selectOption('monochrome');
  await expect(
    previewLine(page, 'Prévia de impressão', 'layer:DESENHO'),
  ).toHaveAttribute('stroke', '#000000');
  await page.screenshot({ path: 'docs/print-styles.png' });
  await dialog.getByRole('button', { name: 'Concluir', exact: true }).click();
  const q = await save(page);
  expect(q.plotting?.preset).toBe('monochrome');
  expect(q.bars).toEqual(p.bars);
  expect(mass(q)).toBe(mass(p));
  const dxf = (await exportFile(page, 'Desenho DXF')).toString('utf8');
  const tables = dxfStyleTables(dxf);
  expect(tables.layers.ARMADURAS.trueColor).toBe(0);
  expect(tables.layers.ARMADURAS.lineweight).toBe(35);
  expect(
    tables.types[String(tables.layers.ARMADURAS.lineType)].pattern,
  ).toEqual([100, -50]);
  const pdf = (await exportFile(page, 'Prancha PDF')).toString('latin1');
  expect(pdf).toContain('%PDF-');
  expect(
    [...pdf.matchAll(/^([\d.]+) w$/gm)].some(
      (m) => Math.abs((Number(m[1]) * 25.4) / 72 - 0.35) < 1e-7,
    ),
  ).toBe(true);
  await load(page, q);
  expect(await save(page)).toEqual(q);
  expect(errors).toEqual([]);
});

test('override do objeto, restaurar herança, não imprimir e desfazer/refazer são independentes do aço', async ({
  page,
}) => {
  const p = fixture();
  await load(page, p);
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page
    .locator('.bar-row')
    .filter({ has: page.getByText('N1', { exact: true }) })
    .click();
  await page
    .getByRole('button', { name: 'Layer e estilo', exact: true })
    .click();
  await page.locator('.layer-inspector .plot-fields summary').click();
  await page
    .getByLabel('Cor de impressão · herança', { exact: true })
    .selectOption('own');
  await page.getByLabel('Cor de impressão', { exact: true }).fill('#00aa00');
  let q = await save(page);
  expect(q.bars[0].plot?.color).toBe('#00aa00');
  await page
    .getByLabel('Cor de impressão · herança', { exact: true })
    .selectOption('');
  await command(page, 'PLOTAGEM');
  await expect(previewLine(page, 'Prévia de impressão')).toHaveAttribute(
    'stroke',
    '#4a88ff',
  );
  await page
    .getByRole('dialog', { name: 'Estilos de impressão' })
    .getByRole('button', { name: 'Concluir', exact: true })
    .click();
  await page
    .getByLabel('Inclusão na impressão', { exact: true })
    .selectOption('false');
  q = await save(page);
  expect(q.bars[0].plot?.include).toBe(false);
  expect(mass(q)).toBe(mass(p));
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  expect((await save(page)).bars[0].plot?.include).toBeUndefined();
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Refazer', exact: true })
    .click();
  expect(await save(page)).toEqual(q);
  const dxf = new DxfParser().parseSync(
    (await exportFile(page, 'Desenho DXF')).toString('utf8'),
  )!;
  expect(dxf.entities.some((e) => e.layer === 'ARMADURAS')).toBe(false);
  expect(dxf.entities.some((e) => e.layer === 'QUADRO_ACO')).toBe(true);
  await load(page, q);
  expect(await save(page)).toEqual(q);
});
