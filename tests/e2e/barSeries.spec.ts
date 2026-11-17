import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import DxfParser, { type ITextEntity } from 'dxf-parser';
import { emptyProject, newBar, schedule } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import { placeDrawing, updatePlacement } from '../../src/domain/sheets';
import { alignPlacement } from '../../src/domain/paper';
import { createBarSeries, seriesTableData } from '../../src/domain/barSeries';
import type { Project } from '../../src/domain/types';
import {
  createDrawingMask,
  appendMaskShape,
} from '../../src/domain/maskDrawing';
import { setMaskReference } from '../../src/domain/maskReferences';

/** 24 barras retas reais (1.000 a 2.150 mm) numa série exata, desenho na folha. */
function fixture() {
  let p = completeOwnership({
    ...emptyProject(),
    name: 'Tabela de comprimentos',
    bars: Array.from({ length: 24 }, (_, i) => ({
      ...newBar(`N${i + 1}`),
      id: `v${i}`,
      diameter: 10,
      points: [
        { x: 0, y: 0 },
        { x: 1000 + i * 50, y: 0 },
      ],
      origin: { x: 0, y: i * 60 },
    })),
  });
  const series = createBarSeries(p, {
    barIds: p.bars.map((b) => b.id),
    name: 'N30',
  });
  p = series.project;
  const ctx = { key: 'model', detailId: p.hierarchy.details[0].id };
  const mask = createDrawingMask(p, 'Fôrma independente', '', ctx);
  p = appendMaskShape(
    mask.project,
    mask.mask.id,
    'line',
    [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
    ],
    { ...ctx, editingMaskId: mask.mask.id },
    mask.mask,
  );
  p = setMaskReference(p, ctx.detailId, mask.mask.id, 'replace');
  const placed = placeDrawing(p, p.sheets[0].id, p.hierarchy.drawings[0].id);
  p = updatePlacement(placed.project, placed.id, {
    origin: { x: 150, y: 15 },
    scale: 50,
    frame: { width: 90, height: 60 },
  });
  return { project: alignPlacement(p, placed.id), seriesId: series.id };
}
async function load(page: Page, p: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'series.json',
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
async function openSeries(page: Page) {
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  await page
    .locator('.ribbon-content')
    .getByRole('button', { name: 'Séries variáveis', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Séries variáveis' });
  await expect(dialog).toBeVisible();
  return dialog;
}
const mass = (p: Project) => schedule(p).reduce((s, r) => s + r.weight, 0);

test('consulta 24 variantes, divide em blocos, insere na prancha sem alterar aço e persiste', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { project, seriesId } = fixture();
  const expected = seriesTableData(project, seriesId);
  await load(page, project);

  // Consulta: abrir, navegar e fechar não altera o projeto.
  let dialog = await openSeries(page);
  const table = dialog.getByRole('table', {
    name: 'Tabela de comprimentos da série',
  });
  await expect(table.locator('tbody tr')).toHaveCount(24);
  await expect(table.locator('tbody tr').first()).toContainText('N30.1');
  await expect(table.locator('tbody tr').last()).toContainText('215,0');
  await expect(table.locator('tfoot')).toContainText(
    String(expected.totals.pieces),
  );
  await dialog.getByLabel('Linhas por bloco').fill('8');
  await table.locator('tbody tr').nth(8).click();
  await expect(dialog.getByLabel('Prévia da variante')).toContainText('N30.9');
  await expect(table.locator('tr.series-block-start')).toHaveCount(2);
  await dialog.screenshot({ path: 'docs/series-length-query.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect((await save(page)).sheets[0].seriesTables).toBeUndefined();

  // Prévia no cursor; Esc cancela sem gravar.
  dialog = await openSeries(page);
  await dialog.getByLabel('Linhas por bloco').fill('8');
  await dialog
    .getByRole('button', { name: 'Inserir tabela na prancha', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Inserir tabela de comprimentos' }),
  ).toBeVisible();
  let at = await point(page, 20, 170);
  await page.mouse.move(at.x, at.y);
  await expect(page.getByTestId('sheet-series-preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sheet-series-preview')).toHaveCount(0);
  expect((await save(page)).sheets[0].seriesTables).toBeUndefined();

  // Fora da área útil: recusado, nada gravado.
  dialog = await openSeries(page);
  await dialog.getByLabel('Linhas por bloco').fill('8');
  await dialog
    .getByRole('button', { name: 'Inserir tabela na prancha', exact: true })
    .click();
  at = await point(page, 380, 285);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('sheet-series-table')).toHaveCount(0);

  // Clique válido: três blocos de oito, uma única tabela mesmo com clique repetido.
  at = await point(page, 15, 170);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('sheet-series-table')).toHaveCount(3);
  await expect(page.locator('.paper-issues')).toHaveCount(0);
  const notice = page.getByRole('button', {
    name: 'Fechar aviso',
    exact: true,
  });
  if (await notice.isVisible()) await notice.click();
  await page.getByTestId('sheet-canvas').screenshot({
    path: 'docs/series-length-table.png',
  });
  let saved = await save(page);
  expect(saved.schema).toBe('armadurastruct/43');
  expect(saved.maskReferences).toEqual(project.maskReferences);
  expect(saved.masks).toEqual(project.masks);
  expect(saved.sheets[0].seriesTables).toHaveLength(1);
  expect(saved.sheets[0].seriesTables![0]).toMatchObject({
    seriesId,
    rowsPerBlock: 8,
  });
  expect(saved.bars).toEqual(project.bars);
  expect(mass(saved)).toBeCloseTo(mass(project), 10);

  // Reabertura da composição /43 e arquivos reais: 24 variantes completas.
  await load(page, saved);
  await page.getByRole('tab', { name: 'Pranchas', exact: true }).click();
  await page
    .getByRole('button', { name: 'Abrir Folha 1', exact: true })
    .click();
  await expect(page.getByTestId('sheet-series-table')).toHaveCount(3);
  for (const [button, encoding, filename] of [
    [
      'Exportar todas as folhas em PDF',
      'latin1',
      'docs/series-length-output.pdf',
    ],
    ['Exportar folha ativa em DXF', 'utf8', 'docs/series-length-output.dxf'],
  ] as const) {
    if (button.endsWith('DXF')) page.once('dialog', (d) => d.accept());
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: true }).click();
    const bytes = readFileSync((await (await event).path())!);
    writeFileSync(filename, bytes);
    const content = bytes.toString(encoding);
    for (let i = 1; i <= 24; i++) expect(content).toContain(`N30.${i}`);
    // Soma independente: 24×1000 + 50×(0+...+23) = 37800 mm.
    expect(content).toContain('37,80');
    expect(content).toContain('Total da s');
    if (encoding === 'utf8') {
      const texts = new DxfParser()
        .parseSync(content)!
        .entities.filter(
          (e) => e.type === 'TEXT' && e.layer === 'PRANCHA_001_TABELA_SERIE',
        )
        .map((e) => (e as ITextEntity).text);
      expect(texts.filter((t) => /^N30\.\d+$/.test(t))).toHaveLength(24);
      expect(texts.filter((t) => t.startsWith('Total da série'))).toHaveLength(
        1,
      );
    }
  }
  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  await page
    .locator('.ribbon-content')
    .getByRole('button', { name: 'CSV por escopo', exact: true })
    .click();
  const csv = page.getByRole('dialog', {
    name: 'Exportar relação do aço (CSV)',
  });
  await csv.getByLabel('Quadro detalhado', { exact: true }).uncheck();
  await csv.getByLabel('Resumo do aço', { exact: true }).uncheck();
  await csv
    .getByLabel('Lista por variante (séries variáveis)', { exact: true })
    .check();
  const event = page.waitForEvent('download');
  await csv.getByRole('button', { name: 'Exportar CSV', exact: true }).click();
  const content = readFileSync((await (await event).path())!, 'utf8');
  writeFileSync('docs/series-length-output.csv', content);
  expect(content.trim().split('\r\n')).toHaveLength(25);
  for (const variant of project.barSeries![0].variants)
    expect(content).toContain(variant.id);
  await expect(csv).toHaveCount(0);

  // O teste do histórico usa a sessão que contém a inserção original.
  await load(page, project);
  dialog = await openSeries(page);
  await dialog.getByLabel('Linhas por bloco').fill('8');
  await dialog
    .getByRole('button', { name: 'Inserir tabela na prancha', exact: true })
    .click();
  at = await point(page, 15, 170);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('sheet-series-table')).toHaveCount(3);

  // Arrastar o segundo bloco grava só a origem da continuação.
  const block = page.getByTestId('sheet-series-table').nth(1);
  const box = (await block.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 80, { steps: 4 });
  await page.mouse.up();
  saved = await save(page);
  expect(saved.sheets[0].seriesTables![0].blockOrigins).toHaveLength(2);
  expect(saved.bars).toEqual(project.bars);

  // Desfazer/Refazer e Delete retiram só a apresentação.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('sheet-series-table')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(page.getByTestId('sheet-series-table')).toHaveCount(3);
  await page.getByTestId('sheet-series-table').first().click();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('sheet-series-table')).toHaveCount(0);
  saved = await save(page);
  expect(saved.sheets[0].seriesTables).toEqual([]);
  expect(saved.barSeries).toHaveLength(1);
  expect(saved.bars).toEqual(project.bars);
  expect(errors).toEqual([]);
});

