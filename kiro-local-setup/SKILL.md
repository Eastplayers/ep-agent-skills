---
name: kiro-local-setup
description: Help Kiro agents onboard non-technical internal users moving from Replit to Kiro by making JavaScript or TypeScript repositories runnable on a local machine. Use when asked to set up, audit, or explain local running steps for a repo, especially pnpm workspaces, Replit artifacts, missing .env.example files, Node/npm/pnpm checks, environment-variable discovery, and per-package typecheck verification.
---

# Kiro Local Setup

Use this skill in Kiro to reduce local setup overhead for non-technical internal users moving from Replit to Kiro. Optimize for concrete terminal commands, exact missing prerequisites, and copy-pasteable next steps.

## Workflow

1. Confirm repository root:
   - Run `pwd`.
   - If user named a repo/path, treat it as hard scope.
   - Do not edit unrelated sibling repos.

2. Verify local JavaScript runtime:
   - Run `node -v`.
   - Run `npm -v`.
   - If either command is missing, stop and tell user to install Node.js LTS or project-required Node version before continuing.

3. Detect package manager:
   - Check for `pnpm-workspace.yaml`, `pnpm-lock.yaml`, or package scripts using `pnpm`.
   - If repo uses pnpm, run `pnpm -v`.
   - If pnpm is missing, install with `npm i -g pnpm`, then rerun `pnpm -v`.
   - Do not silently switch package managers.

4. Install dependencies:
   - For pnpm repos, run `pnpm install`.
   - Preserve lockfiles. Do not delete or regenerate lockfiles unless requested.

5. Prepare Kiro steering files:
   - Check whether `replit.md` exists in the root project directory.
   - If `replit.md` exists, copy it to `{PROJECT_DIR}/.kiro/steering/overview.md`.
   - If `replit.md` does not exist, generate missing steering files under `{PROJECT_DIR}/.kiro/steering/`.
   - Generated `overview.md` must follow `references/replit-md-structure.md`.
   - At minimum, ensure `overview.md`, `project-overview.md`, and `system-architecture.md` exist when `replit.md` is absent.
   - Do not overwrite existing generated steering files unless the user asks.

6. Create or update root `.gitignore`:
   - Ensure `.env` is ignored.
   - Also include `.claude/` and `.superset/`.
   - If `.gitignore` exists, append only missing required entries.
   - If `.gitignore` is missing, create a practical JavaScript/TypeScript `.gitignore`.
   - Do not ignore `.env.example`.

7. Create missing `.env.example` files:
   - For each deployable artifact/package, check whether `.env.example` exists.
   - If missing, scan source for real env reads such as `process.env.X`, `process.env["X"]`, and `import.meta.env.X`.
   - Include env defaults from Replit artifact config when present, especially `PORT` and `BASE_PATH`.
   - Write only missing `.env.example` files unless user asks to update existing files.
   - Use blank values for secrets. Use obvious local defaults only when repo config already declares them.

8. Explain `.env` creation to non-technical user:
   - Tell them to copy `.env.example` to `.env` in each artifact that needs it.
   - List which variables need real secret values.
   - List which variables have safe local defaults.

9. Run verification:
   - Run typecheck for each JavaScript/TypeScript package that defines a `typecheck` script.
   - For pnpm packages, prefer `pnpm --filter <package-name> run typecheck`.
   - If no package-specific typecheck exists, run root `pnpm run typecheck` when available.
   - If typecheck fails, report exact package and command. Do not claim repo is ready.

10. Give final run commands:
   - Include one command block per terminal.
   - Include exact URLs to open.
   - Mention optional integrations separately from required setup.

## Helper Script

Use `scripts/kiro-local-setup.mjs` from this skill when the repo is JavaScript/TypeScript and the user wants setup done or audited. It runs with Node.js only, which is already part of the setup requirement. Do not require Python.

Common commands:

```bash
node /path/to/kiro-local-setup/scripts/kiro-local-setup.mjs --root /path/to/repo --dry-run
node /path/to/kiro-local-setup/scripts/kiro-local-setup.mjs --root /path/to/repo --write-project-files --write-env
node /path/to/kiro-local-setup/scripts/kiro-local-setup.mjs --root /path/to/repo --install --write-project-files --write-env --typecheck
```

Script behavior:
 - Verifies `node`, `npm`, and `pnpm` when repo uses pnpm.
 - Installs pnpm with `npm i -g pnpm` only when repo uses pnpm and pnpm is missing.
 - Runs dependency install only when `--install` is passed.
 - Finds package roots from `package.json`, excluding `node_modules`, `dist`, and generated folders.
 - Treats `artifacts/*/package.json` as deployable artifacts.
 - Copies root `replit.md` to `.kiro/steering/overview.md` when present.
 - Generates missing `.kiro/steering/overview.md`, `.kiro/steering/project-overview.md`, and `.kiro/steering/system-architecture.md` when root `replit.md` is absent.
 - Makes generated `overview.md` and `project-overview.md` mimic `references/replit-md-structure.md`.
 - Creates or updates root `.gitignore` so `.env`, `.claude/`, and `.superset/` are ignored.
 - Creates missing `.env.example` files from actual env reads plus `.replit-artifact/artifact.toml` service env.
 - Runs package typechecks when `--typecheck` is passed.

## Output Style

For non-technical users:
 - Prefer "Run this command" over conceptual explanation.
 - Group commands by terminal window.
 - Mark required vs optional env vars.
 - Avoid tool jargon unless it appears in the command.
 - If blocked, state one concrete next action.

## Guardrails

 - Do not commit secrets into `.env.example`.
 - Do not create `.env` with real secrets unless the user explicitly provides them and asks.
 - Do not ignore `.env.example`.
 - Do not overwrite existing Kiro steering files unless requested.
 - Do not modify existing `.env.example` files unless requested.
 - Do not patch application code while doing setup unless user asks to fix setup failures.
 - Do not run destructive cleanup commands.
