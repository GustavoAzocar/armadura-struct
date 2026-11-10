import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { calibrationFixture } from '../fixtures/maskCalibration';
import { emptyProject, schedule } from '../../src/domain/model';
import { maskPoint, maskPrimitives, parseDxf } from '../../src/cad/import';
import { setLayerState } from '../../src/domain/layerProfiles';
import { layerId } from '../../src/domain/layers';
import { placeDrawing } from '../../src/domain/sheets';
import type { Point, Project } from '../../src/domain/types';
import { confirmMaskImport } from './maskBatch.helpers';
const panel = (page: Page) =>
  page.getByRole('region', { name: 'Ajustar escala da máscara', exact: true });
async function load(page: Page, p: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'calibracao.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
}
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
async function activate(page: Page, id: string) {
  const region = page.getByRole('region', {
    name: 'Destino do desenho de máscaras',
    exact: true,
  });
  await region.getByLabel('Escolher máscara', { exact: true }).selectOption(id);
  await region
    .getByRole('button', { name: 'Ativar máscara para desenhar', exact: true })
    .click();
}
async function start(page: Page, compact = false) {
  // In Foco/faixa recolhida the command is reached through the Referências
  // panel; the 2-point scale is the same Ajustar escala command.
  if (compact)
    await page
      .getByRole('button', {
        name: 'Referências e comandos de máscara',
        exact: true,
      })
      .click();
  await page
    .getByRole('button', { name: 'Ajustar escala', exact: true })
    .click();
  await expect(panel(page)).toBeVisible();
}
async function command(page: Page, value: string) {
  const box = page.getByRole('textbox', { name: 'Comando CAD' });
  await box.fill(value);
  await box.press('Enter');
}
async function screen(page: Page, at: Point) {
  return page.getByTestId('cad-canvas').evaluate(async (svg, at) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const point = new DOMPoint(at.x, at.y).matrixTransform(
      (svg.querySelector('g[transform]') as SVGGElement).getScreenCTM()!,
    );
    return { x: point.x, y: point.y };
  }, at);
}

test('P1/P2 por clique com snap: 500→2000mm imediato, círculo preservado e uma transação de histórico', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { p, m } = calibrationFixture();
  await load(page, p);
  await activate(page, m.id);
  const before = await save(page);
  await start(page);
  await page.screenshot({ path: 'docs/mask-calibration-p1.png' });
  // A small screen offset exercises the existing endpoint snap rather than exact screen coincidence.
  const first = await screen(page, { x: 100, y: 100 });
  await page.mouse.click(first.x + 2, first.y + 1);
  await expect(panel(page)).toContainText('Etapa 2/3');
  await page.screenshot({ path: 'docs/mask-calibration-p2.png' });
  const second = await screen(page, { x: 600, y: 100 });
  await page.mouse.click(second.x - 2, second.y + 1);
  await expect(panel(page).getByTestId('calibration-current')).toContainText(
    '500',
  );
  const value = panel(page).getByLabel('Distância real da máscara', {
    exact: true,
  });
  await expect(value).toBeFocused();
  await value.fill('2000 mm');
  await expect(panel(page).getByTestId('calibration-result')).toContainText(
    '×4',
  );
  await page.screenshot({ path: 'docs/mask-calibration-distance.png' });
  await value.press('Enter');
  await expect(panel(page)).toHaveCount(0);
  await page.keyboard.press('Enter');
  await command(page, 'F');
  await page.screenshot({ path: 'docs/mask-calibration-result.png' });
  const after = await save(page);
  expect(after.masks[0].scale).toBe(4);
  expect(after.masks[0].origin).toEqual({ x: -300, y: -300 });
  expect(after.masks[0].primitives).toEqual(before.masks[0].primitives);
  expect(maskPoint({ x: 100, y: 100 }, after.masks[0])).toEqual({
    x: 100,
    y: 100,
  });
  expect(maskPoint({ x: 600, y: 100 }, after.masks[0])).toEqual({
    x: 2100,
    y: 100,
  });
  expect(after.bars).toEqual(before.bars);
  expect(after.annotations).toEqual(before.annotations);
  expect(after.masks[1]).toEqual(before.masks[1]);
  expect(after.scheduleLock).toEqual(before.scheduleLock);
  expect(schedule(after)).toEqual(schedule(before));
  await command(page, 'U');
  expect((await save(page)).masks).toEqual(before.masks);
  await command(page, 'REDO');
  expect((await save(page)).masks).toEqual(after.masks);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect((await save(page)).masks).toEqual(after.masks);
  expect(errors).toEqual([]);
});

