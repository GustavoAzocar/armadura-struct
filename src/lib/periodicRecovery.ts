import { decodeProject } from '../domain/model';
import type { Project } from '../domain/types';
import type { ProjectFolder } from './projectFolder';
import type {
  PeriodicRecoveryReceipt,
  PeriodicRecoveryStatus,
} from './periodicRecoveryScheduler';

export const RECOVERY_COPY_LIMIT = 3;

export function periodicRecoveryStatusLabel(
  status: PeriodicRecoveryStatus,
  enabled: boolean,
) {
  if (!enabled) return 'Cópias periódicas desativadas';
  switch (status.kind) {
    case 'waiting':
      return 'Cópia periódica · aguardando alterações';
    case 'writing':
      return 'Gravando cópia periódica…';
    case 'failed':
      return 'Falha na cópia periódica';
    case 'saved':
      return `Cópia de recuperação · ${new Date(status.copiedAt).toLocaleTimeString('pt-BR')} · ${status.destination === 'folder' ? 'pasta do projeto' : 'somente local'}`;
  }
}
export type RecoveryCopy = {
  id: string;
  projectId: string;
  name: string;
  startedAt: number;
  copiedAt: number;
  orderAt?: number;
  afterFolderOrder?: number;
  raw: string;
};

const orderOf = (copy: RecoveryCopy) => copy.orderAt ?? copy.copiedAt;

function markCopy(
  copy: RecoveryCopy,
  previous: RecoveryCopy[],
  folderOrder?: number,
) {
  const copiedAt = Date.now();
  const lastOrder = previous.reduce(
    (latest, item) => Math.max(latest, orderOf(item)),
    folderOrder ?? 0,
  );
  return {
    ...copy,
    copiedAt,
    orderAt: Math.max(
      copiedAt,
      Math.min(Number.MAX_SAFE_INTEGER, lastOrder + 1),
    ),
    afterFolderOrder: folderOrder,
  };
}

export function makeRecoveryCopy(
  project: Project,
  startedAt: number,
  id: string = crypto.randomUUID(),
  copiedAt = Date.now(),
): RecoveryCopy {
  return {
    id,
    projectId: project.id,
    name: project.name,
    startedAt,
    copiedAt,
    raw: JSON.stringify(project),
  };
}

export function recoverPeriodicProject(copy: RecoveryCopy): Project {
  const project = decodeProject(copy.raw);
  if (project.id !== copy.projectId)
    throw Error('A cópia contém dados de outro projeto.');
  return project;
}

export function isValidCopy(copy: RecoveryCopy) {
  try {
    recoverPeriodicProject(copy);
    return true;
  } catch {
    return false;
  }
}

export function planRecoveryCopy(
  existing: readonly RecoveryCopy[],
  candidate: RecoveryCopy,
): RecoveryCopy[] | undefined {
  if (existing.some((copy) => copy.projectId !== candidate.projectId))
    throw Error('O arquivo de recuperação pertence a outro projeto.');
  recoverPeriodicProject(candidate);
  return rotateCopies(existing, candidate, existing.map(isValidCopy));
}

function rotateCopies(
  existing: readonly RecoveryCopy[],
  candidate: RecoveryCopy,
  validity: boolean[],
) {
  // A ordem do inventário acompanha as transações. O relógio civil pode recuar.
  const ordered = existing.map((copy, index) => ({
    copy,
    valid: validity[index],
  }));
  const latest = ordered.find((entry) => entry.valid)?.copy;
  if (latest?.raw === candidate.raw) return;
  let valid = 1;
  return [
    candidate,
    ...ordered
      .filter((entry) => !entry.valid || ++valid <= RECOVERY_COPY_LIMIT)
      .map((entry) => entry.copy),
  ];
}

async function planOffThread(
  existing: RecoveryCopy[],
  candidate: RecoveryCopy,
) {
  const [valid, ...flags] = await validateCopies([candidate, ...existing]);
  if (!valid) throw Error('A nova cópia não passou pelo leitor do projeto.');
  return rotateCopies(existing, candidate, flags);
}

