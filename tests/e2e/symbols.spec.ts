import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { maskManipFixture } from '../fixtures/maskManipulation';
import type { Project } from '../../src/domain/types';

const dialog = (p: Page) =>
  p.getByRole('dialog', { name: 'Biblioteca de símbolos' });
const list = (p: Page) =>
  dialog(p).getByRole('list', { name: 'Lista de símbolos' });
async function open(p: Page, seed: Project = maskManipFixture()) {
  await p.goto('/');
  await expect(p.locator('.busy-overlay')).toHaveCount(0);
  await p.getByTestId('project-input').setInputFiles({
    name: 'simbolos.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(seed)),
  });
  await p.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  const d = p.getByRole('region', {
    name: 'Destino do desenho de máscaras',
    exact: true,
  });
  await d
    .getByLabel('Escolher máscara', { exact: true })
    .selectOption('target-mask');
  await d
    .getByRole('button', { name: 'Ativar máscara para desenhar', exact: true })
    .click();
}
async function save(p: Page): Promise<Project> {
  const close = p.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await close.isVisible()) await close.click();
  const d = p.waitForEvent('download');
  await p
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await d).path())!, 'utf8'));
}
const openLibrary = (p: Page) =>
  p
    .getByRole('button', { name: 'Biblioteca de símbolos', exact: true })
    .click();
const closeLibrary = (p: Page) =>
  dialog(p).getByRole('button', { name: 'Fechar', exact: true }).click();
async function createSymbol(p: Page, name = 'Pilar P1') {
  await dialog(p).getByRole('button', { name: 'Novo símbolo…' }).click();
  await dialog(p).getByLabel('Nome do símbolo').fill(name);
  await dialog(p).getByLabel('Categoria do símbolo').fill('Fôrma');
  await dialog(p).getByRole('button', { name: 'Selecionar listadas' }).click();
  await dialog(p)
    .getByRole('button', { name: 'Canto inferior esquerdo da seleção' })
    .click();
  await dialog(p).getByRole('button', { name: 'Salvar símbolo' }).click();
  await expect(dialog(p).getByRole('status')).toContainText('salvo');
}
async function insertAt(
  p: Page,
  x: string,
  y: string,
  rotation = '0',
  scale = '1',
) {
  await dialog(p).getByRole('button', { name: 'Inserir…' }).click();
  await dialog(p).getByLabel('Posição X').fill(x);
  await dialog(p).getByLabel('Posição Y').fill(y);
  await dialog(p).getByLabel('Rotação').fill(rotation);
  await dialog(p).getByLabel('Escala').fill(scale);
  await dialog(p).getByRole('button', { name: 'Inserir', exact: true }).click();
  await expect(dialog(p).getByRole('status').last()).toContainText('inserida');
}
const undo = (p: Page) =>
  p.locator('.quick-tools').getByRole('button', { name: 'Desfazer' }).click();

