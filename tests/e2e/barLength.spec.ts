import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import { newNativeMask, nativePrimitive } from '../../src/domain/nativeMasks';
import { geometry } from '../../src/domain/geometry';
import { BAR_LENGTH_PROMPT } from '../../src/domain/barLengthInput';
import type { Point, Project } from '../../src/domain/types';

const p = (x: number, y: number) => ({ x, y });
const input = (page: Page) =>
  page.getByRole('textbox', { name: 'Comando CAD' });
const rubber = (page: Page) =>
  page.getByTestId('draft-rubber-band').locator('path');
const barTool = (page: Page) =>
  page
    .locator('.ribbon')
    .getByRole('button', { name: 'Barra livre', exact: true });

function fixture(withMask = false) {
  const project = emptyProject();
  project.name = `Barra por comprimento ${project.id.slice(0, 8)}`;
  if (withMask)
    project.masks = [
      {
        ...newNativeMask('Referência de captura'),
        primitives: [
          nativePrimitive({
            kind: 'rectangle',
            points: [p(0, 0), p(4000, 3000)],
            closed: true,
          }),
          nativePrimitive({
            kind: 'line',
            points: [p(1500, 1000), p(2201, 1000)],
            closed: false,
          }),
        ],
      },
    ];
  return completeOwnership(project);
}
async function open(page: Page, project = fixture()) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'barra-comprimento.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.locator('.window-project')).toHaveText(project.name);
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  if (!project.masks.length)
    for (let i = 0; i < 3; i++)
      await page
        .getByRole('button', { name: 'Afastar', exact: true })
        .last()
        .click();
}
async function toggle(page: Page, label: string, enabled: boolean) {
  const button = page
    .locator('.status-toggles button')
    .filter({ hasText: label })
    .first();
  if (((await button.getAttribute('class')) === 'active') !== enabled)
    await button.click();
}
async function command(page: Page, value: string) {
  await input(page).fill(value);
  await input(page).press('Enter');
}
async function screen(page: Page, point: Point) {
  const at = await page.getByTestId('cad-canvas').evaluate((svg, point) => {
    const at = new DOMPoint(point.x, point.y).matrixTransform(
      (svg.querySelector('g[transform]') as SVGGElement).getScreenCTM()!,
    );
    return { x: at.x, y: at.y };
  }, point);
  const canvas = (await page.getByTestId('cad-canvas').boundingBox())!;
  expect(at.x).toBeGreaterThan(canvas.x);
  expect(at.x).toBeLessThan(canvas.x + canvas.width);
  expect(at.y).toBeGreaterThan(canvas.y);
  expect(at.y).toBeLessThan(canvas.y + canvas.height);
  return at;
}
async function move(page: Page, point: Point, click = false) {
  const at = await screen(page, point);
  if (click) await page.mouse.click(at.x, at.y);
  else await page.mouse.move(at.x, at.y);
  await page
    .getByTestId('cad-canvas')
    .evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
}
async function previewPoints(page: Page) {
  const path = await rubber(page).getAttribute('d');
  return [...path!.matchAll(/[ML]([-+\d.e]+),([-+\d.e]+)/gi)].map((m) =>
    p(Number(m[1]), Number(m[2])),
  );
}
async function draft(page: Page) {
  return (await previewPoints(page)).slice(0, -1);
}
async function expectDraft(page: Page, points: Point[]) {
  await expect.poll(async () => (await draft(page)).length).toBe(points.length);
  const actual = await draft(page);
  points.forEach((point, i) => {
    // O SVG arredonda a conversão do clique para pixels. 0,001 mm é menor
    // que a tolerância de 0,01 mm do modelo; distâncias numéricas são exatas.
    expect(Math.abs(actual[i].x - point.x)).toBeLessThan(0.001);
    expect(Math.abs(actual[i].y - point.y)).toBeLessThan(0.001);
  });
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

test('comprimento → clique → comprimento em uma barra, prévia, aço, histórico único e reabertura', async ({
  page,
}) => {
  const project = fixture();
  await open(page, project);
  await toggle(page, 'ENCAIXES', false);
  await toggle(page, 'ORTO', false);
  await page
    .getByLabel('Bitola de criação', { exact: true })
    .selectOption('10');
  await page.getByLabel('Quantidade de criação', { exact: true }).fill('2');
  await barTool(page).click();
  await move(page, p(0, 0), true);
  await move(page, p(500, 0));
  // A digitação começa com o mouse no desenho, sem focar a linha manualmente.
  await page.keyboard.type('1200');
  await expect(input(page)).toBeFocused();
  await expect(input(page)).toHaveValue('1200');
  await page.keyboard.press('Enter');
  await expectDraft(page, [p(0, 0), p(1200, 0)]);
  const first = await draft(page);
  expect(
    Math.hypot(first[1].x - first[0].x, first[1].y - first[0].y),
  ).toBeCloseTo(1200, 8);
  await move(page, p(1200, 800), true);
  await expectDraft(page, [p(0, 0), p(1200, 0), p(1200, 800)]);
  const beforeFinish = await save(page);
  expect(beforeFinish.bars).toHaveLength(0);
  expect(beforeFinish.schema).toBe(project.schema);
  await move(page, p(1500, 1200));
  const preview = await rubber(page).getAttribute('d');
  await page.keyboard.type('1000');
  expect(await rubber(page).getAttribute('d')).toBe(preview);
  await expect(page.locator('.command-history')).toContainText(
    BAR_LENGTH_PROMPT,
  );
  await page.screenshot({ path: 'docs/barra-comprimento-misto.png' });
  await page.keyboard.press('Enter');
  await expectDraft(page, [p(0, 0), p(1200, 0), p(1200, 800), p(1800, 1600)]);
  const mixed = await draft(page);
  expect(
    Math.hypot(mixed[3].x - mixed[2].x, mixed[3].y - mixed[2].y),
  ).toBeCloseTo(1000, 8);
  await expect(page.locator('[data-bar-id]')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-bar-id]')).toHaveCount(1);
  const saved = await save(page);
  const bar = saved.bars[0];
  expect(saved.bars).toHaveLength(1);
  expect(saved.schema).toBe(project.schema);
  expect(bar.points).toHaveLength(4);
  expect(bar.points[3].x).toBeCloseTo(1800, 3);
  expect(bar.points[3].y).toBeCloseTo(1600, 3);
  expect(bar.quantity).toBe(2);
  const expected = 3000 - 80 + 30 * (Math.PI / 2 + Math.atan(3 / 4));
  expect(Math.abs(geometry(bar).length - expected)).toBeLessThan(0.001);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  expect((await save(page)).bars).toHaveLength(0);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Refazer', exact: true })
    .click();
  expect((await save(page)).bars).toEqual(saved.bars);
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const request = indexedDB.open('armadurastruct', 1);
          request.onsuccess = () => resolve(request.result);
        });
        const raw = await new Promise<string | undefined>((resolve) => {
          const request = db
            .transaction('projects')
            .objectStore('projects')
            .get('current');
          request.onsuccess = () => resolve(request.result);
        });
        db.close();
        return raw
          ? JSON.parse(raw).bars.some((b: { id: string }) => b.id === id)
          : false;
      }, bar.id),
    )
    .toBe(true);
  await page.reload();
  await expect(page.locator('[data-bar-id]')).toHaveCount(1);
  expect((await save(page)).bars).toEqual(saved.bars);
});

