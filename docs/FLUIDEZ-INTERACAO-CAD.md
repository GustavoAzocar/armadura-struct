# Fluidez da interação CAD — #175

Esta implementação reduz o trabalho repetido de entrada e prévias. A validação de fluidez no desktop Linux e a medição de sua carga gráfica permanecem necessárias antes de encerrar a issue. As medições abaixo não equivalem a FPS, latência física ou uso total de CPU/GPU.

## Alterações

### Entrada e câmera

`CadCanvas` mantém a câmera lógica mais recente em uma ref. Cada entrada de roda integra seu delta com a âncora daquele evento; pan usa a posição absoluta em relação à origem do gesto. Durante esses gestos, a apresentação é publicada no máximo uma vez por frame de animação. `getState()` retorna a câmera lógica, inclusive antes da publicação, para preservar a navegação ao trocar de documento.

Comandos discretos de enquadramento, restauração e botões de zoom publicam a câmera imediatamente e descartam o frame anterior pendente. Assim, o desenho já corresponde à câmera do próximo clique, inclusive ao editar texto após Enquadrar. A publicação é compatível com transições de layout e não força `flushSync` dentro de efeitos.

Entrada/saída de isolamento e reenquadramento automático são decididos na mesma transição. Ao entrar, o overview captura inclusive a última câmera lógica ainda não publicada. Ao sair, restaurar esse overview tem prioridade sobre a mudança da contagem de máscaras visíveis. A primeira medição do `ResizeObserver` é explícita; alternar Foco ou redimensionar depois preserva a navegação.

A posição de grip/janela também avança imediatamente. A soltura é resolvida pelas suas próprias coordenadas, atualiza o ponto final e publica o trabalho pendente antes de confirmar. Não depende de React já ter desenhado o último movimento. Um clique continua resolvendo seu snap atual.

A aquisição de guias e a consulta de snaps continuam consumindo cada evento de movimento entregue ao aplicativo. Apenas a publicação de cursor, marcador, alças, janela e notificações de prévia ao componente pai é agrupada. Hover de entidades é resolvido na publicação com o contexto atual; o clique faz sua própria consulta exata.

`Esc`, `pointercancel`, perda de captura, blur, troca de comando/cena e desmontagem descartam feedback pendente. `Enter` publica a entrada pendente antes do tratamento do atalho, quando não há modal ou composição de texto. Navegação não é uma transação do projeto: cancelar uma edição conserva a última câmera, sem confirmar geometria. Callbacks de uma geração cancelada não publicam em uma geração nova.

### Prévia da máscara

`prepareWholeMaskMovePreview` verifica a elegibilidade do snapshot e seu contexto uma vez por sessão. A prévia verifica o deslocamento e os limites de coordenadas, mantendo as primitivas e alterando somente a pose. Mudança do snapshot ou contexto prepara uma nova sessão. `applyWholeMaskMove` continua chamando a validação completa e recusando projeto/contexto obsoletos; a confirmação não confia no cache visual.

`manipLines` reutiliza os pontos originais; `CadCanvas` aplica `translate` ao grupo da prévia. O círculo do ponto-base fica fora desse grupo, no ponto-base original. Os pontos estáticos usados por Ajustar à tela têm cache separado dos pontos temporários; a translação é considerada ao enquadrar, sem revarrer a cena estática a cada cursor.

`CadPreview` é memoizado e agrupa apenas traços adjacentes com a mesma espessura, tracejado e layer. Cada subcaminho conserva suas coordenadas e fechamento; textos preservam ordem, posição, alinhamento, fonte e rotação. Não há arredondamento, simplificação ou remoção de segmentos. O agrupamento também é usado no realce dos limites da máscara.

O comportamento anterior que mostra a extensão de máscaras com **mais de 20 mil** primitivas continua existente. Esta entrega não cria uma nova abreviação; na fixture de exatamente 20 mil, todos os segmentos continuam na prévia.

### Proteções e prévias de seleção

`assertLayerEdit` usa índices locais de IDs, papéis e layers em vez de buscas repetidas por objeto. Os índices duram apenas a chamada e preservam o layer explícito, o papel implícito, o fallback e as verificações de criação/edição em layers protegidos. Símbolos continuam passando pela detecção de alteração de definição.

Girar/Espelhar continuam usando a transformação de domínio e suas validações para produzir a prévia. Agora essas atualizações chegam por frame, com a proteção de layers mais barata e a apresentação temporária agrupada. Não foi introduzida uma segunda implementação geométrica dessas transformações.

