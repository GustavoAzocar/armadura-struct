import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { segmentFixture } from '../segmentFixture';
import { geometry, world, add, rotate } from '../../src/domain/geometry';
import { schedule, createScheduleLock } from '../../src/domain/model';
import { setLayerState } from '../../src/domain/layerProfiles';
import type { Project, Point } from '../../src/domain/types';
const panel = (p: Page) =>
  p.getByRole('region', { name: 'Edição dimensional da armadura' });
async function load(page: Page, p: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'as26.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page
    .locator('.bar-row')
    .filter({ has: page.getByText('N1', { exact: true }) })
    .click();
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
async function command(page: Page, value: string) {
  const input = page.getByRole('textbox', { name: 'Comando CAD' });
  await input.fill(value);
  await input.press('Enter');
}
async function screen(page: Page, at: Point) {
  return page.getByTestId('cad-canvas').evaluate(async (svg, at) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const g = svg.querySelector('g[transform]')!;
    const point = new DOMPoint(at.x, at.y).matrixTransform(
      (g as SVGGElement).getScreenCTM()!,
    );
    return { x: point.x, y: point.y };
  }, at);
}
async function history(page: Page, action: 'Desfazer' | 'Refazer') {
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: action, exact: true })
    .click();
}

test('painel dimensional rola em janela menor, mantém ações visíveis e aceita teclado e fundos do CAD', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await load(page, segmentFixture());
  await command(page, 'SEGMENTOS');
  const d = panel(page),
    canvas = (await page.getByTestId('cad-canvas').boundingBox())!;
  const apply = d.getByRole('button', { name: 'Aplicar dimensões' });
  const box = (await apply.boundingBox())!;
  expect(box.y).toBeGreaterThan(canvas.y);
  expect(box.y + box.height).toBeLessThan(canvas.y + canvas.height);
  const scroll = await d
    .locator('.dimensional-fields')
    .evaluate((e) => ({ content: e.scrollHeight, height: e.clientHeight }));
  expect(scroll.content).toBeGreaterThan(scroll.height);
  await d
    .getByLabel('Comprimento do segmento (mm)', { exact: true })
    .fill('1200');
  await d
    .getByLabel('Comprimento do segmento (mm)', { exact: true })
    .press('Enter');
  const before = await save(page);
  expect(geometry(before.bars[0]).length).toBe(1200);
  await command(page, 'ESTENDER');
  await command(page, '+300 mm');
  await expect(d.getByTestId('dimensional-quick-measure')).toBeVisible();
  await expect(d.getByTestId('dimensional-quick-measure')).toContainText(
    '+300,000',
  );
  await page
    .getByRole('button', { name: 'Alternar fundo do desenho', exact: true })
    .click();
  await expect(page.locator('.cad-light')).toBeVisible();
  await expect(d).toBeVisible();
  await page
    .getByRole('button', { name: 'Alternar fundo do desenho', exact: true })
    .click();
  await page.screenshot({ path: 'docs/as26-compact.png' });
  await d.getByRole('button', { name: 'Cancelar dimensões' }).click();
  expect(await save(page)).toEqual(before);
});

test('propriedades editam segmento com prévia, três inserções, RA, uma operação de histórico e persistência', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, segmentFixture());
  const before = await save(page);
  await page
    .locator('.inspector')
    .getByRole('button', { name: 'Comprimentos e ângulos', exact: true })
    .click();
  await panel(page)
    .getByLabel('Comprimento do segmento (mm)', { exact: true })
    .fill('1200');
  await expect(page.getByTestId('transform-preview')).toBeVisible();
  await expect(panel(page).getByTestId('segment-measures')).toContainText(
    '1.200,0',
  );
  expect(await save(page)).toEqual(before);
  await page.screenshot({ path: 'docs/as26-segments.png' });
  await panel(page)
    .getByRole('button', { name: 'Aplicar dimensões', exact: true })
    .click();
  const after = await save(page);
  expect(after.bars[0].points).toEqual([
    { x: 0, y: 0 },
    { x: 1200, y: 0 },
  ]);
  expect(after.details).toEqual(before.details);
  expect(schedule(after)[0].quantity).toBe(6);
  expect(schedule(after)[0].weight).toBeCloseTo(
    schedule(before)[0].weight * 1.2,
    10,
  );
  for (const id of ['rep1', 'rep2', 'rep3'])
    await expect(
      page.locator(`[data-representation-id="${id}"] text`).first(),
    ).toContainText('120,0');
  await history(page, 'Desfazer');
  expect(await save(page)).toEqual(before);
  await history(page, 'Refazer');
  expect(await save(page)).toEqual(after);
  await page.getByTestId('project-input').setInputFiles({
    name: 'reopen.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(after)),
  });
  expect(await save(page)).toEqual(after);
  expect(errors).toEqual([]);
});

