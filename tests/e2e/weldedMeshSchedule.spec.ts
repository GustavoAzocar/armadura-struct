import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { maskManipFixture } from '../fixtures/maskManipulation';
import { nativePrimitive } from '../../src/domain/nativeMasks';
import { defaultWeldedMeshCriteria } from '../../src/domain/weldedMesh';
import {
  buildRegion,
  outlineFromPoints,
} from '../../src/domain/weldedMeshRegion';
import { launchWeldedMesh } from '../../src/domain/weldedMeshLaunch';
import {
  defaultSheetSchedule,
  setSheetSchedule,
} from '../../src/domain/sheetSchedule';
import { placeDrawing } from '../../src/domain/sheets';
import type { Project, Point } from '../../src/domain/types';

const P = (x: number, y: number): Point => ({ x, y });

/** Caso 2 da issue (TS1, Q92, 6.000 × 4.750) na folha, com quadro inserido. */
function fixture(): Project {
  let p = maskManipFixture();
  // Relação de aço em atualização automática (sem fotografia bloqueada).
  delete p.scheduleLock;
  p.masks[0].primitives = [
    nativePrimitive(
      { kind: 'rectangle', points: [P(0, 0), P(6000, 4750)], closed: true },
      'laje',
    ),
  ];
  p.masks[1].primitives = [];
  const o = outlineFromPoints([P(0, 0), P(6000, 0), P(6000, 4750), P(0, 4750)]);
  if (!o.ok) throw new Error(o.reason);
  const r = buildRegion(o.outline);
  if (!r.ok) throw new Error(r.reason);
  p = launchWeldedMesh(
    p,
    {
      criteria: { ...defaultWeldedMeshCriteria(), widthOverlap: 150 },
      region: r.region,
      source: { mode: 'points' },
      exactness: 'exact',
      adjustments: [],
    },
    p.hierarchy.details[0].id,
    'tela-1',
  );
  p = placeDrawing(p, p.sheets[0].id, p.hierarchy.drawings[0].id).project;
  return setSheetSchedule(p, p.sheets[0].id, defaultSheetSchedule());
}
async function open(p: Page) {
  await p.goto('/');
  await expect(p.locator('.busy-overlay')).toHaveCount(0);
  await p.getByTestId('project-input').setInputFiles({
    name: 'telas.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture())),
  });
  await expect(p.locator('.busy-overlay')).toHaveCount(0);
  await expect(p.getByTestId('cad-welded-mesh')).toHaveCount(1);
}
async function save(p: Page): Promise<Project> {
  const close = p.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await close.isVisible()) await close.click();
  const d = p.waitForEvent('download');
  await p
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await d).path())!, 'utf8'));
}
/** CSV com aspas, `;` e CRLF → linhas de células. */
function cells(csv: string) {
  return csv
    .replace(/^﻿/, '')
    .split('\r\n')
    .filter(Boolean)
    .map((l) => l.split(';').map((c) => c.replace(/^"|"$/g, '')));
}

test('árvore, total à parte e página do quadro de aço com as telas', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  const list = page.getByLabel('Telas soldadas', { exact: true });
  await expect(list).toContainText('TS1');
  await expect(list).toContainText('Tela Q92');
  await expect(list).toContainText('2 painéis');
  // Total das telas à parte do total das barras (que não muda).
  await expect(
    page.getByLabel('Telas soldadas no projeto', { exact: true }),
  ).toHaveText('Telas soldadas · 1 tela(s) · 43,51 kg');
  await expect(page.locator('.tree-summary strong')).toHaveText('3,16');

  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  await page
    .locator('.ribbon-content')
    .getByRole('button', { name: 'Quadro de aço', exact: true })
    .click();
  const stats = page.locator('.schedule-stats');
  await expect(stats).toContainText('TELAS SOLDADAS');
  await expect(stats).toContainText('43,51');
  const section = page.getByRole('region', {
    name: 'Quadro de telas soldadas',
  });
  const row = section.locator('tbody tr').first();
  await expect(row).toContainText('TS1');
  await expect(row).toContainText('Q92');
  await expect(row).toContainText('2 (0 recortada(s))');
  await expect(row).toContainText('28,50');
  await expect(row).toContainText('29,40');
  await expect(row).toContainText('43,51');
  await expect(row).toContainText('43,6');
  await expect(
    section.getByRole('table', { name: 'Resumo das telas' }),
  ).toContainText('Total43,51');
  await expect(page.locator('.schedule-notes')).toContainText(
    'Este quadro não aplica perda nas telas',
  );
  // Clicar na linha seleciona a tela.
  await row.click();
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await expect(list.locator('.bar-row')).toHaveClass(/selected/);
  expect(errors).toEqual([]);
});

test('perda das telas no quadro da prancha (0% não é gravado) e no CSV por escopo', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await page.getByRole('tab', { name: 'Pranchas', exact: true }).click();
  await page
    .getByRole('button', { name: 'Abrir Folha 1', exact: true })
    .click();
  await expect(page.getByTestId('sheet-steel-schedule')).toContainText(
    'QUADRO DE TELAS SOLDADAS',
  );
  const loss = page.getByLabel('Perda das telas do quadro', { exact: true });
  await loss.fill('5');
  await loss.press('Enter');
  let q = await save(page);
  expect(q.sheets[0].steelSchedule!.meshLossPercent).toBe(5);
  // O painel de inserção parte da perda do quadro existente.
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  await page
    .locator('.ribbon-content')
    .getByRole('button', { name: 'Inserir quadro na prancha', exact: true })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Inserir quadro na prancha' })
      .getByLabel('Perda das telas', { exact: true }),
  ).toHaveValue('5');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Pranchas', exact: true }).click();
  await loss.fill('0');
  await loss.press('Enter');
  q = await save(page);
  expect(q.sheets[0].steelSchedule).not.toHaveProperty('meshLossPercent');

  // CSV por escopo: perda das telas desta exportação, à parte do acréscimo.
  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  await page
    .locator('.ribbon-content')
    .getByRole('button', { name: 'CSV por escopo', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Exportar relação do aço (CSV)',
  });
  await dialog
    .getByRole('checkbox', { name: 'Quadro detalhado', exact: true })
    .uncheck();
  await dialog
    .getByRole('combobox', { name: 'Política de perda das telas' })
    .selectOption('override');
  await dialog
    .getByRole('spinbutton', { name: 'Percentual de perda das telas' })
    .fill('5');
  const download = page.waitForEvent('download');
  await dialog
    .getByRole('button', { name: 'Exportar CSV', exact: true })
    .click();
  const csv = readFileSync((await (await download).path())!, 'utf8');
  const mesh = cells(csv).find((r) =>
    r.some((c) => c.startsWith('Tela soldada')),
  )!;
  expect(mesh).toBeTruthy();
  expect(mesh).toContain('5');
  expect(mesh.some((c) => c.startsWith('Perda das telas'))).toBe(true);
  // 43,512 kg × 1,05
  expect(mesh).toContain('45,7');
  expect(errors).toEqual([]);
});
