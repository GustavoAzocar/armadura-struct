import type { DrawingStyle, LayerBinding, Project } from '../domain/types';
import { layerId, LINE_TYPES, resolveStyle } from '../domain/layers';
import { NumberField } from './Panels';
export default function LayerInspector({
  project,
  object,
  role,
  onChange,
}: {
  project: Project;
  object: LayerBinding & { color?: string };
  role: string;
  onChange: (patch: LayerBinding) => void;
}) {
  const current =
      project.layers.find((l) => l.id === (object.layerId ?? layerId(role))) ??
      project.layers[0],
    style = resolveStyle(project, object, role);
  const baseStyle = {
    ...(!object.layerId && object.color ? { color: object.color } : {}),
    ...object.style,
  };
  const set = (patch: Partial<DrawingStyle>) =>
    onChange({ layerId: current.id, style: { ...baseStyle, ...patch } });
  return (
    <div className="layer-inspector">
      <label className="field">
        <span>Layer</span>
        <select
          aria-label="Layer do objeto"
          value={current.id}
          onChange={(e) =>
            onChange({ layerId: e.target.value, style: baseStyle })
          }
        >
          {project.layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Cor</span>
        <select
          aria-label="Herança de cor"
          value={
            object.style?.color || (!object.layerId && object.color)
              ? 'override'
              : 'layer'
          }
          onChange={(e) => {
            const next = { ...baseStyle };
            if (e.target.value === 'layer') delete next.color;
            else next.color = style.color;
            onChange({ layerId: current.id, style: next });
          }}
        >
          <option value="layer">ByLayer</option>
          <option value="override">Override</option>
        </select>
      </label>
      {(object.style?.color || (!object.layerId && object.color)) && (
        <input
          type="color"
          aria-label="Override de cor"
          value={style.color}
          onChange={(e) => set({ color: e.target.value })}
        />
      )}
      <label className="field">
        <span>Linha</span>
        <select
          aria-label="Linha do objeto"
          value={
            object.style?.lineType ? JSON.stringify(object.style.lineType) : ''
          }
          onChange={(e) => {
            const next = { ...baseStyle };
            if (e.target.value) next.lineType = JSON.parse(e.target.value);
            else delete next.lineType;
            onChange({ layerId: current.id, style: next });
          }}
        >
          <option value="">ByLayer</option>
          {object.style?.lineType &&
            !LINE_TYPES.some(
              (l) =>
                JSON.stringify(l) === JSON.stringify(object.style?.lineType),
            ) && (
              <option value={JSON.stringify(object.style.lineType)}>
                {object.style.lineType.name}
              </option>
            )}
          {LINE_TYPES.map((l) => (
            <option key={l.name} value={JSON.stringify(l)}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <p className="field-help">
        Espessura:{' '}
        {object.style?.lineWidth === undefined ? 'ByLayer' : 'override'} ·
        Escala: {object.style?.lineScale === undefined ? 'ByLayer' : 'override'}
      </p>
      <NumberField
        label="Override de espessura"
        value={style.lineWidth}
        min={0}
        max={2.11}
        suffix="mm"
        onChange={(lineWidth) => set({ lineWidth })}
      />
      <NumberField
        label="Override de escala de linha"
        value={style.lineScale}
        min={0.000001}
        max={10000}
        onChange={(lineScale) => set({ lineScale })}
      />
      <label className="field">
        <span>Preenchimento</span>
        <select
          aria-label="Preenchimento do objeto"
          value={object.style?.fill ?? ''}
          onChange={(e) => {
            const next = { ...baseStyle };
            if (e.target.value)
              next.fill = e.target.value as DrawingStyle['fill'];
            else delete next.fill;
            onChange({ layerId: current.id, style: next });
          }}
        >
          <option value="">ByLayer</option>
          <option value="none">Sem preenchimento</option>
          <option value="solid">Sólido</option>
        </select>
      </label>
      <label className="field">
        <span>Cor do preenchimento</span>
        <select
          aria-label="Herança da cor de preenchimento"
          value={object.style?.fillColor ? 'override' : 'layer'}
          onChange={(e) => {
            const next = { ...baseStyle };
            if (e.target.value === 'layer') delete next.fillColor;
            else next.fillColor = style.fillColor;
            onChange({ layerId: current.id, style: next });
          }}
        >
          <option value="layer">ByLayer</option>
          <option value="override">Override</option>
        </select>
      </label>
      {object.style?.fillColor && (
        <input
          type="color"
          aria-label="Override da cor de preenchimento"
          value={object.style.fillColor}
          onChange={(e) => set({ fillColor: e.target.value })}
        />
      )}
      <button onClick={() => onChange({ layerId: current.id, style: {} })}>
        Restaurar estilo ByLayer
      </button>
    </div>
  );
}
