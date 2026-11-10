import { test, expect, type Page } from '@playwright/test';
import { decodeProject, emptyProject } from '../../src/domain/model';
import {
  installDirectoryMock,
  type DirectoryMock,
} from '../fixtures/projectDirectory';

const fixture = (name: string, id: string) =>
  JSON.stringify({
    ...decodeProject(JSON.stringify(emptyProject())),
    id,
    name,
  });
const upload = (page: Page, testId: string, name: string, buffer: string) =>
  page.getByTestId(testId).setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(buffer),
  });
const openFile = async (
  page: Page,
  name: string,
  id: string,
  file = 'p.json',
) => {
  await upload(page, 'project-input', file, fixture(name, id));
  await expect(
    page.getByRole('banner').getByText(name, { exact: true }),
  ).toBeVisible();
};
const recents = (page: Page) =>
  page.getByRole('dialog', { name: 'Projetos recentes' });
async function showRecents(page: Page) {
  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  await page
    .getByRole('button', { name: 'Projetos recentes', exact: true })
    .click();
  await expect(recents(page)).toBeVisible();
}
const titles = (page: Page) =>
  recents(page).locator('.recent-info strong').allTextContents();
async function command(page: Page, value: string) {
  const input = page.getByRole('textbox', { name: 'Comando CAD' });
  await input.fill(value);
  await input.press('Enter');
}
async function makeDirty(page: Page) {
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  await command(page, 'B');
  await command(page, '0,0');
  await command(page, '1000,0');
  await command(page, '');
  await page.keyboard.press('Escape');
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
});

test('A, B e A novamente resulta em A/B sem duplicar; mesmo nome continua distinguível', async ({
  page,
}) => {
  await openFile(page, 'A', 'id-a', 'a.json');
  await openFile(page, 'B', 'id-b', 'b.json');
  await openFile(page, 'A', 'id-a', 'a.json');
  await showRecents(page);
  expect(await titles(page)).toEqual(['A', 'B']);
  await recents(page)
    .getByRole('button', { name: 'Fechar Projetos recentes' })
    .click();
  await openFile(page, 'Projeto', 'id-1', 'projeto.json');
  await openFile(page, 'Projeto', 'id-2', 'projeto.json');
  await showRecents(page);
  const t = await titles(page);
  expect(t.slice(0, 2)).toEqual(['Projeto · ID id-2', 'Projeto · ID id-1']);
  await expect(recents(page)).toContainText(
    'neste navegador o caminho não fica disponível',
  );
});

test('reabrir recente pede nova seleção e abre pelo fluxo de leitura existente', async ({
  page,
}) => {
  await openFile(page, 'A', 'id-a', 'a.json');
  await openFile(page, 'B', 'id-b', 'b.json');
  await showRecents(page);
  const chooser = page.waitForEvent('filechooser');
  await recents(page)
    .getByRole('button', { name: 'Reabrir A', exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: 'a.json',
    mimeType: 'application/json',
    buffer: Buffer.from(fixture('A', 'id-a')),
  });
  await expect(recents(page)).toHaveCount(0);
  await expect(
    page.getByRole('banner').getByText('A', { exact: true }),
  ).toBeVisible();
});

test('cancelar a seleção não troca o projeto nem registra entrada', async ({
  page,
}) => {
  await openFile(page, 'A', 'id-a');
  await showRecents(page);
  const chooser = page.waitForEvent('filechooser');
  await recents(page)
    .getByRole('button', { name: 'Reabrir A', exact: true })
    .click();
  await chooser; // seletor aberto e fechado sem escolher: nenhum evento de mudança
  expect(await titles(page)).toEqual(['A']);
  await expect(
    page.getByRole('banner').getByText('A', { exact: true }),
  ).toBeVisible();
});

test('arquivo inválido ou indisponível mantém o projeto e orienta o usuário', async ({
  page,
}) => {
  await openFile(page, 'A', 'id-a', 'a.json');
  await showRecents(page);
  const chooser = page.waitForEvent('filechooser');
  await recents(page)
    .getByRole('button', { name: 'Reabrir A', exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: 'quebrado.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ não é projeto'),
  });
  await expect(recents(page).getByRole('status')).toContainText(
    'O projeto atual foi mantido',
  );
  await expect(recents(page).getByRole('status')).toContainText(
    'selecione o arquivo novamente ou remova este item',
  );
  expect(await titles(page)).toEqual(['A']);
  await recents(page)
    .getByRole('button', { name: 'Fechar Projetos recentes' })
    .click();
  await expect(
    page.getByRole('banner').getByText('A', { exact: true }),
  ).toBeVisible();
});

