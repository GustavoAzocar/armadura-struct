import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyProject } from '../src/domain/model';
import {
  makeRecoveryCopy,
  reconcilePeriodicRecovery,
  savePeriodicRecovery,
  type LocalRecoveryArchive,
  type RecoveryCopy,
} from '../src/lib/periodicRecovery';

function setup() {
  const project = emptyProject();
  const record = (revision: number) =>
    makeRecoveryCopy(
      { ...project, name: 'Revisão ' + revision },
      revision,
      'cópia-' + revision,
      revision,
    );
  let localCopies: RecoveryCopy[] = [];
  let denied = false;
  let folderOrder: number | undefined;
  let abortWrite = false;
  let race = false;
  let raw = JSON.stringify({
    format: 'armstruct-periodic-recovery/1',
    projectId: project.id,
    copies: [record(3), record(2), record(1)],
  });
  const write = vi.fn(async (next: string, expected: string | undefined) => {
    if (abortWrite) throw Error('Falha no disco');
    if (race || raw !== expected) return false;
    raw = next;
    return true;
  });
  const folder = {
    read: async () => {
      if (denied) throw Error('Pasta inacessível');
      return raw;
    },
    write,
  };
  const local: LocalRecoveryArchive = {
    read: vi.fn(async () => structuredClone(localCopies)),
    replace: vi.fn(async (_projectId, expected, next, isCurrent) => {
      if (
        !isCurrent() ||
        JSON.stringify(localCopies) !== JSON.stringify(expected)
      )
        return false;
      localCopies = next;
      return true;
    }),
    readFolderOrder: async () => folderOrder,
    rememberFolderOrder: async (_projectId, order) => {
      folderOrder = Math.max(folderOrder ?? order, order);
    },
  };
  return {
    project,
    record,
    folder,
    local,
    write,
    deny: (value: boolean) => {
      denied = value;
    },
    fail: () => {
      abortWrite = true;
    },
    contend: () => {
      race = true;
    },
    getRaw: () => raw,
    localCopies: () => localCopies,
    setLocal: (copies: RecoveryCopy[]) => {
      localCopies = copies;
    },
    folderCopies: () => (JSON.parse(raw) as { copies: RecoveryCopy[] }).copies,
  };
}
const ids = (copies: RecoveryCopy[]) => copies.map(({ id }) => id);
afterEach(() => vi.restoreAllMocks());

describe('retenção entre pasta e recuperação local', () => {
  it('continua local durante a perda de acesso e reconcilia as três gerações na volta', async () => {
    const s = setup();
    const before = s.getRaw();
    s.deny(true);
    vi.spyOn(Date, 'now').mockReturnValue(4);
    expect(
      await savePeriodicRecovery(s.record(4), s.folder, { local: s.local }),
    ).toMatchObject({
      destination: 'local',
      notice: expect.stringContaining('Pasta inacessível'),
    });
    vi.mocked(Date.now).mockReturnValue(5);
    await savePeriodicRecovery(s.record(5), s.folder, { local: s.local });
    expect(s.getRaw()).toBe(before);
    expect(ids(s.localCopies())).toEqual(['cópia-5', 'cópia-4']);
    s.deny(false);
    await reconcilePeriodicRecovery(s.project.id, s.folder, { local: s.local });
    expect(ids(s.folderCopies())).toEqual(['cópia-5', 'cópia-4', 'cópia-3']);
    expect(s.localCopies()).toEqual([]);
  });

  it('preserva o local quando a publicação na pasta falha ou outro escritor muda o inventário', async () => {
    const s = setup();
    s.setLocal([s.record(4)]);
    const before = s.getRaw();
    s.fail();
    await expect(
      reconcilePeriodicRecovery(s.project.id, s.folder, { local: s.local }),
    ).rejects.toThrow('Falha no disco');
    expect(s.getRaw()).toBe(before);
    expect(s.local.replace).not.toHaveBeenCalled();

    const concurrent = setup();
    concurrent.setLocal([concurrent.record(4)]);
    concurrent.contend();
    await expect(
      savePeriodicRecovery(concurrent.record(5), concurrent.folder, {
        local: concurrent.local,
      }),
    ).rejects.toThrow('mudou');
    expect(ids(concurrent.localCopies())).toEqual(['cópia-4']);
    expect(concurrent.local.replace).not.toHaveBeenCalled();
  });

  it('preserva a ordem das gerações se o relógio recuar durante a indisponibilidade', async () => {
    const s = setup();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    await savePeriodicRecovery(s.record(4), s.folder, { local: s.local });
    s.deny(true);
    now.mockReturnValue(200);
    await savePeriodicRecovery(s.record(5), s.folder, { local: s.local });
    now.mockReturnValue(201);
    await savePeriodicRecovery(s.record(6), s.folder, { local: s.local });
    s.deny(false);
    await reconcilePeriodicRecovery(s.project.id, s.folder, { local: s.local });
    expect(ids(s.folderCopies())).toEqual(['cópia-6', 'cópia-5', 'cópia-4']);
    expect(s.localCopies()).toEqual([]);
  });

  it('mantém localmente uma versão que a pasta não transferiu e cuja ordem não foi comprovada', async () => {
    const s = setup();
    const ambiguous = { ...s.record(4), copiedAt: 0 };
    s.setLocal([ambiguous]);
    expect(
      await reconcilePeriodicRecovery(s.project.id, s.folder, {
        local: s.local,
      }),
    ).toMatchObject({ notice: expect.stringContaining('ordem') });
    expect(s.localCopies()).toEqual([ambiguous]);
    expect(ids(s.folderCopies())).toEqual(['cópia-3', 'cópia-2', 'cópia-1']);
  });

  it('mantém versões locais inválidas e repetição após falha de limpeza é segura', async () => {
    const s = setup();
    const invalid = { ...s.record(5), raw: '{inválido' };
    s.setLocal([invalid, s.record(4)]);
    vi.mocked(s.local.replace).mockResolvedValueOnce(false);
    expect(
      await reconcilePeriodicRecovery(s.project.id, s.folder, {
        local: s.local,
      }),
    ).toMatchObject({ destination: 'folder', notice: expect.any(String) });
    expect(ids(s.localCopies())).toEqual(['cópia-5', 'cópia-4']);
    await reconcilePeriodicRecovery(s.project.id, s.folder, { local: s.local });
    expect(ids(s.folderCopies())).toEqual(['cópia-4', 'cópia-3', 'cópia-2']);
    expect(s.localCopies()).toEqual([invalid]);
  });

  it('não retira cópias locais se o inventário lido divergir após a confirmação de escrita', async () => {
    const s = setup();
    s.setLocal([s.record(4)]);
    s.write.mockResolvedValueOnce(true);
    await expect(
      reconcilePeriodicRecovery(s.project.id, s.folder, { local: s.local }),
    ).rejects.toThrow('histórico local foi preservado');
    expect(ids(s.localCopies())).toEqual(['cópia-4']);
    expect(s.local.replace).not.toHaveBeenCalled();
  });

  it('distingue falha nos dois destinos e não sinaliza uma cópia confirmada', async () => {
    const s = setup();
    s.deny(true);
    vi.mocked(s.local.replace).mockRejectedValueOnce(Error('Cota local'));
    await expect(
      savePeriodicRecovery(s.record(4), s.folder, { local: s.local }),
    ).rejects.toThrow(/Pasta inacessível.*Cota local/);
    expect(s.localCopies()).toEqual([]);
    expect(ids(s.folderCopies())).toEqual(['cópia-3', 'cópia-2', 'cópia-1']);
  });
});
