import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { completeOwnership } from '../../src/domain/hierarchy';
import { decodeProject } from '../../src/domain/model';
import { zoomFixture } from '../zoomFixture';
async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  );
}
async function metrics(page: Page) {
  return page.getByTestId('cad-canvas').evaluate((svg) => {
    const path = svg.querySelector(
      '[data-bar-id="straight"] > path',
    ) as SVGPathElement;
    const texts = [
      ...svg.querySelectorAll(
        '[data-bar-id] text,[data-representation-id] text,[data-testid="cad-annotation"] text,[data-testid="cad-distribution"] text,[data-mask-id] text',
      ),
    ] as SVGTextElement[];
    const matrix = path.getScreenCTM()!;
    return {
      scale: Math.hypot(matrix.a, matrix.b),
      bar: path.getBoundingClientRect().width,
      texts: texts.map((t) => ({
        value: t.textContent,
        height: t.getBoundingClientRect().height,
        width: t.getBoundingClientRect().width,
        local: Number(t.getAttribute('font-size')),
        em:
          Number(t.getAttribute('font-size')) *
          Math.hypot(t.getScreenCTM()!.a, t.getScreenCTM()!.b),
      })),
    };
  });
}
async function save(page: Page) {
  const x = page.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await x.isVisible()) await x.click();
  const event = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
}
test('zoom dobra geometria e todos os textos de conteúdo, atravessa 10px sem salto e não altera persistência', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'zoom.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(zoomFixture())),
  });
  await expect(page.locator('[data-bar-id="straight"]')).toHaveCount(1);
  const before = await save(page);
  await settle(page);
  await page.evaluate(() => document.fonts.ready);
  const first = await metrics(page);
  expect(first.texts.length).toBeGreaterThan(12);
  const assertRatio = (
    next: Awaited<ReturnType<typeof metrics>>,
    prior: Awaited<ReturnType<typeof metrics>>,
  ) => {
    const ratio = next.scale / prior.scale;
    expect(next.bar / prior.bar).toBeCloseTo(ratio, 5);
    expect(next.texts.map((t) => t.local)).toEqual(
      prior.texts.map((t) => t.local),
    );
    next.texts.forEach((t, i) => {
      expect(t.em / prior.texts[i].em).toBeCloseTo(ratio, 5);
      expect(
        Math.abs(t.height - prior.texts[i].height * ratio),
      ).toBeLessThanOrEqual(1.5);
      expect(
        Math.abs(t.width - prior.texts[i].width * ratio),
      ).toBeLessThanOrEqual(1.5);
    });
  };
  await page.screenshot({ path: 'docs/text-zoom-low.png' });
  const canvas = page.getByTestId('cad-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -Math.log(2) / 0.0015);
  await expect
    .poll(async () => (await metrics(page)).scale / first.scale)
    .toBeCloseTo(2, 3);
  const doubled = await metrics(page);
  assertRatio(doubled, first);
  expect(
    first.texts.some((t, i) => t.em < 10 && doubled.texts[i].em > 10),
  ).toBe(true);
  await page.screenshot({ path: 'docs/text-zoom-high.png' });
  for (const button of [
    'Afastar',
    'Afastar',
    'Afastar',
    'Aproximar',
    'Aproximar',
    'Aproximar',
  ]) {
    const prior = await metrics(page);
    await page.getByRole('button', { name: button, exact: true }).click();
    await settle(page);
    assertRatio(await metrics(page), prior);
  }
  const beforePan = await metrics(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(
    box.x + box.width / 2 + 70,
    box.y + box.height / 2 + 35,
    { steps: 3 },
  );
  await page.mouse.up({ button: 'middle' });
  await settle(page);
  assertRatio(await metrics(page), beforePan);
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page
    .locator('.bar-row')
    .filter({ has: page.getByText('N1', { exact: true }) })
    .click();
  const grip = page.locator('[data-bar-id="straight"] rect').first();
  const gripBefore = await grip.boundingBox();
  await page.getByRole('button', { name: 'Aproximar', exact: true }).click();
  await settle(page);
  expect((await grip.boundingBox())?.width).toBeCloseTo(gripBefore!.width, 4);
  await page
    .getByRole('button', { name: 'Ajustar à tela', exact: true })
    .last()
    .click();
  await settle(page);
  expect((await metrics(page)).texts.map((t) => t.local)).toEqual(
    first.texts.map((t) => t.local),
  );
  expect(await save(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('prancha 1:20, 1:50 e 1:100 preserva texto de papel e sua proporção durante zoom', async ({
  page,
}) => {
  const { placeDrawing, updatePlacement } = await import(
    '../../src/domain/sheets'
  );
  const { alignPlacement } = await import('../../src/domain/paper');
  let p = zoomFixture();
  p = { ...p, bars: [p.bars[0]], details: [], annotations: [], masks: [] };
  for (const [i, scale] of [20, 50, 100].entries()) {
    const placed = placeDrawing(p, p.sheets[0].id, p.hierarchy.drawings[0].id);
    p = alignPlacement(
      updatePlacement(placed.project, placed.id, {
        scale,
        textHeight: 2.5,
        origin: { x: 20 + i * 130, y: 80 },
        frame: { width: 120, height: 80 },
      }),
      placed.id,
    );
  }
  p = decodeProject(JSON.stringify(completeOwnership(p)));
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'papel-zoom.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await page.getByRole('tab', { name: 'Pranchas', exact: true }).click();
  await page
    .getByRole('button', { name: 'Abrir Folha 1', exact: true })
    .click();
  await expect(page.getByTestId('sheet-view')).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
  const metrics = () =>
    page.getByTestId('sheet-view').evaluateAll((views) =>
      views.map((view) => {
        const text = [...view.querySelectorAll('text')].find((t) =>
          t.textContent?.startsWith('N1'),
        )!;
        const path = view.querySelector(
          'path[data-layer="ARMADURAS"]',
        ) as SVGPathElement;
        const c = text.getScreenCTM()!;
        return {
          height: Number(text.getAttribute('font-size')),
          em: Number(text.getAttribute('font-size')) * Math.hypot(c.a, c.b),
          length: path.getTotalLength(),
        };
      }),
    );
  const before = await metrics();
  expect(before.map((v) => v.height)).toEqual([2.5, 2.5, 2.5]);
  expect(before.map((v) => v.length)).toEqual([50, 20, 10]);
  await page.screenshot({ path: 'docs/text-zoom-paper.png' });
  const box = (await page.getByTestId('sheet-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -Math.log(2) / 0.0015);
  await settle(page);
  const after = await metrics();
  for (let i = 0; i < 3; i++) {
    expect(after[i].em / before[i].em).toBeCloseTo(1.15, 3);
    expect(after[i].height).toBe(2.5);
    expect(after[i].length).toBe(before[i].length);
  }
  expect((await save(page)).bars).toEqual(p.bars);
});
