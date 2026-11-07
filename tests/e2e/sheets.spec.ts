import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { demoProject } from '../../src/domain/model';
import { groupInDetail } from '../../src/domain/detailEditing';
import { placeDrawing } from '../../src/domain/sheets';

async function save(page: Page) {
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
async function manager(page: Page) {
  await page.getByRole('tab', { name: 'Pranchas', exact: true }).click();
}
async function create(page: Page, name: string) {
  await manager(page);
  await page.getByLabel('Nome da nova folha', { exact: true }).fill(name);
  await page
    .getByRole('button', { name: 'Criar folha vazia', exact: true })
    .click();
  await expect(page.getByTestId('sheet-canvas')).toHaveAttribute(
    'aria-label',
    `Prévia da folha ${name}`,
  );
}
async function field(page: Page, name: string, value: string) {
  const input = page.getByLabel(name, { exact: true });
  await input.fill(value);
  await input.press('Tab');
}
async function settled(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function camera(page: Page, paper = true) {
  await settled(page);
  return page
    .getByTestId(paper ? 'sheet-canvas' : 'cad-canvas')
    .evaluate((svg) => {
      const group = svg.querySelector('g[transform]') as SVGGElement;
      const m = group.transform.baseVal.consolidate()!.matrix,
        box = svg.getBoundingClientRect();
      return {
        x: (box.width / 2 - m.e) / m.a,
        y: (m.f - box.height / 2) / m.a,
        s: m.a,
      };
    });
}
async function navigate(page: Page) {
  const box = (await page.getByTestId('sheet-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.mouse.wheel(0, -200);
  await settled(page);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(
    box.x + box.width * 0.6 + 55,
    box.y + box.height * 0.5 + 28,
  );
  await page.mouse.up({ button: 'middle' });
  await settled(page);
}

test('three sheets persist order, properties and view positions; duplicating and deleting preserve steel', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.bar-row')).toHaveCount(3);
  const before = await save(page);
  await create(page, 'Armação 02');
  await expect(page.getByTestId('sheet-view')).toHaveCount(0);
  await page.getByLabel('Formato da folha', { exact: true }).selectOption('A2');
  await page
    .getByLabel('Orientação da folha', { exact: true })
    .selectOption('portrait');
  await field(page, 'Revisão da folha', 'R02');
  await field(page, 'Notas da folha', 'Montagem superior');
  await page
    .getByLabel('Colocar desenho na folha', { exact: true })
    .selectOption(before.hierarchy.drawings[0].id);
  await field(page, 'Vista X', '42');
  await field(page, 'Vista Y', '31');
  await field(page, 'Largura da vista', '210');
  await field(page, 'Rotação da vista', '15');
  await page
    .getByRole('button', { name: 'Duplicar vista', exact: true })
    .click();
  await expect(page.getByTestId('sheet-view')).toHaveCount(2);
  await field(page, 'Vista Y', '230');
  await field(page, 'Rotação da vista', '0');
  await page
    .getByRole('button', { name: 'Duplicar layout', exact: true })
    .click();
  await expect(page.getByTestId('sheet-canvas')).toHaveAttribute(
    'aria-label',
    'Prévia da folha Armação 02 (cópia)',
  );
  await field(page, 'Nome da folha', 'Armação 03');
  await page
    .getByRole('button', { name: 'Mover folha para cima', exact: true })
    .click();
  let p = await save(page);
  expect(p.sheets.map((s: any) => s.name)).toEqual([
    'Folha 1',
    'Armação 03',
    'Armação 02',
  ]);
  expect(p.sheets[1]).toMatchObject({
    format: 'A2',
    orientation: 'portrait',
    properties: { revision: 'R02', notes: 'Montagem superior' },
  });
  for (const key of ['bars', 'details', 'annotations', 'masks', 'polylines'])
    expect(p[key]).toEqual(before[key]);
  expect(p.hierarchy.drawings).toEqual(before.hierarchy.drawings);
  expect(p.hierarchy.placements).toHaveLength(5);
  expect(new Set(p.hierarchy.placements.map((v: any) => v.id)).size).toBe(5);
  expect(
    new Set(p.hierarchy.placements.map((v: any) => v.drawingId)).size,
  ).toBe(1);
  const copiedViews = p.hierarchy.placements.filter(
    (v: any) => v.sheetId === p.sheets[1].id,
  );
  expect(copiedViews[0]).toMatchObject({
    origin: { x: 42, y: 31 },
    rotation: 15,
    frame: { width: 210 },
  });
  await page
    .getByRole('button', { name: 'Excluir folha', exact: true })
    .click();
  await expect(page.getByTestId('cad-canvas')).toBeVisible();
  const removed = await save(page);
  expect(removed.sheets).toHaveLength(2);
  expect(removed.bars).toEqual(before.bars);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  expect(await save(page)).toEqual(p);
  await page.getByTestId('project-input').setInputFiles({
    name: 'folhas.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  expect(await save(page)).toEqual(p);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect(await save(page)).toEqual(p);
  await manager(page);
  await page
    .getByRole('button', { name: 'Abrir Armação 03', exact: true })
    .click();
  await expect(page.getByTestId('sheet-view')).toHaveCount(2);
  const closeNotice = page.getByRole('button', {
    name: 'Fechar aviso',
    exact: true,
  });
  if (await closeNotice.isVisible()) await closeNotice.click();
  await page.screenshot({ path: 'docs/sheets.png' });
  expect(errors).toEqual([]);
});

test('sheet tabs retain independent zoom, pan and selected views, including closing and reopening a tab', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.bar-row')).toHaveCount(3);
  await manager(page);
  await page
    .getByRole('button', { name: 'Abrir Folha 1', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Duplicar layout', exact: true })
    .click();
  await field(page, 'Nome da folha', 'Folha 2');
  await page
    .getByRole('button', { name: 'Duplicar layout', exact: true })
    .click();
  await field(page, 'Nome da folha', 'Folha 3');
  const snapshots = new Map<string, Awaited<ReturnType<typeof camera>>>();
  for (const name of ['Folha 1', 'Folha 2', 'Folha 3']) {
    await page
      .getByRole('button', { name: `Aba folha ${name}`, exact: true })
      .click();
    await navigate(page);
    if (name !== 'Folha 2')
      await page.getByTestId('sheet-view').first().click();
    snapshots.set(name, await camera(page));
  }
  for (const name of ['Folha 2', 'Folha 1', 'Folha 3']) {
    await page
      .getByRole('button', { name: `Aba folha ${name}`, exact: true })
      .click();
    const restored = await camera(page),
      expected = snapshots.get(name)!;
    expect(Math.abs(restored.x - expected.x) * expected.s).toBeLessThan(0.01);
    expect(Math.abs(restored.y - expected.y) * expected.s).toBeLessThan(0.01);
    expect(restored.s).toBeCloseTo(expected.s, 5);
    await expect(
      page.locator('[data-testid="sheet-view"].selected'),
    ).toHaveCount(name === 'Folha 2' ? 0 : 1);
  }
  await page
    .getByRole('button', { name: 'Fechar aba Folha 3', exact: true })
    .click();
  await manager(page);
  await page
    .getByRole('button', { name: 'Abrir Folha 3', exact: true })
    .click();
  expect((await camera(page)).s).toBeCloseTo(snapshots.get('Folha 3')!.s, 5);
  await expect(page.locator('[data-testid="sheet-view"].selected')).toHaveCount(
    1,
  );
  const before = await save(page);
  const frame = (await page
    .getByTestId('sheet-view')
    .locator('.sheet-view-frame')
    .boundingBox())!;
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    frame.x + frame.width / 2 + 35,
    frame.y + frame.height / 2 - 20,
  );
  await page.mouse.up();
  const moved = await save(page);
  const sheet = moved.sheets.find((s: any) => s.name === 'Folha 3');
  const old = before.hierarchy.placements.find(
      (v: any) => v.sheetId === sheet.id,
    ),
    next = moved.hierarchy.placements.find((v: any) => v.id === old.id);
  expect(next.origin.x).toBeGreaterThan(old.origin.x);
  expect(next.origin.y).toBeGreaterThan(old.origin.y);
  expect(moved.bars).toEqual(before.bars);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  expect(await save(page)).toEqual(before);
});

test('drawing tabs retain pending commands and selection; editing a placed source updates all referenced views', async ({
  page,
}) => {
  let seed = demoProject();
  const a = groupInDetail(
    seed,
    [seed.bars[0].id],
    'Viga A',
    seed.hierarchy.elements[0].id,
  );
  seed = a.project;
  const b = groupInDetail(
    seed,
    [seed.bars[1].id],
    'Viga B',
    seed.hierarchy.elements[0].id,
  );
  seed = b.project;
  const drawA = seed.hierarchy.drawings.find((d) => d.detailId === a.id)!,
    drawB = seed.hierarchy.drawings.find((d) => d.detailId === b.id)!;
  seed = placeDrawing(seed, seed.sheets[0].id, drawA.id).project;
  seed = placeDrawing(seed, seed.sheets[0].id, drawA.id).project;
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'abas.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(seed)),
  });
  await manager(page);
  await page
    .getByRole('button', { name: 'Abrir Folha 1', exact: true })
    .click();
  // Open the source from a placed view, sharing its physical definition.
  await page.getByTestId('sheet-view').nth(1).dblclick();
  await expect(
    page.getByRole('region', { name: 'Edição isolada' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page
    .locator('.bar-row')
    .filter({ has: page.getByText('N1', { exact: true }) })
    .click();
  await field(page, 'Quantidade', '8');
  await field(page, 'Quantidade de criação', '2');
  await command(page, 'B');
  await command(page, '0,1000');
  await expect(page.locator('.command-history')).toContainText('1 ponto(s)');
  const aCamera = await camera(page, false);
  await page
    .locator('.document-strip')
    .getByRole('button', { name: 'Desenho', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Edição isolada' }),
  ).toHaveCount(0);
  await manager(page);
  await page
    .locator('.unplaced-drawings')
    .getByRole('button')
    .filter({ hasText: 'Viga B' })
    .click();
  await field(page, 'Quantidade de criação', '3');
  await command(page, 'B');
  await command(page, '0,2000');
  const tabA = page.getByRole('button', {
    name: 'Aba desenho Viga A · Desenho principal',
    exact: true,
  });
  await tabA.click();
  await expect(page.locator('.command-history')).toContainText('1 ponto(s)');
  await expect(page.getByLabel('Quantidade', { exact: true })).toHaveValue('8');
  expect((await camera(page, false)).s).toBeCloseTo(aCamera.s, 5);
  await command(page, '1000,1000');
  await command(page, '');
  let p = await save(page);
  expect(p.bars).toHaveLength(4);
  expect(p.bars.at(-1).quantity).toBe(2);
  expect(p.hierarchy.objectDetails[p.bars.at(-1).id]).toBe(a.id);
  expect(p.bars[1]).toEqual(seed.bars[1]);
  await page
    .getByRole('button', { name: 'Concluir edição', exact: true })
    .click();
  await expect(page.getByTestId('sheet-canvas')).toBeVisible();
  await expect(
    page.getByTestId('sheet-view').nth(1).getByText(/8 x Ø/).first(),
  ).toBeVisible();
  await expect(
    page.getByTestId('sheet-view').nth(2).getByText(/8 x Ø/).first(),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Aba desenho Viga B · Desenho principal',
      exact: true,
    })
    .click();
  await expect(page.locator('.command-history')).toContainText('1 ponto(s)');
  await command(page, '1000,2000');
  await command(page, '');
  p = await save(page);
  expect(p.bars).toHaveLength(5);
  expect(p.bars.at(-1).quantity).toBe(3);
  expect(p.hierarchy.objectDetails[p.bars.at(-1).id]).toBe(b.id);
  expect(
    p.hierarchy.drawings.find((d: any) => d.id === drawB.id).detailId,
  ).toBe(b.id);
});
