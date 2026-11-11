import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject, schedule } from '../../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
} from '../../src/domain/hierarchy';
import { beamClampBar } from '../../src/domain/beamClamps';
import { defaultBeamClampCriteria } from '../../src/domain/beamClampSchema';
import { factoryCadDefaults } from '../../src/domain/cadDefaults';
import type { Project } from '../../src/domain/types';

async function command(page: Page, value: string) {
  const input = page.getByRole('textbox', { name: 'Comando CAD' });
  await input.fill(value);
  await input.press('Enter');
}
async function closeToast(page: Page) {
  const close = page.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await close.isVisible()) await close.click();
}
async function save(page: Page): Promise<Project> {
  await closeToast(page);
  const event = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
}
async function load(page: Page, project = emptyProject()) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'grampos.armstruct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  await closeToast(page);
}
const panel = (page: Page) =>
  page.getByRole('region', { name: 'Lançamento de grampo de viga' });
const criteria = (page: Page) =>
  page.getByRole('dialog', {
    name: 'Critérios do grampo de viga',
    exact: true,
  });
async function analyticCriteria(page: Page, rotation = '0') {
  await command(page, 'CRITERIOSGRAMPO');
  const dialog = criteria(page);
  await expect(dialog).toBeVisible();
  for (const [label, value] of [
    ['Comprimento longitudinal L (mm)', '600'],
    ['Dimensão transversal T (mm)', '300'],
    ['Bitola (mm)', '10'],
    ['Mandril interno (mm)', '50'],
    ['Ângulo da peça (°)', rotation],
  ])
    await dialog.getByLabel(label, { exact: true }).fill(value);
  return dialog;
}

test('comandos de grampo cabem na faixa Armaduras em telas de notebook', async ({
  page,
}) => {
  await load(page);
  for (const width of [1280, 1366, 1600]) {
    await page.setViewportSize({ width, height: 768 });
    await expect(
      page
        .locator('.ribbon-content')
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).resolves.toBe(true);
    expect(
      await page
        .locator('.ribbon-tool>span')
        .evaluateAll((items) =>
          items.some((e) => e.scrollWidth > e.clientWidth + 2),
        ),
    ).toBe(false);
    for (const name of [
      'Grampo de viga',
      'Critérios do grampo de viga',
      'Renumerar',
    ])
      await expect(
        page
          .locator('.ribbon-content')
          .getByRole('button', { name, exact: true }),
      ).toBeInViewport({ ratio: 1 });
    expect(
      (await page.locator('.ribbon-content').boundingBox())!.height,
    ).toBeLessThanOrEqual(79);
  }
});

test('grampo inclinado usa um ponto, confirma uma vez e conserva corte, quantidade, histórico e recuperação', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const fixture = emptyProject();
  fixture.hierarchy.details[0].repetition = {
    factor: 3,
    elements: [{ name: 'V1' }, { name: 'V2' }, { name: 'V3' }],
  };
  await load(page, fixture);
  const before = await save(page);
  const dialog = await analyticCriteria(page, '30');
  await dialog.screenshot({ path: 'docs/beam-clamp-criteria.png' });
  await dialog.getByRole('button', { name: 'Quantidade', exact: true }).click();
  await dialog.getByLabel('Quantidade de grampos', { exact: true }).fill('9');
  await dialog.getByLabel('Multiplicador', { exact: true }).fill('2');
  await dialog
    .getByRole('button', { name: 'Posicionar grampo', exact: true })
    .click();
  await command(page, '0,0');
  await expect(panel(page)).toContainText('600');
  await expect(panel(page)).toContainText('54 grampos completos');
  expect(await save(page)).toEqual(before);
  await closeToast(page);
  await command(page, 'F');
  await page.screenshot({ path: 'docs/beam-clamp-preview.png' });
  await command(page, '');
  await command(page, '');
  await command(page, '');
  const committed = await save(page);
  expect(committed.bars).toHaveLength(1);
  expect(committed.bars[0]).toMatchObject({
    kind: 'beam-clamp',
    origin: { x: 0, y: 0 },
    rotation: 30,
    quantity: 9,
    multiplier: 2,
    quantitySource: { kind: 'manual' },
    beamClamp: { longitudinal: 600, transverse: 300 },
  });
  const row = schedule(committed)[0];
  expect(row.quantity).toBe(54);
  expect(row.unitLength).toBeCloseTo(1.4742477796, 9);
  expect(row.totalLength).toBeCloseTo(79.6093801, 6);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  expect((await save(page)).bars).toHaveLength(0);
  await page.getByRole('button', { name: 'Refazer', exact: true }).click();
  expect((await save(page)).bars).toEqual(committed.bars);
  await load(page, committed);
  expect((await save(page)).bars).toEqual(committed.bars);
  await page.waitForTimeout(750);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect((await save(page)).bars).toEqual(committed.bars);
  await page
    .locator('.document-tabs')
    .getByRole('button', { name: /Quadro de aço/ })
    .click();
  await expect(page.locator('.schedule-table')).toContainText('9 × 2 × 3 = 54');
  await expect(page.locator('.schedule-table')).toContainText('79,609');
  expect(errors).toEqual([]);
});

