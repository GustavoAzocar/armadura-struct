import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { maskManipFixture } from '../fixtures/maskManipulation';
import { nativePrimitive } from '../../src/domain/nativeMasks';
import { setLayerState } from '../../src/domain/layerProfiles';
import { maskPoint, parseDxf } from '../../src/cad/import';
import type { Point, Project } from '../../src/domain/types';

const panel = (p: Page) =>
  p.getByRole('region', {
    name: 'Rotacionar entidades da máscara',
    exact: true,
  });
const destination = (p: Page) =>
  p.getByRole('region', {
    name: 'Destino do desenho de máscaras',
    exact: true,
  });
const svg = (p: Page) => p.getByTestId('cad-canvas');
const selection = (p: Page) => panel(p).getByRole('checkbox');
const confirm = (p: Page) =>
  panel(p).getByRole('button', { name: 'Confirmar rotação · Enter' });

async function load(p: Page, project: Project) {
  await p.getByTestId('project-input').setInputFiles({
    name: 'rotacao.armstruct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(p.locator('.busy-overlay')).toHaveCount(0);
}

async function open(p: Page, project = maskManipFixture()) {
  await p.goto('/');
  await expect(p.locator('.busy-overlay')).toHaveCount(0);
  await load(p, project);
  await p.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  await destination(p)
    .getByLabel('Escolher máscara', { exact: true })
    .selectOption('target-mask');
  await destination(p)
    .getByRole('button', { name: 'Ativar máscara para desenhar', exact: true })
    .click();
}

async function command(p: Page, value: string) {
  const input = p.getByRole('textbox', { name: 'Comando CAD' });
  await input.fill(value);
  await input.press('Enter');
}

async function start(p: Page) {
  await p
    .getByRole('button', {
      name: 'Rotacionar entidades da máscara',
      exact: true,
    })
    .click();
  await expect(panel(p)).toBeVisible();
}

async function save(p: Page): Promise<Project> {
  const close = p.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await close.isVisible()) await close.click();
  const d = p.waitForEvent('download');
  await p
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await d).path())!, 'utf8'));
}

async function exportText(p: Page, name: string) {
  await p.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  const d = p.waitForEvent('download');
  await p.getByRole('button', { name, exact: true }).click();
  return readFileSync((await (await d).path())!, 'utf8');
}

async function position(p: Page, point: Point) {
  return svg(p).evaluate((s, q) => {
    const a = new DOMPoint(q.x, q.y).matrixTransform(
      (s.querySelector('g[transform]') as SVGGElement).getScreenCTM()!,
    );
    return { x: a.x, y: a.y };
  }, point);
}

function near(actual: Point, expected: Point) {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}

