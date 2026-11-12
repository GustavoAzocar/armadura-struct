# Validação dos encaixes CAD — #162

A implementação seguiu #163 → #164 → #165. A base inicial era `78695e8`; durante o trabalho foi incorporada a integração das telas soldadas em `master@978786b`. A validação abaixo cobre o conjunto já compatibilizado, sem alterar o núcleo de cálculo ou o formato dos projetos. O código usado nos ensaios finais está no commit [f078ded](https://github.com/ricardocorsini/armadura-struct/commit/f078dedf9f0f3186261dd518f995d88c11d4fa2e), árvore `c013862215559e3617226fd4c23226e8a2ae55e5`.

## Conferência funcional

| Verificação                                                                           | Resultado                                                                                                           |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                                       | 1.160 testes de domínio/importação, 6 de distribuição e validação do plugin de exemplo aprovados.                   |
| `npm run build`                                                                       | Build de produção aprovado.                                                                                         |
| `npm run format:check` e `git diff --check`                                           | Aprovados.                                                                                                          |
| `npm run test:e2e`                                                                    | 308 testes aprovados, em 26,4 minutos, incluindo os 10 novos cenários de encaixe e as regressões de telas soldadas. |
| Cenário de centros/quadrantes/centroide/inserção repetido após sincronização do teste | 5 repetições aprovadas em 2,0 minutos, com os mesmos critérios de precisão.                                         |

Os 34 testes de geometria adicionados cobrem os exemplos numéricos literais das filhas, os dois sentidos de arcos, limites finitos, transformações, contornos inválidos, semântica de âncoras e comparação com o resolvedor antigo. Na cena de 20 mil segmentos, a consulta espacial do teste visita menos de 10 curvas e menos de 20 pontos no entorno escolhido.

No navegador foram comparados marcador, prévia e ponto gravado em dois zooms. A captura de referência somente de leitura não a desbloqueia; desligar captura impede candidatos. F3, ORTO, Esc, troca de comando e ocultação da referência têm cobertura. As novas guias não alteram as entidades adquiridas. A suíte existente também conferiu seleção, calibração, manipulações, histórico, persistência, atalhos, quantitativos, pranchas e exportações.

Um ensaio de CI do PR #168 expôs uma condição de preparação do teste: dois callbacks de animação não garantiam a aplicação da atualização do `ResizeObserver` após abrir a faixa de desenho. A conversão modelo → tela passou a aguardar estabilidade conjunta do retângulo do canvas e da transformação da câmera, antes de mover o mouse. As asserções e tolerâncias geométricas foram mantidas. As cinco repetições acima conferem esse ajuste; não há repetição automática de uma asserção de snap fracassada.

## Comparativo da cena densa

Procedimento de [DESEMPENHO-CAD.md](DESEMPENHO-CAD.md): build de produção, mesma máquina, mesmo navegador/parâmetros, viewport 1600 × 1000, três séries de 60 entradas por ação, com o script `scripts/cad-benchmark.mjs`. As séries foram executadas em sequência, sem teste ou build simultâneo. A base foi compilada em um worktree separado de `978786b`; os ensaios finais usam `f078ded`.

Ambiente exposto: Linux 6.18.57, AMD EPYC 9V74, 9 processadores lógicos, Node 24.22.1, Playwright 1.58.2 e Chromium headless 153.0.8010.0. O CDP confirmou renderização gráfica por SwiftShader, em software. Não se trata do computador do usuário nem de uma medição do aplicativo desktop nativo.

A mesma cena contém **400 barras, 400 representações, 20.000 segmentos de máscara, 40.000 pontos de máscara e 5.127 elementos SVG**. IDs e geometrias vêm de `tests/performanceScene.ts`.

Os percentis abaixo são a mediana dos percentis das três séries; o tempo JS é a mediana do `ScriptDuration` por série. Resposta mede até dois callbacks de animação após a entrada, sem equivaler à latência física do monitor.

| Configuração e ação                      | Quadro p95 (ms) | Resposta p95 (ms) | JS por 60 entradas (ms) |
| ---------------------------------------- | --------------: | ----------------: | ----------------------: |
| Base — cursor com encaixes antigos       |            33,4 |              64,1 |                  194,35 |
| Novo — somente os dois modos padrão      |            33,4 |              64,9 |                   51,80 |
| Novo — 13 modos habilitados              |            33,4 |              55,4 |                   56,54 |
| Base — cursor com F3 desligado           |            16,7 |              38,8 |                   29,08 |
| Novo padrão — cursor com F3 desligado    |            16,8 |              39,0 |                   25,93 |
| Novo com todos escolhidos — F3 desligado |            16,7 |              38,1 |                   24,89 |

A busca ativa manteve o p95 de quadro da base. O tempo JS caiu cerca de **73%** nos modos padrão e **71%** com todos habilitados. Isso não demonstra uma taxa constante de quadros: o maior intervalo observado foi **100,1 ms na base, 316,6 ms no novo padrão e 250,0 ms com todos habilitados**. Picos persistem no ambiente compartilhado e ficam visíveis nos JSON; não são eliminados pela média ou pelo percentil. Não houve erros de página ou gravações IndexedDB durante as séries.

O percurso mede movimento do cursor no modo de seleção. Perpendicular, Tangente e Paralelo não oferecem soluções sem base, e Extensão depende de aquisição em comando de pontos; habilitá-los não simula uma base. O custo das buscas independentes — inclusive Interseção e Ponto mais próximo — está ativo. Aquisição, guias e operações com base foram conferidas nos testes de geometria e de navegador, sem uma alegação de benchmark denso desses comandos. Os builds usados aqui não têm source maps; os perfis minificados são publicados como registro, sem atribuição de ganho a uma função específica.

Dados brutos: [base](performance/snaps-before.json), [novo padrão](performance/snaps-after-default.json) e [todos habilitados](performance/snaps-after-all.json). Cada arquivo registra ambiente, geometria, três séries, percentis, picos, contadores e amostras CPU.

## Reprodução

Com as dependências e o Chromium do Playwright instalados:

```bash
npm run build
npm run perf:cad -- --label=padrao --scene=large --actions=cursor-snap,cursor-no-snap --samples=60 --repeats=3 --output=test-results/snaps-padrao.json
npm run perf:cad -- --label=todos --scene=large --actions=cursor-snap,cursor-no-snap --samples=60 --repeats=3 --snap-modes=endpoint,midpoint,center,geometricCenter,quadrant,intersection,nearest,insertion,node,perpendicular,tangent,extension,parallel --output=test-results/snaps-todos.json
```

Para a base, compile `978786b` em um worktree separado e execute o mesmo roteiro de cursor, mantendo navegador, parâmetros, viewport e amostras. `--dist` também permite apontar o roteiro atual para aquele build; nesse caso identifique separadamente o commit do build medido e o commit do roteiro. `ARMSTRUCT_CHROMIUM` e `ARMSTRUCT_CHROMIUM_ARGS` permitem usar outro executável existente, como neste ambiente.

Uso, matriz por geometria, limitações de Nó/Inserção e de curvas amostradas, e capturas reais estão em [ENCAIXES-CAD.md](ENCAIXES-CAD.md). Não foram acrescentados tipos ao importador, interseção aparente, snaps 3D ou rastreamento F11.
