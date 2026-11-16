import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { emptyProject } from '../../src/domain/model';
import { createSheet, updateSheet } from '../../src/domain/sheets';
import {
  applySheetTemplate,
  saveSheetTemplate,
  templateFromSheet,
} from '../../src/domain/sheetTemplates';
import type { Project } from '../../src/domain/types';

function sample() {
  const base = emptyProject();
  const project = {
    ...base,
    author: 'Eng. Joana',
    hierarchy: {
      ...base.hierarchy,
      drawings: [
        ...base.hierarchy.drawings,
        {
          ...base.hierarchy.drawings[0],
          id: 'origem-documental',
          name: 'Revisão documental',
          author: 'Eng. Camila',
        },
      ],
    },
  };
  const second = createSheet(project, 'Cortes');
  const third = createSheet(
    updateSheet(second.project, second.id, {
      properties: { revision: 'R2', notes: '' },
    }),
    'Controle',
  );
  const template = {
    ...templateFromSheet(project.sheets[0]),
    fields: [
      {
        id: 'autor',
        label: 'Responsável do desenho',
        box: { x: 20, y: 20, width: 130, height: 15 },
        origin: { x: 25, y: 27 },
        text: '@AUTOR',
        font: 'courier' as const,
        height: 3,
        align: 'left' as const,
        rotation: 0,
      },
      {
        id: 'endereco',
        label: 'Local da obra',
        box: { x: 20, y: 40, width: 130, height: 15 },
        origin: { x: 25, y: 47 },
        text: '@ENDERECO',
        font: 'helvetica' as const,
        height: 3,
        align: 'left' as const,
        rotation: 0,
      },
    ],
  };
  return applySheetTemplate(
    saveSheetTemplate(third.project, template),
    template.id,
    third.project.sheets.map(({ id }) => id),
  );
}

async function loadProject(page: Page, project: Project) {
  await page.getByTestId('project-input').setInputFiles({
    name: 'dados-selo.armstruct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
}

async function openFirstSheet(page: Page) {
  await page.getByRole('tab', { name: 'Pranchas', exact: true }).click();
  await page
    .getByRole('button', { name: 'Abrir Folha 1', exact: true })
    .click();
}

async function openSheet(page: Page, project: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await loadProject(page, project);
  await openFirstSheet(page);
}

async function openDraft(page: Page) {
  await page
    .getByRole('button', { name: 'Dados do selo', exact: true })
    .click();
  return page.getByRole('dialog', {
    name: 'Dados do selo',
    exact: true,
  });
}

function address(dialog: ReturnType<Page['getByRole']>) {
  return dialog
    .getByRole('group', { name: 'Dados do projeto', exact: true })
    .getByLabel('Endereço', { exact: true });
}

async function saveProject(page: Page): Promise<Project> {
  const download = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  const saved = await (await download).path();
  if (!saved) throw new Error('O navegador não informou o arquivo salvo.');
  return JSON.parse(await readFile(saved, 'utf8'));
}

test('associa os textos explicitamente e confere dados nas folhas selecionadas sem salvar o rascunho', async ({
  page,
}) => {
  await openSheet(page, sample());
  const before = await saveProject(page);
  const dialog = await openDraft(page);
  const preview = (name: string) =>
    dialog.getByRole('img', { name: 'Prévia do selo em ' + name, exact: true });
  const review = dialog.getByRole('button', {
    name: 'Conferir prévia',
    exact: true,
  });

  await expect(
    dialog.getByRole('checkbox', { name: 'Folha 1', exact: true }),
  ).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'Cortes', exact: true }).check();
  await expect(
    dialog.getByText('Valores mistos', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('combobox', { name: 'Revisão da folha', exact: true }),
  ).toHaveValue('keep');
  await expect(
    dialog.getByRole('checkbox', { name: 'Controle', exact: true }),
  ).not.toBeChecked();

  await address(dialog).fill('Rua da Estação');
  await review.click();
  await expect(
    preview('Folha 1').getByText('@AUTOR', { exact: true }),
  ).toBeVisible();
  await expect(
    preview('Folha 1').getByText('@ENDERECO', { exact: true }),
  ).toBeVisible();
  await expect(
    preview('Folha 1').getByText('Rua da Estação', { exact: true }),
  ).toHaveCount(0);

  await dialog
    .getByRole('combobox', {
      name: 'Vínculo de Responsável do desenho',
      exact: true,
    })
    .selectOption('@AUTOR');
  await dialog
    .getByRole('combobox', { name: 'Vínculo de Local da obra', exact: true })
    .selectOption('@ENDERECO');
  await dialog
    .getByRole('combobox', { name: 'Autor da folha', exact: true })
    .selectOption('local');
  await dialog
    .getByLabel('Valor de Autor da folha', { exact: true })
    .fill('Eng. Nádia');
  await review.click();

  for (const name of ['Folha 1', 'Cortes']) {
    await expect(
      preview(name).getByText('Eng. Nádia', { exact: true }),
    ).toBeVisible();
    await expect(
      preview(name).getByText('Rua da Estação', { exact: true }),
    ).toBeVisible();
  }
  await expect(preview('Controle')).toHaveCount(0);

  await dialog
    .getByRole('combobox', { name: 'Autor da folha', exact: true })
    .selectOption('empty');
  await review.click();
  await expect(
    preview('Cortes').getByText('Eng. Nádia', { exact: true }),
  ).toHaveCount(0);
  await expect(
    preview('Cortes').getByText('Eng. Joana', { exact: true }),
  ).toHaveCount(0);
  await expect(
    preview('Cortes').getByText('Rua da Estação', { exact: true }),
  ).toBeVisible();

  await dialog
    .getByRole('combobox', { name: 'Autor da folha', exact: true })
    .selectOption('inherit');
  await review.click();
  await expect(
    preview('Cortes').getByText('Eng. Joana', { exact: true }),
  ).toBeVisible();

  await dialog
    .getByRole('combobox', {
      name: 'Origem de Responsável do desenho',
      exact: true,
    })
    .selectOption('drawing');
  const drawing = dialog.getByRole('combobox', {
    name: 'Desenho de Responsável do desenho',
    exact: true,
  });
  await expect(drawing).toHaveValue('');
  await review.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(preview('Cortes')).toHaveCount(0);
  await drawing.selectOption('origem-documental');
  await review.click();
  await expect(
    preview('Cortes').getByText('Eng. Camila', { exact: true }),
  ).toBeVisible();

  const override = dialog.getByRole('checkbox', {
    name: 'Texto manual de Responsável do desenho',
    exact: true,
  });
  await override.check();
  await dialog
    .getByLabel('Valor manual de Responsável do desenho', { exact: true })
    .fill('Eng. Manual');
  await review.click();
  await expect(
    preview('Cortes').getByText('Eng. Manual', { exact: true }),
  ).toBeVisible();
  await override.uncheck();
  await review.click();
  await expect(
    preview('Cortes').getByText('Eng. Camila', { exact: true }),
  ).toBeVisible();

  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await saveProject(page)).toEqual(before);
});