test('ângulo digitado com prévia pura, seleção acumulada, commit único, histórico, JSON e recuperação', async ({
  page,
}, testInfo) => {
  const seed = maskManipFixture();
  seed.masks[0].primitives[0] = nativePrimitive(
    {
      kind: 'line',
      points: [
        { x: 10, y: 10 },
        { x: 110, y: 10 },
      ],
      closed: false,
    },
    'line',
  );
  await open(page, seed);
  const before = await save(page);
  const beforeCsv = await exportText(page, 'Quadro CSV');
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  await start(page);
  await expect(panel(page).getByLabel('Alvo da rotação')).toHaveValue(
    'entities',
  );
  await selection(page).nth(0).check();
  await selection(page).nth(1).check();
  await selection(page).nth(2).check();
  await selection(page).nth(1).uncheck();
  await expect(panel(page)).toContainText('2 entidade(s)');
  await page.screenshot({ path: testInfo.outputPath('01-selecao.png') });
  await command(page, '');
  await expect(panel(page)).toContainText('Ponto base');
  await page.screenshot({ path: testInfo.outputPath('02-base.png') });
  await command(page, '10,10');
  await command(page, '360001');
  await expect(panel(page).getByRole('alert')).toContainText('360.000°');
  const field = panel(page).getByRole('textbox', {
    name: 'Ângulo de rotação',
    exact: true,
  });
  await field.fill('90');
  await field.press('Enter');
  await expect(confirm(page)).toBeEnabled();
  await expect(panel(page)).toContainText('+90°');
  await expect(page.getByTestId('transform-preview')).toBeVisible();
  expect((await save(page)).masks).toEqual(before.masks);
  await page.screenshot({ path: testInfo.outputPath('03-previa.png') });
  await confirm(page).click();
  await expect(panel(page)).toHaveCount(0);
  await command(page, '');
  const after = await save(page);
  const line = after.masks[0].primitives[0];
  near(line.points[0], { x: 10, y: 10 });
  near(line.points[1], { x: 10, y: 110 });
  expect(after.masks[0].primitives.map((q) => q.id)).toEqual([
    'line',
    'circle',
    'rectangle',
  ]);
  expect(after.masks[0].primitives[1]).toEqual(before.masks[0].primitives[1]);
  expect(after.bars).toEqual(before.bars);
  expect(after.scheduleLock).toEqual(before.scheduleLock);
  expect(after.masks[1]).toEqual(before.masks[1]);

  // A full turn finishes without adding a history entry.
  await start(page);
  await selection(page).nth(0).check();
  await command(page, '');
  await command(page, '10,10');
  await command(page, '360');
  await command(page, '');
  await expect(panel(page)).toHaveCount(0);
  await command(page, 'U');
  expect((await save(page)).masks).toEqual(before.masks);
  await command(page, 'REDO');
  expect((await save(page)).masks).toEqual(after.masks);

  const dxf = parseDxf(await exportText(page, 'Desenho DXF'), 'rotacao.dxf');
  expect(
    dxf.primitives.some(
      (q) =>
        q.layer === 'DESENHO' &&
        q.points.length === 2 &&
        Math.abs(q.points[1].x - 10) < 1e-6 &&
        Math.abs(q.points[1].y - 110) < 1e-6,
    ),
  ).toBe(true);
  expect(await exportText(page, 'Quadro CSV')).toBe(beforeCsv);
  await expect(
    page.getByText('Apenas recuperável localmente', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect((await save(page)).masks).toEqual(after.masks);
  await load(page, before);
  await load(page, after);
  expect((await save(page)).masks).toEqual(after.masks);
});

test('pré-seleção no CAD, base externa por snap, referência por dois pontos e nova direção com ortogonal', async ({
  page,
}, testInfo) => {
  const seed = maskManipFixture();
  seed.masks[0].primitives[0] = nativePrimitive(
    {
      kind: 'line',
      points: [
        { x: 0, y: 0 },
        { x: 1000, y: 500 },
      ],
      closed: false,
    },
    'line',
  );
  await open(page, seed);
  await command(page, 'F');
  const at = await position(page, { x: 500, y: 250 });
  await page.mouse.click(at.x, at.y);
  await page
    .getByRole('dialog', { name: 'Controle de máscaras' })
    .getByRole('button', { name: 'Usar esta máscara e Rotacionar entidades' })
    .click();
  await expect(panel(page)).toContainText('1 entidade(s)');
  await command(page, '');
  const base = await position(page, { x: 1500, y: 0 });
  await page.mouse.click(base.x - 3, base.y + 2);
  await panel(page)
    .getByRole('button', { name: 'Referência', exact: true })
    .click();
  await command(page, '0,0');
  await command(page, '0,0');
  await expect(panel(page).getByRole('alert')).toContainText('distintos');
  await page.screenshot({ path: testInfo.outputPath('04-referencia.png') });
  await command(page, '@1000,500');
  await expect(panel(page)).toContainText('Nova direção');
  await page.getByRole('button', { name: 'ORTO F8', exact: true }).click();
  const direction = await position(page, { x: 1500, y: 1000 });
  await page.mouse.move(direction.x - 15, direction.y + 3);
  await expect(panel(page)).toContainText('+63,434949°');
  await page.mouse.click(direction.x - 15, direction.y + 3, { clickCount: 2 });
  await expect(confirm(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Foco no CAD', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/focus-mode/);
  await page.setViewportSize({ width: 900, height: 650 });
  await page.screenshot({ path: testInfo.outputPath('05-foco.png') });
  await command(page, '');
  await expect(panel(page)).toHaveCount(0);
  const after = await save(page);
  const [a, b] = after.masks[0].primitives[0].points;
  expect(b.x).toBeCloseTo(a.x, 7);
  expect(b.y - a.y).toBeCloseTo(Math.hypot(1000, 500), 7);
  near(a, { x: 1500 - 1500 / Math.sqrt(5), y: -3000 / Math.sqrt(5) });
});

test('máscara inteira explícita, decimal negativo, Esc em cada etapa e troca de máscara', async ({
  page,
}) => {
  const seed = maskManipFixture();
  Object.assign(seed.masks[0], {
    scale: 2,
    origin: { x: 500, y: 400 },
    rotation: 30,
  });
  await open(page, seed);
  const before = await save(page);
  const chooseWhole = async () => {
    await start(page);
    await panel(page).getByLabel('Alvo da rotação').selectOption('mask');
    await expect(selection(page)).toHaveCount(0);
    await expect(
      page.getByTestId('mask-cad-limits').locator(':scope > *'),
    ).not.toHaveCount(0);
    await command(page, '');
  };
  for (const steps of [
    [],
    ['0,0'],
    ['0,0', 'REFERENCIA'],
    ['0,0', 'REFERENCIA', '10,0'],
    ['0,0', 'REFERENCIA', '30°', '45°'],
  ]) {
    await chooseWhole();
    for (const value of steps) await command(page, value);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
  }
  await chooseWhole();
  await command(page, '0,0');
  await command(page, '-12,5°');
  await expect(confirm(page)).toBeEnabled();
  await destination(page)
    .getByLabel('Escolher máscara', { exact: true })
    .selectOption('external-mask');
  await destination(page)
    .getByRole('button', { name: 'Ativar máscara para desenhar', exact: true })
    .click();
  await expect(panel(page)).toHaveCount(0);
  expect((await save(page)).masks).toEqual(before.masks);

  await destination(page)
    .getByLabel('Escolher máscara', { exact: true })
    .selectOption('target-mask');
  await destination(page)
    .getByRole('button', { name: 'Ativar máscara para desenhar', exact: true })
    .click();
  await chooseWhole();
  await command(page, '0,0');
  await command(page, '-12,5°');
  await expect(panel(page)).toContainText('-12,5°');
  await confirm(page).click();
  const after = await save(page);
  const m = after.masks[0];
  expect(m.primitives).toEqual(before.masks[0].primitives);
  expect(m.scale).toBe(2);
  expect(m.rotation).toBe(17.5);
  const t = (-12.5 * Math.PI) / 180;
  near(maskPoint({ x: 0, y: 0 }, m), {
    x: 500 * Math.cos(t) - 400 * Math.sin(t),
    y: 500 * Math.sin(t) + 400 * Math.cos(t),
  });
  expect(after.masks[1]).toEqual(before.masks[1]);
});

test('recusa layer bloqueado para entidade e máscara inteira', async ({
  page,
}) => {
  let seed = maskManipFixture();
  const layer = seed.layers.find((l) => l.name === 'DESENHO')!.id;
  seed = setLayerState(seed, 'model', layer, { editable: false });
  await open(page, seed);
  await start(page);
  await selection(page).nth(0).click();
  await expect(panel(page).getByRole('alert')).toContainText('bloqueada');
  await panel(page).getByLabel('Alvo da rotação').selectOption('mask');
  await command(page, '');
  await expect(panel(page).getByRole('alert')).toContainText('bloqueadas');
  await page.keyboard.press('Escape');
  expect((await save(page)).masks).toEqual(seed.masks);
});
