import {
  keyLabel,
  normalizeAlias,
  normalizeKey,
  scopeLabels,
  shortcutCatalog,
  shortcutCommands,
  shortcutScopes,
  type Action,
  type ShortcutScope,
  type WorkScope,
} from '../domain/shortcuts';

export const shortcutStorageKey = 'armadurastruct.shortcuts';
export const bindingKinds = ['keys', 'aliases'] as const;
export type BindingKind = (typeof bindingKinds)[number];
type BindingLists = Record<BindingKind, string[]>;
type BindingMap = Record<Action, Record<ShortcutScope, BindingLists>>;
export type ShortcutPreferences = {
  singleKeysDisabled: boolean;
  bindings: BindingMap;
};
export type BindingLocation = {
  action: Action;
  scope: ShortcutScope;
  kind: BindingKind;
};
type Binding = BindingLocation & { value: string };

const same = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

export function defaultShortcuts(): ShortcutPreferences {
  const bindings = {} as BindingMap;
  for (const action of shortcutCommands) {
    const scopes = {} as BindingMap[Action];
    for (const scope of shortcutScopes) {
      const defaults = shortcutCatalog[action].defaults[scope];
      scopes[scope] = {
        keys: [...(defaults?.keys ?? [])],
        aliases: [...(defaults?.aliases ?? [])],
      };
    }
    bindings[action] = scopes;
  }
  return { singleKeysDisabled: false, bindings };
}

export function setBindings(
  prefs: ShortcutPreferences,
  { action, scope, kind }: BindingLocation,
  values: string[],
): ShortcutPreferences {
  return {
    ...prefs,
    bindings: {
      ...prefs.bindings,
      [action]: {
        ...prefs.bindings[action],
        [scope]: { ...prefs.bindings[action][scope], [kind]: values },
      },
    },
  };
}

export function commandIsDefault(prefs: ShortcutPreferences, action: Action) {
  return shortcutScopes.every((scope) =>
    bindingKinds.every((kind) =>
      same(
        prefs.bindings[action][scope][kind],
        shortcutCatalog[action].defaults[scope]?.[kind] ?? [],
      ),
    ),
  );
}

function allBindings(prefs: ShortcutPreferences): Binding[] {
  return shortcutCommands.flatMap((action) =>
    shortcutScopes.flatMap((scope) =>
      bindingKinds.flatMap((kind) =>
        prefs.bindings[action][scope][kind].map((value) => ({
          action,
          scope,
          kind,
          value,
        })),
      ),
    ),
  );
}

const applies = (scope: ShortcutScope, current: WorkScope) =>
  scope === 'global' || scope === current;
const overlap = (left: Binding, right: Binding) =>
  left.kind === right.kind &&
  left.value === right.value &&
  (left.scope === 'global' ||
    right.scope === 'global' ||
    left.scope === right.scope);

export function bindingConflicts(prefs: ShortcutPreferences) {
  const all = allBindings(prefs);
  return all.flatMap((binding, index) =>
    all
      .slice(0, index)
      .filter((existing) => overlap(binding, existing))
      .map((existing) => ({ existing, binding })),
  );
}

export function reassignBindings(
  prefs: ShortcutPreferences,
  action: Action,
  preferred?: BindingLocation,
) {
  let next = prefs;
  const matches = (binding: Binding) =>
    binding.action === action &&
    (!preferred ||
      (binding.scope === preferred.scope && binding.kind === preferred.kind));
  for (const { existing, binding } of bindingConflicts(prefs)) {
    const keepExisting = matches(existing);
    const keepBinding = matches(binding);
    if (keepExisting === keepBinding) continue;
    const old = keepExisting ? binding : existing;
    next = setBindings(
      next,
      old,
      next.bindings[old.action][old.scope][old.kind].filter(
        (value) => value !== old.value,
      ),
    );
  }
  return next;
}

export function compileShortcuts(prefs: ShortcutPreferences) {
  const maps = {
    drawing: {
      keys: new Map<string, Action>(),
      aliases: new Map<string, Action>(),
    },
    masks: {
      keys: new Map<string, Action>(),
      aliases: new Map<string, Action>(),
    },
  };
  for (const { action, scope, kind, value } of allBindings(prefs)) {
    if (kind === 'keys' && !keyEnabled(prefs, value)) continue;
    for (const context of ['drawing', 'masks'] as const)
      if (applies(scope, context)) maps[context][kind].set(value, action);
  }
  return maps;
}

const keyEnabled = (prefs: ShortcutPreferences, key: string) =>
  !prefs.singleKeysDisabled || key.includes('+');

