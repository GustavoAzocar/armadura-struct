import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject, newBar, schedule } from '../../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
} from '../../src/domain/hierarchy';
import { newNativeMask } from '../../src/domain/nativeMasks';
import { maskPrimitives, parseDxf } from '../../src/cad/import';
import { setLayerState } from '../../src/domain/layerProfiles';
import { layerId } from '../../src/domain/layers';
import { placeDrawing } from '../../src/domain/sheets';
import type { Project } from '../../src/domain/types';

const destination = (page: Page) =>
  page.getByRole('region', {
    name: 'Destino do desenho de máscaras',
    exact: true,
  });
const active = (page: Page) =>
  page.getByRole('region', {
    name: 'Máscara ativa para desenhar',
    exact: true,
  });
const control = (page: Page) =>
  page.getByRole('dialog', { name: 'Controle de máscaras', exact: true });
async function command(page: Page, s: string) {
  const input = page.getByRole('textbox', { name: 'Comando CAD' });
  await input.fill(s);
  await input.press('Enter');
}
async function load(page: Page, p: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'masks.json',
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
  await destination(page)
    .getByLabel('Escolher máscara', { exact: true })
    .selectOption(id);
  await destination(page)
    .getByRole('button', { name: 'Ativar máscara para desenhar', exact: true })
    .click();
}
async function line(page: Page, a = '0,0', b = '1000,0') {
  await command(page, 'LINHA');
  await command(page, a);
  await command(page, b);
  await page.keyboard.press('Escape');
}
async function csvFile(page: Page) {
  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Quadro CSV', exact: true }).click();
  const content = readFileSync((await (await event).path())!, 'utf8');
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  return content;
}
function fixture() {
  let p = emptyProject();
  p.name = 'Máscaras globais';
  p.hierarchy.floors[0].name = 'Térreo';
  p.hierarchy.elements[0].name = 'Vigas';
  p.hierarchy.details[0].name = 'V1';
  const a = p.hierarchy.details[0].id,
    floor = createHierarchyNode(p, 'floor', 'Cobertura'),
    group = createHierarchyNode(floor.project, 'element', 'Vigas', floor.id),
    other = createHierarchyNode(group.project, 'detail', 'V1', group.id);
  p = other.project;
  const b = other.id;
  const masks = [
    { ...newNativeMask('Fôrma'), id: 'homonym-0001' },
    { ...newNativeMask('Fôrma'), id: 'homonym-0002' },
    {
      ...newNativeMask('Base DXF'),
      id: 'imported-dxf',
      format: 'DXF' as const,
      sourceUnit: 'cm',
      scale: 10,
      rotation: 37,
      origin: { x: 800, y: -300 },
      layers: { FORMA: true },
      primitives: [
        {
          layer: 'FORMA',
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
        },
      ],
    },
  ];
  p = completeOwnership(
    {
      ...p,
      bars: [{ ...newBar('N1'), id: 'bar', quantity: 8 }],
      masks,
      hierarchy: {
        ...p.hierarchy,
        objectDetails: {
          [masks[0].id]: a,
          [masks[1].id]: b,
          [masks[2].id]: b,
          bar: a,
        },
      },
    },
    a,
  );
  return { p, a, b };
}

test('cria sem aço pela aba com painel recolhido e modo Foco; quatro ferramentas usam o alvo explícito e histórico', async ({
  page,
}) => {
  await load(page, emptyProject());
  await page.getByRole('button', { name: 'Foco no CAD', exact: true }).click();
  await destination(page)
    .getByRole('button', { name: 'Nova máscara', exact: true })
    .click();
  await control(page)
    .getByLabel('Nome da nova máscara', { exact: true })
    .fill('Desenho inicial');
  await page.screenshot({ path: 'docs/mask-target-create.png' });
  await control(page)
    .getByRole('button', { name: 'Criar máscara nativa', exact: true })
    .dblclick();
  await expect(control(page)).toHaveCount(0);
  await expect(active(page)).toContainText('Desenho inicial');
  for (const [tool, points] of [
    ['LINHA', ['0,0', '1000,0']],
    ['RETANGULO', ['0,1000', '1000,1500']],
    ['CIRCULO', ['2000,1000', '2250,1000']],
    ['MPL', ['0,2000', '1000,2000', '1000,2500', '']],
  ] as const) {
    await command(page, tool);
    for (const p of points) await command(page, p);
    await page.keyboard.press('Escape');
  }
  const p = await save(page);
  expect(p.masks).toHaveLength(1);
  expect(p.masks[0].primitives).toHaveLength(4);
  expect(p.bars).toEqual([]);
  expect(schedule(p)).toEqual([]);
  expect(p.masks[0].primitives[2].native).toMatchObject({
    kind: 'circle',
    radius: 250,
  });
  await command(page, 'U');
  expect((await save(page)).masks[0].primitives).toHaveLength(3);
  await command(page, 'REDO');
  expect(await save(page)).toEqual(p);
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  await expect(active(page)).toContainText('Desenho inicial');
  expect((await save(page)).masks).toEqual(p.masks);
});

