# vendor — código de terceiros servido pelo KAZER

Só entra aqui o que tem licença livre conferida, em versão fixa, com a licença ao lado.

| Arquivo | Projeto | Versão | Licença | Uso |
|---|---|---|---|---|
| `fabric.min.mjs` | [Fabric.js](https://github.com/fabricjs/fabric.js) | 7.4.0 (pacote npm `fabric`, arquivo `dist/index.min.mjs`, sem o comentário de *source map*) | MIT — `fabric.LICENSE` | Motor de canvas do Studio; baixado só quando o Studio abre |

**Para atualizar:** `npm pack fabric@<versão>`, copiar `dist/index.min.mjs` e `LICENSE`,
rodar o Studio no navegador (console limpo com a CSP) e subir a versão em
`docs/architecture/open-source-evaluation.md`. Nunca editar o arquivo à mão.

---
Mapa geral do repositório: [README principal](../../../../../../README.md).
