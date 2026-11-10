import { test, expect, type Page } from '@playwright/test';
import { emptyProject } from '../../src/domain/model';
import { maskManipFixture } from '../fixtures/maskManipulation';

// IPC contract fixture only. These tests never download/execute a native installer.
function nativeMock(options: {
  status?: string;
  mode?: string;
  pause?: boolean;
  save?: string;
  error?: string;
  pauseArm?: boolean;
  armError?: string;
}) {
  const state = {
    revision: 1,
    currentVersion: '0.9.0',
    mode: options.mode ?? 'appimage',
    status: options.status ?? 'available',
    message: 'Fixture de atualização desktop',
    checkedAt: null,
    offer: {
      version: '0.10.0',
      notes: '<img src=x onerror=alert(1)> Notas em texto seguro',
      size: 100,
      kind: 'appimage',
    },
    phase: 'idle',
    received: 0,
    total: 0,
    receipt: null,
  };
  if (state.status !== 'available')
    state.offer = null as unknown as typeof state.offer;
  const calls: { command: string; version?: string }[] = [];
  let release: (() => void) | undefined;
  let callbackId = 0;
  const callbacks = new Map<number, (event: unknown) => unknown>();
  const listeners = new Map<number, { event: string; callback: number }>();
  let releaseSave: (() => void) | undefined,
    releaseArm: (() => void) | undefined;
  const mock = {
    state,
    calls,
    pause: !!options.pause,
    save: options.save ?? 'success',
    resume: () => release?.(),
    resumeSave: () => releaseSave?.(),
    resumeArm: () => releaseArm?.(),
    emit: async (event: string) => {
      for (const [id, l] of listeners) {
        if (l.event === event)
          await callbacks.get(l.callback)?.({ event, id, payload: null });
      }
    },
  };
  Object.assign(window, {
    isTauri: true,
    updatesMock: mock,
    __TAURI_EVENT_PLUGIN_INTERNALS__: {
      unregisterListener: (_event: string, id: number) => {
        listeners.delete(id);
      },
    },
    __TAURI_INTERNALS__: {
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { label: 'main' },
      },
      transformCallback: (callback: (event: unknown) => unknown) => {
        const id = ++callbackId;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback: () => {},
      invoke: async (
        command: string,
        args?: { version?: string; event?: string; handler?: number },
      ) => {
        calls.push({ command, version: args?.version });
        if (command === 'updates_snapshot') return structuredClone(state);
        if (command === 'updates_check') {
          state.revision++;
          if (options.error) throw options.error;
          return structuredClone(state);
        }
        if (command === 'updates_prepare') {
          state.revision++;
          state.phase = 'downloading';
          state.received = 25;
          state.total = 100;
          if (mock.pause)
            await new Promise<void>((r) => {
              release = r;
            });
          await new Promise((r) => setTimeout(r, 50));
          if (state.phase === 'cancelled') throw 'Download cancelado';
          state.revision++;
          state.phase = 'ready';
          state.received = 100;
          return structuredClone(state);
        }
        if (command === 'updates_cancel') {
          state.revision++;
          state.phase = 'cancelled';
          release?.();
          return structuredClone(state);
        }
        if (command === 'updates_arm') {
          if (options.pauseArm)
            await new Promise<void>((r) => {
              releaseArm = r;
            });
          if (options.armError) throw options.armError;
          state.revision++;
          state.phase = 'armed';
          return structuredClone(state);
        }
        if (command === 'updates_finish') return null;
        if (command === 'plugin:dialog|save') {
          if (mock.save === 'pause')
            await new Promise<void>((r) => {
              releaseSave = r;
            });
          return mock.save === 'cancel'
            ? null
            : '/fixture/project.armstruct.json';
        }
        if (command === 'plugin:fs|write_text_file' && mock.save === 'fail')
          throw 'Sem permissão';
        if (command === 'plugin:event|listen') {
          const id = ++callbackId;
          listeners.set(id, { event: args!.event!, callback: args!.handler! });
          return id;
        }
        return null;
      },
    },
  });
}
async function setup(
  page: Page,
  options: Parameters<typeof nativeMock>[0] = {},
) {
  await page.addInitScript(nativeMock, options);
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: 'Desenho', exact: true }).click();
}
const modal = (page: Page) =>
  page.getByRole('dialog', { name: 'Atualizações do ArmaduraStruct' });