test('lista global distingue homônimos e propriedades/seleção de barra não trocam o destino; ativar navega e desenha só no alvo', async ({
  page,
}) => {
  page.on('dialog', (d) => d.accept());
  const { p } = fixture();
  await load(page, p);
  const csv = await csvFile(page);
  await expect(
    destination(page)
      .getByLabel('Escolher máscara', { exact: true })
      .locator('option'),
  ).toHaveCount(4);
  await activate(page, 'homonym-0001');
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page.locator('.bar-row').first().click();
  await expect(active(page)).toContainText('homonym-0001');
  await page
    .getByRole('button', { name: 'Controle de máscaras', exact: true })
    .click();
  await control(page)
    .getByLabel('Máscara do projeto', { exact: true })
    .selectOption('imported-dxf');
  await control(page)
    .getByRole('button', { name: 'Propriedades da máscara', exact: true })
    .click();
  await expect(active(page)).toContainText('homonym-0001');
  await expect(active(page)).toContainText('Outro detalhamento');
  await destination(page)
    .getByLabel('Pesquisar máscaras do projeto', { exact: true })
    .fill('Cobertura');
  await expect(
    destination(page)
      .getByLabel('Escolher máscara', { exact: true })
      .locator('option'),
  ).toContainText(['Escolher máscara', 'Térreo', 'Cobertura', 'Base DXF']);
  await activate(page, 'homonym-0002');
  await line(page);
  const q = await save(page);
  expect(q.masks[0]).toEqual(p.masks[0]);
  expect(q.masks[1].primitives).toHaveLength(1);
  expect(q.masks[2]).toEqual(p.masks[2]);
  expect(q.bars).toEqual(p.bars);
  expect(await csvFile(page)).toBe(csv);
  await page.screenshot({ path: 'docs/mask-target-global.png' });
});

test('DXF recebe apenas desenho local analítico, preserva base e exporta comprimento físico sem dupla escala', async ({
  page,
}) => {
  page.on('dialog', (d) => d.accept());
  const { p } = fixture();
  await load(page, p);
  await activate(page, 'imported-dxf');
  await expect(active(page)).toContainText('referência original preservada');
  await line(page, '800,-300', '1800,-300');
  const q = await save(page),
    m = q.masks[2];
  expect(q.masks).toHaveLength(3);
  expect(m.format).toBe('DXF');
  expect(m.sourceUnit).toBe('cm');
  expect(m.primitives[0]).toEqual(p.masks[2].primitives[0]);
  expect(m.primitives[1].native?.kind).toBe('line');
  const world = maskPrimitives(m).at(-1)!;
  expect(world.points[0].x).toBeCloseTo(800, 8);
  expect(world.points[1].x).toBeCloseTo(1800, 8);
  expect(world.points[1].y).toBeCloseTo(-300, 8);
  await command(page, 'CIRCULO');
  await command(page, '2000,1000');
  await command(page, '2250,1000');
  await page.keyboard.press('Escape');
  let current = await save(page);
  await page
    .getByRole('button', { name: 'Controle de máscaras', exact: true })
    .click();
  await control(page)
    .getByLabel('Máscara do projeto', { exact: true })
    .selectOption(m.id);
  await control(page)
    .getByLabel('Entidade da máscara', { exact: true })
    .selectOption(current.masks[2].primitives.at(-1)!.id!);
  expect(
    Number(
      await control(page)
        .getByLabel('Raio da entidade', { exact: true })
        .inputValue(),
    ),
  ).toBeCloseTo(250, 8);
  await control(page)
    .getByLabel('Raio da entidade', { exact: true })
    .fill('300');
  await control(page)
    .getByRole('button', { name: 'Aplicar geometria', exact: true })
    .click();
  await page.screenshot({ path: 'docs/mask-target-imported.png' });
  await control(page)
    .getByRole('button', { name: 'Concluir controle de máscaras', exact: true })
    .click();
  current = await save(page);
  expect(current.masks[2].primitives.at(-1)!.native).toMatchObject({
    kind: 'circle',
    radius: 30,
  });
  expect(schedule(current)).toEqual(schedule(p));
  expect(current.masks[0]).toEqual(p.masks[0]);
  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Desenho DXF', exact: true }).click();
  const exported = parseDxf(
    readFileSync((await (await event).path())!, 'utf8'),
    'export.dxf',
  );
  expect(
    exported.primitives.some(
      (e) =>
        e.points.length === 2 &&
        Math.abs(e.points[0].x - 800) < 0.001 &&
        Math.abs(e.points[1].x - 1800) < 0.001,
    ),
  ).toBe(true);
});

