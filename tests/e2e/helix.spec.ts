import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject, schedule } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import { helixBar } from '../../src/domain/helixBars';
import { defaultHelixCriteria } from '../../src/domain/helixSchema';
import { helixMetrics } from '../../src/domain/helix';
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
    name: 'helicoidal.armstruct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  await closeToast(page);
}
const panel = (page: Page) =>
  page.getByRole('region', { name: 'Lançamento de estribo helicoidal' });
const criteria = (page: Page) =>
  page.getByRole('dialog', { name: 'Critérios do helicoidal', exact: true });
async function fill(page: Page, values: [string, string][]) {
  const dialog = criteria(page);
  for (const [label, value] of values)
    await dialog.getByLabel(label, { exact: true }).fill(value);
}

test('comandos do helicoidal cabem na faixa Armaduras em telas de notebook', async ({
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
    for (const name of ['Estribo helicoidal', 'Critérios do helicoidal'])
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

test('lança por dois pontos, confirma uma única vez e conserva corte, quantidade, histórico e recuperação', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const fixture = emptyProject();
  fixture.hierarchy.details[0].repetition = { factor: 4, elements: [] };
  await load(page, fixture);
  await page.setViewportSize({ width: 1366, height: 768 });
  const before = await save(page);
  await command(page, 'CRITERIOSHELICOIDAL');
  const dialog = criteria(page);
  await expect(dialog).toBeVisible();
  await fill(page, [
    ['Bitola φ (mm)', '8'],
    ['Diâmetro no eixo D (mm)', '400'],
    ['Passo axial p (mm)', '150'],
  ]);
  await expect(dialog.getByTestId('helix-axis-diameter')).toContainText(
    '400,000 mm no eixo',
  );
  await dialog.getByRole('button', { name: 'Quantidade', exact: true }).click();
  await fill(page, [
    ['Quantidade de hélices idênticas', '2'],
    ['Multiplicador da armadura', '3'],
  ]);
  await dialog.getByRole('button', { name: 'Peça', exact: true }).click();
  await dialog.screenshot({ path: 'docs/helix-criteria.png' });
  await dialog
    .getByRole('button', { name: 'Indicar o eixo da hélice', exact: true })
    .click();
  await expect(panel(page)).toBeVisible();
  await command(page, '0,0');
  // Nothing persists before the confirmation.
  expect(await save(page)).toEqual(before);
  await command(page, '3000,0');
  await expect(panel(page)).toContainText('25.311,157 mm');
  await expect(panel(page)).toContainText('20 (20 completas + 0,000)');
  await expect(panel(page)).toContainText('= 24 · 607,468 m · 239,697 kg');
  expect(await save(page)).toEqual(before);
  await closeToast(page);
  await command(page, 'F');
  await page.screenshot({ path: 'docs/helix-preview.png' });
  await command(page, '');
  await command(page, '');
  const committed = await save(page);
  expect(committed.bars).toHaveLength(1);
  expect(committed.bars[0]).toMatchObject({
    kind: 'helix',
    origin: { x: 0, y: 0 },
    rotation: 0,
    quantity: 2,
    multiplier: 3,
    quantitySource: { kind: 'manual' },
    helix: {
      diameter: { reference: 'axis', value: 400 },
      span: { source: 'gross', value: 3000 },
      pitch: 150,
      hand: 'right',
    },
  });
  expect(committed.helixDefaults?.profile.pitch).toBe(150);
  const row = schedule(committed)[0];
  expect(row.quantity).toBe(24);
  expect(row.unitLength).toBeCloseTo(25.311157256627, 9);
  expect(row.totalLength).toBeCloseTo(607.467774159, 6);
  expect(row.weight).toBeCloseTo(239.697086852, 6);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  expect((await save(page)).bars).toHaveLength(0);
  await page.getByRole('button', { name: 'Refazer', exact: true }).click();
  expect((await save(page)).bars).toEqual(committed.bars);
  await page.waitForTimeout(750);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect((await save(page)).bars).toEqual(committed.bars);
  await page
    .locator('.document-tabs')
    .getByRole('button', { name: /Quadro de aço/ })
    .click();
  await expect(page.locator('.schedule-table')).toContainText('2 × 3 × 4 = 24');
  await expect(page.locator('.schedule-table')).toContainText('607,468');
  await page.screenshot({ path: 'docs/helix-schedule.png' });
  expect(errors).toEqual([]);
});

test('entrada numérica vertical com afastamentos; inválidos, Esc e Voltar não deixam resíduos em janela baixa', async ({
  page,
}) => {
  await load(page);
  await page.setViewportSize({ width: 1000, height: 650 });
  const before = await save(page);
  await command(page, 'HELICOIDAL');
  const dialog = criteria(page);
  await expect(dialog).toBeVisible();
  await fill(page, [['Passo axial p (mm)', '0']]);
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Indicar o eixo da hélice' }),
  ).toBeDisabled();
  await fill(page, [['Passo axial p (mm)', '150']]);
  await dialog.getByRole('button', { name: 'Quantidade', exact: true }).click();
  await fill(page, [['Quantidade de hélices idênticas', '1.5']]);
  await expect(
    dialog.getByRole('button', { name: 'Indicar o eixo da hélice' }),
  ).toBeDisabled();
  await fill(page, [['Quantidade de hélices idênticas', '1']]);
  await dialog.getByRole('button', { name: 'Trecho', exact: true }).click();
  await fill(page, [
    ['Hbruto (mm)', '3200'],
    ['Afastamento inicial a (mm)', '100'],
    ['Afastamento final b (mm)', '100'],
  ]);
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(before);
  await command(page, 'CRITERIOSHELICOIDAL');
  await dialog.getByRole('button', { name: 'Trecho', exact: true }).click();
  await fill(page, [
    ['Hbruto (mm)', '3200'],
    ['Afastamento inicial a (mm)', '100'],
    ['Afastamento final b (mm)', '100'],
  ]);
  await dialog
    .getByRole('button', { name: 'Indicar o eixo da hélice', exact: true })
    .click();
  await panel(page).getByLabel('Início, direção e comprimento').check();
  await panel(page).getByLabel('Direção A→B (°)', { exact: true }).fill('90');
  await command(page, '500,500');
  await expect(panel(page)).toContainText('Altura axial útil H3.000,0 mm');
  await panel(page).getByRole('button', { name: 'Voltar etapa' }).click();
  expect(await save(page)).toEqual(before);
  await command(page, '500,500');
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(before);
  // Criteria only become the next defaults after a confirmed launch.
  await command(page, 'HELICOIDAL');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Trecho', exact: true }).click();
  await fill(page, [
    ['Hbruto (mm)', '3200'],
    ['Afastamento inicial a (mm)', '100'],
    ['Afastamento final b (mm)', '100'],
  ]);
  await dialog
    .getByRole('button', { name: 'Indicar o eixo da hélice', exact: true })
    .click();
  await panel(page).getByLabel('Início, direção e comprimento').check();
  await panel(page).getByLabel('Direção A→B (°)', { exact: true }).fill('90');
  await command(page, '500,500');
  await panel(page)
    .getByRole('button', { name: 'Confirmar lançamento' })
    .click();
  const saved = await save(page);
  expect(saved.bars).toHaveLength(1);
  expect(saved.bars[0].rotation).toBe(90);
  const m = helixMetrics(saved.bars[0]);
  expect(m.gross).toBe(3200);
  expect(m.H).toBe(3000);
  expect(m.cutLength).toBeCloseTo(25311.157256627, 6);
});

test('editar critérios desta posição preserva o ID e recalcula voltas e corte', async ({
  page,
}) => {
  const c = defaultHelixCriteria();
  const project = completeOwnership({
    ...emptyProject(),
    bars: [helixBar(c, { x: 0, y: 0 }, 0, 'N1', 'helix-1')],
    details: [
      { id: 'helix-view', barId: 'helix-1', origin: { x: 0, y: -1600 } },
    ],
  });
  await load(page, project);
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page.locator('.bar-row').click();
  await expect(
    page.getByRole('table', { name: 'Memória do helicoidal' }),
  ).toContainText('20 (20 completas');
  await page
    .getByRole('button', {
      name: 'Editar critérios desta posição',
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog', {
    name: /Editar estribo helicoidal/,
  });
  await dialog.getByLabel('Passo axial p (mm)', { exact: true }).fill('200');
  await dialog
    .getByRole('button', { name: 'Aplicar alterações', exact: true })
    .click();
  await command(page, '');
  const saved = await save(page);
  expect(saved.bars).toHaveLength(1);
  expect(saved.bars[0].id).toBe('helix-1');
  expect(saved.details).toEqual(project.details);
  const m = helixMetrics(saved.bars[0]);
  expect(m.turns).toBeCloseTo(15, 12);
  expect(schedule(saved)[0].quantity).toBe(1);
});