export function shortcutHelp(
  prefs: ShortcutPreferences,
  action: Action,
  current?: WorkScope,
) {
  return shortcutScopes
    .flatMap((scope) => {
      if (current && !applies(scope, current)) return [];
      const { keys, aliases } = prefs.bindings[action][scope];
      const hints = [
        ...keys.filter((key) => keyEnabled(prefs, key)).map(keyLabel),
        ...aliases.map((alias) => `${alias} + Enter`),
      ];
      return hints.length
        ? [
            scope === 'global'
              ? hints.join(' / ')
              : `${hints.join(' / ')} (${scopeLabels[scope]})`,
          ]
        : [];
    })
    .join(' · ');
}

const normalize = { keys: normalizeKey, aliases: normalizeAlias };
export function parseAliases(raw: string): string[] | undefined {
  if (!raw.trim()) return [];
  const aliases = raw.split(',').map(normalizeAlias);
  if (
    aliases.some((alias) => !alias) ||
    new Set(aliases).size !== aliases.length
  )
    return;
  return aliases as string[];
}

type Overrides = Partial<
  Record<Action, Partial<Record<ShortcutScope, Partial<BindingLists>>>>
>;
export function serializeShortcuts(prefs: ShortcutPreferences) {
  const overrides: Overrides = {};
  for (const action of shortcutCommands)
    for (const scope of shortcutScopes)
      for (const kind of bindingKinds) {
        const values = prefs.bindings[action][scope][kind];
        if (same(values, shortcutCatalog[action].defaults[scope]?.[kind] ?? []))
          continue;
        const command = (overrides[action] ??= {});
        (command[scope] ??= {})[kind] = values;
      }
  return JSON.stringify({
    version: 1,
    singleKeysDisabled: prefs.singleKeysDisabled,
    overrides,
  });
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const knownAction = (value: string): value is Action =>
  Object.hasOwn(shortcutCatalog, value);
type LoadedShortcuts = { preferences: ShortcutPreferences; warning?: string };
const repaired =
  'Algumas preferências de teclado estavam inválidas ou desatualizadas. Revise os atalhos recuperados.';

export function decodeShortcuts(raw: string | null): LoadedShortcuts {
  let preferences = defaultShortcuts();
  if (raw === null) return { preferences };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!object(parsed) || parsed.version !== 1 || !object(parsed.overrides))
      return { preferences, warning: repaired };
    let changed = typeof parsed.singleKeysDisabled !== 'boolean';
    preferences.singleKeysDisabled = parsed.singleKeysDisabled === true;
    const customized = new Set<string>();
    const identity = ({ action, scope, kind }: BindingLocation) =>
      `${action}/${scope}/${kind}`;
    for (const [action, command] of Object.entries(parsed.overrides)) {
      if (!knownAction(action) || !object(command)) {
        changed = true;
        continue;
      }
      for (const [key, bindings] of Object.entries(command)) {
        const scope = shortcutScopes.find((scope) => scope === key);
        if (!scope || !object(bindings)) {
          changed = true;
          continue;
        }
        for (const kind of bindingKinds) {
          if (!Object.hasOwn(bindings, kind)) continue;
          const values = bindings[kind];
          const valid = Array.isArray(values)
            ? values.map((value: unknown) =>
                typeof value === 'string' ? normalize[kind](value) : undefined,
              )
            : undefined;
          if (
            !valid ||
            valid.includes(undefined) ||
            new Set(valid).size !== valid.length
          ) {
            changed = true;
            continue;
          }
          const location = { action, scope, kind };
          preferences = setBindings(preferences, location, valid as string[]);
          customized.add(identity(location));
        }
      }
    }
    // Prefer the saved choices over newly introduced defaults. For two conflicting
    // saved choices, keep the first catalog entry and report the repair.
    const ordered = allBindings(preferences).sort(
      (left, right) =>
        Number(customized.has(identity(right))) -
        Number(customized.has(identity(left))),
    );
    const accepted: Binding[] = [];
    for (const binding of ordered) {
      if (accepted.some((existing) => overlap(binding, existing))) {
        changed = true;
        preferences = setBindings(
          preferences,
          binding,
          preferences.bindings[binding.action][binding.scope][
            binding.kind
          ].filter((value) => value !== binding.value),
        );
      } else accepted.push(binding);
    }
    return { preferences, warning: changed ? repaired : undefined };
  } catch {
    return { preferences, warning: repaired };
  }
}

export function readShortcuts(): LoadedShortcuts {
  try {
    return decodeShortcuts(localStorage.getItem(shortcutStorageKey));
  } catch {
    return {
      preferences: defaultShortcuts(),
      warning:
        'O armazenamento local de atalhos está indisponível. Os padrões foram carregados.',
    };
  }
}

export function saveShortcuts(preferences: ShortcutPreferences) {
  try {
    localStorage.setItem(shortcutStorageKey, serializeShortcuts(preferences));
    return true;
  } catch {
    return false;
  }
}