async function manual(page: Page) {
  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  await page
    .getByRole('button', { name: 'Verificar atualizações', exact: true })
    .click();
  await expect(modal(page)).toBeVisible();
}
async function calls(page: Page, name: string) {
  return page.evaluate(
    (n) =>
      (
        window as unknown as { updatesMock: { calls: { command: string }[] } }
      ).updatesMock.calls.filter((c) => c.command === n).length,
    name,
  );
}
test('consulta automática é passiva e adiar/consultar não baixa ou instala', async ({
  page,
}) => {
  await setup(page);
  const cad = page.getByRole('textbox', { name: 'Comando CAD' });
  await cad.focus();
  await expect(page.locator('.update-banner')).toContainText('0.10.0');
  await expect(cad).toBeFocused();
  await page.screenshot({ path: 'docs/updates-passive.png' });
  await page
    .locator('.update-banner')
    .getByRole('button', { name: 'Agora não' })
    .click();
  await expect(page.locator('.update-banner')).toHaveCount(0);
  await manual(page);
  await expect(modal(page)).toContainText('0.9.0');
  await expect(modal(page)).toContainText('0.10.0');
  await expect(modal(page).locator('img')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(modal(page)).not.toBeVisible();
  expect(await calls(page, 'updates_check')).toBe(1);
  expect(await calls(page, 'updates_prepare')).toBe(0);
  expect(await calls(page, 'updates_finish')).toBe(0);
});
test('instalar exige download, verificação e confirmação explícita da mesma versão', async ({
  page,
}) => {
  await setup(page);
  await manual(page);
  await modal(page)
    .getByRole('button', { name: 'Baixar versão 0.10.0' })
    .click();
  await expect(
    modal(page).getByRole('button', {
      name: 'Instalar e reiniciar',
      exact: true,
    }),
  ).toBeVisible();
  expect(await calls(page, 'updates_prepare')).toBe(1);
  expect(await calls(page, 'updates_arm')).toBe(0);
  await page.screenshot({ path: 'docs/updates-ready.png' });
  await modal(page)
    .getByRole('checkbox', {
      name: 'Autorizo instalar a versão 0.10.0 e reiniciar o aplicativo',
    })
    .check();
  await modal(page)
    .getByRole('button', { name: 'Instalar e reiniciar', exact: true })
    .dblclick();
  await expect.poll(() => calls(page, 'updates_finish')).toBe(1);
  const versions = await page.evaluate(() =>
    (
      window as unknown as {
        updatesMock: { calls: { command: string; version?: string }[] };
      }
    ).updatesMock.calls
      .filter((c) =>
        ['updates_prepare', 'updates_arm', 'updates_finish'].includes(
          c.command,
        ),
      )
      .map((c) => c.version),
  );
  expect(versions).toEqual(['0.10.0', '0.10.0', '0.10.0']);
});
test('cancelar download mantém o CAD e não inicia instalação', async ({
  page,
}) => {
  await setup(page, { pause: true });
  await manual(page);
  await modal(page)
    .getByRole('button', { name: 'Baixar versão 0.10.0' })
    .click();
  await expect(modal(page).getByRole('progressbar')).toHaveAttribute(
    'value',
    '25',
  );
  await page.screenshot({ path: 'docs/updates-download.png' });
  await modal(page).getByRole('button', { name: 'Cancelar download' }).click();
  await expect(
    modal(page).getByRole('button', { name: 'Agora não', exact: true }),
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  expect(await calls(page, 'updates_arm')).toBe(0);
  await expect(
    page.getByRole('textbox', { name: 'Comando CAD' }),
  ).toBeVisible();
});
for (const save of ['cancel', 'fail'])
  test(`salvamento ${save} impede fechamento e instalação`, async ({
    page,
  }) => {
    await setup(page, { save });
    await page.getByTestId('project-input').setInputFiles({
      name: 'changed.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({ ...emptyProject(), name: 'Projeto preservado' }),
      ),
    });
    const input = page.getByRole('textbox', { name: 'Comando CAD' });
    await input.fill('B');
    await input.press('Enter');
    await input.fill('0,0');
    await input.press('Enter');
    await input.fill('1000,0');
    await input.press('Enter');
    await input.fill('');
    await input.press('Enter');
    await page.keyboard.press('Escape');
    await manual(page);
    await modal(page)
      .getByRole('button', { name: 'Baixar versão 0.10.0' })
      .click();
    await modal(page)
      .getByRole('checkbox', {
        name: 'Autorizo instalar a versão 0.10.0 e reiniciar o aplicativo',
      })
      .check();
    await modal(page)
      .getByRole('button', { name: 'Salvar, instalar e reiniciar' })
      .click();
    await expect(modal(page).getByRole('alert')).toBeVisible();
    expect(await calls(page, 'updates_arm')).toBe(0);
    expect(await calls(page, 'updates_finish')).toBe(0);
    await expect(page.getByRole('banner')).toContainText('Projeto preservado');
  });
for (const status of ['current', 'offline', 'error', 'unsupported'])
  test(`estado ${status} não oferece instalador`, async ({ page }) => {
    await setup(page, { status });
    await manual(page);
    await expect(
      modal(page).getByRole('button', { name: /Baixar versão/ }),
    ).toHaveCount(0);
    expect(await calls(page, 'updates_prepare')).toBe(0);
  });
test('instalação de sistema informa o método sem substituí-lo por AppImage', async ({
  page,
}) => {
  await setup(page, { mode: 'system' });
  await manual(page);
  await expect(
    modal(page).getByRole('button', { name: /Baixar versão/ }),
  ).toHaveCount(0);
});
test('modo web é explícito, acessível por teclado e cabe em janela baixa', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1060, height: 710 });
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await manual(page);
  await expect(modal(page)).toContainText('Versão web');
  await expect(
    modal(page).getByRole('button', { name: /Baixar versão/ }),
  ).toHaveCount(0);
  await page.screenshot({ path: 'docs/updates-web.png' });
  await page.keyboard.press('Escape');
  await expect(modal(page)).not.toBeVisible();
});

