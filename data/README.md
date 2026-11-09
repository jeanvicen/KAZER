# data — dados locais (fora do Git)

**O que é:** pasta de trabalho do KAZER **na sua máquina**. Em desenvolvimento,
o app grava aqui o banco SQLite das contas/conversas, anexos, logs e os e-mails
de teste (`data/outbox/*.eml`).

**Importante**
- Tudo aqui dentro é ignorado pelo Git (`.gitignore`: `data/*`), menos
  `.gitkeep` e este README. **Nunca** force o commit de dados reais.
- Em produção (Vercel) esta pasta não é usada: contas e conversas ficam no Supabase.
- Pode apagar o conteúdo para "zerar" o ambiente local (você perde as contas de teste).

---
Mapa geral do repositório: [README principal](../README.md).