test('direção ortogonal e oblíqua em dois zooms, sem snap alterar a distância digitada', async ({
  page,
}) => {
  for (const zoom of [1, 1.69]) {
    await open(page, fixture(true));
    await toggle(page, 'ENCAIXES', true);
    await toggle(page, 'ORTO', false);
    if (zoom > 1)
      for (let i = 0; i < 2; i++)
        await page
          .getByRole('button', { name: 'Aproximar', exact: true })
          .last()
          .click();
    await barTool(page).click();
    await move(page, p(1000, 1000), true);
    await move(page, p(1600, 1250));
    // O mouse permanece no mesmo lugar ao ligar ORTO pelo teclado.
    await page.keyboard.press('F8');
    await expect
      .poll(async () => (await previewPoints(page)).at(-1)!.y)
      .toBeCloseTo(1000, 3);
    // ORTO entrega (1600,1000). O destino fica a 1 mm de um encaixe existente.
    await command(page, '1200');
    await expectDraft(page, [p(1000, 1000), p(2200, 1000)]);
    await input(page).blur();
    await page.keyboard.press('F8');
    await expect
      .poll(async () => (await previewPoints(page)).at(-1)!.y)
      .toBeCloseTo(1250, 3);
    await move(page, p(2500, 1400));
    await command(page, '1000');
    await expectDraft(page, [p(1000, 1000), p(2200, 1000), p(2800, 1800)]);
    await command(page, '');
    const bar = (await save(page)).bars[0];
    expect(Math.hypot(bar.points[1].x, bar.points[1].y)).toBeCloseTo(1200, 6);
    expect(
      Math.hypot(
        bar.points[2].x - bar.points[1].x,
        bar.points[2].y - bar.points[1].y,
      ),
    ).toBeCloseTo(1000, 6);
    expect(bar.points[2].x).toBeCloseTo(1800, 3);
    expect(bar.points[2].y).toBeCloseTo(800, 3);
  }
});