test('abrir um recente respeita alterações não salvas', async ({ page }) => {
  await openFile(page, 'A', 'id-a', 'a.json');
  await openFile(page, 'B', 'id-b', 'b.json');
  await makeDirty(page);
  const undoBefore = await page
    .getByRole('button', { name: 'Desfazer' })
    .isEnabled();
  expect(undoBefore).toBe(true);
  const reopen = async () => {
    await showRecents(page);
    const chooser = page.waitForEvent('filechooser');
    await recents(page)
      .getByRole('button', { name: 'Reabrir A', exact: true })
      .click();
    await (
      await chooser
    ).setFiles({
      name: 'a.json',
      mimeType: 'application/json',
      buffer: Buffer.from(fixture('A', 'id-a')),
    });
  };
  await reopen();
  const guard = recents(page).getByRole('alertdialog');
  await expect(guard).toContainText('alterações não salvas');
  await guard.getByRole('button', { name: 'Cancelar' }).click();
  await expect(
    page.getByRole('banner').getByText('B', { exact: true }),
  ).toBeVisible();
  await expect(recents(page).getByRole('status')).toContainText('cancelada');
  await recents(page)
    .getByRole('button', { name: 'Fechar Projetos recentes' })
    .click();
  await reopen();
  const download = page.waitForEvent('download');
  await recents(page)
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Salvar e abrir' })
    .click();
  await download;
  await expect(recents(page)).toHaveCount(0);
  await expect(
    page.getByRole('banner').getByText('A', { exact: true }),
  ).toBeVisible();
});

test('abrir sem salvar substitui o projeto depois de confirmação explícita', async ({
  page,
}) => {
  await openFile(page, 'A', 'id-a', 'a.json');
  await openFile(page, 'B', 'id-b', 'b.json');
  await makeDirty(page);
  await showRecents(page);
  const chooser = page.waitForEvent('filechooser');
  await recents(page)
    .getByRole('button', { name: 'Reabrir A', exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: 'a.json',
    mimeType: 'application/json',
    buffer: Buffer.from(fixture('A', 'id-a')),
  });
  await recents(page).getByRole('button', { name: 'Abrir sem salvar' }).click();
  await expect(recents(page)).toHaveCount(0);
  await expect(
    page.getByRole('banner').getByText('A', { exact: true }),
  ).toBeVisible();
});

test('abrir o menu, remover e limpar não alteram o projeto nem o desfazer', async ({
  page,
}) => {
  await openFile(page, 'A', 'id-a', 'a.json');
  await openFile(page, 'B', 'id-b', 'b.json');
  await makeDirty(page);
  const undo = page.getByRole('button', { name: 'Desfazer' });
  const redo = page.getByRole('button', { name: 'Refazer' });
  const before = [await undo.isEnabled(), await redo.isEnabled()];
  await expect(page.locator('.save-status')).toHaveText(
    'Apenas recuperável localmente',
  );
  const status = await page.locator('.save-status').textContent();
  await showRecents(page);
  await recents(page)
    .getByRole('button', { name: 'Remover A do histórico' })
    .click();
  expect(await titles(page)).toEqual(['B']);
  await recents(page).getByRole('button', { name: 'Limpar histórico' }).click();
  await recents(page)
    .getByRole('button', { name: 'Confirmar limpeza' })
    .click();
  await expect(recents(page)).toContainText('Nenhum projeto recente');
  await recents(page)
    .getByRole('button', { name: 'Fechar Projetos recentes' })
    .click();
  expect([await undo.isEnabled(), await redo.isEnabled()]).toEqual(before);
  await expect(page.locator('.save-status')).toHaveText(status ?? '');
  await expect(
    page.getByRole('banner').getByText('B', { exact: true }),
  ).toBeVisible();
});

test('reiniciar conserva os recentes, mas não concede acesso', async ({
  page,
}) => {
  await openFile(page, 'A', 'id-a', 'a.json');
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await showRecents(page);
  expect(await titles(page)).toEqual(['A']);
  const chooser = page.waitForEvent('filechooser');
  await recents(page)
    .getByRole('button', { name: 'Reabrir A', exact: true })
    .click();
  await chooser; // sem handle autorizado: o navegador exige nova seleção
});

test('histórico corrompido não impede o editor', async ({ page }) => {
  await page.evaluate(() =>
    localStorage.setItem(
      'armadurastruct.recent.v1',
      '{"v":1,"items":[{"x":1},null',
    ),
  );
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await showRecents(page);
  await expect(recents(page)).toContainText('Nenhum projeto recente');
});

test('projeto em pasta: reabrir pede nova escolha da pasta e falha de acesso mantém o projeto', async ({
  page,
}) => {
  await page.addInitScript(installDirectoryMock);
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Novo projeto', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Novo projeto',
    exact: true,
  });
  await dialog
    .getByLabel('Nome do projeto', { exact: true })
    .fill('Obra em pasta');
  const ack = dialog.getByRole('checkbox', {
    name: 'Confirmar substituição do projeto atual',
    exact: true,
  });
  if (await ack.isVisible()) await ack.check();
  await dialog
    .getByRole('button', { name: 'Escolher pasta', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Criar projeto', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await openFile(page, 'Outro', 'id-outro', 'outro.json');
  await showRecents(page);
  expect((await titles(page))[1]).toBe('Obra em pasta');
  await expect(recents(page)).toContainText('Projeto em pasta');
  await page.evaluate(() => {
    (window as unknown as { folderMock: DirectoryMock }).folderMock.denied =
      true;
  });
  await recents(page)
    .getByRole('button', { name: 'Reabrir Obra em pasta' })
    .click();
  await expect(recents(page).getByRole('status')).toContainText(
    'O projeto atual foi mantido',
  );
  await page.evaluate(() => {
    (window as unknown as { folderMock: DirectoryMock }).folderMock.denied =
      false;
  });
  await recents(page)
    .getByRole('button', { name: 'Reabrir Obra em pasta' })
    .click();
  await expect(recents(page)).toHaveCount(0);
  await expect(
    page.getByRole('banner').getByText('Obra em pasta', { exact: true }),
  ).toBeVisible();
});
