import type { Point, Project } from '../domain/types';
import type { VertexEdit } from '../domain/vertices';
export type VertexSession = {
  project: Project;
  id: string;
  mode: 'insert' | 'extend' | 'remove';
  end: 'start' | 'end';
  edits: VertexEdit[];
  cursor?: Point;
  issue?: string;
};
export default function VertexPanel({
  value: s,
  onChange,
  count,
  onApply,
  onCancel,
  error,
  warnings,
}: {
  value: VertexSession;
  onChange: (s: VertexSession) => void;
  count: number;
  onApply: () => void;
  onCancel: () => void;
  error?: string;
  warnings: string[];
}) {
  return (
    <section
      className="transform-panel"
      aria-label="Edição de vértices"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="transform-heading">
        <b>Editar vértices</b>
        <span>{count} ponto(s) · prévia</span>
      </div>
      <label className="field">
        <span>Operação</span>
        <select
          aria-label="Operação de vértices"
          value={s.mode}
          onChange={(e) =>
            onChange({
              ...s,
              mode: e.target.value as VertexSession['mode'],
              cursor: undefined,
              issue: undefined,
            })
          }
        >
          <option value="insert">Inserir no segmento mais próximo</option>
          <option value="extend">Continuar pela ponta</option>
          <option value="remove">Remover o vértice mais próximo</option>
        </select>
      </label>
      {s.mode === 'extend' && (
        <label className="field">
          <span>Ponta</span>
          <select
            aria-label="Ponta de continuação"
            value={s.end}
            onChange={(e) =>
              onChange({
                ...s,
                end: e.target.value as 'start' | 'end',
                cursor: undefined,
                issue: undefined,
              })
            }
          >
            <option value="end">Final</option>
            <option value="start">Inicial</option>
          </select>
        </label>
      )}
      <p>
        {s.mode === 'extend'
          ? 'Clique ou digite as novas pontas; continue até Enter.'
          : s.mode === 'insert'
            ? 'Clique ou digite o ponto; ele entra no segmento mais próximo. Continue até Enter.'
            : 'Clique perto do vértice a remover. Continue até Enter.'}{' '}
        Coordenadas absolutas, @relativas e @distância&lt;ângulo são aceitas.
        Encaixes e Ortogonal continuam ativos.
      </p>
      <p>
        {s.edits.length} alteração(ões) pendente(s). A posição e os vínculos
        serão preservados.
      </p>
      {error && <p role="status">{error}</p>}
      {warnings.length > 0 && <p>{[...new Set(warnings)].join(' ')}</p>}
      <div className="visibility-actions">
        <button
          disabled={!s.edits.length}
          onClick={() =>
            onChange({ ...s, edits: s.edits.slice(0, -1), cursor: undefined })
          }
        >
          Desfazer vértice pendente
        </button>
        <button
          className="primary"
          disabled={!s.edits.length}
          onClick={onApply}
        >
          Concluir vértices
        </button>
        <button onClick={onCancel}>Cancelar vértices</button>
      </div>
    </section>
  );
}
