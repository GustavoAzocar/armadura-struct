import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
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
const openFile = async (page: Page, name: string, id: string) => {
  await page.getByTestId('project-input').setInputFiles({
    name: `${id}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(fixture(name, id)),
  });
  await expect(
    page.getByRole('banner').getByText(name, { exact: true }),
  ).toBeVisible();
};
const startScreen = (page: Page) =>
  page.getByRole('main', { name: 'Sem projeto aberto' });
const closeDialog = (page: Page) =>
  page.getByRole('alertdialog', { name: 'Fechar projeto' });
async function closeFromRibbon(page: Page) {
  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  await page
    .getByRole('button', { name: 'Fechar projeto', exact: true })
    .click();
}
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
async function save(page: Page) {
  const event = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
}
async function expectStartScreen(page: Page) {
  await expect(startScreen(page)).toBeVisible();
  await expect(page.locator('.window-project')).toHaveText(
    'Sem projeto aberto',
  );
  // Comandos que dependem de projeto não ficam acessíveis.
  await expect(page.getByRole('textbox', { name: 'Comando CAD' })).toBeHidden();
  await expect(
    page.getByRole('tab', { name: 'Armaduras', exact: true }),
  ).toBeHidden();
  await expect(
    page.locator('.quick-tools').getByRole('button', { name: 'Desfazer' }),
  ).toBeDisabled();
  await expect(
    page
      .locator('.quick-tools')
      .getByRole('button', { name: 'Salvar projeto', exact: true }),
  ).toBeDisabled();
}
const recoveryKeys = (page: Page) =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('armadurastruct', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const get = (key: string) =>
      new Promise<string | undefined>((resolve) => {
        const r = db.transaction('projects').objectStore('projects').get(key);
        r.onsuccess = () => resolve(r.result);
      });
    const value = {
      current: await get('current'),
      closed: await get('closed'),
    };
    db.close();
    return value;
  });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
});

test('projeto salvo fecha direto para a tela inicial, sem baixar nem alterar arquivos', async ({
  page,
}) => {
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await openFile(page, 'Obra A', 'id-a');
  await closeFromRibbon(page);
  await expect(closeDialog(page)).toHaveCount(0);
  await expectStartScreen(page);
  expect(downloads).toEqual([]);
  // Recentes preservados e acessíveis pela tela inicial.
  await startScreen(page)
    .getByRole('button', { name: /Projetos recentes/ })
    .click();
  const recents = page.getByRole('dialog', { name: 'Projetos recentes' });
  await expect(recents.locator('.recent-info strong')).toHaveText(['Obra A']);
  await recents
    .getByRole('button', { name: 'Fechar Projetos recentes' })
    .click();
  await expect(startScreen(page)).toBeVisible();
  // A cópia de recuperação não é apagada; só não é reaberta sozinha.
  const stored = await recoveryKeys(page);
  expect(stored.closed).toBeDefined();
});

test('reiniciar após fechar mantém a tela inicial; sem fechar, a recuperação continua', async ({
  page,
}) => {
  await openFile(page, 'Obra A', 'id-a');
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await expect(
    page.getByRole('banner').getByText('Obra A', { exact: true }),
  ).toBeVisible();
  // Restaurado da recuperação local conta como não salvo: confirma antes.
  await closeFromRibbon(page);
  await closeDialog(page)
    .getByRole('button', { name: 'Fechar sem salvar' })
    .click();
  await expectStartScreen(page);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await expectStartScreen(page);
  // Abrir outro projeto volta a usar a recuperação normalmente.
  await openFile(page, 'Obra B', 'id-b');
  await page.waitForTimeout(900);
  expect((await recoveryKeys(page)).closed).toBeUndefined();
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await expect(
    page.getByRole('banner').getByText('Obra B', { exact: true }),
  ).toBeVisible();
});

test('alterações não salvas: Cancelar e Esc mantêm o projeto; Fechar sem salvar volta à tela inicial', async ({
  page,
}) => {
  await openFile(page, 'Obra A', 'id-a');
  await makeDirty(page);
  await closeFromRibbon(page);
  await expect(closeDialog(page)).toContainText('alterações não salvas');
  await expect(closeDialog(page)).toContainText('Nenhum arquivo');
  await expect(
    closeDialog(page).getByRole('button', { name: 'Cancelar' }),
  ).toBeFocused();
  await closeDialog(page).getByRole('button', { name: 'Cancelar' }).click();
  await expect(closeDialog(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Desfazer' })).toBeEnabled();
  await expect(
    page.getByRole('banner').getByText('Obra A', { exact: true }),
  ).toBeVisible();
  await closeFromRibbon(page);
  await expect(closeDialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(closeDialog(page)).toHaveCount(0);
  expect((await save(page)).bars).toHaveLength(1);
  await makeDirty(page);
  await closeFromRibbon(page);
  await closeDialog(page)
    .getByRole('button', { name: 'Fechar sem salvar' })
    .click();
  await expectStartScreen(page);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await expectStartScreen(page);
});

test('Salvar e fechar no navegador não trata o download como gravação confirmada', async ({
  page,
}) => {
  await openFile(page, 'Obra A', 'id-a');
  await makeDirty(page);
  await closeFromRibbon(page);
  const download = page.waitForEvent('download');
  await closeDialog(page)
    .getByRole('button', { name: 'Salvar e fechar' })
    .click();
  const saved = JSON.parse(
    readFileSync((await (await download).path())!, 'utf8'),
  );
  expect(saved.bars).toHaveLength(1);
  await expect(closeDialog(page)).toContainText('O navegador não confirma');
  // Ainda aberto até a confirmação explícita da cópia.
  await expect(startScreen(page)).toHaveCount(0);
  await closeDialog(page).getByRole('button', { name: 'Cancelar' }).click();
  await expect(
    page.getByRole('banner').getByText('Obra A', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Desfazer' })).toBeEnabled();
  await closeFromRibbon(page);
  const again = page.waitForEvent('download');
  await closeDialog(page)
    .getByRole('button', { name: 'Salvar e fechar' })
    .click();
  await again;
  await closeDialog(page)
    .getByRole('button', { name: 'Confirmar cópia e fechar' })
    .click();
  await expectStartScreen(page);
});

test('projeto apenas recuperável localmente pede confirmação antes de fechar', async ({
  page,
}) => {
  await openFile(page, 'Recuperado', 'id-r');
  await makeDirty(page);
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await closeFromRibbon(page);
  await expect(closeDialog(page)).toContainText('alterações não salvas');
  await expect(closeDialog(page)).toContainText('cópia de recuperação local');
  await closeDialog(page).getByRole('button', { name: 'Cancelar' }).click();
  expect((await save(page)).bars).toHaveLength(1);
});

test('depois de fechar, Novo e Abrir criam contextos independentes; cancelar mantém a tela inicial', async ({
  page,
}) => {
  // Navegador sem seletor de pasta: Novo projeto pode criar sem pasta.
  await page.evaluate(() =>
    Object.defineProperty(window, 'showDirectoryPicker', {
      value: undefined,
      configurable: true,
    }),
  );
  await openFile(page, 'Obra A', 'id-a');
  await makeDirty(page);
  await closeFromRibbon(page);
  await closeDialog(page)
    .getByRole('button', { name: 'Fechar sem salvar' })
    .click();
  await expectStartScreen(page);
  // Cancelar o seletor de arquivo não abre nada.
  const chooser = page.waitForEvent('filechooser');
  await startScreen(page)
    .getByRole('button', { name: 'Abrir projeto', exact: true })
    .click();
  await chooser;
  await expect(startScreen(page)).toBeVisible();
  // Cancelar o assistente de Novo projeto mantém a tela inicial.
  await startScreen(page)
    .getByRole('button', { name: 'Novo projeto', exact: true })
    .click();
  const setup = page.getByRole('dialog', { name: 'Novo projeto', exact: true });
  await expect(
    setup.getByRole('checkbox', {
      name: 'Confirmar substituição do projeto atual',
    }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(setup).toHaveCount(0);
  await expect(startScreen(page)).toBeVisible();
  // Criar um projeto novo: nada herdado do anterior.
  await startScreen(page)
    .getByRole('button', { name: 'Novo projeto', exact: true })
    .click();
  await setup.getByLabel('Nome do projeto', { exact: true }).fill('Obra nova');
  await setup
    .getByRole('button', { name: 'Criar projeto', exact: true })
    .click();
  await expect(setup).toHaveCount(0);
  await expect(startScreen(page)).toHaveCount(0);
  await expect(
    page.getByRole('banner').getByText('Obra nova', { exact: true }),
  ).toBeVisible();
  const created = await save(page);
  expect(created.name).toBe('Obra nova');
  expect(created.bars).toEqual([]);
  // Desfazer não volta ao marcador vazio nem ao projeto fechado.
  await expect(page.getByRole('button', { name: 'Desfazer' })).toBeDisabled();
  await page.keyboard.press('Control+z');
  await expect(
    page.getByRole('banner').getByText('Obra nova', { exact: true }),
  ).toBeVisible();
});

test('sem projeto, atalhos de projeto não agem e Ctrl+O continua disponível', async ({
  page,
}) => {
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await openFile(page, 'Obra A', 'id-a');
  await closeFromRibbon(page);
  await expectStartScreen(page);
  await page.keyboard.press('Control+s');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Delete');
  await expect(page.locator('.toast')).toContainText('Abra ou crie um projeto');
  expect(downloads).toEqual([]);
  await expectStartScreen(page);
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  await (
    await chooser
  ).setFiles({
    name: 'b.json',
    mimeType: 'application/json',
    buffer: Buffer.from(fixture('Obra B', 'id-b')),
  });
  await expect(startScreen(page)).toHaveCount(0);
  await expect(
    page.getByRole('banner').getByText('Obra B', { exact: true }),
  ).toBeVisible();
});

test('comando CAD em andamento e cliques repetidos não fecham nem duplicam a confirmação', async ({
  page,
}) => {
  await openFile(page, 'Obra A', 'id-a');
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  await command(page, 'B');
  await command(page, '0,0');
  await closeFromRibbon(page);
  await expect(page.locator('.toast')).toContainText(
    'Conclua ou cancele o comando em andamento antes de fechar o projeto',
  );
  await expect(startScreen(page)).toHaveCount(0);
  await expect(
    page.getByRole('banner').getByText('Obra A', { exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await makeDirty(page);
  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  const button = page.getByRole('button', {
    name: 'Fechar projeto',
    exact: true,
  });
  await button.click();
  await expect(closeDialog(page)).toHaveCount(1);
  await page.keyboard.press('Control+s');
  await expect(closeDialog(page)).toHaveCount(1);
  await closeDialog(page)
    .getByRole('button', { name: 'Fechar sem salvar' })
    .click();
  await expectStartScreen(page);
});

test('falha ao registrar o fechamento mantém o projeto aberto e avisa', async ({
  page,
}) => {
  await openFile(page, 'Obra A', 'id-a');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    Object.assign(window, {
      restorePut: () => (IDBObjectStore.prototype.put = put),
    });
    IDBObjectStore.prototype.put = function (value, key) {
      if (key === 'closed')
        throw new DOMException('Cota excedida', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  });
  await closeFromRibbon(page);
  await expect(page.locator('.toast')).toContainText(
    'Não foi possível registrar o fechamento',
  );
  await expect(startScreen(page)).toHaveCount(0);
  await expect(
    page.getByRole('banner').getByText('Obra A', { exact: true }),
  ).toBeVisible();
  // A recuperação do projeto aberto continua funcionando.
  await makeDirty(page);
  await page.waitForTimeout(900);
  const raw = (await recoveryKeys(page)).current;
  expect(JSON.parse(raw!).bars).toHaveLength(1);
  await page.evaluate(() =>
    (window as unknown as { restorePut: () => void }).restorePut(),
  );
  await closeFromRibbon(page);
  await closeDialog(page)
    .getByRole('button', { name: 'Fechar sem salvar' })
    .click();
  await expectStartScreen(page);
});

test('fechar logo após editar não deixa autosave atrasado reativar o projeto', async ({
  page,
}) => {
  await openFile(page, 'Obra A', 'id-a');
  await page.waitForTimeout(900);
  const before = (await recoveryKeys(page)).current;
  await makeDirty(page);
  await closeFromRibbon(page);
  await closeDialog(page)
    .getByRole('button', { name: 'Fechar sem salvar' })
    .click();
  await expectStartScreen(page);
  await page.waitForTimeout(1200);
  const after = await recoveryKeys(page);
  expect(after.closed).toBeDefined();
  // A alteração descartada não foi gravada depois do fechamento.
  expect(JSON.parse(after.current!).bars).toEqual(JSON.parse(before!).bars);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await expectStartScreen(page);
});

test('projeto em pasta: fechar não sobrescreve nem esvazia a pasta; reabrir funciona', async ({
  page,
}) => {
  await page.addInitScript(installDirectoryMock);
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Novo projeto', exact: true })
    .click();
  const setup = page.getByRole('dialog', { name: 'Novo projeto', exact: true });
  await setup
    .getByLabel('Nome do projeto', { exact: true })
    .fill('Obra em pasta');
  const ack = setup.getByRole('checkbox', {
    name: 'Confirmar substituição do projeto atual',
    exact: true,
  });
  if (await ack.isVisible()) await ack.check();
  await setup
    .getByRole('button', { name: 'Escolher pasta', exact: true })
    .click();
  await setup
    .getByRole('button', { name: 'Criar projeto', exact: true })
    .click();
  await expect(setup).toHaveCount(0);
  await makeDirty(page);
  await expect(page.locator('.save-status')).toHaveText(
    'Salvo na pasta do projeto',
  );
  const folder = () =>
    page.evaluate(() => {
      const mock = (window as unknown as { folderMock: DirectoryMock })
        .folderMock;
      return {
        writes: mock.writes.length,
        files: Object.fromEntries(mock.roots.A.files),
      };
    });
  const before = await folder();
  const file = Object.entries(before.files).find(([k]) =>
    k.endsWith('projeto.armstruct.json'),
  );
  expect(JSON.parse(file![1]).bars).toHaveLength(1);
  await closeFromRibbon(page);
  await expect(closeDialog(page)).toHaveCount(0);
  await expectStartScreen(page);
  await page.waitForTimeout(900);
  expect(await folder()).toEqual(before);
  // Reabrir pelo fluxo normal (nova escolha da pasta).
  await startScreen(page)
    .getByRole('button', { name: /Projetos recentes/ })
    .click();
  const recents = page.getByRole('dialog', { name: 'Projetos recentes' });
  await recents.getByRole('button', { name: 'Reabrir Obra em pasta' }).click();
  await expect(recents).toHaveCount(0);
  await expect(
    page.getByRole('banner').getByText('Obra em pasta', { exact: true }),
  ).toBeVisible();
  // Reaberto com o conteúdo gravado; o arquivo da pasta segue íntegro.
  await expect(page.locator('.save-status')).toHaveText(
    'Salvo na pasta do projeto',
  );
  const reopened = Object.entries((await folder()).files).find(([k]) =>
    k.endsWith('projeto.armstruct.json'),
  );
  expect(JSON.parse(reopened![1]).bars).toHaveLength(1);
});

test('tela inicial em janela pequena e por teclado', async ({ page }) => {
  await openFile(page, 'Obra A', 'id-a');
  await closeFromRibbon(page);
  await page.setViewportSize({ width: 640, height: 560 });
  await expect(
    startScreen(page).getByRole('heading', { name: 'Sem projeto aberto' }),
  ).toBeFocused();
  for (const name of ['Novo projeto', 'Abrir projeto']) {
    await page.keyboard.press('Tab');
    await expect(
      startScreen(page).getByRole('button', { name, exact: true }),
    ).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(
    startScreen(page).getByRole('button', { name: /Projetos recentes/ }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('dialog', { name: 'Projetos recentes' }),
  ).toBeVisible();
  const box = await startScreen(page)
    .getByRole('button', { name: 'Novo projeto', exact: true })
    .boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(640);
});