async function validateCopies(copies: RecoveryCopy[]) {
  if (typeof Worker === 'undefined') return copies.map(isValidCopy);
  const worker = new Worker(
    new URL('./periodicRecovery.worker.ts', import.meta.url),
    { type: 'module' },
  );
  try {
    return await new Promise<boolean[]>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<boolean[]>) =>
        resolve(event.data);
      worker.onerror = () =>
        reject(Error('Falha ao validar as cópias de recuperação.'));
      worker.onmessageerror = () =>
        reject(Error('Resposta de validação ilegível.'));
      worker.postMessage(copies);
    });
  } finally {
    worker.terminate();
  }
}

function archive(snapshot: unknown, projectId: string): RecoveryCopy[] {
  if (snapshot === undefined) return [];
  if (!Array.isArray(snapshot))
    throw Error('Histórico de recuperação ilegível.');
  const ids = new Set<string>();
  for (const copy of snapshot as RecoveryCopy[]) {
    if (
      typeof copy !== 'object' ||
      !copy ||
      typeof copy.id !== 'string' ||
      ids.has(copy.id) ||
      copy.projectId !== projectId ||
      typeof copy.name !== 'string' ||
      !Number.isSafeInteger(copy.startedAt) ||
      !Number.isSafeInteger(copy.copiedAt) ||
      (copy.orderAt !== undefined && !Number.isSafeInteger(copy.orderAt)) ||
      (copy.afterFolderOrder !== undefined &&
        !Number.isSafeInteger(copy.afterFolderOrder)) ||
      typeof copy.raw !== 'string'
    )
      throw Error('Histórico de recuperação incompatível.');
    ids.add(copy.id);
  }
  return snapshot as RecoveryCopy[];
}

const DB_NAME = 'armadurastruct-periodic-recovery';
const STORE = 'projects';
const RECOVERY_ARCHIVE_FORMAT = 'armstruct-periodic-recovery/1';
type FolderRecoveryArchive = NonNullable<ProjectFolder['recovery']>;

class RecoveryArchiveConflict extends Error {}

function folderContents(projectId: string, copies: RecoveryCopy[]) {
  return JSON.stringify({ format: RECOVERY_ARCHIVE_FORMAT, projectId, copies });
}

function readFolderCopies(raw: string | undefined, projectId?: string) {
  if (raw === undefined) return [];
  const file = JSON.parse(raw);
  if (
    file?.format !== RECOVERY_ARCHIVE_FORMAT ||
    typeof file.projectId !== 'string' ||
    (projectId !== undefined && file.projectId !== projectId)
  )
    throw Error(
      'O histórico da pasta é incompatível ou pertence a outro projeto.',
    );
  if (!Array.isArray(file.copies)) throw Error('Histórico da pasta ilegível.');
  return archive(file.copies, file.projectId);
}

export async function listFolderRecoveryCopies(
  destination: ProjectFolder['recovery'],
  projectId?: string,
) {
  return readFolderCopies(await destination?.read(), projectId);
}

export async function saveFolderRecoveryCopy(
  destination: NonNullable<ProjectFolder['recovery']>,
  copy: RecoveryCopy,
  isCurrent = () => true,
) {
  if (!isCurrent()) return null;
  const expected = await destination.read();
  const existing = readFolderCopies(expected, copy.projectId);
  const copies = await planOffThread(existing, copy);
  if (!copies || !isCurrent()) return null;
  const confirmed = markCopy(copy, existing);
  copies[0] = confirmed;
  const contents = folderContents(copy.projectId, copies);
  // Se outra instância publicar antes, recomece com um novo snapshot no próximo ciclo.
  if (await destination.write(contents, expected)) return confirmed;
  if (!isCurrent()) return null;
  throw new RecoveryArchiveConflict(
    'O histórico na pasta mudou durante a cópia.',
  );
}