test('símbolos: criar, inserir duas instâncias, transformar uma, editar, desfazer, persistir e remover', async ({
  page,
}) => {
  const seed = maskManipFixture();
  await open(page, seed);
  const before = await save(page);
  await openLibrary(page);
  await expect(dialog(page)).toContainText('A biblioteca está vazia');

  // Esc cancela cada etapa: o formulário volta à biblioteca; a biblioteca fecha.
  await dialog(page).getByRole('button', { name: 'Novo símbolo…' }).click();
  await page.keyboard.press('Escape');
  await expect(list(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await openLibrary(page);

  await createSymbol(page);
  await page.screenshot({ path: 'docs/simbolos-biblioteca.png' });
  await dialog(page)
    .getByRole('button', { name: /Pilar P1/ })
    .click();
  await insertAt(page, '5000', '0');
  await insertAt(page, '8000', '0', '90', '2');
  await page.screenshot({ path: 'docs/simbolos-instancias.png' });
  await closeLibrary(page);
  await expect(page.locator('[data-mask-id]')).toHaveCount(
    seed.masks.length + 2,
  );
  await page.getByRole('button', { name: 'Enquadrar', exact: true }).click();
  await page.screenshot({ path: 'docs/simbolos-canvas.png' });

  const saved = await save(page);
  expect(saved.schema).toBe('armadurastruct/29');
  expect(saved.symbols).toHaveLength(1);
  expect(saved.symbolInstances).toHaveLength(2);
  expect(saved.bars).toEqual(before.bars);
  expect(saved.masks).toEqual(before.masks);
  expect(saved.symbolInstances![0].definitionId).toBe(saved.symbols![0].id);
  expect(Object.keys(saved.hierarchy.objectDetails)).toEqual(
    expect.arrayContaining(saved.symbolInstances!.map((i) => i.id)),
  );

  // Transformar somente a segunda instância.
  await openLibrary(page);
  await dialog(page)
    .getByRole('button', { name: /Pilar P1/ })
    .click();
  await dialog(page).getByRole('button', { name: /^#2 ·/ }).click();
  await dialog(page).getByLabel('Rotação').fill('45');
  await dialog(page)
    .getByRole('button', { name: 'Aplicar transformação' })
    .click();
  await closeLibrary(page);
  const moved = await save(page);
  expect(moved.symbolInstances![0]).toEqual(saved.symbolInstances![0]);
  expect(moved.symbolInstances![1].rotation).toBe(45);
  expect(moved.symbols).toEqual(saved.symbols);

  // Editar a definição informa as instâncias afetadas; um passo de histórico.
  await openLibrary(page);
  await dialog(page)
    .getByRole('button', { name: /Pilar P1/ })
    .click();
  await dialog(page).getByRole('button', { name: 'Editar…' }).click();
  await dialog(page)
    .getByLabel('Substituir a geometria pela seleção abaixo')
    .check();
  await dialog(page)
    .getByRole('group', { name: 'Entidades da máscara ativa' })
    .getByRole('checkbox')
    .first()
    .check();
  await expect(dialog(page).getByRole('status')).toContainText(
    'atualiza 2 instância(s)',
  );
  await page.screenshot({ path: 'docs/simbolos-edicao-impacto.png' });
  await dialog(page).getByRole('button', { name: 'Aplicar edição' }).click();
  await closeLibrary(page);
  const edited = await save(page);
  expect(edited.symbols![0].primitives).toHaveLength(1);
  expect(edited.symbols![0].revision).toBe(2);
  await undo(page);
  expect((await save(page)).symbols![0].primitives).toHaveLength(3);

  // Persiste ao reabrir.
  await page.getByTestId('project-input').setInputFiles({
    name: 'reaberto.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(moved)),
  });
  await openLibrary(page);
  await expect(dialog(page)).toContainText('Pilar P1');
  await expect(dialog(page)).toContainText('2 instância(s)');

  // Remover definição usada exige confirmar as instâncias e não deixa órfãos.
  await dialog(page)
    .getByRole('button', { name: /Pilar P1/ })
    .click();
  await dialog(page).getByRole('button', { name: 'Remover…' }).click();
  const remove = dialog(page).getByRole('button', { name: 'Remover símbolo' });
  await expect(remove).toBeDisabled();
  await dialog(page)
    .getByLabel(/Remover também as 2 instância/)
    .check();
  await page.screenshot({ path: 'docs/simbolos-remocao.png' });
  await remove.click();
  await closeLibrary(page);
  const removed = await save(page);
  expect(removed.symbols ?? []).toHaveLength(0);
  expect(removed.symbolInstances ?? []).toHaveLength(0);
  expect(removed.bars).toEqual(before.bars);
  await expect(page.locator('[data-mask-id]')).toHaveCount(seed.masks.length);
  await undo(page);
  expect((await save(page)).symbolInstances).toHaveLength(2);
});

test('símbolos: nome duplicado, catálogo inválido e importação/exportação nativa', async ({
  page,
}) => {
  await open(page);
  await openLibrary(page);
  await createSymbol(page, 'Viga V1');

  // Nome duplicado é recusado com sugestão; nada é gravado.
  await dialog(page).getByRole('button', { name: 'Novo símbolo…' }).click();
  await dialog(page).getByLabel('Nome do símbolo').fill('viga v1');
  await dialog(page)
    .getByRole('button', { name: 'Selecionar listadas' })
    .click();
  await dialog(page).getByRole('button', { name: 'Salvar símbolo' }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Já existe');
  await dialog(page).getByRole('button', { name: 'Cancelar' }).click();

  // Exporta o catálogo.
  const download = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Exportar catálogo' }).click();
  const catalog = readFileSync((await (await download).path())!, 'utf8');
  expect(JSON.parse(catalog).schema).toBe('armadurastruct.symbols/1');

  // Arquivo inválido não altera nada; catálogo válido renomeia o nome repetido.
  const input = dialog(page).getByLabel('Arquivo do catálogo de símbolos');
  await input.setInputFiles({
    name: 'ruim.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schema":"x"}'),
  });
  await expect(dialog(page).getByRole('alert')).toContainText('catálogo');
  await expect(list(page).getByRole('listitem')).toHaveCount(1);
  await input.setInputFiles({
    name: 'catalogo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(catalog),
  });
  await expect(dialog(page).getByRole('status')).toContainText('renomeado');
  await expect(list(page)).toContainText('Viga V1 (2)');
  await page.screenshot({ path: 'docs/simbolos-catalogo.png' });
  await dialog(page).getByLabel('Pesquisar símbolos').fill('(2)');
  await expect(list(page).getByRole('listitem')).toHaveCount(1);
});

async function position(p: Page, q: { x: number; y: number }) {
  return p.getByTestId('cad-canvas').evaluate(async (svg, q) => {
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
    const s = new DOMPoint(q.x, q.y).matrixTransform(
      (svg.querySelector('g[transform]') as SVGGElement).getScreenCTM()!,
    );
    return { x: s.x, y: s.y };
  }, q);
}
async function clickAt(p: Page, x: number, y: number) {
  const q = await position(p, { x, y });
  await p.mouse.click(q.x, q.y);
}
const near = (value: string, expected: number, tolerance = 80) =>
  expect(Math.abs(Number(value) - expected)).toBeLessThan(tolerance);

test('símbolos: escolher ponto base e posição no desenho, prévia ao vivo, Esc e seleção por clique', async ({
  page,
}) => {
  const seed = maskManipFixture();
  await open(page, seed);
  await page.getByRole('button', { name: 'Enquadrar', exact: true }).click();
  await openLibrary(page);

  // Ponto base por clique: o diálogo se esconde e devolve o ponto.
  await dialog(page).getByRole('button', { name: 'Novo símbolo…' }).click();
  await dialog(page).getByLabel('Nome do símbolo').fill('Pilar clique');
  await dialog(page)
    .getByRole('button', { name: 'Selecionar listadas' })
    .click();
  await dialog(page)
    .getByRole('button', { name: 'Escolher no desenho' })
    .click();
  await expect(dialog(page)).toBeHidden();
  await page.keyboard.press('Escape'); // Esc cancela a escolha sem alterar nada
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByLabel('Ponto base X')).toHaveValue('0');
  await dialog(page)
    .getByRole('button', { name: 'Escolher no desenho' })
    .click();
  await clickAt(page, 0, 0);
  await expect(dialog(page)).toBeVisible();
  near(await dialog(page).getByLabel('Ponto base X').inputValue(), 0);
  near(await dialog(page).getByLabel('Ponto base Y').inputValue(), 0);
  await dialog(page).getByRole('button', { name: 'Salvar símbolo' }).click();
  await expect(dialog(page).getByRole('status')).toContainText('salvo');

  // Posição por clique com prévia ao vivo; nada é gravado antes de confirmar.
  const before = await (async () => {
    await dialog(page)
      .getByRole('button', { name: 'Fechar', exact: true })
      .click();
    const saved = await save(page);
    await openLibrary(page);
    return saved;
  })();
  expect(before.symbolInstances ?? []).toHaveLength(0);
  await dialog(page)
    .getByRole('button', { name: /Pilar clique/ })
    .click();
  await dialog(page).getByRole('button', { name: 'Inserir…' }).click();
  await dialog(page)
    .getByRole('button', { name: 'Escolher posição no desenho' })
    .click();
  await expect(dialog(page)).toBeHidden();
  const at = await position(page, { x: 1500, y: 500 });
  await page.mouse.move(at.x, at.y);
  await expect(
    page.getByTestId('transform-preview').locator('path').first(),
  ).toBeAttached();
  await page.screenshot({ path: 'docs/simbolos-previa-clique.png' });
  await page.mouse.click(at.x, at.y);
  await expect(dialog(page)).toBeVisible();
  near(await dialog(page).getByLabel('Posição X').inputValue(), 1500);
  await dialog(page).getByLabel('Posição X').fill('2000');
  await dialog(page).getByLabel('Posição Y').fill('-600');
  await dialog(page)
    .getByRole('button', { name: 'Inserir', exact: true })
    .click();
  await expect(dialog(page).getByRole('status').last()).toContainText(
    'inserida',
  );
  await dialog(page)
    .getByRole('button', { name: 'Fechar', exact: true })
    .click();
  expect((await save(page)).symbolInstances).toHaveLength(1);

  // Selecionar a instância por clique no desenho e excluí-la com Delete.
  await page.getByRole('button', { name: 'Enquadrar', exact: true }).click();
  await clickAt(page, 2500, -600);
  await page.keyboard.press('Delete');
  await expect
    .poll(async () => ((await save(page)).symbolInstances ?? []).length)
    .toBe(0);
  await undo(page);
  expect((await save(page)).symbolInstances).toHaveLength(1);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Refazer' })
    .click();
  expect((await save(page)).symbolInstances ?? []).toHaveLength(0);
});