test('entrada inválida, ausência de origem/direção e campos de parâmetros preservam o rascunho; Esc cancela', async ({
  page,
}) => {
  await open(page);
  await toggle(page, 'ENCAIXES', false);
  await toggle(page, 'ORTO', false);
  await barTool(page).click();
  await command(page, '1200');
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /ponto inicial da Barra livre/ }),
  ).toBeVisible();
  await move(page, p(0, 0), true);
  await command(page, '1200');
  await expect(
    page.getByRole('status').filter({ hasText: /direção válida/ }),
  ).toBeVisible();
  await expectDraft(page, [p(0, 0)]);
  for (const value of ['0', '-5', '.005', 'NaN', 'Infinity', '1e309', '12mm']) {
    await command(page, value);
    await expectDraft(page, [p(0, 0)]);
  }
  const quantity = page.getByLabel('Quantidade de criação', { exact: true });
  await quantity.fill('2');
  await expect(quantity).toBeFocused();
  await quantity.press('Enter');
  await expect(quantity).toHaveValue('2');
  await expect(input(page)).toHaveValue('');
  await expectDraft(page, [p(0, 0)]);
  await move(page, p(500, 0));
  await command(page, '1200');
  await expectDraft(page, [p(0, 0), p(1200, 0)]);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('draft-rubber-band')).toHaveCount(0);
  expect((await save(page)).bars).toHaveLength(0);
});

test('Enter usa o último movimento antes do frame e conserva coordenadas, polares, aliases e outros comandos', async ({
  page,
}) => {
  await open(page);
  await toggle(page, 'ENCAIXES', false);
  await toggle(page, 'ORTO', false);
  await command(page, 'B');
  for (const value of ['100,200', '@300,0', '@500<90'])
    await command(page, value);
  await move(page, p(1400, 700));
  await input(page).fill('1000');
  await page.getByTestId('cad-canvas').evaluate((svg) => {
    const at = new DOMPoint(700, 1100).matrixTransform(
      (svg.querySelector('g[transform]') as SVGGElement).getScreenCTM()!,
    );
    svg.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: at.x,
        clientY: at.y,
      }),
    );
    // Sem rAF entre o movimento e o Enter.
    document.getElementById('command-input')!.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
      }),
    );
  });
  await expectDraft(page, [
    p(100, 200),
    p(400, 200),
    p(400, 700),
    p(1000, 1500),
  ]);
  await command(page, '');
  const bar = (await save(page)).bars[0];
  expect(bar.points).toHaveLength(4);
  expect(bar.points[3].x).toBeCloseTo(900, 3);
  expect(bar.points[3].y).toBeCloseTo(1300, 3);
  await command(page, 'POLILINHA');
  await command(page, '0,0');
  await command(page, '1200');
  await expect(
    page.getByRole('status').filter({ hasText: /Comando desconhecido/ }),
  ).toBeVisible();
  await expectDraft(page, [p(0, 0)]);
  await command(page, '@1000,0');
  await command(page, '');
  const saved = await save(page);
  expect(saved.bars).toHaveLength(1);
  expect(saved.polylines).toHaveLength(1);
  expect(saved.polylines[0].closed).toBe(false);
});
