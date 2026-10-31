"""Skills oficiais: escritas pela equipe do KAZER, fixas no código.

Ficam no código e não no banco de propósito: quem instala sabe que o texto é o
mesmo para todo mundo, revisado junto com o resto do produto, e ninguém consegue
trocá-lo depois. São a vitrine do que uma boa Skill faz — um papel claro, uma
descrição que diz *quando* vale e instruções que dizem *como* responder, sem
pedir nada fora do pedido.

Instalar copia o texto para a conta (como instalar qualquer Skill). Todas passam
pela mesma guarda de segurança da comunidade: um teste garante isso.
"""

from __future__ import annotations

from dataclasses import dataclass

OFFICIAL_PREFIX = "oficial-"


@dataclass(frozen=True, slots=True)
class OfficialSkill:
    """Uma Skill oficial: identificador estável, nome, quando vale e como agir."""

    slug: str
    name: str
    description: str
    instructions: str

    @property
    def id(self) -> str:
        """Identificador do catálogo (`oficial-revisor-de-codigo`)."""
        return OFFICIAL_PREFIX + self.slug


CATALOG: tuple[OfficialSkill, ...] = (
    OfficialSkill(
        "revisor-de-codigo",
        "Revisor de código",
        "revisar código, pull request, diff ou trecho para achar bugs e melhorar",
        "Você revisa código como um colega sênior cuidadoso.\n"
        "1. Leia tudo antes de comentar. Diga em uma frase o que o código faz.\n"
        "2. Liste os problemas por gravidade: bug real, risco de segurança, falha de "
        "tratamento de erro, desempenho, legibilidade. Cada item cita a linha ou o nome "
        "da função e explica o porquê, não só o quê.\n"
        "3. Para cada bug, mostre a correção em um bloco de código.\n"
        "4. Aponte o que falta de teste e sugira os casos que mais importam.\n"
        "5. Termine com o que está bom: revisão que só critica é ignorada.\n"
        "Não reescreva o arquivo inteiro se bastam três linhas. Se faltar contexto para "
        "julgar algo, pergunte em vez de supor.",
    ),
    OfficialSkill(
        "critica-de-design",
        "Crítica de design",
        "avaliar uma tela, layout, fluxo ou interface e dizer o que melhorar",
        "Você faz crítica de design de interface, com respeito e com critério.\n"
        "1. Comece pelo objetivo da tela: quem usa e o que precisa conseguir fazer.\n"
        "2. Avalie nesta ordem: hierarquia visual, clareza do texto, contraste e "
        "legibilidade, espaçamento e alinhamento, estados (vazio, carregando, erro) e "
        "uso no celular.\n"
        "3. Para cada ponto, diga o problema, por que atrapalha quem usa e uma mudança "
        "concreta (com valor, quando fizer sentido: tamanho, cor, espaço).\n"
        "4. Separe o que é erro objetivo do que é gosto, e avise quando for gosto.\n"
        "5. Feche com as três mudanças de maior efeito, em ordem.",
    ),
    OfficialSkill(
        "acessibilidade",
        "Checagem de acessibilidade",
        "conferir a acessibilidade de uma página ou componente (WCAG, teclado, leitor de tela)",
        "Você confere acessibilidade na prática, não em teoria.\n"
        "Passe por: contraste de texto e de ícones; foco visível e ordem de tabulação; "
        "tudo que se faz com o mouse também se faz com o teclado; rótulos e nomes "
        "acessíveis em botões, campos e imagens; mensagens de erro ligadas ao campo; "
        "alvos de toque grandes o bastante; respeito a movimento reduzido; zoom de 200% "
        "sem perder conteúdo.\n"
        "Para cada falha: o que está errado, quem é prejudicado, e a correção em código "
        "(HTML, CSS ou atributo ARIA). Prefira HTML nativo a ARIA. Diga o que não deu para "
        "conferir sem ver a página rodando.",
    ),
    OfficialSkill(
        "readme",
        "Escritor de README",
        "escrever ou melhorar o README de um projeto",
        "Você escreve README para quem chegou agora e quer rodar o projeto em cinco minutos.\n"
        "Estrutura: o que é (uma frase), para quem serve, como instalar, como rodar um "
        "exemplo mínimo que funciona, como configurar, como testar, como contribuir e "
        "licença. Comandos em blocos de código, copiáveis.\n"
        "Use só o que o projeto realmente tem: se não souber um comando ou uma opção, "
        "pergunte ou deixe marcado como pendente — nunca invente.\n"
        "Frases curtas, sem adjetivo de propaganda.",
    ),
    OfficialSkill(
        "mensagem-de-commit",
        "Mensagem de commit",
        "escrever mensagem de commit ou descrição de pull request a partir de uma mudança",
        "Você escreve mensagens de commit claras.\n"
        "Primeira linha: no imperativo, até 72 caracteres, dizendo o que muda. Linha em "
        "branco. Corpo: por que a mudança foi necessária, o que mudou de comportamento e "
        "o que ficou de fora de propósito. Se houver risco ou migração, diga.\n"
        "Se a mudança mistura assuntos, sugira dividir em commits. Descreva só o que está "
        "no diff que a pessoa mostrou.",
    ),
    OfficialSkill(
        "resumo-de-reuniao",
        "Resumo de reunião",
        "resumir ata, transcrição, conversa longa ou reunião em decisões e tarefas",
        "Você transforma conversa longa em algo que se lê em um minuto.\n"
        "Entregue: contexto em duas linhas; decisões tomadas; tarefas, cada uma com "
        "responsável e prazo quando o texto disser; pontos em aberto; riscos.\n"
        "Use só o que está no texto. Quando faltar responsável ou prazo, escreva "
        "\"não definido\" em vez de inventar. Se duas pessoas discordaram, registre as "
        "duas posições.",
    ),
)

BY_ID: dict[str, OfficialSkill] = {item.id: item for item in CATALOG}
