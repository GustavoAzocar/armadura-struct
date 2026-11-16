# Usabilidade do lançamento de estribo (issue #178)

Relatório de ensaio do comando `stirrup` (**Armaduras → Lançar → Estribo**, atalho **E**). O objetivo foi observar o lançamento de ponta a ponta, não revisar o código. A inspeção de código só entra para localizar a origem de um problema já observado na interface.

## 1. Condições do ensaio

| Item                      | Valor                                                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Versão                    | ArmaduraStruct 0.6.1, `master` em [`3ab67ea`](https://github.com/ricardocorsini/armadura-struct/commit/3ab67ea08ec044bcc12e172e0ba0930911ff514b) (13/11/2026), revalidada contra `upstream/master` no início do ensaio         |
| Sistema                   | Windows 11 Pro 10.0.22631, Intel i7-14700K, 48 GB                                                                                                                                                                              |
| Execução                  | Servidor de desenvolvimento (`npm run dev`, Vite) aberto num navegador Chromium 156 embutido. **Não é o aplicativo desktop Tauri**                                                                                             |
| Janela                    | Viewport emulado em 1366 × 768 px, escala 100%                                                                                                                                                                                 |
| Entrada                   | Mouse (clique, roda para zoom) e teclado, comandados por um agente de IA (Claude Code) que operava a interface como usuário. Os cliques passam pelos eventos reais da página, com encaixes e prévia. Não houve operador humano |
| Projeto                   | Projeto novo, com a máscara [`forma-viga-pilar.dxf`](forma-viga-pilar.dxf) (19 entidades, mm): elevação da V1 20×50 entre P1 e P2 com vão livre de 1.100 mm, seção da V1 200×500 e seção do P1 600×300                         |
| Testes de domínio (apoio) | `npx vitest run stirrups`: 15/15 passando. Servem só de apoio à geometria e não contam como ensaio de usabilidade                                                                                                              |

**Limites que valem para todo o relatório**

- **Linux não foi testado.** Era a plataforma prioritária, mas não havia ambiente disponível. Nenhuma conclusão daqui se estende a Linux/WebKitGTK. Isso pesa em especial para a vírgula decimal e a fluidez de zoom/PAN (ver #175).
- O desktop nativo (Tauri/WebView2) também não foi testado. Tudo foi feito no navegador sobre o servidor de desenvolvimento.
- **Os tempos medidos não valem como tempo humano.** O agente gasta segundos entre uma ação e outra para ler a tela. Da primeira chamada do comando até a confirmação na viga foram **136 s de relógio**, quase tudo latência do agente. Por isso a dificuldade é medida aqui em **número de ações e retornos**. A seção 7 deixa um roteiro para alguém medir o tempo humano.
- A primeira utilização foi conduzida por quem já tinha lido `docs/ESTRIBOS.md`, então não representa um usuário que nunca viu a ferramenta.
- A importação da máscara foi preparada por script: o arquivo foi injetado no campo de upload, porque a ferramenta de navegador não abre o seletor de arquivos do sistema. A partir do diálogo **Importar máscaras em lote**, todos os passos foram feitos pela interface.

## 2. Cenário 1: estribo na seção da viga, com faixa (primeira utilização)

Critérios usados: retangular fechado, **seção de concreto + cobrimento** 200 × 500 mm, cobrimento 30 mm, Ø6,3 CA-60, mandril 40 mm, ganchos 135° com 10φ, distribuição **seção + faixa** com passo máximo 150 mm e afastamentos de 50/50 mm.

### Sequência observada

| #   | Ação                                                                   | Resultado observado                                                                                                                                                 | Captura                       |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1   | Clique no ícone **Estribo** (faixa compacta)                           | Ao passar o mouse aparece a dica “Estribo · E / ESTRIBO + Enter”. No primeiro uso do projeto, o clique abre **Critérios do estribo** em vez de pedir um ponto       | [01](01-criterios-padrao.jpg) |
| 2   | Referência: **Dimensões no eixo** → **Seção de concreto + cobrimento** | O campo de cobrimento aparece já preenchido com 30, valor herdado de “Próximas criações”                                                                            |                               |
| 3   | Altura 400 → 500; bitola 8 → digitado **“6,3”** (com vírgula)          | A vírgula foi aceita (o valor virou 6.3). O eixo e o comprimento na prévia mudaram na hora: 133,70 × 433,70 mm, C = 1.228,31 mm. **O mandril continuou em 40 mm**   | —                             |
| 4   | Aba **Distribuição**: afastamentos 0 → 50 e 0 → 50                     | O texto de ajuda explica Máximo/Fixo e avisa que não há associação com os pilares                                                                                   | [02](02-distribuicao.jpg)     |
| 5   | Aba **Representação** (só conferida)                                   | Cotas, identificação e ganchos estavam marcados                                                                                                                     | —                             |
| 6   | **Usar critérios e lançar**                                            | O painel “Estribo · N1” pede: “Posicione a seção: canto inferior esquerdo da referência escolhida”                                                                  | —                             |
| 7   | Zoom com a roda e clique no canto da seção                             | O encaixe “Extremidade” apareceu e o estribo acompanhava o cursor já dentro da seção                                                                                | —                             |
| 8   | **Ajustar à tela** + zoom para chegar à elevação                       | O comando continuou ativo depois do ajuste e do zoom. O painel flutuante cobre o canto superior esquerdo do desenho                                                 | —                             |
| 9   | Clique na face do P1 (300; 0)                                          | Com o cursor em movimento, a faixa já mostrava “8 N1 Ø6,3 c/14,3 cm”. O painel exibia 8 peças, passo efetivo de 142,86 mm e primeira/última posição em 350/1.350 mm | [03](03-previa-faixa.jpg)     |
| 10  | Clique na face do P2 (1.400; 0)                                        | Passa para a etapa “Escolha a posição da linha e da identificação”                                                                                                  | —                             |
| 11  | Clique abaixo da viga                                                  | **Confirmar lançamento** fica habilitado                                                                                                                            | [04](04-pronto-confirmar.jpg) |
| 12  | **Enter**                                                              | Seção e faixa gravadas, N1 selecionado e propriedades abertas                                                                                                       | [05](05-viga-confirmada.jpg)  |

São **cerca de 16 ações**, das quais 7 são edições na janela de critérios e 2 a 3 são navegação (zoom e ajuste). A sequência foi feita sem nenhum erro nem retorno.

### Conferência do resultado

- Faixa: vão de 1.100 − 50 − 50 = 1.000 mm. Com passo máximo de 150 mm são 7 intervalos de 142,86 mm, ou seja, **8 peças**, que é o que aparece. A seção não acrescentou uma peça.
- Quadro de aço ([06](06-quadro-viga.jpg)): N1 com 8 × 1,228 m = 9,826 m e 2,40 kg (Ø6,3: 0,2447 kg/m). O valor bate com a prévia dos critérios e com o painel.
- Cotas da seção: 13,37 × 43,37 cm (eixo) = 200 − 2·(30 + 3,15) por 500 − 2·(30 + 3,15). Estão corretas.
- **Desfazer** (Ctrl+Z) removeu seção e faixa juntas, e **Refazer** (Ctrl+Y) restaurou as duas.
- Depois o painel do navegador foi fechado sem querer. Ao reabrir, a recuperação local trouxe N1 intacto e os critérios usados.

## 3. Repetição com familiaridade, erro e recuperação

| #   | Ação                                                             | Resultado observado                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tecla **E** com o foco no CAD                                    | Abre direto “Estribo · N2 / Posicione a seção”, reaproveitando os critérios. Os critérios em uso (bitola, passo) **não são mostrados** antes do primeiro clique                                                              |
| 2   | Clique perto do canto inferior esquerdo da seção da V1           | **O encaixe escolhido foi “Ponto médio” (2.300; 0), não o canto.** O estribo ficou deslocado 100 mm e passou da face direita da viga. Nada avisou que o estribo saiu do contorno de concreto ([07](07-erro-ponto-medio.jpg)) |
| 3   | **Voltar etapa**                                                 | Voltou para “Posicione a seção”. A recuperação foi simples                                                                                                                                                                   |
| 4   | **Critérios do estribo** (faixa de comandos) com o comando ativo | O lançamento em curso foi **descartado** e os critérios abriram do zero, com o botão “Usar critérios e lançar”. No estribo retangular não existe opção para ajustar os critérios e continuar do ponto onde se estava         |

Na repetição, o fluxo com faixa fica em **6 ações**: E, seção, face 1, face 2, linha e Enter, mais a navegação até a elevação.

## 4. Cenário 2: estribo e grampo na seção do pilar

### Estribo retangular, somente seção

Critérios: concreto 600 × 300 mm, cobrimento 30 mm, Ø6,3, **Somente seção** com quantidade 1. A seção foi posicionada **digitando `3000,0` na linha de comando**.

1. **Critérios do estribo**: os valores do último lançamento da viga estavam preservados. Mudei base e altura e, em Distribuição, escolhi **Somente seção**. A prévia passou a mostrar C = 1.628,31 mm e eixo 533,70 × 233,70 mm.
2. Teste de erro: cobrimento de 200 mm. Aparece a mensagem “Seção/cobrimento incompatíveis: envelope do eixo não positivo.” e o botão de lançar fica desabilitado.
3. **Usar critérios e lançar**, `3000,0` e Enter na linha de comando. O fluxo vai direto para a prévia pronta.
4. **Esc**: o rascunho inteiro foi cancelado e nenhum N2 foi criado. Em seguida **E** reiniciou com os mesmos critérios.
5. Repeti a coordenada e cliquei em **Confirmar lançamento**. N2 foi criado com 53,37 × 23,37 cm (eixo) e C = 162,8 cm ([09](09-pilar-visao-geral.jpg)).

O lançamento só da seção pede **3 ações** depois que os critérios estão definidos.

### Grampo de pilar S (família disponível no mesmo comando)

1. Em Formato escolhi **Grampo de pilar S** ([08](08-criterios-grampo-s.jpg)). O contorno e o sentido dos ganchos ficam travados. As bitolas longitudinais vêm com 16/16 mm e a orientação com “Normal”.
2. Lancei com dois centros digitados, (3.044,3; 44,3) e (3.044,3; 255,7), que correspondem a cobrimento 30 + Ø6,3 + Ø16/2. O painel avisa que o segundo centro “não é o fim da faixa” e oferece **Editar bitolas / orientação / centros**.
3. Enter gravou N3 com C = 44,1 cm.
4. **Problema observado** ([10](10-pilar-grampo-zoom.jpg)): com a orientação padrão e ganchos de 135°, **os ganchos do grampo atravessaram a face esquerda do pilar** e ficaram fora do concreto. Não houve aviso. Na mesma região, os textos “20.63 cm reto” e “23.37 cm (eixo)” ficaram sobrepostos.

Quadro com as três posições ([11](11-quadro-tres-posicoes.jpg)): 9,826 + 1,628 + 0,441 = **11,90 m e 2,91 kg**. Os totais conferem.

## 5. Constatações (atual)

### O que funcionou bem

- O comando é fácil de achar: o ícone tem dica com o atalho, a tecla **E** funciona com o foco no CAD e “Critérios do estribo” fica ao lado.
- Os critérios dão retorno imediato. Comprimento, eixo e desenho mudam a cada valor digitado, e há validação clara de seção/cobrimento incompatíveis.
- A prévia da faixa no CAD mostra quantidade, passo e extremos **antes** do clique, e os números conferem com o cálculo manual.
- O fluxo tem confirmação explícita (botão ou Enter), Esc cancela tudo, Voltar etapa funciona e Desfazer/Refazer é atômico.
- Zoom e “Ajustar à tela” no meio do comando não o interrompem. No Windows não notei travamentos nesse projeto pequeno.
- Os critérios persistem entre lançamentos e sobreviveram à recuperação local.
- Encaixes funcionam e a entrada por coordenadas é uma alternativa precisa.
- Os quantitativos estão corretos e a seção não soma peça extra à faixa.

### Atritos encontrados

| ID  | Constatação                                                                                                                                                                                                                                                                                                                                                                                           | Impacto                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| A1  | O ponto de inserção é só o canto inferior esquerdo da referência. Perto dele existe o encaixe “Ponto médio”, e um clique ligeiramente fora pôs o estribo 100 mm para fora da seção, **sem aviso** (seção 3, passo 2)                                                                                                                                                                                  | Alto: gera erro de posição que passa despercebido    |
| A2  | O grampo S com a orientação padrão ficou com os ganchos fora do pilar, também **sem aviso**                                                                                                                                                                                                                                                                                                           | Alto: o erro só é percebido inspecionando o desenho  |
| A3  | Os textos gerados misturam separador decimal: “N1 - 8 x Ø**6.3** - C=122**,**8 cm”, “13**.**37 cm (eixo)”, “20**.**63 cm reto” contra “8 N1 Ø6**,**3 c/14**,**3 cm”. No código, as cotas usam `toFixed` (`src/domain/stirrupGeometry.ts:299`) e a identificação interpola `${b.diameter}` direto (`src/domain/drawingPrimitives.ts:82`, `src/domain/representations.ts:175`), sem passar por `format` | Médio: inconsistência em desenho que vai para a obra |
| A4  | Abrir **Critérios do estribo** durante o comando descarta os pontos já capturados. Só o grampo tem “Editar … ” no painel, que retoma o lançamento. Para ajustar um valor esquecido no retangular é preciso cancelar e recomeçar                                                                                                                                                                       | Médio                                                |
| A5  | Trocar a bitola não muda o mandril. Fica 40 mm (5φ de 8 mm), que para Ø6,3 corresponde a 6,35φ. Nada na tela mostra a relação mandril/φ                                                                                                                                                                                                                                                               | Médio: pode passar um mandril incoerente             |
| A6  | O painel flutuante “Estribo · Nx” cobre o canto superior esquerdo do CAD e cresce na etapa da faixa. Na sessão, cobriu o topo da elevação                                                                                                                                                                                                                                                             | Baixo/médio: obriga a mover a vista                  |
| A7  | Ao repetir com **E**, os critérios em uso não aparecem antes do primeiro clique. Só depois de posicionar a seção o painel mostra comprimento e quantidade                                                                                                                                                                                                                                             | Baixo                                                |
| A8  | No primeiro uso a referência vem como “eixo” com 200 × 400, enquanto “Próximas criações” mostra cobrimento de 30 mm. O cobrimento só vale depois de trocar a referência manualmente                                                                                                                                                                                                                   | Baixo                                                |
| A9  | A mensagem final é sempre “seção e distribuição confirmadas em uma única posição. Esc cancela; …”, inclusive para o grampo e para “somente seção”, que não têm distribuição. Depois de confirmar, Esc não tem mais o que cancelar                                                                                                                                                                     | Baixo                                                |
| A10 | Na janela de critérios, a aba ativa é indicada só pela cor do texto, e a altura da janela muda de uma aba para outra, deslocando os botões de ação                                                                                                                                                                                                                                                    | Baixo                                                |
| A11 | Os textos da seção (identificação, cotas, “reto”) não têm etapa de posicionamento como a linha da faixa. No pilar ficaram sobrepostos entre si e ao texto da máscara                                                                                                                                                                                                                                  | Baixo/médio, depende do desenho                      |

### Conclusão simples

**Para quem já conhece a ferramenta, lançar um estribo é simples e rápido.** A janela de critérios concentra os parâmetros com unidades explícitas e prévia imediata. A repetição com **E** fica em 3 ações (somente seção) ou 6 (seção + faixa), a prévia da faixa antecipa quantidade e passo, e as rotas de saída (Esc, Voltar, Desfazer) funcionam.

**No primeiro uso**, a janela de critérios exige várias edições (cerca de 7) e pede que o usuário saiba que o ponto de inserção é o canto inferior esquerdo. Os riscos maiores estão em **erros que o programa não sinaliza**: estribo ou grampo fora do concreto (A1, A2) e textos com formato inconsistente (A3). Fazer o lançamento não é difícil. O problema é que um erro pode passar sem ser percebido.

## 6. Comparação: Autodesk Revit (somente documentação oficial)

Não fiz ensaio direto: não há licença nem instalação disponível. O que segue foi lido nas páginas da ajuda oficial. **Não há tempos medidos nem observação de uso**, e nada de código ou recurso proprietário foi copiado.

| Aspecto               | Revit (fonte)                                                                                                                                                                                                                                               | ArmaduraStruct (observado)                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Inserção na seção     | “Place Rebar – By Two Points”: a forma se expande para preencher a caixa definida por dois pontos dentro do hospedeiro ([2025](https://help.autodesk.com/cloudhelp/2025/ENU/Revit-StructEng/files/GUID-C5F00668-26DA-4F41-908E-A41F3C6AF43A.htm))           | Um ponto fixo (canto inferior esquerdo), com as dimensões vindas dos critérios |
| Cobrimento            | A barra encaixa automaticamente no cobrimento do hospedeiro quando o eixo fica a até 0,5φ dele ([2023](https://help.autodesk.com/cloudhelp/2023/ENU/Revit-StructEng/files/GUID-C9757E0B-5ADB-4BEB-B6D4-28AC730FBE5E.htm))                                   | O cobrimento é digitado. A máscara é estática e não há hospedeiro              |
| Rotação/orientação    | Barra de espaço gira a forma durante a colocação; seta para cima alinha a uma referência (2025, mesma página)                                                                                                                                               | Rotação digitada nos critérios. O grampo tem “Normal/Invertida”                |
| Distribuição          | Conjunto perpendicular ao plano com Fixed Number, Maximum Spacing, Number with Spacing e Minimum Clear Spacing ([Place a Rebar Set 2025](https://help.autodesk.com/cloudhelp/2025/ENU/Revit-StructEng/files/GUID-7275163F-54C6-4684-99A5-7A61D7B1D061.htm)) | Máximo ou Fixo entre duas faces clicadas, mais afastamentos                    |
| Orientação ao usuário | Dica que acompanha o cursor com as opções de cada etapa ([Place Rebar 2025](https://help.autodesk.com/cloudhelp/2025/ENU/Revit-StructEng/files/GUID-D61AF551-AD15-4FEC-966F-C048E0885212.htm))                                                              | Painel flutuante com o texto da etapa                                          |

**Limites de comparabilidade.** O Revit é um modelador BIM 3D em que a armadura fica associada ao elemento estrutural hospedeiro. O ArmaduraStruct detalha em 2D sobre máscaras sem associação, e isso está documentado em `docs/ESTRIBOS.md`. O que se pode comparar é o **padrão de interação**: no Revit, a inserção pelo contorno e o encaixe automático no cobrimento eliminam a classe de erro A1. A documentação não mostra tempo, número de cliques nem facilidade de aprendizado. A documentação da TQS apareceu nas buscas, mas não foi lida a ponto de servir de referência, e por isso fica de fora da comparação.

## 7. Propostas de melhoria

Estas são hipóteses de projeto, separadas das constatações acima. Nenhuma foi implementada nesta issue.

| Prioridade | Proposta                                                                                                                                                                                                                             | Benefício esperado                                               | Riscos / dependências                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Alta       | **P1. Aviso quando o estribo ou grampo sai do contorno sob o ponto de inserção** (A1, A2). Se o ponto clicado pertence a um contorno fechado da máscara, avisar na prévia, sem bloquear, que o envelope externo do aço passa da face | Pega o erro de posição antes de confirmar                        | A máscara é estática e pode ter contornos abertos. O aviso não pode virar associação automática nem bloqueio |
| Alta       | **P2. Inserção pelo interior do contorno** (A1): opção “clique dentro da seção”, que centraliza a referência no retângulo fechado clicado, no mesmo padrão já usado por telas na #128                                                | Menos dependência de acertar o canto e menos conflito de encaixe | Reconhecimento de contorno. Precisa manter a inserção atual por canto/coordenada                             |
| Média      | **P3. Formatação única dos textos gerados** (A3): passar cotas e identificação pelo mesmo `format`                                                                                                                                   | Desenho consistente                                              | Mexe em PDF/DXF e nas convenções de cotagem. Precisa de testes de regressão das saídas                       |
| Média      | **P4. “Editar critérios” no painel para todas as famílias** (A4), reaproveitando a retomada que já existe para o grampo                                                                                                              | Corrigir um valor sem perder os cliques                          | Definir quais etapas sobrevivem a cada mudança. O código atual já descarta pontos quando a família muda      |
| Média      | **P5. Mostrar o mandril também em φ e oferecer “manter n·φ”** (A5)                                                                                                                                                                   | Evita mandril incoerente depois de trocar a bitola               | Não fixar valores normativos. É o projetista quem decide                                                     |
| Baixa      | **P6.** Painel ancorado ou recolhível (A6); resumo dos critérios no painel desde a primeira etapa (A7); mensagem final conforme a família (A9); aba ativa indicada além da cor e altura fixa da janela (A10)                         | Clareza                                                          | Mudanças de interface. Coordenar com #174 e com a reorganização do menu                                      |
| Baixa      | **P7.** Etapa opcional para posicionar os textos da seção, ou ajuste automático para evitar sobreposição (A11)                                                                                                                       | Desenho mais limpo                                               | Mais um clique no fluxo. Precisa ser opcional                                                                |

### Roteiro para medir o tempo humano

Esta etapa não foi executada. Quem fizer deve usar o mesmo DXF, de preferência no Linux e no desktop Tauri, e cronometrar de “clique em Estribo” até “Enter final”:

1. Primeira vez, viga com faixa, com os critérios da seção 2.
2. Repetição com **E**, sem trocar critérios.
3. Pilar, somente seção, com os critérios da seção 4.

Para cada rodada, anotar o tempo, os retornos (Voltar ou Esc), as dúvidas e se o canto ou o centro do grampo foi encontrado na primeira tentativa.

## 8. Resumo do que foi e não foi executado

**Executado e aprovado:** lançamento na viga com faixa, lançamento no pilar somente seção, grampo de pilar S, prévia, Enter e botão de confirmação, Esc, Voltar etapa, Desfazer/Refazer, zoom e ajuste no meio do comando, coordenadas digitadas, validação de cobrimento inválido, persistência de critérios, recuperação local e quadro de aço.

**Executado com problema:** erro de encaixe sem aviso (A1), grampo fora do pilar (A2), separadores decimais (A3) e critérios no meio do comando (A4).

**Não executado:** Linux, desktop Tauri, toque, operador humano e tempos humanos; famílias circular, livre e grampo C; contorno aberto; faixa inclinada ou inválida; “Editar critérios desta posição”; salvar e reabrir o arquivo (só a recuperação local foi observada); exportação PDF/DXF.

## 9. Relação com outras issues

- **#132** (4/6 ramos): não está implementado. A janela de critérios informa “Ramos múltiplos e abas de laje ficam para outra entrega”. Só referenciada aqui.
- **#133** (grampos S/C): implementada e fechada. O grampo S foi testado acima e os achados A2 e A11 se aplicam a ele.
- **#175** (travamento/PAN): não houve travamento no Windows com este projeto pequeno. Isso não vale como evidência para Linux.
- **#174** (ícones): a descoberta pelo ícone compacto se mostrou adequada graças à dica. Não proponho mudança de ícone.
- **#176** e PR #194 (ocultar traços da faixa): tratam a representação da faixa e não se sobrepõem a estes achados.
- **#179** (Repetir estribo): é outro comando e não foi avaliado aqui.
