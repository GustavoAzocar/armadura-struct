import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { maskManipFixture } from '../fixtures/maskManipulation';
import { nativePrimitive } from '../../src/domain/nativeMasks';
import { defaultWeldedMeshCriteria } from '../../src/domain/weldedMesh';
import {
  buildRegion,
  outlineFromPoints,
} from '../../src/domain/weldedMeshRegion';
import {
  launchWeldedMesh,
  type WeldedMeshLaunch,
} from '../../src/domain/weldedMeshLaunch';
import { weldedMeshPrimitives } from '../../src/domain/weldedMeshDrawing';
import type { Project, Point } from '../../src/domain/types';

const P = (x: number, y: number): Point => ({ x, y });
const meshes = (p: Page) => p.getByTestId('cad-welded-mesh');
const panel = (p: Page) =>
  p.getByRole('region', { name: 'Lançamento de tela soldada', exact: true });
const summary = (p: Page) =>
  p.getByLabel('Quantitativos da tela', { exact: true });

/** Laje 6.000 × 4.750 com a tela TS1 (Q92, 150 mm na largura) já lançada. */
function fixture(): Project {
  const p = maskManipFixture();
  p.masks[0].primitives = [
    nativePrimitive(
      { kind: 'rectangle', points: [P(0, 0), P(6000, 4750)], closed: true },
      'laje',
    ),
    nativePrimitive(
      { kind: 'rectangle', points: [P(8000, 0), P(11000, 2450)], closed: true },
      'menor',
    ),
  ];
  p.masks[1].primitives = [];
  const o = outlineFromPoints([P(0, 0), P(6000, 0), P(6000, 4750), P(0, 4750)]);
  if (!o.ok) throw new Error(o.reason);
  const r = buildRegion(o.outline);
  if (!r.ok) throw new Error(r.reason);
  return launchWeldedMesh(
    p,
    {
      criteria: { ...defaultWeldedMeshCriteria(), widthOverlap: 150 },
      region: r.region,
      source: { mode: 'points' },
      exactness: 'exact',
      adjustments: [],
    },
    p.hierarchy.details[0].id,
    'tela-1',
  );
}
async function open(p: Page) {
  await p.goto('/');
  await expect(p.locator('.busy-overlay')).toHaveCount(0);
  await p.getByTestId('project-input').setInputFiles({
    name: 'telas.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture())),
  });
  await expect(p.locator('.busy-overlay')).toHaveCount(0);
  await expect(meshes(p)).toHaveCount(1);
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
async function command(p: Page, s: string) {
  const c = p.getByRole('textbox', { name: 'Comando CAD' });
  await c.fill(s);
  await c.press('Enter');
}
async function screen(p: Page, q: Point) {
  return p.getByTestId('cad-canvas').evaluate(async (s, q) => {
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
    const a = new DOMPoint(q.x, q.y).matrixTransform(
      (s.querySelector('g[transform]') as SVGGElement).getScreenCTM()!,
    );
    return { x: a.x, y: a.y };
  }, q);
}
async function clickModel(p: Page, q: Point) {
  const at = await screen(p, q);
  await p.mouse.click(at.x, at.y);
}
/** Clica na identificação da tela (centro da maior peça), longe da máscara. */
async function pick(p: Page, l: WeldedMeshLaunch) {
  const label = weldedMeshPrimitives(l).find((i) => i.text)!;
  await clickModel(p, label.points[0]);
}
const mesh = (q: Project, id = 'tela-1') =>
  q.weldedMeshes!.find((l) => l.id === id)!;

test('selecionar, editar critérios só desta tela com antes × depois e redefinir a região', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  const p = fixture();
  await pick(page, mesh(p));
  await page.getByRole('tab', { name: 'Propriedades', exact: true }).click();
  await expect(page.locator('.inspector')).toContainText('TELA SOLDADA');
  await expect(summary(page)).toContainText('2 (');
  await expect(summary(page)).toContainText('29,40 m²');
  await expect(summary(page)).toContainText('43,51 kg');

  // Critérios: a prévia compara antes × depois, nesta tela.
  await page
    .getByRole('button', { name: 'Editar critérios…', exact: true })
    .click();
  const d = page.getByRole('dialog', {
    name: 'Editar critérios de TS1',
    exact: true,
  });
  await expect(d).toBeVisible();
  await d.getByLabel('Modelo de tela', { exact: true }).selectOption('Q138');
  const impact = d.getByRole('table', { name: 'Impacto da edição' });
  await expect(impact.getByRole('row', { name: /Massa aplicada/ })).toHaveText(
    /43,51 kg\s*64,68 kg/,
  );
  await expect(impact.getByRole('row', { name: /Fornecimento/ })).toHaveText(
    /43,6 kg\s*64,6 kg/,
  );
  await expect(d).toContainText(
    'Muda só esta tela. Os critérios dos próximos lançamentos não mudam.',
  );
  await d.screenshot({ path: 'docs/welded-mesh-edit.png' });
  await d
    .getByRole('button', { name: 'Aplicar nesta tela', exact: true })
    .click();
  await expect(d).toBeHidden();
  await expect(summary(page)).toContainText('64,68 kg');
  let q = await save(page);
  expect(mesh(q).criteria.mesh.designation).toBe('Q138');
  // Os critérios dos próximos lançamentos não mudam.
  expect(q.weldedMeshDefaults?.mesh.designation).toBe('Q92');
  await page.keyboard.press('Control+z');
  expect(mesh(await save(page)).criteria.mesh.designation).toBe('Q92');
  await page.keyboard.press('Control+y');

  // Região: mesma tela, nova região pelo contorno de outra entidade.
  await pick(page, mesh(q));
  await page.getByRole('tab', { name: 'Propriedades', exact: true }).click();
  await page
    .getByRole('button', { name: 'Redefinir região…', exact: true })
    .click();
  await expect(panel(page)).toContainText('Redefinir região · TS1');
  await expect(
    panel(page).getByRole('button', { name: 'Critérios…', exact: true }),
  ).toHaveCount(0);
  await clickModel(page, P(9500, 0));
  // Antes × depois lado a lado: o atual e a prévia da nova região.
  await expect(
    panel(page).getByLabel('Antes da edição', { exact: true }),
  ).toContainText('Antes: 2 painel(éis)-base · 29,40 m²');
  await expect(
    panel(page).getByLabel('Quantitativos da prévia', { exact: true }),
  ).toContainText('Área útil7,35 m²');
  await panel(page)
    .getByRole('button', { name: 'Concluir aberturas', exact: true })
    .click();
  await panel(page)
    .getByRole('button', { name: 'Aplicar nova região', exact: true })
    .click();
  await expect(panel(page)).toBeHidden();
  await expect(meshes(page)).toHaveCount(1);
  q = await save(page);
  expect(q.weldedMeshes).toHaveLength(1);
  expect(mesh(q).region.outer).toContainEqual(P(8000, 0));
  expect(mesh(q).criteria.mesh.designation).toBe('Q138');
  expect(mesh(q).source.mode).toBe('contour');
  // Uma operação só: desfazer devolve a região anterior.
  await page.keyboard.press('Control+z');
  expect(mesh(await save(page)).region.outer).toContainEqual(P(0, 4750));
  expect(errors).toEqual([]);
});

