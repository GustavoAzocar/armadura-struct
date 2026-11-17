import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { completeOwnership } from '../../src/domain/hierarchy';
import { emptyProject, newBar, schedule } from '../../src/domain/model';
import type { Point, Project } from '../../src/domain/types';
import { waitForCadViewport } from './cadViewport.helpers';

function fixture() {
  return completeOwnership({
    ...emptyProject(),
    name: 'Armaduras para colar',
    bars: [
      { ...newBar('N1'), id: 'first', origin: { x: 0, y: 0 } },
      { ...newBar('N2'), id: 'second', origin: { x: 600, y: 1000 } },
    ],
  });
}

const canvas = (page: Page) => page.getByTestId('cad-canvas');
const preview = (page: Page) => page.getByTestId('transform-preview');
async function open(page: Page, project: Project) {
  await page.getByTestId('project-input').setInputFiles({
    name: 'clipboard.armstruct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.locator('.window-project')).toHaveText(project.name);
  await waitForCadViewport(page);
}

async function screenPoint(page: Page, point: Point) {
  return await canvas(page).evaluate((svg, point) => {
    const transform = svg.querySelector<SVGGElement>('g[transform]')!;
    const screen = new DOMPoint(point.x, point.y).matrixTransform(
      transform.getScreenCTM()!,
    );
    return { x: screen.x, y: screen.y };
  }, point);
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

const mass = (project: Project) =>
  schedule(project).reduce((total, row) => total + row.weight, 0);

test('Ctrl+C guarda o lote e Ctrl+V coloca cópias repetidas com uma única operação por clique', async ({
  page,
}) => {
  const project = fixture();
  await page.goto('/');
  await open(page, project);
  const initial = await screenPoint(page, { x: 450, y: 0 });
  await page.mouse.click(initial.x, initial.y);
  const second = await screenPoint(page, { x: 1050, y: 1000 });
  await page.keyboard.down('Shift');
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up('Shift');
  await expect(canvas(page)).toBeFocused();
  await page.keyboard.press('Control+c');
  await expect(preview(page)).toHaveCount(0);
  await expect(canvas(page).locator('[data-bar-id]')).toHaveCount(2);

  await page.keyboard.press('Control+v');
  await expect(preview(page)).toBeVisible();
  const firstTarget = await screenPoint(page, { x: 250, y: 500 });
  await page.mouse.move(firstTarget.x, firstTarget.y);
  await expect(preview(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview(page)).toHaveCount(0);
  await expect(canvas(page).locator('[data-bar-id]')).toHaveCount(2);

  await page.keyboard.press('Control+v');
  await page.mouse.move(firstTarget.x, firstTarget.y);
  await expect(preview(page)).toBeVisible();
  await page.mouse.click(firstTarget.x, firstTarget.y);
  await expect(canvas(page).locator('[data-bar-id]')).toHaveCount(4);

  await page.keyboard.press('Control+v');
  const nextTarget = await screenPoint(page, { x: 1100, y: 400 });
  await page.mouse.move(nextTarget.x, nextTarget.y);
  await expect(preview(page)).toBeVisible();
  await page.mouse.click(nextTarget.x, nextTarget.y);
  await expect(canvas(page).locator('[data-bar-id]')).toHaveCount(6);

  const placed = await save(page);
  expect(placed.bars.slice(0, 2)).toEqual(project.bars);
  expect(new Set(placed.bars.map((bar) => bar.id)).size).toBe(6);
  for (const index of [2, 4]) {
    const reference = placed.bars[index];
    const other = placed.bars[index + 1];
    expect(other.origin.x - reference.origin.x).toBeCloseTo(600, 7);
    expect(other.origin.y - reference.origin.y).toBeCloseTo(1000, 7);
  }
  expect(mass(placed)).toBeCloseTo(3 * mass(project), 7);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  expect((await save(page)).bars).toEqual(placed.bars.slice(0, 4));
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Refazer', exact: true })
    .click();
  expect((await save(page)).bars).toEqual(placed.bars);
});

test('campos mantêm Ctrl+C/Ctrl+V de texto e reabrir o projeto descarta o clipboard de armaduras', async ({
  browserName,
  context,
  page,
}) => {
  test.skip(
    browserName !== 'chromium',
    'A permissão de clipboard usa Chromium.',
  );
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const project = fixture();
  await page.goto('/');
  await open(page, project);
  const at = await screenPoint(page, { x: 450, y: 0 });
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press('Control+c');
  const field = page.getByRole('textbox', { name: 'Comando CAD' });
  await field.fill('texto-copiado');
  await field.press('Control+a');
  await field.press('Control+c');
  await field.fill('');
  await field.press('Control+v');
  await expect(field).toHaveValue('texto-copiado');
  await expect(preview(page)).toHaveCount(0);
  await expect(canvas(page).locator('[data-bar-id]')).toHaveCount(2);

  await open(page, { ...project, name: 'Outra sessão do mesmo projeto' });
  const reopened = await screenPoint(page, { x: 450, y: 0 });
  await page.mouse.click(reopened.x, reopened.y);
  await page.keyboard.press('Control+v');
  const target = await screenPoint(page, { x: 250, y: 500 });
  await page.mouse.move(target.x, target.y);
  await expect(preview(page)).toHaveCount(0);
  await page.mouse.click(target.x, target.y);
  await expect(canvas(page).locator('[data-bar-id]')).toHaveCount(2);
});

test('colar por distância devolve o foco ao desenho e permite colar outra vez', async ({
  page,
}) => {
  const project = fixture();
  await page.goto('/');
  await open(page, project);
  const ortho = page
    .locator('.status-toggles button')
    .filter({ hasText: 'ORTO' });
  if ((await ortho.getAttribute('class')) !== 'active') await ortho.click();
  const at = await screenPoint(page, { x: 450, y: 0 });
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press('Control+c');

  for (const [direction, length, copies] of [
    [{ x: 450, y: 100 }, '1200', 1],
    [{ x: 100, y: 700 }, '800', 2],
  ] as const) {
    await page.keyboard.press('Control+v');
    await expect(preview(page)).toBeVisible();
    const target = await screenPoint(page, direction);
    await page.mouse.move(target.x, target.y);
    await page.keyboard.type(length);
    const field = page.getByRole('textbox', { name: 'Comando CAD' });
    await expect(field).toHaveValue(length);
    await field.press('Enter');
    await expect(preview(page)).toHaveCount(0);
    await expect(canvas(page)).toBeFocused();
    await expect(canvas(page).locator('[data-bar-id]')).toHaveCount(2 + copies);
  }

  const placed = await save(page);
  expect(placed.bars.slice(0, 2)).toEqual(project.bars);
  expect(placed.bars.slice(2).map((bar) => bar.origin)).toEqual([
    { x: 1200, y: 0 },
    { x: 0, y: 800 },
  ]);
});

test('o desenho focado ainda aceita pan temporário com Espaço', async ({
  page,
}) => {
  await page.goto('/');
  await open(page, fixture());
  const point = { x: 450, y: 0 };
  const before = await screenPoint(page, point);
  await page.mouse.click(before.x, before.y);
  await expect(canvas(page)).toBeFocused();
  await page.keyboard.down('Space');
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.mouse.move(before.x + 75, before.y - 50, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect
    .poll(async () => (await screenPoint(page, point)).x - before.x)
    .toBeGreaterThan(70);
});
