import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { emptyProject } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import { nativePrimitive, newNativeMask } from '../../src/domain/nativeMasks';
import { maskPoint } from '../../src/cad/import';
import { setLayerState } from '../../src/domain/layerProfiles';
import {
  defaultSnapModes,
  snapModeLabels,
  type SnapMode,
} from '../../src/domain/objectSnaps';
import type { Point, Project } from '../../src/domain/types';

function fixture() {
  const source = {
    ...newNativeMask('Geometria de encaixes'),
    id: 'snaps-native',
    primitives: [
      nativePrimitive(
        {
          kind: 'line',
          points: [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
          ],
          closed: false,
        },
        'horizontal',
      ),
      nativePrimitive(
        {
          kind: 'line',
          points: [
            { x: 500, y: -400 },
            { x: 500, y: 400 },
          ],
          closed: false,
        },
        'vertical',
      ),
      nativePrimitive(
        { kind: 'circle', center: { x: 1500, y: 0 }, radius: 200 },
        'circle',
      ),
      nativePrimitive(
        {
          kind: 'polyline',
          points: [
            { x: 0, y: 1000 },
            { x: 900, y: 1000 },
            { x: 0, y: 1600 },
          ],
          closed: true,
        },
        'triangle',
      ),
      {
        ...nativePrimitive({ kind: 'text', at: { x: 2200, y: 300 } }, 'text'),
        text: 'Âncora real',
        textHeight: 50,
      },
    ],
  };
  const imported = {
    ...newNativeMask('DXF girado'),
    id: 'snaps-imported',
    format: 'DXF' as const,
    origin: { x: 3000, y: 100 },
    rotation: 37,
    scale: 2,
    primitives: [
      {
        layer: 'DESENHO',
        points: [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
        ],
      },
      {
        layer: 'DESENHO',
        points: [
          { x: 500, y: -400 },
          { x: 500, y: 400 },
        ],
      },
    ],
  };
  return completeOwnership({
    ...emptyProject(),
    name: 'Regressão de encaixes',
    masks: [source, imported],
  });
}
async function load(page: Page, project = fixture()) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'encaixes.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  const destination = page.getByRole('region', {
    name: 'Destino do desenho de máscaras',
    exact: true,
  });
  await destination
    .getByLabel('Escolher máscara', { exact: true })
    .selectOption('snaps-native');
  await destination
    .getByRole('button', { name: 'Ativar máscara para desenhar', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Ajustar à tela', exact: true })
    .last()
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
  return JSON.parse(await readFile((await (await event).path())!, 'utf8'));
}
async function modes(page: Page, active: SnapMode[]) {
  await page
    .locator('.status-toggles')
    .getByRole('button', { name: 'Modos de encaixe', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Modos de encaixe',
    exact: true,
  });
  for (const mode of Object.keys(snapModeLabels) as SnapMode[])
    await dialog
      .getByRole('checkbox', { name: snapModeLabels[mode], exact: true })
      .setChecked(active.includes(mode));
  await dialog
    .getByRole('button', { name: 'Aplicar modos', exact: true })
    .click();
}
async function command(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Comando CAD' });
  await input.fill(text);
  await input.press('Enter');
}
async function screen(page: Page, point: Point) {
  const canvas = page.getByTestId('cad-canvas');
  let previous = '',
    stable = 0;
  // A native drawing toolbar resizes the canvas. Two animation frames alone
  // do not guarantee that ResizeObserver's React update has committed in CI.
  // Observe both layout and camera before converting the model coordinate.
  await expect
    .poll(
      async () => {
        const current = await canvas.evaluate((svg) => {
          const rect = svg.getBoundingClientRect();
          return JSON.stringify([
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            svg.querySelector('g[transform]')?.getAttribute('transform'),
          ]);
        });
        stable = current === previous ? stable + 1 : 0;
        previous = current;
        return stable;
      },
      {
        intervals: [50],
        message: 'layout e câmera estáveis antes de converter coordenadas',
      },
    )
    .toBeGreaterThanOrEqual(2);
  return canvas.evaluate((svg, point) => {
    const p = new DOMPoint(point.x, point.y).matrixTransform(
      (svg.querySelector('g[transform]') as SVGGElement).getScreenCTM()!,
    );
    return { x: p.x, y: p.y };
  }, point);
}
async function hover(page: Page, point: Point) {
  const at = await screen(page, point);
  await page.mouse.move(at.x + 2, at.y + 1);
  return { x: at.x + 2, y: at.y + 1 };
}
async function marker(page: Page, mode: SnapMode, point: Point) {
  const mark = page.getByTestId('snap-marker');
  await expect(mark).toHaveAttribute('data-snap-mode', mode);
  expect(Number(await mark.getAttribute('data-x'))).toBeCloseTo(point.x, 5);
  expect(Number(await mark.getAttribute('data-y'))).toBeCloseTo(point.y, 5);
}

test('modos individuais, padrões antigos, F3 e configuração neutra para o projeto', async ({
  page,
}) => {
  await load(page);
  const before = await save(page);
  await page
    .locator('.status-toggles')
    .getByRole('button', { name: 'Modos de encaixe', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Modos de encaixe' });
  for (const mode of Object.keys(defaultSnapModes) as SnapMode[]) {
    const checkbox = dialog.getByRole('checkbox', {
      name: snapModeLabels[mode],
      exact: true,
    });
    if (defaultSnapModes[mode]) await expect(checkbox).toBeChecked();
    else await expect(checkbox).not.toBeChecked();
  }
  await page.screenshot({ path: 'docs/object-snaps-modes.png' });
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await command(page, 'L');
  await hover(page, { x: 0, y: 0 });
  await marker(page, 'endpoint', { x: 0, y: 0 });
  await hover(page, { x: 500, y: 0 });
  await marker(page, 'midpoint', { x: 500, y: 0 });
  await page.keyboard.press('F3');
  await expect(page.getByTestId('snap-marker')).toHaveCount(0);
  await hover(page, { x: 500, y: 0 });
  await expect(page.getByTestId('snap-marker')).toHaveCount(0);
  await page.keyboard.press('F3');
  await hover(page, { x: 500, y: 0 });
  await marker(page, 'midpoint', { x: 500, y: 0 });
  await page.keyboard.press('Escape');
  await modes(page, ['center', 'quadrant']);
  expect(await save(page)).toEqual(before);
});

test('centro, quadrante, centro de área e inserção: marcador e coordenada gravada concordam em dois zooms', async ({
  page,
}) => {
  await load(page);
  const cases: { mode: SnapMode; point: Point }[] = [
    { mode: 'center', point: { x: 1500, y: 0 } },
    { mode: 'quadrant', point: { x: 1700, y: 0 } },
    { mode: 'geometricCenter', point: { x: 300, y: 1200 } },
    { mode: 'insertion', point: { x: 2200, y: 300 } },
  ];
  for (const zoom of [1, 2]) {
    if (zoom === 2)
      await page
        .getByRole('button', { name: 'Aproximar', exact: true })
        .click();
    for (const [i, c] of cases.entries()) {
      await modes(page, [c.mode]);
      await command(page, 'L');
      const at = await hover(page, c.point);
      await marker(page, c.mode, c.point);
      if (zoom === 1 && i === 0)
        await page.screenshot({ path: 'docs/object-snaps-center.png' });
      await page.mouse.click(at.x, at.y);
      const end = await screen(page, {
        x: c.point.x + 170,
        y: c.point.y + 270,
      });
      await page.mouse.move(end.x, end.y);
      const preview = page
        .getByTestId('transform-preview')
        .locator('path')
        .first();
      await expect(preview).toHaveAttribute(
        'd',
        new RegExp(`M\\s*${c.point.x}[ ,]${c.point.y}`),
      );
      await page.mouse.click(end.x, end.y);
      await page.keyboard.press('Escape');
      const saved = await save(page),
        target = saved.masks.find((m) => m.id === 'snaps-native')!;
      const p = maskPoint(target.primitives.at(-1)!.points[0], target);
      expect(p.x).toBeCloseTo(c.point.x, 5);
      expect(p.y).toBeCloseTo(c.point.y, 5);
      await command(page, 'U');
    }
  }
});

test('interseção transformada capturável conserva edição protegida', async ({
  page,
}) => {
  let p = fixture();
  p.layers.push({
    ...p.layers[0],
    id: 'snap-reference',
    name: 'Referência protegida',
  });
  p.masks[1].layerId = 'snap-reference';
  // The mask's layer is capturable but read-only: capturing never unlocks it.
  p = setLayerState(p, 'model', 'snap-reference', {
    capture: true,
    editable: false,
  });
  await load(page, p);
  await modes(page, ['intersection']);
  await command(page, 'L');
  const crossing = maskPoint({ x: 500, y: 0 }, p.masks[1]);
  await hover(page, crossing);
  await marker(page, 'intersection', crossing);
  await page.screenshot({ path: 'docs/object-snaps-transformed.png' });
  await page.keyboard.press('Escape');
  expect((await save(page)).masks[1]).toEqual(p.masks[1]);
});

test('referência sem captura não oferece candidato, sem desbloquear ou alterar a geometria', async ({
  page,
}) => {
  let p = fixture();
  p.layers.push({ ...p.layers[0], id: 'no-capture', name: 'Sem captura' });
  p.masks[1].layerId = 'no-capture';
  p = setLayerState(p, 'model', 'no-capture', { capture: false });
  await load(page, p);
  await modes(page, ['intersection', 'nearest']);
  await command(page, 'L');
  await hover(page, maskPoint({ x: 500, y: 0 }, p.masks[1]));
  await expect(page.getByTestId('snap-marker')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect((await save(page)).masks[1]).toEqual(p.masks[1]);
});

test('ORTO conserva precedência e suprime marcador quando afasta o ponto capturado', async ({
  page,
}) => {
  await load(page);
  await modes(page, ['center']);
  await command(page, 'L');
  await command(page, '800,400');
  await page.getByRole('textbox', { name: 'Comando CAD' }).blur();
  await page.keyboard.press('F8');
  await expect(
    page.locator('.status-toggles button').filter({ hasText: 'ORTO' }),
  ).toHaveClass('active');
  const at = await hover(page, { x: 1500, y: 0 });
  await expect(page.getByTestId('snap-marker')).toHaveCount(0);
  const end = await page
    .getByTestId('transform-preview')
    .locator('path')
    .first()
    .evaluate((el) => {
      const p = (el as SVGPathElement).getPointAtLength(
        (el as SVGPathElement).getTotalLength(),
      );
      return { x: p.x, y: p.y };
    });
  expect(end.x).toBeCloseTo(1500, 4);
  expect(end.y).toBeCloseTo(400, 4);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press('Escape');
  const p = await save(page),
    mask = p.masks.find((m) => m.id === 'snaps-native')!;
  const applied = maskPoint(mask.primitives.at(-1)!.points.at(-1)!, mask);
  expect(applied.x).toBeCloseTo(1500, 4);
  expect(applied.y).toBeCloseTo(400, 4);
});