test('mover, copiar, selecionar por janela, apagar e desfazer', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  const p = fixture();
  await pick(page, mesh(p));
  for (const v of ['M', '0,0', '1000,0']) await command(page, v);
  let q = await save(page);
  expect(mesh(q).region.outer).toContainEqual(P(1000, 0));
  expect(mesh(q).region.outer).toContainEqual(P(7000, 4750));

  // Copiar: tela nova, com ID próprio, no mesmo detalhamento.
  await pick(page, mesh(q));
  for (const v of ['C', '0,0', '7000,0']) await command(page, v);
  await expect(meshes(page)).toHaveCount(2);
  q = await save(page);
  const copy = q.weldedMeshes!.find((l) => l.id !== 'tela-1')!;
  expect(copy.region.outer).toContainEqual(P(8000, 0));
  expect(q.hierarchy.objectDetails[copy.id]).toBe(
    q.hierarchy.objectDetails['tela-1'],
  );

  // Janela que contém só a tela original; Delete apaga, desfazer devolve.
  await page.keyboard.press('Escape');
  const a = await screen(page, P(500, 5500)),
    b = await screen(page, P(7500, -500));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Delete');
  await expect(meshes(page)).toHaveCount(1);
  q = await save(page);
  expect(q.weldedMeshes!.map((l) => l.id)).toEqual([copy.id]);
  await page.keyboard.press('Control+z');
  await expect(meshes(page)).toHaveCount(2);
  await page.keyboard.press('Control+y');
  await expect(meshes(page)).toHaveCount(1);
  expect(errors).toEqual([]);
});
