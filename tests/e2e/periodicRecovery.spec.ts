import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject } from '../../src/domain/model';
import type { Project } from '../../src/domain/types';
import type { RecoveryCopy } from '../../src/lib/periodicRecovery';
import {
  installDirectoryMock,
  type DirectoryMock,
} from '../fixtures/projectDirectory';

const recovery = (page: Page) =>
  page.getByRole('dialog', { name: 'Salvamento e recuperação', exact: true });
const recoveryButton = (page: Page) =>
  page.getByRole('button', { name: 'Salvamento e recuperação', exact: true });
const confirmation = (page: Page) => page.getByRole('alertdialog');
const autosaveStatus = (page: Page) =>
  page.getByText('Apenas recuperável localmente', { exact: true });
const projectName = 'Obra de recuperação';

async function openFixture(page: Page) {
  const fixture = { ...emptyProject(), name: projectName };
  await page.getByTestId('project-input').setInputFiles({
    name: 'recuperacao.armstruct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.locator('.window-project')).toHaveText(projectName);
}

async function openRecovery(page: Page) {
  await page.getByRole('tab', { name: 'CONFIGURAÇÕES', exact: true }).click();
  await recoveryButton(page).click();
  await expect(recovery(page)).toBeVisible();
}

async function saveProjectCopy(page: Page): Promise<Project> {
  const pending = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await pending).path())!, 'utf8'));
}

async function addBar(page: Page, y: number) {
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  const command = page.getByRole('textbox', { name: 'Comando CAD' });
  for (const text of ['B', `0,${y}`, `1000,${y}`, '']) {
    await command.fill(text);
    await command.press('Enter');
  }
  await page.keyboard.press('Escape');
}

function expectFreshCopy(dialog: ReturnType<typeof recovery>) {
  const copy = dialog.getByRole('listitem').filter({ hasText: projectName });
  return expect(copy).toContainText(/Armazenamento local · Íntegra/);
}

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
});

