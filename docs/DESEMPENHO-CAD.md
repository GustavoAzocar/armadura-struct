# Fluidez do CAD — investigação de 08/11/2026

## Ambiente e procedimento

Base: ArmaduraStruct **0.3.0**, `master` em `4b25f9e773c47e10c5722b5da0aaaed42ba6e77e`. Medições no **build de produção** Vite, com source maps para atribuição do perfil, e não no servidor de desenvolvimento/React StrictMode. A versão corrigida é a do commit que acrescenta este relatório.

Ambiente: Linux x86-64, kernel 6.18.57; CPU exposta AMD EPYC 9V74, 9 processadores lógicos; 9,7 GiB de memória; Node 24.22.1; Chromium headless 141.0.7390.37; viewport 1600 × 1000. Uma consulta CDP `SystemInfo.getInfo` ao mesmo executável/parâmetros confirmou **SwiftShader**, com composição/rasterização de GPU em modo software. O roteiro passou a registrar esse dado em novos ensaios. É um ambiente de teste compartilhado, não o computador do usuário. Não foram utilizados os DWGs enviados em outras tarefas: o exemplo incorporado e a cena sintética bastam para reproduzir o problema.

| Cena               | Barras físicas/ocorrências | Representações | Máscaras | Entidades da máscara | Pontos da máscara | Elementos SVG |
| ------------------ | -------------------------: | -------------: | -------: | -------------------: | ----------------: | ------------: |
| Vazio              |                          0 |              0 |        0 |                    0 |                 0 |             5 |
| Exemplo inicial    |                        108 |            108 |        2 |                3.329 |            17.218 |         2.913 |
| Maior, sintética   |                        400 |            400 |        1 |               20.000 |            40.000 |         5.127 |
| Maior, sem máscara |                        400 |            400 |        0 |                    0 |                 0 |         5.125 |

As 108 ocorrências do exemplo não são 108 posições de fabricação. O quadro continua consolidando as posições existentes. A cena maior ocupa aproximadamente 2,55 MB serializados, e a variante sem máscara, 0,39 MB.

`tests/performanceScene.ts` define IDs de barras/inserções e dimensões fixos: 400 peças livres/estribos em malha, uma inserção girada e reduzida por peça e uma referência DXF sintética de 20 mil segmentos. A mesma cena alimenta o benchmark e a regressão funcional. Não há redução de precisão, amostragem adicional ou limitação artificial do snap.

`scripts/cad-benchmark.mjs` importa cada cena, ativa o modelo **Desenho**, enquadra e espera a importação, fontes e autosave. Usa Playwright com entradas de mouse, CDP Performance/CPU Profiler a 1 ms, `requestAnimationFrame` e `PerformanceObserver`. Registra três séries de 60 entradas por ação: cursor com/sem encaixes, pan, zoom e janela de seleção. Séries adicionais de 12 entradas cobrem clique, arraste de vértice com confirmação/desfazer e alternância entre modelo/desenho. Zoom alterna os mesmos incrementos; os percursos e os estados iniciais são iguais nas duas versões. Não se executam testes/builds em paralelo com as séries comparativas.

As estatísticas são de interação, não de inicialização. `frameMs` mede intervalos entre callbacks de animação; `inputToTwoFramesMs` mede até dois callbacks depois da entrada, uma aproximação da resposta visual, não uma medição de fótons na tela. `ScriptDuration` é tempo de execução JavaScript no renderer, não uso total de CPU ou tempo de pintura. O p95 da tabela é a mediana dos p95 das três séries. Picos e tarefas longas ficam registrados nos resultados detalhados; não se promete uma taxa de quadros constante.

## Diagnóstico confirmado e correções

1. **Formatação repetida no caminho do ponteiro.** Na cena grande, a segunda série de cursor sem snap atribuiu aproximadamente **1.620 ms** de amostras a `geometry.ts`, na chamada `toLocaleString`, de cerca de **2.431 ms** de execução JS. A mesma apresentação era reconstruída mesmo com o projeto inalterado. `format()` agora reutiliza `Intl.NumberFormat` por precisão, com cache limitado a 32 entradas, mantendo a localidade, arredondamento e validação.
2. **Reconstrução da apresentação SVG.** Cada movimento de cursor/pan reconstruía descrições, primitivas das inserções, caminhos e árvores React. `CadCanvas.tsx` prepara essas apresentações com base no projeto e reutiliza os elementos SVG enquanto só a câmera/cursor muda. O zoom continua atualizando espessuras/alças em pixels, sem modificar alturas de texto ou geometria. Prévia, seleção e arraste continuam separados e imediatos.
3. **Busca de permissão por entidade da máscara.** O perfil de troca de desenho mostrou o filtro `linework` e `objectRole` dominando o tempo JS. Cada uma das 20 mil entidades repetia a resolução da mesma máscara, inclusive buscas nas 400 barras e 400 inserções. O estado de captura agora é resolvido uma vez por máscara e reutilizado em snapping, seleção e Seguir fôrma. O projeto e o contexto da vista invalidam esse resultado; os estados dos layers internos continuam sendo consultados individualmente.

