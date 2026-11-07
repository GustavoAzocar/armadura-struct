import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../domain/types';
import { format } from '../domain/geometry';
import { reviewInitialExample, initialExampleCsv } from '../examples/review';
import { saveFile } from '../lib/files';
export default function ExampleReviewDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const review = useMemo(() => reviewInitialExample(project), [project]);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState('all');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => old?.focus();
  }, []);
  const rows = review.rows.filter(
    (r) => sheet === 'all' || r.source.sheetKey === sheet,
  );
  return (
    <dialog
      ref={dialog}
      className="example-review"
      aria-labelledby="example-review-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="example-review-heading">
        <h2 id="example-review-title">Conferência · Exemplo ArmaduraStruct</h2>
        <button autoFocus onClick={onClose}>
          Fechar
        </button>
      </div>
      <p>
        Os quadros nas pranchas são referências dos DWGs. O quadro do editor é
        calculado pelas armaduras editáveis, sem acrescentar aço pelas vistas.
        Cotas de fôrma e de montagem permanecem referências CAD.
      </p>
      <p>
        <strong>
          {rows.filter((r) => r.quantityMatches && r.specMatches).length}/
          {rows.length} posições com quantidade e especificação conferidas.
        </strong>{' '}
        Comprimentos: {rows.filter((r) => r.lengthMatches).length}/{rows.length}{' '}
        dentro do arredondamento original de ±5 mm. As diferenças nas dobras
        estão expostas abaixo; não houve ajuste de comprimento para fechar a
        tabela.
      </p>
      {(review.untracked.length > 0 || review.errors.length > 0) && (
        <p className="warning-text">
          Há {review.untracked.length} ocorrência(s) nova(s) fora da referência
          e {review.errors.length} erro(s) de geometria. Esta conferência cobre
          os IDs originais.
        </p>
      )}
      <div className="example-review-heading">
        <label>
          Prancha{' '}
          <select value={sheet} onChange={(e) => setSheet(e.target.value)}>
            <option value="all">Todas</option>
            <option value="vigas">Vigas</option>
            <option value="pilares">Pilares</option>
          </select>
        </label>
        <button
          onClick={() => {
            void saveFile(
              'Conferencia-ArmaduraStruct.csv',
              initialExampleCsv(project),
              'text/csv;charset=utf-8',
              'csv',
            ).catch((e) => setError(String(e)));
          }}
        >
          Baixar conferência CSV
        </button>
      </div>
      <div className="example-review-table">
        <table>
          <thead>
            <tr>
              <th>Prancha / posição</th>
              <th>Atual</th>
              <th>Aço / Ø mm</th>
              <th>Qtd original / atual</th>
              <th>C original / atual (cm)</th>
              <th>Total original / atual (m)</th>
              <th>Conferência</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.source.key} data-review={r.source.key}>
                <td>
                  {r.source.sheetKey} · {r.source.sourceMark}
                </td>
                <td>{r.marks.join(' / ') || 'Removida'}</td>
                <td>
                  {r.source.steel} Ø{format(r.source.diameter)}
                  {!r.specMatches && (
                    <>
                      <br />
                      Atual: {r.specifications.join(' / ') || 'Removida'}
                    </>
                  )}
                </td>
                <td>
                  {r.source.quantity} / {r.quantity}
                </td>
                <td>
                  {format(r.source.cutLengthMm / 10, 1)} /{' '}
                  {r.cutLengthRangeMm
                    .map((c) => format(c / 10, 2))
                    .filter((c, i, a) => i === 0 || c !== a[0])
                    .join('–') || '—'}
                </td>
                <td>
                  {format(r.source.totalLengthMm / 1000, 2)} /{' '}
                  {format(r.totalLengthM, 2)}
                </td>
                <td>
                  {!r.specMatches
                    ? 'Especificação/ocorrência alterada'
                    : !r.quantityMatches
                      ? 'Quantidade alterada'
                      : r.lengthMatches
                        ? 'Confere (arred.)'
                        : 'Comprimento difere'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p role="alert">{error}</p>}
      <h3>Resumo por aço e bitola</h3>
      <p>
        “Peso + 10%” pertence ao original. A coluna com +10% aplica esse mesmo
        acréscimo à massa teórica atual, somente para comparar. Densidade do
        editor: 7.850 kg/m³; arredondamentos e coeficientes nominais do original
        também podem gerar diferenças.
      </p>
      <div className="example-review-table">
        <table>
          <thead>
            <tr>
              <th>Prancha</th>
              <th>Aço / Ø</th>
              <th>Original +10% (kg)</th>
              <th>Atual líquido (kg)</th>
              <th>Atual +10% (kg)</th>
              <th>Diferença (kg)</th>
            </tr>
          </thead>
          <tbody>
            {review.summaries
              .filter((s) => sheet === 'all' || s.source.key === sheet)
              .flatMap((s) =>
                s.rows.map((r) => (
                  <tr
                    key={`${s.source.key}-${r.original.steel}-${r.original.diameter}`}
                  >
                    <td>{s.source.key}</td>
                    <td>
                      {r.original.steel} / {r.original.diameter}
                    </td>
                    <td>
                      {r.newSpecification
                        ? 'Sem original'
                        : format(r.original.grossWeightKg, 2)}
                    </td>
                    <td>{format(r.weightKg, 2)}</td>
                    <td>{format(r.grossWeightKg, 2)}</td>
                    <td>
                      {r.newSpecification
                        ? '—'
                        : format(r.grossWeightKg - r.original.grossWeightKg, 2)}
                    </td>
                  </tr>
                )),
              )}
          </tbody>
        </table>
      </div>
      <p>
        V-/P- distinguem posições homônimas entre as duas pranchas; as chamadas
        omitem esse prefixo enquanto ele existir na marca. Editar uma ocorrência
        pode separá-la da posição de fabricação. Exemplo de detalhamento, sem
        dimensionamento estrutural.
      </p>
    </dialog>
  );
}
