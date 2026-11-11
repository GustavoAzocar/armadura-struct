import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject, newBar, schedule } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import { setLayerState } from '../../src/domain/layerProfiles';
import { transformPoint } from '../../src/domain/transforms';
import { waitForCadViewport } from './cadViewport.helpers';
import type { Project } from '../../src/domain/types';
function fixture() {
  return completeOwnership({
    ...emptyProject(),
    name: 'AS-24 · transformações',
    bars: [
      { ...newBar('N1'), id: 'a', origin: { x: 400, y: 200 }, quantity: 8 },
      {
        ...newBar('N2'),
        id: 'b',
        origin: { x: 1800, y: 900 },
        layerId: 'layer:DESENHO',
        kind: 'stirrup',
        width: 300,
        height: 500,
      },
    ],
    polylines: [
      {
        id: 'aux',
        barIds: ['a'],
        points: [
          { x: 400, y: 200 },
          { x: 900, y: 600 },
        ],
        closed: false,
        color: '#777777',
      },
    ],
  });
}
async function load(page: Page, p: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'transform.armstruct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await expect(
    page.getByRole('banner').getByText(p.name, { exact: true }),
  ).toBeVisible();
  await waitForCadViewport(page);
}
async function command(page: Page, value: string) {
  const i = page.getByRole('textbox', { name: 'Comando CAD' });
  await i.fill(value);
  await i.press('Enter');
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
async function select(page: Page, mark: string, shift = false) {
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page
    .locator('.bar-row')
    .filter({ has: page.getByText(mark, { exact: true }) })
    .click({ modifiers: shift ? ['Shift'] : [] });
}
async function rightBar(page: Page, id: string) {
  const pt = await page
    .locator(`[data-bar-id="${id}"] path`)
    .last()
    .evaluate((p) => {
      const path = p as SVGPathElement,
        v = path.getPointAtLength(path.getTotalLength() * 0.6),
        m = path.getScreenCTM()!;
      return { x: m.a * v.x + m.c * v.y + m.e, y: m.b * v.x + m.d * v.y + m.f };
    });
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
}
const panel = (page: Page) =>
  page.getByRole('region', { name: 'Transformação da seleção' });
const mass = (p: Project) => schedule(p).reduce((v, r) => v + r.weight, 0);
test('menu contextual seleciona o alvo, transforma 37° com prévia, desfaz/refaz e preserva seleção e persistência', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const p = fixture();
  await load(page, p);
  await rightBar(page, 'a');
  const menu = page.getByRole('menu', { name: 'Ações da seleção' });
  await expect(
    menu.getByRole('menuitem', { name: 'Propriedades', exact: true }),
  ).toBeVisible();
  await menu
    .getByRole('menuitem', { name: 'Rotacionar…', exact: true })
    .click();
  await panel(page)
    .getByRole('button', { name: 'Usar origem (0,0)', exact: true })
    .click();
  const angle = panel(page).getByLabel('Ângulo de rotação', { exact: true });
  await angle.fill('37');
  await angle.press('Tab');
  await expect(
    page.getByTestId('transform-preview').locator('path'),
  ).not.toHaveCount(0);
  expect((await save(page)).bars).toEqual(p.bars);
  await page.screenshot({ path: 'docs/context-transform.png' });
  await panel(page)
    .getByRole('button', { name: 'Aplicar transformação', exact: true })
    .click();
  const q = await save(page),
    expected = transformPoint(p.bars[0].origin, {
      kind: 'rotate',
      base: { x: 0, y: 0 },
      angle: 37,
    });
  expect(q.bars[0].origin.x).toBeCloseTo(expected.x, 7);
  expect(q.bars[0].origin.y).toBeCloseTo(expected.y, 7);
  expect(q.bars[0].rotation).toBe(37);
  expect(mass(q)).toBe(mass(p));
  await command(page, 'U');
  expect(await save(page)).toEqual(p);
  await command(page, 'REDO');
  expect(await save(page)).toEqual(q);
  await command(page, 'ROTACIONAR');
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  expect(await save(page)).toEqual(q);
  await load(page, q);
  expect(await save(page)).toEqual(q);
  expect(errors).toEqual([]);
});
test('rotação por pontos e espelho por eixo usam uma única base para a seleção mista e Ctrl+Z cancela a prévia', async ({
  page,
}) => {
  const p = fixture();
  await load(page, p);
  await select(page, 'N1');
  await select(page, 'N2', true);
  await command(page, 'ROTACIONAR');
  await panel(page)
    .getByLabel('Definição do ângulo', { exact: true })
    .selectOption('points');
  await command(page, '0,0');
  await command(page, '1000,0');
  await command(page, '0,1000');
  await panel(page)
    .getByRole('button', { name: 'Aplicar transformação', exact: true })
    .click();
  const q = await save(page);
  expect(q.bars[0].rotation).toBe(90);
  expect(q.bars[1].rotation).toBe(90);
  expect(mass(q)).toBe(mass(p));
  await command(page, 'ESPELHAR');
  await command(page, '0,0');
  await command(page, '1000,0');
  await panel(page)
    .getByRole('button', { name: 'Aplicar transformação', exact: true })
    .click();
  const mirrored = await save(page);
  expect(mirrored.bars[1].kind).toBe('stirrup');
  expect(mirrored.bars[1].stirrupMirrored).toBe(true);
  expect(mass(mirrored)).toBeCloseTo(mass(p), 9);
  await command(page, 'ROTACIONAR');
  await panel(page)
    .getByRole('button', { name: 'Usar origem (0,0)', exact: true })
    .click();
  await page.keyboard.press('Control+z');
  await expect(panel(page)).toHaveCount(0);
  expect(await save(page)).toEqual(mirrored);
});
test('menu respeita layers protegidos, vazio oferece só ações válidas e botão direito conclui polilinha', async ({
  page,
}) => {
  const p = setLayerState(fixture(), 'model', 'layer:ARMADURAS', {
    editable: false,
  });
  await load(page, p);
  await rightBar(page, 'a');
  const menu = page.getByRole('menu', { name: 'Ações da seleção' });
  await expect(
    menu.getByRole('menuitem', { name: 'Propriedades', exact: true }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: 'Excluir', exact: true }),
  ).toHaveCount(0);
  await expect(
    menu.getByRole('menuitem', { name: 'Rotacionar…', exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  const emptyCanvas = (await page.getByTestId('cad-canvas').boundingBox())!;
  const blank = {
    x: emptyCanvas.x + emptyCanvas.width - 30,
    y: emptyCanvas.y + 40,
  };
  await page.mouse.click(blank.x, blank.y);
  await page.mouse.click(blank.x, blank.y, { button: 'right' });
  await expect(menu.getByRole('menuitem')).toHaveCount(2);
  await expect(
    menu.getByRole('menuitem', { name: 'Enquadrar desenho', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await command(page, 'PL');
  await command(page, '0,-500');
  await command(page, '1000,-500');
  const canvas = page.getByTestId('cad-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.8, {
    button: 'right',
  });
  await expect(menu).toHaveCount(0);
  const q = await save(page);
  expect(q.polylines).toHaveLength(2);
  expect(q.bars).toEqual(p.bars);
});
