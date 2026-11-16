import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject, newBar } from '../../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
} from '../../src/domain/hierarchy';
import { newNativeMask, nativePrimitive } from '../../src/domain/nativeMasks';
import {
  setMaskReference,
  alignMaskReference,
} from '../../src/domain/maskReferences';
import type { Point, Project } from '../../src/domain/types';

const v = (x: number, y: number) => ({ x, y });
const selector = (page: Page) =>
  page.getByRole('region', { name: 'Máscaras do detalhamento', exact: true });
const origin = (page: Page) =>
  page.getByRole('region', {
    name: 'Selecionar origem da máscara',
    exact: true,
  });
async function command(page: Page, value: string) {
  const input = page.getByRole('textbox', { name: 'Comando CAD' });
  await input.fill(value);
  await input.press('Enter');
}
async function save(page: Page): Promise<Project> {
  const close = page.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await close.isVisible()) await close.click();
  const download = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
}
async function load(page: Page, p: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'mascaras.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await expect(page.getByTestId('cad-canvas')).toBeVisible();
}
async function clickModel(page: Page, point: Point, click = true) {
  const pt = await page.getByTestId('cad-canvas').evaluate(async (svg, at) => {
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
    const g = svg.querySelector('g[transform]') as SVGGElement;
    const p = new DOMPoint(at.x, at.y).matrixTransform(g.getScreenCTM()!);
    return { x: p.x, y: p.y };
  }, point);
  if (click) await page.mouse.click(pt.x, pt.y);
  else await page.mouse.move(pt.x, pt.y);
}
function fixture() {
  const base = emptyProject();
  const a = base.hierarchy.details[0].id;
  const second = createHierarchyNode(
    base,
    'detail',
    'Detalhe B',
    base.hierarchy.elements[0].id,
  );
  let p = completeOwnership({
    ...second.project,
    bars: [
      { ...newBar('N1'), origin: v(100, -500), points: [v(0, 0), v(900, 0)] },
    ],
    masks: ['A', 'B', 'Extra'].map((name, i) => ({
      ...newNativeMask(name),
      id: `mask-${name}`,
      independent: true as const,
      primitives: [
        nativePrimitive({
          kind: 'rectangle',
          points: [v(i * 200, i * 200), v(3000 + i * 200, 2000 + i * 200)],
          closed: true,
        }),
      ],
    })),
  });
  p = setMaskReference(
    setMaskReference(
      setMaskReference(p, a, 'mask-A', 'replace'),
      a,
      'mask-Extra',
      'show',
    ),
    second.id,
    'mask-A',
    'show',
  );
  return { p, a, b: second.id };
}

