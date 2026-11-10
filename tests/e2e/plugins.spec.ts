import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(
  readFileSync('examples/plugins/straight-bar/manifest.json', 'utf8'),
);

// UI/IPC contract fixture. Native disk/ZIP/network behavior is tested by Rust.
function nativeFixture(m: unknown) {
  const records: unknown[] = [];
  const calls: { command: string; args: any }[] = [];
  const compatibility = {
    compatible: true,
    platformAvailable: true,
    reasons: [],
    ignoredOptional: ['future.progress'],
    execution: 'unsupported',
  };
  const inspection = {
    token: 'inspection-fixture',
    manifest: {
      ...(m as object),
      description: '<img src=x onerror=alert(1)> Descrição em texto seguro',
    },
    sha256: '0'.repeat(64),
    size: 1024,
    origin: 'Arquivo local: fixture.osplugin',
    compatibility,
    trust: 'integrity-only',
  };
  let rejectPending: ((e: Error) => void) | undefined;
  const mock = {
    calls,
    records,
    pause: false,
    fail: false,
    cancelPick: false,
    inspection,
  };
  (window as any).pluginMock = mock;
  Object.assign(window, {
    isTauri: true,
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
    __TAURI_INTERNALS__: {
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { label: 'main' },
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any = {}) => {
        calls.push({ command, args });
        if (command === 'plugin:event|listen') return 1;
        if (command === 'updates_snapshot' || command === 'updates_check')
          return {
            revision: 1,
            currentVersion: '0.6.0',
            mode: 'development',
            status: 'unsupported',
            message: 'Fixture',
            offer: null,
            phase: 'idle',
            received: 0,
            total: 0,
            receipt: null,
          };
        if (command === 'plugins_pick')
          return mock.cancelPick ? null : structuredClone(inspection);
        if (command === 'plugins_list') return structuredClone(records);
        if (command === 'plugins_install') {
          const item = {
            ...inspection,
            enabled: false,
            installedAt: 1794312000,
            status: 'runtime-unsupported',
          };
          records.push(item);
          return { outcome: 'installed', item: structuredClone(item) };
        }
        if (command === 'plugins_remove') {
          records.splice(0);
          return;
        }
        if (command === 'plugins_catalog') {
          if (mock.pause)
            await new Promise<void>((_resolve, reject) => {
              rejectPending = reject;
            });
          if (mock.fail) throw new Error('Rede indisponível na fonte de teste');
          return {
            name: 'Fixture (não oficial)',
            publisher: { id: 'org.example', name: 'Test' },
            source: args.source,
            entries: [
              {
                manifest: inspection.manifest,
                compatibility,
                artifacts: [
                  {
                    offerId: 'offer-fixture',
                    reason: null,
                    artifact: {
                      url: 'https://plugins.example.org/fixture.osplugin',
                      size: 1024,
                      sha256: '0'.repeat(64),
                      platform: 'any',
                      architecture: 'any',
                      runtime: 'declarative',
                    },
                  },
                ],
              },
            ],
          };
        }
        if (command === 'plugins_download')
          return structuredClone({
            ...inspection,
            origin: 'Catálogo: https://plugins.example.org/catalog.json',
          });
        if (command === 'plugins_cancel') {
          rejectPending?.(new Error('Operação cancelada'));
          return;
        }
        return null;
      },
    },
  });
}
const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Plugins', exact: true });
async function setup(page: Page, native = false) {
  if (native) await page.addInitScript(nativeFixture, manifest);
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: 'Desenho', exact: true }).click();
}
async function open(page: Page, name = 'Instalar offline') {
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}
async function count(page: Page, command: string) {
  return page.evaluate(
    (cmd) =>
      (window as any).pluginMock.calls.filter((c: any) => c.command === cmd)
        .length,
    command,
  );
}