test('critérios recusam medidas e contagens inválidas; Esc e Voltar não deixam resíduos em janela baixa', async ({
  page,
}) => {
  await load(page);
  await page.setViewportSize({ width: 1000, height: 650 });
  const before = await save(page);
  let dialog = await analyticCriteria(page);
  await dialog
    .getByLabel('Dimensão transversal T (mm)', { exact: true })
    .fill('50');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Posicionar grampo', exact: true }),
  ).toBeDisabled();
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel('Dimensão transversal T (mm)', { exact: true })
    .fill('300');
  await dialog.getByRole('button', { name: 'Quantidade', exact: true }).click();
  await dialog.getByLabel('Quantidade de grampos', { exact: true }).fill('1.5');
  await expect(
    dialog.getByRole('button', { name: 'Posicionar grampo', exact: true }),
  ).toBeDisabled();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(before);
  dialog = await analyticCriteria(page);
  await dialog
    .getByRole('button', { name: 'Posicionar grampo', exact: true })
    .click();
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(before);
  await command(page, 'GV');
  await criteria(page)
    .getByRole('button', { name: 'Posicionar grampo', exact: true })
    .click();
  await command(page, '0,0');
  await panel(page)
    .getByRole('button', { name: 'Definir direção por segundo ponto' })
    .click();
  await command(page, '0,0');
  await expect(panel(page).getByRole('alert')).toBeVisible();
  expect(await save(page)).toEqual(before);
  await command(page, '0,1000');
  await expect(panel(page)).toContainText('90,00°');
  await panel(page)
    .getByRole('button', { name: 'Alternar dobra esquerda/direita' })
    .click();
  await panel(page)
    .getByRole('button', { name: 'Reposicionar identificação' })
    .click();
  await panel(page).getByRole('button', { name: 'Voltar etapa' }).click();
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(before);
});

