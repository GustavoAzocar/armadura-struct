import {
  DEFAULT_PERIODIC_RECOVERY_SETTINGS,
  type PeriodicRecoverySettings,
} from './periodicRecoverySettings';

export type { PeriodicRecoverySettings } from './periodicRecoverySettings';
export type PeriodicRecoveryMinutes = PeriodicRecoverySettings['minutes'];

export type PeriodicRecoveryReceipt = {
  destination: 'folder' | 'local';
  copiedAt: number;
  notice?: string;
};

type SavedStatus = { kind: 'saved' } & PeriodicRecoveryReceipt;

export type PeriodicRecoveryStatus =
  | { kind: 'waiting' }
  | { kind: 'writing' }
  | SavedStatus
  | { kind: 'failed'; message: string };

type SchedulerOptions<T> = {
  write: (
    snapshot: T,
    startedAt: number,
    isCurrent: () => boolean,
  ) => Promise<PeriodicRecoveryReceipt | null>;
  onStatus: (status: PeriodicRecoveryStatus) => void;
  now?: () => number;
};

type Session<T> = {
  context: object;
  observed: T;
  acknowledged?: T;
  changedAt?: number;
  lastSaved?: SavedStatus;
};

/** Mantém somente a revisão confirmada mais recente e uma escrita em curso. */
export function createPeriodicRecoveryScheduler<T extends object>({
  write,
  onStatus,
  now = () => Date.now(),
}: SchedulerOptions<T>) {
  let settings = DEFAULT_PERIODIC_RECOVERY_SETTINGS;
  let session: Session<T> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: { session: Session<T>; snapshot: T; epoch: number } | undefined;
  let epoch = 0;

  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function schedule() {
    if (!settings.enabled || writing || timer !== undefined) return;
    if (!session || session.changedAt === undefined) return;
    const currentTime = now();
    // Uma correção do relógio para trás não deve adiar a cópia indefinidamente.
    session.changedAt = Math.min(session.changedAt, currentTime);
    const remaining =
      session.changedAt + settings.minutes * 60_000 - currentTime;
    if (remaining <= 0) {
      void copy(session, currentTime);
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      schedule();
    }, remaining);
  }

  async function copy(current: Session<T>, startedAt: number) {
    const job = { session: current, snapshot: current.observed, epoch };
    const isCurrent = () =>
      writing === job && session === current && epoch === job.epoch;
    writing = job;
    current.changedAt = undefined;
    try {
      onStatus({ kind: 'writing' });
      if (!isCurrent()) return;
      const receipt = await write(job.snapshot, startedAt, isCurrent);
      if (!isCurrent()) return;
      current.acknowledged = job.snapshot;
      if (receipt) current.lastSaved = { kind: 'saved', ...receipt };
      onStatus(current.lastSaved ?? { kind: 'waiting' });
    } catch (error) {
      if (!isCurrent()) return;
      // Aguarde um intervalo antes de repetir uma falha, inclusive após um I/O lento.
      current.changedAt =
        current.observed === current.acknowledged ? undefined : now();
      onStatus({
        kind: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      writing = undefined;
      schedule();
    }
  }

  return {
    observe(context: object, snapshot: T, destinationChanged = false) {
      if (session?.context !== context) {
        clearTimer();
        session = {
          context,
          observed: snapshot,
          acknowledged: destinationChanged ? undefined : snapshot,
          changedAt: destinationChanged ? now() : undefined,
        };
        onStatus({ kind: 'waiting' });
        schedule();
        return;
      }
      if (session.observed === snapshot) return;
      session.observed = snapshot;
      const unchanged =
        writing && writing.session === session && writing.epoch === epoch
          ? writing.snapshot
          : session.acknowledged;
      if (snapshot === unchanged) {
        session.changedAt = undefined;
        clearTimer();
      } else {
        session.changedAt ??= now();
        schedule();
      }
    },

    configure(next: PeriodicRecoverySettings) {
      if (
        next.enabled === settings.enabled &&
        next.minutes === settings.minutes
      )
        return;
      const toggled = next.enabled !== settings.enabled;
      settings = { ...next };
      clearTimer();
      if (toggled) {
        // Uma confirmação anterior à desativação não vale após reativar.
        epoch++;
        if (session) {
          session.changedAt =
            session.observed === session.acknowledged ? undefined : now();
          onStatus(session.lastSaved ?? { kind: 'waiting' });
        }
      }
      schedule();
    },

    wake() {
      clearTimer();
      schedule();
    },

    suspend() {
      clearTimer();
      session = undefined;
    },
  };
}
