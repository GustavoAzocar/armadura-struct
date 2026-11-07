import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject, newBar, schedule } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import type { Project } from '../../src/domain/types';
async function save(page: Page): Promise<Project> {
  const c = page.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await c.isVisible()) await c.click();
  const e = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await e).path())!, 'utf8'));
}
test('independent insert editing, primary identification, deletion and undo retain physical steel', async ({
  page,
}) => {
  const p = completeOwnership({
    ...emptyProject(),
    bars: [{ ...newBar('N1'), id: 'b', quantity: 8 }],
    details: [
      { id: 'r1', barId: 'b', origin: { x: 0, y: -500 } },
      { id: 'r2', barId: 'b', origin: { x: 2000, y: 0 } },
      { id: 'r3', barId: 'b', origin: { x: 0, y: 1000 } },
    ],
  });
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'representations.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page.locator('.bar-row').click();
  await page
    .getByRole('button', { name: 'Editar inserção 2', exact: true })
    .click();
  for (const [label, value] of [
    ['Rotação da inserção', '90'],
    ['Escala gráfica da inserção', '2'],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press('Tab');
  }
  await page
    .getByLabel('Identificação da inserção', { exact: true })
    .selectOption('primary');
  await page.screenshot({ path: 'docs/representations.png' });
  const q = await save(page);
  expect(q.details[1]).toMatchObject({
    rotation: 90,
    scale: 2,
    identification: 'primary',
  });
  expect(q.details[0].identification).toBe('mark');
  expect(q.bars).toEqual(p.bars);
  expect(schedule(q)[0].quantity).toBe(8);
  await page
    .getByRole('button', { name: 'Excluir somente esta inserção', exact: true })
    .click();
  expect((await save(page)).details).toHaveLength(2);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  expect(await save(page)).toEqual(q);
  await page.getByTestId('project-input').setInputFiles({
    name: 'reopen.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(q)),
  });
  expect(await save(page)).toEqual(q);
});
