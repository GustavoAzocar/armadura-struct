import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject } from '../../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
} from '../../src/domain/hierarchy';
import { newNativeMask } from '../../src/domain/nativeMasks';
import { setLayerState } from '../../src/domain/layerProfiles';
import { layerId } from '../../src/domain/layers';
import { MASK_LIMIT } from '../../src/domain/maskBatch';
import type { Project } from '../../src/domain/types';

// Issue #119: icon-only Ferramentas/Manipular/Desenhar and the Referências
// group integrated at the end of the Máscaras ribbon.
const COMMANDS: Record<string, string[]> = {
  Ferramentas: [
    'Copiar propriedades',
    'Ajustar escala',
    'Offset — Paralelas de máscara',
    'Ajustar — Aparar / Trim de máscara',
    'Estender — Extend de máscara',
    'Medir distância',
    'Medir contorno',
    'Cota ortogonal',
    'Cota alinhada',
  ],
  Manipular: [
    'Mover entidades da máscara',
    'Espelhar entidades da máscara',
    'Rotacionar entidades da máscara',
    'Copiar entidades da máscara',
    'Apagar entidades da máscara',
  ],
  Desenhar: ['Linha', 'Retângulo', 'Círculo', 'Polilinha', 'Texto'],
};
const group = (page: Page, name: string) =>
  page.locator(`.ribbon-content [data-group="${name}"]`);
const destination = (page: Page) =>
  page.getByRole('region', {
    name: 'Destino do desenho de máscaras',
    exact: true,
  });
const active = (page: Page) =>
  page.getByRole('region', {
    name: 'Máscara ativa para desenhar',
    exact: true,
  });
const toggle = (page: Page) =>
  page.getByRole('button', {
    name: 'Referências e comandos de máscara',
    exact: true,
  });
async function load(page: Page, p: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'masks.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await expect(page.getByRole('banner').locator('.window-project')).toHaveText(
    p.name,
  );
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
}
async function save(page: Page): Promise<Project> {
  const close = page.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await close.isVisible()) await close.click();
  const event = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
}
function fixture(long = false) {
  let p = emptyProject();
  p.name = 'Interface de máscaras';
  p.hierarchy.floors[0].name = 'Térreo';
  p.hierarchy.elements[0].name = 'Vigas';
  p.hierarchy.details[0].name = 'V1';
  const a = p.hierarchy.details[0].id,
    floor = createHierarchyNode(p, 'floor', 'Cobertura'),
    el = createHierarchyNode(floor.project, 'element', 'Vigas', floor.id),
    other = createHierarchyNode(el.project, 'detail', 'V1', el.id);
  p = other.project;
  const masks = [
    { ...newNativeMask('Fôrma'), id: 'homonym-0001' },
    { ...newNativeMask('Fôrma'), id: 'homonym-0002' },
    ...(long
      ? Array.from({ length: MASK_LIMIT - 2 }, (_, i) => ({
          ...newNativeMask(
            `Planta de fôrmas do pavimento tipo com nome bem longo ${i + 1}`,
          ),
          id: `long-${i}`,
        }))
      : []),
  ];
  const objectDetails: Record<string, string> = {};
  masks.forEach((m, i) => (objectDetails[m.id] = i === 1 ? other.id : a));
  return completeOwnership(
    {
      ...p,
      masks,
      hierarchy: {
        ...p.hierarchy,
        objectDetails: { ...p.hierarchy.objectDetails, ...objectDetails },
      },
    },
    a,
  );
}

