import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPeriodicRecoveryScheduler,
  type PeriodicRecoveryReceipt,
  type PeriodicRecoveryStatus,
} from '../src/lib/periodicRecoveryScheduler';

const minute = 60_000;
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const snapshot = (revision: number) => ({ revision });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function setup() {
  const statuses: PeriodicRecoveryStatus[] = [];
  const write = vi.fn(
    async (
      _snapshot: ReturnType<typeof snapshot>,
      startedAt: number,
      _isCurrent: () => boolean,
    ): Promise<PeriodicRecoveryReceipt | null> => ({
      destination: 'folder',
      copiedAt: startedAt + 1,
    }),
  );
  const scheduler = createPeriodicRecoveryScheduler({
    write,
    onStatus: (status) => statuses.push(status),
  });
  const context = {};
  scheduler.observe(context, snapshot(0));
  return { scheduler, write, context, statuses };
}

describe('agendamento das cópias periódicas', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it('não copia a linha de base nem repete um projeto parado', async () => {
    const { scheduler, write, context, statuses } = setup();
    await advance(10 * minute);
    expect(write).not.toHaveBeenCalled();

    const changed = snapshot(1);
    scheduler.observe(context, changed);
    await advance(5 * minute - 1);
    expect(write).not.toHaveBeenCalled();
    await advance(1);
    expect(write).toHaveBeenCalledWith(
      changed,
      15 * minute,
      expect.any(Function),
    );
    expect(statuses).toEqual([
      { kind: 'waiting' },
      { kind: 'writing' },
      { kind: 'saved', destination: 'folder', copiedAt: 15 * minute + 1 },
    ]);
    scheduler.observe(context, changed);
    await advance(20 * minute);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('edição contínua não adia a primeira cópia e usa a última revisão observada', async () => {
    const { scheduler, write, context } = setup();
    for (let revision = 1; revision <= 5; revision++) {
      scheduler.observe(context, snapshot(revision));
      await advance(minute);
    }
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0].slice(0, 2)).toEqual([snapshot(5), 5 * minute]);
  });

  it('voltar à linha de base antes do prazo desarma a cópia', async () => {
    const { scheduler, write } = setup();
    const context = {};
    const baseline = snapshot(0);
    scheduler.observe(context, baseline);
    scheduler.observe(context, snapshot(1));
    await advance(minute);
    scheduler.observe(context, baseline);
    await advance(10 * minute);
    expect(write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reprograma o prazo uma vez ao mudar o intervalo', async () => {
    const { scheduler, write, context } = setup();
    scheduler.observe(context, snapshot(1));
    await advance(minute);
    scheduler.configure({ enabled: true, minutes: 2 });
    scheduler.configure({ enabled: true, minutes: 2 });
    expect(vi.getTimerCount()).toBe(1);
    await advance(minute - 1);
    expect(write).not.toHaveBeenCalled();
    await advance(1);
    expect(write.mock.calls[0][1]).toBe(2 * minute);
    await advance(10 * minute);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('ao acordar depois do prazo, copia uma vez e substitui o timer pendente', async () => {
    const { scheduler, write, context } = setup();
    scheduler.observe(context, snapshot(1));
    vi.setSystemTime(30 * minute);
    scheduler.wake();
    scheduler.wake();
    await advance(0);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][1]).toBe(30 * minute);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reprograma a próxima cópia quando o relógio volta', async () => {
    const { scheduler, write, context } = setup();
    vi.setSystemTime(60 * minute);
    scheduler.configure({ enabled: true, minutes: 1 });
    scheduler.observe(context, snapshot(1));
    vi.setSystemTime(20 * minute);
    scheduler.wake();
    expect(write).not.toHaveBeenCalled();
    await advance(minute);
    expect(write.mock.calls[0][1]).toBe(21 * minute);
  });

  it('mantém uma escrita em curso e captura uma só revisão pendente', async () => {
    const { scheduler, write, context } = setup();
    const slow = deferred<PeriodicRecoveryReceipt>();
    write.mockImplementationOnce(() => slow.promise);
    scheduler.configure({ enabled: true, minutes: 1 });
    scheduler.observe(context, snapshot(1));
    await advance(minute);
    scheduler.observe(context, snapshot(2));
    scheduler.observe(context, snapshot(3));
    await advance(10 * minute);
    expect(write).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    const copiedAt = Date.now();
    slow.resolve({ destination: 'folder', copiedAt });
    await advance(0);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1].slice(0, 2)).toEqual([snapshot(3), copiedAt]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('trocar A por B e voltar a A invalida a escrita da primeira sessão', async () => {
    const { scheduler, write, context: a, statuses } = setup();
    const slow = deferred<PeriodicRecoveryReceipt>();
    write.mockImplementationOnce(() => slow.promise);
    scheduler.configure({ enabled: true, minutes: 1 });
    scheduler.observe(a, snapshot(1));
    await advance(minute);
    const isOriginal = write.mock.calls[0][2];
    expect(isOriginal()).toBe(true);
    const b = {};
    scheduler.observe(b, snapshot(10));
    scheduler.observe(b, snapshot(11));
    scheduler.observe(a, snapshot(1));
    expect(isOriginal()).toBe(false);
    scheduler.observe(a, snapshot(2));
    await advance(minute);
    slow.resolve({ destination: 'folder', copiedAt: minute });
    await advance(0);
    expect(write.mock.calls.map(([value]) => value.revision)).toEqual([1, 2]);
    expect(statuses.filter((status) => status.kind === 'saved')).toEqual([
      { kind: 'saved', destination: 'folder', copiedAt: 2 * minute + 1 },
    ]);
  });

  it('trocar o destino do mesmo projeto agenda o estado atual e invalida o recibo antigo', async () => {
    const { scheduler, write, context, statuses } = setup();
    const slow = deferred<PeriodicRecoveryReceipt>();
    write.mockImplementationOnce(() => slow.promise);
    scheduler.configure({ enabled: true, minutes: 1 });
    const current = snapshot(1);
    scheduler.observe(context, current);
    await advance(minute);
    const isOld = write.mock.calls[0][2];
    scheduler.observe({}, current, true);
    expect(isOld()).toBe(false);
    slow.resolve({ destination: 'folder', copiedAt: minute });
    await advance(minute);
    expect(write).toHaveBeenCalledTimes(2);
    expect(statuses.filter((status) => status.kind === 'saved')).toHaveLength(
      1,
    );
  });

  it('desativar cancela a validade da operação e reativar agenda as alterações pendentes', async () => {
    const { scheduler, write, context, statuses } = setup();
    const slow = deferred<PeriodicRecoveryReceipt>();
    write.mockImplementationOnce(() => slow.promise);
    scheduler.configure({ enabled: true, minutes: 1 });
    scheduler.observe(context, snapshot(1));
    await advance(minute);
    const isOriginal = write.mock.calls[0][2];
    scheduler.configure({ enabled: false, minutes: 1 });
    scheduler.observe(context, snapshot(2));
    expect(isOriginal()).toBe(false);
    await advance(10 * minute);
    scheduler.configure({ enabled: true, minutes: 1 });
    expect(isOriginal()).toBe(false);
    slow.resolve({ destination: 'folder', copiedAt: minute });
    await advance(minute - 1);
    expect(write).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(write.mock.calls[1][0]).toEqual(snapshot(2));
    expect(statuses.filter((status) => status.kind === 'saved')).toHaveLength(
      1,
    );
  });

  it('suspensão invalida o contexto sem inutilizar o agendador', async () => {
    const { scheduler, write, context, statuses } = setup();
    const slow = deferred<PeriodicRecoveryReceipt>();
    write.mockImplementationOnce(() => slow.promise);
    scheduler.configure({ enabled: true, minutes: 1 });
    scheduler.observe(context, snapshot(1));
    await advance(minute);
    const isOriginal = write.mock.calls[0][2];
    scheduler.suspend();
    expect(isOriginal()).toBe(false);
    const lastStatus = statuses.at(-1);
    slow.resolve({ destination: 'folder', copiedAt: minute });
    await advance(minute);
    expect(statuses.at(-1)).toBe(lastStatus);
    expect(write).toHaveBeenCalledTimes(1);

    scheduler.observe(context, snapshot(1));
    await advance(minute);
    expect(write).toHaveBeenCalledTimes(1);
    scheduler.observe(context, snapshot(2));
    await advance(minute);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('falha preserva a revisão para nova tentativa e nunca indica gravação concluída', async () => {
    const { scheduler, write, context, statuses } = setup();
    write.mockRejectedValueOnce(new Error('Sem espaço disponível.'));
    scheduler.configure({ enabled: true, minutes: 1 });
    scheduler.observe(context, snapshot(1));
    await advance(minute);
    expect(statuses.at(-1)).toEqual({
      kind: 'failed',
      message: 'Sem espaço disponível.',
    });
    await advance(minute - 1);
    expect(write).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(write.mock.calls[1][0]).toEqual(snapshot(1));
    expect(statuses.at(-1)).toEqual({
      kind: 'saved',
      destination: 'folder',
      copiedAt: 2 * minute + 1,
    });
  });

  it('duplicata encerra a tentativa sem inventar outro sucesso', async () => {
    const { scheduler, write, context, statuses } = setup();
    write
      .mockResolvedValueOnce({
        destination: 'local',
        copiedAt: 42,
        notice: 'Pasta indisponível.',
      })
      .mockResolvedValueOnce(null);
    scheduler.configure({ enabled: true, minutes: 1 });
    scheduler.observe(context, snapshot(1));
    await advance(minute);
    const knownCopy = statuses.at(-1);
    expect(knownCopy).toEqual({
      kind: 'saved',
      destination: 'local',
      copiedAt: 42,
      notice: 'Pasta indisponível.',
    });
    scheduler.observe(context, snapshot(2));
    await advance(minute);
    expect(statuses.at(-1)).toBe(knownCopy);
    await advance(5 * minute);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
