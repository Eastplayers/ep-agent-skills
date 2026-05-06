# replit.md Steering Structure

Use this structure when root `replit.md` is absent and Kiro steering files must be generated.

If root `replit.md` exists, copy it exactly to `.kiro/steering/overview.md` instead of generating this template.

````markdown
# Workspace

## Overview

[Short product/repository summary. Mention monorepo shape, project type, and primary user-facing purpose.]

## Stack

- **Monorepo tool**: [workspace tool]
- **Node.js version**: [version if known]
- **Package manager**: [npm/pnpm/yarn]
- **TypeScript version**: [version if known]
- **API framework**: [framework if present]
- **Database**: [database/ORM if present]
- **Validation**: [validation library if present]
- **API codegen**: [tool if present]
- **Build**: [build tool]
- **Frontend**: [frontend framework]
- **Routing**: [routing library if present]

## Brand

- **Primary**: [primary color/role if known]
- **Secondary**: [secondary color/role if known]
- **Text**: [text color/role if known]

## Structure

```text
project/
├── artifacts/              # Deployable applications
├── lib/                    # Shared libraries
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
````

## Pages

- `/` — [Homepage or main page if present]
- `[route]` — [purpose]

## API Endpoints

- `GET /api/healthz` — health check
- `[METHOD] [path]` — [purpose]

## TypeScript & Composite Projects

[Describe project references, typecheck rules, and whether typecheck should run from root.]

## Root Scripts

- `[package-manager] run build` — [build behavior]
- `[package-manager] run typecheck` — [typecheck behavior]

## Packages

### `[package path]` (`[package name]`)

[Short package purpose.]

- `[package-manager] --filter [package name] run dev` — dev server
- `[package-manager] --filter [package name] run build` — production build
```
