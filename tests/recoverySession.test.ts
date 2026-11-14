import { describe, expect, it } from 'vitest';
import {
  CLOSED_KEY,
  RECOVERY_KEY,
  RecoverySessionClosedError,
  createRecoverySession,
  parseClosedMarker,
  type RecoveryBackend,
  type RecoveryWrite,
} from '../src/lib/recoverySession';

/** Armazenamento em memória com transações atômicas e falhas/atrasos controlados. */
function memoryBackend() {
  const data = new Map<string, string>();
  const log: RecoveryWrite[] = [];
  let failNext = 0;
  let gate: Promise<void> | undefined;
  const backend: RecoveryBackend = {
    async read(keys) {
      return Object.fromEntries(keys.map((k) => [k, data.get(k)]));
    },
    async write(change) {
      if (gate) await gate;
      if (failNext > 0) {
        failNext--;
        throw new Error('QuotaExceededError');
      }
      log.push(change);
      for (const [k, v] of Object.entries(change.put ?? {})) data.set(k, v);
      for (const k of change.remove ?? []) data.delete(k);
    },
  };
  return {
    backend,
    data,
    log,
    failNextWrite: () => {
      failNext++;
    },
    /** Segura as gravações até `release()`, simulando IndexedDB lento. */
    hold() {
      let release!: () => void;
      gate = new Promise((r) => (release = r));
      return () => {
        gate = undefined;
        release();
      };
    },
  };
}

describe('sessão da recuperação local', () => {
  it('sem fechamento explícito, a inicialização recupera o último projeto', async () => {
    const m = memoryBackend();
    const s = createRecoverySession(m.backend);
    expect(await s.start()).toEqual({ closed: false, raw: undefined });
    await s.save('{"id":"a"}', s.epoch());
    expect(await s.start()).toEqual({ closed: false, raw: '{"id":"a"}' });
  });

  it('fechar registra "nenhum projeto ativo" sem apagar a cópia de recuperação', async () => {
    const m = memoryBackend();
    const s = createRecoverySession(m.backend);
    await s.save('{"id":"a"}', s.epoch());
    await s.close('a', 1000);
    expect(await s.start()).toEqual({ closed: true, projectId: 'a' });
    // A cópia continua no armazenamento; só deixa de ser reaberta sozinha.
    expect(m.data.get(RECOVERY_KEY)).toBe('{"id":"a"}');
    expect(JSON.parse(m.data.get(CLOSED_KEY)!)).toEqual({
      v: 1,
      projectId: 'a',
      closedAt: 1000,
    });
  });

  it('uma nova sessão que salva recuperação remove a marca na mesma transação', async () => {
    const m = memoryBackend();
    const s = createRecoverySession(m.backend);
    await s.save('{"id":"a"}', s.epoch());
    await s.close('a');
    await s.save('{"id":"b"}', s.epoch());
    expect(await s.start()).toEqual({ closed: false, raw: '{"id":"b"}' });
    expect(m.log.at(-1)).toEqual({
      put: { [RECOVERY_KEY]: '{"id":"b"}' },
      remove: [CLOSED_KEY],
    });
  });

  it('gravação da sessão fechada pedida depois do fechamento é recusada e não reativa o projeto', async () => {
    const m = memoryBackend();
    const s = createRecoverySession(m.backend);
    const old = s.epoch();
    await s.save('{"id":"a","v":1}', old);
    await s.close('a');
    await expect(s.save('{"id":"a","v":2}', old)).rejects.toBeInstanceOf(
      RecoverySessionClosedError,
    );
    expect(await s.start()).toEqual({ closed: true, projectId: 'a' });
    expect(m.data.get(RECOVERY_KEY)).toBe('{"id":"a","v":1}');
  });

  it('gravações já enfileiradas terminam antes da marca; atrasadas da sessão antiga são descartadas', async () => {
    const m = memoryBackend();
    const s = createRecoverySession(m.backend);
    const old = s.epoch();
    const release = m.hold();
    const before = s.save('{"id":"a","v":1}', old);
    const closing = s.close('a');
    // Timer atrasado da sessão anterior: entra na fila depois do fechamento.
    const late = s.save('{"id":"a","v":2}', old);
    release();
    await before;
    await closing;
    await expect(late).rejects.toBeInstanceOf(RecoverySessionClosedError);
    expect(m.log.map((w) => Object.keys(w.put ?? {}))).toEqual([
      [RECOVERY_KEY],
      [CLOSED_KEY],
    ]);
    expect(await s.start()).toEqual({ closed: true, projectId: 'a' });
  });

  it('falha ao gravar a marca mantém a sessão ativa e propaga o erro', async () => {
    const m = memoryBackend();
    const s = createRecoverySession(m.backend);
    const session = s.epoch();
    await s.save('{"id":"a"}', session);
    m.failNextWrite();
    await expect(s.close('a')).rejects.toThrow('QuotaExceededError');
    expect(s.epoch()).toBe(session);
    expect(await s.start()).toEqual({ closed: false, raw: '{"id":"a"}' });
    // O projeto continua aberto e sua recuperação continua funcionando.
    await s.save('{"id":"a","v":2}', session);
    expect(m.data.get(RECOVERY_KEY)).toBe('{"id":"a","v":2}');
  });

  it('uma falha anterior na fila não impede o fechamento', async () => {
    const m = memoryBackend();
    const s = createRecoverySession(m.backend);
    m.failNextWrite();
    await expect(s.save('{"id":"a"}', s.epoch())).rejects.toThrow();
    await s.close('a');
    expect((await s.start()).closed).toBe(true);
  });

  it('gravação sem sessão informada mantém o comportamento anterior', async () => {
    const m = memoryBackend();
    const s = createRecoverySession(m.backend);
    await s.close('a');
    await s.save('{"id":"b"}');
    expect(await s.start()).toEqual({ closed: false, raw: '{"id":"b"}' });
  });

  it('marca ilegível ainda é tratada como fechamento explícito', () => {
    expect(parseClosedMarker(undefined)).toBeUndefined();
    expect(parseClosedMarker('{corrompido')).toBe('');
    expect(parseClosedMarker('{"v":1,"projectId":"x"}')).toBe('x');
  });
});
