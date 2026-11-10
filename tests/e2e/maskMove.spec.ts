import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { maskManipFixture } from '../fixtures/maskManipulation';
import { emptyProject, schedule } from '../../src/domain/model';
import { layerId } from '../../src/domain/layers';
import { setLayerState } from '../../src/domain/layerProfiles';
import { maskPoint } from '../../src/cad/import';
import type { Point, Project } from '../../src/domain/types';
const panel = (p: Page) =>
  p.getByRole('region', { name: 'Mover entidades da máscara', exact: true });
async function open(p: Page, seed = maskManipFixture()) {
  await p.goto('/');
  await expect(p.locator('.busy-overlay')).toHaveCount(0);
  await p.getByTestId('project-input').setInputFiles({
    name: 'move.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(seed)),
  });
  await p.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  const d = p.getByRole('region', {
    name: 'Destino do desenho de máscaras',
    exact: true,
  });
  await d
    .getByLabel('Escolher máscara', { exact: true })
    .selectOption('target-mask');
  await d
    .getByRole('button', { name: 'Ativar máscara para desenhar', exact: true })
    .click();
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
async function csv(p: Page) {
  await p.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  const d = p.waitForEvent('download');
  await p.getByRole('button', { name: 'Quadro CSV', exact: true }).click();
  const text = readFileSync((await (await d).path())!, 'utf8');
  await p.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  return text;
}
async function command(p: Page, s: string) {
  const c = p.getByRole('textbox', { name: 'Comando CAD' });
  await c.fill(s);
  await c.press('Enter');
}
async function position(p: Page, q: Point) {
  return p.getByTestId('cad-canvas').evaluate(async (svg, q) => {
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
    const s = new DOMPoint(q.x, q.y).matrixTransform(
      (svg.querySelector('g[transform]') as SVGGElement).getScreenCTM()!,
    );
    return { x: s.x, y: s.y };
  }, q);
}
async function click(p: Page, x: number, y: number) {
  const q = await position(p, { x, y });
  await p.mouse.click(q.x, q.y);
}
async function start(p: Page) {
  await p
    .getByRole('button', { name: 'Mover entidades da máscara', exact: true })
    .click();
  await expect(panel(p)).toBeVisible();
}
const world = (p: Project, i: number) =>
  p.masks[0].primitives[i].points.map((v) => maskPoint(v, p.masks[0]));
const shifted = (
  before: Project,
  after: Project,
  i: number,
  d: Point,
  digits = 7,
) =>
  world(before, i).forEach((v, j) => {
    const a = world(after, i)[j];
    expect(a.x).toBeCloseTo(v.x + d.x, digits);
    expect(a.y).toBeCloseTo(v.y + d.y, digits);
  });
test('Manipular habilita Mover na ordem Mover, Espelhar, Rotacionar, Copiar, Apagar', async ({
  page,
}) => {
  await open(page);
  const group = page.locator('.ribbon-group', {
    has: page.locator('.ribbon-group-label', { hasText: /^Manipular$/ }),
  });
  await expect(group).toHaveCount(1);
  await expect(group.getByRole('button')).toHaveText([
    'Mover',
    'Espelhar',
    'Rotacionar',
    'Copiar',
    'Apagar',
  ]);
  await expect(
    group.getByRole('button', { name: 'Mover entidades da máscara' }),
  ).toBeEnabled();
  await expect(
    group.getByRole('button', { name: 'Rotacionar entidades da máscara' }),
  ).toBeDisabled();
});
test('sem pré-seleção: acumula/retira, Δ=(250,−50) por coordenadas, uma operação, Undo/Redo e recuperação', async ({
  page,
}) => {
  await open(page);
  const before = await save(page),
    beforeCsv = await csv(page);
  await start(page);
  await click(page, 500, 0);
  await click(page, 100, 500);
  await click(page, 500, 900);
  await expect(panel(page)).toContainText('3 entidade(s)');
  await click(page, 500, 900);
  await expect(panel(page)).toContainText('2 entidade(s)');
  await expect(panel(page).getByTestId('mask-move-scope')).toContainText(
    'Somente estas entidades',
  );
  expect((await save(page)).masks).toEqual(before.masks);
  await page.screenshot({ path: 'docs/mask-move-selection.png' });
  await page.keyboard.press('Enter');
  await command(page, '100,100');
  const target = await position(page, { x: 350, y: 50 });
  await page.mouse.move(target.x, target.y);
  await expect(page.getByTestId('transform-preview')).toBeVisible();
  await expect(page.getByTestId('draft-rubber-band')).toBeVisible();
  await page.screenshot({ path: 'docs/mask-move-preview.png' });
  // The preview never reaches the saved model.
  expect((await save(page)).masks).toEqual(before.masks);
  await command(page, '350,50');
  await expect(panel(page)).toHaveCount(0);
  const after = await save(page);
  shifted(before, after, 0, { x: 250, y: -50 });
  shifted(before, after, 1, { x: 250, y: -50 });
  expect(after.masks[0].primitives.map((v) => v.id)).toEqual(
    before.masks[0].primitives.map((v) => v.id),
  );
  expect(after.masks[0].primitives[2]).toEqual(before.masks[0].primitives[2]);
  expect(after.masks[0].origin).toEqual(before.masks[0].origin);
  expect(after.masks[1]).toEqual(before.masks[1]);
  expect(after.bars).toEqual(before.bars);
  expect(after.annotations).toEqual(before.annotations);
  expect(after.scheduleLock).toEqual(before.scheduleLock);
  expect(schedule(after)).toEqual(schedule(before));
  expect(await csv(page)).toBe(beforeCsv);
  // Repeated Enter does not repeat the commit.
  await page.keyboard.press('Enter');
  await command(page, '');
  expect((await save(page)).masks).toEqual(after.masks);
  await command(page, 'U');
  expect((await save(page)).masks).toEqual(before.masks);
  await command(page, 'REDO');
  expect((await save(page)).masks).toEqual(after.masks);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect((await save(page)).masks).toEqual(after.masks);
});
test('Esc antes/depois da base, base = destino neutro, seleção vazia e troca de projeto não aplicam', async ({
  page,
}) => {
  await open(page);
  const before = await save(page);
  for (const stage of ['selection', 'base', 'target']) {
    await start(page);
    await panel(page).getByRole('checkbox').nth(0).check();
    if (stage !== 'selection') {
      await page.keyboard.press('Enter');
      if (stage === 'target') await command(page, '0,0');
    }
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    expect((await save(page)).masks).toEqual(before.masks);
  }
  await start(page);
  await page.keyboard.press('Enter');
  await expect(panel(page).getByRole('alert')).toContainText('Selecione');
  await panel(page).getByRole('checkbox').nth(0).check();
  await page.keyboard.press('Enter');
  await command(page, '10,10');
  await command(page, '@0,0');
  await expect(panel(page).getByRole('alert')).toContainText('neutra');
  expect((await save(page)).masks).toEqual(before.masks);
  await page.getByTestId('project-input').setInputFiles({
    name: 'new.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(emptyProject())),
  });
  await expect(panel(page)).toHaveCount(0);
  await command(page, '');
  expect((await save(page)).masks).toHaveLength(0);
});
test('pré-seleção pelo Controle de máscaras, destino por snap e resultado igual à prévia', async ({
  page,
}) => {
  await open(page);
  const before = await save(page);
  await click(page, 500, 0);
  await page
    .getByRole('dialog', { name: 'Controle de máscaras', exact: true })
    .getByRole('button', {
      name: 'Usar esta máscara e Mover entidades',
      exact: true,
    })
    .click();
  await expect(panel(page)).toContainText('1 entidade(s)');
  await command(page, '');
  await command(page, '0,0');
  // Endpoint of the external line is a CAD snap, never an edit target.
  const at = await position(page, { x: 1500, y: 1000 });
  await page.mouse.move(at.x + 2, at.y - 2);
  const delta = panel(page).getByTestId('mask-move-delta');
  await expect(delta).toContainText('1500; 1000');
  const previewText = await delta.textContent();
  await page.mouse.click(at.x + 2, at.y - 2);
  await expect(panel(page)).toHaveCount(0);
  const after = await save(page);
  expect(previewText).toContain('1500; 1000');
  shifted(before, after, 0, { x: 1500, y: 1000 });
  expect(after.masks[0].primitives.slice(1)).toEqual(
    before.masks[0].primitives.slice(1),
  );
  expect(after.masks[1]).toEqual(before.masks[1]);
});
test('botão de máscara inteira ignora a entidade pré-selecionada no Controle de máscaras', async ({
  page,
}) => {
  await open(page);
  const before = await save(page);
  await click(page, 500, 0);
  await page
    .getByRole('dialog', { name: 'Controle de máscaras', exact: true })
    .getByRole('button', {
      name: 'Mover máscara inteira (origem)',
      exact: true,
    })
    .click();
  await expect(panel(page).getByTestId('mask-move-scope')).toContainText(
    'máscara inteira',
  );
  await expect(panel(page)).toContainText('Ponto base');
  await command(page, '100,100');
  await command(page, '@250,-50');
  await expect(panel(page)).toHaveCount(0);
  const after = await save(page);
  expect(after.masks[0].origin).toEqual({ x: 250, y: -50 });
  expect(after.masks[0].primitives).toEqual(before.masks[0].primitives);
  expect(after.masks[1]).toEqual(before.masks[1]);
  expect(after.bars).toEqual(before.bars);
});
test('máscara inteira girada 30° e escala 2: só a origem muda, alcance explícito, Foco compacto', async ({
  page,
}) => {
  const seed = maskManipFixture();
  Object.assign(seed.masks[0], {
    format: 'DXF',
    rotation: 30,
    scale: 2,
    origin: { x: 100, y: 200 },
  });
  await open(page, seed);
  const before = await save(page);
  await command(page, 'MOVERMASCARA');
  await expect(panel(page).getByTestId('mask-move-scope')).toContainText(
    '0 entidade(s)',
  );
  await panel(page).getByLabel('Máscara inteira (origem)').check();
  await expect(panel(page).getByTestId('mask-move-scope')).toContainText(
    'máscara inteira',
  );
  await expect(page.getByTestId('mask-cad-limits')).toBeVisible();
  await page.screenshot({ path: 'docs/mask-move-whole.png' });
  await command(page, '');
  await command(page, '100,100');
  await page.getByRole('button', { name: 'Foco no CAD', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/focus-mode/);
  await page.setViewportSize({ width: 900, height: 650 });
  const target = await position(page, { x: 350, y: 50 });
  await page.mouse.move(target.x, target.y);
  await page.screenshot({ path: 'docs/mask-move-compact.png' });
  await command(page, '@250,-50');
  await expect(panel(page)).toHaveCount(0);
  const after = await save(page);
  expect(after.masks[0].origin).toEqual({ x: 350, y: 150 });
  expect(after.masks[0].primitives).toEqual(before.masks[0].primitives);
  expect(after.masks[0]).toMatchObject({ rotation: 30, scale: 2 });
  before.masks[0].primitives.forEach((_, i) =>
    shifted(before, after, i, { x: 250, y: -50 }),
  );
  expect(after.masks[1]).toEqual(before.masks[1]);
  expect(after.bars).toEqual(before.bars);
  await command(page, 'U');
  expect((await save(page)).masks).toEqual(before.masks);
});
test('proteção: entidade em layer bloqueado e máscara inteira com layer bloqueado não aplicam', async ({
  page,
}) => {
  let p = maskManipFixture();
  p.masks[0].primitives[0].layerId = layerId('DESENHO');
  p = setLayerState(p, 'model', layerId('DESENHO'), { editable: false });
  await open(page, p);
  const before = await save(page);
  await start(page);
  await panel(page).getByRole('checkbox').nth(0).click();
  await expect(panel(page).getByRole('alert')).toContainText('bloqueada');
  // The refused reach stays on entities, so the radio is clicked, not checked.
  await panel(page).getByLabel('Máscara inteira (origem)').click();
  await expect(panel(page).getByRole('alert')).toContainText('layer bloqueado');
  await expect(
    panel(page).getByLabel('Entidades selecionadas da máscara ativa'),
  ).toBeChecked();
  await page.keyboard.press('Escape');
  expect((await save(page)).masks).toEqual(before.masks);
});
