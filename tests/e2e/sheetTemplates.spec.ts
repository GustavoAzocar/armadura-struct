import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject } from '../../src/domain/model';
import { createSheet } from '../../src/domain/sheets';
import { decodeSheetTemplate } from '../../src/domain/sheetTemplates';
import type { Project } from '../../src/domain/types';

async function openProject(page: Page, project: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'pranchas.armstruct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByRole('tab', { name: 'Pranchas', exact: true }).click();
  await page
    .getByRole('button', {
      name: `Abrir ${project.sheets[0].name}`,
      exact: true,
    })
    .click();
  await page
    .getByRole('button', { name: 'Modelos de margem e selo', exact: true })
    .click();
  return page.getByRole('dialog', { name: 'Modelos de margem e selo' });
}

async function saveProject(page: Page): Promise<Project> {
  const download = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
}

test('aplica uma revisão a três folhas em uma operação e conserva a revisão anterior ao editar', async ({
  page,
}, testInfo) => {
  let project = emptyProject();
  project = createSheet(project, 'Detalhamento B').project;
  project = createSheet(project, 'Detalhamento C').project;
  project = createSheet(project, 'Folha de controle').project;
  const dialog = await openProject(page, project);
  await dialog
    .getByLabel('Nome do modelo', { exact: true })
    .fill('Padrão interno A1');
  await dialog
    .getByRole('combobox', { name: 'Formato', exact: true })
    .selectOption('A1');
  await dialog.getByLabel('Área útil · largura', { exact: true }).fill('821');
  await dialog.getByLabel('Área útil · altura', { exact: true }).fill('574');
  await dialog.getByLabel('Reserva do selo · X', { exact: true }).fill('671');
  await dialog
    .getByRole('button', { name: 'Adicionar campo', exact: true })
    .click();
  await dialog
    .getByLabel('Texto estático', { exact: true })
    .fill('PRANCHA INTERNA');
  await dialog
    .getByRole('combobox', { name: 'Fonte', exact: true })
    .selectOption('courier');
  await dialog
    .getByRole('button', { name: 'Salvar modelo', exact: true })
    .click();
  await expect(
    dialog.getByText('Modelo salvo na biblioteca do projeto.'),
  ).toBeVisible();

  await dialog.getByRole('checkbox', { name: /Detalhamento B/ }).check();
  await dialog.getByRole('checkbox', { name: /Detalhamento C/ }).check();
  await dialog
    .getByRole('button', { name: 'Conferir aplicação', exact: true })
    .click();
  await expect(
    dialog.getByRole('img', { name: 'Prévia da aplicação em Folha 1' }),
  ).toBeVisible();
  await expect(
    dialog.getByText(/Papel 420 × 297 mm → 841 × 594 mm/),
  ).toHaveCount(3);
  await testInfo.attach('aplicacao-tres-pranchas', {
    body: await dialog.screenshot(),
    contentType: 'image/png',
  });
  await dialog
    .getByRole('button', { name: 'Cancelar aplicação', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  expect((await saveProject(page)).sheets).toEqual(project.sheets);

  await page
    .getByRole('button', { name: 'Modelos de margem e selo', exact: true })
    .click();
  await dialog.getByRole('checkbox', { name: /Detalhamento B/ }).check();
  await dialog.getByRole('checkbox', { name: /Detalhamento C/ }).check();
  await dialog
    .getByRole('button', { name: 'Conferir aplicação', exact: true })
    .click();
  await dialog
    .getByRole('button', {
      name: 'Aplicar modelo às folhas selecionadas',
      exact: true,
    })
    .click();
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  const applied = await saveProject(page);
  expect(
    applied.sheets.slice(0, 3).map((sheet) => sheet.paperTemplate?.revision),
  ).toEqual([1, 1, 1]);
  expect(applied.sheets[3]).toEqual(project.sheets[3]);
  expect(applied.hierarchy.placements).toEqual(project.hierarchy.placements);

  const quickTools = page.locator('.quick-tools');
  await quickTools
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  expect((await saveProject(page)).sheets).toEqual(project.sheets);
  await quickTools
    .getByRole('button', { name: 'Refazer', exact: true })
    .click();
  expect((await saveProject(page)).sheets).toEqual(applied.sheets);

  await page
    .getByRole('button', { name: 'Modelos de margem e selo', exact: true })
    .click();
  await dialog
    .getByLabel('Texto estático', { exact: true })
    .fill('REVISÃO INTERNA');
  await dialog
    .getByRole('button', { name: 'Salvar modelo', exact: true })
    .click();
  const download = page.waitForEvent('download');
  await dialog
    .getByRole('button', { name: 'Exportar modelo', exact: true })
    .click();
  const exported = decodeSheetTemplate(
    readFileSync((await (await download).path())!, 'utf8'),
  );
  expect(exported.fields[0].text).toBe('REVISÃO INTERNA');
  expect(exported.revision).toBe(2);
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  expect((await saveProject(page)).sheets).toEqual(applied.sheets);
});

test('calibra DXF de unidade desconhecida por uma medida explícita e restaura a geometria em outro projeto', async ({
  page,
  browser,
}, testInfo) => {
  const dialog = await openProject(page, emptyProject());
  await dialog
    .getByLabel('Nome do modelo', { exact: true })
    .fill('Modelo calibrado');
  await dialog
    .getByLabel('Arquivo CAD do modelo de prancha', { exact: true })
    .setInputFiles('tests/fixtures/sheet-template-unitless.dxf');
  await expect(
    dialog.getByText(
      'Informe uma distância conhecida e a unidade para confirmar a escala deste desenho.',
    ),
  ).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Prévia calibrada', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toContainText('distância positiva');
  await dialog.getByLabel('Distância conhecida', { exact: true }).fill('2,5');
  await dialog
    .getByRole('combobox', { name: 'Unidade da distância', exact: true })
    .selectOption('cm');
  await dialog
    .getByLabel('Posição do ponto 1 no papel X', { exact: true })
    .fill('15');
  await dialog
    .getByLabel('Posição do ponto 1 no papel Y', { exact: true })
    .fill('20');
  await dialog
    .getByRole('button', { name: 'Prévia calibrada', exact: true })
    .click();
  const calibrated = dialog.getByRole('img', {
    name: 'Desenho calibrado em milímetros de papel',
  });
  await expect(calibrated).toBeVisible();
  await calibrated.evaluate((element) =>
    element.scrollIntoView({ block: 'center' }),
  );
  await testInfo.attach('previa-calibracao-dxf', {
    body: await dialog.screenshot(),
    contentType: 'image/png',
  });
  await dialog
    .getByRole('button', { name: 'Usar desenho calibrado', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Salvar modelo', exact: true })
    .click();
  const download = page.waitForEvent('download');
  await dialog
    .getByRole('button', { name: 'Exportar modelo', exact: true })
    .click();
  const file = readFileSync((await (await download).path())!);
  expect(decodeSheetTemplate(file.toString('utf8')).geometry[0].points).toEqual(
    [
      { x: 15, y: 20 },
      { x: 40, y: 20 },
    ],
  );
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();

  const otherPage = await browser.newPage({
    baseURL: testInfo.project.use.baseURL,
  });
  const otherDialog = await openProject(otherPage, emptyProject());
  await otherDialog
    .getByLabel('Arquivo de modelo de margem e selo', { exact: true })
    .setInputFiles({
      name: 'calibrado.json',
      mimeType: 'application/json',
      buffer: file,
    });
  await expect(
    otherDialog.getByLabel('Nome do modelo', { exact: true }),
  ).toHaveValue('Modelo calibrado');
  await otherDialog
    .getByRole('button', { name: 'Salvar modelo', exact: true })
    .click();
  await otherDialog
    .getByRole('button', { name: 'Fechar', exact: true })
    .click();
  expect((await saveProject(otherPage)).sheetTemplates?.[0].geometry).toEqual(
    decodeSheetTemplate(file.toString('utf8')).geometry,
  );
});
