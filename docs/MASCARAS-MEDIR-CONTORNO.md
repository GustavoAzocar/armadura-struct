# Medir contorno de máscaras

**Máscaras → Ferramentas → Medir contorno** consulta o comprimento de um caminho aberto ou o perímetro e a área de um contorno fechado de uma entidade de máscara. É um modo do fluxo existente de **Medir**: o painel compartilha o seletor de operação com **Medir distância** e com as cotas, que continuam iguais. Também acessível pelo seletor compacto **Ferramentas CAD da máscara ativa** (Ribbon recolhido ou Foco) e pelos comandos `CONTORNO`, `PERIMETRO` ou `AREA`.

## Uso

1. Abra o desenho (modelo) e escolha **Medir contorno**.
2. Clique numa linha, polilinha, retângulo, arco ou círculo de uma máscara visível e capturável do detalhamento ativo, ou digite um ponto do modelo em mm no Comando CAD (ex.: `1500,0`). A entidade fica destacada e o painel mostra o resultado.
3. Caminho aberto: **Comprimento** acumulado; a área é indicada como não aplicável. Um caminho aberto nunca é fechado implicitamente, mesmo com extremidades coincidentes (o painel avisa).
4. Contorno fechado válido: **Perímetro** e **Área**.
5. Clique em outra entidade para repetir. **Esc**, Enter ou **Concluir** encerram.

Unidade (mm/cm/m; área em mm²/cm²/m²) e casas decimais (0–6) mudam somente o texto; os valores internos permanecem em ponto flutuante. Exemplo: retângulo 3.000 × 4.000 mm → perímetro 14000,00 mm / 14,00 m e área 12,00 m².

## Cálculo

O módulo `src/domain/maskContourMeasure.ts` é puro e separado da interface.

- Os pontos passam por `maskPoint`, a mesma transformação de máscara usada por desenho, snaps e cotas. Os valores são mm do modelo e não dependem de zoom, pan ou pixels. Escala da máscara multiplica comprimentos e áreas por k e k²; rotação e translação não mudam os valores.
- Linhas, polilinhas e retângulos nativos usam os vértices exatos. Círculos e arcos nativos usam raio e ângulo: perímetro 2πr, área πr² e comprimento de arco |θ|·r (cálculo analítico, sem discretização).
- Entidades importadas ou normalizadas (DXF/DWG, demonstração ou remanescentes não nativos) só possuem a polilinha mantida na importação. O resultado é dessa polilinha e o painel informa que corresponde à aproximação disponível; arcos, círculos, elipses e bulges originais não são reconstruídos.
- Área pela fórmula de Gauss (shoelace) relativa ao primeiro vértice, sempre em valor absoluto: inverter a ordem dos vértices não altera a área.
- Tolerâncias documentadas: segmentos com até 1e-6 mm são degenerados; contorno colinear ou com área ≤ 1e-9 × perímetro² é recusado; nos testes, resultados analíticos e transformados coincidem com a referência com erro relativo ≤ 1e-11.

## Validações e avisos

Nenhum número é apresentado, e o painel explica o motivo, quando houver:

- coordenadas não finitas ou fora de ±1.000.000.000 mm, transformação de máscara inválida ou dados nativos inválidos;
- segmento de comprimento nulo, menos de dois vértices distintos ou contorno fechado com menos de três vértices;
- contorno fechado colinear ou com área desprezível;
- contorno fechado com autointerseção, contato entre trechos não adjacentes ou trechos sobrepostos;
- texto ou entidade de um único ponto.

Num caminho aberto que cruza a si mesmo, o comprimento é apresentado (soma de todos os trechos) com aviso, porque não há área envolvida.

## Furos e múltiplos contornos

A seleção é sempre de **uma** entidade. A área é a do contorno selecionado; regiões internas, furos e outros contornos não são descontados nem somados. Para uma região com furos, meça cada contorno separadamente e combine os valores conscientemente. A área medida não é quantitativo de material nem verificação estrutural.

## Contexto, proteções e persistência

- Candidatos seguem as regras de visibilidade, captura, isolamento e detalhamento já usadas por Ajustar/Offset (`maskCadEntities`), restritos ao detalhamento ativo. Layers bloqueados mas capturáveis podem ser consultados; a consulta não habilita edição nem seleciona objetos.
- Trocar projeto, desenho, detalhamento/isolamento, máscara ativa ou ferramenta encerra a consulta e descarta a entidade escolhida; uma seleção de outro contexto não é reutilizada.
- A consulta é estado temporário da interface: não cria objetos, não entra no histórico de desfazer/refazer, não altera o estado de salvo/autosave, o formato do projeto, o quadro de aço, RA/CSV nem arquivos importados.
- Em uma folha, abra o desenho pela vista; não se mede em mm de papel.

## Validação

`tests/maskContourMeasure.test.ts` cobre retângulo 3.000 × 4.000, caminho 3.000 + 4.000, círculo r = 1.000, arco, rotação/translação/escala, unidade de origem, ordem dos vértices, fechamento repetido, extremidades coincidentes, autointerseção, degenerações, importado, candidatos e pureza. `tests/e2e/maskContourMeasure.spec.ts` cobre seleção por clique e coordenada, destaque, unidades, zoom/pan, repetição, aviso sem números, importado, cancelamento, histórico, salvamento/CSV, troca de ferramenta/máscara/projeto, layer bloqueado e Foco em 900×650. Capturas são publicadas no artefato **mask-contour-evidence** da CI.

## Contribuição

Funcionalidade contribuída por [NR-racond](https://github.com/NR-racond) no [PR #109](https://github.com/ricardocorsini/armadura-struct/pull/109). O crédito ao perfil do contribuidor é registrado explicitamente porque o commit original usou a identidade da ferramenta de assistência.
