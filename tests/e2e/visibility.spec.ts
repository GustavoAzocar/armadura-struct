import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject, newBar, schedule } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import {
  placeDrawing,
  duplicatePlacement,
  updatePlacement,
} from '../../src/domain/sheets';
import { alignPlacement } from '../../src/domain/paper';
import type { Project } from '../../src/domain/types';

function fixture() {
  let p = completeOwnership({
    ...emptyProject(),
    name: 'AS-22 · visibilidade',
    bars: [
      {
        ...newBar('N1'),
        id: 'a',
        points: [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
        ],
        quantity: 8,
      },
      {
        ...newBar('N2'),
        id: 'b',
        origin: { x: 0, y: 700 },
        layerId: 'layer:DESENHO',
      },
      {
        ...newBar('N3'),
        id: 'c',
        origin: { x: 0, y: 1400 },
        layerId: 'layer:DESENHO',
      },
    ],
  });
  const first = placeDrawing(p, p.sheets[0].id, p.hierarchy.drawings[0].id);
  p = alignPlacement(
    updatePlacement(first.project, first.id, {
      scale: 50,
      origin: { x: 20, y: 80 },
      frame: { width: 160, height: 100 },
    }),
    first.id,
  );
  const second = duplicatePlacement(p, first.id);
  return updatePlacement(second.project, second.id, {
    origin: { x: 220, y: 80 },
  });
}
const mass = (p: Project) => schedule(p).reduce((v, r) => v + r.weight, 0);
async function command(page: Page, value: string) {
  const input = page.getByRole('textbox', { name: 'Comando CAD' });
  await input.fill(value);
  await input.press('Enter');
}
async function load(page: Page, p: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'visibility.armstruct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await expect(
    page.getByRole('banner').getByText(p.name, { exact: true }),
  ).toBeVisible();
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
async function select(page: Page, mark: string) {
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page
    .locator('.bar-row')
    .filter({ has: page.getByText(mark, { exact: true }) })
    .click();
}
const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Visibilidade desta vista' });
const v = (p: Project, key = 'model') =>
  p.layerEnvironment?.contexts[key]?.visibility;

test('ocultar, realçar e recuperar seletivamente conserva aço, desfazer/refazer, persistência e proteção dos ocultos', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const p = fixture();
  await load(page, p);
  await select(page, 'N1');
  await command(page, 'OCULTAR');
  await expect(page.locator('[data-bar-id="a"]')).toHaveCount(0);
  const hidden = await save(page);
  expect(v(hidden)?.hiddenIds).toEqual(['a']);
  expect(hidden.bars).toEqual(p.bars);
  expect(mass(hidden)).toBe(mass(p));
  await select(page, 'N1');
  await command(page, 'DEL');
  expect((await save(page)).bars).toEqual(p.bars);
  await command(page, 'MOSTRAROCULTOS');
  await expect(
    dialog(page).getByRole('row').filter({ hasText: 'N1 · armadura' }),
  ).toContainText('Ocultação do objeto');
  await dialog(page)
    .getByRole('button', { name: 'Concluir', exact: true })
    .click();
  await expect(
    page.getByTestId('hidden-object-ghosts').locator('path').first(),
  ).toHaveAttribute('stroke', '#f59e0b');
  await command(page, 'F');
  await page.screenshot({ path: 'docs/object-visibility.png' });
  await page
    .getByRole('button', { name: 'Revisar objetos', exact: true })
    .click();
  await dialog(page)
    .getByRole('button', { name: 'Recuperar N1 · armadura', exact: true })
    .click();
  await dialog(page)
    .getByRole('button', { name: 'Concluir', exact: true })
    .click();
  await expect(page.locator('[data-bar-id="a"]')).toHaveCount(1);
  await command(page, 'U');
  await expect(page.locator('[data-bar-id="a"]')).toHaveCount(0);
  await command(page, 'REDO');
  await expect(page.locator('[data-bar-id="a"]')).toHaveCount(1);
  const recovered = await save(page);
  await load(page, recovered);
  expect(await save(page)).toEqual(recovered);
  expect(errors).toEqual([]);
});

