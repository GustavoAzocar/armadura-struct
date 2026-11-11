import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { maskManipFixture } from '../fixtures/maskManipulation';
import { nativePrimitive } from '../../src/domain/nativeMasks';
import type { Project, Point } from '../../src/domain/types';

const P = (x: number, y: number): Point => ({ x, y });
const panel = (p: Page) =>
  p.getByRole('region', { name: 'Lançamento de tela soldada', exact: true });
const numbers = (p: Page) =>
  panel(p).getByLabel('Quantitativos da prévia', { exact: true });
const meshes = (p: Page) => p.getByTestId('cad-welded-mesh');

/** Laje 6.000 × 4.750 com um furo de 1 × 1 m e uma polilinha com lacuna de 0,5 mm. */
function fixture(): Project {
  const p = maskManipFixture();
  p.masks[0].primitives = [
    nativePrimitive(
      { kind: 'rectangle', points: [P(0, 0), P(6000, 4750)], closed: true },
      'laje',
    ),
    nativePrimitive(
      {
        kind: 'rectangle',
        points: [P(1000, 1000), P(2000, 2000)],
        closed: true,
      },
      'furo',
    ),
    nativePrimitive(
      {
        kind: 'polyline',
        points: [
          P(8000, 0),
          P(11000, 0),
          P(11000, 2000),
          P(8000, 2000),
          P(8000, 0.5),
        ],
        closed: false,
      },
      'lacuna',
    ),
    // Região só de linhas soltas que se cruzam (3 × 2 m), como numa fôrma real.
    ...(
      [
        [P(11800, 0), P(15200, 0)],
        [P(15000, -200), P(15000, 2200)],
        [P(15200, 2000), P(11800, 2000)],
        [P(12000, 2200), P(12000, -200)],
      ] as const
    ).map(([a, b], i) =>
      nativePrimitive(
        { kind: 'line', points: [a, b], closed: false },
        `linha-${i}`,
      ),
    ),
  ];
  p.masks[1].primitives = [];
  return p;
}
/** Modo clique usa a máscara ativa, escolhida em Máscaras → Referências. */
async function activateMask(p: Page) {
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
  await p.getByRole('tab', { name: 'Armaduras', exact: true }).click();
}
async function open(p: Page) {
  await p.goto('/');
  await expect(p.locator('.busy-overlay')).toHaveCount(0);
  await p.getByTestId('project-input').setInputFiles({
    name: 'telas.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture())),
  });
  await expect(p.locator('.busy-overlay')).toHaveCount(0);
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
async function command(p: Page, s: string) {
  const c = p.getByRole('textbox', { name: 'Comando CAD' });
  await c.fill(s);
  await c.press('Enter');
}
async function screen(p: Page, q: Point) {
  return p.getByTestId('cad-canvas').evaluate(async (s, q) => {
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
    const a = new DOMPoint(q.x, q.y).matrixTransform(
      (s.querySelector('g[transform]') as SVGGElement).getScreenCTM()!,
    );
    return { x: a.x, y: a.y };
  }, q);
}
async function clickModel(p: Page, q: Point) {
  const at = await screen(p, q);
  await p.mouse.click(at.x, at.y);
}

test('contorno com abertura: prévia com os números do caso 2, confirmação atômica, desfazer e arquivo', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await command(page, 'TS');
  // Primeira vez: critérios antes, com o botão de lançar.
  const d = page.getByRole('dialog', {
    name: 'Critérios de telas soldadas',
    exact: true,
  });
  await expect(d).toBeVisible();
  await d.getByRole('button', { name: 'Paginação', exact: true }).click();
  await d
    .getByLabel('Sobreposição na largura (mm)', { exact: true })
    .fill('150');
  await d
    .getByRole('button', { name: 'Usar critérios e lançar', exact: true })
    .click();
  await expect(panel(page)).toBeVisible();
  await expect(
    panel(page).getByRole('button', { name: 'Contorno', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');

  // Contorno: a laje; a prévia já mostra os números.
  await clickModel(page, P(3000, 0));
  await expect(numbers(page)).toContainText('2 (2 inteiro(s), 0 peça(s)');
  await expect(numbers(page)).toContainText('28,50 m²');
  await expect(numbers(page)).toContainText('29,40 m²');
  await expect(numbers(page)).toContainText('0,90 m²');
  await expect(page.getByTestId('transform-preview')).toBeVisible();

  // Abertura por entidade: o furo de 1 m².
  await clickModel(page, P(1500, 1000));
  await expect(
    panel(page).getByRole('list', { name: 'Aberturas' }),
  ).toContainText('Abertura 1 · 1,00 m²');
  await expect(numbers(page)).toContainText('27,50 m²');
  // A mesma entidade não entra duas vezes.
  await clickModel(page, P(1500, 1000));
  await expect(panel(page).getByRole('alert')).toContainText(
    'Esta entidade já faz parte da região.',
  );
  await expect(meshes(page)).toHaveCount(0);

  await panel(page)
    .getByRole('button', { name: 'Concluir aberturas', exact: true })
    .click();
  await panel(page)
    .getByRole('button', { name: 'Confirmar lançamento', exact: true })
    .click();
  await expect(panel(page)).toBeHidden();
  await expect(meshes(page)).toHaveCount(1);

  // Uma operação só: desfazer remove a tela inteira; refazer devolve.
  await page.keyboard.press('Control+z');
  await expect(meshes(page)).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(meshes(page)).toHaveCount(1);

  const saved = await save(page);
  expect(saved.weldedMeshes).toHaveLength(1);
  const l = saved.weldedMeshes![0];
  expect(l.source.mode).toBe('contour');
  expect(l.region.openings).toHaveLength(1);
  expect(l.criteria.widthOverlap).toBe(150);
  expect(l.criteria).not.toHaveProperty('layerId');
  expect(saved.weldedMeshDefaults?.widthOverlap).toBe(150);
  expect(saved.hierarchy.objectDetails[l.id]).toBeTruthy();
  expect(errors).toEqual([]);
});

test('pontos, lacuna com confirmação obrigatória e Esc sem lançar', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await command(page, 'TS');
  await page
    .getByRole('dialog', { name: 'Critérios de telas soldadas', exact: true })
    .getByRole('button', { name: 'Usar critérios e lançar', exact: true })
    .click();

  // Pontos: retângulo de 3 × 2 m acima da polilinha; Backspace desfaz um ponto.
  await panel(page)
    .getByRole('button', { name: 'Pontos', exact: true })
    .click();
  for (const q of [
    P(8000, 2500),
    P(11000, 2500),
    P(11000, 4500),
    P(9000, 3000),
  ])
    await clickModel(page, q);
  await page.keyboard.press('Backspace');
  await clickModel(page, P(8000, 4500));
  await expect(panel(page).getByRole('status')).toContainText('4 ponto(s)');
  await page.keyboard.press('Enter');
  await expect(numbers(page)).toContainText('6,00 m²');
  await page.keyboard.press('Enter'); // sem aberturas: conferência
  await page.keyboard.press('Enter'); // confirma
  await expect(panel(page)).toBeHidden();
  await expect(meshes(page)).toHaveCount(1);

  // Contorno com lacuna de 0,5 mm: confirmação explícita antes de lançar.
  await command(page, 'TS');
  await expect(panel(page)).toBeVisible();
  await clickModel(page, P(9500, 0));
  await expect(
    panel(page).getByRole('group', { name: 'Lacunas fechadas por ajuste' }),
  ).toBeVisible();
  await panel(page)
    .getByRole('button', { name: 'Concluir aberturas', exact: true })
    .click();
  const confirm = panel(page).getByRole('button', {
    name: 'Confirmar lançamento',
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await panel(page)
    .getByLabel('Confirmo o fechamento das lacunas acima')
    .check();
  await expect(confirm).toBeEnabled();

  // Esc cancela sem gravar nada.
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(meshes(page)).toHaveCount(1);
  const saved = await save(page);
  expect(saved.weldedMeshes).toHaveLength(1);
  expect(saved.weldedMeshes![0].source.mode).toBe('points');
  expect(errors).toEqual([]);
});

test('clique: linhas que se cruzam, região maior, contorno interno como abertura e ponto de partida', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await command(page, 'TS');
  const d = page.getByRole('dialog', {
    name: 'Critérios de telas soldadas',
    exact: true,
  });
  await d.getByRole('button', { name: 'Paginação', exact: true }).click();
  await d
    .getByLabel('Sobreposição na largura (mm)', { exact: true })
    .fill('150');
  await d
    .getByRole('button', { name: 'Usar critérios e lançar', exact: true })
    .click();
  // Sem máscara ativa, o modo clique pede para escolher uma.
  await panel(page)
    .getByRole('button', { name: 'Clique', exact: true })
    .click();
  await expect(panel(page).getByRole('status')).toContainText(
    'Escolha a máscara ativa',
  );
  // E clicar mesmo assim não usa outra máscara por conta própria.
  await clickModel(page, P(13500, 1000));
  await expect(panel(page).getByRole('alert')).toContainText(
    'Escolha a máscara ativa em Máscaras → Referências',
  );
  await page.keyboard.press('Escape');
  await activateMask(page);

  // Linhas soltas que se cruzam delimitam a região.
  await command(page, 'TS');
  await panel(page)
    .getByRole('button', { name: 'Clique', exact: true })
    .click();
  await expect(panel(page).getByRole('status')).toContainText(
    'máscara ativa (Fôrma ativa)',
  );
  await clickModel(page, P(13500, 1000));
  await expect(
    panel(page).getByRole('group', { name: 'Região pelo clique' }),
  ).toContainText('Região 1 de 1 · 6,00 m²');
  await expect(numbers(page)).toContainText('6,00 m²');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(meshes(page)).toHaveCount(1);

  // Na laje, fora do furo: o furo é oferecido, desmarcado, desde o 1º clique.
  await command(page, 'TS');
  await panel(page)
    .getByRole('button', { name: 'Clique', exact: true })
    .click();
  await clickModel(page, P(4000, 3000));
  const region = panel(page).getByRole('group', { name: 'Região pelo clique' });
  await expect(region).toContainText('Região 1 de 1 · 28,50 m²');
  await expect(
    region.getByLabel('Usar contorno interno 1 (1,00 m²) como abertura'),
  ).not.toBeChecked();
  await expect(numbers(page)).toContainText('Área útil28,50 m²');
  // Dentro do furo: a menor é o furo; a maior, a laje, que oferece o furo.
  await panel(page)
    .getByRole('button', { name: 'Voltar etapa', exact: true })
    .click();
  await clickModel(page, P(1500, 1500));
  await expect(region).toContainText('Região 1 de 2 · 1,00 m²');
  await region
    .getByRole('button', { name: 'Região maior', exact: true })
    .click();
  await expect(region).toContainText('Região 2 de 2 · 28,50 m²');
  const island = region.getByLabel(
    'Usar contorno interno 1 (1,00 m²) como abertura',
  );
  await expect(island).not.toBeChecked();
  await expect(numbers(page)).toContainText('Área útil28,50 m²');
  await island.check();
  await expect(numbers(page)).toContainText('Área útil27,50 m²');

  // Conferência: ponto de partida explícito muda a grade (2 → 3 painéis).
  await panel(page)
    .getByRole('button', { name: 'Concluir aberturas', exact: true })
    .click();
  await expect(numbers(page)).toContainText('Painéis-base2 (');
  await panel(page)
    .getByRole('button', { name: 'Indicar ponto de partida', exact: true })
    .click();
  // Coordenada exata digitada na linha de comando (o clique livre não é redondo).
  await command(page, '0,1000');
  await expect(panel(page)).toContainText('Ponto de partida: 0; 1.000 mm');
  await expect(numbers(page)).toContainText('Painéis-base3 (');
  await panel(page)
    .getByRole('button', { name: 'Confirmar lançamento', exact: true })
    .click();
  await expect(meshes(page)).toHaveCount(2);

  const saved = await save(page);
  const [lines, slab] = saved.weldedMeshes!;
  expect(lines.source).toEqual({ mode: 'click', maskId: 'target-mask' });
  expect(slab.source.mode).toBe('click');
  expect(slab.region.openings).toHaveLength(1);
  expect(slab.anchor).toEqual({ x: 0, y: 1000 });
  expect(errors).toEqual([]);
});