test('três grupos usam botões só com ícone, mesma ordem, nomes acessíveis e ícones distintos', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await load(page, fixture());
  for (const [name, commands] of Object.entries(COMMANDS)) {
    const g = group(page, name);
    await expect(g.locator('.ribbon-group-label')).toHaveText(name);
    await expect(g.getByRole('button')).toHaveCount(commands.length);
    for (const [i, label] of commands.entries()) {
      const b = g.getByRole('button').nth(i);
      await expect(b).toHaveAccessibleName(label);
      await expect(b).toHaveText('');
      const box = (await b.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(24);
      expect(box.width).toBeLessThanOrEqual(32);
    }
  }
  const icons = await page
    .locator('.ribbon-content .ribbon-tool-compact svg')
    .evaluateAll((s) => s.map((x) => x.innerHTML));
  expect(icons).toHaveLength(19);
  expect(new Set(icons).size).toBe(19);
  // Same height as before: the faixa does not grow over the drawing.
  expect(
    (await page.locator('.ribbon-content').boundingBox())!.height,
  ).toBeLessThanOrEqual(79);
  await expect(page.locator('.ribbon > .mask-destination')).toHaveCount(0);
  await expect(
    page.locator('.ribbon-content > .ribbon-group').last(),
  ).toHaveAttribute('data-group', 'Referências');
  await expect(
    group(page, 'Referências').getByRole('region', {
      name: 'Destino do desenho de máscaras',
    }),
  ).toHaveCount(1);
  await expect(
    group(page, 'Controle de máscaras').getByRole('button'),
  ).toHaveText(['Controle de máscaras', 'Biblioteca de símbolos']);
  await expect(page.getByLabel('Ferramentas CAD da máscara ativa')).toHaveCount(
    0,
  );
  await page.screenshot({
    path: 'docs/mask-ribbon-1920.png',
    clip: { x: 0, y: 0, width: 1920, height: 150 },
  });
});