test('descarta o rascunho de dados documentais ao sair com Esc', async ({
  page,
}) => {
  await openSheet(page, sample());
  const first = await openDraft(page);
  await address(first).fill('Rua provisória');
  await first.getByRole('checkbox', { name: 'Cortes', exact: true }).check();
  await address(first).press('Escape');
  await expect(first).toBeHidden();

  const reopened = await openDraft(page);
  await expect(address(reopened)).toHaveValue('');
  await expect(
    reopened.getByRole('checkbox', { name: 'Cortes', exact: true }),
  ).not.toBeChecked();
});

test('fecha a prévia pendente quando o projeto é substituído', async ({
  page,
}) => {
  await openSheet(page, sample());
  const draft = await openDraft(page);
  await address(draft).fill('Rua do projeto anterior');

  const next = { ...sample(), name: 'Novo contexto de pranchas' };
  await loadProject(page, next);
  await expect(draft).toBeHidden();

  await openFirstSheet(page);
  const reopened = await openDraft(page);
  await expect(address(reopened)).toHaveValue('');
  await reopened.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect((await saveProject(page)).id).toBe(next.id);
});

test('aplica um lote em uma etapa de histórico e preserva os vínculos ao salvar, reabrir e recuperar', async ({
  page,
}) => {
  await openSheet(page, sample());
  const before = await saveProject(page);
  const dialog = await openDraft(page);
  await dialog.getByRole('checkbox', { name: 'Cortes', exact: true }).check();
  await address(dialog).fill('Rua Persistida');
  await dialog
    .getByRole('combobox', {
      name: 'Vínculo de Responsável do desenho',
      exact: true,
    })
    .selectOption('@AUTOR');
  await dialog
    .getByRole('combobox', { name: 'Vínculo de Local da obra', exact: true })
    .selectOption('@ENDERECO');
  await dialog
    .getByRole('combobox', { name: 'Autor da folha', exact: true })
    .selectOption('local');
  await dialog
    .getByLabel('Valor de Autor da folha', { exact: true })
    .fill('Eng. do lote');
  await dialog
    .getByRole('combobox', { name: 'Revisão da folha', exact: true })
    .selectOption('local');
  await dialog
    .getByLabel('Valor de Revisão da folha', { exact: true })
    .fill('R9');
  // Duas confirmações síncronas ainda devem produzir uma única gravação.
  await dialog
    .getByRole('button', { name: 'Aplicar dados do selo', exact: true })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect(dialog).toBeHidden();
  const after = await saveProject(page);
  expect(after.schema).toBe('armadurastruct/39');
  expect(after.sealProperties?.address).toBe('Rua Persistida');
  for (const sheet of after.sheets.slice(0, 2)) {
    expect(sheet.properties.revision).toBe('R9');
    expect(sheet.sealProperties?.author).toEqual({
      mode: 'local',
      value: 'Eng. do lote',
    });
    expect(sheet.paperTemplate?.fields[0].sealBinding?.field).toBe('@AUTOR');
  }
  expect(after.sheets[2]).toEqual(before.sheets[2]);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  expect(await saveProject(page)).toEqual(before);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Refazer', exact: true })
    .click();
  expect(await saveProject(page)).toEqual(after);
  await loadProject(page, after);
  await openFirstSheet(page);
  const reopened = await openDraft(page);
  await expect(address(reopened)).toHaveValue('Rua Persistida');
  await reopened
    .getByRole('button', { name: 'Conferir prévia', exact: true })
    .click();
  await expect(
    reopened
      .getByRole('img', { name: 'Prévia do selo em Folha 1', exact: true })
      .getByText('Eng. do lote', { exact: true }),
  ).toBeVisible();
  await reopened.getByRole('button', { name: 'Cancelar', exact: true }).click();
  for (const [button, encoding] of [
    ['Exportar todas as folhas em PDF', 'latin1'],
    ['Exportar folha ativa em DXF', 'utf8'],
  ] as const) {
    if (button.endsWith('DXF'))
      page.once('dialog', (dialog) => dialog.accept());
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: true }).click();
    const path = await (await download).path();
    expect(path).toBeTruthy();
    const content = await readFile(path!, encoding);
    expect(content).toContain('Eng. do lote');
    expect(content).toContain('Rua Persistida');
  }
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const r = indexedDB.open('armadurastruct', 1);
          r.onsuccess = () => resolve(r.result);
        });
        const raw = await new Promise<string | undefined>((resolve) => {
          const r = db
            .transaction('projects')
            .objectStore('projects')
            .get('current');
          r.onsuccess = () => resolve(r.result);
        });
        db.close();
        return raw ? JSON.parse(raw).sealProperties?.address : undefined;
      }),
    )
    .toBe('Rua Persistida');
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect((await saveProject(page)).sealProperties?.address).toBe(
    'Rua Persistida',
  );
});