test('cria máscara independente, desenha, edita, desfaz/refaz e reabre sem detalhamento fictício', async ({
  page,
}) => {
  await load(page, emptyProject());
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  await command(page, 'MASCARAS');
  const d = page.getByRole('dialog', {
    name: 'Controle de máscaras',
    exact: true,
  });
  await d.getByLabel('Nome da nova máscara').fill('Fôrma independente');
  await expect(d.getByLabel('Contexto da nova máscara')).toHaveValue('');
  await d
    .getByRole('button', { name: 'Criar máscara nativa', exact: true })
    .click();
  await command(page, 'LINHA');
  await command(page, '0,0');
  await command(page, '1000,0');
  await page.keyboard.press('Escape');
  let p = await save(page);
  expect(p.masks[0].independent).toBe(true);
  expect(p.hierarchy.objectDetails[p.masks[0].id]).toBeUndefined();
  expect(p.hierarchy.details).toHaveLength(1);
  expect(p.bars).toEqual([]);
  expect(p.masks[0].primitives).toHaveLength(1);
  await command(page, 'MASCARAS');
  await d
    .getByLabel('Entidade da máscara')
    .selectOption(p.masks[0].primitives[0].id!);
  await d.getByLabel('Ponto 2 X', { exact: true }).fill('1200');
  await d
    .getByRole('button', { name: 'Aplicar geometria', exact: true })
    .click();
  await d
    .getByRole('button', { name: 'Concluir controle de máscaras' })
    .click();
  p = await save(page);
  expect(p.masks[0].primitives[0].points[1].x).toBe(1200);
  await command(page, 'U');
  expect((await save(page)).masks[0].primitives[0].points[1].x).toBe(1000);
  await command(page, 'REDO');
  expect((await save(page)).masks).toEqual(p.masks);
  await page.getByTestId('project-input').setInputFiles({
    name: 'reaberto.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  expect((await save(page)).masks).toEqual(p.masks);
  await page.screenshot({ path: 'docs/mascara-independente.png' });
});

test('troca A → B → A durante Barra livre e tela por pontos, mantém prévia/parâmetros e limpa encaixes', async ({
  page,
}) => {
  const { p, a } = fixture();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, p);
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  await page
    .getByLabel('Bitola de criação', { exact: true })
    .selectOption('10');
  await page.getByLabel('Quantidade de criação', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Barra livre', exact: true }).click();
  await command(page, '0,0');
  await clickModel(page, v(500, 500), false);
  await expect(page.getByTestId('draft-rubber-band')).toBeVisible();
  for (const id of ['mask-B', 'mask-A']) {
    await selector(page)
      .getByLabel('Trocar referência atual', { exact: true })
      .selectOption(id);
    await expect(page.locator(`[data-mask-id="${id}"]`)).toBeVisible();
    await expect(
      page.locator(`[data-mask-id="${id === 'mask-A' ? 'mask-B' : 'mask-A'}"]`),
    ).toHaveCount(0);
    await expect(page.locator('[data-mask-id="mask-Extra"]')).toBeVisible();
    await clickModel(page, v(500, 500), false);
    await expect(page.getByTestId('draft-rubber-band')).toBeVisible();
  }
  await clickModel(page, v(0, 0), false);
  await expect(page.getByTestId('snap-marker')).toBeVisible();
  await selector(page)
    .getByLabel('Trocar referência atual', { exact: true })
    .selectOption('mask-B');
  await expect(page.getByTestId('snap-marker')).toHaveCount(0);
  await clickModel(page, v(0, 0), false);
  await expect(page.getByTestId('snap-marker')).toHaveCount(0);
  await selector(page)
    .getByLabel('Trocar referência atual', { exact: true })
    .selectOption('mask-A');
  await command(page, '1000,0');
  await command(page, '');
  let q = await save(page);
  expect(q.bars).toHaveLength(2);
  expect(q.bars[1].origin).toEqual(v(0, 0));
  expect(q.bars[1].points).toEqual([v(0, 0), v(1000, 0)]);
  expect(q.bars[1].diameter).toBe(10);
  expect(q.bars[1].quantity).toBe(3);
  expect(q.masks).toEqual(p.masks);
  expect(q.maskReferences![a].currentMaskId).toBe('mask-A');
  await page.keyboard.press('Escape');
  await command(page, 'TS');
  await page
    .getByRole('dialog', { name: 'Critérios de telas soldadas', exact: true })
    .getByRole('button', { name: 'Usar critérios e lançar', exact: true })
    .click();
  const panel = page.getByRole('region', {
    name: 'Lançamento de tela soldada',
    exact: true,
  });
  await panel.getByRole('button', { name: 'Pontos', exact: true }).click();
  await command(page, '0,0');
  await command(page, '3000,0');
  for (const id of ['mask-B', 'mask-A']) {
    await selector(page)
      .getByLabel('Trocar referência atual', { exact: true })
      .selectOption(id);
    await expect(panel.getByRole('status')).toContainText('2 ponto(s)');
    await expect(page.locator('[data-mask-id="mask-Extra"]')).toBeVisible();
  }
  await command(page, '3000,2000');
  await command(page, '0,2000');
  await command(page, '');
  await command(page, '');
  await command(page, '');
  await expect(panel).toHaveCount(0);
  q = await save(page);
  expect(q.weldedMeshes).toHaveLength(1);
  expect(q.weldedMeshes![0].region.outer).toEqual([
    v(0, 0),
    v(3000, 0),
    v(3000, 2000),
    v(0, 2000),
  ]);
  await selector(page).locator('summary').click();
  await selector(page)
    .getByRole('checkbox', { name: 'Exibir A', exact: true })
    .uncheck();
  await expect(page.locator('[data-mask-id="mask-A"]')).toHaveCount(0);
  const hidden = await save(page);
  expect(
    hidden.maskReferences![a].items.find((i) => i.maskId === 'mask-A')?.visible,
  ).toBe(false);
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page
    .getByLabel('Detalhamento ativo', { exact: true })
    .selectOption(p.hierarchy.details[1].id);
  await expect(page.locator('[data-mask-id="mask-A"]')).toBeVisible();
  expect((await save(page)).bars).toEqual(hidden.bars);
  await page.getByLabel('Detalhamento ativo', { exact: true }).selectOption(a);
  await expect(page.locator('[data-mask-id="mask-A"]')).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'docs/mascaras-do-detalhamento.png' });
});

