import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  emptyProject,
  newBar,
  schedule,
  createScheduleLock,
} from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import { placeDrawing } from '../../src/domain/sheets';
import {
  modelAlignmentItems,
  paperAlignmentItems,
} from '../../src/domain/alignment';
import { geometry } from '../../src/domain/geometry';
import { setLayerState } from '../../src/domain/layerProfiles';
import type { Project } from '../../src/domain/types';
function fixture() {
  return completeOwnership({
    ...emptyProject(),
    name: 'AS-23 e AS-25 · edição CAD',
    bars: [
      { ...newBar('N1'), id: 'a', origin: { x: 0, y: 0 }, quantity: 8 },
      { ...newBar('N2'), id: 'b', origin: { x: 1500, y: 700 }, quantity: 4 },
      { ...newBar('N3'), id: 'c', origin: { x: 3000, y: 1500 }, quantity: 2 },
    ],
    details: [
      {
        id: 'rep',
        barId: 'a',
        origin: { x: 0, y: -800 },
        rotation: 30,
        scale: 2,
      },
    ],
    annotations: [
      {
        id: 'call',
        kind: 'leader',
        barId: 'b',
        points: [
          { x: 1500, y: 700 },
          { x: 1600, y: 500 },
          { x: 2000, y: 500 },
        ],
        label: '',
        textHeight: 40,
        color: '#777777',
      },
    ],
    polylines: [
      {
        id: 'poly',
        points: [
          { x: 0, y: -500 },
          { x: 1000, y: -500 },
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
    name: 'cad-edit.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await expect(
    page.getByRole('banner').getByText(p.name, { exact: true }),
  ).toBeVisible();
}
async function command(page: Page, v: string) {
  const i = page.getByRole('textbox', { name: 'Comando CAD' });
  await i.fill(v);
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
async function field(page: Page, label: string, value: string) {
  const i = page.getByLabel(label, { exact: true });
  await i.fill(value);
  await i.press('Tab');
}
const alignment = (page: Page) =>
  page.getByRole('region', { name: 'Alinhamento da seleção' });
const vertices = (page: Page) =>
  page.getByRole('region', { name: 'Edição de vértices' });
const mass = (p: Project) => schedule(p).reduce((s, r) => s + r.weight, 0);
test('AS-23 · alinha três objetos com textos, prévia cancelável e uma operação de desfazer', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const p = fixture();
  await load(page, p);
  await select(page, 'N1');
  await select(page, 'N2', true);
  await select(page, 'N3', true);
  await command(page, 'ALINHAR');
  await expect(alignment(page)).toBeVisible();
  await alignment(page).getByLabel('Direção de alinhamento').selectOption('y');
  await alignment(page)
    .getByLabel('Âncora de alinhamento')
    .selectOption('center');
  await expect(
    page.getByTestId('transform-preview').locator('path'),
  ).not.toHaveCount(0);
  expect(await save(page)).toEqual(p);
  await page.screenshot({ path: 'docs/alignment-preview.png' });
  await alignment(page)
    .getByRole('button', { name: 'Cancelar alinhamento' })
    .click();
  expect(await save(page)).toEqual(p);
  await command(page, 'ALINHAR');
  await alignment(page)
    .getByLabel('Operação de alinhamento')
    .selectOption('distribute');
  await field(page, 'Afastamento entre caixas', '200');
  await alignment(page).getByLabel('Conjunto fixo').selectOption('b');
  await alignment(page)
    .getByRole('button', { name: 'Aplicar alinhamento' })
    .click();
  const q = await save(page);
  expect(mass(q)).toBe(mass(p));
  const boxes = modelAlignmentItems(q, ['a', 'b', 'c'])
    .map((v) => ({
      min: Math.min(...v.points.map((p) => p.x)),
      max: Math.max(...v.points.map((p) => p.x)),
    }))
    .sort((a, b) => a.min - b.min);
  expect(boxes[1].min - boxes[0].max).toBeCloseTo(200);
  expect(boxes[2].min - boxes[1].max).toBeCloseTo(200);
  expect(q.bars[1]).toEqual(p.bars[1]);
  expect(q.details).toEqual(p.details);
  await command(page, 'U');
  expect(await save(page)).toEqual(p);
  await command(page, 'REDO');
  expect(await save(page)).toEqual(q);
  await command(page, 'ALINHAR');
  await page.keyboard.press('Control+z');
  await expect(alignment(page)).toHaveCount(0);
  expect(await save(page)).toEqual(q);
  await load(page, q);
  expect(await save(page)).toEqual(q);
  expect(errors).toEqual([]);
});
test('AS-23 · linha por pontos e alinhamento de vistas no papel preservam escalas e modelo', async ({
  page,
}) => {
  let p = fixture();
  for (let i = 0; i < 3; i++)
    p = placeDrawing(p, p.sheets[0].id, p.hierarchy.drawings[0].id).project;
  p = {
    ...p,
    hierarchy: {
      ...p.hierarchy,
      placements: p.hierarchy.placements.map((v, i) => ({
        ...v,
        origin: { x: 30 + i * 110, y: 60 + i * 30 },
        scale: 50 * (i + 1),
        frame: { width: 85, height: 70 },
      })),
    },
  };
  await load(page, p);
  await page.getByRole('tab', { name: 'Pranchas', exact: true }).click();
  await page
    .getByRole('button', { name: 'Abrir Folha 1', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Alinhar vistas…', exact: true })
    .click();
  await alignment(page)
    .getByLabel('Direção de alinhamento')
    .selectOption('reference');
  await alignment(page)
    .getByRole('button', { name: 'Escolher referência por pontos' })
    .click();
  for (const x of [200, 300]) {
    const at = await page
      .getByTestId('sheet-canvas')
      .locator(':scope > g')
      .evaluate((g, x) => {
        const p = new DOMPoint(x, 100).matrixTransform(
          (g as SVGGElement).getScreenCTM()!,
        );
        return { x: p.x, y: p.y };
      }, x);
    await page.mouse.click(at.x, at.y);
  }
  await expect(page.getByTestId('sheet-canvas')).toHaveAttribute(
    'data-alignment-preview',
    'true',
  );
  expect(await save(page)).toEqual(p);
  await alignment(page)
    .getByRole('button', { name: 'Aplicar alinhamento' })
    .click();
  const q = await save(page),
    items = paperAlignmentItems(q, p.sheets[0].id);
  expect(Math.min(...items[1].points.map((v) => v.y))).toBeCloseTo(100);
  expect(Math.min(...items[2].points.map((v) => v.y))).toBeCloseTo(100);
  expect(q.hierarchy.placements[0]).toEqual(p.hierarchy.placements[0]);
  expect(q.bars).toEqual(p.bars);
  expect(q.hierarchy.placements.map((v) => v.scale)).toEqual(
    p.hierarchy.placements.map((v) => v.scale),
  );
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  expect(await save(page)).toEqual(p);
});
test('AS-25 · continua por coordenadas relativas/polares, atualiza inserções e RA, desfaz o lote e reabre', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const p = fixture();
  p.scheduleLock = createScheduleLock(p);
  await load(page, p);
  await select(page, 'N1');
  await command(page, 'CONTINUAR');
  await command(page, '@300<0');
  await command(page, '@0,300');
  await expect(vertices(page)).toContainText('2 alteração(ões) pendente(s)');
  await expect(
    page.getByTestId('transform-preview').locator('path'),
  ).not.toHaveCount(0);
  expect(await save(page)).toEqual(p);
  await page.screenshot({ path: 'docs/vertices-preview.png' });
  await command(page, '');
  const q = await save(page);
  expect(q.bars[0].points).toEqual([
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1300, y: 0 },
    { x: 1300, y: 300 },
  ]);
  expect(q.bars[0].id).toBe('a');
  expect(q.bars[0].quantity).toBe(8);
  expect(q.details).toEqual(p.details);
  expect(q.scheduleLock).toBeUndefined();
  expect(geometry(q.bars[0]).length).toBeCloseTo(1600 - 48 + 12 * Math.PI, 7);
  expect(mass(q)).toBeGreaterThan(mass(p));
  await command(page, 'U');
  expect(await save(page)).toEqual(p);
  await command(page, 'REDO');
  expect(await save(page)).toEqual(q);
  await load(page, q);
  expect(await save(page)).toEqual(q);
  expect(errors).toEqual([]);
});
test('AS-25 · inserir colinear, remover, cancelar e rejeitar retorno sem perder a posição', async ({
  page,
}) => {
  const p = fixture();
  await load(page, p);
  await select(page, 'N1');
  await command(page, 'INSERIRVERTICE');
  await command(page, '500,0');
  await vertices(page)
    .getByRole('button', { name: 'Concluir vértices' })
    .click();
  const split = await save(page);
  expect(geometry(split.bars[0]).length).toBe(1000);
  expect(mass(split)).toBe(mass(p));
  await command(page, 'REMOVERVERTICE');
  await command(page, '500,0');
  await command(page, '');
  expect(await save(page)).toEqual(p);
  await command(page, 'CONTINUAR');
  await command(page, '900,0');
  await expect(vertices(page).getByRole('status')).toContainText('180');
  expect(await save(page)).toEqual(p);
  await expect(
    vertices(page).getByRole('button', { name: 'Concluir vértices' }),
  ).toBeDisabled();
  await command(page, '@300<0');
  await vertices(page)
    .getByRole('button', { name: 'Desfazer vértice pendente' })
    .click();
  await expect(vertices(page)).toContainText('0 alteração(ões) pendente(s)');
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(p);
  await command(page, 'REMOVERVERTICE');
  await command(page, '0,0');
  await expect(vertices(page).getByRole('status')).toContainText(
    'dois vértices',
  );
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(p);
});
test('AS-23/25 · layer protegido impede as duas operações sem alterações parciais', async ({
  page,
}) => {
  const p = setLayerState(fixture(), 'model', 'layer:ARMADURAS', {
    editable: false,
  });
  await load(page, p);
  await select(page, 'N1');
  await select(page, 'N2', true);
  await command(page, 'ALINHAR');
  await expect(
    alignment(page).getByRole('button', { name: 'Aplicar alinhamento' }),
  ).toBeDisabled();
  expect(await save(page)).toEqual(p);
  await page.keyboard.press('Escape');
  await select(page, 'N1');
  await command(page, 'CONTINUAR');
  await command(page, '1300,0');
  await expect(vertices(page).getByRole('status')).toContainText(
    /layer|Layer|protegido|edição/i,
  );
  await expect(
    vertices(page).getByRole('button', { name: 'Concluir vértices' }),
  ).toBeDisabled();
  expect(await save(page)).toEqual(p);
});

test('AS-25 · menu e cliques em polilinha respeitam encaixe, Orto e conclusão pelo botão direito', async ({
  page,
}) => {
  const p = fixture();
  await load(page, p);
  async function screenPoint(x: number, y: number) {
    return page
      .getByTestId('cad-polyline')
      .first()
      .locator('path')
      .first()
      .evaluate(
        (path, point) => {
          const p = new DOMPoint(point.x, point.y).matrixTransform(
            (path as SVGGraphicsElement).getScreenCTM()!,
          );
          return { x: p.x, y: p.y };
        },
        { x, y },
      );
  }
  const middle = await screenPoint(500, -500);
  await page.mouse.click(middle.x, middle.y, { button: 'right' });
  await page
    .getByRole('menu', { name: 'Ações da seleção' })
    .getByRole('menuitem', { name: 'Inserir vértices', exact: true })
    .click();
  const near = await screenPoint(505, -498);
  await page.mouse.click(near.x, near.y);
  await page.mouse.click(near.x, near.y, { button: 'right' });
  const q = await save(page);
  expect(q.polylines[0].points).toEqual([
    { x: 0, y: -500 },
    { x: 500, y: -500 },
    { x: 1000, y: -500 },
  ]);
  expect(q.bars).toEqual(p.bars);
  await command(page, 'CONTINUAR');
  await page.keyboard.press('F8');
  const end = await screenPoint(1300, -470);
  await page.mouse.click(end.x, end.y);
  await vertices(page)
    .getByRole('button', { name: 'Concluir vértices' })
    .click();
  const r = await save(page);
  expect(Math.abs(r.polylines[0].points.at(-1)!.x - 1300)).toBeLessThan(5);
  expect(r.polylines[0].points.at(-1)!.y).toBe(-500);
  expect(schedule(r)).toEqual(schedule(p));
  await command(page, 'U');
  expect(await save(page)).toEqual(q);
});
