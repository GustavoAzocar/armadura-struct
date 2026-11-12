import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject, newBar } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import { factoryCadDefaults } from '../../src/domain/cadDefaults';
import { defaultStirrupCriteria } from '../../src/domain/stirrupSchema';
import type { Project } from '../../src/domain/types';

const commands = {
  bar: 'Barra livre',
  stirrup: 'Estribo',
  'stirrup-criteria': 'Critérios do estribo',
  repeat: 'Repetir estribo',
  'beam-clamp': 'Grampo de viga',
  'beam-clamp-criteria': 'Critérios do grampo de viga',
  helix: 'Estribo helicoidal',
  'helix-criteria': 'Critérios do helicoidal',
  detail: 'Rebater armadura',
  convert: 'Converter polilinha',
  follow: 'Seguir fôrma',
  'interpret-cad': 'Interpretar CAD em armadura',
  'edit-segment': 'Comprimentos e ângulos',
  'lengthen-bar': 'Estender barra',
  join: 'Emendar poligonais',
  split: 'Dividir barra',
  range: 'Faixa ortogonal',
  'welded-mesh-criteria': 'Critérios de telas',
  'welded-mesh': 'Lançar tela',
  'refresh-schedule': 'Atualizar RA',
  'lock-schedule': 'Bloquear RA',
  schedule: 'Quadro de aço',
  'insert-sheet-schedule': 'Inserir quadro na prancha',
  renumber: 'Renumerar',
};
const ribbon = (page: Page) => page.locator('.ribbon');
async function load(page: Page, p = emptyProject()) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'menu.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
}
async function command(page: Page, text: string) {
  const field = page.getByRole('textbox', { name: 'Comando CAD' });
  await field.fill(text);
  await field.press('Enter');
}
async function save(page: Page): Promise<Project> {
  const event = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
}

test('inventário, ícones, campos e largura: 1920/1366/1000 nos dois fundos', async ({
  page,
}) => {
  await load(page);
  for (const [action, name] of Object.entries(commands)) {
    const button = ribbon(page).getByRole('button', { name, exact: true });
    await expect(button).toHaveAttribute('data-action', action);
    await expect(button).toHaveText('');
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
    expect(box.width).toBeLessThanOrEqual(32);
    await expect(button.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  }
  const icons = await ribbon(page)
    .locator('.ribbon-tool svg')
    .evaluateAll((es) => es.map((e) => e.innerHTML));
  expect(new Set(icons).size).toBe(24);
  const parameters = page.getByRole('group', {
    name: 'Parâmetros das próximas criações',
  });
  await expect(parameters).toContainText(
    'Critérios do estribo já definidos têm precedência.',
  );
  await expect(parameters.locator('input,select')).toHaveCount(4);
  for (const light of [false, true]) {
    if (light)
      await page
        .getByRole('button', { name: 'Alternar fundo do desenho' })
        .click();
    for (const [width, height] of [
      [1920, 1080],
      [1366, 768],
      [1000, 650],
    ]) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(() =>
          page
            .locator('.ribbon-content')
            .evaluate((e) => e.scrollWidth <= e.clientWidth),
        )
        .toBe(true);
      expect(
        (await page.locator('.ribbon-content').boundingBox())!.height,
      ).toBe(79);
      for (const field of await parameters.locator('input,select').all()) {
        await expect(field).toBeInViewport({ ratio: 1 });
        expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(24);
      }
      const labels = await parameters.locator('.field').evaluateAll((es) =>
        es.map((e) => {
          const label = e.querySelector('span')!.getBoundingClientRect(),
            input = e.querySelector('input,select')!.getBoundingClientRect();
          return label.right <= input.left && label.height <= 28;
        }),
      );
      expect(labels.every(Boolean)).toBe(true);
      await ribbon(page).screenshot({
        path: `docs/menu-armaduras/depois-${width}-${light ? 'claro' : 'escuro'}.png`,
      });
    }
  }
});