async function prepareInstall(page: Page) {
  await manual(page);
  await modal(page)
    .getByRole('button', { name: 'Baixar versão 0.10.0' })
    .click();
  await modal(page)
    .getByRole('checkbox', {
      name: 'Autorizo instalar a versão 0.10.0 e reiniciar o aplicativo',
    })
    .check();
}
test('fechar a janela durante o salvamento pré-instalação é impedido', async ({
  page,
}) => {
  await setup(page, { save: 'pause' });
  const cad = page.getByRole('textbox', { name: 'Comando CAD' });
  for (const c of ['B', '0,0', '1000,0', '']) {
    await cad.fill(c);
    await cad.press('Enter');
  }
  await page.keyboard.press('Escape');
  await prepareInstall(page);
  await modal(page)
    .getByRole('button', { name: 'Salvar, instalar e reiniciar' })
    .click();
  await expect.poll(() => calls(page, 'plugin:dialog|save')).toBe(1);
  await page.evaluate(() =>
    (
      window as unknown as {
        updatesMock: { emit: (event: string) => Promise<void> };
      }
    ).updatesMock.emit('tauri://close-requested'),
  );
  expect(await calls(page, 'plugin:window|destroy')).toBe(0);
  await page.evaluate(() => {
    const mock = (
      window as unknown as {
        updatesMock: { save: string; resumeSave: () => void };
      }
    ).updatesMock;
    mock.save = 'cancel';
    mock.resumeSave();
  });
  await expect(modal(page).getByRole('alert')).toContainText('não foi salvo');
  expect(await calls(page, 'updates_finish')).toBe(0);
});
test('troca de projeto durante a preparação invalida a confirmação', async ({
  page,
}) => {
  await setup(page, { pauseArm: true });
  await prepareInstall(page);
  await modal(page)
    .getByRole('button', { name: 'Instalar e reiniciar', exact: true })
    .click();
  await expect.poll(() => calls(page, 'updates_arm')).toBe(1);
  await page.getByTestId('project-input').setInputFiles({
    name: 'other.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        ...emptyProject(),
        id: 'other-project',
        name: 'Outro preservado',
      }),
    ),
  });
  await expect(page.getByRole('banner')).toContainText('Outro preservado');
  await page.evaluate(() =>
    (
      window as unknown as { updatesMock: { resumeArm: () => void } }
    ).updatesMock.resumeArm(),
  );
  await expect(modal(page).getByRole('alert')).toContainText('mudou');
  expect(await calls(page, 'updates_finish')).toBe(0);
  expect(await calls(page, 'updates_cancel')).toBe(1);
});
test('mudança da versão disponível descarta a preparação e não instala', async ({
  page,
}) => {
  await page.clock.install();
  await setup(page, {
    armError:
      'A versão ou pacote disponível mudou. Verifique novamente antes de instalar',
  });
  await prepareInstall(page);
  await modal(page)
    .getByRole('button', { name: 'Instalar e reiniciar', exact: true })
    .click();
  await expect(modal(page).getByRole('alert')).toContainText('mudou');
  // The delayed startup check must not clear an error from the manual flow.
  await page.clock.fastForward(2000);
  await expect(modal(page).getByRole('alert')).toContainText('mudou');
  await expect.poll(() => calls(page, 'updates_cancel')).toBe(1);
  expect(await calls(page, 'updates_finish')).toBe(0);
});
test('comando CAD pendente impede o fechamento para instalar', async ({
  page,
}) => {
  await setup(page);
  const cad = page.getByRole('textbox', { name: 'Comando CAD' });
  await cad.fill('B');
  await cad.press('Enter');
  await prepareInstall(page);
  await modal(page)
    .getByRole('button', { name: 'Instalar e reiniciar', exact: true })
    .click();
  await expect(modal(page).getByRole('alert')).toContainText(
    'Conclua ou cancele',
  );
  expect(await calls(page, 'updates_arm')).toBe(0);
  expect(await calls(page, 'updates_finish')).toBe(0);
});

