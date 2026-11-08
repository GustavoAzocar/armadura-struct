import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject } from '../../src/domain/model';
async function command(page: Page, s: string) {
  const box = page.getByRole('textbox', { name: 'Comando CAD' });
  await box.fill(s);
  await box.press('Enter');
}
async function save(page: Page) {
  const event = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
}
async function load(page: Page) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'vazio.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(emptyProject())),
  });
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
}
test('CAD nativo cria quatro famílias sem aço, edita entidade, persiste, desfaz e exporta', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page);
  await page
    .getByRole('button', { name: 'Controle de máscaras', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Controle de máscaras',
    exact: true,
  });
  await dialog
    .getByRole('button', { name: 'Criar máscara nativa', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Concluir controle de máscaras' })
    .click();
  for (const [name, coords] of [
    ['Linha', ['0,0', '1000,0']],
    ['Retângulo', ['0,1000', '1000,1500']],
    ['Círculo', ['2000,1000', '2250,1000']],
    ['Polilinha', ['0,2000', '1000,2000', '1000,2500', '']],
  ] as const) {
    await page.getByRole('button', { name, exact: true }).click();
    for (const c of coords) await command(page, c);
    await page.keyboard.press('Escape');
  }
  let p = await save(page);
  expect(p.bars).toEqual([]);
  expect(p.polylines).toEqual([]);
  expect(p.masks).toHaveLength(1);
  expect(p.masks[0].primitives).toHaveLength(4);
  expect(p.masks[0].primitives[2].native.radius).toBeCloseTo(250, 8);
  await page
    .getByRole('button', { name: 'Controle de máscaras', exact: true })
    .click();
  await dialog
    .getByLabel('Entidade da máscara')
    .selectOption(p.masks[0].primitives[2].id);
  await dialog.getByLabel('Raio da entidade').fill('300');
  await dialog.getByRole('button', { name: 'Aplicar geometria' }).click();
  await dialog
    .getByRole('button', { name: 'Concluir controle de máscaras' })
    .click();
  p = await save(page);
  expect(p.masks[0].primitives[2].native.radius).toBe(300);
  await command(page, 'U');
  expect((await save(page)).masks[0].primitives[2].native.radius).toBeCloseTo(
    250,
    8,
  );
  await command(page, 'REDO');
  await page.getByTestId('project-input').setInputFiles({
    name: 'nativo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  expect((await save(page)).masks).toEqual(p.masks);
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  await page.screenshot({ path: 'docs/native-masks.png' });
  for (const tab of ['Desenho', 'Armaduras']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await page.screenshot({
      path: `docs/native-masks-${tab === 'Desenho' ? 'drawing' : 'rebar'}.png`,
    });
    if (tab === 'Desenho') {
      await expect(
        page.getByRole('button', { name: 'Barra livre', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Cota ortogonal', exact: true }),
      ).toBeVisible();
    } else
      await expect(
        page.getByRole('button', { name: 'Estribo', exact: true }),
      ).toBeVisible();
  }
  expect(errors).toEqual([]);
});
test('abrir controle/cancelar e desenho parcial não criam registros; funciona em Foco e janela menor', async ({
  page,
}) => {
  await load(page);
  const before = await save(page);
  await page.keyboard.press('Control+0');
  await command(page, 'MASCARAS');
  await page.keyboard.press('Escape');
  expect((await save(page)).masks).toEqual(before.masks);
  await page.keyboard.press('Control+0');
  await page.setViewportSize({ width: 700, height: 650 });
  await page.getByRole('button', { name: 'Linha', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Controle de máscaras', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  expect((await save(page)).masks).toEqual([]);
});

test('duas máscaras nativas, DXF e aço permanecem independentes durante cópia e exclusão de entidade', async ({
  page,
}) => {
  const { newNativeMask, nativePrimitive } = await import(
    '../../src/domain/nativeMasks'
  );
  const { newBar } = await import('../../src/domain/model');
  const { completeOwnership } = await import('../../src/domain/hierarchy');
  const { parseDxf, maskPrimitives } = await import('../../src/cad/import');
  const a = {
    ...newNativeMask('Fôrma A'),
    scale: 2,
    rotation: 37,
    origin: { x: 800, y: -300 },
    primitives: [
      nativePrimitive({
        kind: 'line',
        points: [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
        ],
        closed: false,
      }),
    ],
  };
  const b = {
    ...newNativeMask('Fôrma B'),
    primitives: [
      nativePrimitive({
        kind: 'circle',
        center: { x: 3000, y: 2000 },
        radius: 250,
      }),
    ],
  };
  const imported = parseDxf(
    readFileSync('tests/fixtures/openstruct-assisted.dxf', 'utf8'),
    'Referência.dxf',
  );
  const seed = completeOwnership({
    ...emptyProject(),
    bars: [{ ...newBar('N1'), quantity: 3 }],
    masks: [a, b, imported],
  });
  await load(page);
  await page
    .getByTestId('project-input')
    .setInputFiles({
      name: 'misto.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(seed)),
    });
  const before = await save(page);
  await page
    .getByRole('button', { name: 'Controle de máscaras', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Controle de máscaras',
    exact: true,
  });
  await dialog.getByLabel('Máscara no detalhamento').selectOption(a.id);
  await dialog
    .getByLabel('Entidade da máscara')
    .selectOption(a.primitives[0].id!);
  await dialog.getByLabel('Deslocamento X').fill('100');
  await dialog.getByLabel('Deslocamento Y').fill('50');
  await dialog.getByLabel('Ângulo em graus').fill('37');
  await dialog
    .getByRole('button', { name: 'Copiar entidade', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Excluir entidade', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Concluir controle de máscaras' })
    .click();
  const after = await save(page);
  expect(after.bars).toEqual(before.bars);
  expect(after.masks.slice(1)).toEqual(before.masks.slice(1));
  expect(after.masks[0].primitives).toHaveLength(1);
  expect(after.masks[0].primitives[0].id).not.toBe(a.primitives[0].id);
  const points = maskPrimitives(after.masks[0])[0].points;
  expect(
    Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
  ).toBeCloseTo(2000, 8);
  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Desenho DXF', exact: true }).click();
  const dxf = parseDxf(
    readFileSync((await (await download).path())!, 'utf8'),
    'Saída.dxf',
  );
  expect(
    dxf.primitives.some(
      (p) =>
        p.points.length === 2 &&
        Math.abs(
          Math.hypot(
            p.points[1].x - p.points[0].x,
            p.points[1].y - p.points[0].y,
          ) - 2000,
        ) < 0.001,
    ),
  ).toBe(true);
});
