import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { maskManipFixture } from '../fixtures/maskManipulation';
import { nativePrimitive } from '../../src/domain/nativeMasks';
import { emptyProject } from '../../src/domain/model';
import { setLayerState } from '../../src/domain/layerProfiles';
import type { Project, Point } from '../../src/domain/types';

const panel = (p: Page) =>
  p.getByRole('region', { name: 'Medir contorno', exact: true });
const result = (p: Page) =>
  panel(p).getByRole('status', {
    name: 'Resultado da medição de contorno',
    exact: true,
  });
const P = (x: number, y: number): Point => ({ x, y });
function fixture(): Project {
  const p = maskManipFixture();
  p.masks[0].primitives = [
    nativePrimitive(
      { kind: 'rectangle', points: [P(0, 0), P(3000, 4000)], closed: true },
      'rect',
    ),
    nativePrimitive(
      {
        kind: 'polyline',
        points: [P(5000, 0), P(8000, 0), P(8000, 4000)],
        closed: false,
      },
      'open',
    ),
    nativePrimitive(
      { kind: 'circle', center: P(11000, 2000), radius: 1000 },
      'circle',
    ),
    nativePrimitive(
      {
        kind: 'polyline',
        points: [P(14000, 0), P(16000, 4000), P(16000, 0), P(14000, 4000)],
        closed: true,
      },
      'bowtie',
    ),
  ];
  // Imported reference: only the normalized polyline is available.
  Object.assign(p.masks[1], {
    format: 'DXF',
    sourceUnit: 'mm',
    primitives: [
      {
        id: 'imported',
        layer: 'FORMA',
        points: [P(0, -3000), P(2000, -3000), P(2000, -2000), P(0, -2000)],
        closed: true,
      },
    ],
    layers: { FORMA: true },
  });
  return p;
}
async function open(p: Page, seed = fixture()) {
  await p.goto('/');
  await expect(p.locator('.busy-overlay')).toHaveCount(0);
  await p.getByTestId('project-input').setInputFiles({
    name: 'contour.json',
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
async function command(p: Page, s: string) {
  const c = p.getByRole('textbox', { name: 'Comando CAD' });
  await c.fill(s);
  await c.press('Enter');
}
async function exported(p: Page, button: string) {
  await p.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  const d = p.waitForEvent('download');
  await p.getByRole('button', { name: button, exact: true }).click();
  const text = readFileSync((await (await d).path())!, 'utf8');
  await p.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  return text;
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
const unit = (p: Page, u: string, precision?: string) =>
  panel(p)
    .getByLabel('Unidade da medida', { exact: true })
    .selectOption(u)
    .then(() =>
      precision
        ? panel(p)
            .getByLabel('Precisão da medida', { exact: true })
            .selectOption(precision)
        : undefined,
    );

test('Medir contorno: retângulo, caminho aberto, círculo, inválido e importado sem alterar projeto, histórico ou CSV', async ({
  page,
}) => {
  await open(page);
  const original = await save(page);
  await page.getByRole('button', { name: 'Linha', exact: true }).click();
  await command(page, '20000,0');
  await command(page, '21000,0');
  await page.keyboard.press('Escape');
  await command(page, 'F');
  const before = await save(page),
    csv = await exported(page, 'Quadro CSV');
  // Finish recovery from the line created above before observing the query.
  await expect(page.locator('.save-status')).toHaveText(
    'Apenas recuperável localmente',
  );
  const saveStatus = await page.locator('.save-status').textContent();

  await page
    .getByRole('button', { name: 'Medir contorno', exact: true })
    .click();
  await expect(panel(page)).toBeVisible();
  await expect(result(page)).toHaveCount(0);

  // Mouse selection of the rectangle edge.
  await clickModel(page, P(1500, 0));
  await expect(result(page)).toContainText('Contorno fechado');
  await expect(result(page)).toContainText('Perímetro: 14000,00 mm');
  await expect(result(page)).toContainText('Área: 12000000,00 mm²');
  await expect(result(page)).toContainText('Vértices exatos');
  await expect(
    page.getByTestId('mask-cad-limits').locator('path, polyline, polygon'),
  ).not.toHaveCount(0);
  await unit(page, 'm');
  await expect(result(page)).toContainText('Perímetro: 14,00 m');
  await expect(result(page)).toContainText('Área: 12,00 m²');
  await unit(page, 'cm', '0');
  await expect(result(page)).toContainText('Perímetro: 1400 cm');
  await expect(result(page)).toContainText('Área: 120000 cm²');
  await unit(page, 'm', '2');
  await page.screenshot({ path: 'docs/mask-contour-closed.png' });

  // Zoom and pan do not change the physical result.
  await page.getByTestId('cad-canvas').hover();
  await page.mouse.wheel(0, -500);
  const a = await screen(page, P(4000, 2000));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(a.x + 80, a.y + 40);
  await page.mouse.up({ button: 'middle' });
  await clickModel(page, P(0, 2000));
  await expect(result(page)).toContainText('Perímetro: 14,00 m');
  await expect(result(page)).toContainText('Área: 12,00 m²');

  // Repeat with typed model coordinates: open path → only length.
  await command(page, '6500,0');
  await expect(result(page)).toContainText('Caminho aberto');
  await expect(result(page)).toContainText('Comprimento: 7,00 m');
  await expect(result(page)).toContainText(
    'Área: não se aplica a caminho aberto',
  );
  await expect(result(page)).not.toContainText('Perímetro');
  await page.screenshot({ path: 'docs/mask-contour-open.png' });

  await command(page, '12000,2000');
  await unit(page, 'm', '4');
  await expect(result(page)).toContainText('Perímetro: 6,2832 m');
  await expect(result(page)).toContainText('Área: 3,1416 m²');
  await expect(result(page)).toContainText('Cálculo analítico');

  // Self-intersecting outline: warning, no numbers.
  await command(page, '16000,2000');
  await expect(panel(page).getByRole('alert')).toContainText('autointerseção');
  await expect(result(page)).not.toContainText('Área:');
  await expect(result(page)).not.toContainText('Perímetro:');
  await page.screenshot({ path: 'docs/mask-contour-invalid.png' });

  // Imported reference: approximation is stated.
  await command(page, '1000,-3000');
  await expect(result(page)).toContainText('contorno importado');
  await expect(result(page)).toContainText('Perímetro: 6,0000 m');
  await expect(result(page)).toContainText('Área: 2,0000 m²');
  await expect(result(page)).toContainText('Aproximação disponível');

  // Empty point: clear message, previous result kept, nothing created.
  await command(page, '30000,30000');
  await expect(panel(page).getByRole('alert')).toContainText(
    'Nenhuma entidade de máscara',
  );

  expect(await save(page)).toEqual(before);
  await expect(page.locator('.save-status')).toHaveText(saveStatus!);
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByTestId('mask-cad-limits')).toHaveCount(0);
  expect(await save(page)).toEqual(before);
  expect(await exported(page, 'Quadro CSV')).toBe(csv);
  // The only history entry is still the line drawn before the query.
  await command(page, 'U');
  expect((await save(page)).masks).toEqual(original.masks);
});

test('Medir contorno: troca de máscara, ferramenta e projeto limpa a consulta; layer bloqueado só é consultado; Foco compacto', async ({
  page,
}) => {
  let seed = fixture();
  seed = setLayerState(
    seed,
    'model',
    seed.layers.find((l) => l.name === 'DESENHO')!.id,
    { editable: false },
  );
  await open(page, seed);
  await command(page, 'F');
  const before = await save(page);
  await command(page, 'CONTORNO');
  await command(page, '1500,0');
  await expect(result(page)).toContainText('Perímetro: 14000,00 mm');
  expect(await save(page)).toEqual(before);

  // Tool change: distance mode starts clean, without the previous selection.
  await panel(page)
    .getByLabel('Operação de medir e cotar', { exact: true })
    .selectOption('measure');
  await expect(panel(page)).toHaveCount(0);
  const distance = page.getByRole('region', {
    name: 'Medir e cotar',
    exact: true,
  });
  await expect(distance).toBeVisible();
  await expect(page.getByTestId('mask-cad-limits')).toHaveCount(0);
  await distance
    .getByLabel('Operação de medir e cotar', { exact: true })
    .selectOption('measure-contour');
  await expect(panel(page)).toBeVisible();
  await expect(result(page)).toHaveCount(0);

  // Active mask change.
  await command(page, '1500,0');
  await expect(result(page)).toBeVisible();
  const dest = page.getByRole('region', {
    name: 'Destino do desenho de máscaras',
    exact: true,
  });
  await dest
    .getByLabel('Escolher máscara', { exact: true })
    .selectOption('external-mask');
  await dest
    .getByRole('button', { name: 'Ativar máscara para desenhar', exact: true })
    .click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByTestId('mask-cad-limits')).toHaveCount(0);

  // Another ribbon tool ends the query.
  await page
    .getByRole('button', { name: 'Medir contorno', exact: true })
    .click();
  await command(page, '1500,0');
  await expect(result(page)).toBeVisible();
  await page
    .getByRole('button', { name: 'Cota alinhada', exact: true })
    .click();
  await expect(panel(page)).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Project change.
  await page
    .getByRole('button', { name: 'Medir contorno', exact: true })
    .click();
  await command(page, '1500,0');
  await page.getByTestId('project-input').setInputFiles({
    name: 'new.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(emptyProject())),
  });
  await expect(panel(page)).toHaveCount(0);

  // Compact access in Foco.
  await open(page, fixture());
  await page.getByRole('button', { name: 'Foco no CAD', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/focus-mode/);
  await page.setViewportSize({ width: 900, height: 650 });
  await page
    .getByRole('button', {
      name: 'Referências e comandos de máscara',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', { name: 'Medir contorno', exact: true })
    .click();
  await command(page, '12000,2000');
  await expect(result(page)).toContainText('Cálculo analítico');
  await page.screenshot({ path: 'docs/mask-contour-compact.png' });
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
});
