# Origem

`model.rs`, `storage.rs` e `platform.rs`: `ricardocorsini/launcher-struct`, commit `4edd68a3c36a4456f1517f41d7fb03777304e421`, crate launcher-core 0.2.4, licença MIT incluída. Fontes vendorizadas permitem compilação pública sem acesso ao repositório do publicador. Trust e catálogo assinado são cópias dos dados públicos já distribuídos; nenhuma chave foi criada/alterada.

Adaptações: `desktop.rs` atualiza somente o atalho gerenciado existente, preservando ícone e outros campos. Não inclui integração/ícones dos demais produtos. `platform.rs` acrescenta `install_update`, que reaproveita o instalador e usa `/UPDATE` no NSIS para preservar preferências/atalhos de uma instalação já existente. `updater.rs` acrescenta seleção, transporte limitado, consentimento e helper. O inventário mantém o contrato original `DiskState`/`Installed`, o lock e o salvamento atômico. Nunca acessar `state.json` sem o `launcher.lock` original.

A versão deste crate identifica a compatibilidade do núcleo reaproveitado para `minLauncherVersion`, não a versão mínima do produto. Ao sincronizar upstream, revisar vetores de assinatura e testes do inventário/instaladores; não migrar os outros aplicativos por inferência.