test('números longos, bitola fora da lista, decimais, Enter/Esc e recolher preservam valores sem CAD acidental', async ({
  page,
}) => {
  const p = emptyProject();
  p.cadDefaults = factoryCadDefaults();
  p.cadDefaults.armatures.diameter = 13.4;
  await load(page, p);
  const before = await save(page);
  const undoWasDisabled = await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .isDisabled();
  const quantity = page.getByLabel('Quantidade de criação', { exact: true }),
    spacing = page.getByLabel('Espaçamento de criação', { exact: true });
  await expect(page.getByLabel('Bitola de criação')).toHaveValue('13.4');
  await quantity.fill('100000');
  await quantity.press('Enter');
  await spacing.fill('123456,75');
  await spacing.press('Enter');
  await expect(spacing).toHaveValue('123456.75');
  const cover = page.getByLabel('Cobrimento padrão de criação');
  await cover.fill('9999,75');
  await cover.press('Tab');
  await expect(cover).toHaveValue('9999.75');
  await quantity.fill('50000');
  await quantity.press('Escape');
  await expect(quantity).toHaveValue('100000');
  await quantity.fill('98765');
  await quantity.evaluate((e) => e.setAttribute('data-retained', 'true'));
  await page.setViewportSize({ width: 1000, height: 650 });
  await expect(quantity).toHaveValue('98765');
  await page
    .getByRole('button', { name: 'Recolher faixa de comandos' })
    .click();
  await expect(ribbon(page)).toHaveClass(/collapsed/);
  await page
    .getByRole('button', { name: 'Expandir faixa de comandos' })
    .click();
  await expect(quantity).toHaveAttribute('data-retained', 'true');
  await expect(quantity).toHaveValue('98765');
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  await expect(quantity).toHaveValue('98765');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await save(page)).toEqual(before);
  expect(
    await page
      .locator('.quick-tools')
      .getByRole('button', { name: 'Desfazer', exact: true })
      .isDisabled(),
  ).toBe(undoWasDisabled);
});

test('janela estreita e interface ampliada: setas, foco, ajuda e acesso a todos os comandos', async ({
  page,
}) => {
  await load(page);
  for (const [width, zoom] of [
    [640, 1],
    [1000, 1.5],
  ]) {
    await page.setViewportSize({ width, height: 650 });
    await page.evaluate((z) => {
      document.documentElement.style.zoom = String(z);
    }, zoom);
    const next = page.getByRole('button', {
      name: 'Próximos comandos de armaduras',
    });
    await expect(next).toBeVisible();
    await next.click();
    await expect
      .poll(() => page.locator('.ribbon-content').evaluate((e) => e.scrollLeft))
      .toBeGreaterThan(0);
    await page
      .getByRole('button', { name: 'Comandos anteriores de armaduras' })
      .click();
    await page.mouse.move(0, 300);
    await page.keyboard.press('Tab');
    for (const name of ['Barra livre', 'Critérios do estribo', 'Renumerar']) {
      const button = ribbon(page).getByRole('button', { name, exact: true });
      await button.focus();
      await expect(button).toBeFocused();
      await expect(button).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('tooltip')).toContainText(name);
      await expect(page.getByRole('tooltip')).toBeInViewport({ ratio: 1 });
    }
    await ribbon(page).screenshot({
      path: `docs/menu-armaduras/depois-${width}-escala-${zoom}.png`,
    });
  }
});

