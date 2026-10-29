"""Hash de senhas com Argon2id; nenhuma criptografia própria."""

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError


class PasswordHashing:
    """Envoltório mínimo sobre `argon2-cffi` (Argon2id, perfil RFC 9106)."""

    def __init__(self, hasher: PasswordHasher | None = None) -> None:
        """Usa os parâmetros padrão da biblioteca salvo injeção explícita em testes."""
        self._hasher = hasher or PasswordHasher()
        # Hash fixo para igualar o tempo de resposta quando a conta não existe.
        self._dummy_hash = self._hasher.hash("kazer-timing-equalizer")

    def hash(self, password: str) -> str:
        """Gera hash com salt aleatório embutido no formato PHC."""
        return self._hasher.hash(password)

    def verify(self, stored_hash: str, password: str) -> bool:
        """Compara em tempo constante via biblioteca; nunca lança para senha errada."""
        try:
            return self._hasher.verify(stored_hash, password)
        except (VerificationError, InvalidHashError):
            return False

    def burn(self, password: str) -> None:
        """Executa uma verificação descartável para não revelar contas inexistentes."""
        self.verify(self._dummy_hash, password)

    def needs_rehash(self, stored_hash: str) -> bool:
        """Indica se o hash usa parâmetros mais fracos que os atuais."""
        try:
            return self._hasher.check_needs_rehash(stored_hash)
        except InvalidHashError:
            return True
