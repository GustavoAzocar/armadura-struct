import { z } from 'zod';

/**
 * Histórico LOCAL de navegação (projetos abertos/gravados recentemente).
 * Não é autosave, backup nem revisão: guarda apenas metadados para o usuário
 * voltar ao trabalho. Uma entrada nunca concede acesso ao arquivo; reabrir
 * sempre passa por uma nova seleção explícita (diálogo/seletor).
 */
export const RECENT_LIMIT = 10;
export const RECENT_STORAGE_KEY = 'armadurastruct.recent.v1';

export type RecentKind = 'file' | 'folder';
export type RecentEntry = {
  /** Identidade derivada (tipo + projeto + local); nunca só o nome. */
  key: string;
  kind: RecentKind;
  projectId: string;
  name: string;
  fileName: string;
  /** Caminho/rótulo legível, só quando a plataforma o forneceu na seleção. */
  location?: string;
  /** Epoch em milissegundos da última abertura ou gravação concluída. */
  openedAt: number;
};
export type RecentInput = Omit<RecentEntry, 'key' | 'openedAt'>;
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const text = (max: number) => z.string().min(1).max(max);
const entrySchema = z.object({
  kind: z.enum(['file', 'folder']),
  projectId: text(200),
  name: text(300),
  fileName: text(300),
  location: z.string().min(1).max(2000).optional(),
  openedAt: z.number().finite().nonnegative(),
});

/** Arquivos distintos com o mesmo nome continuam distintos pelo projeto e pelo local. */
export function recentKey(
  e: Pick<RecentEntry, 'kind' | 'projectId' | 'fileName' | 'location'>,
) {
  const where = e.location
    ? `loc:${e.location.normalize('NFC')}`
    : `name:${e.fileName.normalize('NFC')}`;
  return `${e.kind}|${e.projectId}|${where}`;
}

const store = (): Store | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

/** Mais recente primeiro, sem duplicatas e limitado; ordem estável em empate. */
export function normalizeRecents(entries: RecentEntry[]): RecentEntry[] {
  const seen = new Set<string>();
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.openedAt - a.e.openedAt || a.i - b.i)
    .map(({ e }) => e)
    .filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)))
    .slice(0, RECENT_LIMIT);
}

/** Leitura tolerante: dado inválido é descartado e nunca impede o editor. */
export function readRecents(s: Store | undefined = store()): RecentEntry[] {
  try {
    const raw = JSON.parse(s?.getItem(RECENT_STORAGE_KEY) ?? 'null') as {
      v?: unknown;
      items?: unknown;
    } | null;
    if (!raw || raw.v !== 1 || !Array.isArray(raw.items)) return [];
    const valid: RecentEntry[] = [];
    for (const item of raw.items.slice(0, 200)) {
      const parsed = entrySchema.safeParse(item);
      if (!parsed.success) continue;
      valid.push({ ...parsed.data, key: recentKey(parsed.data) });
    }
    return normalizeRecents(valid);
  } catch {
    return [];
  }
}

function persist(entries: RecentEntry[], s: Store | undefined) {
  try {
    s?.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        items: entries.map((e) => ({
          kind: e.kind,
          projectId: e.projectId,
          name: e.name,
          fileName: e.fileName,
          location: e.location,
          openedAt: e.openedAt,
        })),
      }),
    );
  } catch {
    /* O histórico é opcional; a falha não interrompe o trabalho. */
  }
}

/**
 * Registra uma abertura/gravação JÁ concluída com sucesso. Quem chama não deve
 * registrar cancelamentos, falhas ou arquivos inválidos.
 */
export function recordRecent(
  input: RecentInput,
  now = Date.now(),
  s: Store | undefined = store(),
): RecentEntry[] {
  const parsed = entrySchema.safeParse({ ...input, openedAt: now });
  if (!parsed.success) return readRecents(s);
  const entry: RecentEntry = { ...parsed.data, key: recentKey(parsed.data) };
  const next = normalizeRecents([entry, ...readRecents(s)]);
  persist(next, s);
  return next;
}

/** Remove só a entrada do histórico; nenhum arquivo ou projeto é tocado. */
export function removeRecent(
  key: string,
  s: Store | undefined = store(),
): RecentEntry[] {
  const next = readRecents(s).filter((e) => e.key !== key);
  persist(next, s);
  return next;
}

export function clearRecents(s: Store | undefined = store()): RecentEntry[] {
  try {
    s?.removeItem(RECENT_STORAGE_KEY);
  } catch {
    /* opcional */
  }
  return [];
}

/** Diretório legível de um caminho de arquivo (separadores / ou \). */
export const recentDirectory = (e: RecentEntry) =>
  e.kind === 'folder' || !e.location
    ? e.location
    : e.location.slice(0, Math.max(0, e.location.search(/[\\/][^\\/]*$/))) ||
      e.location;

/** Texto de apoio; nomes repetidos recebem um identificador curto do projeto. */
export function recentLabels(entries: RecentEntry[]) {
  const count = new Map<string, number>();
  for (const e of entries) count.set(e.name, (count.get(e.name) ?? 0) + 1);
  return new Map(
    entries.map((e) => {
      const dir = recentDirectory(e);
      const detail =
        e.kind === 'folder'
          ? `Pasta — ${dir ?? 'local não informado'}`
          : `${e.fileName} — ${dir ?? 'local não informado'}`;
      const title =
        (count.get(e.name) ?? 0) > 1
          ? `${e.name} · ID ${e.projectId.slice(0, 8)}`
          : e.name;
      return [e.key, { title, detail }] as const;
    }),
  );
}