test('ajuda no mouse e no teclado, sem cortar nem capturar clique; Enter/Espaço/Esc preservados', async ({
  page,
}) => {
  page.on('dialog', (d) => d.accept());
  await page.setViewportSize({ width: 1366, height: 768 });
  await load(page, fixture());
  await destination(page)
    .getByLabel('Escolher máscara', { exact: true })
    .selectOption('homonym-0001');
  await destination(page)
    .getByRole('button', { name: 'Ativar máscara para desenhar', exact: true })
    .click();
  const before = await save(page);
  const offset = page.getByRole('button', {
    name: 'Offset — Paralelas de máscara',
    exact: true,
  });
  await offset.hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toHaveText('Offset — Paralelas de máscara');
  await expect(tip).toHaveCSS('pointer-events', 'none');
  const b = (await offset.boundingBox())!;
  expect(
    await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.ariaLabel,
      [b.x + b.width / 2, b.y + b.height / 2],
    ),
  ).toBe('Offset — Paralelas de máscara');
  await page.screenshot({
    path: 'docs/mask-ribbon-tooltip.png',
    clip: { x: 0, y: 0, width: 700, height: 170 },
  });
  await page.mouse.move(700, 600);
  await expect(tip).toHaveCount(0);

  // Keyboard: focus shows the name at once; Enter runs the command itself.
  await group(page, 'Desenhar').getByRole('button').nth(1).focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(tip).toHaveText('Retângulo');
  await page.keyboard.press('Shift+Tab');
  await expect(tip).toHaveText('Linha');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Linha', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Linha', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page
    .getByRole('button', { name: 'Medir distância', exact: true })
    .focus();
  await page.keyboard.press(' ');
  await expect(
    page.getByRole('button', { name: 'Medir distância', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');

  // Right edge: the bubble stays inside the window.
  const associate = destination(page).getByRole('button', {
    name: 'Associar máscaras do projeto',
    exact: true,
  });
  await associate.hover();
  const t = (await tip.boundingBox())!;
  expect(t.x).toBeGreaterThanOrEqual(0);
  expect(t.x + t.width).toBeLessThanOrEqual(1366);
  await page.mouse.move(700, 600);

  // Searching and browsing the selector trigger no drawing shortcut.
  const search = destination(page).getByLabel('Pesquisar máscaras do projeto', {
    exact: true,
  });
  await search.pressSequentially('befm');
  await search.press('Enter');
  await expect(
    group(page, 'Navegar').getByRole('button', {
      name: 'Selecionar',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['Pan', 'Selecionar']) {
    const button = group(page, 'Navegar').getByRole('button', {
      name,
      exact: true,
    });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  expect(await save(page)).toEqual(before);
});

test('Referências: candidata ≠ ativa, ativação explícita, estados protegidos visíveis e nomes longos', async ({
  page,
}) => {
  page.on('dialog', (d) => d.accept());
  let p = fixture(true);
  p = {
    ...p,
    masks: p.masks.map((m, i) => (i === 0 ? { ...m, visible: false } : m)),
  };
  await page.setViewportSize({ width: 1366, height: 768 });
  await load(page, p);
  await expect(active(page)).toContainText('Nenhuma máscara ativa');
  await expect(
    destination(page).getByRole('button', {
      name: 'Ativar máscara para desenhar',
      exact: true,
    }),
  ).toBeDisabled();
  await destination(page)
    .getByLabel('Escolher máscara', { exact: true })
    .selectOption('homonym-0001');
  await expect(active(page)).toContainText('Nenhuma máscara ativa');
  await destination(page)
    .getByRole('button', { name: 'Ativar máscara para desenhar', exact: true })
    .click();
  await expect(active(page)).toContainText('[homonym-0001]');
  await expect(active(page)).toContainText('oculta');
  await expect(active(page).locator('span')).toBeVisible();
  await page.screenshot({
    path: 'docs/mask-ribbon-protected.png',
    clip: { x: 866, y: 0, width: 500, height: 120 },
  });
  await destination(page)
    .getByLabel('Escolher máscara', { exact: true })
    .selectOption(p.masks.at(-1)!.id);
  const last = p.masks.at(-1)!;
  const title = await destination(page)
    .getByLabel('Escolher máscara', { exact: true })
    .getAttribute('title');
  expect(title).toContain(last.name);
  expect(title).toContain(`[${last.id}]`);
  const ref = (await group(page, 'Referências').boundingBox())!;
  expect(ref.x + ref.width).toBeLessThanOrEqual(1366);
  expect(ref.width).toBeLessThan(440);
});

for (const [width, height] of [
  [1920, 1080],
  [1366, 768],
  [1024, 768],
]) {
  test(`${width}×${height}: grupos sem sobreposição, Referências visível e comandos alcançáveis`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await load(page, fixture());
    const boxes = await page
      .locator('.ribbon-content > .ribbon-group')
      .evaluateAll((g) =>
        g.map((x) => {
          const r = x.getBoundingClientRect();
          return { left: r.left, right: r.right };
        }),
      );
    for (let i = 1; i < boxes.length - 1; i++)
      expect(boxes[i].left).toBeGreaterThanOrEqual(boxes[i - 1].right - 1);
    const ref = (await group(page, 'Referências').boundingBox())!;
    expect(ref.x).toBeGreaterThanOrEqual(0);
    expect(ref.x + ref.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    for (const name of ['Pan', 'Ortogonal', 'Desfazer']) {
      const b = group(page, 'Navegar').getByRole('button', {
        name,
        exact: true,
      });
      await b.focus();
      const r = (await b.boundingBox())!;
      const refNow = (await group(page, 'Referências').boundingBox())!;
      expect(r.x + r.width).toBeLessThanOrEqual(refNow.x + 1);
    }
    await page.screenshot({
      path: `docs/mask-ribbon-${width}.png`,
      clip: { x: 0, y: 0, width, height: 150 },
    });
  });
}

test('faixa recolhida e Foco: estado visível, painel temporário, Esc fecha sem cancelar e nada muda de alvo', async ({
  page,
}) => {
  page.on('dialog', (d) => d.accept());
  let p = fixture();
  p = setLayerState(p, 'model', layerId('DESENHO'), { editable: false });
  await page.setViewportSize({ width: 1024, height: 700 });
  await load(page, p);
  await destination(page)
    .getByLabel('Escolher máscara', { exact: true })
    .selectOption('homonym-0001');
  await destination(page)
    .getByRole('button', { name: 'Ativar máscara para desenhar', exact: true })
    .click();
  const before = await save(page);
  for (const enter of ['Recolher', 'Foco'] as const) {
    if (enter === 'Recolher')
      await page
        .getByRole('button', {
          name: 'Recolher faixa de comandos',
          exact: true,
        })
        .click();
    else
      await page
        .getByRole('button', { name: 'Foco no CAD', exact: true })
        .click();
    await expect(page.locator('.ribbon-content')).toHaveCount(0);
    await expect(destination(page)).toHaveCount(0);
    await expect(active(page)).toContainText('[homonym-0001]');
    await expect(active(page)).toContainText('bloqueado');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(destination(page)).toBeVisible();
    await expect(active(page)).toHaveCount(1);
    await page.screenshot({
      path: `docs/mask-ribbon-${enter === 'Foco' ? 'focus' : 'collapsed'}.png`,
      clip: { x: 0, y: 0, width: 1024, height: 200 },
    });
    await page
      .getByRole('button', { name: 'Medir contorno', exact: true })
      .click();
    await expect(page.locator('.ribbon-peek')).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Medir contorno', exact: true }),
    ).toBeVisible();
    await toggle(page).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.ribbon-peek')).toHaveCount(0);
    // Esc closed only the panel: the query is still running.
    await expect(
      page.getByRole('region', { name: 'Medir contorno', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('region', { name: 'Medir contorno', exact: true }),
    ).toHaveCount(0);
    await toggle(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.ribbon-peek')).toBeVisible();
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest('.ribbon-peek'),
      ),
    ).toBe(true);
    await page.mouse.click(600, 500);
    await expect(page.locator('.ribbon-peek')).toHaveCount(0);
    if (enter === 'Recolher')
      await page
        .getByRole('button', {
          name: 'Expandir faixa de comandos',
          exact: true,
        })
        .click();
    else
      await page
        .getByRole('button', { name: 'Foco no CAD', exact: true })
        .click();
    await expect(active(page)).toContainText('[homonym-0001]');
  }
  expect(await save(page)).toEqual(before);
});

test.describe('interface ampliada em 150%', () => {
  // 910 × 512 CSS pixels at DPR 1.5 represent a 1365 × 768 physical window.
  test.use({
    viewport: { width: 910, height: 512 },
    deviceScaleFactor: 1.5,
  });
  test('destino e acesso em Foco continuam alcançáveis', async ({ page }) => {
    await load(page, fixture(true));
    const choose = destination(page).getByLabel('Escolher máscara', {
      exact: true,
    });
    await choose.focus();
    const box = (await choose.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(910);
    await choose.selectOption('homonym-0001');
    await destination(page)
      .getByRole('button', {
        name: 'Ativar máscara para desenhar',
        exact: true,
      })
      .click();
    await page
      .getByRole('button', { name: 'Foco no CAD', exact: true })
      .click();
    await expect(active(page)).toContainText('[homonym-0001]');
    await toggle(page).click();
    await expect(destination(page)).toBeVisible();
    await destination(page)
      .getByLabel('Pesquisar máscaras do projeto', { exact: true })
      .focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('.ribbon-peek')).toHaveCount(0);
    await expect(active(page)).toContainText('[homonym-0001]');
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: 'docs/mask-ribbon-scale-150.png' });
  });
});

test('outras abas mantêm botões com rótulo', async ({ page }) => {
  await load(page, emptyProject());
  for (const tab of ['Armaduras', 'Desenho', 'Elementos', 'Arquivo']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(page.locator('.ribbon-tool-compact')).toHaveCount(0);
    await expect(page.locator('.ribbon-tool > span').first()).not.toHaveText(
      '',
    );
    await expect(active(page)).toHaveCount(0);
  }
});