test('ESTENDER diferencia +300 mm e FINAL 1300 mm, aceita número simples e ambas as pontas de barra girada', async ({
  page,
}) => {
  const p = segmentFixture();
  p.bars[0].rotation = 37;
  p.bars[0].origin = { x: 221, y: -530 };
  await load(page, p);
  const before = await save(page);
  for (const [value, end] of [
    ['+300 mm', 'end'],
    ['300', 'start'],
    ['FINAL 1300 mm', 'end'],
  ] as const) {
    await command(page, 'ESTENDER');
    await panel(page)
      .getByLabel('Ponta a estender', { exact: true })
      .selectOption(end);
    await command(page, value);
    await expect(
      panel(page).getByRole('button', {
        name: 'Aplicar dimensões',
        exact: true,
      }),
    ).toBeEnabled();
    expect(await save(page)).toEqual(before);
    await command(page, '');
    const after = await save(page);
    expect(geometry(after.bars[0]).length).toBeCloseTo(1300, 9);
    expect(after.bars[0].points).toEqual(
      end === 'start'
        ? [
            { x: -300, y: 0 },
            { x: 1000, y: 0 },
          ]
        : [
            { x: 0, y: 0 },
            { x: 1300, y: 0 },
          ],
    );
    expect(after.bars[0].quantity).toBe(2);
    expect(after.bars[0].multiplier).toBe(3);
    await history(page, 'Desfazer');
    expect(await save(page)).toEqual(before);
  }
});

test('clique fora do eixo projeta a ponta sem dobra, mostra distância e pode ser cancelado ou confirmado', async ({
  page,
}) => {
  const p = segmentFixture();
  p.bars[0].rotation = 37;
  p.bars[0].origin = { x: 221, y: -530 };
  await load(page, p);
  const before = await save(page);
  const snap = page
    .locator('.status-toggles button')
    .filter({ hasText: 'ENCAIXES' });
  if ((await snap.getAttribute('class')) === 'active') await snap.click();
  await command(page, 'ESTENDER');
  // Move this fixture's endpoint out from under the floating property panel.
  const box = (await page.getByTestId('cad-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + 120);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + box.width * 0.6 + 400, box.y + 120, {
    steps: 3,
  });
  await page.mouse.up({ button: 'middle' });
  const target = await screen(
    page,
    add(world(p.bars[0].points[1], p.bars[0]), rotate({ x: 300, y: 200 }, 37)),
  );
  await page.mouse.move(target.x, target.y);
  await expect(panel(page).getByTestId('extension-projection')).toContainText(
    '+300,000',
  );
  await expect(
    panel(page).getByRole('button', { name: 'Aplicar dimensões' }),
  ).toBeDisabled();
  await page.mouse.click(target.x, target.y);
  await expect(
    panel(page).getByRole('button', { name: 'Aplicar dimensões' }),
  ).toBeEnabled();
  await page.screenshot({ path: 'docs/as26-extension.png' });
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(before);
  await command(page, 'ESTENDER');
  await page.mouse.click(target.x, target.y);
  await panel(page).getByRole('button', { name: 'Aplicar dimensões' }).click();
  const q = await save(page);
  expect(q.bars[0].points).toHaveLength(2);
  // SVG screen matrices/input coordinates have finite precision; model math is
  // tested separately at 1e-10 mm. This browser flow allows 0.001 mm.
  expect(Math.abs(q.bars[0].points[1].x - 1300)).toBeLessThan(0.001);
  expect(q.bars[0].points[1].y).toBeCloseTo(0, 7);
  await history(page, 'Desfazer');
  expect(await save(page)).toEqual(before);
});

