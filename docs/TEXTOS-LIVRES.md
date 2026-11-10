# Textos CAD livres

Texto independente na máscara ativa, sem vínculo com barras, quantitativos ou RA. Fica no desenho local da máscara (`DESENHO` nas nativas; `AS_DESENHO_LOCAL` nas importadas, sem escrever no DXF/DWG externo).

## Inserir

1. Aba **Máscaras → Desenhar → Texto** (ou comando `TEXTO`, `TEXT`, `DTEXT`). Requer máscara ativa visível, capturável e editável no contexto aberto.
2. **Ponto de inserção:** clique no desenho (encaixes valem) ou digite `X,Y` na linha de comando. A prévia acompanha o cursor.
3. **Conteúdo e formatação:** conteúdo de uma linha, botões Ø ± ° ² µ, altura, família, peso, estilo, alinhamento, rotação e X/Y de inserção. Os padrões vêm das Configurações CAD (altura e alinhamento de **Textos**, layer/aparência de **Máscaras → entidade**); a última formatação confirmada é reaproveitada no mesmo projeto.
4. **Inserir texto · Enter** grava uma única operação de histórico. **Desfazer/Refazer** removem/restauram o texto.

**Esc** volta uma etapa: na formatação, retorna ao ponto (mantendo os valores); no ponto, cancela. Ao usar **Escolher ponto no desenho**, Esc desiste apenas da troca do ponto e retorna ao conteúdo. A prévia nunca altera o projeto. Um texto pendente impede o reinício para instalar uma atualização até ser confirmado ou cancelado. Trocar de projeto, documento, detalhamento, isolamento, máscara ativa ou aba cancela a operação pendente; Desfazer/Refazer com texto pendente apenas o cancelam. Confirmações repetidas não duplicam: cada inserção tem ID fixo.

## Editar

Clique no texto com **Selecionar** (ou **Controle de máscaras → entidade → Editar texto…**). O painel **Editar texto** altera conteúdo, formatação e ponto (**Escolher ponto no desenho**). Mantém ID, layer, overrides e posição na lista. Abrir e confirmar sem mudanças preserva os valores locais exatos, inclusive em máscaras giradas/escaladas; alterar só o conteúdo não arredonda a geometria. Esc cancela sem gravar; confirmar sem mudanças não cria histórico. Mover, Copiar, Espelhar e Apagar do menu Manipular também aceitam textos livres; neles o clique seleciona o texto pelo ponto de inserção.

## Altura: modelo × folha

- **No modelo (mm):** altura física do texto no modelo; cresce e diminui com o zoom exatamente como a geometria.
- **Na folha (mm de papel):** informe a altura de papel e a escala de referência 1:N (padrão: escala de referência de impressão). O modelo guarda `altura × N` e o texto registra N (`textPaperScale`) para reabrir o editor em mm de papel. Numa vista 1:N o texto sai com a altura pedida; em outras escalas, proporcional. A altura mínima por vista existente continua valendo.

Em máscaras giradas/escaladas, ponto, altura e rotação são convertidos para o referencial local uma única vez.

## Fontes e saídas

| Família                | Tela (CSS)                 | PDF (base)            | DXF (STYLE)                         |
| ---------------------- | -------------------------- | --------------------- | ----------------------------------- |
| Sans (Helvetica/Arial) | Helvetica/Arial/Liberation | Helvetica             | `arial.ttf` · Arial                 |
| Serif (Times)          | Times New Roman/Liberation | Times                 | `times.ttf` · Times New Roman       |
| Mono (Courier)         | Courier New/Liberation     | Courier               | `cour.ttf` · Courier New            |
| Outra (nome)           | nome pedido → Sans         | Helvetica (declarado) | nome pedido; o leitor CAD substitui |

Negrito/itálico usam as variantes do PDF base e os flags TrueType do XDATA `ACAD` no DXF. O painel informa a substituição quando a família pedida não está no sistema. Texto continua texto (TEXT no DXF, texto no PDF); não há conversão em geometria. Textos sem fonte definida (identificações, cotas, importados) não mudam.

Conteúdo aceito: ASCII imprimível e Latin-1 (acentos, Ø, ±, °, ², µ), até 500 caracteres, uma linha. Caracteres fora desse conjunto (por exemplo `≥` ou travessão `—`) são recusados com aviso, em vez de serem trocados silenciosamente pelo PDF/prancha.

## Persistência

Projeto **armadurastruct/28** (lê 1–27) e pacote **openstruct.detail/17** (lê 1–16). `Primitive.native = { kind: 'text', at }` marca o texto livre; `textFont` e `textPaperScale` são opcionais. Versões antigas com esses campos são recusadas com indicação do formato; projetos antigos sem texto livre abrem normalmente. Biblioteca de símbolos e pacote preservam conteúdo, fonte e altura (convertida em mm/cm/m).

## Limitações conhecidas

- Uma linha por texto; sem MTEXT, largura/espaçamento de caracteres ou fontes embutidas.
- Larguras de caracteres variam entre navegador, leitor PDF e leitor CAD; caixas de seleção usam métricas Helvetica aproximadas.
- O importador DXF do aplicativo não lê justificação de TEXT (limitação anterior): reimportar um texto centralizado o trata como alinhado à esquerda.
- No Manipular, o clique captura o texto perto do ponto de inserção (contrato existente), não pela caixa inteira.

Arquivos: `src/domain/freeText.ts`, `textStyle.ts`, `nativeMasks.ts`, `primitiveSchema.ts`, `model.ts`, `detailPackage.ts`; `src/components/FreeTextPanel.tsx`, `CadCanvas.tsx`, `MaskControl.tsx`, `Ribbon.tsx`, `SheetCanvas.tsx`, `PlotDialog.tsx`; `src/lib/exports.ts`; `src/App.tsx`. Testes: `tests/freeText.test.ts`, `tests/e2e/freeText.spec.ts`.