test('restaura o vínculo automático preservando a origem escolhida depois de reabrir', async ({
  page,
}) => {
  await openSheet(page, sample());
  let dialog = await openDraft(page);
  await dialog
    .getByRole('combobox', {
      name: 'Vínculo de Responsável do desenho',
      exact: true,
    })
    .selectOption('@AUTOR');
  await dialog
    .getByRole('combobox', {
      name: 'Origem de Responsável do desenho',
      exact: true,
    })
    .selectOption('drawing');
  await dialog
    .getByRole('combobox', {
      name: 'Desenho de Responsável do desenho',
      exact: true,
    })
    .selectOption('origem-documental');
  await dialog
    .getByRole('checkbox', {
      name: 'Texto manual de Responsável do desenho',
      exact: true,
    })
    .check();
  await dialog
    .getByLabel('Valor manual de Responsável do desenho', { exact: true })
    .fill('Conferido manualmente');
  await dialog
    .getByRole('button', { name: 'Aplicar dados do selo', exact: true })
    .click();
  const saved = await saveProject(page);
  expect(saved.sheets[0].sealBindings?.[0].manualText).toBe(
    'Conferido manualmente',
  );
  await loadProject(page, saved);
  await openFirstSheet(page);
  dialog = await openDraft(page);
  await expect(
    dialog.getByRole('textbox', {
      name: 'Valor manual de Responsável do desenho',
      exact: true,
    }),
  ).toHaveValue('Conferido manualmente');
  await dialog
    .getByRole('checkbox', {
      name: 'Texto manual de Responsável do desenho',
      exact: true,
    })
    .uncheck();
  await dialog
    .getByRole('button', { name: 'Conferir prévia', exact: true })
    .click();
  await expect(
    dialog
      .getByRole('img', { name: 'Prévia do selo em Folha 1', exact: true })
      .getByText('Eng. Camila', { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Aplicar dados do selo', exact: true })
    .click();
  const result = await saveProject(page);
  expect(result.sheets[0].sealBindings?.[0]).toMatchObject({
    source: { kind: 'drawing', drawingId: 'origem-documental' },
  });
  expect(result.sheets[0].sealBindings?.[0].manualText).toBeUndefined();
});
