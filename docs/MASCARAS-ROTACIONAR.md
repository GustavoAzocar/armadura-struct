# Rotacionar entidades de máscaras

Em **Máscaras → Manipular → Rotacionar**, selecione entidades da máscara ativa por clique ou pela lista; outro clique retira. A pré-seleção do Controle de máscaras é aceita. Aço e seleção de máscara inteira não são reaproveitados. Enter confirma o conjunto.

1. Escolha o **ponto base** por clique/snap ou coordenadas no Comando CAD. Coordenadas absolutas, `@dx,dy` e `@distância<ângulo` reutilizam as entradas existentes, em mm do modelo.
2. Defina o **ângulo**, em graus, positivo no sentido anti-horário:
   - clique a direção a partir da base: a prévia e o guia do canvas acompanham o cursor e o clique fixa o ângulo; ou
   - digite o valor no campo **Ângulo da rotação** do painel ou no Comando CAD (`90`, `-45`, `12.5`). No Comando CAD o decimal usa ponto, porque a vírgula separa coordenadas; no campo do painel a vírgula também é aceita.
3. **Referência** (botão do painel, `R` ou `REF` no Comando CAD): clique dois pontos de uma direção existente e depois a nova direção, por clique ou valor digitado. A rotação é a diferença entre as duas direções. Referência com pontos a menos de 0,01 mm é recusada.
4. Na etapa **Confirmar rotação**, o painel mostra o ângulo e o sentido (`90° · anti-horário`). Digitar outro valor substitui o ângulo, sem somar. Clique **Confirmar rotação** ou Enter. Uma operação no histórico contém o lote inteiro. Enter/cliques repetidos não repetem a operação. Esc em qualquer etapa cancela a preparação; a prévia nunca modifica o arquivo salvo ou autosave.

Rotacionar sempre substitui as entidades escolhidas **no lugar, preservando IDs e linhagem**; não há pergunta sobre manter os originais (para uma cópia girada, use Copiar e depois Rotacionar). A máscara inteira permanece. Ângulos equivalentes a uma volta completa (0°, ±360°, 720°…) são neutros: nada é alterado, nada entra no histórico e o painel informa a operação neutra. Ângulos são aceitos até ±360000°.

Também disponível em **Ferramentas CAD da máscara ativa**, no Controle de máscaras e por `ROTATE` / `ROTACIONARMASCARA`. `ROTACIONAR` e `GIRAR` usam este fluxo na aba Máscaras e conservam o Rotacionar de Elementos nas demais abas. Durante a etapa do ângulo, `R` inicia a Referência; fora dela, `R` mantém o comando existente. O grupo Manipular mantém a ordem Mover, Espelhar, Rotacionar, Copiar, Apagar; Mover continua desabilitado.

A transformação reutiliza `transformPoint`/validação de `transforms.ts` (`kind: 'rotate'`), composta modelo → máscara local. Como a escala da máscara é sempre positiva, a rotação no modelo é a mesma rotação no sistema local, para qualquer origem, escala e rotação da máscara. Não usa caixa envolvente nem pixels. Coordenadas não finitas/fora de ±1e9 mm, ângulo não finito, resultado inviável, entidades removidas, layers ocultos/sem captura/bloqueados e contexto incompatível são recusados antes do commit. Trocar projeto, desenho, máscara, detalhamento/isolamento ou alterar o snapshot cancela a sessão. Não escreve no DXF/DWG original.

## Guia no canvas

Durante o ângulo, o canvas mostra a base (círculo com cruz), a direção inicial tracejada (+X ou a Referência), a direção girada, o arco do ângulo com seta no sentido do giro e o valor em graus. Na etapa Referência, um segmento tracejado acompanha o cursor a partir do primeiro ponto. O guia tem tamanho constante na tela e desenha no máximo uma volta. Sua geometria é calculada por `src/cad/rotationGuide.ts`, função pura testada à parte.

## Geometria, texto e vínculos

- Linhas/polilinhas giram todos os vértices, mantendo fechamento e ordem. Círculo conserva o raio e gira o centro. Arco gira centro e ângulo inicial e conserva a abertura analítica e o sentido. Cache gráfico é recomposto pelo contrato existente.
- Retângulos conservam o contrato de dois cantos quando ele representa exatamente os vértices girados na mesma ordem (por exemplo, 180°). A 90°, 270° e em ângulos oblíquos, a ordem dos cantos deixa de corresponder ao contrato e o retângulo fica como polilinha fechada de **quatro vértices exatos**, com o mesmo ID, sem amostrar a borda. A política é informada no painel antes de aplicar e é a mesma do Espelhar.
- Texto importado tem âncora girada e orientação somada ao ângulo, normalizada em (−180°, 180°]. Conteúdo, altura e alinhamento permanecem.
- Cotas externas à máscara usam pontos estáticos e ficam intactas; o painel pede revisão explícita. Cotas importadas são suas primitivas normalizadas: selecione os segmentos e textos pretendidos. Armaduras lançadas sobre referências não são regeneradas nem alteradas.
- IDs, layers, estilos, origem, unidade, escala, rotação da máscara, aço, marcas, quantitativos, RA e CSV permanecem fora do alcance da operação. Outras máscaras e entidades não selecionadas permanecem intactas.

## Persistência, saída e validação

Não há novo schema/migração: salvar/reabrir, recuperação e intercâmbio reutilizam os contratos de primitivas existentes. Canvas, pranchas, PDF e DXF usam a representação compartilhada; círculos/arcos seguem a amostragem de saída descrita em [Espelhar](MASCARAS-ESPELHAR.md#persistência-saída-e-validação), e os dados analíticos permanecem no projeto. Não há nova exportação DWG.

`tests/maskRotate.test.ts` cobre o critério da issue (linha (10,10)–(110,10), base (10,10), +90° → (10,10)–(10,110)), −90° e ida e volta, ângulos neutros, máscara transformada, arco/círculo, retângulo a 30°/90°/180°, Referência, texto, pureza da prévia, IDs, persistência, PDF/DXF, rejeições e o cálculo do ângulo por cursor, valor digitado e Referência. `tests/rotationGuide.test.ts` cobre o guia (sentido do arco e da seta, referência arbitrária, limite de uma volta). `tests/e2e/maskRotate.spec.ts` cobre o critério da issue pelo painel, prévia pura, IDs, aço/cotas/CSV intactos, Enter repetido, desfazer/refazer, recarga, −90° pelo Comando CAD, 360° neutro, Esc em todas as etapas, ângulo inválido, Referência degenerada, troca de projeto, pré-seleção, ângulo por clique com guia, Referência, máscara transformada com texto/círculo/retângulo e Foco em 900 × 650. A regressão inclui Espelhar, Copiar/Apagar e os demais comandos existentes.

Execute `npm run check`, `npm run build`, `npm run format:check` e `npm run test:e2e`. As capturas sintéticas de guia, confirmação, Referência e Foco são geradas pelos E2E e publicadas no artefato **mask-rotate-evidence** da CI. Sem release, dependências, serviços ou telemetria novos.