test('cancelar troca em isolamento preserva alvo e desenho; confirmar descarta prévia sem criar entidade parcial', async ({
  page,
}) => {
  const { p } = fixture();
  await load(page, p);
  await activate(page, 'homonym-0001');
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page
    .getByRole('button', { name: 'Abrir detalhamento V1', exact: true })
    .first()
    .click();
  await command(page, 'LINHA');
  await command(page, '0,0');
  page.once('dialog', (d) => d.dismiss());
  await activate(page, 'homonym-0002');
  await expect(active(page)).toContainText('homonym-0001');
  page.once('dialog', (d) => d.accept());
  await activate(page, 'homonym-0002');
  await expect(active(page)).toContainText('homonym-0002');
  await command(page, '');
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(p);
  await destination(page)
    .getByRole('button', { name: 'Nova máscara', exact: true })
    .click();
  await control(page)
    .getByLabel('Nome da nova máscara', { exact: true })
    .fill('Cancelar');
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(p);
});

test('máscara oculta e layer bloqueado têm orientação e não desbloqueiam; exclusão do alvo e troca de projeto limpam a escolha', async ({
  page,
}) => {
  page.on('dialog', (d) => d.accept());
  let { p } = fixture();
  p = {
    ...p,
    masks: p.masks.map((m, i) => (i === 0 ? { ...m, visible: false } : m)),
  };
  p = setLayerState(p, 'model', layerId('DESENHO'), { editable: false });
  p = setLayerState(
    p,
    `drawing:${p.hierarchy.drawings.find((d) => d.detailId === p.hierarchy.objectDetails['imported-dxf'])!.id}`,
    layerId('DESENHO'),
    { editable: false },
  );
  await load(page, p);
  await activate(page, 'homonym-0001');
  await expect(active(page)).toContainText('oculta');
  await command(page, 'LINHA');
  await expect(control(page)).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(p);
  await activate(page, 'imported-dxf');
  await expect(active(page)).toContainText('bloqueado');
  await command(page, 'LINHA');
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(p);
  await activate(page, 'homonym-0001');
  await page
    .getByRole('button', { name: 'Controle de máscaras', exact: true })
    .click();
  await control(page)
    .getByLabel('Máscara do projeto', { exact: true })
    .selectOption('homonym-0001');
  await control(page)
    .getByRole('button', { name: 'Excluir máscara', exact: true })
    .click();
  await control(page)
    .getByRole('button', { name: 'Concluir controle de máscaras', exact: true })
    .click();
  await expect(active(page)).toContainText('Nenhuma máscara ativa');
  const q = await save(page);
  expect(q.masks).toHaveLength(2);
  expect(q.bars).toEqual(p.bars);
  await page.getByRole('button', { name: 'Desenho', exact: true }).click();
  const next = emptyProject();
  await page.getByTestId('project-input').setInputFiles({
    name: 'novo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(next)),
  });
  await expect(active(page)).toContainText('Nenhuma máscara ativa');
  expect((await save(page)).masks).toEqual([]);
});

test('acesso pela prancha abre o desenho correto; criação confirma o contexto e recusa homônimo sem sobrescrever', async ({
  page,
}) => {
  page.on('dialog', (d) => d.accept());
  const { p, b } = fixture();
  const placed = placeDrawing(
    p,
    p.sheets[0].id,
    p.hierarchy.drawings.find((d) => d.detailId === b)!.id,
  ).project;
  await load(page, placed);
  await page.getByRole('tab', { name: 'Pranchas', exact: true }).click();
  await page
    .getByRole('button', {
      name: `Abrir ${p.sheets[0].name}`,
      exact: true,
    })
    .click();
  await activate(page, 'imported-dxf');
  await expect(page.getByTestId('cad-canvas')).toBeVisible();
  await expect(page.getByTestId('sheet-canvas')).toHaveCount(0);
  expect((await save(page)).hierarchy.placements).toEqual(
    placed.hierarchy.placements,
  );
  await destination(page)
    .getByRole('button', { name: 'Nova máscara', exact: true })
    .click();
  await control(page)
    .getByLabel('Nome da nova máscara', { exact: true })
    .fill('Fôrma');
  await control(page)
    .getByRole('button', { name: 'Criar máscara nativa', exact: true })
    .click();
  await expect(control(page).getByRole('alert')).toContainText('Já existe');
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(placed);
  await destination(page)
    .getByRole('button', { name: 'Nova máscara', exact: true })
    .click();
  await control(page)
    .getByLabel('Nome da nova máscara', { exact: true })
    .fill('Nova do térreo');
  await control(page)
    .getByLabel('Contexto da nova máscara', { exact: true })
    .selectOption(p.hierarchy.details[0].id);
  await expect(
    control(page).getByRole('button', {
      name: 'Criar máscara nativa',
      exact: true,
    }),
  ).toBeDisabled();
  await control(page)
    .getByRole('button', { name: 'Abrir contexto de criação', exact: true })
    .click();
  await control(page)
    .getByRole('button', { name: 'Criar máscara nativa', exact: true })
    .click();
  const created = await save(page);
  expect(created.masks).toHaveLength(4);
  expect(created.masks.slice(0, 3)).toEqual(placed.masks);
  expect(created.hierarchy.objectDetails[created.masks[3].id]).toBe(
    p.hierarchy.details[0].id,
  );
  await expect(active(page)).toContainText('Nova do térreo');
  expect(created.bars).toEqual(placed.bars);
});
