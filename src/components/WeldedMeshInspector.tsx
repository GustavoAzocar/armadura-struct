import { formatSteelArea, weldedMeshLabel } from '../domain/weldedMesh';
import {
  weldedMeshPlan,
  type WeldedMeshLaunch,
} from '../domain/weldedMeshLaunch';

const num = (v: number, digits: number) =>
  v.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const m2 = (mm2: number) => `${num(mm2 / 1e6, 2)} m²`;
const MODES = { contour: 'Contorno', click: 'Clique', points: 'Pontos' };

/**
 * Resumo de uma tela lançada no painel Propriedades. Os números são
 * recalculados do lançamento (mesma função do quadro); editar critérios ou
 * região é sempre uma ação explícita, com prévia antes × depois.
 */
export default function WeldedMeshInspector({
  mesh: l,
  onCriteria,
  onRegion,
}: {
  mesh: WeldedMeshLaunch;
  onCriteria: () => void;
  onRegion: () => void;
}) {
  const plan = weldedMeshPlan(l),
    c = l.criteria;
  return (
    <div className="welded-mesh-inspector">
      <div className="object-heading">
        <span>{c.mark}</span>
        <div>
          <b>Tela soldada · {weldedMeshLabel(c.mesh)}</b>
          <small>
            Região por {MODES[l.source.mode].toLowerCase()} ·{' '}
            {l.region.openings.length} abertura(s)
          </small>
        </div>
      </div>
      {plan.ok ? (
        <dl
          className="welded-mesh-launch-numbers"
          aria-label="Quantitativos da tela"
        >
          <dt>Painéis-base</dt>
          <dd>
            {plan.layout.basePanels} ({plan.layout.cutPieces} peça(s)
            recortada(s))
          </dd>
          <dt>Área útil</dt>
          <dd>{m2(plan.layout.usefulArea)}</dd>
          <dt>Área aplicada</dt>
          <dd>{m2(plan.layout.appliedArea)}</dd>
          <dt>Massa aplicada</dt>
          <dd>{num(plan.layout.appliedMass, 2)} kg</dd>
          <dt>Fornecimento</dt>
          <dd>{num(plan.layout.supplyMass, 1)} kg</dd>
          <dt>Orientação</dt>
          <dd>{num(c.orientation, c.orientation % 1 ? 1 : 0)}°</dd>
          <dt>Aço</dt>
          <dd>
            {formatSteelArea(c.mesh.longitudinal.steelArea)} ×{' '}
            {formatSteelArea(c.mesh.transverse.steelArea)}
          </dd>
        </dl>
      ) : (
        <p className="inline-warning" role="alert">
          {plan.reason}
        </p>
      )}
      {plan.ok &&
        plan.layout.warnings.map((w) => (
          <small key={w} className="welded-mesh-note">
            {w}
          </small>
        ))}
      <div className="welded-mesh-launch-modes">
        <button type="button" onClick={onCriteria}>
          Editar critérios…
        </button>
        <button type="button" onClick={onRegion}>
          Redefinir região…
        </button>
      </div>
      <small className="welded-mesh-note">
        Editar mostra antes × depois e não muda os critérios dos próximos
        lançamentos.
      </small>
    </div>
  );
}
