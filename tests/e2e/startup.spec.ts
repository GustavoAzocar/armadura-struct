import {
  confirmProjectReplacement,
  useCompatibleProjectFolders,
} from './projectSetup.helpers';
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject, newBar } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
async function save(page: Page) {
  const event = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
}
async function expectNoExampleUi(page: Page) {
  await expect(page.getByText('Exemplo ArmaduraStruct')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Conferir exemplo', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Carregar projeto de exemplo' }),
  ).toHaveCount(0);
}

test('without a recoverable project the app starts empty, with no demonstration content', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await expectNoExampleUi(page);
  const p = await save(page);
  expect(p.name).toBe('Novo projeto');
  expect(p.bars).toEqual([]);
  expect(p.masks).toEqual([]);
  expect(p.details).toEqual([]);
  expect(p.annotations).toEqual([]);
  expect(errors).toEqual([]);
});

test('an existing recovered project is reopened unchanged; New remains empty', async ({
  page,
}) => {
  const p = completeOwnership({
    ...emptyProject(),
    name: 'Projeto do usuário',
    bars: [{ ...newBar('N1'), quantity: 7 }],
  });
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'user.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  expect(await save(page)).toEqual(p);
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect(await save(page)).toEqual(p);
  await expectNoExampleUi(page);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Novo projeto', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByLabel('Nome do projeto', { exact: true })
    .fill('Vazio');
  await confirmProjectReplacement(page);
  await page
    .getByRole('button', { name: 'Criar projeto', exact: true })
    .click();
  const created = await save(page);
  expect(created.name).toBe('Vazio');
  expect(created.bars).toEqual([]);
});

test('a damaged recovery is kept intact instead of being overwritten by autosave', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.waitForTimeout(900);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('armadurastruct', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite');
      tx.objectStore('projects').put('{damaged-recovery', 'current');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(
    'Não foi possível recuperar',
  );
  await page.waitForTimeout(900);
  const raw = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('armadurastruct', 1);
      r.onsuccess = () => resolve(r.result);
    });
    const value = await new Promise((resolve) => {
      const r = db
        .transaction('projects')
        .objectStore('projects')
        .get('current');
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return value;
  });
  expect(raw).toBe('{damaged-recovery');
});

useCompatibleProjectFolders();