function openArchive() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listLocalRecoveryCopies(): Promise<{
  copies: RecoveryCopy[];
  unreadableProjects: number;
}> {
  const db = await openArchive();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE);
      const request = tx.objectStore(STORE).openCursor();
      const copies: RecoveryCopy[] = [];
      let unreadableProjects = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        try {
          // A ordem observada na pasta é metadado separado da lista de projetos.
          if (typeof cursor.key === 'string')
            copies.push(...archive(cursor.value, cursor.key));
        } catch {
          unreadableProjects++;
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve({ copies, unreadableProjects });
      tx.onabort = () =>
        reject(tx.error ?? Error('Falha ao consultar as cópias locais.'));
    });
  } finally {
    db.close();
  }
}

function loadLocalArchive(db: IDBDatabase, projectId: string) {
  return new Promise<RecoveryCopy[]>((resolve, reject) => {
    const tx = db.transaction(STORE);
    const request = tx.objectStore(STORE).get(projectId);
    request.onsuccess = () => {
      try {
        resolve(archive(request.result, projectId));
      } catch (error) {
        reject(error);
      }
    };
    tx.onabort = () =>
      reject(tx.error ?? Error('Falha ao ler o histórico local.'));
  });
}

function replaceLocalArchive(
  db: IDBDatabase,
  projectId: string,
  expected: RecoveryCopy[],
  next: RecoveryCopy[],
  isCurrent: () => boolean,
) {
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite', { durability: 'strict' });
    const store = tx.objectStore(STORE);
    const request = store.get(projectId);
    let replaced = false;
    request.onsuccess = () => {
      if (!isCurrent()) return;
      try {
        const active = archive(request.result, projectId);
        if (
          active.length !== expected.length ||
          active.some((copy, index) => {
            const observed = expected[index];
            return (
              copy.id !== observed.id ||
              copy.raw !== observed.raw ||
              copy.startedAt !== observed.startedAt ||
              copy.copiedAt !== observed.copiedAt ||
              copy.orderAt !== observed.orderAt ||
              copy.afterFolderOrder !== observed.afterFolderOrder ||
              copy.name !== observed.name
            );
          })
        )
          return;
        store.put(next, projectId);
        replaced = true;
      } catch (error) {
        reject(error);
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(replaced);
    tx.onabort = () =>
      reject(tx.error ?? Error('Falha ao gravar a cópia local.'));
  });
}

async function withLocalArchive<T>(run: (db: IDBDatabase) => Promise<T>) {
  const db = await openArchive();
  try {
    return await run(db);
  } finally {
    db.close();
  }
}

export type LocalRecoveryArchive = {
  read(projectId: string): Promise<RecoveryCopy[]>;
  replace(
    projectId: string,
    expected: RecoveryCopy[],
    next: RecoveryCopy[],
    isCurrent: () => boolean,
  ): Promise<boolean>;
  readFolderOrder(projectId: string): Promise<number | undefined>;
  rememberFolderOrder(projectId: string, order: number): Promise<void>;
};

function folderOrderMetadata(
  db: IDBDatabase,
  projectId: string,
  incoming?: number,
) {
  return new Promise<number | undefined>((resolve, reject) => {
    const tx = db.transaction(
      STORE,
      incoming === undefined ? 'readonly' : 'readwrite',
    );
    const store = tx.objectStore(STORE);
    const key = ['folder-order', projectId];
    const request = store.get(key);
    let order: number | undefined;
    request.onsuccess = () => {
      if (Number.isSafeInteger(request.result)) order = request.result;
      if (incoming !== undefined && (order === undefined || incoming > order)) {
        store.put(incoming, key);
        order = incoming;
      }
    };
    tx.oncomplete = () => resolve(order);
    tx.onabort = () =>
      reject(tx.error ?? Error('Falha ao registrar a ordem das cópias.'));
  });
}

