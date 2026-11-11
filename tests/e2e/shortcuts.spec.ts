import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import { nativePrimitive, newNativeMask } from '../../src/domain/nativeMasks';
import type { Project } from '../../src/domain/types';

const panel = (page: Page) =>
  page.getByRole('dialog', { name: 'Atalhos de teclado' });
const tab = (page: Page, name: string) =>
  page.getByRole('tab', { name, exact: true });
const input = (page: Page) =>
  page.getByRole('textbox', { name: 'Comando CAD' });
const maskTool = (page: Page, action: string) =>
  page.locator(`.ribbon [data-action="${action}"]`);
const ribbonButton = (page: Page, name: string) =>
  page.locator('.ribbon').getByRole('button', { name, exact: true });
const status = (page: Page) => page.locator('.command-history');
const activated = (page: Page) =>
  page.getByRole('region', {
    name: 'Máscara ativa para desenhar',
    exact: true,
  });

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
}
async function showShortcuts(page: Page) {
  await tab(page, 'CONFIGURAÇÕES').click();
  await ribbonButton(page, 'Atalhos').click();
  await expect(panel(page)).toBeVisible();
  return panel(page);
}
async function alias(page: Page, value: string) {
  const field = input(page);
  await field.focus();
  if (value) await field.pressSequentially(value);
  await field.press('Enter');
}
async function exportProject(page: Page): Promise<Project> {
  const download = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
}
async function openProject(page: Page, p: Project) {
  await page.getByTestId('project-input').setInputFiles({
    name: 'atalhos.armstruct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await expect(page.locator('.window-project')).toHaveText(p.name);
}
async function setupMask(page: Page) {
  await ready(page);
  const p = { ...emptyProject(), name: 'Projeto de atalhos' };
  const mask = {
    ...newNativeMask('Fôrma ativa'),
    primitives: [
      nativePrimitive({
        kind: 'line',
        points: [
          { x: 0, y: 0 },
          { x: 1600, y: 0 },
        ],
        closed: false,
      }),
      nativePrimitive({
        kind: 'line',
        points: [
          { x: 0, y: 500 },
          { x: 1600, y: 500 },
        ],
        closed: false,
      }),
    ],
  };
  const candidate = newNativeMask('Fôrma candidata');
  const project = completeOwnership(
    { ...p, masks: [mask, candidate] },
    p.hierarchy.details[0].id,
  );
  await openProject(page, project);
  await tab(page, 'Máscaras').click();
  const selector = page.locator('.mask-destination select');
  await selector.selectOption(mask.id);
  await ribbonButton(page, 'Ativar máscara para desenhar').click();
  await selector.selectOption(candidate.id);
  await expect(activated(page)).toContainText('Fôrma ativa');
  return project;
}

test('edição por teclado, cancelar, persistência e ajuda atualizada sem alterar o projeto', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await ready(page);
  const original = await exportProject(page);
  await expect(page.locator('.save-status')).toHaveText(
    'Apenas recuperável localmente',
  );
  const saveStatus = await page.locator('.save-status').innerText();
  const dialog = await showShortcuts(page);
  const search = dialog.getByRole('textbox', { name: 'Buscar' });
  await expect(search).toBeFocused();
  await search.pressSequentially('Barra livre');
  await expect(
    dialog.getByRole('button', { name: 'Barra livre Padrão' }),
  ).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Alterar B', exact: true })
    .press('Enter');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Alterar B' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Alterar B' }).press('Enter');
  await page.keyboard.press('Alt+B');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(await exportProject(page)).toEqual(original);
  expect(await page.locator('.save-status').innerText()).toBe(saveStatus);

  await showShortcuts(page);
  await dialog
    .getByRole('combobox', { name: 'Categoria' })
    .selectOption('Armaduras');
  await dialog.getByRole('button', { name: 'Alterar B' }).press('Enter');
  await page.keyboard.press('Alt+B');
  await expect(
    dialog.getByRole('button', { name: 'Barra livre Personalizado' }),
  ).toBeVisible();
  await dialog.screenshot({ path: 'docs/atalhos-central.png' });
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(ribbonButton(page, 'Atalhos')).toBeFocused();
  expect(await exportProject(page)).toEqual(original);
  await expect(page.locator('.save-status')).toHaveText(saveStatus);
  await page.reload();
  await tab(page, 'Armaduras').click();
  const bar = ribbonButton(page, 'Barra livre');
  await page.keyboard.press('Tab');
  await bar.focus();
  await expect(bar).toBeFocused();
  await expect(page.getByRole('tooltip')).toContainText('Alt+B');
  await bar.blur();
  await page.keyboard.press('b');
  await expect(bar).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Alt+B');
  await expect(bar).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Guia de uso', exact: true }).click();
  const guide = page.getByRole('dialog', { name: 'Guia de uso' });
  await guide
    .getByText('Atalhos e aliases configurados', { exact: true })
    .click();
  const helpRow = (name: string) =>
    guide.locator('dl > div').filter({
      has: page.getByText(name, { exact: true }),
    });
  await expect(helpRow('Barra livre')).toContainText('Alt+B');
  await expect(helpRow('Apagar entidades da máscara')).toContainText(
    'E + Enter (Máscaras)',
  );
  await helpRow('Barra livre').scrollIntoViewIfNeeded();
  await guide.screenshot({ path: 'docs/atalhos-ajuda.png' });

  await page.keyboard.press('Escape');
  await showShortcuts(page);
  await dialog.getByRole('button', { name: 'Remover Alt+B' }).click();
  await dialog
    .getByRole('checkbox', { name: 'Desativar atalhos de tecla única' })
    .check();
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.reload();
  await tab(page, 'Armaduras').click();
  await page.keyboard.press('Alt+B');
  await page.keyboard.press('b');
  await expect(bar).toHaveAttribute('aria-pressed', 'false');
  await alias(page, 'B');
  await expect(bar).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await showShortcuts(page);
  await dialog.getByRole('button', { name: 'Restaurar todos' }).click();
  await dialog.getByRole('button', { name: 'Manter rascunho' }).click();
  await expect(
    dialog.getByRole('checkbox', { name: 'Desativar atalhos de tecla única' }),
  ).toBeChecked();
  await dialog.getByRole('button', { name: 'Restaurar todos' }).click();
  await dialog.getByRole('button', { name: 'Confirmar restauração' }).click();
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await tab(page, 'Armaduras').click();
  await page.keyboard.press('b');
  await expect(bar).toHaveAttribute('aria-pressed', 'true');
});

