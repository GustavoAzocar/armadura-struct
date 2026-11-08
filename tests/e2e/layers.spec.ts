import { confirmMaskImport } from './maskBatch.helpers';
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject, newBar, schedule } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import { createLayer, assignLayer } from '../../src/domain/layers';
import type { Project } from '../../src/domain/types';
const mass = (p: Project) => schedule(p).reduce((s, r) => s + r.weight, 0);
function fixture() {
  return completeOwnership({
    ...emptyProject(),
    name: 'AS-19 · layers',
    bars: [
      {
        ...newBar('N1'),
        id: 'a',
        quantity: 4,
        quantitySource: { kind: 'distribution', mode: 'quantity' },
        distribution: { end: { x: 0, y: 600 } },
      },
      { ...newBar('N2'), id: 'b', origin: { x: 2000, y: 0 }, quantity: 3 },
    ],
  });
}
async function command(page: Page, v: string) {
  const i = page.getByRole('textbox', { name: 'Comando CAD' });
  await i.fill(v);
  await i.press('Enter');
}
async function save(page: Page): Promise<Project> {
  const c = page.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await c.isVisible()) await c.click();
  const e = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await e).path())!, 'utf8'));
}
async function load(page: Page, p: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'layers.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await expect(
    page.getByRole('banner').getByText(p.name, { exact: true }),
  ).toBeVisible();
}
async function select(page: Page, mark: string, shift = false) {
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page
    .locator('.bar-row')
    .filter({ has: page.getByText(mark, { exact: true }) })
    .click({ modifiers: shift ? ['Shift'] : [] });
}
const dialog = (p: Page) =>
  p.getByRole('dialog', { name: 'Layers do projeto' });