O cursor já atualizava a leitura de coordenadas diretamente, sem mudar o estado global do App. O autosave não gravou durante navegação sem edição nos ensaios; não foi alterado. Snapping e hit testing mantêm os pontos, tolerâncias e ordem de escolha existentes. Nenhum dado físico, contrato de arquivo ou schema foi modificado.

## Resultados

| Cena/ação                             | Quadro p95 antes → depois (ms) | JS por série antes → depois (ms) |
| ------------------------------------- | -----------------------------: | -------------------------------: |
| Vazio — Cursor com snap               |                    16,7 → 16,7 |                      33,1 → 34,1 |
| Vazio — Cursor sem snap               |                    16,8 → 16,8 |                      31,3 → 28,1 |
| Vazio — Pan                           |                    16,8 → 16,8 |                      38,4 → 30,7 |
| Vazio — Zoom                          |                    16,8 → 16,7 |                      38,4 → 31,8 |
| Vazio — Janela de seleção             |                    16,7 → 16,8 |                      42,7 → 33,0 |
| Exemplo — Cursor com snap             |                    33,4 → 16,8 |                     599,6 → 96,5 |
| Exemplo — Cursor sem snap             |                    16,8 → 16,8 |                     507,0 → 26,5 |
| Exemplo — Pan                         |                    33,4 → 33,3 |                     544,1 → 34,5 |
| Exemplo — Zoom                        |                    33,4 → 33,4 |                    563,2 → 278,8 |
| Exemplo — Janela de seleção           |                    16,7 → 16,8 |                    624,9 → 115,3 |
| Maior + máscara — Cursor com snap     |                    83,3 → 50,0 |                  2.631,9 → 262,7 |
| Maior + máscara — Cursor sem snap     |                    66,7 → 16,7 |                   2.431,3 → 35,5 |
| Maior + máscara — Pan                 |                  100,0 → 116,6 |                   3.348,2 → 51,1 |
| Maior + máscara — Zoom                |                    66,7 → 33,4 |                  2.595,4 → 568,2 |
| Maior + máscara — Janela de seleção   |                    50,0 → 49,9 |                  2.790,3 → 268,6 |
| Maior sem máscara — Cursor com snap   |                    66,7 → 16,8 |                   2.458,4 → 76,3 |
| Maior sem máscara — Cursor sem snap   |                    66,7 → 16,8 |                   2.548,0 → 33,8 |
| Maior sem máscara — Pan               |                    66,7 → 16,7 |                   2.692,7 → 37,7 |
| Maior sem máscara — Zoom              |                    66,7 → 33,4 |                  2.601,2 → 513,2 |
| Maior sem máscara — Janela de seleção |                    33,4 → 16,8 |                   2.572,1 → 79,4 |

Na cena grande, a mediana do quadro durante cursor com snap passou de **66,7 ms para 33,3 ms**. No vazio, as diferenças são da ordem da variação do ensaio, sem ganho perceptível esperado. No exemplo, o tempo JS caiu bastante, mas o p95 do zoom/pan ficou próximo em algumas séries.

O pan com máscara densa apresentou **100,0 → 116,6 ms** de p95 no roteiro completo, apesar da queda de tempo JS. Para conferir a variação, repetimos isoladamente a mesma ação em ordem antes/depois, sem build ou teste simultâneo: **116,6 → 99,9 ms** de p95 e **3.569,3 → 42,5 ms** de JS por série. A mediana do quadro foi **83,3 → 66,7 ms** nesse controle. Os dados estão em [pan antes](performance/cad-pan-before.json) e [pan depois](performance/cad-pan-after.json). Isso não demonstra pan fluido a 60 Hz nessa referência extrema: o custo restante é compatível com o pipeline gráfico SVG e varia no ambiente. A contagem de tarefas longas no pan também não caiu; não é usada isoladamente como prova de melhora.

| Cena maior — edição (12 ações por série) | Mediana do comando automatizado antes → depois (ms) | JS por série antes → depois (ms) | Maior intervalo de quadro, mediana das séries (ms) |
| ---------------------------------------- | --------------------------------------------------: | -------------------------------: | -------------------------------------------------: |
| Seleção por clique                       |                                        101,6 → 24,1 |                  1.132,4 → 182,1 |                                      150,0 → 116,7 |
| Arraste/confirmar vértice                |                                         66,3 → 27,1 |                  1.563,3 → 250,8 |                                      933,3 → 149,9 |
| Alternar modelo/desenho                  |                                     1.084,8 → 256,3 |               11.364,8 → 1.408,6 |                                      983,3 → 150,0 |