test('web mantém CAD utilizável e explica persistência desktop, com guia acessível', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setup(page);
  await open(page);
  await expect(dialog(page)).toContainText('No navegador');
  await expect(
    dialog(page).getByRole('button', { name: 'Selecionar pacote .osplugin' }),
  ).toBeDisabled();
  await dialog(page)
    .getByRole('tab', { name: 'Loja online', exact: true })
    .click();
  await expect(dialog(page)).toContainText('Nenhuma loja configurada');
  await dialog(page)
    .getByRole('tab', { name: 'Desenvolver plugins', exact: true })
    .click();
  await expect(dialog(page)).toContainText('contrato público v1');
  const download = page.waitForEvent('download');
  await dialog(page)
    .getByRole('button', { name: 'Salvar JSON Schema do manifesto' })
    .click();
  expect((await download).suggestedFilename()).toBe('manifest.schema.json');
  await page.setViewportSize({ width: 520, height: 800 });
  await expect(dialog(page)).toBeVisible();
  const bounds = await dialog(page).boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(520);
  await page.screenshot({ path: 'docs/plugins-web.png' });
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: 'Comando CAD' }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});
test('inspeção offline, confirmação, reabertura e remoção preservam o histórico CAD', async ({
  page,
}) => {
  await setup(page, true);
  const undo = page
    .locator('.quick-tools')
    .getByRole('button', { name: /Desfazer/ });
  const wasDisabled = await undo.isDisabled();
  await open(page);
  await dialog(page)
    .getByRole('button', { name: 'Selecionar pacote .osplugin' })
    .click();
  await expect(
    dialog(page).getByRole('region', { name: 'Confirmar instalação' }),
  ).toBeVisible();
  expect(await count(page, 'plugins_install')).toBe(0);
  await expect(dialog(page)).toContainText('<img src=x onerror=alert(1)>');
  await expect(dialog(page).locator('img')).toHaveCount(0);
  await page.screenshot({ path: 'docs/plugins-desktop-inspection.png' });
  await dialog(page)
    .getByRole('button', { name: 'Confirmar instalação desativada' })
    .click();
  await expect(dialog(page)).toContainText(
    'Instalado · execução ainda não suportada',
  );
  expect(await count(page, 'plugins_install')).toBe(1);
  await page.keyboard.press('Escape');
  await open(page, 'Meus plugins');
  await expect(dialog(page)).toContainText('org.example.straight-bar');
  await dialog(page)
    .getByRole('button', { name: 'Remover plugin', exact: true })
    .click();
  await dialog(page).getByRole('button', { name: 'Confirmar remoção' }).click();
  await expect(dialog(page)).toContainText('Nenhum plugin instalado');
  await page.keyboard.press('Escape');
  expect(await undo.isDisabled()).toBe(wasDisabled);
});
test('consulta online é passiva; download exige inspeção e confirmação separadas', async ({
  page,
}) => {
  await setup(page, true);
  await open(page, 'Loja online');
  await dialog(page)
    .getByLabel('URL do catálogo HTTPS')
    .fill('https://plugins.example.org/catalog.json');
  await dialog(page)
    .getByRole('button', { name: 'Consultar catálogo' })
    .click();
  await expect(dialog(page)).toContainText('Fixture (não oficial)');
  expect(await count(page, 'plugins_download')).toBe(0);
  expect(await count(page, 'plugins_install')).toBe(0);
  await dialog(page)
    .getByRole('button', { name: 'Baixar e inspecionar' })
    .click();
  await expect(
    dialog(page).getByRole('region', { name: 'Confirmar instalação' }),
  ).toBeVisible();
  expect(await count(page, 'plugins_install')).toBe(0);
  await dialog(page).getByRole('button', { name: 'Descartar pacote' }).click();
  expect(await count(page, 'plugins_discard')).toBe(1);
  await expect(
    dialog(page).getByRole('region', { name: 'Confirmar instalação' }),
  ).toHaveCount(0);
});
test('cancelamento e erro de rede não instalam e preservam navegação por teclado', async ({
  page,
}) => {
  await setup(page, true);
  await page.evaluate(() => {
    (window as any).pluginMock.pause = true;
  });
  await open(page, 'Loja online');
  await dialog(page)
    .getByLabel('URL do catálogo HTTPS')
    .fill('https://plugins.example.org/catalog.json');
  await dialog(page)
    .getByRole('button', { name: 'Consultar catálogo' })
    .click();
  await expect(dialog(page)).toContainText('Consultando catálogo');
  await dialog(page).getByRole('button', { name: 'Cancelar operação' }).click();
  await expect(dialog(page)).toContainText('Operação cancelada.');
  expect(await count(page, 'plugins_install')).toBe(0);
  await page.evaluate(() => {
    (window as any).pluginMock.pause = false;
    (window as any).pluginMock.fail = true;
  });
  await dialog(page)
    .getByRole('button', { name: 'Consultar catálogo' })
    .click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'Rede indisponível',
  );
  await dialog(page)
    .getByRole('tab', { name: 'Loja online', exact: true })
    .focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    dialog(page).getByRole('tab', { name: 'Instalar offline', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Loja online', exact: true }),
  ).toBeFocused();
});
