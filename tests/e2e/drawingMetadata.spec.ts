import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { emptyProject, newBar } from '../../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
} from '../../src/domain/hierarchy';
import { duplicateDrawing } from '../../src/domain/drawingMetadata';
import type { Project } from '../../src/domain/types';

test.use({ viewport: { width: 1280, height: 800 } });

function seedProject() {
  let p = emptyProject();
  p.name = 'Edifício Horizonte';
  p.author = 'Coordenação Geral';
  p.notes = 'Observação geral do projeto';
  p.hierarchy.floors[0].name = 'Térreo';
  p.hierarchy.elements[0].name = 'Vigas';
  p.hierarchy.details[0].name = 'V1';
  const v1Id = p.hierarchy.details[0].id;
  const dup = duplicateDrawing(p, p.hierarchy.drawings[0].id);
  p = dup.project;
  p.hierarchy.drawings[1].name = 'Corte transversal';

  const second = createHierarchyNode(
    p,
    'detail',
    'V2',
    p.hierarchy.elements[0].id,
  );
  p = completeOwnership(
    {
      ...second.project,
      bars: [
        {
          ...newBar('N1'),
          id: 'bar-v1',
          quantity: 4,
          diameter: 12.5,
          mandrel: 62.5,
        },
      ],
    },
    v1Id,
  );
  return {
    project: p,
    v1Id,
    v2Id: second.id,
    drawingAId: p.hierarchy.drawings[0].id,
    drawingBId: dup.id,
    drawingV2Id: p.hierarchy.drawings.find((d) => d.detailId === second.id)!.id,
  };
}

async function loadProject(page: Page, project: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'metadados.armstruct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.locator('.window-project')).toHaveText(project.name);
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
}

async function downloadSavedProject(page: Page): Promise<Project> {
  const closeToast = page.getByRole('button', {
    name: 'Fechar aviso',
    exact: true,
  });
  if (await closeToast.isVisible()) await closeToast.click();
  const downloadPromise = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  const download = await downloadPromise;
  return JSON.parse(readFileSync((await download.path())!, 'utf8'));
}

async function downloadExport(
  page: Page,
  kind: 'Desenho DXF' | 'Quadro CSV',
): Promise<string> {
  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: kind, exact: true }).click();
  const download = await downloadPromise;
  return readFileSync((await download.path())!, 'utf8');
}