O tempo do comando inclui a automação e sua espera; não equivale à latência nativa do mouse. A série de vértice inclui a confirmação final, e o desfazer ocorre fora da medição. Seu p95 de quadro isolado aumentou de 50,0 para 116,6 ms, enquanto o maior intervalo e a duração dos comandos caíram: o ensaio ficou mais curto e contém menos quadros de espera. Por isso também publicamos os tempos de comando, execução JS e o maior intervalo, sem interpretar um único percentil como taxa de quadros garantida.

Resultados detalhados: [navegação antes](performance/cad-before.json), [navegação depois](performance/cad-after.json), [edição antes](performance/cad-editing-before.json) e [edição depois](performance/cad-editing-after.json). Cada arquivo contém as três séries, dimensões das cenas, tempos, tarefas longas e os principais pontos do perfil CPU.

## Reprodução

Depois de `npm ci`, com Chromium do Playwright instalado:

```bash
npm run build -- --sourcemap
npm run perf:cad -- --label=depois --output=test-results/cad-depois.json
npm run perf:cad -- --label=edicao --scene=large --actions=click,grip,switch-drawing --samples=12 --output=test-results/cad-edicao.json
```

`ARMSTRUCT_CHROMIUM=/caminho/para/chromium` seleciona um executável existente. Sem `--url`, o script inicia e fecha seu próprio servidor de produção. `--url` permite medir explicitamente outro servidor, incluindo desenvolvimento, mas seus resultados devem ser identificados separadamente. `--scene` restringe a cena, `--actions` restringe ações, `--repeats` altera as repetições e `--dist=/caminho/para/build-antigo` permite usar o mesmo roteiro/fixture contra um build anterior. Não é necessário adicionar dependências.

Para comparar novamente com a base, compile `4b25f9e` em um worktree separado com `npm run build -- --sourcemap`. Execute o roteiro atual com `--dist` apontando para esse `dist` e depois para o build atual, mantendo máquina, navegador, viewport, amostras e repetições. A produção e o servidor de desenvolvimento não devem compartilhar a mesma coluna de resultados.

## Conferência pelo usuário e preservação funcional

1. Abra o **Exemplo ArmaduraStruct** e ative **Desenho**. Faça pan com o botão do meio e aproxime/afaste com a roda.
2. Mova o cursor e use **F3** para comparar encaixes ligados/desligados. Selecione por clique e por janela, e arraste um vértice de uma barra livre.
3. Confira a atualização das inserções e do quadro após confirmar a edição. Desfaça/refaça e alterne entre desenhos e pranchas; confira que não ficaram textos/prévias antigos.
4. Salve/reabra. Pan, zoom e movimento do cursor devem conservar o arquivo físico e o quadro; editar um vértice continua sendo uma alteração real e reversível.

Regressão dedicada: `tests/e2e/cadPerformance.spec.ts` verifica a cena de 400 barras/400 inserções/20 mil entidades, ausência de regeneração de descrições na navegação, ausência de gravações indevidas, atualização após edição, histórico e troca de projeto. Também impede a volta da busca de objeto por entidade da máscara. `tests/presentationFormat.test.ts` cobre arredondamento, precisão, números especiais e erros. Os fluxos existentes verificam geometria, quantidades, escala de textos, representações, layers/perfis, visibilidade, pranchas, máscaras nativas/importadas e persistência.

Validação: **401 testes de domínio/importação e 6 de distribuição aprovados** em `npm run check`. Os **81 fluxos E2E existentes passaram**, e a nova regressão passou na reexecução após ajustar a expectativa para incluir a indicação da grade, além das duas coordenadas de interface. Build de produção e verificação de formatação fazem parte da entrega. Os testes de navegador foram executados com Chromium; não são testes dos instaladores nativos.

## Limites

O pan de uma máscara sintética muito densa ainda apresenta quadros longos, mesmo com pouco tempo JavaScript. O comparativo com a mesma cena sem máscara e a execução gráfica em software indicam custo do pipeline gráfico SVG; atribuir especificamente à pintura é uma inferência, não uma medição separada de pintura/composição nativa. Picos isolados continuam existindo no ambiente compartilhado; a entrega não declara eliminados todos os engasgos ou validado qualquer projeto de produção do usuário.

O navegador de desenvolvimento não foi usado como evidência de ganho. O desktop Tauri não pôde ser executado: o ambiente não dispõe de WebKitGTK 4.1 e do toolchain/configuração gráfica necessários. Não há medição nativa Linux/Windows nesta entrega. Esses modos compartilham o código corrigido, mas precisam de conferência no sistema de destino. A estrutura de renderização SVG e o mecanismo de captura permanecem os existentes; não foi introduzido outro renderizador, índice espacial ou adiamento de eventos.
