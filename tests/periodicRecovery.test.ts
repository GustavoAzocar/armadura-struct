import { describe, expect, it } from 'vitest';
import { emptyProject } from '../src/domain/model';
import {
  listFolderRecoveryCopies,
  makeRecoveryCopy,
  planRecoveryCopy,
  recoverPeriodicProject,
  saveFolderRecoveryCopy,
} from '../src/lib/periodicRecovery';
import {
  DEFAULT_PERIODIC_RECOVERY_SETTINGS,
  loadPeriodicRecoverySettings,
  RECOVERY_SETTINGS_KEY,
  savePeriodicRecoverySettings,
} from '../src/lib/periodicRecoverySettings';

describe('preferências de cópias periódicas', () => {
  it('usa o padrão de cinco minutos e diferencia configuração ilegível', () => {
    expect(loadPeriodicRecoverySettings({ getItem: () => null })).toEqual({
      settings: DEFAULT_PERIODIC_RECOVERY_SETTINGS,
    });
    expect(
      loadPeriodicRecoverySettings({
        getItem: () => '{"enabled":true,"minutes":3}',
      }),
    ).toMatchObject({
      settings: DEFAULT_PERIODIC_RECOVERY_SETTINGS,
      warning: expect.any(String),
    });
  });

  it('persiste só as opções conhecidas e propaga falha de armazenamento', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
    savePeriodicRecoverySettings({ enabled: false, minutes: 10 }, storage);
    expect(loadPeriodicRecoverySettings(storage).settings).toEqual({
      enabled: false,
      minutes: 10,
    });
    expect(() =>
      savePeriodicRecoverySettings(
        { enabled: true, minutes: 1 },
        {
          setItem() {
            throw Error('quota');
          },
        },
      ),
    ).toThrow('quota');
    expect(data.get(RECOVERY_SETTINGS_KEY)).toBe(
      '{"enabled":false,"minutes":10}',
    );
  });
});

describe('conteúdo e retenção das cópias periódicas', () => {
  const project = emptyProject();
  const copy = (n: number) =>
    makeRecoveryCopy(
      { ...project, name: 'Projeto ' + n },
      n,
      'copia-' + n,
      n + 10,
    );

  it('planeja preservar as últimas três cópias válidas e mantém as inválidas para diagnóstico', () => {
    const old = [copy(4), { ...copy(3), raw: '{incompleto' }, copy(2), copy(1)];
    const next = planRecoveryCopy(old, copy(5));
    expect(next?.map((item) => item.id)).toEqual([
      'copia-5',
      'copia-4',
      'copia-3',
      'copia-2',
    ]);
    expect(old).toHaveLength(4);
    expect(() => recoverPeriodicProject(old[1])).toThrow();
  });

  it('a ordem da rotação independe do relógio civil e conteúdo repetido não vira cópia', () => {
    const current = copy(4);
    expect(planRecoveryCopy([current], copy(2))?.map(({ id }) => id)).toEqual([
      'copia-2',
      'copia-4',
    ]);
    expect(
      planRecoveryCopy([current], { ...current, id: 'nova', startedAt: 5 }),
    ).toBeUndefined();
  });

  it('decodifica o arquivo nativo e rejeita conteúdo de outro projeto', () => {
    const saved = copy(1);
    expect(recoverPeriodicProject(saved)).toMatchObject({
      id: project.id,
      name: 'Projeto 1',
    });
    expect(() =>
      recoverPeriodicProject({ ...saved, projectId: 'outro' }),
    ).toThrow('outro projeto');
    expect(() =>
      planRecoveryCopy([{ ...copy(1), projectId: 'outro' }], copy(2)),
    ).toThrow('outro projeto');
  });

  it('preserva a versão da pasta se a gravação falhar e só publica a rotação atômica', async () => {
    let raw: string | undefined;
    let fail = false;
    const folder = {
      read: async () => raw,
      write: async (next: string, expected: string | undefined) => {
        if (fail) throw Error('disco cheio');
        if (raw !== expected) return false;
        raw = next;
        return true;
      },
    };
    await saveFolderRecoveryCopy(folder, copy(1));
    await saveFolderRecoveryCopy(folder, copy(2));
    await saveFolderRecoveryCopy(folder, copy(3));
    fail = true;
    await expect(saveFolderRecoveryCopy(folder, copy(4))).rejects.toThrow(
      'disco cheio',
    );
    expect(
      (await listFolderRecoveryCopies(folder)).map((item) => item.id),
    ).toEqual(['copia-3', 'copia-2', 'copia-1']);
    fail = false;
    await saveFolderRecoveryCopy(folder, copy(4));
    expect(
      (await listFolderRecoveryCopies(folder)).map((item) => item.id),
    ).toEqual(['copia-4', 'copia-3', 'copia-2']);
  });

  it('recusa a concorrência pela pasta sem publicar o snapshot atrasado', async () => {
    let raw: string | undefined;
    const folder = {
      read: async () => raw,
      write: async (next: string, expected: string | undefined) => {
        if (raw !== expected) return false;
        raw = next;
        return true;
      },
    };
    const old = {
      read: folder.read,
      write: async (next: string, expected: string | undefined) => {
        await saveFolderRecoveryCopy(folder, copy(6));
        return folder.write(next, expected);
      },
    };
    await expect(saveFolderRecoveryCopy(old, copy(5))).rejects.toThrow('mudou');
    expect(
      (await listFolderRecoveryCopies(folder, project.id)).map(
        (item) => item.id,
      ),
    ).toEqual(['copia-6']);
  });
});
