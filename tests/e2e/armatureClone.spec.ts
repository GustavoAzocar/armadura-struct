import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createCloneSource } from '../../docs/examples/armature-clone';
import { completeOwnership } from '../../src/domain/hierarchy';
import { newBar, schedule } from '../../src/domain/model';
import type { Project } from '../../src/domain/types';
async function command(page: Page, value: string) {
  const i = page.getByRole('textbox', { name: 'Comando CAD' });
  await i.fill(value);
  await i.press('Enter');
}
async function save(page: Page): Promise<Project> {
  const close = page.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await close.isVisible()) await close.click();
  const e = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await e).path())!, 'utf8'));
}
async function load(page: Page, p: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'clone.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
}
async function select(page: Page, mark = 'N1') {
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page
    .locator('.bar-row')
    .filter({ has: page.getByText(mark, { exact: true }) })
    .click();
}
async function undo(page: Page, name = 'Desfazer') {
  await page
    .locator('.quick-tools')
    .getByRole('button', { name, exact: true })
    .click();
}
const mass = (p: Project) => schedule(p).reduce((s, r) => s + r.weight, 0);
test('Copiar includes every owned dependency, one undo removes the graph, and save/reopen retains independent links', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const p = createCloneSource();
  await load(page, p);
  const baseline = await save(page);
  await select(page);
  for (const v of ['C', '0,0', '3000,0']) await command(page, v);
  const q = await save(page);
  expect(q.bars).toHaveLength(2);
  expect(q.details).toHaveLength(4);
  expect(q.annotations).toHaveLength(2);
  expect(q.polylines).toHaveLength(2);
  expect(mass(q)).toBeCloseTo(2 * mass(p), 10);
  const id = q.bars[1].id;
  expect(q.details.slice(2).map((r) => r.barId)).toEqual([id, id]);
  expect(q.annotations[1].barId).toBe(id);
  expect(q.polylines[1].barIds).toEqual([id]);
  await undo(page);
  expect(await save(page)).toEqual(baseline);
  await undo(page, 'Refazer');
  expect(await save(page)).toEqual(q);
  await load(page, q);
  expect(await save(page)).toEqual(q);
  await select(page, 'N2');
  await page.getByLabel('Bitola (mm)', { exact: true }).selectOption('12.5');
  await expect(page.locator('.bar-row.selected')).toContainText('Ø12,5');
  const edited = await save(page);
  expect(edited.bars[0]).toEqual(p.bars[0]);
  expect(edited.bars[1].diameter).toBe(12.5);
  expect(edited.details).toEqual(q.details);
  expect(errors).toEqual([]);
});
test('shared auxiliaries require a choice, preview counts the connected physical set and cancellation is unchanged', async ({
  page,
}) => {
  const base = createCloneSource();
  const p = completeOwnership({
    ...base,
    bars: [
      ...base.bars,
      { ...newBar('N2'), id: 'other', origin: { x: 5000, y: 0 } },
    ],
    polylines: [{ ...base.polylines[0], barIds: ['original', 'other'] }],
  });
  await load(page, p);
  const baseline = await save(page);
  await select(page);
  for (const v of ['C', '0,0', '3000,0']) await command(page, v);
  const modal = page.getByRole('dialog', {
    name: 'Duplicar armadura completa',
  });
  await expect(modal).toBeVisible();
  await expect(
    modal.getByRole('button', { name: 'Duplicar conjunto', exact: true }),
  ).toBeDisabled();
  await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(await save(page)).toEqual(baseline);
  await select(page);
  await command(page, 'DUPLICAR');
  await modal
    .getByLabel('Tratamento dos vínculos compartilhados', { exact: true })
    .selectOption('clone-set');
  await expect(
    modal.getByLabel('Prévia da duplicação', { exact: true }),
  ).toContainText('2 nova(s) armadura(s) física(s)');
  await page.screenshot({ path: 'docs/armature-clone.png' });
  await modal
    .getByRole('button', { name: 'Duplicar conjunto', exact: true })
    .click();
  const q = await save(page);
  expect(q.bars).toHaveLength(4);
  expect(mass(q)).toBeCloseTo(2 * mass(p), 10);
  expect(q.polylines[1].barIds).toEqual(q.bars.slice(2).map((b) => b.id));
  await undo(page);
  expect(await save(page)).toEqual(baseline);
  await select(page);
  await command(page, 'DUPLICAR');
  await modal
    .getByLabel('Tratamento dos vínculos compartilhados', { exact: true })
    .selectOption('keep');
  await modal
    .getByRole('button', { name: 'Duplicar conjunto', exact: true })
    .click();
  const keep = await save(page);
  expect(keep.bars).toHaveLength(3);
  expect(keep.polylines[1].barIds).toEqual([keep.bars[2].id, 'other']);
});
test('auxiliary links can be assigned in the inspector and equivalent copy consolidates fabrication without losing occurrences', async ({
  page,
}) => {
  const p = createCloneSource();
  delete p.polylines[0].barIds;
  await load(page, p);
  await expect(
    page.getByRole('banner').getByText(p.name, { exact: true }),
  ).toBeVisible();
  await command(page, 'F');
  const at = await page.getByTestId('cad-canvas').evaluate(async (svg) => {
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
    const g = svg.querySelector('g[transform]') as SVGGElement;
    const p = new DOMPoint(600, 150).matrixTransform(g.getScreenCTM()!);
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(at.x, at.y);
  await page
    .getByLabel('Armaduras da geometria auxiliar', { exact: true })
    .selectOption(['original']);
  expect((await save(page)).polylines[0].barIds).toEqual(['original']);
  await select(page);
  await page.getByRole('tab', { name: 'Elementos', exact: true }).click();
  await page
    .getByRole('button', { name: 'Duplicar completa', exact: true })
    .click();
  const modal = page.getByRole('dialog', {
    name: 'Duplicar armadura completa',
  });
  await modal
    .getByLabel('Posição de fabricação da cópia', { exact: true })
    .selectOption('equivalent');
  await modal
    .getByRole('button', { name: 'Duplicar conjunto', exact: true })
    .click();
  const q = await save(page);
  expect(q.bars).toHaveLength(2);
  expect(schedule(q)).toHaveLength(1);
  expect(schedule(q)[0].quantity).toBe(16);
  expect(q.bars.map((b) => b.mark)).toEqual(['N1', 'N1']);
});
