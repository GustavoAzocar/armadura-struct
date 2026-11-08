import { useEffect, useRef, useState } from 'react';
import {
  cadDefaults,
  factoryCadDefaults,
  validateCadDefaults,
  type CadDefaults,
  type CadCategory,
} from '../domain/cadDefaults';
import { LINE_TYPES, resolveStyle, dashArray } from '../domain/layers';
import type { Project } from '../domain/types';
const categories: Record<CadCategory, string> = {
  texts: 'Textos',
  armatures: 'Armaduras',
  dimensions: 'Cotas',
  masks: 'Máscaras',
  lines: 'Tipos de linha',
};
const get = (o: any, path: string) =>
  path.split('.').reduce((v, k) => v?.[k], o);
const put = (o: any, path: string, value: any) => {
  const keys = path.split('.');
  let at = o;
  for (const k of keys.slice(0, -1)) at = at[k] ??= {};
  at[keys.at(-1)!] = value;
};
export default function CadSettingsDialog({
  project,
  onSave,
  onClose,
  onManager,
}: {
  project: Project;
  onSave: (base: Project, value: CadDefaults) => boolean;
  onClose: () => void;
  onManager: (action: 'layers' | 'plot') => void;
}) {
  const base = useRef(project),
    dialog = useRef<HTMLDialogElement>(null),
    fields = useRef<HTMLDivElement>(null),
    submitted = useRef(false);
  const [category, setCategory] = useState<CadCategory>('texts'),
    [draft, setDraft] = useState(() => structuredClone(cadDefaults(project))),
    [numbers, setNumbers] = useState<Record<string, string>>({}),
    [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const el = dialog.current!;
    el.showModal();
    return () => {
      el.close();
      if (old?.isConnected) old.focus();
    };
  }, []);
  const set = (path: string, value: any) => {
    setDraft((old) => {
      const next = structuredClone(old);
      put(next, path, value);
      return next;
    });
    setErrors({});
  };
  const effective = () => {
    const next = structuredClone(draft);
    for (const [path, text] of Object.entries(numbers))
      put(next, path, text.trim() ? Number(text.replace(',', '.')) : NaN);
    return next;
  };
  const numeric = (path: string, label: string, fallback?: number) => (
    <label className="field" key={path}>
      {label}
      <input
        aria-label={label}
        inputMode="decimal"
        value={numbers[path] ?? String(get(draft, path) ?? fallback ?? '')}
        onChange={(e) => {
          setNumbers((old) => ({ ...old, [path]: e.target.value }));
          setErrors({});
        }}
      />
      {errors[path] && <span role="alert">{errors[path]}</span>}
    </label>
  );
  const appearance = (path: string, label: string, role: string) => {
    const a = get(draft, path),
      style = a.style ?? {};
    return (
      <fieldset className="cad-default-appearance">
        <legend>{label}</legend>
        <label className="field">
          Layer
          <select
            aria-label={`Layer de ${label}`}
            value={a.layerId ?? ''}
            onChange={(e) =>
              set(path + '.layerId', e.target.value || undefined)
            }
          >
            <option value="">Padrão do comando</option>
            {project.layers.map((l) => (
              <option value={l.id} key={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={style.color !== undefined}
            onChange={(e) =>
              set(path + '.style', {
                ...style,
                color: e.target.checked
                  ? resolveStyle(project, a, role).color
                  : undefined,
              })
            }
          />
          Cor própria de {label}
        </label>
        {style.color !== undefined && (
          <input
            type="color"
            aria-label={`Cor de ${label}`}
            value={style.color}
            onChange={(e) => set(path + '.style.color', e.target.value)}
          />
        )}
        <label className="field">
          Linha
          <select
            aria-label={`Linha de ${label}`}
            value={
              a.commonLine
                ? 'common'
                : style.lineType
                  ? JSON.stringify(style.lineType)
                  : ''
            }
            onChange={(e) => {
              set(path + '.commonLine', e.target.value === 'common');
              if (e.target.value === 'common')
                setNumbers((old) =>
                  Object.fromEntries(
                    Object.entries(old).filter(
                      ([key]) =>
                        key !== path + '.style.lineWidth' &&
                        key !== path + '.style.lineScale',
                    ),
                  ),
                );
              set(path + '.style', {
                ...style,
                ...(e.target.value === 'common'
                  ? { lineWidth: undefined, lineScale: undefined }
                  : {}),
                lineType:
                  e.target.value && e.target.value !== 'common'
                    ? JSON.parse(e.target.value)
                    : undefined,
              });
            }}
          >
            <option value="">ByLayer</option>
            <option value="common">Padrão comum (Tipos de linha)</option>
            {style.lineType &&
              !LINE_TYPES.some(
                (l) => JSON.stringify(l) === JSON.stringify(style.lineType),
              ) && (
                <option value={JSON.stringify(style.lineType)}>
                  {style.lineType.name} (preservado)
                </option>
              )}
            {LINE_TYPES.map((l, i) => (
              <option key={l.name} value={JSON.stringify(l)}>
                {['Contínua', 'Tracejada', 'Pontilhada', 'Traço-ponto'][i]}
              </option>
            ))}
          </select>
        </label>
        {!a.commonLine && (
          <>
            <label>
              <input
                type="checkbox"
                checked={style.lineWidth !== undefined}
                onChange={(e) => {
                  set(path + '.style', {
                    ...style,
                    lineWidth: e.target.checked ? 0.18 : undefined,
                    lineScale: e.target.checked ? 1 : undefined,
                  });
                  setNumbers((old) =>
                    Object.fromEntries(
                      Object.entries(old).filter(
                        ([key]) => !key.startsWith(path + '.style.'),
                      ),
                    ),
                  );
                }}
              />
              Pena/escala próprias de {label}
            </label>
            {style.lineWidth !== undefined && (
              <>
                {numeric(
                  path + '.style.lineWidth',
                  `Espessura de ${label} (mm no papel)`,
                )}
                {numeric(
                  path + '.style.lineScale',
                  `Escala de linha de ${label}`,
                )}
              </>
            )}
          </>
        )}
        {path === 'masks.entity' && (
          <label className="field">
            Preenchimento
            <select
              aria-label="Preenchimento padrão nativo"
              value={style.fill ?? ''}
              onChange={(e) =>
                set(path + '.style', {
                  ...style,
                  fill: e.target.value || undefined,
                  fillColor:
                    e.target.value === 'solid'
                      ? (style.fillColor ?? '#8995b3')
                      : undefined,
                })
              }
            >
              <option value="">ByLayer</option>
              <option value="none">Nenhum</option>
              <option value="solid">Sólido</option>
            </select>
            {style.fill === 'solid' && (
              <input
                type="color"
                aria-label="Cor do preenchimento nativo"
                value={style.fillColor}
                onChange={(e) => set(path + '.style.fillColor', e.target.value)}
              />
            )}
          </label>
        )}
      </fieldset>
    );
  };
  const current = effective(),
    a =
      category === 'armatures'
        ? current.armatures.bar
        : category === 'masks'
          ? current.masks.entity
          : category === 'texts'
            ? current.texts.appearance
            : category === 'dimensions'
              ? current.dimensions.appearance
              : { commonLine: true };
  const preview = resolveStyle(
    project,
    {
      ...a,
      style: Object.fromEntries(
        Object.entries({
          ...(a.commonLine ? current.lines : {}),
          ...a.style,
        }).filter(([, v]) => v !== undefined),
      ),
    },
    category === 'armatures'
      ? 'ARMADURAS'
      : category === 'masks'
        ? 'DESENHO'
        : category === 'dimensions'
          ? 'COTAS'
          : 'CHAMADAS',
  );
  return (
    <dialog
      ref={dialog}
      className="modal cad-settings"
      aria-label="Configurações CAD"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (
          (e.ctrlKey || e.metaKey) &&
          ['s', 'o', 'z', 'y'].includes(e.key.toLowerCase())
        )
          e.preventDefault();
      }}
    >
      <header>
        <h2>Configurações CAD</h2>
        <button aria-label="Fechar configurações CAD" onClick={onClose}>
          ×
        </button>
      </header>
      <p>
        Padrões deste projeto · próximos objetos. Os objetos existentes mantêm
        seus atributos. Salvar e fechar aplica uma operação no histórico;
        Cancelar descarta o rascunho. Controles rápidos são ajustes temporários;
        esta janela mostra os padrões salvos. Alterar e salvar estes padrões
        substitui os ajustes rápidos anteriores.
      </p>
      <div className="cad-settings-layout">
        <nav aria-label="Categorias CAD">
          {Object.entries(categories).map(([key, label]) => (
            <button
              key={key}
              aria-pressed={category === key}
              onClick={() => {
                setCategory(key as CadCategory);
                fields.current?.scrollTo({ top: 0 });
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="cad-settings-fields" ref={fields}>
          {category === 'texts' && (
            <>
              {numeric(
                'texts.height',
                'Altura de chamadas/cortes (mm no modelo)',
              )}
              {numeric(
                'texts.identificationHeight',
                'Altura de identificação de novas barras/rebatimentos (mm no modelo)',
              )}
              <label className="field">
                Alinhamento de texto
                <select
                  aria-label="Alinhamento padrão de texto"
                  value={draft.texts.align ?? ''}
                  onChange={(e) =>
                    set('texts.align', e.target.value || undefined)
                  }
                >
                  <option value="">Padrão de cada comando</option>
                  <option value="left">Esquerda</option>
                  <option value="center">Centro</option>
                  <option value="right">Direita</option>
                </select>
              </label>
              {appearance('texts.appearance', 'chamadas e cortes', 'CHAMADAS')}
              {appearance(
                'texts.identification',
                'identificações',
                'IDENTIFICACAO',
              )}
              <p>
                Textos de faixas de novas barras também usam a altura de
                chamadas. Textos importados preservam suas alturas. A altura de
                papel configurada em cada vista prevalece na composição.
              </p>
            </>
          )}
          {category === 'armatures' && (
            <>
              {numeric('armatures.diameter', 'Bitola padrão (mm)')}
              <label className="field">
                Aço
                <select
                  aria-label="Aço padrão"
                  value={draft.armatures.steel}
                  onChange={(e) => set('armatures.steel', e.target.value)}
                >
                  <option>CA-50</option>
                  <option>CA-60</option>
                </select>
              </label>
              {numeric('armatures.quantity', 'Quantidade base padrão')}
              {numeric('armatures.spacing', 'Espaçamento padrão (mm)')}
              {numeric('armatures.cover', 'Cobrimento padrão (mm)')}
              {appearance('armatures.bar', 'barras', 'ARMADURAS')}
              {appearance(
                'armatures.representation',
                'rebatimentos',
                'REBATIMENTOS',
              )}
              <p>
                Bitola/aço/quantidade: novas barras e estribos. Espaçamento:
                novas faixas/repetições. Cobrimento: Seguir fôrma. Mandril e
                premissas continuam no lançamento, sujeitos à geometria; estes
                padrões não validam normas.
              </p>
            </>
          )}
          {category === 'dimensions' && (
            <>
              {numeric(
                'dimensions.height',
                'Altura de novas cotas (mm no modelo)',
              )}
              {numeric(
                'dimensions.autoHeight',
                'Altura de cotas automáticas de novas barras/rebatimentos (mm no modelo)',
              )}
              {appearance('dimensions.appearance', 'cotas', 'COTAS')}
              <p>
                Unidades, precisão e arredondamento especializados continuam nos
                contratos de cotagem existentes. Não altera cotas antigas.
              </p>
            </>
          )}
          {category === 'masks' && (
            <>
              {numeric(
                'masks.opacity',
                'Opacidade de novas máscaras nativas (0–1)',
              )}
              {appearance('masks.mask', 'máscaras nativas', 'MASCARA')}
              {appearance('masks.entity', 'entidades nativas', 'DESENHO')}
              <p>
                Referências DXF/DWG mantêm estilos, layers e opacidade do
                importador. O desenho local acrescentado a uma referência usa o
                padrão de entidades, preservando o arquivo e a geometria
                importada. Origem/unidade/escala são editadas nas propriedades
                da máscara.
              </p>
            </>
          )}
          {category === 'lines' && (
            <>
              <label className="field">
                Tipo comum
                <select
                  aria-label="Tipo de linha comum"
                  value={JSON.stringify(draft.lines.lineType)}
                  onChange={(e) =>
                    set('lines.lineType', JSON.parse(e.target.value))
                  }
                >
                  {!LINE_TYPES.some(
                    (l) =>
                      JSON.stringify(l) ===
                      JSON.stringify(draft.lines.lineType),
                  ) && (
                    <option value={JSON.stringify(draft.lines.lineType)}>
                      {draft.lines.lineType.name}
                    </option>
                  )}
                  {LINE_TYPES.map((l, i) => (
                    <option key={l.name} value={JSON.stringify(l)}>
                      {
                        ['Contínua', 'Tracejada', 'Pontilhada', 'Traço-ponto'][
                          i
                        ]
                      }
                    </option>
                  ))}
                </select>
              </label>
              {numeric('lines.lineScale', 'Escala de linha comum')}
              {numeric('lines.lineWidth', 'Espessura comum (mm no papel)')}
              <p>
                Usado apenas nas categorias que escolherem Padrão comum. ByLayer
                e tipos próprios/importados são preservados. Traços em mm do
                modelo; pena em mm no papel.
              </p>
            </>
          )}
          <svg
            className="cad-settings-preview"
            aria-label="Amostra de estilo CAD"
            viewBox="0 0 1000 220"
          >
            <line
              x1="40"
              y1="65"
              x2="960"
              y2="65"
              stroke={preview.color}
              strokeWidth={Math.max(
                1,
                (Number.isFinite(preview.lineWidth)
                  ? preview.lineWidth
                  : 0.18) * 8,
              )}
              strokeDasharray={dashArray({
                ...preview,
                lineScale: Number.isFinite(preview.lineScale)
                  ? preview.lineScale
                  : 1,
              }).join(' ')}
            />
            <text
              x="40"
              y="180"
              fontSize={
                Number.isFinite(
                  category === 'texts'
                    ? current.texts.height
                    : category === 'dimensions'
                      ? current.dimensions.height
                      : 40,
                )
                  ? (category === 'texts'
                      ? current.texts.height
                      : category === 'dimensions'
                        ? current.dimensions.height
                        : 40) * 1.4
                  : 70
              }
              fill={preview.color}
            >
              N1 · Ø10 · 1000 mm
            </text>
          </svg>
          <small>
            Amostra ampliada de cor/linha. As medidas de texto acima são
            físicas; zoom e escala de impressão são independentes.
          </small>
        </div>
      </div>
      {errors._ && <p role="alert">{errors._}</p>}
      {project !== base.current && (
        <p role="alert">
          O projeto mudou durante a edição. Reabra as configurações para aplicar
          ao estado atual.
        </p>
      )}
      <small>
        Os atalhos dos gerenciadores fecham esta janela e descartam o rascunho;
        salve primeiro para mantê-lo.
      </small>
      <footer>
        <button
          onClick={() => {
            setDraft((old) => ({
              ...old,
              [category]: factoryCadDefaults()[category],
            }));
            setNumbers((old) =>
              Object.fromEntries(
                Object.entries(old).filter(
                  ([key]) => !key.startsWith(category + '.'),
                ),
              ),
            );
            setErrors({});
          }}
        >
          Restaurar {categories[category]} no rascunho
        </button>
        <button onClick={() => onManager('layers')}>Gerenciar layers</button>
        <button onClick={() => onManager('plot')}>Estilos de impressão</button>
        <button onClick={onClose}>Cancelar</button>
        <button
          disabled={project !== base.current}
          onClick={() => {
            if (submitted.current) return;
            try {
              const value = validateCadDefaults(project, effective());
              if (project !== base.current)
                throw new Error('O projeto mudou. Reabra as configurações.');
              submitted.current = true;
              if (onSave(base.current, value)) onClose();
              else {
                submitted.current = false;
                setErrors({
                  _: 'Alteração não aplicada. Confira contexto e proteções.',
                });
              }
            } catch (e) {
              const err = e as any;
              const fields: Record<string, string> = {};
              for (const i of err.issues ?? [])
                fields[i.path.join('.')] = i.message;
              setErrors({
                ...fields,
                _: err.issues
                  ? 'Corrija os campos indicados nas categorias.'
                  : err.message,
              });
            }
          }}
        >
          Salvar e fechar
        </button>
      </footer>
    </dialog>
  );
}
