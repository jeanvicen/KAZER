# Controle de notificações globais

Edite o arquivo `notificacao.json` diretamente no GitHub. O KAZER apenas lê esse arquivo; ele nunca escreve ou altera o JSON.

- `ativo`: use `true` para mostrar a novidade ou `false` para desligá-la para todos.
- `versao`: aumente o número quando publicar um anúncio novo. Assim, todos os usuários verão a nova versão novamente.
- `titulo`: título curto que aparecerá no aviso e no histórico.
- `mensagem`: texto principal da novidade.

Para publicar outro anúncio, altere `ativo`, `versao`, `titulo` e `mensagem`, depois faça commit no GitHub. Para desligar, use `"ativo": false`.
