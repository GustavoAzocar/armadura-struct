import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject } from '../../src/domain/model';

type Saved = {
  schema: string;
  bars: unknown[];
  masks: {
    primitives: {
      id: string;
      native?: { kind: string };
      text?: string;
      textHeight?: number;
      textRotation?: number;
      textAlign?: string;
      textFont?: { family: string; weight: string; style: string };
      points: { x: number; y: number }[];
    }[];
  }[];
};
async function command(page: Page, s: string) {
  const box = page.getByRole('textbox', { name: 'Comando CAD' });
  await box.fill(s);
  await box.press('Enter');
}
async function save(page: Page): Promise<Saved> {
  const event = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
}
const texts = (p: Saved) =>
  p.masks.flatMap((m) => m.primitives.filter((q) => q.native?.kind === 'text'));
async function start(page: Page) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'vazio.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(emptyProject())),
  });
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  await page
    .getByRole('button', { name: 'Controle de máscaras', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Controle de máscaras', exact: true })
    .getByRole('button', { name: 'Criar máscara nativa', exact: true })
    .click();
  await page.getByRole('button', { name: 'Linha', exact: true }).click();
  await command(page, '0,0');
  await command(page, '1000,0');
  await page.keyboard.press('Escape');
}
const CONTENT = 'Ø16 c/15 ± 2 - ação';

test('insere texto livre com prévia, Esc por etapa, Desfazer/Refazer sem duplicar', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await start(page);
  const panel = page.getByRole('region', { name: 'Inserir texto' });
  await page.getByRole('button', { name: 'Texto', exact: true }).click();
  await expect(panel).toContainText('Ponto de inserção');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  expect(texts(await save(page))).toHaveLength(0);

  await page.getByRole('button', { name: 'Texto', exact: true }).click();
  await command(page, '200,300');
  await panel.getByLabel('Conteúdo do texto').fill(CONTENT);
  await panel.getByLabel('Altura do texto').fill('80');
  await panel.getByLabel('Família da fonte').selectOption('serif');
  await panel.getByLabel('Peso da fonte').selectOption('bold');
  await panel.getByLabel('Estilo da fonte').selectOption('italic');
  await panel.getByLabel('Alinhamento do texto').selectOption('center');
  await panel.getByLabel('Rotação do texto').fill('15');
  await expect(page.getByTestId('transform-preview')).toContainText(CONTENT);
  // The preview writes nothing.
  expect(texts(await save(page))).toHaveLength(0);
  // Esc in the content step returns to the point step and keeps the values.
  await panel.getByLabel('Conteúdo do texto').press('Escape');
  await expect(panel).toContainText('1/2');
  await command(page, '500,300');
  await expect(panel.getByLabel('Conteúdo do texto')).toHaveValue(CONTENT);
  await panel.getByRole('button', { name: /Inserir texto/ }).dblclick();
  await expect(panel).toHaveCount(0);
  let p = await save(page);
  expect(p.schema).toBe('armadurastruct/33');
  expect(p.bars).toEqual([]);
  expect(texts(p)).toHaveLength(1);
  expect(texts(p)[0]).toMatchObject({
    text: CONTENT,
    textHeight: 80,
    textRotation: 15,
    textAlign: 'center',
    textFont: { family: 'serif', weight: 'bold', style: 'italic' },
    points: [{ x: 500, y: 300 }],
  });
  await page.keyboard.press('Control+z');
  expect(texts(await save(page))).toHaveLength(0);
  await page.keyboard.press('Control+y');
  p = await save(page);
  expect(texts(p)).toHaveLength(1);
  // Reopening the saved file keeps the content and typography.
  await page.getByTestId('project-input').setInputFiles({
    name: 'texto.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  expect(texts(await save(page))).toEqual(texts(p));
  expect(errors).toEqual([]);
});

test('altura acompanha o zoom como a geometria; edição mantém o ID e cancela sem gravar', async ({
  page,
}) => {
  await start(page);
  await page.getByRole('button', { name: 'Texto', exact: true }).click();
  await command(page, '500,300');
  const insert = page.getByRole('region', { name: 'Inserir texto' });
  await insert.getByLabel('Conteúdo do texto').fill(CONTENT);
  await insert.getByLabel('Altura do texto').fill('80');
  await insert.getByLabel('Conteúdo do texto').press('Enter');
  const id = texts(await save(page))[0].id;
  const text = page.locator(`[data-free-text="${id}"]`);
  const ratio = () =>
    text.evaluate((t) => {
      const m = (t as SVGGraphicsElement).getScreenCTM()!;
      return t.getBoundingClientRect().height / Math.hypot(m.a, m.b);
    });
  const before = await ratio();
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(200);
  expect(await ratio()).toBeCloseTo(before, 1);

  await page
    .getByRole('button', { name: 'Enquadrar', exact: true })
    .first()
    .click();
  const box = (await text.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const edit = page.getByRole('region', { name: 'Editar texto' });
  await edit.getByLabel('Conteúdo do texto').fill('Corte A-A ±');
  await edit.getByLabel('Conteúdo do texto').press('Escape');
  await expect(edit).toHaveCount(0);
  expect(texts(await save(page))[0].text).toBe(CONTENT);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await edit.getByLabel('Conteúdo do texto').fill('Corte A-A ±');
  await edit.getByRole('button', { name: /Aplicar edição/ }).dblclick();
  const p = await save(page);
  expect(texts(p)).toHaveLength(1);
  expect(texts(p)[0]).toMatchObject({ id, text: 'Corte A-A ±' });
  await page.keyboard.press('Control+z');
  expect(texts(await save(page))[0]).toMatchObject({ id, text: CONTENT });
});

test('troca de contexto invalida a operação e conteúdo inválido não grava', async ({
  page,
}) => {
  await start(page);
  const panel = page.getByRole('region', { name: 'Inserir texto' });
  await page.getByRole('button', { name: 'Texto', exact: true }).click();
  await command(page, '100,100');
  await panel.getByLabel('Conteúdo do texto').fill('a ≥ b');
  await panel.getByLabel('Conteúdo do texto').press('Enter');
  await expect(panel.getByRole('alert')).toContainText('Caractere');
  await panel.getByLabel('Conteúdo do texto').fill('ok');
  await panel.getByLabel('Altura do texto').fill('0');
  await panel.getByLabel('Conteúdo do texto').press('Enter');
  await expect(panel.getByRole('alert')).toContainText('Altura');
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(texts(await save(page))).toHaveLength(0);
});

test('Esc cancela a inserção após voltar do conteúdo ao ponto', async ({
  page,
}) => {
  await start(page);
  await command(page, 'TEXTO');
  await command(page, '10,20');
  const panel = page.getByRole('region', { name: 'Inserir texto' });
  await panel.getByLabel('Conteúdo do texto').fill('Cancelado');
  await panel.getByLabel('Conteúdo do texto').press('Escape');
  await expect(panel).toContainText('1/2');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  expect(texts(await save(page))).toHaveLength(0);
});

test('preserva precisão, cancela a troca de ponto e confirmar uma edição neutra não cria histórico', async ({
  page,
}) => {
  await start(page);
  await command(page, 'TEXT');
  await command(page, '123.123456789,-456.987654321');
  const panel = page.getByRole('region', { name: 'Inserir texto' });
  await panel.getByLabel('Conteúdo do texto').fill('Precisão');
  await panel.getByLabel('Altura do texto').fill('48.123456789');
  await panel.getByLabel('Rotação do texto').fill('33.123456789');
  await panel
    .getByRole('button', { name: 'Escolher ponto no desenho' })
    .click();
  await page.keyboard.press('Escape');
  await expect(panel.getByLabel('Conteúdo do texto')).toHaveValue('Precisão');
  await command(page, '');
  await expect(panel).toHaveCount(0);
  const before = texts(await save(page))[0];
  expect(before.points[0]).toEqual({ x: 123.123456789, y: -456.987654321 });
  expect(before.textHeight).toBe(48.123456789);
  await page
    .getByRole('button', { name: 'Enquadrar', exact: true })
    .first()
    .click();
  const box = (await page
    .locator(`[data-free-text="${before.id}"]`)
    .boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const edit = page.getByRole('region', { name: 'Editar texto' });
  await edit.getByRole('button', { name: /Aplicar edição/ }).click();
  await expect(edit).toHaveCount(0);
  expect(texts(await save(page))[0]).toEqual(before);
  await page.keyboard.press('Control+z');
  expect(texts(await save(page))).toHaveLength(0);
});