test('vistas vinculadas e edição dos parâmetros físicos atualizam o esquema sem somar grampos', async ({
  page,
}) => {
  const c = defaultBeamClampCriteria();
  c.quantity = 9;
  c.multiplier = 2;
  const project = completeOwnership({
    ...emptyProject(),
    bars: [
      {
        ...beamClampBar(c, { x: 0, y: 0 }, 'N1', 'beam-u'),
        element: 'V1',
        comment: 'Teste',
        columnLevel: '2',
        manufacturing: { start: { kind: 'threaded', code: 'ROSCA-TESTE' } },
      },
    ],
    details: [
      {
        id: 'beam-perspective',
        barId: 'beam-u',
        origin: { x: 0, y: -900 },
        beamClampView: {
          ...c.view,
          transverseScale: 0.25,
          closedSide: 'right',
        },
      },
      {
        id: 'beam-development',
        barId: 'beam-u',
        origin: { x: 0, y: 900 },
        beamClampView: { ...c.view, mode: 'development' },
      },
    ],
  });
  project.hierarchy.details[0].repetition = {
    factor: 3,
    elements: [{ name: 'V1' }, { name: 'V2' }, { name: 'V3' }],
  };
  await load(page, project);
  await command(page, 'F');
  await page.getByRole('button', { name: 'Afastar', exact: true }).click();
  await page.screenshot({ path: 'docs/beam-clamp-views.png' });
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page.locator('.bar-row').click();
  await page
    .getByRole('button', { name: 'Editar inserção 2', exact: true })
    .click();
  await page.getByLabel('Rotação da inserção', { exact: true }).fill('90');
  await page.getByLabel('Rotação da inserção', { exact: true }).press('Tab');
  await page
    .getByLabel('Escala gráfica da inserção', { exact: true })
    .fill('0.5');
  await page
    .getByLabel('Escala gráfica da inserção', { exact: true })
    .press('Tab');
  let saved = await save(page);
  expect(saved.bars).toEqual(project.bars);
  expect(schedule(saved)[0].quantity).toBe(54);
  expect(schedule(saved)[0].unitLength).toBeCloseTo(1.4742477796, 9);
  await page
    .getByRole('button', { name: 'Excluir somente esta inserção', exact: true })
    .click();
  saved = await save(page);
  expect(saved.details).toHaveLength(1);
  expect(schedule(saved)[0].quantity).toBe(54);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page.locator('.bar-row').click();
  await page
    .getByRole('button', {
      name: 'Editar critérios do grampo de viga',
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog', { name: /Editar grampo de viga/ });
  await dialog
    .getByLabel('Dimensão transversal T (mm)', { exact: true })
    .fill('400');
  await dialog
    .getByRole('button', { name: 'Aplicar alterações', exact: true })
    .click();
  await command(page, '');
  saved = await save(page);
  expect(saved.bars[0].id).toBe('beam-u');
  expect(saved.bars[0].beamClamp?.transverse).toBe(400);
  expect(saved.bars[0]).toMatchObject({
    element: 'V1',
    comment: 'Teste',
    columnLevel: '2',
    manufacturing: { start: { kind: 'threaded', code: 'ROSCA-TESTE' } },
  });
  expect(saved.details.map((detail) => detail.barId)).toEqual([
    'beam-u',
    'beam-u',
  ]);
  expect(schedule(saved)[0].quantity).toBe(54);
  expect(schedule(saved)[0].unitLength).toBeCloseTo(1.5742477796, 9);
});

test('faixa opcional usa direção própria, afastamentos e passo máximo ou fixo sem alterar L ou T', async ({
  page,
}) => {
  await load(page);
  const before = await save(page);
  const dialog = await analyticCriteria(page);
  await dialog.getByRole('button', { name: 'Quantidade', exact: true }).click();
  await dialog
    .getByRole('checkbox', { name: 'Distribuir grampos em uma faixa' })
    .check();
  await dialog
    .getByLabel('Contagem da faixa de grampos')
    .selectOption('spacing');
  await dialog.getByLabel('Passo da faixa (mm)', { exact: true }).fill('200');
  await dialog
    .getByLabel('Afastamento inicial (mm)', { exact: true })
    .fill('50');
  await dialog.getByLabel('Afastamento final (mm)', { exact: true }).fill('75');
  await dialog
    .getByRole('button', { name: 'Posicionar grampo', exact: true })
    .click();
  for (const value of ['2000,0', '0,0', '0,0']) await command(page, value);
  await expect(panel(page).getByRole('alert')).toBeVisible();
  expect(await save(page)).toEqual(before);
  await command(page, '0,1100');
  await expect(panel(page)).toContainText('6 grampos');
  await expect(panel(page)).toContainText('195,00 mm');
  await panel(page)
    .getByRole('button', { name: 'Reposicionar identificação' })
    .click();
  await command(page, '-300,0');
  await expect(panel(page)).toContainText('6 grampos');
  await command(page, '');
  const maximum = await save(page);
  expect(maximum.bars[0]).toMatchObject({
    quantity: 6,
    beamClamp: { longitudinal: 600, transverse: 300 },
    distribution: { start: { x: 0, y: 50 }, end: { x: 0, y: 1025 } },
  });
  const fixedDialog = await analyticCriteria(page);
  await fixedDialog
    .getByRole('button', { name: 'Quantidade', exact: true })
    .click();
  await fixedDialog
    .getByLabel('Política do passo do grampo')
    .selectOption('fixed');
  await fixedDialog
    .getByRole('button', { name: 'Posicionar grampo', exact: true })
    .click();
  for (const value of ['3500,0', '0,2000', '1100,2000', ''])
    await command(page, value);
  const fixed = await save(page);
  expect(fixed.bars).toHaveLength(2);
  expect(fixed.bars[1].quantity).toBe(5);
  expect(fixed.bars[0]).toEqual(maximum.bars[0]);
});

test('rebatimento é cópia gráfica; duplicação completa cria outra peça e um Desfazer remove o conjunto', async ({
  page,
}) => {
  const c = defaultBeamClampCriteria();
  c.quantity = 4;
  const fixture = completeOwnership({
    ...emptyProject(),
    bars: [beamClampBar(c, { x: 0, y: 0 }, 'N1', 'original-u')],
    details: [
      {
        id: 'view-u',
        barId: 'original-u',
        origin: { x: 1000, y: 0 },
        beamClampView: { ...c.view, mode: 'development' },
      },
    ],
  });
  await load(page, fixture);
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page.locator('.bar-row').click();
  for (const value of ['R', '0,-800']) await command(page, value);
  const graphical = await save(page);
  expect(graphical.bars).toHaveLength(1);
  expect(graphical.details).toHaveLength(2);
  expect(schedule(graphical)[0].quantity).toBe(4);
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page.locator('.bar-row').click();
  await command(page, 'DUPLICAR');
  const dialog = page.getByRole('dialog', {
    name: 'Duplicar armadura completa',
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Duplicar conjunto', exact: true })
    .click();
  const physical = await save(page);
  expect(physical.bars).toHaveLength(2);
  expect(physical.bars[1].kind).toBe('beam-clamp');
  expect(physical.bars[1].beamClamp).toEqual(graphical.bars[0].beamClamp);
  expect(physical.bars[1].id).not.toBe(graphical.bars[0].id);
  expect(physical.details).toHaveLength(4);
  expect(
    physical.details.filter((view) => view.barId === physical.bars[1].id),
  ).toHaveLength(2);
  expect(schedule(physical).reduce((sum, row) => sum + row.quantity, 0)).toBe(
    8,
  );
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  expect(await save(page)).toEqual(graphical);
});

test('Esc em cada captura e troca de contexto descartam a transação; reabrir critérios mantém a inserção', async ({
  page,
}) => {
  const c = defaultBeamClampCriteria();
  c.distribute = true;
  const fixture = emptyProject();
  fixture.beamClampDefaults = c;
  const other = createHierarchyNode(
    fixture,
    'detail',
    'Outro detalhamento',
    fixture.hierarchy.elements[0].id,
  );
  await load(page, other.project);
  const before = await save(page);
  for (const points of [
    [],
    ['0,0'],
    ['0,0', '0,0'],
    ['0,0', '0,0', '1100,0'],
  ]) {
    await command(page, 'GV');
    for (const point of points) await command(page, point);
    if (points.length === 3)
      await panel(page)
        .getByRole('button', { name: 'Reposicionar identificação' })
        .click();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    expect(await save(page)).toEqual(before);
  }
  await command(page, 'GV');
  await command(page, '0,0');
  await page
    .getByLabel('Detalhamento ativo', { exact: true })
    .selectOption(other.id);
  await expect(panel(page)).toHaveCount(0);
  expect(await save(page)).toEqual(before);
  await command(page, 'GV');
  await command(page, '0,0');
  const replacement = emptyProject();
  replacement.name = 'Outro projeto';
  await page.getByTestId('project-input').setInputFiles({
    name: 'outro.armstruct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(replacement)),
  });
  await expect(panel(page)).toHaveCount(0);
  expect((await save(page)).bars).toHaveLength(0);
  const manual = emptyProject();
  manual.beamClampDefaults = defaultBeamClampCriteria();
  await load(page, manual);
  await command(page, 'GV');
  await command(page, '1234,-567');
  await panel(page)
    .getByRole('button', { name: 'Critérios do grampo de viga' })
    .click();
  await criteria(page)
    .getByLabel('Dimensão transversal T (mm)', { exact: true })
    .fill('400.5');
  await criteria(page)
    .getByRole('button', { name: 'Posicionar grampo', exact: true })
    .click();
  await expect(panel(page)).toContainText('T = 400,50 mm');
  await command(page, '');
  const saved = await save(page);
  expect(saved.bars).toHaveLength(1);
  expect(saved.bars[0]).toMatchObject({
    origin: { x: 1234, y: -567 },
    beamClamp: { transverse: 400.5 },
  });
});

test('prévia da faixa compõe os fatores uma vez e o aço explícito prevalece sobre o padrão CAD', async ({
  page,
}) => {
  const fixture = emptyProject();
  fixture.cadDefaults = factoryCadDefaults();
  fixture.cadDefaults.armatures.steel = 'CA-50';
  fixture.hierarchy.details[0].repetition = {
    factor: 3,
    elements: [{ name: 'V1' }, { name: 'V2' }, { name: 'V3' }],
  };
  await load(page, fixture);
  const dialog = await analyticCriteria(page);
  await dialog
    .getByLabel('Aço do grampo', { exact: true })
    .selectOption('CA-60');
  await dialog.getByRole('button', { name: 'Quantidade', exact: true }).click();
  await dialog.getByLabel('Quantidade de grampos', { exact: true }).fill('9');
  await dialog.getByLabel('Multiplicador', { exact: true }).fill('2');
  await dialog
    .getByRole('checkbox', { name: 'Distribuir grampos em uma faixa' })
    .check();
  await dialog
    .getByLabel('Contagem da faixa de grampos')
    .selectOption('quantity');
  await dialog
    .getByRole('button', { name: 'Posicionar grampo', exact: true })
    .click();
  for (const value of ['0,1000', '0,0', '1100,0']) await command(page, value);
  await expect(panel(page)).toContainText('54 grampos completos');
  await expect(page.getByTestId('transform-preview')).toContainText(
    '9 × 2 × 3 = 54 N1',
  );
  await command(page, '');
  const saved = await save(page);
  expect(saved.bars[0]).toMatchObject({
    quantity: 9,
    multiplier: 2,
    steel: 'CA-60',
  });
  expect(schedule(saved)[0].quantity).toBe(54);
  expect(schedule(saved)[0].totalLength).toBeCloseTo(79.6093801, 6);
});

test('ações opcionais retomam a captura pendente da faixa ao concluir ou voltar', async ({
  page,
}) => {
  for (const scenario of [
    { started: false, action: 'label', back: false },
    { started: false, action: 'direction', back: true },
    { started: true, action: 'label', back: true },
    { started: true, action: 'direction', back: false },
  ]) {
    const fixture = emptyProject();
    fixture.beamClampDefaults = {
      ...defaultBeamClampCriteria(),
      distribute: true,
    };
    await load(page, fixture);
    await command(page, 'GV');
    await command(page, '2000,0');
    if (scenario.started) await command(page, '0,0');
    await panel(page)
      .getByRole('button', {
        name:
          scenario.action === 'label'
            ? 'Reposicionar identificação'
            : 'Definir direção por segundo ponto',
      })
      .click();
    if (scenario.back)
      await panel(page).getByRole('button', { name: 'Voltar etapa' }).click();
    else await command(page, '2500,500');
    await expect(panel(page).getByRole('status')).toContainText(
      scenario.started ? 'Indique o fim da faixa' : 'Indique o início da faixa',
    );
    await expect(
      panel(page).getByRole('button', { name: 'Confirmar lançamento' }),
    ).toBeDisabled();
    expect((await save(page)).bars).toHaveLength(0);
    if (!scenario.started) await command(page, '0,0');
    await command(page, '1100,0');
    await command(page, '');
    const saved = await save(page);
    expect(saved.bars).toHaveLength(1);
    expect(saved.bars[0].distribution).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 1100, y: 0 },
    });
    expect(saved.bars[0].quantity).toBe(7);
  }
});
