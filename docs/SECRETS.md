# Secrets management

| Environment          | Where secrets live                                                                                                                  | Who manages                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Source of truth      | Owner's vault (today: the workspace `.secrets/` folder, outside any git repo, mode 700). Target: a password manager with CLI access | Owner                                            |
| Local development    | `.env.local` at the repo root — mode 600, git-ignored, loaded automatically by `@turbineh/shared`                                   | Generated from the vault; never edited into docs |
| CI                   | GitHub Actions encrypted secrets (only what CI needs; today none)                                                                   | Owner                                            |
| Staging / production | Platform secret stores (hosting env vars / cloud secret manager), per environment, least privilege                                  | Owner                                            |

## Rules

1. Only the keys a module actually uses go into `.env.local` (least privilege). Today: `TYPESAFE_API_KEY`,
   `GITHUB_TOKEN`; backup/compiler provider keys when configured.
2. Secrets are never printed, logged (the logger redacts key/token/secret/password fields), committed or pasted
   into documents or chat.
3. gitleaks runs in pre-commit and on the full history in CI. A leaked key is rotated immediately, then removed.
4. Third-party code runs only in sandboxes without real secrets.
5. Each key has an owner and a rotation date; tokens are fine-grained and scoped to the minimum (e.g. GitHub token
   limited to the repositories it must touch).