test('setas por teclado rolam sem confirmar a barra em andamento', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 650 });
  await load(page);
  await ribbon(page)
    .getByRole('button', { name: 'Barra livre', exact: true })
    .click();
  await command(page, '0,0');
  await command(page, '1000,0');
  const content = page.locator('.ribbon-content');
  const next = page.getByRole('button', {
    name: 'Próximos comandos de armaduras',
  });
  await next.focus();
  await next.press('Enter');
  await expect
    .poll(() => content.evaluate((e) => e.scrollLeft))
    .toBeGreaterThan(0);
  const scrolled = await content.evaluate((e) => e.scrollLeft);
  expect((await save(page)).bars).toHaveLength(0);
  const previous = page.getByRole('button', {
    name: 'Comandos anteriores de armaduras',
  });
  await previous.focus();
  await previous.press('Enter');
  await expect
    .poll(() => content.evaluate((e) => e.scrollLeft))
    .toBeLessThan(scrolled);
  expect((await save(page)).bars).toHaveLength(0);
  await command(page, '');
  expect((await save(page)).bars).toHaveLength(1);
});

test('botão por teclado devolve Enter ao CAD; barra livre confirma uma vez, desfaz, refaz e reabre', async ({
  page,
}) => {
  await load(page);
  const bar = ribbon(page).getByRole('button', {
    name: 'Barra livre',
    exact: true,
  });
  await bar.focus();
  await bar.press('Enter');
  await expect(bar).not.toBeFocused();
  await expect(bar).toHaveAttribute('aria-pressed', 'true');
  await command(page, '0,0');
  await command(page, '1000,0');
  await command(page, '');
  const done = await save(page);
  expect(done.bars).toHaveLength(1);
  expect(done.bars[0].points).toEqual([
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
  ]);
  await page
    .getByRole('button', { name: 'Desfazer', exact: true })
    .first()
    .click();
  expect((await save(page)).bars).toHaveLength(0);
  await page
    .getByRole('button', { name: 'Refazer', exact: true })
    .first()
    .click();
  expect((await save(page)).bars).toEqual(done.bars);
  await load(page, done);
  expect((await save(page)).bars).toEqual(done.bars);
});

test('critérios de estribo salvos mantêm precedência; RA tem nome dinâmico e seleção mínima', async ({
  page,
}) => {
  const p = emptyProject(),
    c = defaultStirrupCriteria();
  c.distribute = false;
  c.quantity = 7;
  c.diameter = 10;
  c.mandrel = 50;
  p.stirrupDefaults = c;
  await load(page, p);
  const quantity = page.getByLabel('Quantidade de criação', { exact: true });
  await quantity.fill('99');
  await quantity.press('Enter');
  for (const name of [
    'Repetir estribo',
    'Emendar poligonais',
    'Dividir barra',
    'Faixa ortogonal',
  ])
    await expect(
      ribbon(page).getByRole('button', { name, exact: true }),
    ).toBeDisabled();
  await ribbon(page)
    .getByRole('button', { name: 'Estribo', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await command(page, '0,0');
  await page
    .getByRole('button', { name: 'Confirmar lançamento', exact: true })
    .click();
  const done = await save(page);
  expect(done.bars).toHaveLength(1);
  expect(done.bars[0].quantity).toBe(7);
  expect(done.bars[0].diameter).toBe(10);
  const lock = ribbon(page).getByRole('button', {
    name: 'Bloquear RA',
    exact: true,
  });
  await lock.click();
  const unlock = ribbon(page).getByRole('button', {
    name: 'Desbloquear RA',
    exact: true,
  });
  await expect(unlock).toHaveAttribute('aria-pressed', 'true');
  await unlock.click();
  await expect(lock).toBeVisible();
  const two = completeOwnership({
    ...p,
    bars: [
      { ...newBar('N1'), id: 'a' },
      { ...newBar('N2'), id: 'b', origin: { x: 0, y: 500 } },
    ],
  });
  await load(page, two);
  await command(page, 'F');
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page
    .locator('.bar-row')
    .filter({ has: page.getByText('N1', { exact: true }) })
    .click();
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page
    .locator('.bar-row')
    .filter({ has: page.getByText('N2', { exact: true }) })
    .click({ modifiers: ['Shift'] });
  await expect(
    ribbon(page).getByRole('button', {
      name: 'Emendar poligonais',
      exact: true,
    }),
  ).toBeEnabled();
});
