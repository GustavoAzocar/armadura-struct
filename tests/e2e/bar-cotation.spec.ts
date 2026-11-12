import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { completeOwnership } from '../../src/domain/hierarchy';
import { setDetailRepetition } from '../../src/domain/detailRepetition';
import { emptyProject, newBar, schedule } from '../../src/domain/model';
import type { Project } from '../../src/domain/types';

async function load(page: Page, project: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'cotagem.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(
    page.locator('.toast').getByText('Projeto aberto.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page.locator('.bar-row').click();
}

async function snapshot(page: Page): Promise<Project> {
  const closeNotice = page.getByRole('button', {
    name: 'Fechar aviso',
    exact: true,
  });
  if (await closeNotice.isVisible()) await closeNotice.click();
  const download = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
}

test('cotagem e memória operam sobre uma armadura e suas inserções', async ({
  page,
}) => {
  const project = completeOwnership({
    ...emptyProject(),
    bars: [
      {
        ...newBar('N1'),
        id: 'b',
        diameter: 10,
        mandrel: 50,
        points: [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
          { x: 1000, y: 500 },
        ],
        quantity: 3,
        multiplier: 2,
      },
    ],
    details: [
      {
        id: 'r1',
        barId: 'b',
        origin: { x: 1500, y: 0 },
        rotation: 35,
        scale: 1.5,
      },
      { id: 'r2', barId: 'b', origin: { x: 0, y: 900 } },
    ],
  });
  const p = setDetailRepetition(project, project.hierarchy.details[0].id, {
    factor: 4,
    elements: [],
  });
  await load(page, p);
  await page
    .getByRole('button', {
      name: 'Editar detalhamento isoladamente',
      exact: true,
    })
    .click();
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page.locator('.bar-row').click();
  const inspector = page.locator('.inspector');
  const convention = inspector.getByLabel('Convenção de cotagem');
  const memory = inspector.getByText('Memória de corte', { exact: true });
  const undo = page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true });
  const redo = page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Refazer', exact: true });
  const svgText = (label: string) =>
    page.locator('svg text').and(page.getByText(label, { exact: true }));

  await convention.selectOption('external');
  await expect(svgText('100,5 cm (ext.)')).toHaveCount(1);
  await memory.focus();
  await memory.press('Enter');
  await expect(
    inspector.getByRole('img', { name: 'Esquema do eixo físico da armadura' }),
  ).toBeVisible();
  await expect(
    inspector.getByText('Comprimento de corte', { exact: true }),
  ).toBeVisible();
  await memory.press('Enter');
  await expect(
    inspector.getByText('Comprimento de corte', { exact: true }),
  ).toHaveCount(0);
  await undo.click();
  await expect(convention).toHaveValue('');
  await expect(svgText('100,5 cm (ext.)')).toHaveCount(0);
  await redo.click();
  await expect(convention).toHaveValue('external');
  await expect(svgText('100,5 cm (ext.)')).toHaveCount(1);
  await convention.selectOption('');
  await expect(svgText('100,5 cm (ext.)')).toHaveCount(0);

  await inspector
    .getByRole('button', { name: 'Editar inserção 1', exact: true })
    .click();
  await convention.selectOption('external');
  await expect(svgText('100,5 cm (ext.)')).toHaveCount(1);
  await inspector
    .getByRole('button', { name: 'Editar armadura física', exact: true })
    .click();
  await inspector
    .getByRole('button', { name: 'Editar inserção 2', exact: true })
    .click();
  await convention.selectOption('axis');
  await expect(svgText('100,0 cm (eixo)')).toHaveCount(1);
  await expect(svgText('100,5 cm (ext.)')).toHaveCount(1);

  const afterCotating = await snapshot(page);
  expect(afterCotating.details.map((d) => d.dimensionConvention)).toEqual([
    'external',
    'axis',
  ]);
  expect(afterCotating.bars[0].dimensionConvention).toBeUndefined();
  expect(schedule(afterCotating)).toEqual(schedule(p));
  expect(schedule(afterCotating)[0].quantity).toBe(24);

  await inspector
    .getByRole('button', { name: 'Editar armadura física', exact: true })
    .click();
  await inspector.getByLabel('Bitola (mm)', { exact: true }).selectOption('20');
  await expect(svgText('101,0 cm (ext.)')).toHaveCount(1);
  await expect(svgText('100,0 cm (eixo)')).toHaveCount(1);
});

test('forma fora da convenção externa mantém cotas pelo eixo e informa o motivo', async ({
  page,
}) => {
  const p = completeOwnership({
    ...emptyProject(),
    bars: [
      {
        ...newBar('N1'),
        id: 'b',
        points: [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
          { x: 1600, y: 400 },
        ],
      },
    ],
  });
  await load(page, p);
  const inspector = page.locator('.inspector');
  await inspector.getByLabel('Convenção de cotagem').selectOption('external');
  await expect(
    inspector.getByText('Cota externa indisponível para esta forma.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .locator('svg text')
      .and(page.getByText('100,0 cm (eixo)', { exact: true })),
  ).toHaveCount(1);
});

test('salvar, reabrir e recuperar conserva a cotagem escolhida em cada objeto', async ({
  page,
}) => {
  const project = completeOwnership({
    ...emptyProject(),
    bars: [{ ...newBar('N1'), id: 'b', diameter: 10, mandrel: 50 }],
    details: [{ id: 'r1', barId: 'b', origin: { x: 0, y: 500 } }],
  });
  await load(page, project);
  const inspector = page.locator('.inspector');
  const convention = inspector.getByLabel('Convenção de cotagem');
  await convention.selectOption('external');
  await inspector
    .getByRole('button', { name: 'Editar inserção 1', exact: true })
    .click();
  await convention.selectOption('axis');
  const saved = await snapshot(page);
  expect(saved.bars[0].dimensionConvention).toBe('external');
  expect(saved.details[0].dimensionConvention).toBe('axis');
  expect(saved.details[0].barId).toBe(saved.bars[0].id);

  await page.getByTestId('project-input').setInputFiles({
    name: 'cotagem-salva.armstruct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await expect(
    page.locator('.toast').getByText('Projeto aberto.', { exact: true }),
  ).toBeVisible();
  expect(await snapshot(page)).toEqual(saved);

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const open = indexedDB.open('armadurastruct', 1);
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        try {
          return await new Promise<unknown>((resolve, reject) => {
            const read = db
              .transaction('projects')
              .objectStore('projects')
              .get('current');
            read.onsuccess = () =>
              resolve(read.result ? JSON.parse(read.result) : null);
            read.onerror = () => reject(read.error);
          });
        } finally {
          db.close();
        }
      }),
    )
    .toEqual(saved);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect(await snapshot(page)).toEqual(saved);
  await expect(
    page
      .locator('svg text')
      .and(page.getByText('100,0 cm (ext.)', { exact: true })),
  ).toHaveCount(1);
  await expect(
    page
      .locator('svg text')
      .and(page.getByText('100,0 cm (eixo)', { exact: true })),
  ).toHaveCount(1);
});
