import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { emptyProject, newBar } from '../../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
  moveObjectsToDetail,
} from '../../src/domain/hierarchy';
import { createSheet, placeDrawing } from '../../src/domain/sheets';
import {
  defaultSheetSchedule,
  setSheetSchedule,
} from '../../src/domain/sheetSchedule';
import { detailOptions } from '../../src/domain/scheduleScopes';
import type { Project } from '../../src/domain/types';

/** Dois V1 homônimos (Térreo e Superior), prancha A com quadro de 10% e uma
 * inserção da barra do Térreo também na prancha B. */
function fixture() {
  let p = completeOwnership({
    ...emptyProject(),
    name: 'CSV por escopo',
    bars: [
      {
        ...newBar('N1'),
        id: 'a',
        quantity: 4,
        multiplier: 2,
        diameter: 10,
        comment: '=SOMA(1;2) "aspas"',
      },
      { ...newBar('N2'), id: 'b', quantity: 3, diameter: 5, steel: 'CA-60' },
    ],
  });
  const ids: string[] = [];
  for (const floor of ['Térreo', 'Superior']) {
    const f = createHierarchyNode(p, 'floor', floor);
    const g = createHierarchyNode(f.project, 'element', 'Vigas', f.id);
    const d = createHierarchyNode(g.project, 'detail', 'V1', g.id);
    p = d.project;
    ids.push(d.id);
  }
  p = moveObjectsToDetail(p, ['a'], ids[0]);
  p = moveObjectsToDetail(p, ['b'], ids[1]);
  p = completeOwnership({
    ...p,
    details: [{ id: 'r', barId: 'a', origin: { x: 0, y: 600 } }],
  });
  p = moveObjectsToDetail(p, ['r'], ids[1]);
  const drawing = (detail: string) =>
    p.hierarchy.drawings.find((d) => d.detailId === detail)!.id;
  p = { ...p, sheets: [{ ...p.sheets[0], name: 'Prancha A' }] };
  p = placeDrawing(p, p.sheets[0].id, drawing(ids[0])).project;
  const second = createSheet(p, 'Prancha B');
  p = placeDrawing(second.project, second.id, drawing(ids[1])).project;
  p = setSheetSchedule(p, p.sheets[0].id, defaultSheetSchedule());
  return p;
}
async function load(page: Page, p: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'csv-scopes.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await expect(
    page.getByRole('banner').getByText(p.name, { exact: true }),
  ).toBeVisible();
}
async function openDialog(page: Page) {
  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  await page
    .locator('.ribbon-content')
    .getByRole('button', { name: 'CSV por escopo', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Exportar relação do aço (CSV)',
  });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function exportFile(page: Page, dialog: ReturnType<Page['getByRole']>) {
  const event = page.waitForEvent('download');
  await dialog
    .getByRole('button', { name: 'Exportar CSV', exact: true })
    .click();
  const download = await event;
  await expect(dialog).toHaveCount(0);
  return {
    name: download.suggestedFilename(),
    bytes: readFileSync((await download.path())!),
  };
}
const text = (b: Uint8Array) =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(b);
/** CSV com aspas, `;` e CRLF → objetos por cabeçalho. */
function parse(csv: string) {
  expect(csv.startsWith('﻿')).toBe(true);
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  const s = csv.slice(1);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ';') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && s[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += ch;
  }
  const [h, ...body] = rows;
  return body.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
async function save(page: Page): Promise<Project> {
  const c = page.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await c.isVisible()) await c.click();
  const event = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
}

