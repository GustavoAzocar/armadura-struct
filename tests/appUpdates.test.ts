import { describe, expect, it, vi } from 'vitest';
import {
  canInstallUpdate,
  createProductUpdateChecker,
  updateProgress,
  webUpdateState,
  type UpdateBridge,
  type UpdateSnapshot,
} from '../src/lib/appUpdates';
const state = (patch: Partial<UpdateSnapshot> = {}): UpdateSnapshot => ({
  ...webUpdateState(),
  mode: 'appimage',
  status: 'available',
  offer: {
    version: '0.10.0',
    notes: '<script>not HTML</script>',
    size: 100,
    kind: 'appimage',
  },
  ...patch,
});
function bridge(check = vi.fn(async () => state())): UpdateBridge {
  return {
    native: true,
    snapshot: vi.fn(async () => state({ currentVersion: '0.9.0' })),
    check,
    prepare: vi.fn(),
    cancel: vi.fn(),
    arm: vi.fn(),
    finish: vi.fn(),
  };
}
describe('coordenação de atualizações do produto', () => {
  it('consulta automática e manual compartilham a mesma operação e não instalam', async () => {
    let release!: (s: UpdateSnapshot) => void;
    const b = bridge(
      vi.fn(
        () =>
          new Promise<UpdateSnapshot>((r) => {
            release = r;
          }),
      ),
    );
    const checker = createProductUpdateChecker(b, () => true);
    const a = checker.check(),
      other = checker.check(true);
    expect(a).toBe(other);
    await Promise.resolve();
    release(state());
    await a;
    expect(b.check).toHaveBeenCalledTimes(1);
    expect(b.prepare).not.toHaveBeenCalled();
    expect(b.arm).not.toHaveBeenCalled();
    expect(b.finish).not.toHaveBeenCalled();
  });
  it('montagens repetidas não fazem outra consulta automática', async () => {
    const b = bridge();
    const checker = createProductUpdateChecker(b, () => true);
    await checker.check();
    await checker.check();
    expect(b.check).toHaveBeenCalledTimes(1);
  });
  it('offline mantém a versão nativa real e não declara atualizado', async () => {
    const b = bridge();
    const checker = createProductUpdateChecker(b, () => false);
    const r = await checker.check(true);
    expect(r.status).toBe('offline');
    expect(r.currentVersion).toBe('0.9.0');
    expect(r.offer).toBeNull();
    expect(b.check).not.toHaveBeenCalled();
  });
  it('falha permite tentativa manual posterior com limitação de chamadas', async () => {
    let now = 0;
    const check = vi
      .fn()
      .mockRejectedValueOnce(Error('timeout'))
      .mockResolvedValue(state());
    const b = bridge(check);
    const checker = createProductUpdateChecker(
      b,
      () => true,
      () => now,
    );
    await expect(checker.check()).rejects.toThrow('timeout');
    now = 3000;
    await checker.check(true);
    await checker.check(true);
    expect(check).toHaveBeenCalledTimes(2);
  });
  it('web, desenvolvimento e método de sistema não recebem instalador', () => {
    for (const mode of ['web', 'development', 'system'] as const)
      expect(canInstallUpdate(state({ mode }))).toBe(false);
    expect(canInstallUpdate(state({ offer: null }))).toBe(false);
    expect(canInstallUpdate(state())).toBe(true);
  });
  it('progresso é medido pelos bytes recebidos', () => {
    expect(updateProgress(state({ received: 25, total: 100 }))).toBe(25);
    expect(updateProgress(state({ received: 200, total: 100 }))).toBe(100);
    expect(updateProgress(state())).toBe(0);
  });
});
