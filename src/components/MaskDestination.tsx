import { useEffect, useId, useMemo, useState } from 'react';
import type { Project } from '../domain/types';
import {
  maskPath,
  maskDrawingState,
  type MaskDrawingContext,
} from '../domain/maskDrawing';
import { useTooltip } from './RibbonTooltip';
import {
  AssociateMasksIcon,
  ImportMasksIcon,
  NewMaskIcon,
  type IconComponent,
} from './maskIcons';

/**
 * Where the destination is shown (issue #119):
 * - `group`: the Referências group at the end of the Máscaras ribbon;
 * - `peek`: the same controls in the temporary panel opened while the faixa
 *   is recolhida or in Foco (the status is already in the summary there);
 * - `summary`: the compact active-mask status kept visible next to the tabs
 *   while the faixa is recolhida or in Foco.
 */
export type MaskDestinationVariant = 'group' | 'peek' | 'summary';

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function MaskSelector({
  project,
  value,
  onChange,
  label = 'Escolher máscara',
  compact = false,
}: {
  project: Project;
  value: string;
  onChange: (id: string) => void;
  label?: string;
  compact?: boolean;
}) {
  const [search, setSearch] = useState('');
  const options = useMemo(
    () =>
      project.masks.map((m) => ({
        id: m.id,
        text: `${m.name} · ${m.format === 'NATIVE' ? 'Nativa' : m.format} · ${maskPath(project, m.id)} · [${m.id}]`,
      })),
    [project],
  );
  const query = normalize(search);
  const chosen = options.find((o) => o.id === value);
  return (
    <div className={`mask-selector ${compact ? 'compact' : ''}`}>
      <input
        type="search"
        aria-label="Pesquisar máscaras do projeto"
        placeholder={
          compact ? 'Pesquisar…' : 'Pesquisar nome, origem ou contexto…'
        }
        title={compact ? 'Pesquisar por nome, origem ou contexto' : undefined}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        aria-label={label}
        value={value}
        // Long names are cut in the closed field; the full text stays in the
        // list and in this hint.
        title={
          compact ? (chosen?.text ?? 'Escolher máscara do projeto') : undefined
        }
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Escolher máscara do projeto ({options.length})</option>
        {options
          .filter((o) => o.id === value || normalize(o.text).includes(query))
          .map((o) => (
            <option value={o.id} key={o.id}>
              {o.text}
            </option>
          ))}
      </select>
    </div>
  );
}

function IconAction({
  label,
  hint,
  icon: Icon,
  onClick,
}: {
  label: string;
  hint: string;
  icon: IconComponent;
  onClick: () => void;
}) {
  const tip = useTooltip({ label: hint });
  return (
    <span className="ribbon-item-slot" {...tip.hover}>
      <button
        type="button"
        className="mask-destination-icon"
        aria-label={label}
        onClick={onClick}
        onFocus={tip.focus.onFocus}
        onBlur={tip.focus.onBlur}
        onKeyDown={tip.focus.onKeyDown}
      >
        <Icon size={17} strokeWidth={1.6} />
      </button>
    </span>
  );
}

/** Active mask and its protection, always as visible text. */
function MaskStatus({
  project,
  activeId,
  context,
  compact,
}: {
  project: Project;
  activeId?: string;
  context: MaskDrawingContext;
  compact?: boolean;
}) {
  const state = maskDrawingState(project, activeId, context);
  const name = state.mask
    ? `${state.mask.name} · ${state.path} · [${state.mask.id}]`
    : 'Nenhuma máscara ativa';
  const note =
    state.mask && state.mask.format !== 'NATIVE'
      ? 'Novos traços: desenho local; referência original preservada.'
      : '';
  const tone = !state.mask ? 'none' : state.editable ? 'editable' : 'protected';
  return (
    <div
      className={`mask-destination-status ${tone === 'editable' ? 'editable' : 'protected'} tone-${tone} ${compact ? 'compact' : ''}`}
      role="region"
      aria-live="polite"
      aria-label="Máscara ativa para desenhar"
      title={[name, state.label, note].filter(Boolean).join('\n')}
    >
      <i className="mask-status-dot" aria-hidden="true" />
      <strong>{name}</strong>
      <span>
        {/* The compact chip leads with the protection itself; the full label
            stays in the hint and in the expanded group. */}
        {compact && state.mask && !state.editable ? state.reason : state.label}
        {note ? ` · ${note}` : ''}
      </span>
    </div>
  );
}

export default function MaskDestination({
  project,
  activeId,
  context,
  onActivate,
  onCreate,
  onBatch,
  variant = 'group',
}: {
  project: Project;
  activeId?: string;
  context: MaskDrawingContext;
  onActivate: (id: string) => boolean;
  onCreate: () => void;
  onBatch: (mode: 'import' | 'associate') => void;
  variant?: MaskDestinationVariant;
}) {
  const [candidate, setCandidate] = useState(activeId ?? '');
  useEffect(() => setCandidate(activeId ?? ''), [activeId, project.id]);
  const reasonId = useId();
  if (variant === 'summary')
    return (
      <MaskStatus
        project={project}
        activeId={activeId}
        context={context}
        compact
      />
    );
  const valid = project.masks.some((m) => m.id === candidate);
  // Choosing in the list only marks a candidate; activation stays explicit.
  const reason = !project.masks.length
    ? 'Nenhuma máscara no projeto: use Nova máscara ou Importar.'
    : !valid
      ? 'Escolha uma máscara na lista para ativar.'
      : candidate === activeId
        ? 'A máscara escolhida já é a ativa.'
        : 'Ativar a máscara escolhida como destino dos novos traços.';
  return (
    <section
      className={`mask-destination ribbon-group-tools mask-destination-${variant}`}
      aria-label="Destino do desenho de máscaras"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <b className="mask-destination-title">Desenhar em</b>
      <MaskSelector
        project={project}
        value={candidate}
        onChange={setCandidate}
        compact
      />
      <button
        type="button"
        className="mask-destination-activate"
        aria-label="Ativar máscara para desenhar"
        aria-describedby={reasonId}
        title={reason}
        disabled={!valid}
        onClick={() => onActivate(candidate)}
      >
        Ativar
      </button>
      <span id={reasonId} className="sr-only">
        {reason}
      </span>
      {variant === 'group' && (
        <MaskStatus project={project} activeId={activeId} context={context} />
      )}
      <div className="mask-destination-actions">
        <IconAction
          label="Nova máscara"
          hint="Nova máscara"
          icon={NewMaskIcon}
          onClick={onCreate}
        />
        <IconAction
          label="Importar máscaras em lote"
          hint="Importar máscaras (DXF / DWG) em lote"
          icon={ImportMasksIcon}
          onClick={() => onBatch('import')}
        />
        <IconAction
          label="Associar máscaras do projeto"
          hint="Associar máscaras do projeto"
          icon={AssociateMasksIcon}
          onClick={() => onBatch('associate')}
        />
      </div>
    </section>
  );
}
