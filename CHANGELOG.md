# Histórico de versões

## Em desenvolvimento

- AS-02: agrupamento visual por detalhamento, seleção do conjunto, duplo clique no CAD/árvore, edição isolada com caminho de navegação e Concluir edição.
- Proteção de objetos externos em seleção, comandos, histórico e gravações assíncronas; desagrupar preserva dados físicos, IDs, vínculos e quantitativos. O deslocamento de um conjunto inclui suas chamadas, rebatimentos e demais geometrias associadas.
- AS-01: pavimentos, elementos e detalhamentos compostos com identidades estáveis; criação, edição, movimentação, exclusão de nós vazios e pesquisa no navegador compacto.
- Migração determinística dos formatos 1/2 para 3 sem transformar os objetos físicos ou rebatimentos nem alterar quantitativos; validação das referências ao reabrir.
- Objetos novos pertencem ao detalhamento ativo; transferência de barras inclui seus rebatimentos e chamadas. Desenhos lógicos e posicionamentos de folha ficam separados da geometria física.
- Hierarquia integrada ao salvamento, recuperação e desfazer/refazer; preferências de expansão da árvore persistem por projeto no dispositivo.

## 0.2.0 · 2026-11-06

- Ambiente de desenho com faixa compacta, painel lateral único com abas, recolhimento persistente e modo Foco no CAD.
- Parâmetros de criação acessíveis no topo: quantidade, bitola e espaçamento máximo.
- Polilinhas CAD e conversão de contornos próprios/importados em armaduras.
- Repetição de estribos e faixas ortogonais com quantitativo vinculado.
- Cotas ortogonais/alinhadas, chamadas e cortes gráficos retos/em arco; identificação vinculada às posições e exportação DXF/PDF.
- Divisão em trecho reto com traspasse manual contabilizado nas duas peças; união geométrica de poligonais compatíveis.
- Bloqueio/atualização da relação de aço, aviso de alterações pendentes e proteção contra exportação de quantitativos desatualizados.
- Renumeração mantendo vínculos, edição da posição dos rebatimentos, pavimento/revisão e PDF A3 em escala.
- Migração de projetos 0.1 para o formato 2, preservando barras e máscaras.
- Testes de geometria, quantitativos, persistência e fluxos CAD; importação DXF/DWG mantida.

Os comprimentos de traspasse são informados pelo projetista. Esta versão não dimensiona emendas, ancoragens ou elementos estruturais.

## 0.1.1

- Identidade própria de Hefesto, ícones nativos e primeira distribuição assinada pelo Struct Launcher para Windows e Linux.

## 0.1.0

- CAD inicial, barras e estribos, rebatimentos, máscaras DXF/DWG, quadro de aço e exportações.
