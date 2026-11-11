import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  eventKey,
  usesBrowserZoomKey,
  keyLabel,
  scopeLabels,
  shortcutCatalog,
  shortcutCategories,
  shortcutCommands,
  shortcutScopes,
  textComposition,
  type Action,
  type ShortcutScope,
} from '../domain/shortcuts';
import {
  bindingConflicts,
  commandIsDefault,
  defaultShortcuts,
  parseAliases,
  reassignBindings,
  setBindings,
  type BindingLocation,
  type ShortcutPreferences,
} from '../lib/shortcutPreferences';

type Pending = {
  next: ShortcutPreferences;
  action: Action;
  location?: BindingLocation;
  conflicts: ReturnType<typeof bindingConflicts>;
};

const categoryOrder = [
  'Armaduras',
  'Máscaras',
  'Geral',
  'Edição',
  'Navegação/Interface',
];
const orderedCommands = [...shortcutCommands].sort(
  (left, right) =>
    categoryOrder.indexOf(shortcutCatalog[left].category) -
    categoryOrder.indexOf(shortcutCatalog[right].category),
);
const searchText = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');

export default function ShortcutsDialog({
  preferences,
  desktop,
  warning,
  onSave,
  onClose,
}: {
  preferences: ShortcutPreferences;
  desktop: boolean;
  warning?: string;
  onSave: (next: ShortcutPreferences) => boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const submitted = useRef(false);
  const [draft, setDraft] = useState(preferences);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [chosen, setChosen] = useState<Action>('bar');
  const [scope, setScope] = useState<ShortcutScope>('global');
  const [capture, setCapture] = useState<number | null>(null);
  const [aliasText, setAliasText] = useState<string | null>(null);
  const [aliasError, setAliasError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [restoreAll, setRestoreAll] = useState(false);
  const confirmation = useRef<HTMLButtonElement>(null);
  const previousControl = useRef<HTMLElement>(null);

  useEffect(() => {
    const old = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    search.current?.focus();
    return () => {
      element.close();
      if (old instanceof HTMLElement && old.isConnected) old.focus();
    };
  }, []);
  useEffect(() => {
    if (restoreAll || pending) confirmation.current?.focus();
  }, [restoreAll, pending]);

  const visible = useMemo(() => {
    const words = searchText(query).trim().split(/\s+/);
    return orderedCommands.filter((action) => {
      const entry = shortcutCatalog[action];
      if (category && entry.category !== category) return false;
      const terms = [entry.name, entry.category, entry.description ?? ''];
      for (const scope of shortcutScopes) {
        const { keys, aliases } = draft.bindings[action][scope];
        if (keys.length || aliases.length) terms.push(scopeLabels[scope]);
        for (const key of keys) {
          terms.push(keyLabel(key));
          if (key.startsWith('Mod+'))
            terms.push('Ctrl' + key.slice(3), 'Cmd' + key.slice(3));
        }
        terms.push(...aliases);
      }
      const haystack = searchText(terms.join(' '));
      return words.every((word) => haystack.includes(word));
    });
  }, [query, category, draft]);

  const action = visible.includes(chosen) ? chosen : visible[0];
  const entry = action ? shortcutCatalog[action] : undefined;
  const bindings = action ? draft.bindings[action][scope] : undefined;
  const clearEditor = () => {
    setCapture(null);
    setAliasText(null);
    setAliasError('');
    setMessage('');
  };
  const choose = (next: Action) => {
    clearEditor();
    setChosen(next);
    const configured = shortcutScopes.find((scope) => {
      const { keys, aliases } = draft.bindings[next][scope];
      return keys.length || aliases.length;
    });
    setScope(configured ?? 'global');
  };
  const stage = (
    next: ShortcutPreferences,
    action: Action,
    location?: BindingLocation,
    control = document.activeElement,
  ) => {
    setMessage('');
    const conflicts = bindingConflicts(next);
    if (conflicts.length) {
      if (control instanceof HTMLElement) previousControl.current = control;
      setPending({ next, action, location, conflicts });
    } else setDraft(next);
  };
  const cancelPending = () => {
    setPending(null);
    setRestoreAll(false);
    clearEditor();
    const previous = previousControl.current;
    requestAnimationFrame(() => {
      if (previous && dialog.current?.contains(previous)) previous.focus();
      else search.current?.focus();
    });
  };
  const captureKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (capture !== index || !bindings || !action) return;
    if (e.key === 'Tab') {
      setCapture(null);
      return;
    }
    if (textComposition(e.nativeEvent)) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.repeat) return;
    if (e.key === 'Escape') {
      setCapture(null);
      setMessage('');
      return;
    }
    if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return;
    const key = eventKey(e.nativeEvent);
    if (!key) {
      setMessage(
        'Tecla reservada ou não reconhecida. Tente outra combinação ou pressione Esc.',
      );
      return;
    }
    if (bindings.keys.some((value, i) => value === key && i !== index)) {
      setMessage(
        'Essa combinação já está associada a este comando neste contexto.',
      );
      return;
    }
    const keys = [...bindings.keys];
    keys[index] = key;
    setCapture(null);
    const location = { action, scope, kind: 'keys' } as const;
    stage(
      setBindings(draft, location, keys),
      action,
      location,
      e.currentTarget,
    );
  };
  const keyButton = (index: number, label: string) => (
    <button
      type="button"
      aria-pressed={capture === index}
      onBlur={() =>
        setCapture((current) => (current === index ? null : current))
      }
      onClick={() => {
        setCapture(index);
        setMessage('');
      }}
      onKeyDown={(e) => captureKey(e, index)}
    >
      {capture === index ? 'Pressione uma tecla…' : label}
    </button>
  );
  const status = (action: Action) => {
    const hasBindings = shortcutScopes.some((scope) => {
      const { keys, aliases } = draft.bindings[action][scope];
      return keys.length || aliases.length;
    });
    if (!hasBindings) return 'Sem atalho';
    return commandIsDefault(draft, action) ? 'Padrão' : 'Personalizado';
  };

  return (
    <dialog
      className="modal shortcuts-dialog"
      aria-labelledby="shortcuts-title"
      ref={dialog}
      onKeyDown={(event) => {
        if (event.repeat && event.key === 'Escape') event.preventDefault();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (capture !== null) setCapture(null);
        else if (pending || restoreAll) cancelPending();
        else onClose();
      }}
    >
      <header className="shortcuts-header">
        <h2 id="shortcuts-title">Atalhos de teclado</h2>
        <button
          type="button"
          className="modal-close"
          aria-label="Fechar atalhos"
          onClick={onClose}
        >
          ×
        </button>
        <p>
          Pressione o atalho imediato no desenho. Digite o alias no campo
          Comando (tecla :) e confirme com Enter.
        </p>
        <label className="shortcuts-toggle">
          <input
            type="checkbox"
            disabled={!!pending || restoreAll}
            checked={draft.singleKeysDisabled}
            onChange={(event) =>
              setDraft({ ...draft, singleKeysDisabled: event.target.checked })
            }
          />
          Desativar atalhos de tecla única
        </label>
        {warning && <p role="status">{warning}</p>}
      </header>
      <div className="shortcuts-browser" inert={!!pending || restoreAll}>
        <div className="shortcuts-filters">
          <label className="field">
            Buscar
            <input
              ref={search}
              value={query}
              placeholder="Comando, categoria, tecla ou alias"
              onChange={(e) => {
                clearEditor();
                setQuery(e.target.value);
              }}
            />
          </label>
          <label className="field">
            Categoria
            <select
              value={category}
              onChange={(e) => {
                clearEditor();
                setCategory(e.target.value);
              }}
            >
              <option value="">Todas</option>
              {shortcutCategories.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="shortcuts-body">
          <ul className="shortcuts-commands" aria-label="Comandos">
            {visible.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  aria-pressed={id === action}
                  onClick={() => choose(id)}
                >
                  <span>{shortcutCatalog[id].name}</span>
                  <small>{status(id)}</small>
                </button>
              </li>
            ))}
            {!visible.length && <li>Nenhum comando encontrado.</li>}
          </ul>
          {action && entry && bindings && (
            <section className="shortcuts-editor" aria-label={entry.name}>
              <h3>{entry.name}</h3>
              <small>
                {entry.category}
                {entry.needsDrawing ? ' · Requer um desenho aberto' : ''}
              </small>
              {entry.description && <p>{entry.description}</p>}
              <ul
                className="shortcut-bindings"
                aria-label="Associações por contexto"
              >
                {shortcutScopes.map((scope) => {
                  const { keys, aliases } = draft.bindings[action][scope];
                  if (!keys.length && !aliases.length) return null;
                  return (
                    <li key={scope}>
                      <strong>{scopeLabels[scope]}</strong>
                      <span>
                        {[
                          ...keys.map(
                            (key) =>
                              `${keyLabel(key)}${!desktop && usesBrowserZoomKey(key) ? ' (pode controlar o zoom do navegador)' : draft.singleKeysDisabled && !key.includes('+') ? ' (desativado)' : ''}`,
                          ),
                          ...aliases.map((alias) => `${alias} + Enter`),
                        ].join(' · ')}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <label className="field">
                Contexto da associação
                <select
                  value={scope}
                  onChange={(event) => {
                    clearEditor();
                    setScope(
                      shortcutScopes.find(
                        (value) => value === event.target.value,
                      )!,
                    );
                  }}
                >
                  {shortcutScopes.map((value) => (
                    <option key={value} value={value}>
                      {scopeLabels[value]}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>Atalho imediato</legend>
                {!bindings.keys.length && (
                  <small>Sem atalho imediato neste contexto</small>
                )}
                {bindings.keys.map((key, index) => (
                  <div className="shortcut-key" key={index}>
                    <kbd>{keyLabel(key)}</kbd>
                    {keyButton(index, `Alterar ${keyLabel(key)}`)}
                    <button
                      type="button"
                      aria-label={`Remover ${keyLabel(key)}`}
                      onClick={() =>
                        stage(
                          setBindings(
                            draft,
                            { action, scope, kind: 'keys' },
                            bindings.keys.filter((_, i) => i !== index),
                          ),
                          action,
                        )
                      }
                    >
                      Remover
                    </button>
                  </div>
                ))}
                {keyButton(bindings.keys.length, 'Atribuir atalho')}
                {capture !== null && (
                  <small role="status">
                    Esc cancela a captura. Tab passa ao próximo controle.
                  </small>
                )}
              </fieldset>
              <label className="field">
                Aliases separados por vírgula
                <input
                  value={aliasText ?? bindings.aliases.join(', ')}
                  aria-invalid={!!aliasError}
                  onChange={(event) => {
                    const raw = event.target.value;
                    setAliasText(raw);
                    const aliases = parseAliases(raw);
                    setAliasError(
                      aliases
                        ? ''
                        : 'Use aliases diferentes, começando com letra. Separe por vírgulas e evite opções de comandos, unidades e coordenadas.',
                    );
                  }}
                  onBlur={(event) => {
                    if (aliasText === null) return;
                    const aliases = parseAliases(aliasText);
                    if (aliases) {
                      const location = {
                        action,
                        scope,
                        kind: 'aliases',
                      } as const;
                      stage(
                        setBindings(draft, location, aliases),
                        action,
                        location,
                        event.currentTarget,
                      );
                      setAliasText(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !textComposition(event.nativeEvent)
                    ) {
                      event.preventDefault();
                      if (!event.repeat) event.currentTarget.blur();
                    }
                  }}
                />
              </label>
              {aliasError && <p role="alert">{aliasError}</p>}
              <button
                type="button"
                onClick={() => {
                  clearEditor();
                  const next = defaultShortcuts();
                  stage(
                    {
                      ...draft,
                      bindings: {
                        ...draft.bindings,
                        [action]: next.bindings[action],
                      },
                    },
                    action,
                  );
                }}
              >
                Restaurar este comando
              </button>
            </section>
          )}
        </div>
      </div>
      {(pending || restoreAll) && (
        <section
          className="shortcuts-confirmation"
          aria-label={pending ? 'Conflito de atalhos' : 'Restaurar padrões'}
        >
          {pending ? (
            <>
              <div role="alert">
                <strong>Conflito de atalhos</strong>
                {pending.conflicts.map(({ existing, binding }, index) => (
                  <p key={index}>
                    {binding.kind === 'keys'
                      ? keyLabel(binding.value)
                      : `${binding.value} + Enter`}
                    {' · '}
                    {shortcutCatalog[existing.action].name} (
                    {scopeLabels[existing.scope]}){' / '}
                    {shortcutCatalog[binding.action].name} (
                    {scopeLabels[binding.scope]})
                  </p>
                ))}
              </div>
              <button type="button" ref={confirmation} onClick={cancelPending}>
                Cancelar alteração
              </button>
              <button
                type="button"
                disabled={
                  bindingConflicts(
                    reassignBindings(
                      pending.next,
                      pending.action,
                      pending.location,
                    ),
                  ).length > 0
                }
                onClick={() => {
                  const next = reassignBindings(
                    pending.next,
                    pending.action,
                    pending.location,
                  );
                  if (bindingConflicts(next).length) return;
                  setDraft(next);
                  cancelPending();
                }}
              >
                Reatribuir a {shortcutCatalog[pending.action].name}
              </button>
            </>
          ) : (
            <>
              <p role="status">
                Restaurar todos os atalhos e aliases no rascunho? As
                preferências só mudam depois de salvar.
              </p>
              <button type="button" ref={confirmation} onClick={cancelPending}>
                Manter rascunho
              </button>
              <button
                type="button"
                onClick={() => {
                  setRestoreAll(false);
                  clearEditor();
                  stage(defaultShortcuts(), chosen);
                  requestAnimationFrame(() => search.current?.focus());
                }}
              >
                Confirmar restauração
              </button>
            </>
          )}
        </section>
      )}
      {message && (
        <p className="shortcuts-message" role="alert">
          {message}
        </p>
      )}
      <footer className="modal-actions">
        <small>Esc, Enter, Tab, Shift+Tab e Espaço são reservados.</small>
        <button
          type="button"
          disabled={!!pending || restoreAll}
          onClick={(event) => {
            previousControl.current = event.currentTarget;
            setRestoreAll(true);
          }}
        >
          Restaurar todos
        </button>
        <button type="button" onClick={onClose}>
          Cancelar
        </button>
        <button
          type="button"
          className="primary"
          disabled={!!pending || restoreAll || !!aliasError}
          onClick={() => {
            if (submitted.current) return;
            const aliases =
              aliasText === null ? undefined : parseAliases(aliasText);
            const next =
              action && aliases
                ? setBindings(
                    draft,
                    { action, scope, kind: 'aliases' },
                    aliases,
                  )
                : draft;
            if (bindingConflicts(next).length) {
              if (action)
                stage(next, action, { action, scope, kind: 'aliases' });
              return;
            }
            submitted.current = true;
            if (onSave(next)) onClose();
            else {
              submitted.current = false;
              setMessage(
                'Não foi possível gravar os atalhos neste dispositivo. As preferências anteriores continuam em uso.',
              );
            }
          }}
        >
          Salvar
        </button>
      </footer>
    </dialog>
  );
}
