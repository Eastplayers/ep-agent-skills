# EP Agent Skills

Internal Eastplayers agent skills for repeatable local engineering workflows.

This repository is organized as self-contained skill folders. Each skill should include a `SKILL.md` entrypoint and may include supporting `scripts/`, `references/`, `templates/`, or examples.

## Available Skills

| Skill | Purpose |
| --- | --- |
| `kiro-local-setup` | Help Kiro agents make JavaScript or TypeScript repositories runnable on a local machine, especially for users moving from Replit to Kiro. |

## Repository Layout

```text
.
└── kiro-local-setup/
    ├── SKILL.md
    ├── references/
    │   └── replit-md-structure.md
    └── scripts/
        └── kiro-local-setup.mjs
```

## Installation

Install a skill by giving the agent the GitHub URL for the skill folder, not only the repository root.

```text
https://github.com/<owner>/<repo>/tree/main/kiro-local-setup
```

Codex skill installer command:

```bash
python ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --url https://github.com/<owner>/<repo>/tree/main/kiro-local-setup
```

If the agent only receives the repository root URL, it must inspect the repository and choose the skill folder path before installing.

After installation, restart the agent runtime so the new skill is loaded.

## Kiro Local Setup

Use `kiro-local-setup` when auditing or preparing a JavaScript or TypeScript repository for local development. The skill focuses on:

- runtime checks for Node.js, npm, and pnpm
- dependency installation when requested
- Kiro steering file generation under `.kiro/steering/`
- `.gitignore` updates for local environment and agent state files
- missing `.env.example` generation from real environment-variable reads
- package-level typecheck verification
- copy-pasteable final run commands for non-technical users

Common helper commands:

```bash
node /Users/lannis/eastplayers/ep-agent-skills/kiro-local-setup/scripts/kiro-local-setup.mjs --root /path/to/repo --dry-run
node /Users/lannis/eastplayers/ep-agent-skills/kiro-local-setup/scripts/kiro-local-setup.mjs --root /path/to/repo --write-project-files --write-env
node /Users/lannis/eastplayers/ep-agent-skills/kiro-local-setup/scripts/kiro-local-setup.mjs --root /path/to/repo --install --write-project-files --write-env --typecheck
```

## Authoring Guidelines

When adding or changing skills:

- keep each skill folder self-contained
- make `SKILL.md` the primary entrypoint
- keep helper scripts runnable with the smallest practical runtime dependency
- prefer exact commands and verification steps over broad advice
- do not commit secrets or generated local state
- document any referenced templates or helper scripts inside the skill folder

## Verification

For the current helper script:

```bash
node kiro-local-setup/scripts/kiro-local-setup.mjs --help
```