test('decimal pt-BR e unidades em referência girada/escalada mantêm fonte e textos; exportação usa a nova medida', async ({
  page,
}) => {
  const { p, m } = calibrationFixture('DXF');
  m.sourceUnit = 'cm';
  m.scale = 10;
  m.rotation = 37;
  m.origin = { x: 1234.5, y: -876.25 };
  const a = maskPoint({ x: 100, y: 100 }, m),
    b = maskPoint({ x: 600, y: 100 }, m);
  await load(page, p);
  await activate(page, m.id);
  const before = await save(page);
  await command(page, 'CALIBRARMASCARA');
  await command(page, `${a.x},${a.y}`);
  await command(page, `${b.x},${b.y}`);
  await panel(page)
    .getByLabel('Distância real da máscara', { exact: true })
    .fill('2,5 m');
  await panel(page)
    .getByRole('button', { name: 'Aplicar distância', exact: true })
    .dblclick();
  await expect(panel(page)).toHaveCount(0);
  const after = await save(page),
    mask = after.masks[0];
  expect(mask.scale).toBeCloseTo(5, 9);
  expect(mask.rotation).toBe(37);
  expect(mask.sourceUnit).toBe('cm');
  expect(mask.primitives).toEqual(before.masks[0].primitives);
  const pts = maskPrimitives(mask)[0].points;
  expect(Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)).toBeCloseTo(
    2500,
    8,
  );
  expect(maskPrimitives(mask).find((p) => p.text)?.textHeight).toBeCloseTo(
    125,
    8,
  );
  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Desenho DXF', exact: true }).click();
  const exported = maskPrimitives(
    parseDxf(
      readFileSync((await (await download).path())!, 'utf8'),
      'calibrado.dxf',
    ),
  );
  expect(
    exported
      .filter((p) => !p.text)
      .some(
        (p) =>
          Math.abs(
            Math.hypot(
              p.points[1].x - p.points[0].x,
              p.points[1].y - p.points[0].y,
            ) - 2500,
          ) < 1e-6,
      ),
  ).toBe(true);
  expect(after.bars).toEqual(before.bars);
});

test('Esc em cada etapa, pontos coincidentes e distâncias inválidas preservam o projeto e permitem corrigir', async ({
  page,
}) => {
  const { p, m } = calibrationFixture();
  await load(page, p);
  await activate(page, m.id);
  const before = await save(page);
  for (const n of [0, 1, 2]) {
    await start(page);
    if (n > 0) await command(page, '100,100');
    if (n > 1) await command(page, '600,100');
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    expect(await save(page)).toEqual(before);
  }
  await start(page);
  await command(page, '100,100');
  await command(page, '100,100');
  await expect(panel(page).getByRole('alert')).toContainText('outro P2');
  await command(page, '600,100');
  const input = panel(page).getByLabel('Distância real da máscara', {
    exact: true,
  });
  for (const raw of [
    '0',
    '-20',
    'NaN',
    'Infinity',
    '1.000,0 mm',
    '1000000000000000',
  ]) {
    await input.fill(raw);
    await input.press('Enter');
    await expect(panel(page).getByRole('alert')).toBeVisible();
    expect((await save(page)).masks).toEqual(before.masks);
  }
  await input.fill('2000');
  await input.press('Enter');
  await expect(panel(page)).toHaveCount(0);
  expect((await save(page)).masks[0].scale).toBe(4);
});