test('ângulo local, convenção física e ponta fixa são explícitos; inválidos não modificam a barra', async ({
  page,
}) => {
  const p = segmentFixture(true);
  p.bars[0].rotation = 61;
  await load(page, p);
  const before = await save(page);
  await command(page, 'SEGMENTOS');
  const d = panel(page);
  await d
    .getByLabel('Comprimento do segmento (mm)', { exact: true })
    .fill('10');
  await expect(d.getByRole('status')).toContainText('insuficiente');
  await expect(
    d.getByRole('button', { name: 'Aplicar dimensões' }),
  ).toBeDisabled();
  expect(await save(page)).toEqual(before);
  await d
    .getByLabel('Comprimento do segmento (mm)', { exact: true })
    .fill('abc');
  await expect(
    d.getByRole('button', { name: 'Aplicar dimensões' }),
  ).toBeDisabled();
  await d
    .getByLabel('Comprimento do segmento (mm)', { exact: true })
    .fill('1200');
  await d
    .getByLabel('Preservar direção do segmento', { exact: true })
    .uncheck();
  await d
    .getByLabel('Ângulo local do segmento (graus)', { exact: true })
    .fill('37');
  await d
    .getByLabel('Ponta fixa do segmento', { exact: true })
    .selectOption('end');
  await d.getByRole('button', { name: 'Aplicar dimensões' }).click();
  const q = await save(page);
  expect(q.bars[0].rotation).toBe(61);
  expect(q.bars[0].points[1]).toEqual(before.bars[0].points[1]);
  expect(q.bars[0].points[2]).toEqual(before.bars[0].points[2]);
  expect(
    (Math.atan2(
      q.bars[0].points[1].y - q.bars[0].points[0].y,
      q.bars[0].points[1].x - q.bars[0].points[0].x,
    ) *
      180) /
      Math.PI,
  ).toBeCloseTo(37, 8);
  await history(page, 'Desfazer');
  await command(page, 'SEGMENTOS');
  await d.getByLabel('Convenção do comprimento').selectOption('straight');
  await d
    .getByLabel('Comprimento do segmento (mm)', { exact: true })
    .fill('1100');
  await d
    .getByLabel('Estratégia de edição do segmento')
    .selectOption('endpoint');
  await expect(d.getByRole('status')).toContainText('reta física');
  await d.getByLabel('Estratégia de edição do segmento').selectOption('chain');
  await d.getByRole('button', { name: 'Aplicar dimensões' }).click();
  expect((await save(page)).bars[0].points[1].x).toBeCloseTo(1124, 8);
});

test('RA bloqueada, layer protegido, tipo incompatível e CONTINUAR mantêm a política existente', async ({
  page,
}) => {
  let p = segmentFixture();
  p.scheduleLock = createScheduleLock(p);
  await load(page, p);
  await command(page, 'ESTENDER');
  await command(page, '+300');
  await command(page, '');
  expect((await save(page)).scheduleLock).toBeUndefined();
  await history(page, 'Desfazer');
  p = setLayerState(segmentFixture(), 'model', 'layer:ARMADURAS', {
    editable: false,
  });
  await load(page, p);
  const before = await save(page);
  await command(page, 'ESTENDER');
  await command(page, '+300');
  await expect(
    panel(page).getByRole('button', { name: 'Aplicar dimensões' }),
  ).toBeDisabled();
  expect(await save(page)).toEqual(before);
  await page.keyboard.press('Escape');
  p = segmentFixture();
  await load(page, p);
  await command(page, 'CONTINUAR');
  await command(page, '@300<90');
  await command(page, '');
  const q = await save(page);
  expect(q.bars[0].points).toHaveLength(3);
  expect(q.bars[0].points[2]).toEqual({ x: 1000, y: 300 });
  await page
    .getByRole('button', { name: 'Editar inserção 1', exact: true })
    .click();
  await command(page, 'ESTENDER');
  await expect(panel(page)).toHaveCount(0);
  expect((await save(page)).bars).toEqual(q.bars);
});