test('texto livre pendente impede reiniciar para instalar uma atualização', async ({
  page,
}) => {
  await setup(page);
  await page.getByTestId('project-input').setInputFiles({
    name: 'mascara.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(maskManipFixture())),
  });
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  const destination = page.getByRole('region', {
    name: 'Destino do desenho de máscaras',
    exact: true,
  });
  await destination
    .getByLabel('Escolher máscara', { exact: true })
    .selectOption('target-mask');
  await destination
    .getByRole('button', { name: 'Ativar máscara para desenhar', exact: true })
    .click();
  await page.getByRole('button', { name: 'Texto', exact: true }).click();
  const command = page.getByRole('textbox', { name: 'Comando CAD' });
  await command.fill('100,100');
  await command.press('Enter');
  const panel = page.getByRole('region', { name: 'Inserir texto' });
  await panel
    .getByLabel('Conteúdo do texto')
    .fill('Texto ainda não confirmado');
  await page
    .locator('.update-banner')
    .getByRole('button', { name: 'Ver atualização', exact: true })
    .click();
  await modal(page)
    .getByRole('button', { name: 'Baixar versão 0.10.0', exact: true })
    .click();
  await modal(page)
    .getByRole('checkbox', {
      name: 'Autorizo instalar a versão 0.10.0 e reiniciar o aplicativo',
    })
    .check();
  await modal(page)
    .getByRole('button', { name: 'Instalar e reiniciar', exact: true })
    .click();
  await expect(modal(page).getByRole('alert')).toContainText(
    'Conclua ou cancele',
  );
  expect(await calls(page, 'updates_arm')).toBe(0);
  expect(await calls(page, 'updates_finish')).toBe(0);
  await modal(page)
    .getByRole('button', { name: 'Agora não', exact: true })
    .click();
  await expect(panel.getByLabel('Conteúdo do texto')).toHaveValue(
    'Texto ainda não confirmado',
  );
});
