import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { maskManipFixture } from '../fixtures/maskManipulation';
import { nativePrimitive } from '../../src/domain/nativeMasks';
import { maskPoint } from '../../src/cad/import';
import { transformPoint } from '../../src/domain/transforms';
import { emptyProject } from '../../src/domain/model';
import type { Project } from '../../src/domain/types';
const panel = (p: Page) =>
  p.getByRole('region', {
    name: 'Rotacionar entidades da máscara',
    exact: true,
  });
const heading = (p: Page) => panel(p).locator('.transform-heading span');
async function open(p: Page, seed = maskManipFixture()) {
  await p.goto('/');
  await expect(p.locator('.busy-overlay')).toHaveCount(0);
  await p.getByTestId('project-input').setInputFiles({
    name: 'rotate.json',
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
async function csv(p: Page) {
  await p.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  const d = p.waitForEvent('download');
  await p.getByRole('button', { name: 'Quadro CSV', exact: true }).click();
  const text = readFileSync((await (await d).path())!, 'utf8');
  await p.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  return text;
}
async function command(p: Page, s: string) {
  const c = p.getByRole('textbox', { name: 'Comando CAD' });
  await c.fill(s);
  await c.press('Enter');
}
async function start(p: Page) {
  await p
    .getByRole('button', {
      name: 'Rotacionar entidades da máscara',
      exact: true,
    })
    .click();
}
/** Seleciona só a primeira entidade (a linha) e confirma o conjunto. */
async function selectLine(p: Page) {
  await panel(p).getByRole('checkbox').nth(0).check();
  await command(p, '');
}
async function typeAngle(p: Page, value: string) {
  const field = panel(p).getByLabel('Ângulo da rotação', { exact: true });
  await field.fill(value);
  await field.press('Enter');
}
/** Linha do critério da issue: (10,10)–(110,10). */
function issueSeed() {
  const seed = maskManipFixture();
  seed.masks[0].primitives[0] = nativePrimitive(
    {
      kind: 'line',
      points: [
        { x: 10, y: 10 },
        { x: 110, y: 10 },
      ],
      closed: false,
    },
    'line',
  );
  return seed;
}
const linePoints = (project: Project) => {
  const native = project.masks[0].primitives[0].native as {
    points: { x: number; y: number }[];
  };
  return native.points;
};

test('critério da issue: +90° pelo painel, prévia pura, um lote, IDs, Enter repetido, histórico, −90° reverte e 360° é neutro', async ({
  page,
}) => {
  await open(page, issueSeed());
  const before = await save(page),
    beforeCsv = await csv(page);
  await start(page);
  await expect(heading(page)).toHaveText('Selecionar entidades');
  await selectLine(page);
  await expect(heading(page)).toHaveText('Ponto base');
  await command(page, '10,10');
  await expect(heading(page)).toHaveText('Ângulo');
  await typeAngle(page, '90');
  await expect(heading(page)).toHaveText('Confirmar rotação');
  await expect(panel(page)).toContainText('Rotação: 90° · anti-horário');
  // Rotacionar sempre substitui no lugar: não há pergunta de origem.
  await expect(
    panel(page).getByLabel('Apagar objetos de origem?', { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId('rotation-angle-label')).toHaveText('90°');
  await expect(page.getByTestId('rotation-arc')).toHaveCount(1);
  // A prévia não toca o projeto.
  expect((await save(page)).masks).toEqual(before.masks);
  await page.screenshot({ path: 'docs/mask-rotate-confirm.png' });
  await panel(page)
    .getByRole('button', { name: 'Confirmar rotação · Enter', exact: true })
    .click();
  await expect(panel(page)).toHaveCount(0);
  const after = await save(page),
    [a, b] = linePoints(after);
  expect(a.x).toBeCloseTo(10, 8);
  expect(a.y).toBeCloseTo(10, 8);
  expect(b.x).toBeCloseTo(10, 8);
  expect(b.y).toBeCloseTo(110, 8);
  expect(after.masks[0].primitives[0].id).toBe('line');
  expect(after.masks[0].primitives).toHaveLength(3);
  expect(after.masks[0].primitives.slice(1)).toEqual(
    before.masks[0].primitives.slice(1),
  );
  expect(after.bars).toEqual(before.bars);
  expect(after.annotations).toEqual(before.annotations);
  expect(after.masks[1]).toEqual(before.masks[1]);
  expect(after.scheduleLock).toEqual(before.scheduleLock);
  expect(await csv(page)).toBe(beforeCsv);
  // Enter repetido depois de concluir não aplica de novo.
  await command(page, '');
  expect((await save(page)).masks).toEqual(after.masks);
  await command(page, 'U');
  expect((await save(page)).masks).toEqual(before.masks);
  await command(page, 'REDO');
  expect((await save(page)).masks).toEqual(after.masks);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect((await save(page)).masks).toEqual(after.masks);
  // −90° com a mesma base devolve a linha original (ângulo pelo Comando CAD).
  await open(page, after);
  await start(page);
  await selectLine(page);
  await command(page, '10,10');
  await command(page, '-90');
  await expect(panel(page)).toContainText('Rotação: -90° · horário');
  await command(page, '');
  const back = linePoints(await save(page));
  linePoints(before).forEach((p, i) => {
    expect(back[i].x).toBeCloseTo(p.x, 8);
    expect(back[i].y).toBeCloseTo(p.y, 8);
  });
  // 360° é neutro: nada muda.
  const settled = await save(page);
  await start(page);
  await selectLine(page);
  await command(page, '10,10');
  await typeAngle(page, '360');
  await expect(panel(page)).toContainText('neutro, nada muda');
  await command(page, '');
  expect((await save(page)).masks).toEqual(settled.masks);
});

test('Esc em cada etapa, ângulo inválido, Referência degenerada e troca de projeto não aplicam', async ({
  page,
}) => {
  await open(page);
  const before = await save(page);
  for (const stage of ['selection', 'base', 'target', 'reference', 'confirm']) {
    await start(page);
    if (stage !== 'selection') {
      await selectLine(page);
      if (stage !== 'base') {
        await command(page, '0,0');
        if (stage === 'reference') await command(page, 'R');
        if (stage === 'confirm') await typeAngle(page, '45');
      }
    }
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    expect((await save(page)).masks).toEqual(before.masks);
  }
  await start(page);
  await selectLine(page);
  await command(page, '0,0');
  await typeAngle(page, 'abc');
  await expect(panel(page).getByRole('alert')).toContainText(
    'Ângulo deve ser um número finito',
  );
  await expect(heading(page)).toHaveText('Ângulo');
  await panel(page)
    .getByRole('button', { name: 'Referência · R', exact: true })
    .click();
  await expect(heading(page)).toHaveText('Referência · 1º ponto');
  await command(page, '0,0');
  await command(page, '0,0');
  await expect(panel(page).getByRole('alert')).toContainText(
    'dois pontos distintos',
  );
  expect((await save(page)).masks).toEqual(before.masks);
  await page.getByTestId('project-input').setInputFiles({
    name: 'new.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(emptyProject())),
  });
  await expect(panel(page)).toHaveCount(0);
  await command(page, '');
  expect((await save(page)).masks).toHaveLength(0);
});

test('ângulo por clique com guia no canvas, Referência, Foco e máscara transformada com texto, círculo e retângulo', async ({
  page,
}) => {
  await open(page);
  const svg = page.getByTestId('cad-canvas');
  const position = (q: { x: number; y: number }) =>
    svg.evaluate((s, q) => {
      const a = new DOMPoint(q.x, q.y).matrixTransform(
        (s.querySelector('g[transform]') as SVGGElement).getScreenCTM()!,
      );
      return { x: a.x, y: a.y };
    }, q);
  // Pré-seleção pelo Controle de máscaras, como no Espelhar.
  let at = await position({ x: 500, y: 0 });
  await page.mouse.click(at.x, at.y);
  await page
    .getByRole('dialog', { name: 'Controle de máscaras', exact: true })
    .getByRole('button', {
      name: 'Usar esta máscara e Rotacionar entidades',
      exact: true,
    })
    .click();
  await expect(panel(page)).toContainText('1 entidade(s)');
  await command(page, '');
  await command(page, '0,0');
  // Cursor em (−700, 0): direção a 180°, longe de snaps da fixture.
  at = await position({ x: -700, y: 0 });
  await page.mouse.move(at.x, at.y);
  await expect(page.getByTestId('rotation-guide')).toBeVisible();
  await expect(page.getByTestId('rotation-angle-label')).toHaveText('180°');
  await page.screenshot({ path: 'docs/mask-rotate-guide.png' });
  await page.mouse.click(at.x, at.y);
  await expect(heading(page)).toHaveText('Confirmar rotação');
  await expect(panel(page)).toContainText('Rotação: 180° · anti-horário');
  await page.keyboard.press('Escape');

  const seed = maskManipFixture();
  Object.assign(seed.masks[0], {
    format: 'DXF',
    scale: 2,
    rotation: 30,
    origin: { x: 100, y: 200 },
  });
  seed.masks[0].primitives.push({
    id: 'text',
    layer: 'DESENHO',
    points: [{ x: 100, y: 200 }],
    text: 'Cota 100',
    textHeight: 25,
    textRotation: 20,
  });
  await open(page, seed);
  const before = await save(page);
  await command(page, 'ROTACIONAR');
  await expect(panel(page)).toBeVisible();
  for (const i of [1, 2, 3])
    await panel(page).getByRole('checkbox').nth(i).check();
  await command(page, '');
  await command(page, '0,0');
  // Referência: direção existente a 0°, nova direção a 90° → +90°.
  await command(page, 'R');
  await command(page, '0,0');
  at = await position({ x: 0, y: 0 });
  await page.mouse.move(at.x + 120, at.y - 5);
  await expect(page.getByTestId('rotation-reference')).toHaveCount(1);
  await page.screenshot({ path: 'docs/mask-rotate-reference.png' });
  await command(page, '1000,0');
  await expect(heading(page)).toHaveText('Nova direção');
  await command(page, '0,1000');
  await expect(panel(page)).toContainText('Rotação: 90° · anti-horário');
  await page.getByRole('button', { name: 'Foco no CAD', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/focus-mode/);
  await page.setViewportSize({ width: 900, height: 650 });
  await save(page);
  await page.screenshot({ path: 'docs/mask-rotate-compact.png' });
  await panel(page)
    .getByRole('button', { name: 'Confirmar rotação · Enter', exact: true })
    .click();
  const after = await save(page),
    m0 = before.masks[0],
    m1 = after.masks[0];
  const turn = { kind: 'rotate' as const, base: { x: 0, y: 0 }, angle: 90 };
  // Texto: âncora girada no modelo e orientação somada.
  const expected = transformPoint(
      maskPoint(m0.primitives[3].points[0], m0),
      turn,
    ),
    actual = maskPoint(m1.primitives[3].points[0], m1);
  expect(actual.x).toBeCloseTo(expected.x, 7);
  expect(actual.y).toBeCloseTo(expected.y, 7);
  expect(m1.primitives[3].text).toBe('Cota 100');
  expect(m1.primitives[3].textRotation! + m1.rotation).toBeCloseTo(140, 8);
  // Círculo: centro girado, raio preservado.
  const c0 = m0.primitives[1].native as {
      kind: string;
      center: { x: number; y: number };
      radius: number;
    },
    c1 = m1.primitives[1].native as typeof c0;
  expect(c1.kind).toBe('circle');
  expect(c1.radius).toBeCloseTo(c0.radius, 9);
  const center = transformPoint(maskPoint(c0.center, m0), turn),
    center1 = maskPoint(c1.center, m1);
  expect(center1.x).toBeCloseTo(center.x, 7);
  expect(center1.y).toBeCloseTo(center.y, 7);
  // Retângulo a 90°: polilinha fechada de 4 vértices exatos, mesmo ID.
  const r1 = m1.primitives[2];
  expect(r1.id).toBe('rectangle');
  expect(r1.native).toMatchObject({ kind: 'polyline', closed: true });
  expect((r1.native as { points: unknown[] }).points).toHaveLength(4);
  // Linha não selecionada, aço e outras máscaras intactos.
  expect(m1.primitives[0]).toEqual(m0.primitives[0]);
  expect(after.bars).toEqual(before.bars);
  expect(after.masks[1]).toEqual(before.masks[1]);
});