test('cria série estimada pela seleção, mantém o aviso e localiza a peça', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const p = completeOwnership({
    ...emptyProject(),
    name: 'Série estimada',
    bars: [
      {
        ...newBar('N7'),
        id: 'medio',
        quantity: 24,
        points: [
          { x: 0, y: 0 },
          { x: 1250, y: 0 },
        ],
      },
    ],
  });
  await load(page, p);
  // Seleciona a armadura pela relação do aço.
  await page
    .getByRole('button', { name: /Quadro de aço/ })
    .first()
    .click();
  await page.locator('tbody tr').filter({ hasText: 'N7' }).first().click();
  const dialog = await openSeries(page);
  await expect(dialog.getByText(/Criar série com a seleção \(1/)).toBeVisible();
  await dialog.getByLabel('Estado da nova série').selectOption('estimated');
  await dialog.getByLabel('Total de variantes declarado').fill('24');
  await dialog
    .getByRole('button', { name: 'Criar série', exact: true })
    .click();
  await expect(dialog.getByRole('status')).toContainText('ESTIMATIVA');
  const table = dialog.getByRole('table', {
    name: 'Tabela de comprimentos da série',
  });
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.locator('tbody tr')).toContainText(
    'variável/representativo',
  );
  await expect(table.locator('tbody tr')).toContainText('méd. 125,0');
  await dialog.getByRole('button', { name: /^Localizar/ }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await save(page);
  expect(saved.barSeries?.[0]).toMatchObject({
    status: 'estimated',
    representativeBarId: 'medio',
    expectedVariants: 24,
  });
  expect(saved.bars).toEqual(p.bars);
  expect(errors).toEqual([]);
});
