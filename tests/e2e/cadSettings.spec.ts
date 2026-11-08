import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject, newBar, schedule } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import { drawingPrimitives } from '../../src/domain/drawingPrimitives';
import type { Project } from '../../src/domain/types';
const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Configurações CAD', exact: true });
async function load(
  page: Page,
  p = completeOwnership({ ...emptyProject(), bars: [newBar('N1')] }),
) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'defaults.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  return p;
}
async function open(page: Page) {
  await page.getByRole('tab', { name: 'CONFIGURAÇÕES', exact: true }).click();
  await page
    .getByRole('button', { name: 'Configurações CAD', exact: true })
    .click();
  await expect(dialog(page)).toBeVisible();
}
async function category(page: Page, name: string) {
  await dialog(page)
    .getByRole('navigation', { name: 'Categorias CAD' })
    .getByRole('button', { name, exact: true })
    .click();
}
async function command(page: Page, value: string) {
  const el = page.getByRole('textbox', { name: 'Comando CAD' });
  await el.fill(value);
  await el.press('Enter');
}
async function save(page: Page): Promise<Project> {
  const toast = page.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await toast.isVisible()) await toast.click();
  const event = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
}
test('configura cinco categorias, materializa novos objetos e persiste; os anteriores e aço ficam intactos', async ({
  page,
}) => {
  const original = await load(page);
  await open(page);
  await dialog(page)
    .getByLabel('Altura de chamadas/cortes (mm no modelo)', { exact: true })
    .fill('90');
  await dialog(page)
    .getByLabel(
      'Altura de identificação de novas barras/rebatimentos (mm no modelo)',
      { exact: true },
    )
    .fill('70');
  await dialog(page)
    .getByLabel('Alinhamento padrão de texto')
    .selectOption('right');
  await category(page, 'Armaduras');
  await dialog(page)
    .getByLabel('Bitola padrão (mm)', { exact: true })
    .fill('12.5');
  await dialog(page)
    .getByLabel('Quantidade base padrão', { exact: true })
    .fill('3');
  await dialog(page)
    .getByLabel('Cobrimento padrão (mm)', { exact: true })
    .fill('42');
  await dialog(page)
    .getByLabel('Aço padrão', { exact: true })
    .selectOption('CA-60');
  await dialog(page)
    .getByLabel('Cor própria de barras', { exact: true })
    .check();
  await dialog(page)
    .getByLabel('Cor de barras', { exact: true })
    .fill('#ff0000');
  await dialog(page)
    .getByLabel('Pena/escala próprias de barras', { exact: true })
    .check();
  await dialog(page)
    .getByLabel('Espessura de barras (mm no papel)', { exact: true })
    .fill('0.25');
  await dialog(page)
    .getByLabel('Linha de barras', { exact: true })
    .selectOption('common');
  await category(page, 'Cotas');
  await dialog(page)
    .getByLabel('Altura de novas cotas (mm no modelo)', { exact: true })
    .fill('75');
  await category(page, 'Máscaras');
  await dialog(page)
    .getByLabel('Opacidade de novas máscaras nativas (0–1)', { exact: true })
    .fill('0.6');
  await dialog(page)
    .getByLabel('Cor própria de entidades nativas', { exact: true })
    .check();
  await dialog(page)
    .getByLabel('Cor de entidades nativas', { exact: true })
    .fill('#00ff00');
  await category(page, 'Tipos de linha');
  await dialog(page)
    .getByLabel('Tipo de linha comum', { exact: true })
    .selectOption({ label: 'Tracejada' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'docs/cad-settings-lines.png' });
  await category(page, 'Armaduras');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'docs/cad-settings-armatures.png' });
  await dialog(page)
    .getByRole('button', { name: 'Salvar e fechar', exact: true })
    .dblclick();
  await expect(dialog(page)).toHaveCount(0);
  const configured = await save(page);
  expect(configured.bars).toEqual(original.bars);
  expect(schedule(configured)).toEqual(schedule(original));
  expect(configured.cadDefaults?.armatures.cover).toBe(42);
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  await expect(
    page.getByLabel('Bitola de criação', { exact: true }),
  ).toHaveValue('12.5');
  await command(page, 'B');
  await command(page, '0,1000');
  await command(page, '1000,1000');
  await command(page, '');
  await page.keyboard.press('Escape');
  const q = await save(page);
  expect(q.bars).toHaveLength(2);
  expect(q.bars[1]).toMatchObject({
    diameter: 12.5,
    quantity: 3,
    steel: 'CA-60',
    style: { color: '#ff0000', lineWidth: 0.18, lineType: { name: 'DASHED' } },
    drafting: { height: 70, align: 'right' },
  });
  expect(q.bars[0]).toEqual(original.bars[0]);
  await command(page, 'R');
  await command(page, '2000,1000');
  await page.keyboard.press('Escape');
  expect((await save(page)).details[0].drafting?.height).toBe(70);
  await command(page, 'D');
  await command(page, '3000,1000');
  await page.keyboard.press('Escape');
  expect(
    drawingPrimitives(await save(page))
      .filter((l) => (l.role ?? l.layer) === 'DISTRIBUICAO' && l.text)
      .some((l) => l.textHeight === 90),
  ).toBe(true);
  const text = drawingPrimitives(q).find((l) => l.text?.startsWith('N2 -'));
  expect(text?.textHeight).toBe(70);
  await command(page, 'COTA');
  for (const pt of ['0,1000', '1000,1000', '500,1200']) await command(page, pt);
  await page.keyboard.press('Escape');
  expect((await save(page)).annotations[0].textHeight).toBe(75);
  await command(page, 'CHAMADA');
  for (const pt of ['0,0', '100,100', '300,100']) await command(page, pt);
  await page.keyboard.press('Escape');
  expect((await save(page)).annotations[1].textHeight).toBe(90);
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  await page.getByRole('button', { name: 'Nova máscara', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Controle de máscaras' })
    .getByRole('button', { name: 'Criar máscara nativa', exact: true })
    .click();
  await command(page, 'LINHA');
  await command(page, '0,-1000');
  await command(page, '1000,-1000');
  await page.keyboard.press('Escape');
  const final = await save(page);
  expect(final.masks[0].opacity).toBe(0.6);
  expect(final.masks[0].primitives[0].style?.color).toBe('#00ff00');
  await page.getByTestId('project-input').setInputFiles({
    name: 'reopen.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(final)),
  });
  expect(await save(page)).toEqual(final);
  await open(page);
  await category(page, 'Armaduras');
  await expect(
    dialog(page).getByLabel('Bitola padrão (mm)', { exact: true }),
  ).toHaveValue('12.5');
});
test('cancelar/fechar/Esc e restaurar categoria trabalham só no rascunho; inválido mantém campo e não salva', async ({
  page,
}) => {
  const original = await load(page);
  await open(page);
  await dialog(page)
    .getByLabel('Altura de chamadas/cortes (mm no modelo)', { exact: true })
    .fill('abc');
  await dialog(page)
    .getByRole('button', { name: 'Salvar e fechar', exact: true })
    .click();
  await expect(dialog(page).getByRole('alert').first()).toBeVisible();
  await expect(
    dialog(page).getByLabel('Altura de chamadas/cortes (mm no modelo)', {
      exact: true,
    }),
  ).toHaveValue('abc');
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(original);
  await open(page);
  await dialog(page)
    .getByLabel('Altura de chamadas/cortes (mm no modelo)', { exact: true })
    .fill('110');
  await dialog(page)
    .getByRole('button', { name: 'Restaurar Textos no rascunho', exact: true })
    .click();
  await expect(
    dialog(page).getByLabel('Altura de chamadas/cortes (mm no modelo)', {
      exact: true,
    }),
  ).toHaveValue('50');
  await dialog(page)
    .getByRole('button', { name: 'Cancelar', exact: true })
    .click();
  expect(await save(page)).toEqual(original);
  await open(page);
  await dialog(page)
    .getByRole('button', { name: 'Fechar configurações CAD', exact: true })
    .click();
  expect(await save(page)).toEqual(original);
});
test('um passo de histórico e recuperação conservam padrões; projeto B não herda ajustes de A', async ({
  page,
}) => {
  const original = await load(page);
  await open(page);
  await category(page, 'Armaduras');
  await dialog(page)
    .getByLabel('Cobrimento padrão (mm)', { exact: true })
    .fill('47');
  await dialog(page)
    .getByRole('button', { name: 'Salvar e fechar', exact: true })
    .click();
  const configured = await save(page);
  await command(page, 'U');
  expect(await save(page)).toEqual(original);
  await command(page, 'REDO');
  expect(await save(page)).toEqual(configured);
  await page.waitForTimeout(750);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect((await save(page)).cadDefaults?.armatures.cover).toBe(47);
  await page.getByTestId('project-input').setInputFiles({
    name: 'B.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(emptyProject())),
  });
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  await expect(
    page.getByLabel('Cobrimento padrão de criação', { exact: true }),
  ).toHaveValue('30');
  await open(page);
  await category(page, 'Armaduras');
  await expect(
    dialog(page).getByLabel('Cobrimento padrão (mm)', { exact: true }),
  ).toHaveValue('30');
});
test('janela compacta, foco, temas e atalhos dentro de campo não desenham nem salvam o projeto', async ({
  page,
}) => {
  const original = await load(page);
  await page.setViewportSize({ width: 900, height: 650 });
  await page.getByRole('button', { name: 'Foco no CAD', exact: true }).click();
  await open(page);
  for (const name of [
    'Textos',
    'Armaduras',
    'Cotas',
    'Máscaras',
    'Tipos de linha',
  ])
    await category(page, name);
  await category(page, 'Textos');
  const input = dialog(page).getByLabel(
    'Altura de chamadas/cortes (mm no modelo)',
    { exact: true },
  );
  await input.fill('65');
  await input.press('Control+s');
  await page.screenshot({ path: 'docs/cad-settings-compact.png' });
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(original);
});
