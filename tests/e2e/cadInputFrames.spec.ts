import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject, newBar } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import type { Project } from '../../src/domain/types';

async function open(page: Page) {
  const project = completeOwnership({
    ...emptyProject(),
    bars: [
      {
        ...newBar('N1'),
        id: 'input-frame-bar',
        kind: 'free' as const,
        origin: { x: 0, y: 0 },
        rotation: 0,
        points: [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
          { x: 1000, y: 500 },
        ],
      },
    ],
  });
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'input-frames.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  const snaps = page
    .locator('.status-toggles button')
    .filter({ hasText: 'ENCAIXES' });
  if ((await snaps.getAttribute('class')) === 'active') await snaps.click();
  await page
    .getByRole('button', { name: 'Ajustar à tela', exact: true })
    .last()
    .click();
  const canvas = page.getByTestId('cad-canvas');
  await canvas.evaluate(async (svg) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
    );
    svg.addEventListener('pointerdown', (event) => {
      const e = event as PointerEvent;
      svg.dataset.frameTestDown = JSON.stringify({
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
      });
    });
  });
}
async function save(page: Page): Promise<Project> {
  const download = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
}
async function camera(page: Page) {
  return page.getByTestId('cad-canvas').evaluate((svg) => {
    const m = (
      svg.querySelector('g[transform]') as SVGGElement
    ).getScreenCTM()!;
    return { a: m.a, e: m.e, f: m.f };
  });
}
async function burst(page: Page, button: number, cancel = false) {
  return page.getByTestId('cad-canvas').evaluate(
    (svg, { button, cancel }) => {
      const input = JSON.parse(svg.dataset.frameTestDown!);
      const last = { x: input.x + 97, y: input.y - 31 };
      const expected = new DOMPoint(last.x, last.y).matrixTransform(
        (svg.querySelector('g[transform]') as SVGGElement)
          .getScreenCTM()!
          .inverse(),
      );
      for (let i = 0; i < 40; i++)
        svg.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            pointerId: input.id,
            pointerType: 'mouse',
            buttons: button === 1 ? 4 : 1,
            clientX: input.x + i,
            clientY: input.y + i / 2,
          }),
        );
      if (cancel)
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            bubbles: true,
          }),
        );
      // This release is deliberately not the last move and precedes the next rAF.
      svg.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: input.id,
          pointerType: 'mouse',
          button,
          buttons: 0,
          clientX: last.x,
          clientY: last.y,
        }),
      );
      return { x: expected.x, y: expected.y };
    },
    { button, cancel },
  );
}
test('pan burst commits its final release camera without changing the project', async ({
  page,
}) => {
  await open(page);
  const before = await save(page),
    initial = await camera(page);
  const box = (await page.getByTestId('cad-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'middle' });
  await burst(page, 1);
  await page.mouse.up({ button: 'middle' });
  await expect
    .poll(async () => (await camera(page)).e)
    .toBeCloseTo(initial.e + 97, 5);
  expect((await camera(page)).f).toBeCloseTo(initial.f - 31, 5);
  expect(await save(page)).toEqual(before);
});
for (const cancel of [false, true])
  test(`grip burst ${cancel ? 'cancels without a delayed edit' : 'uses release coordinates and preserves undo/redo'}`, async ({
    page,
  }) => {
    await open(page);
    await page
      .locator('.bar-row')
      .filter({ has: page.getByText('N1', { exact: true }) })
      .click();
    const before = await save(page);
    const grip = page.locator('[data-bar-id="input-frame-bar"] rect').first();
    const box = (await grip.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const point = await burst(page, 0, cancel);
    await page.mouse.up();
    const after = await save(page);
    if (cancel) expect(after).toEqual(before);
    else {
      expect(after.bars[0].points[0].x).toBeCloseTo(point.x, 5);
      expect(after.bars[0].points[0].y).toBeCloseTo(point.y, 5);
      await page
        .locator('.quick-tools')
        .getByRole('button', { name: 'Desfazer', exact: true })
        .click();
      expect(await save(page)).toEqual(before);
      await page
        .locator('.quick-tools')
        .getByRole('button', { name: 'Refazer', exact: true })
        .click();
      expect(await save(page)).toEqual(after);
    }
  });
