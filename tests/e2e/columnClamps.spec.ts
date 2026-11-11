import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject } from '../../src/domain/model';
import { factoryCadDefaults } from '../../src/domain/cadDefaults';
import {
  confirmProjectReplacement,
  useCompatibleProjectFolders,
} from './projectSetup.helpers';
async function command(page: Page, value: string) {
  const box = page.getByRole('textbox', { name: 'Comando CAD' });
  await box.fill(value);
  await box.press('Enter');
}
async function save(page: Page) {
  const ev = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await ev).path())!, 'utf8'));
}
async function fresh(page: Page) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Novo projeto', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByLabel('Nome do projeto', { exact: true })
    .fill('Lançamento de estribos');
  await confirmProjectReplacement(page);
  await page
    .getByRole('button', { name: 'Criar projeto', exact: true })
    .click();
}
async function start(page: Page) {
  await command(page, 'E');
  const dialog = page.getByRole('dialog', {
    name: 'Critérios do estribo',
    exact: true,
  });
  if (await dialog.isVisible())
    await dialog
      .getByRole('button', { name: 'Usar critérios e lançar' })
      .click();
}
const panel = (page: Page) =>
  page.getByRole('region', { name: 'Lançamento de estribo' });

async function configure(page: Page, shape = 'clamp-s', distribute = false) {
  await command(page, 'E');
  const d = page.getByRole('dialog', {
    name: 'Critérios do estribo',
    exact: true,
  });
  if (!(await d.isVisible()))
    await page
      .getByRole('button', { name: 'Critérios do estribo', exact: true })
      .click();
  await d.getByLabel('Formato do estribo').selectOption(shape);
  await d.getByLabel('Bitola do estribo (mm)', { exact: true }).fill('8');
  await d.getByLabel('Mandril interno (mm)', { exact: true }).fill('32');
  await d.getByLabel('Bitola longitudinal 2 (mm)').fill('20');
  await d.getByRole('button', { name: 'Distribuição', exact: true }).click();
  await d
    .getByLabel('Modo de lançamento do estribo')
    .selectOption(distribute ? 'range' : 'section');
  if (distribute) await d.getByLabel('Espaçamento solicitado (mm)').fill('100');
  else await d.getByLabel('Quantidade da seção').fill('22');
  await d.getByRole('button', { name: 'Forma', exact: true }).click();
  await d.screenshot({ path: `docs/column-clamp-${shape}-criteria.png` });
  await d.getByRole('button', { name: 'Usar critérios e lançar' }).click();
}

test('S/C: dois centros, correção sem reinício, prévia, confirmação única, edição e recuperação', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fresh(page);
  const before = await save(page);
  await configure(page);
  await expect(panel(page)).toContainText('primeiro centro');
  await command(page, '1000,1000');
  await expect(panel(page)).toContainText('segundo centro');
  await page.screenshot({ path: 'docs/column-clamp-center-selection.png' });
  await command(page, '1000,1000');
  await expect(panel(page).getByRole('alert')).toContainText('coincidentes');
  expect(await save(page)).toEqual(before);
  await command(page, '1400,1200');
  await expect(panel(page)).toContainText('22 peça(s)');
  await panel(page)
    .getByRole('button', { name: 'Editar bitolas / orientação / centros' })
    .click();
  const d = page.getByRole('dialog', {
    name: 'Critérios do estribo',
    exact: true,
  });
  await d.getByLabel('Orientação do grampo').selectOption('-1');
  await d.getByRole('button', { name: 'Usar critérios e lançar' }).click();
  await command(page, 'F');
  await page.screenshot({ path: 'docs/column-clamp-preview.png' });
  expect(await save(page)).toEqual(before);
  await panel(page)
    .getByRole('button', { name: 'Confirmar lançamento' })
    .click();
  await command(page, '');
  await command(page, '');
  const done = await save(page);
  expect(done.bars).toHaveLength(1);
  expect(done.bars[0]).toMatchObject({
    origin: { x: 1000, y: 1000 },
    quantity: 22,
    stirrupProfile: {
      shape: 'clamp-s',
      points: [
        { x: 0, y: 0 },
        { x: 400, y: 200 },
      ],
      clamp: { capture: 'static', diameters: [16, 20], orientation: -1 },
    },
  });
  await command(page, 'F');
  await page.screenshot({ path: 'docs/column-clamp-confirmed.png' });
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  expect((await save(page)).bars).toHaveLength(0);
  await page.getByRole('button', { name: 'Refazer', exact: true }).click();
  expect((await save(page)).bars).toEqual(done.bars);
  await page
    .getByRole('button', { name: 'Editar critérios desta posição' })
    .click();
  const existing = page.getByRole('dialog', { name: /Editar critérios de/ });
  await existing.getByLabel('Formato do estribo').selectOption('clamp-c');
  await existing.getByRole('button', { name: 'Aplicar nesta posição' }).click();
  const edited = await save(page);
  expect(edited.bars[0].id).toBe(done.bars[0].id);
  expect(edited.bars[0].quantity).toBe(22);
  expect(edited.bars[0].stirrupProfile.shape).toBe('clamp-c');
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await page.waitForTimeout(750);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect((await save(page)).bars).toEqual(done.bars);
  await command(page, 'F');
  // Reloaded project permits another independent C launch without touching S.
  await page
    .getByRole('button', { name: 'Critérios do estribo', exact: true })
    .first()
    .click();
  const edit = page.getByRole('dialog', {
    name: 'Critérios do estribo',
    exact: true,
  });
  await edit.getByLabel('Formato do estribo').selectOption('clamp-c');
  await edit.getByRole('button', { name: 'Usar critérios e lançar' }).click();
  await command(page, '2000,1000');
  await command(page, '2400,1000');
  await panel(page)
    .getByRole('button', { name: 'Confirmar lançamento' })
    .click();
  expect(
    (await save(page)).bars.map(
      (b: { stirrupProfile: { shape: string } }) => b.stirrupProfile.shape,
    ),
  ).toEqual(['clamp-s', 'clamp-c']);
  expect(errors).toEqual([]);
});