test('medida igual é neutra e a seleção residual de aço não é usada como alvo', async ({
  page,
}) => {
  const { p, m } = calibrationFixture();
  await load(page, p);
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page.locator('.bar-row').first().click();
  await page
    .getByRole('button', { name: 'Ajustar escala', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Controle de máscaras', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  expect((await save(page)).masks[0].scale).toBe(1);
  await activate(page, m.id);
  await start(page);
  await command(page, '100,100');
  await command(page, '600,100');
  await panel(page)
    .getByLabel('Distância real da máscara', { exact: true })
    .fill('500');
  await panel(page)
    .getByRole('button', { name: 'Aplicar distância', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('sem novo histórico');
  expect((await save(page)).bars).toEqual(p.bars);
  expect((await save(page)).masks[0].scale).toBe(1);
});

test('proteções e mudança de máscara/projeto invalidam o comando sem efeitos parciais', async ({
  page,
}) => {
  const { p, m } = calibrationFixture();
  const locked = setLayerState(p, 'model', m.layerId ?? layerId('MASCARA'), {
    editable: false,
  });
  await load(page, locked);
  // Choose/activate never unlocks a layer; the calibration command must independently refuse it.
  await activate(page, m.id);
  await page
    .getByRole('button', { name: 'Ajustar escala', exact: true })
    .click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('bloqueado');
  await load(page, p);
  await activate(page, m.id);
  await start(page);
  await command(page, '100,100');
  await activate(page, 'other-mask');
  await expect(panel(page)).toHaveCount(0);
  expect((await save(page)).masks[0].scale).toBe(1);
  await activate(page, m.id);
  await start(page);
  await command(page, '100,100');
  const other = emptyProject();
  await page.getByTestId('project-input').setInputFiles({
    name: 'outro.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(other)),
  });
  await expect(panel(page)).toHaveCount(0);
  expect((await save(page)).id).toBe(other.id);
});

test('DXF real importado calibra pela mesma ferramenta sem converter a referência em aço', async ({
  page,
}) => {
  await load(page, emptyProject());
  await page
    .getByTestId('mask-input')
    .setInputFiles('tests/fixtures/follow-sapata.dxf');
  await confirmMaskImport(page);
  const before = await save(page),
    m = before.masks[0];
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  await activate(page, m.id);
  await start(page);
  await command(page, '0,0');
  await command(page, '2000,0');
  await panel(page)
    .getByLabel('Distância real da máscara', { exact: true })
    .fill('4 m');
  await panel(page)
    .getByLabel('Distância real da máscara', { exact: true })
    .press('Enter');
  const after = await save(page);
  expect(after.masks[0].scale).toBe(2);
  expect(after.masks[0].sourceUnit).toBe(m.sourceUnit);
  expect(after.masks[0].primitives).toEqual(m.primitives);
  expect(after.bars).toEqual([]);
});

test('Foco/janela menor, coordenadas relativas e zoom/pan mantêm medidas independentes da câmera', async ({
  page,
}) => {
  const { p, m } = calibrationFixture();
  await load(page, p);
  await activate(page, m.id);
  await page.setViewportSize({ width: 900, height: 650 });
  await page.getByRole('button', { name: 'Foco no CAD', exact: true }).click();
  await start(page, true);
  await command(page, '100,100');
  await page.mouse.move(300, 400);
  await page.mouse.wheel(0, -100);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(340, 420);
  await page.mouse.up({ button: 'middle' });
  await command(page, '@500,0');
  await expect(panel(page).getByTestId('calibration-current')).toContainText(
    '500',
  );
  await panel(page)
    .getByLabel('Distância real da máscara', { exact: true })
    .fill('2000');
  await panel(page)
    .getByRole('button', { name: 'Aplicar distância', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/mask-calibration-compact.png' });
  await panel(page)
    .getByLabel('Distância real da máscara', { exact: true })
    .press('Enter');
  await expect(panel(page)).toHaveCount(0);
  expect((await save(page)).masks[0].scale).toBe(4);
});

test('iniciar pela prancha é recusado; duas vistas preservam suas escalas após calibrar no desenho', async ({
  page,
}) => {
  const { p, m } = calibrationFixture();
  let withViews = placeDrawing(
    p,
    p.sheets[0].id,
    p.hierarchy.drawings[0].id,
  ).project;
  withViews = placeDrawing(
    withViews,
    p.sheets[0].id,
    p.hierarchy.drawings[0].id,
  ).project;
  withViews.hierarchy.placements[0].scale = 50;
  withViews.hierarchy.placements[1].scale = 100;
  await load(page, withViews);
  await activate(page, m.id);
  await page.getByRole('tab', { name: 'Pranchas', exact: true }).click();
  await page
    .getByRole('button', { name: 'Abrir Folha 1', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  await page
    .getByRole('button', { name: 'Ajustar escala', exact: true })
    .click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('prancha');
  page.once('dialog', (d) => d.accept());
  await activate(page, m.id);
  await start(page);
  await command(page, '100,100');
  await command(page, '600,100');
  await panel(page)
    .getByLabel('Distância real da máscara', { exact: true })
    .fill('2000');
  await panel(page)
    .getByLabel('Distância real da máscara', { exact: true })
    .press('Enter');
  const after = await save(page);
  expect(after.hierarchy.placements.map((v) => v.scale)).toEqual([50, 100]);
  expect(after.bars).toEqual(withViews.bars);
});

test('Controle de máscaras calibra o alvo explicitamente escolhido e preserva a outra máscara ativa', async ({
  page,
}) => {
  const { p, m } = calibrationFixture();
  await load(page, p);
  await activate(page, 'other-mask');
  await page
    .getByRole('button', { name: 'Controle de máscaras', exact: true })
    .click();
  const control = page.getByRole('dialog', {
    name: 'Controle de máscaras',
    exact: true,
  });
  await control
    .getByLabel('Máscara do projeto', { exact: true })
    .selectOption(m.id);
  await control
    .getByRole('button', {
      name: 'Ajustar escala desta máscara por 2 pontos',
      exact: true,
    })
    .click();
  await expect(control).toHaveCount(0);
  await expect(panel(page)).toContainText(m.name);
  await command(page, '100,100');
  await command(page, '600,100');
  await panel(page)
    .getByLabel('Distância real da máscara', { exact: true })
    .fill('1000');
  await panel(page)
    .getByLabel('Distância real da máscara', { exact: true })
    .press('Enter');
  const after = await save(page);
  expect(after.masks[0].scale).toBe(2);
  expect(after.masks[1]).toEqual(p.masks[1]);
  await expect(
    page.getByRole('region', {
      name: 'Máscara ativa para desenhar',
      exact: true,
    }),
  ).toContainText('Outra máscara');
  expect(after.bars).toEqual(p.bars);
});