test('preferências têm padrão, rascunho cancelável e persistência independente do projeto', async ({
  page,
}) => {
  await openFixture(page);
  const before = await saveProjectCopy(page);
  await openRecovery(page);
  const dialog = recovery(page);
  const enabled = dialog.getByRole('checkbox', {
    name: 'Ativar cópias periódicas',
  });
  const interval = dialog.getByRole('combobox', { name: 'Intervalo' });
  await expect(enabled).toBeChecked();
  await expect(enabled).toBeFocused();
  await expect(interval).toHaveValue('5');
  await expect(interval.getByRole('option')).toHaveText([
    '1 minuto',
    '2 minutos',
    '5 minutos',
    '10 minutos',
  ]);
  await interval.selectOption('10');
  await enabled.uncheck();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(recoveryButton(page)).toBeFocused();

  await openRecovery(page);
  await expect(enabled).toBeChecked();
  await expect(interval).toHaveValue('5');
  await interval.selectOption('2');
  await enabled.uncheck();
  await dialog.getByRole('button', { name: 'Salvar preferências' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await saveProjectCopy(page)).toEqual(before);

  await page.clock.fastForward(1_000);
  await expect(autosaveStatus(page)).toBeVisible();
  await page.reload();
  await expect(page.locator('.window-project')).toHaveText(projectName);
  await openRecovery(page);
  await expect(enabled).not.toBeChecked();
  await expect(interval).toHaveValue('2');
  await expect(dialog.getByText('Cópias periódicas desativadas')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await addBar(page, 0);
  await page.clock.fastForward(121_000);
  await expect(autosaveStatus(page)).toBeVisible();
  await openRecovery(page);
  await expect(
    dialog.getByText('Nenhuma cópia periódica disponível.'),
  ).toBeVisible();
});

test('cópia local sobrevive à recarga e a recuperação protege a edição mais recente', async ({
  page,
}) => {
  await openFixture(page);
  await openRecovery(page);
  const dialog = recovery(page);
  await dialog.getByRole('combobox', { name: 'Intervalo' }).selectOption('1');
  await dialog.getByRole('button', { name: 'Salvar preferências' }).click();

  await addBar(page, 0);
  const copied = await saveProjectCopy(page);
  expect(copied.bars).toHaveLength(1);
  await page.clock.fastForward(61_000);
  await openRecovery(page);
  await expectFreshCopy(dialog);
  const restore = dialog.getByRole('button', { name: 'Recuperar cópia' });
  await expect(restore).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();

  await addBar(page, 300);
  await page.clock.fastForward(1_000);
  await expect(autosaveStatus(page)).toBeVisible();
  await page.reload();
  await expect(page.locator('.window-project')).toHaveText(projectName);
  expect((await saveProjectCopy(page)).bars).toHaveLength(2);
  await openRecovery(page);
  await expectFreshCopy(dialog);

  await restore.click();
  await expect(confirmation(page)).toContainText('alterações não salvas');
  await confirmation(page).getByRole('button', { name: 'Cancelar' }).click();
  await expect(confirmation(page)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect((await saveProjectCopy(page)).bars).toHaveLength(2);

  await openRecovery(page);
  await restore.click();
  await confirmation(page)
    .getByRole('button', { name: /sem salvar/i })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(await saveProjectCopy(page)).toEqual(copied);
});

test('fechar explicitamente preserva a lista e não abre a cópia sem escolha', async ({
  page,
}) => {
  await openFixture(page);
  await addBar(page, 0);
  await page.clock.fastForward(301_000);
  const dialog = recovery(page);
  await openRecovery(page);
  await expectFreshCopy(dialog);
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();

  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  await page
    .getByRole('button', { name: 'Fechar projeto', exact: true })
    .click();
  await confirmation(page)
    .getByRole('button', { name: /sem salvar/i })
    .click();
  const start = page.getByRole('main', { name: 'Sem projeto aberto' });
  await expect(start).toBeVisible();
  await page.reload();
  await page.clock.fastForward(601_000);
  await expect(start).toBeVisible();

  await start.getByRole('button', { name: 'Salvamento e recuperação' }).click();
  await expectFreshCopy(dialog);
  const restore = dialog.getByRole('button', { name: 'Recuperar cópia' });
  await expect(restore).toHaveCount(1);
  await restore.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.window-project')).toHaveText(projectName);
  expect((await saveProjectCopy(page)).bars).toHaveLength(1);
});

test('quarta cópia local gira as três versões e uma falha preserva o inventário', async ({
  page,
}) => {
  await openFixture(page);
  await openRecovery(page);
  const dialog = recovery(page);
  await dialog.getByRole('combobox', { name: 'Intervalo' }).selectOption('1');
  await dialog.getByRole('button', { name: 'Salvar preferências' }).click();
  const status = page.locator('.periodic-recovery-status');
  let oldest: string | null = null;
  for (let i = 0; i < 4; i++) {
    const prior = await status.textContent();
    await addBar(page, 300 * i);
    await page.clock.fastForward(61_000);
    await expect(status).not.toHaveText(prior!);
    await expect(status).toContainText('somente local');
    if (i === 0) {
      await openRecovery(page);
      await expectFreshCopy(dialog);
      oldest = await dialog.locator('time').getAttribute('datetime');
      await dialog
        .getByRole('button', { name: 'Cancelar', exact: true })
        .click();
    }
  }
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.transaction.db.name === 'armadurastruct-periodic-recovery')
        throw new DOMException(
          'Quota simulada no histórico',
          'QuotaExceededError',
        );
      return put.call(this, value, key);
    };
  });
  await addBar(page, 1200);
  await page.clock.fastForward(61_000);
  await expect(status).toHaveText('Falha na cópia periódica');
  expect((await saveProjectCopy(page)).bars).toHaveLength(5);
  await openRecovery(page);
  await expect(
    dialog.getByRole('button', { name: 'Recuperar cópia' }),
  ).toHaveCount(3);
  await expect(dialog.locator(`time[datetime="${oldest}"]`)).toHaveCount(0);
});

