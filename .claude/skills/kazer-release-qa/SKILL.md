---
name: kazer-release-qa
description: Use before committing, merging to main or reporting work as done in the KAZER repository. Defines the release gates, the exact commands, how to report blocked checks honestly, and the safe Git workflow.
---

# KAZER release QA

## Gates (all must pass on the final commit)
```bash
ruff check .
pytest -q
python scripts/controle.py
find kazer/interfaces/web/static -name '*.js' -print0 | xargs -0 -n1 node --check
bash scripts/pg_test.sh        # SQL migrations + RLS/quota tests on a local Postgres (skips if unavailable)
```
Then: browser pass with Playwright at 390×844 and 1366×820 for every touched screen,
console/`pageerror` empty.

## Honest reporting
- A skipped or unavailable check is **NOT RUN / BLOCKED**, with the reason — never "passed".
- Never delete or weaken a failing test to get green. Fix the code or document why the
  test was wrong.
- Do not claim a deploy worked unless you verified it.

## Diff review before commit
- [ ] No secrets, tokens, real e-mails, `.env`, model weights or large binaries.
- [ ] No accidental deletions or unrelated formatting churn.
- [ ] Third-party code keeps its licence file; new dependency recorded in
      `docs/architecture/open-source-evaluation.md`.
- [ ] `sw.js` cache version bumped if shell files changed; `i18n-en.js` updated.
- [ ] `CHANGELOG.md` and the folder `README.md` updated.

## Git
Work on the feature branch; no force-push, no `reset --hard`, no `clean -fd`.
Fast-forward `main` only after the gates pass. Production migrations and env changes need
the owner's explicit approval — report them as pending otherwise.