### Limites do escopo

A cena estática continua em SVG, com os caches já existentes. Não foi introduzido cache raster, tiles ou backend WebGL; o custo de paint/raster/composição pode continuar limitante no pan com referências densas. Essa decisão depende do perfil nativo. Cálculos de armaduras, quantitativos, formato de arquivo e exportadores não foram modificados.

## Diagnóstico local optativo

O aplicativo oferece a API abaixo no console das ferramentas de desenvolvimento. Ela começa **desligada** e não envia nem persiste registros. Não inclui nomes de projetos, arquivos, IDs de entidades, coordenadas ou conteúdo importado. Registra versão, modo de build, user agent, dimensões/DPR e contagens numéricas da cena.

```js
// Gravar dez segundos; realizar apenas o gesto que está sendo comparado.
window.armaduraCadDiagnostics.start(10000);

// Depois do gesto: retorna um objeto com resumo e amostras.
window.armaduraCadDiagnostics.stop();

// Consultar sem encerrar a gravação.
window.armaduraCadDiagnostics.snapshot();
```

A duração é limitada a 60 segundos, com até 2.048 amostras por métrica e 24 métricas. Ao atingir o limite, os quantis usam as primeiras amostras retidas; o relatório informa `retained`/`dropped`. Contagem, total e máximo continuam cobrindo a sessão. O registro para automaticamente no prazo e libera observadores/timers ao sair do aplicativo. Nenhum loop de diagnóstico fica ativo antes de `start()` ou após `stop()`.

Métricas:

| Nome                          | O que representa                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `frame`                       | Intervalo entre oportunidades de `requestAnimationFrame`, sem prova de apresentação física |
| `pointer.handler`             | Trabalho síncrono do handler de movimento; inclui a consulta de snap quando cabível        |
| `pointer.feedback`            | Início do último handler até a publicação JS do feedback; exclui a pintura posterior       |
| `snap`                        | Aquisição de guias e resolução do candidato                                                |
| `cursor.consumer`             | Chamada síncrona ao consumidor de cursor; não inclui todo o commit React                   |
| `preview.maskMove`            | Preparação da pose de prévia da máscara                                                    |
| `preview.selectionTransform`  | Transformação de domínio para a prévia genérica                                            |
| `preview.selectionPrimitives` | Preparação de primitivas dessa seleção                                                     |
| `longTask`                    | Tarefas longas, quando o motor disponibiliza esse observador                               |

Categorias aninhadas não devem ser somadas. Algumas métricas só aparecem quando a operação correspondente é exercitada. O diagnóstico não mede CPU total, GPU, driver, temperatura, rotação de ventoinha ou latência mouse → monitor. Use o profiler nativo/Web Inspector para investigar render/commit React, paint, raster e composição.

## Comparação isolada antes/depois

Benchmark `scripts/cad-interaction-benchmark.mjs`, Node 24.22.1, Linux 6.18.57, CPU exposta AMD EPYC 9V45, 9 processadores lógicos. Três séries sequenciais de 60 entradas após dez aquecimentos por série, sem build/testes concorrentes. Fixture: 400 barras, 400 representações e máscara de 20 mil segmentos.

Base: `e3d966a`. Depois: implementação desta PR em working tree sobre essa base. O campo `workingTree` dos JSON distingue as condições; o commit indicado no arquivo `after` é o commit de origem, não uma alegação de árvore limpa. Os JSON e o script versionados permitem repetir no commit revisado.

Valores abaixo: mediana das medianas / mediana dos p95 das três séries, em ms.

| Preparação recorrente       | Antes: mediana / p95 | Depois: mediana / p95 |
| --------------------------- | -------------------: | --------------------: |
| Mover máscara inteira       |      3,2655 / 7,8192 |       0,0010 / 0,0026 |
| Girar seleção de 1 barra    |      3,5098 / 4,0303 |       1,7748 / 2,2779 |
| Girar seleção de 400 barras |      5,3288 / 6,1059 |       3,6240 / 4,9071 |

O ensaio de máscara compara o trabalho que repetia a validação e movia todos os pontos com o caminho preparado que atualiza só a pose. Não inclui o custo de percorrer hooks/painéis do aplicativo ou de reconciliar/pintar SVG. A redução de paths temporários é **20.000 → 1**, conservando todos os segmentos na mesma ordem.

