#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYSTORE_PATH="${KEYSTORE_PATH:-$ROOT_DIR/.secrets/kazer-dev.keystore}"
KEY_ALIAS="${KEY_ALIAS:-kazer-dev}"

if [[ ! -f "$KEYSTORE_PATH" ]]; then
  echo "Chave de assinatura não encontrada: $KEYSTORE_PATH" >&2
  echo "Coloque sua chave privada nesse caminho ou defina KEYSTORE_PATH e KEY_ALIAS." >&2
  exit 1
fi

if [[ -z "${BUBBLEWRAP_KEYSTORE_PASSWORD:-}" || -z "${BUBBLEWRAP_KEY_PASSWORD:-}" ]]; then
  echo "Defina BUBBLEWRAP_KEYSTORE_PASSWORD e BUBBLEWRAP_KEY_PASSWORD somente no ambiente local/CI." >&2
  exit 1
fi

if [[ -z "${JAVA_HOME:-}" && -x "/usr/lib/jvm/java-17-openjdk-amd64/bin/java" ]]; then
  export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
fi

export PATH="$JAVA_HOME/bin:$PATH"
cd "$ROOT_DIR"
npx --yes @bubblewrap/cli@latest build --manifest="$ROOT_DIR/twa-manifest.json" "$@"

echo "Build concluído. Procure por app-release-signed.apk e app-release-bundle.aab neste diretório."