test('alinha com escala e rotação, prévia cancelável, histórico, encaixe no zero e referência B intacta', async ({
  page,
}) => {
  const { p, a, b } = fixture();
  p.masks[0] = {
    ...p.masks[0],
    format: 'DXF',
    sourceUnit: 'cm',
    scale: 10,
    rotation: 37,
    origin: v(800, -300),
    primitives: [{ layer: 'DESENHO', points: [v(23, -41), v(123, -41)] }],
  };
  // Posicionamento inicial pertence a cada referência, não à máscara.
  p.maskReferences![a].items[0].origin = v(800, -300);
  p.maskReferences![b].items[0].origin = v(1200, -800);
  await load(page, p);
  const loaded = await save(page);
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  await command(page, 'MASCARAS');
  const d = page.getByRole('dialog', {
    name: 'Controle de máscaras',
    exact: true,
  });
  await d
    .getByLabel('Máscara do projeto', { exact: true })
    .selectOption('mask-A');
  await d
    .getByRole('button', { name: 'Selecionar origem', exact: true })
    .click();
  const r = (37 * Math.PI) / 180;
  const at = v(
    800 + 10 * (23 * Math.cos(r) + 41 * Math.sin(r)),
    -300 + 10 * (23 * Math.sin(r) - 41 * Math.cos(r)),
  );
  await page
    .getByRole('button', { name: 'Ajustar à tela', exact: true })
    .click();
  await clickModel(page, at);
  await origin(page)
    .getByRole('button', { name: 'Pré-visualizar alinhamento' })
    .click();
  await expect(page.getByTestId('mask-origin-markers')).toBeVisible();
  await origin(page)
    .getByRole('button', { name: 'Cancelar alinhamento' })
    .click();
  expect((await save(page)).maskReferences).toEqual(p.maskReferences);
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  await selector(page).locator('summary').click();
  await selector(page)
    .getByRole('button', { name: 'Selecionar origem de A', exact: true })
    .click();
  await clickModel(page, at);
  await origin(page)
    .getByRole('button', { name: 'Pré-visualizar alinhamento' })
    .click();
  // Reescolher o ponto já alinhado usa a pose da prévia, sem dupla transformação.
  await clickModel(page, v(0, 0));
  await origin(page)
    .getByRole('button', { name: 'Pré-visualizar alinhamento' })
    .click();
  await page.screenshot({ path: 'docs/mascara-origem-previa.png' });
  await origin(page)
    .getByRole('button', { name: 'Aplicar alinhamento' })
    .click();
  const q = await save(page);
  const expected = alignMaskReference(p, a, 'mask-A', v(23, -41));
  expect(q.maskReferences![a].items[0].origin.x).toBeCloseTo(
    expected.maskReferences![a].items[0].origin.x,
    5,
  );
  expect(q.maskReferences![b]).toEqual(p.maskReferences![b]);
  expect(q.bars).toEqual(p.bars);
  expect(q.masks).toEqual(loaded.masks);
  await command(page, 'U');
  expect((await save(page)).maskReferences).toEqual(p.maskReferences);
  await command(page, 'REDO');
  expect((await save(page)).maskReferences).toEqual(q.maskReferences);
  await page.getByRole('button', { name: 'Barra livre', exact: true }).click();
  await clickModel(page, v(0, 0), false);
  await expect(page.getByTestId('snap-marker')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('project-input').setInputFiles({
    name: 'origem.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(q)),
  });
  expect((await save(page)).maskReferences).toEqual(q.maskReferences);
});

test('importa DXF e DWG sem vínculo e oferece os comandos CAD do mesmo editor', async ({
  page,
}) => {
  test.setTimeout(120000);
  await load(page, emptyProject());
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  await page
    .getByTestId('mask-input')
    .setInputFiles([
      'tests/fixtures/entities-2d.dxf',
      'tests/fixtures/entities-2d.dwg',
    ]);
  const d = page.getByRole('dialog', {
    name: 'Importar máscaras em lote',
    exact: true,
  });
  await d.getByLabel('Destino do lote').selectOption('project:masks');
  await d
    .getByRole('button', { name: 'Aplicar destino a todos', exact: true })
    .click();
  await d.getByRole('button', { name: 'Ler arquivos', exact: true }).click();
  await expect(d.getByRole('status')).toContainText('2 prontos', {
    timeout: 70000,
  });
  for (const checkbox of await d
    .getByRole('checkbox', { name: /Confirmar unidade do arquivo/ })
    .all())
    await checkbox.check();
  await d.getByRole('button', { name: 'Aplicar lote', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Resultado das máscaras', exact: true })
    .getByRole('button', { name: /Abrir resultado:/ })
    .click();
  let p = await save(page);
  expect(p.masks).toHaveLength(2);
  expect(
    p.masks.every((m) => m.independent && !p.hierarchy.objectDetails[m.id]),
  ).toBe(true);
  const before = p.masks[0].primitives;
  await command(page, 'LINHA');
  await command(page, '0,0');
  await command(page, '1000,0');
  await page.keyboard.press('Escape');
  p = await save(page);
  expect(p.masks[0].primitives.slice(0, -1)).toEqual(before);
  expect(p.masks[0].primitives.at(-1)?.native?.kind).toBe('line');
  expect(p.bars).toEqual([]);
});
