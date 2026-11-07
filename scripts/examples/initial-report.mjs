import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const s = await createServer({
  root,
  server: { middlewareMode: true },
  appType: 'custom',
});
try {
  const { initialExampleProject } = await s.ssrLoadModule(
    '/src/examples/initial.ts',
  );
  const { reviewInitialExample, initialExampleCsv, initialReference } =
    await s.ssrLoadModule('/src/examples/review.ts');
  const { detailPackageSchema } = await s.ssrLoadModule(
    '/src/domain/detailPackage.ts',
  );
  const schema = z.toJSONSchema(detailPackageSchema);
  schema.properties.schema = { type: 'string', const: 'openstruct.detail/6' };
  await writeFile(
    root + '/docs/openstruct-detail-v6.schema.json',
    await format(JSON.stringify(schema), { parser: 'json' }),
  );
  const p = await initialExampleProject(),
    review = reviewInitialExample(p);
  await writeFile(
    root + '/docs/examples/initial/Conferencia-ArmaduraStruct.csv',
    initialExampleCsv(p),
  );
  let md = `# Conferência das pranchas originais\n\nQuantidades: **64/64** posições, **1.181 peças**. Comprimentos unitários: **30/64** compatíveis com o arredondamento de ±5 mm; **34/64** divergem. Nenhum comprimento foi modificado para fechar a relação original. Dados calculados pelo domínio, sem RA bloqueada.\n\n| Prancha | Posição | Ø mm | Qtd original/atual | C original (cm) | C desenvolvido (cm) | Δ total (m) | Conferência |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n`;
  for (const r of review.rows)
    md += `| ${r.source.sheetKey} | ${r.source.sourceMark} → ${r.marks.join('/')} | ${r.source.diameter} | ${r.source.quantity}/${r.quantity} | ${r.source.cutLengthMm / 10} | ${(r.cutLengthRangeMm[0] / 10).toFixed(3)} | ${r.deltaLengthM.toFixed(3)} | ${r.lengthMatches ? 'Arredondamento compatível' : 'Comprimento diverge'} |\n`;
  md += `\n## Massa calculada e resumo original\n\n| Prancha | Aço/bitola | Original +10% (kg) | Atual líquido (kg) | Atual +10% (kg) | Δ na mesma base (kg) |\n| --- | --- | --- | --- | --- | --- |\n`;
  for (const s of review.summaries)
    for (const r of s.rows)
      md += `| ${s.source.key} | ${r.original.steel} Ø${r.original.diameter} | ${r.original.grossWeightKg.toFixed(2)} | ${r.weightKg.toFixed(2)} | ${r.grossWeightKg.toFixed(2)} | ${(r.grossWeightKg - r.original.grossWeightKg).toFixed(2)} |\n`;
  md += `\nTotais líquidos: **vigas 673,189 kg**, **pilares 394,190 kg**, **total 1.067,380 kg**. Aplicando 10% apenas para a comparação: **740,508 kg** e **433,609 kg**; o original informa **733,8 kg** e **430,3 kg**. Diferença total na mesma base: **+10,017 kg (0,86%)**.\n\nO quadro nativo calcula comprimentos no eixo, com arcos e mandris extraídos dos traçados. O C impresso no original não coincide com esse desenvolvimento em todas as peças. Exemplos: V-N1, estribo com C impresso de 97 cm e desenvolvimento de 101,247 cm; V-N39, C de 302 cm e desenvolvimento de 304,459 cm. O DWG é uma representação 2D: ele não declara a regra de desconto de fabricação utilizada pelo produtor. Não se atribuiu automaticamente uma causa normativa a essas diferenças. Os 10% e os arredondamentos dos coeficientes de massa são separados da divergência de geometria.\n\n## Rastreabilidade\n\n`;
  for (const source of initialReference.sources)
    md += `- **${source.file}**: SHA-256 \`${source.sha256}\`. Uma unidade de composição CAD equivale a 10 mm no papel.\n`;
  md += `\nO manifesto [initial-reference.json](../../../src/examples/initial-reference.json) contém os handles das linhas da RA, chamadas e trechos usados em cada ocorrência. Vigas: escala longitudinal 1:50, seções/estribos 1:25. Pilares: longitudinal 1:25 e seções/estribos/grampos 1:20. Os cabeçalhos INSUNITS dos DWGs declaram mm, mas a composição usa essa convenção de plotagem; por isso a reconstrução é explícita e restrita a estes arquivos. Linhas CAD arbitrárias não geram armaduras automaticamente.\n`;

  await writeFile(
    root + '/docs/examples/initial/CONFERENCIA.md',
    await format(md, { parser: 'markdown' }),
  );
} finally {
  await s.close();
}
