import { confirmMaskImport } from './maskBatch.helpers';
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  emptyProject,
  schedule,
  createScheduleLock,
} from '../../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
} from '../../src/domain/hierarchy';
import {
  geometry,
  add,
  rotate,
  distance,
  world,
} from '../../src/domain/geometry';
import { nativePrimitive, newNativeMask } from '../../src/domain/nativeMasks';
import { setLayerState } from '../../src/domain/layerProfiles';
import { layerId } from '../../src/domain/layers';
import type { Point, Project, Primitive } from '../../src/domain/types';
const v = (x: number, y: number) => ({ x, y });
const U = [v(0, 1000), v(0, 0), v(2000, 0), v(2000, 1000)];
const panel = (page: Page) =>
  page.getByRole('region', { name: 'Seguir fôrma por trechos', exact: true });
function fixture(
  format: 'NATIVE' | 'DXF',
  kind: 'lines' | 'polyline' | 'rectangle' | 'square' | 'straight' = 'lines',
  transformed = false,
) {
  let p = emptyProject();
  p.name = 'Seguir fôrma';
  const closed = kind === 'rectangle' || kind === 'square';
  const ps =
    kind === 'square'
      ? [v(0, 0), v(1000, 0), v(1000, 1000), v(0, 1000)]
      : kind === 'straight'
        ? [v(0, 0), v(1000, 0)]
        : U;
  const base: Primitive[] =
    kind === 'lines'
      ? ps.slice(0, -1).map((a, i) =>
          nativePrimitive({
            kind: 'line',
            points: [a, ps[i + 1]],
            closed: false,
          }),
        )
      : [nativePrimitive({ kind: 'polyline', points: ps, closed })];
  const transform = transformed
    ? { origin: v(1000, -800), rotation: 37, scale: format === 'DXF' ? 10 : 1 }
    : { origin: v(0, 0), rotation: 0, scale: format === 'DXF' ? 10 : 1 };
  const primitives =
    format === 'NATIVE'
      ? base
      : base.map((q) => ({
          layer: q.layer,
          points: q.points.map((pt) => ({ x: pt.x / 10, y: pt.y / 10 })),
          closed: q.closed,
        }));
  p = completeOwnership({
    ...p,
    masks: [
      {
        ...newNativeMask('Sapata'),
        ...transform,
        format,
        sourceUnit: format === 'DXF' ? 'cm' : 'mm',
        primitives,
      },
    ],
  });
  if (format === 'NATIVE' && kind === 'lines')
    p = { ...p, scheduleLock: createScheduleLock(p) };
  const at = (pt: Point) =>
    add(rotate(pt, transform.rotation), transform.origin);
  return { p, at };
}
async function load(page: Page, p: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'follow.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  await page
    .getByLabel('Bitola de criação', { exact: true })
    .selectOption('10');
  await command(page, 'F');
}
async function command(page: Page, s: string) {
  const input = page.getByRole('textbox', { name: 'Comando CAD' });
  await input.fill(s);
  await input.press('Enter');
}
async function click(page: Page, at: Point) {
  const pt = await page.getByTestId('cad-canvas').evaluate(async (svg, at) => {
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
    const g = svg.querySelector('g[transform]') as SVGGElement;
    const p = new DOMPoint(at.x, at.y).matrixTransform(g.getScreenCTM()!);
    return { x: p.x, y: p.y };
  }, at);
  await page.mouse.click(pt.x, pt.y);
}
async function start(page: Page) {
  await page.getByRole('button', { name: 'Seguir fôrma', exact: true }).click();
  await expect(panel(page)).toBeVisible();
  await command(page, 'F');
}
async function save(page: Page): Promise<Project> {
  const notice = page.getByRole('button', {
    name: 'Fechar aviso',
    exact: true,
  });
  if (await notice.isVisible()) await notice.click();
  const event = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
}
async function side(page: Page, at: Point) {
  await panel(page)
    .getByRole('button', { name: 'Escolher lado no CAD', exact: true })
    .click();
  await click(page, at);
}
for (const format of ['NATIVE', 'DXF'] as const)
  for (const kind of ['lines', 'polyline', 'rectangle'] as const) {
    test(`${format} ${kind}: cliques sucessivos no fundo/laterais só selecionam; lado + Enter criam U analítico e uma posição`, async ({
      page,
    }) => {
      const { p, at } = fixture(
        format,
        kind,
        format === 'DXF' && kind === 'lines',
      );
      await load(page, p);
      await start(page);
      for (const [index, point] of [
        v(1000, 0),
        v(0, 500),
        v(2000, 500),
      ].entries()) {
        await click(page, at(point));
        await expect(
          page.getByTestId('follow-reference-selection').locator('line'),
        ).toHaveCount(index + 1);
        expect((await save(page)).bars).toEqual([]);
      }
      // Enter without a side only requests it; no implicit side or provisional steel.
      await page.keyboard.press('Enter');
      expect((await save(page)).bars).toEqual([]);
      await side(page, at(v(1000, 500)));
      await expect(page.getByTestId('follow-physical-preview')).toBeVisible();
      await expect(panel(page)).toContainText('3.834,248 mm');
      const path = await page
        .getByTestId('follow-physical-preview')
        .locator('path')
        .first()
        .getAttribute('d');
      expect(path!.match(/A /g) || []).toHaveLength(2);
      if (kind === 'lines')
        await page.screenshot({
          path: `docs/follow-${format.toLowerCase()}-u.png`,
        });
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await expect(panel(page)).toHaveCount(0);
      const q = await save(page);
      expect(q.bars).toHaveLength(1);
      expect(q.scheduleLock).toBeUndefined();
      expect(schedule(q)[0].quantity).toBe(1);
      expect(geometry(q.bars[0]).length).toBeCloseTo(3740 + 30 * Math.PI, 8);
      expect(q.masks).toEqual(p.masks);
      const actual = q.bars[0].points.map((pt) => world(pt, q.bars[0]));
      const expected = [v(35, 1000), v(35, 35), v(1965, 35), v(1965, 1000)].map(
        at,
      );
      for (const a of actual)
        expect(Math.min(...expected.map((b) => distance(a, b)))).toBeLessThan(
          1e-7,
        );
      await command(page, 'U');
      expect((await save(page)).bars).toEqual([]);
      await command(page, 'REDO');
      expect((await save(page)).bars).toEqual(q.bars);
      await page.getByTestId('project-input').setInputFiles({
        name: 'reopened.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(q)),
      });
      expect((await save(page)).bars).toEqual(q.bars);
    });
  }
