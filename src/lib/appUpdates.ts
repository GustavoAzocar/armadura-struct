import { isTauri } from '@tauri-apps/api/core';
import { version } from '../../package.json';

export type UpdateSnapshot = {
  revision: number;
  currentVersion: string;
  mode: 'managed' | 'appimage' | 'nsis' | 'system' | 'development' | 'web';
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'current'
    | 'error'
    | 'offline'
    | 'unsupported';
  message: string;
  checkedAt: string | null;
  offer: { version: string; notes: string; size: number; kind: string } | null;
  phase:
    | 'idle'
    | 'downloading'
    | 'verifying'
    | 'ready'
    | 'armed'
    | 'handoff'
    | 'cancelled'
    | 'failed';
  received: number;
  total: number;
  receipt: string | null;
};
export const webUpdateState = (): UpdateSnapshot => ({
  revision: 0,
  currentVersion: version,
  mode: 'web',
  status: 'unsupported',
  message:
    'Versão web: não há instalação desktop local para atualizar. Uma nova versão do site é carregada ao reabrir; salve seu projeto antes.',
  checkedAt: null,
  offer: null,
  phase: 'idle',
  received: 0,
  total: 0,
  receipt: null,
});
export type UpdateBridge = {
  native: boolean;
  snapshot: () => Promise<UpdateSnapshot>;
  check: () => Promise<UpdateSnapshot>;
  prepare: (version: string) => Promise<UpdateSnapshot>;
  cancel: () => Promise<UpdateSnapshot>;
  arm: (version: string) => Promise<UpdateSnapshot>;
  finish: (version: string) => Promise<void>;
};
async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}
export const updateBridge: UpdateBridge = {
  native: isTauri(),
  snapshot: () =>
    isTauri() ? call('updates_snapshot') : Promise.resolve(webUpdateState()),
  check: () =>
    isTauri() ? call('updates_check') : Promise.resolve(webUpdateState()),
  prepare: (version) => call('updates_prepare', { version }),
  cancel: () => call('updates_cancel'),
  arm: (version) => call('updates_arm', { version }),
  finish: (version) => call('updates_finish', { version }),
};
/** One coordinator shared by StrictMode mounts and manual/startup actions; no periodic catalog polling. */
export function createProductUpdateChecker(
  bridge: UpdateBridge,
  online = () => navigator.onLine,
  now = Date.now,
) {
  let pending: Promise<UpdateSnapshot> | undefined;
  let last: UpdateSnapshot | undefined;
  let attemptedAt = -Infinity;
  let startupAttempted = false;
  return {
    check(manual = false): Promise<UpdateSnapshot> {
      if (pending) return pending;
      if (!manual && startupAttempted)
        return Promise.resolve(last ?? webUpdateState());
      if (!manual) startupAttempted = true;
      if (last && now() - attemptedAt < 2000) return Promise.resolve(last);
      attemptedAt = now();
      pending = (async () => {
        const base = last ?? (await bridge.snapshot());
        last = base;
        if (!bridge.native) return base;
        if (!online())
          return {
            ...base,
            status: 'offline' as const,
            offer: null,
            message: 'Sem conexão. Conecte-se e verifique novamente.',
          };
        return bridge.check();
      })()
        .then((result) => {
          last = result;
          return result;
        })
        .catch((error: unknown) => {
          last = {
            ...(last ?? {
              ...webUpdateState(),
              currentVersion: 'desconhecida',
              mode: 'system' as const,
            }),
            status: 'error',
            offer: null,
            message: String(error),
          };
          throw error;
        })
        .finally(() => {
          pending = undefined;
        });
      return pending;
    },
  };
}
export const productUpdateChecker = createProductUpdateChecker(updateBridge);
export function canInstallUpdate(s: UpdateSnapshot) {
  return (
    ['managed', 'appimage', 'nsis'].includes(s.mode) &&
    s.status === 'available' &&
    !!s.offer
  );
}
export function updateProgress(s: UpdateSnapshot) {
  return s.total > 0
    ? Math.min(100, Math.floor((s.received / s.total) * 100))
    : 0;
}