test('CSV por escopo: cancelar, validação, prancha ativa, elementos homônimos em ZIP e total físico sem alterar o projeto', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const p = fixture();
  await load(page, p);
  const undo = page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true });
  await expect(page.locator('.save-status')).not.toContainText('Gravando');
  const status = await page.locator('.save-status').textContent();
  const undoBefore = await undo.isEnabled();

  // Cancelar não exporta nem altera nada; o CSV global continua o mesmo.
  let dialog = await openDialog(page);
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const globalEvent = page.waitForEvent('download');
  await page
    .locator('.ribbon-content')
    .getByRole('button', { name: 'Quadro CSV', exact: true })
    .click();
  const global = readFileSync((await (await globalEvent).path())!, 'utf8');
  expect(global.split('\r\n')[0]).toContain(
    '"Posição";"Elemento";"Aço";"Bitola (mm)";"Quantidade base";"Repetições"',
  );

  // Seleção vazia e escopo sem aço são explícitos.
  dialog = await openDialog(page);
  await dialog.getByRole('radio', { name: 'Pranchas', exact: true }).check();
  await expect(dialog.getByRole('alert')).toContainText(
    'Selecione ao menos uma prancha.',
  );
  await expect(
    dialog.getByRole('button', { name: 'Exportar CSV' }),
  ).toBeDisabled();
  await dialog
    .getByRole('radio', { name: /Elementos \(detalhamentos\)/ })
    .check();
  await dialog.getByRole('radio', { name: /Todos os elementos/ }).check();
  await expect(dialog.getByRole('alert')).toContainText('não possui armaduras');
  await dialog.getByRole('radio', { name: 'Elementos selecionados' }).check();
  for (const d of detailOptions(p).filter((d) => d.barCount))
    await dialog.getByRole('checkbox', { name: d.label }).check();
  await expect(dialog.getByRole('list', { name: 'Arquivos' })).toContainText(
    'CSV-por-escopo_elemento-Terreo-Vigas-V1_quadro.csv',
  );
  await expect(dialog.getByRole('list', { name: 'Arquivos' })).toContainText(
    'CSV-por-escopo_elemento-Superior-Vigas-V1_resumo.csv',
  );
  await expect(dialog).toContainText('4 arquivo(s) em um ZIP');
  const zip = await exportFile(page, dialog);
  expect(zip.name).toBe('CSV-por-escopo_relacao-aco_elementos.zip');
  const files = unzipSync(zip.bytes);
  expect(Object.keys(files).sort()).toEqual([
    'CSV-por-escopo_elemento-Superior-Vigas-V1_quadro.csv',
    'CSV-por-escopo_elemento-Superior-Vigas-V1_resumo.csv',
    'CSV-por-escopo_elemento-Terreo-Vigas-V1_quadro.csv',
    'CSV-por-escopo_elemento-Terreo-Vigas-V1_resumo.csv',
  ]);
  const terreo = parse(
    text(files['CSV-por-escopo_elemento-Terreo-Vigas-V1_quadro.csv']),
  );
  const superior = parse(
    text(files['CSV-por-escopo_elemento-Superior-Vigas-V1_quadro.csv']),
  );
  expect(terreo.map((r) => r['IDs físicos das armaduras'])).toEqual(['a']);
  // A inserção da barra do Térreo não transfere aço para o elemento Superior.
  expect(superior.map((r) => r['IDs físicos das armaduras'])).toEqual(['b']);
  expect(terreo[0]['Quantidade efetiva']).toBe('8');
  expect(terreo[0]['Observação']).toBe('\'=SOMA(1;2) "aspas"');
  expect(terreo[0]['Contexto do escopo']).toBe('Térreo › Vigas');

  // Prancha ativa: o percentual vem do quadro da folha.
  await page.getByRole('tab', { name: 'Pranchas', exact: true }).click();
  await page
    .getByRole('button', { name: 'Abrir Prancha A', exact: true })
    .click();
  dialog = await openDialog(page);
  await expect(
    dialog.getByRole('radio', { name: /Prancha ativa: Prancha A/ }),
  ).toBeChecked();
  await expect(dialog).toContainText('10% · Quadro inserido na prancha');
  await dialog
    .getByRole('checkbox', { name: 'Resumo do aço', exact: true })
    .uncheck();
  await expect(dialog).toContainText('1 arquivo(s) ·');
  const single = await exportFile(page, dialog);
  expect(single.name).toBe('CSV-por-escopo_pranchas_quadro.csv');
  expect(single.bytes.slice(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  const rows = parse(text(single.bytes));
  expect(rows.map((r) => r['Posição'])).toEqual(['N1']);
  expect(rows[0]['C. unitário (cm)']).toBe('100,0');

  // Todas as pranchas, consolidado e total físico pela união dos IDs.
  dialog = await openDialog(page);
  await dialog.getByRole('radio', { name: /Todas as pranchas/ }).check();
  await dialog
    .getByRole('combobox', { name: 'Organização dos arquivos' })
    .selectOption('consolidated');
  await dialog
    .getByRole('checkbox', { name: 'Incluir total físico (união dos IDs)' })
    .check();
  await expect(dialog).toContainText('não é o total físico');
  await expect(dialog).toContainText('Percentuais diferentes');
  await dialog.screenshot({ path: 'docs/csv-export-scope.png' });
  await dialog
    .getByRole('checkbox', { name: 'Quadro detalhado', exact: true })
    .uncheck();
  const summary = await exportFile(page, dialog);
  expect(summary.name).toBe('CSV-por-escopo_pranchas_resumo.csv');
  const s = parse(text(summary.bytes)).filter((r) => r['Linha'] === 'Bitola');
  expect(s.map((r) => [r['Escopo'], r['Aço'], r['Acréscimo (%)']])).toEqual([
    ['Prancha A (folha 1)', 'CA-50', '10'],
    ['Prancha B (folha 2)', 'CA-50', '0'],
    ['Prancha B (folha 2)', 'CA-60', '0'],
    ['Total físico (união dos IDs)', 'CA-50', ''],
    ['Total físico (união dos IDs)', 'CA-60', ''],
  ]);
  // A barra a aparece nas duas folhas, mas o total físico a conta uma vez.
  expect(s[3]['Peso teórico (kg)']).toBe(s[0]['Peso teórico (kg)']);
  expect(s[0]['Peso com acréscimo (kg)']).toBe(
    (Number(s[0]['Peso teórico (kg)'].replace(',', '.')) * 1.1)
      .toFixed(1)
      .replace('.', ','),
  );

  expect(await undo.isEnabled()).toBe(undoBefore);
  await expect(page.locator('.save-status')).toHaveText(status!);
  expect(await save(page)).toEqual(p);
  expect(errors).toEqual([]);
});

