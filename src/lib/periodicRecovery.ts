import { decodeProject } from '../domain/model';
import type { Project } from '../domain/types';
import type { ProjectFolder } from './projectFolder';
import type { PeriodicRecoveryStatus } from './periodicRecoveryScheduler';

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
  raw: string;
};

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
  if (typeof Worker === 'undefined')
    return planRecoveryCopy(existing, candidate);
  const worker = new Worker(
    new URL('./periodicRecovery.worker.ts', import.meta.url),
    { type: 'module' },
  );
  try {
    const flags = await new Promise<boolean[]>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<boolean[]>) =>
        resolve(event.data);
      worker.onerror = () =>
        reject(Error('Falha ao validar as cópias de recuperação.'));
      worker.onmessageerror = () =>
        reject(Error('Resposta de validação ilegível.'));
      worker.postMessage([candidate, ...existing]);
    });
    if (!flags[0])
      throw Error('A nova cópia não passou pelo leitor do projeto.');
    return rotateCopies(existing, candidate, flags.slice(1));
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
  const copies = await planOffThread(
    readFolderCopies(expected, copy.projectId),
    copy,
  );
  if (!copies || !isCurrent()) return null;
  const confirmed = { ...copy, copiedAt: Date.now() };
  copies[0] = confirmed;
  const contents = JSON.stringify({
    format: RECOVERY_ARCHIVE_FORMAT,
    projectId: copy.projectId,
    copies,
  });
  // Se outra instância publicar antes, recomece com um novo snapshot no próximo ciclo.
  if (await destination.write(contents, expected)) return confirmed;
  if (!isCurrent()) return null;
  throw Error('O histórico na pasta mudou durante a cópia.');
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
          copies.push(...archive(cursor.value, String(cursor.key)));
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

/** Validação no worker e comparação/rotação na mesma transação de escrita. */
export async function saveLocalRecoveryCopy(
  copy: RecoveryCopy,
  isCurrent = () => true,
) {
  const db = await openArchive();
  try {
    if (!isCurrent()) return null;
    const expected = await loadLocalArchive(db, copy.projectId);
    const next = await planOffThread(expected, copy);
    if (!next || !isCurrent()) return null;
    const confirmed = { ...copy, copiedAt: Date.now() };
    next[0] = confirmed;
    if (
      await replaceLocalArchive(db, copy.projectId, expected, next, isCurrent)
    )
      return confirmed;
    if (!isCurrent()) return null;
    throw Error('O histórico local mudou durante a cópia.');
  } finally {
    db.close();
  }
}