const indexedDbArchive: LocalRecoveryArchive = {
  read: (projectId) =>
    withLocalArchive((db) => loadLocalArchive(db, projectId)),
  replace: (projectId, expected, next, isCurrent) =>
    withLocalArchive((db) =>
      replaceLocalArchive(db, projectId, expected, next, isCurrent),
    ),
  readFolderOrder: (projectId) =>
    withLocalArchive((db) => folderOrderMetadata(db, projectId)),
  rememberFolderOrder: async (projectId, order) => {
    await withLocalArchive((db) => folderOrderMetadata(db, projectId, order));
  },
};

type RecoveryOptions = {
  isCurrent?: () => boolean;
  local?: LocalRecoveryArchive;
};

/** Validação no worker e comparação/rotação na mesma transação de escrita. */
async function saveLocalRecoveryCopy(
  copy: RecoveryCopy,
  local: LocalRecoveryArchive,
  isCurrent: () => boolean,
) {
  if (!isCurrent()) return null;
  const expected = await local.read(copy.projectId);
  const next = await planOffThread(expected, copy);
  if (!next || !isCurrent()) return null;
  const folderOrder = await local
    .readFolderOrder(copy.projectId)
    .catch(() => undefined);
  if (!isCurrent()) return null;
  const confirmed = markCopy(copy, expected, folderOrder);
  next[0] = confirmed;
  if (await local.replace(copy.projectId, expected, next, isCurrent))
    return confirmed;
  if (!isCurrent()) return null;
  throw new RecoveryArchiveConflict('O histórico local mudou durante a cópia.');
}

function mergeOrderedCopies(folder: RecoveryCopy[], local: RecoveryCopy[]) {
  const unique = new Map<string, RecoveryCopy>();
  let f = 0;
  let l = 0;
  // Dentro de cada destino a ordem das transações sobrevive a recuos do relógio.
  while (f < folder.length || l < local.length) {
    const fromFolder = folder[f];
    const fromLocal = local[l];
    const copy =
      fromLocal && (!fromFolder || orderOf(fromLocal) >= orderOf(fromFolder))
        ? local[l++]
        : folder[f++];
    const previous = unique.get(copy.id);
    if (previous && previous.raw !== copy.raw)
      throw Error(
        'Dois conteúdos diferentes usam a mesma identificação de cópia.',
      );
    if (!previous) unique.set(copy.id, copy);
  }
  return [...unique.values()];
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function withRecoveryLock<T>(
  projectId: string,
  work: () => Promise<T>,
): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request)
    return await navigator.locks.request(
      'armstruct-periodic-recovery:' + projectId,
      work,
    );
  return work();
}