for (const format of ['NATIVE', 'DXF'] as const)
  for (const outside of [false, true]) {
    test(`${format} quadrado: escolha ${outside ? 'exterior' : 'interior'} por clique mantém quatro curvas no fechamento`, async ({
      page,
    }) => {
      const { p } = fixture(format, 'square');
      await load(page, p);
      await start(page);
      await panel(page)
        .getByLabel('Polilinha inteira', { exact: true })
        .check();
      await click(page, v(500, 0));
      await expect(
        page.getByTestId('follow-reference-selection').locator('line'),
      ).toHaveCount(4);
      await side(page, outside ? v(1100, 500) : v(500, 500));
      await expect(panel(page)).toContainText(
        outside ? 'Exterior.' : 'Interior.',
      );
      const path = await page
        .getByTestId('follow-physical-preview')
        .locator('path')
        .first()
        .getAttribute('d');
      expect(path!.match(/A /g) || []).toHaveLength(4);
      await page.keyboard.press('Enter');
      const q = await save(page);
      expect(q.bars).toHaveLength(1);
      expect(q.bars[0].kind).toBe('free');
      const g = geometry(q.bars[0]);
      expect(g.length).toBeCloseTo((outside ? 4040 : 3480) + 60 * Math.PI, 8);
      expect(distance(g.segments[0].a, g.segments.at(-1)!.b)).toBeLessThan(
        1e-8,
      );
      expect(q.masks).toEqual(p.masks);
    });
  }