async function close(page: Page) {
  await dialog(page)
    .getByRole('button', { name: 'Concluir', exact: true })
    .click();
}
test('bulk assignment, ByLayer and override styles update the CAD, rename by ID and survive undo/reopen', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const p = fixture();
  await load(page, p);
  await select(page, 'N1');
  await select(page, 'N2', true);
  await command(page, 'LAYERS');
  const d = dialog(page);
  await d.getByLabel('Nome do novo layer', { exact: true }).fill('Armação');
  await d.getByRole('button', { name: 'Criar layer', exact: true }).click();
  await d
    .getByRole('button', {
      name: 'Atribuir layer à seleção (2)',
      exact: true,
    })
    .click();
  await d.getByLabel('Cor do layer', { exact: true }).fill('#123456');
  await d
    .getByLabel('Tipo de linha do layer', { exact: true })
    .selectOption({ label: 'DASHED' });
  await d.getByLabel('Espessura do layer', { exact: true }).fill('0.5');
  await d.getByLabel('Espessura do layer', { exact: true }).press('Tab');
  await d
    .getByRole('button', {
      name: 'Aplicar aos layers selecionados',
      exact: true,
    })
    .click();
  await close(page);
  const q = await save(page);
  const id = q.layers.find((l) => l.name === 'Armação')!.id;
  expect(q.bars.map((b) => b.layerId)).toEqual([id, id]);
  expect(mass(q)).toBe(mass(p));
  await expect(page.locator('[data-bar-id="a"] path').last()).toHaveAttribute(
    'stroke',
    '#123456',
  );
  await expect(page.locator('[data-bar-id="a"] path').last()).toHaveAttribute(
    'stroke-dasharray',
    '100 50',
  );
  await select(page, 'N2');
  await page
    .getByRole('button', { name: 'Layer e estilo', exact: true })
    .click();
  await page
    .getByLabel('Herança de cor', { exact: true })
    .selectOption('override');
  await page.getByLabel('Override de cor', { exact: true }).fill('#ff0000');
  await command(page, 'LAYERS');
  await d
    .getByRole('button', { name: 'Editar layer Armação', exact: true })
    .click();
  await d.getByLabel('Cor do layer', { exact: true }).fill('#00aa55');
  await d
    .getByRole('button', {
      name: 'Aplicar aos layers selecionados',
      exact: true,
    })
    .click();
  await close(page);
  const beforeRename = await save(page);
  await expect(page.locator('[data-bar-id="a"] path').last()).toHaveAttribute(
    'stroke',
    '#00aa55',
  );
  await expect(
    page.getByTestId('cad-distribution').locator('path').first(),
  ).toHaveAttribute('stroke', '#00aa55');
  await expect(page.locator('[data-bar-id="b"] path').last()).toHaveAttribute(
    'stroke',
    '#ff0000',
  );
  await command(page, 'LAYERS');
  await d
    .getByRole('button', { name: 'Editar layer Armação', exact: true })
    .click();
  await d.getByLabel('Nome do layer', { exact: true }).fill('Barras V01');
  await d
    .getByRole('button', {
      name: 'Aplicar aos layers selecionados',
      exact: true,
    })
    .click();
  await page.screenshot({ path: 'docs/native-layers.png' });
  await close(page);
  const renamed = await save(page);
  expect(renamed.layers.find((l) => l.id === id)?.name).toBe('Barras V01');
  expect(renamed.bars).toEqual(beforeRename.bars);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  expect(await save(page)).toEqual(beforeRename);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Refazer', exact: true })
    .click();
  expect(await save(page)).toEqual(renamed);
  await load(page, renamed);
  expect(await save(page)).toEqual(renamed);
  expect(errors).toEqual([]);
});
test('used/unused filters, bulk styles and deletion require reassignment and retain physical quantities', async ({
  page,
}) => {
  const base = fixture(),
    made = createLayer(base, 'Em uso');
  const p = assignLayer(made.project, ['a', 'b'], made.id);
  await load(page, p);
  await command(page, 'LAYERS');
  const d = dialog(page);
  await d.getByLabel('Filtrar layers', { exact: true }).selectOption('used');
  await d
    .getByRole('button', { name: 'Editar layer Em uso', exact: true })
    .click();
  await d
    .getByRole('button', { name: 'Excluir layer selecionado', exact: true })
    .click();
  await expect(d.getByRole('alert')).toContainText('reassociação');
  await d
    .getByLabel('Layer de reassociação', { exact: true })
    .selectOption('layer:DESENHO');
  await d
    .getByRole('button', { name: 'Excluir layer selecionado', exact: true })
    .click();
  await close(page);
  const q = await save(page);
  expect(q.bars.map((b) => b.layerId)).toEqual([
    'layer:DESENHO',
    'layer:DESENHO',
  ]);
  expect(mass(q)).toBe(mass(p));
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  const baseline = await save(page);
  await command(page, 'LAYERS');
  await d.getByLabel('Filtrar layers', { exact: true }).selectOption('unused');
  await expect(
    d.getByRole('button', { name: 'Editar layer Em uso', exact: true }),
  ).toHaveCount(0);
  await d.getByLabel('Selecionar layers listados', { exact: true }).check();
  await d.getByLabel('Cor do layer', { exact: true }).fill('#abcdef');
  await d
    .getByRole('button', {
      name: 'Aplicar aos layers selecionados',
      exact: true,
    })
    .click();
  await close(page);
  const updated = await save(page);
  expect(updated.bars).toEqual(baseline.bars);
  expect(
    updated.layers
      .filter((l) => l.id !== made.id)
      .every((l) => l.color === '#abcdef'),
  ).toBe(true);
});
test('DXF source layers are adopted into the native catalog, edited and exported without creating steel', async ({
  page,
}) => {
  const p = emptyProject();
  p.name = 'Referência externa';
  await load(page, p);
  await page.getByTestId('mask-input').setInputFiles({
    name: 'layers.dxf',
    mimeType: 'application/dxf',
    buffer: readFileSync('docs/examples/layers-reference.dxf'),
  });
  await confirmMaskImport(page);

  let q = await save(page);
  expect(q.bars).toHaveLength(0);
  expect(q.masks).toHaveLength(1);
  const imported = q.layers.find((l) => l.name === 'Referência')!;
  expect(imported).toMatchObject({ color: '#123abc', lineWidth: 0.7 });
  await command(page, 'LAYERS');
  const d = dialog(page);
  await d
    .getByRole('button', { name: 'Editar layer Referência', exact: true })
    .click();
  await d.getByLabel('Nome do layer', { exact: true }).fill('Arquitetura');
  await d.getByLabel('Cor do layer', { exact: true }).fill('#aa4411');
  await d
    .getByRole('button', {
      name: 'Aplicar aos layers selecionados',
      exact: true,
    })
    .click();
  await close(page);
  q = await save(page);
  expect(q.layers.find((l) => l.id === imported.id)?.name).toBe('Arquitetura');
  await expect(
    page.locator(`path[data-layer-id="${imported.id}"]`).first(),
  ).toHaveAttribute('stroke', '#aa4411');
  await load(page, q);
  expect(await save(page)).toEqual(q);
  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Desenho DXF', exact: true }).click();
  const raw = readFileSync((await (await event).path())!, 'utf8');
  expect(raw).toContain('Arquitetura');
  expect(raw).toContain('AC1021');
});
test('layer profiles protect editing, hide without removing steel and restore saved states with undo', async ({
  page,
}) => {
  const p = fixture();
  await load(page, p);
  await select(page, 'N1');
  await command(page, 'LAYERS');
  const d = dialog(page);
  await d.getByLabel('Editar ARMADURAS', { exact: true }).uncheck();
  await d.getByLabel('Nome do perfil', { exact: true }).fill('Revisão');
  await d
    .getByRole('button', { name: 'Salvar perfil atual', exact: true })
    .click();
  await close(page);
  const locked = await save(page);
  await command(page, 'DEL');
  await expect(page.getByRole('status')).toContainText('protegido');
  expect((await save(page)).bars).toEqual(locked.bars);
  await command(page, 'LAYERS');
  await d.getByLabel('Exibir ARMADURAS', { exact: true }).uncheck();
  await expect(d.getByText('Perfil · Personalizado')).toBeVisible();
  await close(page);
  await expect(page.locator('[data-bar-id="a"]')).toHaveCount(0);
  const hidden = await save(page);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  await expect(page.locator('[data-bar-id="a"]')).toBeVisible();
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Refazer', exact: true })
    .click();
  await expect(page.locator('[data-bar-id="a"]')).toHaveCount(0);
  expect(mass(hidden)).toBe(mass(p));
  await command(page, 'LAYERS');
  await d
    .getByRole('button', { name: 'Restaurar perfil', exact: true })
    .click();
  await close(page);
  await expect(page.locator('[data-bar-id="a"]')).toBeVisible();
  const restored = await save(page);
  expect(restored.layerEnvironment).toEqual(locked.layerEnvironment);
  await load(page, restored);
  expect((await save(page)).layerEnvironment).toEqual(
    restored.layerEnvironment,
  );
});