async function publishToFolder(
  projectId: string,
  destination: FolderRecoveryArchive,
  local: LocalRecoveryArchive,
  isCurrent: () => boolean,
  candidate?: RecoveryCopy,
): Promise<PeriodicRecoveryReceipt | null> {
  if (!isCurrent()) return null;
  let localBefore: RecoveryCopy[];
  try {
    localBefore = await local.read(projectId);
  } catch (error) {
    if (!candidate) throw error;
    const saved = await saveFolderRecoveryCopy(
      destination,
      candidate,
      isCurrent,
    );
    return (
      saved && {
        destination: 'folder',
        copiedAt: Date.now(),
        notice:
          'Não foi possível consultar o histórico local para conciliar as cópias.',
      }
    );
  }
  if (!localBefore.length) {
    const saved =
      candidate &&
      (await saveFolderRecoveryCopy(destination, candidate, isCurrent));
    if (!saved) return null;
    const copiedAt = Date.now();
    await local.rememberFolderOrder(projectId, orderOf(saved)).catch(() => {});
    return { destination: 'folder', copiedAt };
  }
  const expected = await destination.read();
  const folderBefore = readFolderCopies(expected, projectId);
  const flags = await validateCopies([
    ...folderBefore,
    ...localBefore,
    ...(candidate ? [candidate] : []),
  ]);
  if (candidate && !flags.at(-1))
    throw Error('A nova cópia não passou pelo leitor do projeto.');
  const validFolder = folderBefore.filter((_, i) => flags[i]);
  const validLocal = localBefore.filter(
    (_, i) => flags[folderBefore.length + i],
  );
  if (!validLocal.length && !candidate) return null;

  const invalidFolder = folderBefore.filter((_, i) => !flags[i]);
  const valid = mergeOrderedCopies(validFolder, validLocal);
  if (candidate && valid[0]?.raw !== candidate.raw)
    valid.unshift(markCopy(candidate, valid));
  const copies = [...valid.slice(0, RECOVERY_COPY_LIMIT), ...invalidFolder];
  if (new Set(copies.map((copy) => copy.id)).size !== copies.length)
    throw Error(
      'Há cópias legíveis e inválidas com a mesma identificação; os históricos foram preservados.',
    );
  if (!isCurrent()) return null;
  const contents = folderContents(projectId, copies);
  if (!(await destination.write(contents, expected)))
    throw new RecoveryArchiveConflict(
      'O histórico na pasta mudou durante a conciliação.',
    );
  if (validLocal.length && (await destination.read()) !== contents)
    throw new RecoveryArchiveConflict(
      'Não foi possível confirmar as cópias na pasta. O histórico local foi preservado.',
    );

  const copiedAt = Date.now();
  await local
    .rememberFolderOrder(projectId, orderOf(copies[0]))
    .catch(() => {});
  const copiedIds = new Set(copies.map((copy) => copy.id));
  const keepLocal = localBefore.filter(
    (copy, i) =>
      !flags[folderBefore.length + i] ||
      (copy.afterFolderOrder === undefined &&
        !copiedIds.has(copy.id) &&
        // Sem ordem observada, um horário anterior pode vir de um recuo do relógio.
        validFolder.some((item) => orderOf(item) >= orderOf(copy))),
  );
  if (keepLocal.length !== localBefore.length && isCurrent()) {
    try {
      if (!(await local.replace(projectId, localBefore, keepLocal, isCurrent)))
        throw Error('O histórico local mudou.');
    } catch {
      return {
        destination: 'folder',
        copiedAt,
        notice:
          'Cópias confirmadas na pasta. O histórico local foi preservado e será conciliado novamente.',
      };
    }
  }
  return {
    destination: 'folder',
    copiedAt,
    notice: keepLocal.some((copy) => validLocal.includes(copy))
      ? 'O histórico local inclui versões cuja ordem não foi comprovada. Essas versões foram preservadas.'
      : undefined,
  };
}

export function reconcilePeriodicRecovery(
  projectId: string,
  folder: FolderRecoveryArchive,
  { local = indexedDbArchive, isCurrent = () => true }: RecoveryOptions = {},
) {
  return withRecoveryLock(projectId, () =>
    publishToFolder(projectId, folder, local, isCurrent),
  );
}

export function savePeriodicRecovery(
  copy: RecoveryCopy,
  folder: ProjectFolder['recovery'],
  { local = indexedDbArchive, isCurrent = () => true }: RecoveryOptions = {},
): Promise<PeriodicRecoveryReceipt | null> {
  return withRecoveryLock(copy.projectId, async () => {
    let folderFailure: string | undefined;
    if (folder && isCurrent()) {
      try {
        return await publishToFolder(
          copy.projectId,
          folder,
          local,
          isCurrent,
          copy,
        );
      } catch (error) {
        if (error instanceof RecoveryArchiveConflict) throw error;
        folderFailure = message(error);
      }
    }
    try {
      const saved = await saveLocalRecoveryCopy(copy, local, isCurrent);
      return (
        saved && {
          destination: 'local',
          copiedAt: Date.now(),
          notice: folderFailure
            ? `Pasta indisponível. Cópia confirmada somente no armazenamento local. ${folderFailure}`
            : undefined,
        }
      );
    } catch (error) {
      if (!folderFailure) throw error;
      throw Error(
        `${folderFailure} Falha no armazenamento local: ${message(error)}`,
      );
    }
  });
}