for (const format of ['NATIVE', 'DXF'] as const) {
  test(`${format} linha: cobrimento herda controle rápido, edição é temporária e Enter no campo não confirma aço`, async ({
    page,
  }) => {
    const { p } = fixture(format, 'straight');
    await load(page, p);
    const standard = page.getByLabel('Cobrimento padrão de criação', {
      exact: true,
    });
    await standard.fill('42');
    await standard.press('Tab');
    await start(page);
    await expect(
      panel(page).getByLabel('Cobrimento neste lançamento', { exact: true }),
    ).toHaveValue('42');
    await click(page, v(500, 0));
    await side(page, v(500, 200));
    await expect(panel(page)).toContainText('47,00 mm');
    const cover = panel(page).getByLabel('Cobrimento neste lançamento', {
      exact: true,
    });
    await cover.fill('55');
    await cover.press('Enter');
    expect((await save(page)).bars).toEqual([]);
    await expect(standard).toHaveValue('42');
    await expect(panel(page)).toContainText('60,00 mm');
    await page
      .getByLabel('Bitola de criação', { exact: true })
      .selectOption('8');
    await expect(panel(page)).toContainText('59,00 mm');
    if (format === 'DXF') {
      await panel(page)
        .getByLabel('Afastamento adicional informado', { exact: true })
        .fill('8');
      await expect(panel(page).getByRole('alert')).toContainText('premissa');
      await panel(page)
        .getByLabel('Premissa do afastamento adicional', { exact: true })
        .fill('Camada declarada pelo projetista');
      await expect(panel(page)).toContainText('67,00 mm');
    }
    await click(page, v(500, 200));
    await page.keyboard.press('Enter');
    const q = await save(page);
    expect(geometry(q.bars[0]).length).toBe(1000);
    expect(q.bars[0].origin.y).toBe(format === 'DXF' ? 67 : 59);
    if (format === 'DXF')
      expect(q.bars[0].comment).toContain('Camada declarada pelo projetista');
    await start(page);
    await expect(
      panel(page).getByLabel('Cobrimento neste lançamento', { exact: true }),
    ).toHaveValue('42');
    await page.keyboard.press('Escape');
    expect((await save(page)).bars).toEqual(q.bars);
  });
}
test('erros preservam seleção para corrigir; retirar/limpar/Esc, valor inválido e captura/layer não deixam aço parcial', async ({
  page,
}) => {
  const { p } = fixture('DXF');
  await load(page, p);
  await start(page);
  await page.keyboard.press('Enter');
  expect((await save(page)).bars).toEqual([]);
  await click(page, v(0, 500));
  await click(page, v(2000, 500));
  await expect(panel(page).getByRole('alert')).toContainText('desconectados');
  await side(page, v(1000, 500));
  await page.keyboard.press('Enter');
  expect((await save(page)).bars).toEqual([]);
  await panel(page)
    .getByRole('button', { name: 'Selecionar / retirar trechos', exact: true })
    .click();
  await click(page, v(2000, 500));
  await side(page, v(300, 500));
  await panel(page)
    .getByLabel('Cobrimento neste lançamento', { exact: true })
    .fill('-1');
  await click(page, v(300, 500));
  await page.keyboard.press('Enter');
  expect((await save(page)).bars).toEqual([]);
  await expect(panel(page).getByRole('alert')).toContainText(
    'Parâmetros inválidos',
  );
  await panel(page)
    .getByRole('button', { name: 'Limpar trechos', exact: true })
    .click();
  await expect(
    page.getByTestId('follow-reference-selection').locator('line'),
  ).toHaveCount(0);
  await click(page, v(1000, 0));
  await page.keyboard.press('Escape');
  expect((await save(page)).bars).toEqual([]);
  const blocked = setLayerState(p, 'model', layerId('MASCARA'), {
    capture: false,
  });
  await load(page, blocked);
  await start(page);
  await click(page, v(1000, 0));
  await expect(
    page.getByTestId('follow-reference-selection').locator('line'),
  ).toHaveCount(0);
});
test('troca de contexto/projeto cancela seleção; modelo antigo fica intacto e destino do aço respeita isolamento', async ({
  page,
}) => {
  const { p } = fixture('NATIVE');
  const other = createHierarchyNode(
    p,
    'detail',
    'V2',
    p.hierarchy.elements[0].id,
  );
  await load(page, other.project);
  await start(page);
  await click(page, v(1000, 0));
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page
    .getByRole('button', { name: 'Abrir detalhamento V2', exact: true })
    .click();
  await expect(panel(page)).toHaveCount(0);
  expect((await save(page)).bars).toEqual([]);
  await start(page);
  await click(page, v(1000, 0));
  await expect(
    page.getByTestId('follow-reference-selection').locator('line'),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  // Opening another project follows the existing isolation protection; do not bypass it.
  await command(page, 'CONCLUIR');
  await page.getByTestId('project-input').setInputFiles({
    name: 'blank.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(emptyProject())),
  });
  await start(page);
  await expect(
    page.getByTestId('follow-reference-selection').locator('line'),
  ).toHaveCount(0);
  expect((await save(page)).masks).toEqual([]);
});

for (const format of ['NATIVE', 'DXF'] as const) {
  test(`${format}: uma polilinha U inteira usa um clique de referência, lado e Enter`, async ({
    page,
  }) => {
    const { p } = fixture(format, 'polyline');
    await load(page, p);
    await start(page);
    await panel(page).getByLabel('Polilinha inteira', { exact: true }).check();
    await click(page, v(1000, 0));
    await expect(
      page.getByTestId('follow-reference-selection').locator('line'),
    ).toHaveCount(3);
    expect((await save(page)).bars).toEqual([]);
    await side(page, v(1000, 500));
    await page.keyboard.press('Enter');
    expect(geometry((await save(page)).bars[0]).length).toBeCloseTo(
      3740 + 30 * Math.PI,
      8,
    );
  });
}
test('janela compacta/Foco e comando FORMA preservam os controles e a edição por teclado', async ({
  page,
}) => {
  const { p } = fixture('NATIVE', 'straight');
  await load(page, p);
  await page.setViewportSize({ width: 900, height: 650 });
  await page.getByRole('button', { name: 'Foco no CAD', exact: true }).click();
  await command(page, 'FORMA');
  await expect(panel(page)).toBeVisible();
  await command(page, 'F');
  await click(page, v(500, 0));
  await side(page, v(500, 150));
  await expect(
    page.getByTestId('follow-physical-preview').locator('path').last(),
  ).toHaveAttribute('d', /^M /);
  expect(
    await page
      .getByTestId('follow-physical-preview')
      .locator('path')
      .last()
      .evaluate((el) => (el as SVGPathElement).getTotalLength()),
  ).toBeCloseTo(1000, 5);
  await page.screenshot({ path: 'docs/follow-compact.png' });
  await panel(page)
    .getByLabel('Mandril neste lançamento', { exact: true })
    .fill('60');
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  expect((await save(page)).bars).toEqual([]);
});
test('layer de destino bloqueado mantém prévia/seleção e não cria aço ou histórico parcial', async ({
  page,
}) => {
  const { p } = fixture('DXF', 'straight');
  const locked = setLayerState(p, 'model', layerId('ARMADURAS'), {
    editable: false,
  });
  await load(page, locked);
  await start(page);
  await click(page, v(500, 0));
  await side(page, v(500, 150));
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeVisible();
  await expect(
    page.getByTestId('follow-reference-selection').locator('line'),
  ).toHaveCount(1);
  expect((await save(page)).bars).toEqual([]);
  await page.keyboard.press('Escape');
  expect((await save(page)).masks).toEqual(p.masks);
});

test('DXF importado pelo worker: três LINEs reais formam uma barra U, conservam origem e medidas no DXF exportado', async ({
  page,
}) => {
  await load(page, emptyProject());
  await page
    .getByTestId('mask-input')
    .setInputFiles('tests/fixtures/follow-sapata.dxf');
  await confirmMaskImport(page);
  await expect(page.locator('.mask-heading')).toContainText(
    'follow-sapata.dxf',
  );
  const original = await save(page);
  expect(original.masks).toHaveLength(1);
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  await start(page);
  for (const at of [v(1000, 0), v(0, 500), v(2000, 500)]) await click(page, at);
  expect((await save(page)).bars).toEqual([]);
  await side(page, v(1000, 500));
  await page.keyboard.press('Enter');
  const result = await save(page);
  expect(result.masks).toEqual(original.masks);
  expect(geometry(result.bars[0]).length).toBeCloseTo(3740 + 30 * Math.PI, 8);
  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Desenho DXF', exact: true }).click();
  const file = await download;
  const raw = readFileSync((await file.path())!, 'utf8');
  // Imported base plus exactly one physical polyline, with the original face coordinates intact.
  expect(raw).toContain('ARMADURAS');
  const { parseDxf } = await import('../../src/cad/import');
  const parsed = parseDxf(raw, 'Conferência');
  const bar = parsed.primitives.filter(
    (q) => q.layer === 'ARMADURAS' && !q.text,
  );
  expect(bar).toHaveLength(1);
  expect(Math.min(...bar[0].points.map((p) => p.x))).toBeCloseTo(35, 6);
  expect(Math.max(...bar[0].points.map((p) => p.x))).toBeCloseTo(1965, 6);
  expect(Math.min(...bar[0].points.map((p) => p.y))).toBeCloseTo(35, 6);
  expect(Math.max(...bar[0].points.map((p) => p.y))).toBeCloseTo(1000, 6);
});