Há custo inicial do cache: a amostra única de preparação passou de 24,6 ms para 93,3 ms, incluindo pontos, verificação inicial e agrupamento dos paths no caso novo. Esse número frio sofre JIT/GC, não tem p95 e não mede a primeira imagem real. O ganho publicado é no trabalho recorrente, não uma promessa de abertura mais rápida.

Dados brutos: [antes](performance/interaction175-before.json) e [depois](performance/interaction175-after.json).

Reprodução, com `npm ci` e um checkout da base em outro diretório:

```bash
npm run perf:interaction -- --root=/caminho/para/base --label=before --output=test-results/interaction-before.json
npm run perf:interaction -- --label=after --output=test-results/interaction-after.json
```

O checkout de referência precisa das dependências instaladas. O script pode medir a base anterior sem a API preparada. Não inicia navegador e não substitui `npm run perf:cad`, que mede o aplicativo compilado.

## Testes e verificação

- `npm run check`: 1.173 testes de domínio/importação/infraestrutura e seis de distribuição aprovados; plugin de exemplo válido.
- Novas regressões unitárias: rajadas de entrada, flush de confirmação, cancelamento entre gerações, zoom com âncoras distintas, coordenadas finais, cache de prévia versus resultado exato, proteção no commit, agrupamento sem perda de precisão/textos e diagnóstico limitado/desligado por padrão.
- `tests/e2e/cadInputFrames.spec.ts`: rajada de pan seguida por soltura diferente do último movimento; grip confirmado antes do próximo frame com undo/redo; Esc impedindo edição atrasada; enquadramento e botões de zoom publicados antes do próximo frame. Incluído na etapa prioritária do CI e na suíte completa.
- O cenário existente de edição de texto após Enquadrar permanece sem esperas adicionais. Junto aos três cenários de isolamento e à regressão dos botões, ele é repetido cinco vezes na etapa inicial do CI (25 execuções).
- `tests/e2e/detailEditing.spec.ts`: restauração do overview com máscaras reaparecendo, zoom ainda pendente, Foco e redimensionamento. A asserção original de centro/escala permanece; três cenários de isolamento são repetidos cinco vezes na etapa inicial do CI antes da suíte completa.
- Os cenários existentes de snaps, máscaras, seleção, histórico, persistência e exportação permanecem na suíte.

O Chromium local não inicia por uma restrição de sockets do ambiente (`Operation not permitted`); os E2E e o benchmark de navegador ficam para o CI. Não há WebKitGTK 4.1, GPU física nem sessão gráfica disponíveis nesta execução. Builds/testes do desktop Linux/Windows e sensações de uso não são declarados validados.

## Roteiro de teste no desktop de uso

1. Identificar a versão/revisão compilada, pacote (.deb/AppImage), Linux, Wayland/X11, WebKitGTK, GPU/driver, resolução, DPR, frequência da tela e dispositivo de entrada. Registrar o que não for conhecido.
2. Usar cópias: projeto vazio, cena pequena, fixture densa e um desenho representativo. Separar máscara visível/oculta e capture ligado/desligado como experimentos, mantendo o padrão para a validação final.
3. Executar separadamente cursor, pan, zoom, seleção simples/múltipla, janela, mover máscara, girar/espelhar e grips. Repetir três vezes, em release, no mesmo tamanho de canvas e zoom inicial. Conferir marcador, prévia e ponto aplicado em dois zooms, com F3/ORTO/guias.
4. Para pan e coolers, comparar períodos antes, durante e depois. Usar CPU por processo e sensores apenas se já disponíveis. Não inferir consumo/temperatura pelo ruído; confirmar que o trabalho cessa após soltar.
5. Incluir movimentos rápidos seguidos de clique/soltura, Enter, Esc, perda de foco, troca de comando/documento/projeto e fechar durante uma prévia. Nenhum estado atrasado deve editar outra cena.
6. Conferir undo/redo, salvar/reabrir, comprimento/quantidade/peso e PDF/DXF/CSV. Verificar textos, layers bloqueados/ocultos, máscaras giradas/escaladas e preservação da geometria física.
7. Comparar com o build anterior na mesma máquina. Estabelecer metas pelo baseline; uma redução mensurável no p95 do gesto limitante e a confirmação de uso por Ricardo são necessárias. Se o pan continuar dominado por rasterização, avaliar a camada estática separadamente.

Não encerrar #175 apenas pelo microbenchmark ou pelos contadores de cache. A validação nativa e a experiência do gesto relatado são o critério final.
