import type { Point, Project } from '../domain/types';
import { weldedMeshLabel, type WeldedMeshCriteria } from '../domain/weldedMesh';
import type { WeldedMeshDraftPreview } from '../domain/weldedMeshDraft';
import type { RegionOutline } from '../domain/weldedMeshRegion';

/** Lançamento de tela em andamento; nada entra no projeto antes de confirmar. */
export type WeldedMeshSession = {
  base: Project;
  key: string;
  detailId: string;
  scope?: string;
  maskId?: string;
  c: WeldedMeshCriteria;
  mode: 'contour' | 'points';
  stage: 'region' | 'openings' | 'ready';
  /** Como as aberturas são indicadas: entidades fechadas ou pontos. */
  openingInput: 'entity' | 'points';
  outer?: RegionOutline;
  /** Entidade de máscara do contorno (chave estável), se veio de uma. */
  outerRef?: { key: string; maskId: string };
  openings: { outline: RegionOutline; ref?: string }[];
  /** Polígono sendo desenhado por pontos (contorno ou abertura). */
  points: Point[];
  cursor?: Point;
  /** Lacunas fechadas por ajuste confirmadas pelo usuário. */
  confirmed: boolean;
  issue?: string;
};

const num = (v: number, digits: number) =>
  v.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const m2 = (mm2: number) => `${num(mm2 / 1e6, 2)} m²`;

export default function WeldedMeshLaunchPanel({
  session: s,
  preview,
  onMode,
  onOpeningInput,
  onCriteria,
  onRemoveOpening,
  onConfirmGaps,
  onNext,
  onBack,
  onCancel,
  onConfirm,
}: {
  session: WeldedMeshSession;
  preview?: WeldedMeshDraftPreview;
  onMode: (m: WeldedMeshSession['mode']) => void;
  onOpeningInput: (v: WeldedMeshSession['openingInput']) => void;
  onCriteria: () => void;
  onRemoveOpening: (index: number) => void;
  onConfirmGaps: (v: boolean) => void;
  onNext: () => void;
  onBack: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const byPoints =
    (s.stage === 'region' && s.mode === 'points') ||
    (s.stage === 'openings' && s.openingInput === 'points');
  const prompt =
    s.stage === 'region'
      ? s.mode === 'contour'
        ? 'Clique numa entidade fechada da máscara: retângulo, polilinha fechada ou círculo.'
        : `Clique os vértices do contorno (${s.points.length} ponto(s)). Enter fecha; Backspace remove o último.`
      : s.stage === 'openings'
        ? byPoints
          ? `Abertura por pontos (${s.points.length} ponto(s)): Enter fecha a abertura. Sem pontos, Enter segue para a conferência.`
          : 'Aberturas (opcional): clique entidades fechadas dentro da região. Enter ou "Concluir aberturas" segue para a conferência.'
        : 'Confira a prévia. "Confirmar lançamento" ou Enter grava a tela.';
  const layout = preview?.ok ? preview.layout : undefined;
  const blocked = !!preview?.ok && preview.needsConfirmation && !s.confirmed;
  return (
    <section
      className="stirrup-launch-panel welded-mesh-launch-panel"
      aria-label="Lançamento de tela soldada"
    >
      <b>
        Tela soldada · {s.c.mark} · {weldedMeshLabel(s.c.mesh)}
      </b>
      <div className="welded-mesh-launch-modes">
        <nav aria-label="Modo da região">
          {(
            [
              ['contour', 'Contorno'],
              ['points', 'Pontos'],
            ] as const
          ).map(([mode, label]) => (
            <button
              type="button"
              key={mode}
              aria-pressed={s.mode === mode}
              disabled={s.stage !== 'region'}
              onClick={() => onMode(mode)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button type="button" onClick={onCriteria}>
          Critérios…
        </button>
      </div>
      <p role="status">{prompt}</p>
      {s.stage === 'openings' && (
        <nav
          aria-label="Entrada das aberturas"
          className="welded-mesh-launch-modes"
        >
          {(
            [
              ['entity', 'Por entidade'],
              ['points', 'Por pontos'],
            ] as const
          ).map(([v, label]) => (
            <button
              type="button"
              key={v}
              aria-pressed={s.openingInput === v}
              onClick={() => onOpeningInput(v)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      {s.openings.length > 0 && (
        <ul className="welded-mesh-openings" aria-label="Aberturas">
          {s.openings.map((o, i) => (
            <li key={i}>
              Abertura {i + 1} · {m2(o.outline.area)}{' '}
              <button
                type="button"
                aria-label={`Remover abertura ${i + 1}`}
                disabled={s.stage === 'ready'}
                onClick={() => onRemoveOpening(i)}
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}
      {layout && (
        <dl
          className="welded-mesh-launch-numbers"
          aria-label="Quantitativos da prévia"
        >
          <dt>Painéis-base</dt>
          <dd>
            {layout.basePanels} ({layout.fullPanels} inteiro(s),{' '}
            {layout.cutPieces} peça(s) recortada(s))
          </dd>
          <dt>Área útil</dt>
          <dd>{m2(layout.usefulArea)}</dd>
          <dt>Área aplicada</dt>
          <dd>{m2(layout.appliedArea)}</dd>
          <dt>Sobreposição</dt>
          <dd>{m2(layout.overlapArea)}</dd>
          <dt>Retalhos</dt>
          <dd>{m2(layout.wasteArea)}</dd>
          <dt>Massa aplicada</dt>
          <dd>{num(layout.appliedMass, 2)} kg</dd>
          <dt>Fornecimento</dt>
          <dd>{num(layout.supplyMass, 1)} kg</dd>
        </dl>
      )}
      {preview?.ok &&
        [...preview.notes, ...preview.layout.warnings].map((n) => (
          <small key={n} className="welded-mesh-note">
            {n}
          </small>
        ))}
      {preview?.ok && preview.needsConfirmation && (
        <fieldset className="welded-mesh-gaps">
          <legend>Lacunas fechadas por ajuste</legend>
          <ul>
            {preview.adjustments.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <label className="check">
            <input
              type="checkbox"
              checked={s.confirmed}
              onChange={(e) => onConfirmGaps(e.target.checked)}
            />
            Confirmo o fechamento das lacunas acima
          </label>
        </fieldset>
      )}
      {(s.issue || (preview && !preview.ok && s.stage !== 'region')) && (
        <p role="alert" className="stirrup-error">
          {s.issue || (preview && !preview.ok ? preview.reason : '')}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={onBack}>
          Voltar etapa
        </button>
        {s.stage === 'openings' && (
          <button type="button" disabled={!preview?.ok} onClick={onNext}>
            Concluir aberturas
          </button>
        )}
        <button type="button" onClick={onCancel}>
          Cancelar lançamento
        </button>
        <button
          type="button"
          className="primary"
          disabled={s.stage !== 'ready' || !preview?.ok || blocked}
          onClick={onConfirm}
        >
          Confirmar lançamento
        </button>
      </div>
    </section>
  );
}