test('a reautorização concilia as três gerações mais recentes após fallback local', async ({
  page,
}) => {
  await page.evaluate(installDirectoryMock);
  const mainPath = 'save-v1/projeto.armstruct.json';
  const historyPath = 'recovery-v1/copies.json';
  const readFolder = () =>
    page.evaluate(() => {
      const folder = (window as unknown as { folderMock: DirectoryMock })
        .folderMock;
      return {
        files: Object.fromEntries(folder.roots.A.files),
        writes: folder.writes.length,
      };
    });
  const copiesInFolder = async (): Promise<RecoveryCopy[]> => {
    const raw = (await readFolder()).files[historyPath];
    return raw ? JSON.parse(raw).copies : [];
  };
  const copiedBarCounts = async () =>
    (await copiesInFolder()).map(
      (copy) => (JSON.parse(copy.raw) as Project).bars.length,
    );
  const setDenied = (denied: boolean) =>
    page.evaluate((value) => {
      (window as unknown as { folderMock: DirectoryMock }).folderMock.denied =
        value;
    }, denied);
  const associateFolder = async () => {
    const dismiss = page.getByRole('button', {
      name: 'Fechar aviso',
      exact: true,
    });
    if (await dismiss.isVisible()) await dismiss.click();
    await page
      .locator('.folder-menu')
      .getByText('Arquivos do projeto', { exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Localizar/associar pasta', exact: true })
      .click();
    await expect(
      page.getByText('Salvo na pasta do projeto', { exact: true }),
    ).toBeVisible();
  };

  await openFixture(page);
  await associateFolder();
  await openRecovery(page);
  const dialog = recovery(page);
  await dialog.getByRole('combobox', { name: 'Intervalo' }).selectOption('1');
  await dialog.getByRole('button', { name: 'Salvar preferências' }).click();

  for (let edit = 1; edit <= 3; edit++) {
    await addBar(page, 300 * (edit - 1));
    await page.clock.fastForward(61_000);
    await expect.poll(async () => (await copiedBarCounts())[0]).toBe(edit);
  }
  await expect.poll(copiedBarCounts).toEqual([3, 2, 1]);
  const lastFolderCopy = (await copiesInFolder())[0];
  const beforeDenial = await readFolder();
  expect(
    (JSON.parse(beforeDenial.files[mainPath]) as Project).bars,
  ).toHaveLength(3);

  await setDenied(true);
  await page.clock.setSystemTime(new Date(lastFolderCopy.copiedAt - 3_600_000));
  const status = page.locator('.periodic-recovery-status');
  for (const offset of [900, 1200]) {
    const prior = await status.textContent();
    await addBar(page, offset);
    await page.clock.fastForward(61_000);
    await expect(status).not.toHaveText(prior!);
    await expect(status).toContainText('somente local');
  }
  expect(await readFolder()).toEqual(beforeDenial);
  await openRecovery(page);
  await expect(
    dialog.getByRole('listitem').filter({ hasText: 'Armazenamento local' }),
  ).toHaveCount(2);
  await expect(
    dialog.getByText(
      'Não foi possível consultar as cópias na pasta autorizada.',
      {
        exact: true,
      },
    ),
  ).toBeVisible();

  // Consultar um histórico precisa permitir sua leitura sem associar a pasta.
  await setDenied(false);
  await dialog.getByRole('button', { name: 'Consultar pasta…' }).click();
  await expect(
    dialog
      .getByRole('listitem')
      .filter({ hasText: 'Pasta do projeto' })
      .first(),
  ).toBeVisible();
  expect(await readFolder()).toEqual(beforeDenial);
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();

  await associateFolder();
  await expect.poll(copiedBarCounts).toEqual([5, 4, 3]);
  const reconciled = await copiesInFolder();
  expect(reconciled[2].id).toBe(lastFolderCopy.id);
  expect(reconciled.map((copy) => copy.projectId)).toEqual(
    Array(3).fill(lastFolderCopy.projectId),
  );
  const primary = (await readFolder()).files[mainPath];
  expect((JSON.parse(primary) as Project).bars).toHaveLength(5);

  await page.clock.fastForward(1_000);
  await expect(
    page.getByText('Salvo na pasta do projeto', { exact: true }),
  ).toBeVisible();
  await openRecovery(page);
  const restore = dialog.getByRole('button', { name: 'Recuperar cópia' });
  await expect(restore).toHaveCount(3);
  await expect(
    dialog.getByRole('listitem').filter({ hasText: 'Armazenamento local' }),
  ).toHaveCount(0);
  await restore.last().click();
  await expect(dialog).toHaveCount(0);
  await page.clock.fastForward(1_000);
  await expect(autosaveStatus(page)).toBeVisible();
  expect((await saveProjectCopy(page)).bars).toHaveLength(3);
  expect((await readFolder()).files[mainPath]).toBe(primary);
});