test('mantém o foco no diálogo, bloqueia Desfazer e exporta acréscimo fracionário com ponto', async ({
  page,
}) => {
  const p = fixture();
  await load(page, p);
  const dialog = await openDialog(page);
  await expect(
    dialog.getByRole('button', { name: 'Fechar exportação CSV', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    dialog.getByRole('button', { name: 'Exportar CSV', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    dialog.getByRole('button', { name: 'Fechar exportação CSV', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Control+z');
  await dialog
    .getByRole('checkbox', { name: 'Quadro detalhado', exact: true })
    .uncheck();
  await dialog
    .getByRole('combobox', { name: 'Separador decimal' })
    .selectOption('.');
  await dialog
    .getByRole('combobox', { name: 'Política de acréscimo' })
    .selectOption('override');
  await dialog
    .getByRole('spinbutton', { name: 'Percentual de acréscimo' })
    .fill('7.5');
  const result = await exportFile(page, dialog);
  const rows = parse(text(result.bytes));
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) expect(row['Acréscimo (%)']).toBe('7.5');
  expect(await save(page)).toEqual(p);
});

test('falha de gravação aparece no diálogo e permite repetir sem alterar o projeto', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const p = fixture();
  await load(page, p);
  const dialog = await openDialog(page);
  const restore = await page.evaluateHandle(() => {
    const original = URL.createObjectURL;
    URL.createObjectURL = () => {
      throw new Error('Falha de gravação simulada');
    };
    return () => {
      URL.createObjectURL = original;
    };
  });
  await dialog
    .getByRole('button', { name: 'Exportar CSV', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Falha de gravação simulada',
  );
  await expect(
    dialog.getByRole('button', { name: 'Exportar CSV', exact: true }),
  ).toBeEnabled();
  await restore.evaluate((fn) => fn());
  await restore.dispose();
  const result = await exportFile(page, dialog);
  expect(Object.keys(unzipSync(result.bytes))).toHaveLength(2);
  expect(await save(page)).toEqual(p);
  expect(errors).toEqual([]);
});
