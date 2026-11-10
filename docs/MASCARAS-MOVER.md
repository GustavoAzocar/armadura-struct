# Mover entidades e máscaras

Em **Máscaras → Manipular → Mover**, escolha o alcance e desloque-o por uma única translação: seleção → ponto base → destino. O comando reutiliza a sessão, a seleção, a prévia e o histórico do grupo Manipular (Copiar, Apagar e Espelhar). Não há outro motor nem API de armaduras.

## Alcance

- **Entidades selecionadas da máscara ativa** (padrão): clique para acumular, clique de novo para retirar, ou use a lista com pesquisa. A pré-seleção do Controle de máscaras é aceita. Enter confirma o conjunto. Somente essas entidades mudam; origem, escala, rotação e associação da máscara permanecem. IDs, forma, tamanho, layers, estilos, linhagem (`sourceEntityId`) e dados analíticos (centro/raio, ângulos de arco, retângulo de dois cantos, texto e alinhamento) são preservados.
- **Máscara inteira (origem)**: escolha a opção no painel, ou **Mover máscara inteira (origem)** no Controle de máscaras. Somente `origin` é transladada. As primitivas locais ficam idênticas, então não há segundo deslocamento. A máscara inteira aparece destacada e o painel informa quantas entidades acompanham, inclusive em layers ocultos. Um layer bloqueado em qualquer entidade impede a operação.

O alcance aparece no painel ("alcance: N entidade(s)" ou "alcance: máscara inteira") e no destaque do canvas. Trocar o alcance limpa a seleção. Aço, outras máscaras e seleção residual de Elementos nunca são aproveitados.

## Pontos e entrada numérica

1. **Ponto base**: clique com encaixe ou digite `X,Y` no Comando CAD.
2. **Destino**: a prévia, o vetor desde a base e Δ = (dx; dy) mm acompanham o cursor, com encaixes e ortogonal existentes. Clique ou digite `X,Y`, `@dx,dy` ou `@distância<ângulo`, todos em mm do modelo.

O vetor global é convertido ao referencial local girado/escalado da máscara uma única vez (modelo → local). Não usa pixels, não altera escala nem rotação e não arredonda geometria para coincidir com o texto exibido. Base igual ao destino é neutra e não cria histórico.

Também disponível em **Ferramentas CAD da máscara ativa**, no Controle de máscaras e por `MOVERMASCARA` / `MMOVE`. `MOVER` usa este fluxo na aba Máscaras; `M`/`MOVE` continuam no Mover de Elementos.

## Integridade

- A prévia não altera o modelo, o autosave nem o arquivo salvo. Esc em qualquer etapa cancela. Trocar projeto, desenho, máscara, detalhamento/isolamento, perder o alvo ou alterar o snapshot cancela a sessão com aviso.
- Alvo, layers (oculto, sem captura, bloqueado), contexto e limites de coordenadas (±1e9 mm) são revalidados antes do commit. Enter ou cliques repetidos não duplicam a operação. O lote é atômico e desfazível/refazível.
- Cotas existentes continuam estáticas. Com referência verificada, passam a indicar divergência quando a geometria se move; não são arrastadas nem associadas parametricamente. Armaduras, posições, quantitativos, RA e CSV não mudam.
- Referências importadas são editadas somente na cópia local; o DXF/DWG original nunca é escrito.

## Persistência, saída e validação

Não há novo schema nem migração. Salvar/reabrir, recuperação, pacote de intercâmbio, canvas, pranchas, PDF e DXF reutilizam a representação existente das primitivas e da origem da máscara.

`tests/maskMove.test.ts` cobre Δ=(250,−50) em duas entidades com a terceira e o aço intactos, máscara girada 30° com escala 2 (entidades e máscara inteira), alcances distintos, arco/círculo/retângulo/polilinha/texto, operação neutra, pureza da prévia, divergência de cotas, proteções/contexto/limites e round-trip/intercâmbio/DXF/PDF/RA/CSV. `tests/e2e/maskMove.spec.ts` cobre o grupo Manipular, comando sem seleção, pré-seleção, seleção múltipla e retirada, Esc antes/depois da base, destino numérico, snap com resultado igual à prévia, máscara inteira, proteção, Undo/Redo, recuperação, troca de projeto e Foco em 900 × 650. As capturas `docs/mask-move-*.png` são publicadas no artefato **mask-move-evidence** da CI.
