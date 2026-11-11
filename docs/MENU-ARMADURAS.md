# Menu Armaduras — organização compacta (#120)

A faixa usa os mesmos botões compactos e a mesma ajuda de Máscaras. Os comandos mantêm nomes acessíveis completos, identificação ao passar o mouse ou receber foco por teclado, estados ativo/desabilitado, atalhos e handlers anteriores. Os ícones vetoriais técnicos são próprios, em grade de 24 unidades, desenhados a 18 px (20 px nos dois lançamentos principais); cada alvo tem 28 × 28 px. A altura do conteúdo continua em **79 px**, sem retirar espaço adicional do CAD.

## Organização

- **Lançar:** Barra livre e Estribo, destacados; Critérios do estribo e Repetir estribo ficam logo abaixo.
- **Próximas criações:** bloco independente, com Quantidade/Bitola e Espaçamento/Cobrimento em duas linhas. Não depende da posição de Estribo na lista de botões.
- **Grampos de viga:** lançamento e critérios próprios, preservando a entrega já integrada.
- **Gerar / converter:** Rebater armadura, Converter polilinha, Seguir fôrma e Interpretar CAD em armadura.
- **Poligonais / traspasse**, **Faixas de armadura** e **Relação do aço:** mesmos comandos e restrições. Bloquear/Desbloquear RA mantém nome e ícone dinâmicos.

Os quatro parâmetros configuram próximas criações e não editam peças existentes. **Critérios de estribo já definidos continuam tendo precedência.** A ajuda do bloco explicita essa distinção; esta mudança não sincroniza os dois estados. Unidades continuam em mm, incluindo a bitola, e limites, precisão, opções e valores válidos fora da lista padrão são preservados. Quantidade com vários dígitos e valores decimais usam o `NumberField` existente, com confirmação por Enter/saída do campo e cancelamento por Esc.

Redimensionar e rolar não remonta os campos. Ao recolher Armaduras, o conteúdo fica oculto e permanece montado, conservando o estado do controle; expandir o recupera. Ctrl+F1 continua sendo o atalho da faixa fora dos campos de edição. Digitar nos parâmetros não dispara comandos CAD. Ativar um comando compacto por Enter/Espaço devolve o foco ao fluxo CAD, para que Enter não reinicie a ferramenta.

## Comparação visual e adaptação

Comparações feitas no mesmo Chromium, escala de interface 100%, fundo escuro, antes e depois, sem alterar o zoom do desenho:

| Janela      | Antes                                    | Depois                                           |
| ----------- | ---------------------------------------- | ------------------------------------------------ |
| 1920 × 1080 | [captura](menu-armaduras/antes-1920.png) | [captura](menu-armaduras/depois-1920-escuro.png) |
| 1366 × 768  | [captura](menu-armaduras/antes-1366.png) | [captura](menu-armaduras/depois-1366-escuro.png) |
| 1000 × 650  | [captura](menu-armaduras/antes-1000.png) | [captura](menu-armaduras/depois-1000-escuro.png) |

Em 1000 px, o conteúdo anterior tinha **1265 px** de largura, com rolagem. A nova faixa cabe sem rolagem nessa janela. Os testes conferem visibilidade integral dos campos, alvos mínimos de 24 px, ausência de sobreposição entre rótulo e controle e preservação dos 20 comandos atuais (18 do inventário e dois dos grampos de viga).

Em **640 × 650** e em **1000 × 650 com interface ampliada a 150% por CSS zoom**, os grupos mantêm sua composição e podem ser rolados horizontalmente. Setas visíveis nas extremidades permitem avançar/voltar sem depender de hover; a barra de rolagem continua disponível. O foco por teclado traz o controle para dentro da área útil, sem ficar sob as setas. Nenhum comando é retirado para um menu alternativo ou recriado durante a adaptação.

- [Janela estreita](menu-armaduras/depois-640-escala-1.png).
- [Interface ampliada](menu-armaduras/depois-1000-escala-1.5.png).
- Fundos claros nas três larguras: [1920](menu-armaduras/depois-1920-claro.png), [1366](menu-armaduras/depois-1366-claro.png), [1000](menu-armaduras/depois-1000-claro.png). O aplicativo oferece alternância do fundo do desenho; a faixa mantém o tema existente.

A ajuda compartilhada também resolve o posicionamento sob CSS zoom, mantendo a bolha dentro da janela. As demais abas preservam sua organização; Máscaras continua usando os componentes compartilhados.

## Validação

Os testes de interface novos cobrem inventário/identificadores, ícones distintos, tamanhos, unidades, nomes acessíveis, dois fundos, resoluções, escala ampliada, foco/ajuda, rolagem, valores longos, bitola fora da lista, decimais, Enter/Esc, recolher/expandir, ausência de alteração do arquivo por navegação, precedência dos critérios, seleção vazia/múltipla, RA bloqueada/desbloqueada e fluxo de Barra livre com histórico e reabertura.

As regressões exercitam Máscaras (incluindo painel recolhido e interface ampliada), estribos retangulares/circulares/livres, grampos de viga/pilar, edição isolada e seleção de grupos. Geometria, quantitativos, persistência, schema e regras de engenharia não são alterados nesta contribuição. A validação interativa foi feita no navegador Chromium; o aplicativo desktop nativo Linux/Windows não foi exercitado.

Resultados nesta branch, baseada no `master` **af8fdb7**:

- `npm run check`: **836/836** testes unitários (63 arquivos), **6/6** testes de distribuição e validação do plugin de exemplo aprovados.
- `npm run build`: aprovado.
- `npm run format:check`: aprovado.
- Playwright em Chromium: **41/41** fluxos aprovados, reunindo `armatureRibbonCompact`, `maskRibbonCompact`, `stirrups`, `beam-clamp`, `columnClamps`, `upgrade` e `detailEditing`.

Comando dos fluxos: `ARMSTRUCT_CHROMIUM=/usr/bin/chromium ARMSTRUCT_CHROMIUM_ARGS='["--no-sandbox"]' npx playwright test tests/e2e/armatureRibbonCompact.spec.ts tests/e2e/maskRibbonCompact.spec.ts tests/e2e/stirrups.spec.ts tests/e2e/beam-clamp.spec.ts tests/e2e/columnClamps.spec.ts tests/e2e/upgrade.spec.ts tests/e2e/detailEditing.spec.ts`.
