import type { Project } from '../domain/types';
import { detailMaskReferences } from '../domain/maskReferences';
import { MaskSelector } from './MaskDestination';

/** This changes presentation only; it never activates a CAD editing target. */
export default function DetailMaskSelector({
  project,
  detailId,
  onChange,
  onOrigin,
}: {
  project: Project;
  detailId: string;
  onChange: (id: string, action: 'show' | 'hide' | 'replace') => void;
  onOrigin: (id: string) => void;
}) {
  if (project.masks.length === 0) return null;
  const state = detailMaskReferences(project, detailId);
  return (
    <div
      className="detail-mask-selector"
      role="region"
      aria-label="Máscaras do detalhamento"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <b>Máscaras do detalhamento</b>
      <MaskSelector
        project={project}
        value={state.currentMaskId ?? ''}
        label="Trocar referência atual"
        compact
        onChange={(id) => {
          if (id) onChange(id, 'replace');
        }}
      />
      <details>
        <summary>
          Visíveis ({state.items.filter((i) => i.visible).length})
        </summary>
        <div className="detail-mask-list">
          {project.masks.map((m) => (
            <div key={m.id}>
              <label>
                <input
                  type="checkbox"
                  aria-label={`Exibir ${m.name}`}
                  checked={
                    !!state.items.find((i) => i.maskId === m.id)?.visible
                  }
                  onChange={(e) =>
                    onChange(m.id, e.target.checked ? 'show' : 'hide')
                  }
                />
                {m.name}
                {state.currentMaskId === m.id ? ' · atual' : ''}
              </label>
              <button
                type="button"
                aria-label={`Selecionar origem de ${m.name}`}
                onClick={() => onOrigin(m.id)}
              >
                Origem…
              </button>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
