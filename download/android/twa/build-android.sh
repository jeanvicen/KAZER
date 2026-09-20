#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYSTORE_PATH="${KEYSTORE_PATH:-$ROOT_DIR/.secrets/kazer-release.keystore}"
KEY_ALIAS="${KEY_ALIAS:-kazer-release}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
BUILD_TOOLS_VERSION="${BUILD_TOOLS_VERSION:-36.0.0}"

if [[ ! -f "$KEYSTORE_PATH" ]]; then
  echo "Chave de assinatura não encontrada: $KEYSTORE_PATH" >&2
  echo "Coloque sua chave privada nesse caminho ou defina KEYSTORE_PATH e KEY_ALIAS." >&2
  exit 1
fi

if [[ -z "${BUBBLEWRAP_KEYSTORE_PASSWORD:-}" ]]; then
  echo "Defina BUBBLEWRAP_KEYSTORE_PASSWORD somente no ambiente local/CI." >&2
  exit 1
fi

if [[ -z "${JAVA_HOME:-}" && -x "/usr/lib/jvm/java-21-openjdk-amd64/bin/java" ]]; then
  export JAVA_HOME="/usr/lib/jvm/java-21-openjdk-amd64"
fi

export ANDROID_HOME ANDROID_SDK_ROOT
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/build-tools/$BUILD_TOOLS_VERSION:$PATH"
cd "$ROOT_DIR"

./gradlew clean assembleRelease --no-daemon "$@"
UNSIGNED_APK="$ROOT_DIR/app/build/outputs/apk/release/app-release-unsigned.apk"
SIGNED_APK="$ROOT_DIR/app/build/outputs/apk/release/app-release-signed.apk"
apksigner sign \
  --ks "$KEYSTORE_PATH" \
  --ks-key-alias "$KEY_ALIAS" \
  --ks-pass "pass:$BUBBLEWRAP_KEYSTORE_PASSWORD" \
  --key-pass "pass:${BUBBLEWRAP_KEY_PASSWORD:-$BUBBLEWRAP_KEYSTORE_PASSWORD}" \
  --out "$SIGNED_APK" "$UNSIGNED_APK"
apksigner verify --verbose "$SIGNED_APK" >/dev/null
cp "$SIGNED_APK" "$ROOT_DIR/../kazer.apk"

echo "Build concluído: $SIGNED_APK"
echo "Cópia publicada para: $ROOT_DIR/../kazer.apk"
