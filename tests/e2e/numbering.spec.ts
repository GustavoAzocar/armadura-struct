import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject, newBar, schedule } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import type { Project } from '../../src/domain/types';
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
test('spatial preview, reservations, cancel, undo and reopen preserve geometry and weights', async ({
  page,
}) => {
  const p = completeOwnership({
    ...emptyProject(),
    bars: [
      { ...newBar('N9'), id: 'a', origin: { x: 0, y: 0 } },
      { ...newBar('N8'), id: 'b', origin: { x: 0, y: 1000 } },
      { ...newBar('N7'), id: 'c', origin: { x: 1000, y: 1000 } },
    ],
  });
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'numbering.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  const baseline = await save(page);
  await page.getByRole('button', { name: 'Renumerar', exact: true }).click();
  let d = page.getByRole('dialog', { name: 'Renumerar posições', exact: true });
  await d.getByLabel('Primeiro número', { exact: true }).fill('20');
  await d.getByLabel('Marcas reservadas', { exact: true }).fill('N21');
  await expect(d.locator('tbody tr').first()).toContainText('N20');
  await d.screenshot({ path: 'docs/numbering.png' });
  await d.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(await save(page)).toEqual(baseline);
  await page.getByRole('button', { name: 'Renumerar', exact: true }).click();
  d = page.getByRole('dialog', { name: 'Renumerar posições', exact: true });
  await d.getByLabel('Primeiro número', { exact: true }).fill('20');
  await d.getByLabel('Marcas reservadas', { exact: true }).fill('N21');
  await d
    .getByRole('button', { name: 'Aplicar renumeração', exact: true })
    .click();
  let q = await save(page);
  expect(q.bars.map((b) => b.mark)).toEqual(['N23', 'N22', 'N20']);
  expect(q.bars.map((b) => b.origin)).toEqual(p.bars.map((b) => b.origin));
  expect(schedule(q).reduce((n, r) => n + r.weight, 0)).toBe(
    schedule(p).reduce((n, r) => n + r.weight, 0),
  );
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  expect(await save(page)).toEqual(baseline);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Refazer', exact: true })
    .click();
  q = await save(page);
  await page.getByTestId('project-input').setInputFiles({
    name: 'reopened.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(q)),
  });
  expect(await save(page)).toEqual(q);
});