test('sair do isolamento restaura ocultações anteriores e Exibir todos respeita layer desligado', async ({
  page,
}) => {
  const p = fixture();
  await load(page, p);
  await select(page, 'N1');
  await command(page, 'OCULTAR');
  await select(page, 'N2');
  await command(page, 'ISOLAR');
  await expect(page.locator('[data-bar-id="b"]')).toHaveCount(1);
  await expect(page.locator('[data-bar-id="c"]')).toHaveCount(0);
  const isolated = await save(page);
  await load(page, isolated);
  await command(page, 'SAIRISOLAMENTO');
  await expect(page.locator('[data-bar-id="a"]')).toHaveCount(0);
  await expect(page.locator('[data-bar-id="c"]')).toHaveCount(1);
  await command(page, 'LAYERS');
  const layers = page.getByRole('dialog', { name: 'Layers do projeto' });
  await layers.getByLabel('Exibir ARMADURAS', { exact: true }).uncheck();
  await layers.getByRole('button', { name: 'Concluir', exact: true }).click();
  await command(page, 'EXIBIRTODOS');
  await expect(page.locator('[data-bar-id="a"]')).toHaveCount(0);
  await command(page, 'MOSTRAROCULTOS');
  await expect(
    dialog(page).getByRole('row').filter({ hasText: 'N1 · armadura' }),
  ).toContainText('Layer desligado');
  await expect(
    dialog(page).getByRole('button', {
      name: 'Recuperar N1 · armadura',
      exact: true,
    }),
  ).toBeDisabled();
  await dialog(page)
    .getByRole('button', { name: 'Concluir', exact: true })
    .click();
  const q = await save(page);
  expect(v(q)?.hiddenIds).toEqual([]);
  expect(
    q.layerEnvironment?.contexts.model.states['layer:ARMADURAS'].visible,
  ).toBe(false);
  expect(mass(q)).toBe(mass(p));
});

test('cada vista controla seus objetos e o PDF; restaurar impressão e reabrir preservam estado sem reduzir RA', async ({
  page,
}) => {
  const p = fixture();
  await load(page, p);
  await page.getByRole('tab', { name: 'Pranchas', exact: true }).click();
  await page
    .getByRole('button', { name: 'Abrir Folha 1', exact: true })
    .click();
  await page
    .locator('.sheet-view-list > div')
    .first()
    .getByRole('button')
    .first()
    .click();
  await page.getByRole('tab', { name: 'Desenho', exact: true }).click();
  await page
    .getByRole('button', { name: 'Mostrar ocultos', exact: true })
    .click();
  const d = dialog(page);
  await d
    .getByLabel('Somente objetos com ocultação', { exact: true })
    .uncheck();
  await d
    .getByLabel('Selecionar visibilidade N1 · armadura', { exact: true })
    .check();
  await d
    .getByRole('button', { name: 'Ocultar escolhidos', exact: true })
    .click();
  await d.getByRole('button', { name: 'Concluir', exact: true }).click();
  await expect(
    page
      .getByTestId('sheet-view')
      .first()
      .locator('g[pointer-events="none"] > [data-layer="ARMADURAS"]'),
  ).toHaveCount(0);
  await expect(
    page
      .getByTestId('sheet-view')
      .nth(1)
      .locator('g[pointer-events="none"] > [data-layer="ARMADURAS"]'),
  ).not.toHaveCount(0);
  await expect(
    page.getByTestId('hidden-view-ghosts').first().locator('path').first(),
  ).toHaveAttribute('stroke', '#f59e0b');
  await page
    .getByRole('button', { name: 'Revisar objetos', exact: true })
    .click();
  await d
    .getByLabel('Imprimir objetos ocultos desta vista', { exact: true })
    .check();
  await d.getByRole('button', { name: 'Concluir', exact: true }).click();
  const q = await save(page),
    key = `view:${p.hierarchy.placements[0].id}`;
  expect(v(q, key)?.printHidden).toBe(true);
  expect(v(q, key)?.hiddenIds).toEqual(['a']);
  expect(mass(q)).toBe(mass(p));
  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Prancha PDF', exact: true }).click();
  const raw = readFileSync((await (await event).path())!, 'latin1');
  expect(raw).not.toContain('0.96 0.62 0.04');
  expect((raw.match(/N1/g) ?? []).length).toBe(2);
  await page
    .getByRole('button', { name: 'Revisar objetos', exact: true })
    .click();
  await d
    .getByRole('button', { name: 'Restaurar impressão da vista', exact: true })
    .click();
  await d.getByRole('button', { name: 'Concluir', exact: true }).click();
  expect(v(await save(page), key)?.printHidden).toBe(false);
  await load(page, q);
  expect(await save(page)).toEqual(q);
});

test('realce acima do limite gráfico conserva o CAD aberto e permite encerrar o modo', async ({
  page,
}) => {
  const p = fixture();
  p.bars[0] = {
    ...p.bars[0],
    quantity: 2001,
    quantitySource: { kind: 'distribution', mode: 'quantity' },
    distribution: { end: { x: 20000, y: 0 }, render: 'bars' },
  };
  p.layerEnvironment = {
    profiles: [],
    contexts: {
      model: {
        states: {},
        visibility: { hiddenIds: ['a'], showHidden: true, printHidden: false },
      },
    },
  };
  await load(page, p);
  await expect(
    page.getByRole('status').filter({ hasText: 'Realce indisponível' }),
  ).toContainText('2000');
  await expect(page.getByTestId('cad-canvas')).toBeVisible();
  await page
    .getByRole('button', { name: 'Encerrar realce', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Realce indisponível' }),
  ).toHaveCount(0);
  expect((await save(page)).bars[0].quantity).toBe(2001);
});
