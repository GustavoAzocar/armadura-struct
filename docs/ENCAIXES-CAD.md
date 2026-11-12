# Encaixes de objetos no CAD 2D

Abra **CONFIGURAÇÕES → Preferências → Modos de encaixe**, use o botão **⋮** junto de **ENCAIXES** na barra inferior ou digite `OSNAP` / `MODOSENCAIXE`. Marque os modos e escolha **Aplicar modos**. Cancelar descarta o rascunho da janela; Restaurar padrões deixa apenas Extremidade e Ponto médio ligados.

As escolhas valem para a sessão do aplicativo, sem alterar o projeto, o histórico ou seu formato. O comando **Encaixes**, disponível nos acessos anteriores e com atalho padrão **F3**, continua ligando/desligando a captura inteira. A tecla pode ser reatribuída na central de atalhos. Os novos modos começam desativados.

O marcador mostra o modo e o ponto efetivamente capturado. Prévia e clique usam a mesma resolução, em coordenadas do modelo, com abertura de **10 pixels** convertida pelo zoom. **ORTO conserva a precedência anterior**: se a restrição deslocar o ponto mais de 0,001 mm, o marcador é suprimido e o ponto aplicado é o ortogonal.

## Modos por pontos e curvas — #163

| Modo               | Geometria elegível                                                   | Limites                                                                                                                    |
| ------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Extremidade        | Vértices e pontos já capturáveis das cadeias existentes              | Preserva a semântica anterior, inclusive pontos amostrados; não os converte em Nó.                                         |
| Ponto médio        | Meio dos trechos já disponíveis                                      | Mesmos trechos e ordem de desempate da implementação anterior.                                                             |
| Centro             | Círculo ou arco analítico                                            | Não infere centros de polilinhas amostradas.                                                                               |
| Centro geométrico  | Contorno fechado válido ou círculo analítico                         | Centro de área, não média de vértices. Contornos abertos, degenerados, autocruzados ou sobrepostos não oferecem candidato. |
| Quadrante          | Círculo ou arco analítico                                            | Direções dos eixos do modelo a 0°, 90°, 180° e 270°; em arcos, apenas dentro da varredura.                                 |
| Interseção         | Trechos finitos e curvas analíticas disponíveis                      | Sem prolongamento; sobreposições colineares e círculos coincidentes não produzem um ponto arbitrário.                      |
| Ponto mais próximo | Geometria efetivamente disponível                                    | Projeção limitada ao trecho/arco; em importações amostradas, usa a aproximação retida.                                     |
| Inserção           | Âncora preservada de texto nativo ou texto normalizado da importação | Não usa o centro da caixa do texto nem tenta reconstruir inserções de blocos expandidos.                                   |
| Nó                 | Entidade de ponto identificável                                      | O formato/importador atuais não expõem essa entidade. O modo não oferece candidatos a partir de vértices ou de amostras.   |

Os pontos discretos dentro da abertura têm prioridade sobre Ponto mais próximo. Entre eles vence a menor distância ao cursor; empates mantêm a ordem estável da cena, com os pontos extras dos comandos antes das cadeias antigas. Interseções usam ordem determinística dos pares. Um centroide de polígono importado descreve a **área da aproximação retida**, não o centro analítico de uma curva perdida.

### Máscaras, captura e proteção

As máscaras têm origem, escala e rotação aplicadas uma única vez. Centros, quadrantes e cruzamentos são resolvidos no referencial do modelo, independentemente de pan e zoom. Novos modos compartilham a elegibilidade de captura do canvas: objetos/camadas indisponíveis não participam. Capturar uma referência somente de leitura não a torna editável.

O DXF/DWG pode conter apenas cadeias amostradas após a normalização. Nesses casos não há centro, quadrante ou outra informação analítica reconstruída. Blocos expandidos não recebem âncoras inventadas. Não houve alteração no importador nem migração do arquivo de projeto.

### Cena densa

Os índices espaciais são preparados quando a cena muda e reutilizados durante movimento do cursor e navegação. A busca de interseções considera somente as curvas junto da abertura de captura. Em uma abertura excepcionalmente saturada, o limite de 250 mil comparações interrompe a busca de interseções e informa para aproximar o zoom; um vencedor parcial dessa busca não é mostrado como se fosse definitivo. Os outros modos continuam disponíveis.

## Conferência

Os testes de domínio incluem os casos numéricos literais das issues, comparação com o resolvedor antigo, curvas finitas, contornos inválidos, âncoras, transformações e uma cena de 20 mil entidades. As regressões de navegador verificam marcador, prévia e coordenada gravada em dois zooms, F3, ORTO, captura protegida e ausência de mudanças no projeto ao configurar modos. A calibração por dois pontos permanece coberta por sua suíte existente.

![Modos de encaixe](object-snaps-modes.png)

![Centro de círculo no CAD](object-snaps-center.png)

![Interseção em máscara importada transformada](object-snaps-transformed.png)

Referência de comportamento: [modos de encaixe da Autodesk](https://help.autodesk.com/cloudhelp/ENU/AutoCAD-Web-Help/files/Drafting-and-Creating/AutoCAD_Web_Help_Drafting_and_Creating_Osnap_html.html). A entrega é limitada ao CAD 2D; não implementa interseção aparente por profundidade nem rastreamento F11.
