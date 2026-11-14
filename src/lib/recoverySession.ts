/**
 * Sessão da recuperação local (IndexedDB, chaves `current` e `closed`).
 *
 * `current` guarda a última cópia de recuperação do projeto ativo. `closed`
 * registra que o usuário fechou o projeto explicitamente: enquanto existir, a
 * inicialização mostra a tela inicial em vez de reabrir `current`. A cópia de
 * `current` não é apagada ao fechar; a próxima recuperação de outro projeto a
 * substitui e remove `closed` na mesma transação.
 *
 * Todas as gravações passam por uma única fila, na ordem em que foram pedidas.
 * Fechar invalida as gravações da sessão anterior que ainda estejam na fila, de
 * modo que um timer ou retorno atrasado não reative o projeto fechado.
 */
export const RECOVERY_KEY = 'current';
export const CLOSED_KEY = 'closed';

export type RecoveryWrite = {
  put?: Record<string, string>;
  remove?: string[];
};
/** Leitura e gravação atômica (uma transação) das chaves da recuperação. */
export type RecoveryBackend = {
  read(keys: string[]): Promise<Record<string, string | undefined>>;
  write(change: RecoveryWrite): Promise<void>;
};
export type RecoveryStart =
  | { closed: true; projectId?: string }
  | { closed: false; raw?: string };
export type ClosedMarker = { v: 1; projectId: string; closedAt: number };

export class RecoverySessionClosedError extends Error {
  constructor() {
    super('O projeto foi fechado; a recuperação desta sessão foi encerrada.');
    this.name = 'RecoverySessionClosedError';
  }
}

export function parseClosedMarker(raw: string | undefined) {
  if (raw === undefined) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<ClosedMarker> | null;
    return typeof value?.projectId === 'string' ? value.projectId : '';
  } catch {
    // Marca ilegível ainda indica fechamento explícito: nunca reabrir sozinho.
    return '';
  }
}

export function createRecoverySession(backend: RecoveryBackend) {
  let queue: Promise<unknown> = Promise.resolve();
  let epoch = 0;
  const enqueue = <T>(task: () => Promise<T>) => {
    const next = queue.catch(() => {}).then(task);
    queue = next;
    return next;
  };
  return {
    /** Identifica a sessão atual; gravações de sessões anteriores são recusadas. */
    epoch: () => epoch,
    /**
     * Grava a recuperação do projeto ativo e, na mesma transação, remove a
     * marca de projeto fechado. `session` (opcional) é o `epoch()` lido quando o
     * projeto foi aberto; se o projeto foi fechado depois, nada é gravado.
     */
    save(serialized: string, session?: number) {
      const stale = () => session !== undefined && session !== epoch;
      if (stale()) return Promise.reject(new RecoverySessionClosedError());
      return enqueue(async () => {
        if (stale()) throw new RecoverySessionClosedError();
        await backend.write({
          put: { [RECOVERY_KEY]: serialized },
          remove: [CLOSED_KEY],
        });
      });
    },
    /**
     * Registra "nenhum projeto ativo" depois das gravações já enfileiradas.
     * Só encerra a sessão (invalidando gravações atrasadas) se a marca for
     * gravada; em falha, a sessão continua ativa e o erro é propagado.
     */
    close(projectId: string, now = Date.now()) {
      return enqueue(async () => {
        const marker: ClosedMarker = { v: 1, projectId, closedAt: now };
        await backend.write({ put: { [CLOSED_KEY]: JSON.stringify(marker) } });
        epoch++;
      });
    },
    /** Estado de inicialização: projeto fechado explicitamente ou recuperação. */
    async start(): Promise<RecoveryStart> {
      const values = await backend.read([RECOVERY_KEY, CLOSED_KEY]);
      const closed = parseClosedMarker(values[CLOSED_KEY]);
      if (closed !== undefined)
        return closed ? { closed: true, projectId: closed } : { closed: true };
      return { closed: false, raw: values[RECOVERY_KEY] };
    },
  };
}