test('conflitos, cancelamento, reatribuição e restauração individual usam o mesmo rascunho', async ({
  page,
}) => {
  await ready(page);
  const dialog = await showShortcuts(page);
  await dialog.getByRole('button', { name: 'Alterar B' }).click();
  await page.keyboard.press('e');
  const conflict = dialog.getByRole('region', { name: 'Conflito de atalhos' });
  await expect(conflict).toContainText('Estribo (Todos os contextos)');
  await expect(conflict).toContainText('Barra livre (Todos os contextos)');
  await expect(
    dialog.getByRole('button', { name: 'Salvar', exact: true }),
  ).toBeDisabled();
  await dialog.screenshot({ path: 'docs/atalhos-conflito.png' });
  await conflict.getByRole('button', { name: 'Cancelar alteração' }).click();
  await expect(dialog.getByRole('button', { name: 'Alterar B' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Alterar B' }).click();
  await page.keyboard.press('e');
  await conflict
    .getByRole('button', { name: 'Reatribuir a Barra livre' })
    .click();
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await tab(page, 'Armaduras').click();
  await page.keyboard.press('e');
  await expect(ribbonButton(page, 'Barra livre')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
  await showShortcuts(page);
  await dialog.getByRole('textbox', { name: 'Buscar' }).fill('Estribo');
  await dialog.getByRole('button', { name: /^Estribo Personalizado$/ }).click();
  await dialog.getByRole('button', { name: 'Restaurar este comando' }).click();
  await expect(conflict).toBeVisible();
  await conflict.getByRole('button', { name: 'Reatribuir a Estribo' }).click();
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await tab(page, 'Armaduras').click();
  await page.keyboard.press('e');
  await expect(
    page.getByRole('dialog', { name: 'Critérios do estribo' }),
  ).toBeVisible();
});

test('aliases de Máscaras operam no alvo ativo e E imediato continua sendo Estribo', async ({
  page,
}) => {
  await setupMask(page);
  for (const [name, action] of [
    ['l', 'mask-line'],
    ['pl', 'mask-polyline'],
    ['rec', 'mask-rectangle'],
    ['c', 'mask-circle'],
    ['m', 'mask-move'],
    ['co', 'mask-copy'],
    ['cp', 'mask-copy'],
    ['ro', 'mask-rotate'],
    ['mi', 'mask-mirror'],
    ['o', 'mask-offset'],
    ['tr', 'mask-trim'],
    ['ex', 'mask-extend'],
    ['sc', 'mask-calibrate'],
    ['di', 'measure'],
    ['aa', 'measure-contour'],
    ['dli', 'dimension-orthogonal'],
    ['dal', 'dimension-aligned'],
    ['e', 'mask-erase'],
    ['linha', 'mask-line'],
    ['circulo', 'mask-circle'],
    ['movermascara', 'mask-move'],
    ['apagarmascara', 'mask-erase'],
  ]) {
    await alias(page, name);
    await expect(maskTool(page, action), name).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(activated(page)).toContainText('Fôrma ativa');
    await page.keyboard.press('Escape');
  }
  await alias(page, 'ma');
  await expect(maskTool(page, 'match-properties')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
  await input(page).pressSequentially('e');
  await expect(
    page.getByRole('dialog', { name: 'Critérios do estribo' }),
  ).toHaveCount(0);
  await input(page).press('Enter');
  await expect(maskTool(page, 'mask-erase')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('e');
  await expect(
    page.getByRole('dialog', { name: 'Critérios do estribo' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press(':');
  await expect(input(page)).toBeFocused();
  await input(page).pressSequentially('l');
  await tab(page, 'Armaduras').click();
  await expect(page.locator('#command-scope')).toContainText('contexto mudou');
  await input(page).press('Enter');
  await expect(ribbonButton(page, 'Barra livre')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(status(page)).toContainText('O contexto do comando mudou');
  await alias(page, 'l');
  await expect(ribbonButton(page, 'Barra livre')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
  await alias(page, 'pl');
  await expect(status(page)).toContainText('depois use Converter polilinha');
  await page.keyboard.press('Escape');
  for (const name of ['m', 'c']) {
    await alias(page, name);
    await expect(status(page)).toContainText('Selecione um objeto antes');
  }
  await page.keyboard.press('e');
  const criteria = page.getByRole('dialog', { name: 'Critérios do estribo' });
  await criteria
    .getByRole('button', { name: 'Usar critérios e lançar' })
    .click();
  await tab(page, 'Máscaras').click();
  await alias(page, 'e');
  await expect(page.locator('.toast')).toContainText(
    'antes de usar um alias em outro contexto',
  );
  await expect(maskTool(page, 'mask-erase')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.keyboard.press('Escape');

  await alias(page, 'l');
  await alias(page, '100,100');
  await showShortcuts(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#command-scope')).toHaveText('Máscaras');
  await expect(status(page)).toContainText('1 ponto(s)');
  await tab(page, 'Máscaras').click();
  await expect(maskTool(page, 'mask-line')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(activated(page)).toContainText('Fôrma ativa');
});

test('atalhos executam desenho, edição, histórico e estribo pelos fluxos existentes', async ({
  page,
}) => {
  const before = await setupMask(page);
  await alias(page, 'l');
  await alias(page, '0,800');
  await alias(page, '@1000<0');
  const maskProject = await exportProject(page);
  expect(maskProject.masks[0].primitives).toHaveLength(
    before.masks[0].primitives.length + 1,
  );
  expect(maskProject.masks[1]).toEqual(before.masks[1]);
  expect(maskProject.bars).toEqual(before.bars);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  expect((await exportProject(page)).masks).toEqual(before.masks);
  await page.keyboard.press('Control+Shift+z');
  expect((await exportProject(page)).masks).toEqual(maskProject.masks);

  await tab(page, 'Armaduras').click();
  await page.keyboard.down('b');
  await page.keyboard.down('b');
  await page.keyboard.up('b');
  await alias(page, '0,1500');
  await alias(page, '@900,0');
  await alias(page, '');
  await page.keyboard.press('Escape');
  const barProject = await exportProject(page);
  expect(barProject.bars).toHaveLength(1);
  await page.keyboard.press('r');
  await alias(page, '0,2000');
  await page.keyboard.press('Escape');
  await page.keyboard.press('d');
  await alias(page, '2000,1500');
  await page.keyboard.press('Escape');
  const armatures = await exportProject(page);
  expect(armatures.details).toHaveLength(1);
  expect(armatures.bars[0].distribution?.end.x).toBe(2000);

  await page.keyboard.press('e');
  const criteria = page.getByRole('dialog', { name: 'Critérios do estribo' });
  await expect(criteria).toBeVisible();
  await criteria
    .getByRole('button', { name: 'Distribuição', exact: true })
    .click();
  await criteria
    .getByLabel('Modo de lançamento do estribo')
    .selectOption('section');
  await criteria
    .getByRole('button', { name: 'Usar critérios e lançar' })
    .click();
  await alias(page, '3000,1000');
  await alias(page, '');
  await page.keyboard.press('Escape');
  const done = await exportProject(page);
  expect(done.bars).toHaveLength(2);
  expect(done.bars[1].kind).toBe('stirrup');
  await page.keyboard.press('Control+z');
  expect((await exportProject(page)).bars).toEqual(armatures.bars);
  await page.keyboard.press('Control+y');
  expect((await exportProject(page)).bars).toEqual(done.bars);
  await openProject(page, { ...done, name: 'Projeto reaberto' });
  expect(await exportProject(page)).toEqual({
    ...done,
    name: 'Projeto reaberto',
  });
});

test('controles focados, atalhos de interface, janela baixa e gravação indisponível', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 540 });
  await page.addInitScript(() => {
    localStorage.setItem('armadurastruct.shortcuts', '{');
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'armadurastruct.shortcuts')
        throw new Error('armazenamento indisponível');
      write.call(this, key, value);
    };
  });
  await ready(page);
  const count = page.getByLabel('Quantidade de criação', { exact: true });
  await count.focus();
  for (const key of ['b', 'e', 'r', 'd']) await page.keyboard.press(key);
  expect(
    await ribbonButton(page, 'Barra livre').getAttribute('aria-pressed'),
  ).toBe('false');
  const dialog = await showShortcuts(page);
  await expect(dialog.getByRole('status')).toContainText(
    'preferências de teclado',
  );
  await dialog
    .getByRole('textbox', { name: 'Buscar' })
    .pressSequentially('bedr');
  await expect(dialog.getByText('Nenhum comando encontrado.')).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Buscar' }).clear();
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Não foi possível gravar',
  );
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.keyboard.press('F4');
  await expect(
    page.getByRole('complementary', { name: 'Painel lateral' }),
  ).toHaveCount(0);
  await page.keyboard.press('Control+F1');
  await expect(page.locator('.ribbon')).toHaveClass(/collapsed/);
  await showShortcuts(page);
  await page.evaluate(() => (document.documentElement.style.zoom = '1.5'));
  await expect(
    dialog.getByRole('button', { name: 'Salvar', exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('aliases editados, conflitos com caixa distinta e remoção persistente', async ({
  page,
}) => {
  const project = await setupMask(page);
  const dialog = await showShortcuts(page);
  await dialog.getByRole('textbox', { name: 'Buscar' }).fill('Círculo');
  await dialog
    .getByRole('combobox', { name: 'Contexto da associação' })
    .selectOption('masks');
  const aliases = dialog.getByRole('textbox', {
    name: 'Aliases separados por vírgula',
  });
  await aliases.press('Control+a');
  await aliases.pressSequentially('l');
  await expect(aliases).toHaveValue('l');
  await aliases.press('Enter');
  const conflict = dialog.getByRole('region', { name: 'Conflito de atalhos' });
  await expect(conflict).toContainText('Linha (Máscaras)');
  await expect(conflict).toContainText('Círculo (Máscaras)');
  await conflict.getByRole('button', { name: 'Cancelar alteração' }).click();
  await expect(aliases).toHaveValue('C');
  await aliases.press('Control+a');
  await aliases.pressSequentially('circ');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await openProject(page, {
    ...project,
    name: 'Outro arquivo com o mesmo mapa',
  });
  await tab(page, 'Máscaras').click();
  await alias(page, 'c');
  await expect(maskTool(page, 'mask-circle')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(status(page)).toContainText(
    'Comando desconhecido neste contexto',
  );
  await alias(page, 'circ');
  await expect(maskTool(page, 'mask-circle')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
  await alias(page, 'circulo');
  await expect(maskTool(page, 'mask-circle')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('alias sem alvo usa o seletor de máscaras e alvo oculto não altera geometria', async ({
  page,
}) => {
  await ready(page);
  const before = await exportProject(page);
  await tab(page, 'Máscaras').click();
  await alias(page, 'l');
  const masks = page.getByRole('dialog', { name: /Controle de máscaras/i });
  await expect(masks).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await exportProject(page)).toEqual(before);

  const project = await setupMask(page);
  const hidden = {
    ...project,
    name: 'Fôrma protegida',
    masks: project.masks.map((mask, i) =>
      i === 0 ? { ...mask, visible: false } : mask,
    ),
  };
  await openProject(page, hidden);
  await tab(page, 'Máscaras').click();
  await alias(page, 'm');
  await expect(maskTool(page, 'mask-move')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.locator('.toast')).toContainText(/oculta|máscara/i);
  expect(await exportProject(page)).toEqual(hidden);
});
