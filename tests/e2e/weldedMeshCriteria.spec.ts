import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  confirmProjectReplacement,
  useCompatibleProjectFolders,
} from './projectSetup.helpers';

async function save(page: Page) {
  const ev = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await ev).path())!, 'utf8'));
}
async function fresh(page: Page) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Novo projeto', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByLabel('Nome do projeto', { exact: true })
    .fill('Critérios de telas');
  await confirmProjectReplacement(page);
  await page
    .getByRole('button', { name: 'Criar projeto', exact: true })
    .click();
}
async function open(page: Page) {
  await page
    .locator('.ribbon-group', {
      has: page.locator('.ribbon-group-label', {
        hasText: /^Telas soldadas$/,
      }),
    })
    .getByRole('button', { name: 'Critérios de telas', exact: true })
    .click();
  const d = page.getByRole('dialog', {
    name: 'Critérios de telas soldadas',
    exact: true,
  });
  await expect(d).toBeVisible();
  return d;
}
const cells = (d: Locator) =>
  d.getByRole('table', { name: 'Propriedades da tela por direção' });

test('catálogo só leitura, personalizada identificada, validação e critérios para o próximo lançamento', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fresh(page);
  const before = await save(page);

  // Padrão: Q92 do catálogo, com as propriedades da tabela da issue.
  let d = await open(page);
  await expect(d.getByLabel('Modelo de tela')).toHaveValue('Q92');
  await expect(cells(d)).toContainText('4,2 mm');
  await expect(cells(d)).toContainText('15 cm');
  await expect(cells(d)).toContainText('0,92 cm²/m');
  await expect(d.getByLabel('Painel', { exact: true })).toContainText(
    '6,00 m (comprimento, longitudinal) × 2,45 m (largura)',
  );
  await expect(d.getByLabel('Painel', { exact: true })).toContainText(
    '21,8 kg/painel',
  );

  // Trocar de modelo; o catálogo não oferece campos editáveis.
  await d.getByLabel('Modelo de tela').selectOption('Q138');
  await expect(cells(d)).toContainText('10 cm');
  await expect(cells(d)).toContainText('1,38 cm²/m');
  await expect(cells(d).getByRole('spinbutton')).toHaveCount(0);

  // Personalizada: escolha explícita, a partir do modelo atual.
  await d
    .getByLabel('Modelo de tela')
    .selectOption({ label: 'Personalizada (a partir de Q138)' });
  await expect(cells(d).getByRole('spinbutton')).toHaveCount(6);
  await expect(
    d.getByLabel('Espaçamento transversal (cm)', { exact: true }),
  ).toHaveValue('10');
  await d
    .getByLabel('Designação da tela personalizada', { exact: true })
    .fill('T138');
  await d
    .getByLabel('Espaçamento transversal (cm)', { exact: true })
    .fill('20');
  await d
    .getByLabel('Área de aço transversal (cm²/m)', { exact: true })
    .fill('0.69');
  await expect(
    d.getByLabel('Modelo de tela').locator('option:checked'),
  ).toHaveText('T138 (personalizada)');
  const preview = d.getByRole('complementary', {
    name: 'Prévia dos critérios',
  });
  await expect(preview).toContainText('T138 (personalizada)');
  await expect(preview).toContainText('Transversal Ø4,2 c/20 · 0,69 cm²/m');

  // Paginação: sobreposição maior que o painel bloqueia a confirmação.
  await d.getByRole('button', { name: 'Paginação', exact: true }).click();
  await d.getByLabel('Orientação (graus)', { exact: true }).fill('90');
  await d
    .getByLabel('Sobreposição no comprimento (mm)', { exact: true })
    .fill('7000');
  await expect(d.getByRole('alert')).toContainText(
    'Sobreposição no comprimento deve ser menor que o comprimento do painel (6000 mm).',
  );
  await expect(
    d.getByRole('button', { name: 'Usar critérios', exact: true }),
  ).toBeDisabled();
  await d
    .getByLabel('Sobreposição no comprimento (mm)', { exact: true })
    .fill('300');
  await d
    .getByLabel('Sobreposição na largura (mm)', { exact: true })
    .fill('150');
  await expect(d.getByRole('alert')).toHaveCount(0);
  await expect(preview).toContainText('Passo da grade: 5,70 × 2,30 m');

  // Representação: posição em branco é recusada; layer e apresentação.
  await d.getByRole('button', { name: 'Representação', exact: true }).click();
  await d.getByLabel('Posição', { exact: true }).fill(' ');
  await expect(d.getByRole('alert')).toContainText(
    'Posição não pode ficar em branco.',
  );
  await d.getByLabel('Posição', { exact: true }).fill('TS2');
  await d.getByLabel('Layer das telas').selectOption({ label: 'DESENHO' });
  await d.getByLabel('Malha nominal (fios)').uncheck();
  await d.getByRole('button', { name: 'Usar critérios', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(
    page
      .getByText('Critérios de telas definidos para os próximos lançamentos.')
      .first(),
  ).toBeVisible();

  // Reabrir: os critérios aceitos voltam; Esc descarta uma alteração.
  d = await open(page);
  await expect(
    d.getByLabel('Modelo de tela').locator('option:checked'),
  ).toHaveText('T138 (personalizada)');
  await d.getByRole('button', { name: 'Paginação', exact: true }).click();
  await expect(d.getByLabel('Orientação (graus)', { exact: true })).toHaveValue(
    '90',
  );
  await d.getByLabel('Orientação (graus)', { exact: true }).fill('45');
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
  d = await open(page);
  await d.getByRole('button', { name: 'Paginação', exact: true }).click();
  await expect(d.getByLabel('Orientação (graus)', { exact: true })).toHaveValue(
    '90',
  );
  await d.getByRole('button', { name: 'Representação', exact: true }).click();
  await expect(d.getByLabel('Posição', { exact: true })).toHaveValue('TS2');
  await expect(d.getByLabel('Layer das telas')).toHaveValue('layer:DESENHO');
  await expect(d.getByLabel('Malha nominal (fios)')).not.toBeChecked();
  await d.getByRole('button', { name: 'Cancelar', exact: true }).click();

  // Critérios ainda não lançados não entram no arquivo.
  const after = await save(page);
  expect(after.weldedMeshDefaults).toBeUndefined();
  expect(after.weldedMeshes).toBeUndefined();
  expect(after.schema).toBe(before.schema);
  expect(errors).toEqual([]);
});

useCompatibleProjectFolders();