test('edita metadados por desenho pela árvore e pelo contexto ativo, preserva round-trip, histórico e exportações', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const seed = seedProject();
  await loadProject(page, seed.project);

  // Dois desenhos do mesmo detalhamento (V1): abrir propriedades do desenho A pela árvore
  await page
    .getByRole('button', { name: 'Propriedades do desenho V1', exact: true })
    .click();

  const dialog = page.getByRole('dialog', {
    name: 'Propriedades do desenho',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('drawing-meta-floor')).toHaveText('Térreo');
  await expect(dialog.getByTestId('drawing-meta-element')).toHaveText('Vigas');
  await expect(dialog.getByTestId('drawing-meta-detail')).toHaveText('V1');
  await expect(
    dialog.getByLabel('Autor informado', { exact: true }),
  ).toHaveValue('');
  await expect(
    dialog.getByLabel('Data documental', { exact: true }),
  ).toHaveValue('');

  // Renomear pavimento atualiza informação derivada ao vivo sem tocar nos metadados do desenho
  await page
    .getByRole('button', { name: 'Editar pavimento Térreo', exact: true })
    .click();
  await page
    .getByLabel('Nome do pavimento', { exact: true })
    .fill('1º Pavimento');
  await page
    .getByRole('button', { name: 'Salvar alterações', exact: true })
    .click();
  await expect(dialog.getByTestId('drawing-meta-floor')).toHaveText(
    '1º Pavimento',
  );

  const beforeMetadataEdit = await downloadSavedProject(page);
  expect(beforeMetadataEdit.hierarchy.drawings[0].author).toBeUndefined();
  const dxfBefore = await downloadExport(page, 'Desenho DXF');
  const csvBefore = await downloadExport(page, 'Quadro CSV');

  await dialog
    .getByLabel('Título do desenho', { exact: true })
    .fill('Armação longitudinal');
  await dialog
    .getByLabel('Autor informado', { exact: true })
    .fill('Eng. Helena Costa');
  await dialog
    .getByLabel('Data documental', { exact: true })
    .fill('2026-11-09');
  await dialog
    .getByLabel('Comentários do desenho', { exact: true })
    .fill('Cobrimento nominal c = 30 mm.\nSem interferência com embutidos.');

  await page.screenshot({
    path: 'docs/drawing-metadata-form.png',
    fullPage: true,
  });

  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const saved = await downloadSavedProject(page);
  const drawingA = saved.hierarchy.drawings.find(
    (d) => d.id === seed.drawingAId,
  )!;
  const drawingB = saved.hierarchy.drawings.find(
    (d) => d.id === seed.drawingBId,
  )!;
  expect(drawingA).toEqual({
    id: seed.drawingAId,
    detailId: seed.v1Id,
    name: 'Armação longitudinal',
    author: 'Eng. Helena Costa',
    date: '2026-11-09',
    notes: 'Cobrimento nominal c = 30 mm.\nSem interferência com embutidos.',
  });
  // Desenho B do mesmo detalhamento permanece intacto
  expect(drawingB).toEqual({
    id: seed.drawingBId,
    detailId: seed.v1Id,
    name: 'Corte transversal',
  });
  expect(saved.author).toBe('Coordenação Geral');
  expect(saved.notes).toBe('Observação geral do projeto');
  expect(saved.bars).toEqual(beforeMetadataEdit.bars);
  expect(await downloadExport(page, 'Desenho DXF')).toBe(dxfBefore);
  expect(await downloadExport(page, 'Quadro CSV')).toBe(csvBefore);
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();

  // Abrir o desenho A e consultar/editar a partir da barra de contexto ativo
  await page
    .getByRole('button', {
      name: 'Abrir desenho V1 · Armação longitudinal',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('region', { name: 'Edição isolada', exact: true }),
  ).toBeVisible();

  await page.getByRole('tab', { name: 'Propriedades', exact: true }).click();
  await expect(page.locator('.drawing-inspector-card')).toContainText(
    'Eng. Helena Costa',
  );
  await expect(page.locator('.drawing-inspector-card')).toContainText(
    '09/11/2026',
  );

  await page.screenshot({
    path: 'docs/drawing-metadata-active.png',
    fullPage: true,
  });

  await page
    .getByRole('region', { name: 'Edição isolada', exact: true })
    .getByRole('button', { name: 'Propriedades do desenho', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Propriedades do desenho', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('dialog', { name: 'Propriedades do desenho', exact: true }),
  ).toHaveCount(0);

  // Desfazer restaura valores anteriores; Refazer recupera a única alteração
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  expect(await downloadSavedProject(page)).toEqual(beforeMetadataEdit);

  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Refazer', exact: true })
    .click();
  expect(await downloadSavedProject(page)).toEqual(saved);

  // Autorecuperação local e reabertura de arquivo conservam todos os campos
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect(await downloadSavedProject(page)).toEqual(saved);

  await page.getByTestId('project-input').setInputFiles({
    name: 'reabertura.armstruct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  expect(await downloadSavedProject(page)).toEqual(saved);

  expect(pageErrors).toEqual([]);
});

test('cancelar, trocar de desenho ou excluir desenho com formulário aberto descartam rascunho e tratam HTML como texto', async ({
  page,
}) => {
  const seed = seedProject();
  await loadProject(page, seed.project);
  // Recarrega a partir da recuperação local para iniciar com histórico limpo (past = [])
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  const initialSaved = await downloadSavedProject(page);
  await expect(
    page
      .locator('.quick-tools')
      .getByRole('button', { name: 'Desfazer', exact: true }),
  ).toBeDisabled();

  // 1. Cancelar não modifica o projeto nem acrescenta histórico
  await page
    .getByRole('button', { name: 'Propriedades do desenho V2', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Propriedades do desenho',
    exact: true,
  });
  await dialog
    .getByLabel('Título do desenho', { exact: true })
    .fill('Rascunho cancelado');
  await dialog
    .getByLabel('Autor informado', { exact: true })
    .fill('Autor Temporário');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page
      .locator('.quick-tools')
      .getByRole('button', { name: 'Desfazer', exact: true }),
  ).toBeDisabled();
  expect(await downloadSavedProject(page)).toEqual(initialSaved);

  // 2. Trocar de desenho com o formulário aberto descarta rascunho e nunca aplica ao desenho errado
  await page
    .getByRole('button', { name: 'Propriedades do desenho V1', exact: true })
    .click();
  await dialog
    .getByLabel('Autor informado', { exact: true })
    .fill('Não aplicar ao Corte');
  await dialog
    .getByLabel('Comentários do desenho', { exact: true })
    .fill('Pendente do desenho A');

  await page
    .getByRole('button', {
      name: 'Abrir desenho V1 · Corte transversal',
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(await downloadSavedProject(page)).toEqual(initialSaved);

  // Voltar ao modelo geral para testar exclusão do detalhamento V2 com propriedades abertas
  await page
    .getByRole('button', { name: 'Concluir edição', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await page
    .getByRole('button', { name: 'Propriedades do desenho V2', exact: true })
    .click();
  await dialog
    .getByLabel('Autor informado', { exact: true })
    .fill('Autor de desenho excluído');

  await page
    .getByRole('button', { name: 'Editar detalhamento V2', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Excluir detalhamento', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const afterDelete = await downloadSavedProject(page);
  expect(
    afterDelete.hierarchy.drawings.some((d) => d.id === seed.drawingV2Id),
  ).toBe(false);
  expect(
    afterDelete.hierarchy.drawings.every((d) => d.author === undefined),
  ).toBe(true);

  // 3. Validação conserva preenchimento em erro e renderiza conteúdo semelhante a HTML apenas como texto
  await page
    .getByRole('button', { name: 'Propriedades do desenho V1', exact: true })
    .click();
  await dialog.getByLabel('Título do desenho', { exact: true }).fill('   ');
  await dialog
    .getByLabel('Autor informado', { exact: true })
    .fill('<b>Eng. Texto Puro</b>');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('1 a 100');
  await expect(
    dialog.getByLabel('Autor informado', { exact: true }),
  ).toHaveValue('<b>Eng. Texto Puro</b>');

  await dialog
    .getByLabel('Título do desenho', { exact: true })
    .fill('<img src=x onerror=window.__xss=1> V1');
  await dialog
    .getByLabel('Comentários do desenho', { exact: true })
    .fill('<script>window.__xss=2</script> Cobrimento >= 30 mm');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const xssExecuted = await page.evaluate(
    () => (window as unknown as { __xss?: number }).__xss,
  );
  expect(xssExecuted).toBeUndefined();
  const withHtmlText = await downloadSavedProject(page);
  expect(
    withHtmlText.hierarchy.drawings.find((d) => d.id === seed.drawingAId),
  ).toMatchObject({
    name: '<img src=x onerror=window.__xss=1> V1',
    author: '<b>Eng. Texto Puro</b>',
    notes: '<script>window.__xss=2</script> Cobrimento >= 30 mm',
  });

  await page.screenshot({
    path: 'docs/drawing-metadata-context-safety.png',
    fullPage: true,
  });
});