test('Esc em cada etapa S/C e Voltar não deixam peça nem faixa parcial', async ({
  page,
}) => {
  await fresh(page);
  for (const points of [
    [],
    ['0,0'],
    ['0,0', '300,0'],
    ['0,0', '300,0', '0,1000'],
    ['0,0', '300,0', '0,1000', '1000,1000'],
    ['0,0', '300,0', '0,1000', '1000,1000', '0,1200'],
  ]) {
    const before = await save(page);
    await configure(page, 'clamp-c', true);
    for (const p of points) await command(page, p);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    expect(await save(page)).toEqual(before);
  }
  await configure(page, 'clamp-s', false);
  await command(page, '0,0');
  await command(page, '300,0');
  await panel(page).getByRole('button', { name: 'Voltar etapa' }).click();
  await expect(panel(page)).toContainText('segundo centro');
  await command(page, '0,300');
  await panel(page)
    .getByRole('button', { name: 'Confirmar lançamento' })
    .click();
  const done = await save(page);
  expect(done.bars).toHaveLength(1);
  expect(done.bars[0].stirrupProfile.points[1]).toEqual({ x: 0, y: 300 });
});

useCompatibleProjectFolders();

test('janela baixa, decimais e troca de contexto cancelam sem resíduos', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 650 });
  await fresh(page);
  const before = await save(page);
  await configure(page, 'clamp-c');
  await command(page, '0,0');
  await command(page, '300.5,150.25');
  await expect(
    panel(page).getByRole('button', { name: 'Confirmar lançamento' }),
  ).toBeInViewport();
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Novo projeto', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancelar', exact: true })
    .click();
  await expect(panel(page)).toHaveCount(0);
  expect(await save(page)).toEqual(before);
});

for (const captured of [2, 3, 4, 5]) {
  test(`reabrir critérios após ${captured} pontos permite voltar ao modo manual sem faixa residual`, async ({
    page,
  }) => {
    const fixture = emptyProject();
    fixture.cadDefaults = factoryCadDefaults();
    fixture.cadDefaults.armatures.steel = 'CA-50';
    await page.goto('/');
    await expect(page.locator('.busy-overlay')).toHaveCount(0);
    await page.getByTestId('project-input').setInputFiles({
      name: 'grampos.armstruct.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(fixture)),
    });
    await configure(page, 'clamp-c', true);
    for (const p of ['0,0', '300,0', '0,1000', '1000,1000', '0,1200'].slice(
      0,
      captured,
    ))
      await command(page, p);
    await panel(page)
      .getByRole('button', { name: 'Editar bitolas / orientação / centros' })
      .click();
    const d = page.getByRole('dialog', {
      name: 'Critérios do estribo',
      exact: true,
    });
    await d.getByLabel('Aço do estribo', { exact: true }).selectOption('CA-60');
    await d.getByRole('button', { name: 'Distribuição', exact: true }).click();
    await d.getByLabel('Modo de lançamento do estribo').selectOption('section');
    await d.getByLabel('Quantidade da seção').fill('7');
    await d.getByRole('button', { name: 'Usar critérios e lançar' }).click();
    await expect(panel(page)).toContainText('7 peça(s)');
    await expect(panel(page)).not.toContainText('passo efetivo');
    await panel(page)
      .getByRole('button', { name: 'Confirmar lançamento' })
      .click();
    const done = await save(page);
    expect(done.bars).toHaveLength(1);
    expect(done.bars[0]).toMatchObject({
      quantity: 7,
      steel: 'CA-60',
      quantitySource: { kind: 'manual' },
    });
    expect(done.bars[0].distribution).toBeUndefined();
  });
}

test('reabrir critérios muda manual para faixa e troca de família reinicia a captura', async ({
  page,
}) => {
  await fresh(page);
  await configure(page, 'clamp-c', false);
  await command(page, '0,0');
  await command(page, '300,0');
  await panel(page)
    .getByRole('button', { name: 'Editar bitolas / orientação / centros' })
    .click();
  const d = page.getByRole('dialog', {
    name: 'Critérios do estribo',
    exact: true,
  });
  await d.getByRole('button', { name: 'Distribuição', exact: true }).click();
  await d.getByLabel('Modo de lançamento do estribo').selectOption('range');
  await d.getByLabel('Espaçamento solicitado (mm)').fill('100');
  await d.getByRole('button', { name: 'Usar critérios e lançar' }).click();
  await expect(panel(page)).toContainText('início da faixa');
  for (const p of ['0,1000', '1000,1000', '0,1200']) await command(page, p);
  await expect(panel(page)).toContainText('11 peça(s)');
  await panel(page)
    .getByRole('button', { name: 'Editar bitolas / orientação / centros' })
    .click();
  await d.getByLabel('Formato do estribo').selectOption('rectangle');
  await d.getByRole('button', { name: 'Usar critérios e lançar' }).click();
  await expect(panel(page)).toContainText('Posicione a seção');
  await expect(
    panel(page).getByRole('button', { name: 'Confirmar lançamento' }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  expect((await save(page)).bars).toHaveLength(0);
});
