#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([
  ".git",
  ".cache",
  ".local",
  ".turbo",
  ".next",
  ".output",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "out-tsc",
  "tmp",
]);

const SOURCE_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
const VITE_BUILT_INS = new Set(["BASE_URL", "MODE", "DEV", "PROD", "SSR"]);
const SECRET_HINTS = ["SECRET", "TOKEN", "KEY", "PASSWORD", "CREDENTIAL", "PRIVATE"];
const ENV_PATTERNS = [
  /\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /\bprocess\.env\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\]/g,
  /\bimport\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
];

function parseArgs(argv) {
  const args = {
    root: ".",
    dryRun: false,
    writeEnv: false,
    writeProjectFiles: false,
    install: false,
    typecheck: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--write-env") args.writeEnv = true;
    else if (arg === "--write-project-files") args.writeProjectFiles = true;
    else if (arg === "--install") args.install = true;
    else if (arg === "--typecheck") args.typecheck = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
node scripts/kiro-local-setup.mjs --root /path/to/repo --dry-run
node scripts/kiro-local-setup.mjs --root /path/to/repo --write-project-files --write-env
node scripts/kiro-local-setup.mjs --root /path/to/repo --install --write-project-files --write-env --typecheck`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function run(cmd, args, cwd) {
  return spawnSync(cmd, args, { cwd, encoding: "utf8", shell: false });
}

function printResult(label, result) {
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const status = result.status === 0 ? "OK" : "FAIL";
  console.log(`[${status}] ${label}: ${output || "no output"}`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function repoUsesPnpm(root) {
  if (existsSync(path.join(root, "pnpm-workspace.yaml")) || existsSync(path.join(root, "pnpm-lock.yaml"))) {
    return true;
  }
  const pkgPath = path.join(root, "package.json");
  if (!existsSync(pkgPath)) return false;
  const scripts = readJson(pkgPath).scripts || {};
  return Object.values(scripts).some((value) => typeof value === "string" && value.includes("pnpm"));
}

function verifyRuntime(root, usesPnpm) {
  const missing = [];
  for (const cmd of ["node", "npm"]) {
    const result = run(cmd, ["-v"], root);
    if (result.status === 0) printResult(cmd, result);
    else missing.push(cmd);
  }
  if (missing.length) {
    throw new Error(`Missing required command(s): ${missing.join(", ")}. Install Node.js first, then rerun.`);
  }

  if (!usesPnpm) return;

  const pnpmResult = run("pnpm", ["-v"], root);
  if (pnpmResult.status === 0) {
    printResult("pnpm", pnpmResult);
    return;
  }

  console.log("[INFO] pnpm not found. Installing with: npm i -g pnpm");
  const install = run("npm", ["i", "-g", "pnpm"], root);
  printResult("npm i -g pnpm", install);
  if (install.status !== 0) {
    throw new Error("Failed to install pnpm. Fix npm global install permissions, then rerun.");
  }
  printResult("pnpm", run("pnpm", ["-v"], root));
}

function shouldSkip(filePath, root) {
  const rel = path.relative(root, filePath);
  if (rel.startsWith("..")) return true;
  return rel.split(path.sep).some((part) => SKIP_DIRS.has(part) || part.startsWith(".generated"));
}

function walkFiles(dir, root, predicate, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (shouldSkip(full, root)) continue;
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, root, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function discoverPackages(root) {
  return walkFiles(root, root, (file) => path.basename(file) === "package.json")
    .map((pkgPath) => {
      const pkg = readJson(pkgPath);
      const dir = path.dirname(pkgPath);
      const relParts = path.relative(root, dir).split(path.sep);
      const deps = new Set();
      for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        for (const [name, version] of Object.entries(pkg[section] || {})) {
          if (version === "workspace:*") deps.add(name);
        }
      }
      return {
        path: dir,
        name: pkg.name || path.relative(root, dir) || "root",
        scripts: pkg.scripts || {},
        workspaceDeps: deps,
        isArtifact: relParts.length >= 2 && relParts[0] === "artifacts",
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function envVarsFromSources(packageDir, root) {
  const found = new Set();
  const files = walkFiles(packageDir, root, (file) => SOURCE_EXTS.has(path.extname(file)));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const pattern of ENV_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        if (!VITE_BUILT_INS.has(match[1])) found.add(match[1]);
      }
    }
  }
  return found;
}

function packageEnvVars(pkg, root, packageByName, seen = new Set()) {
  if (seen.has(pkg.name)) return new Set();
  seen.add(pkg.name);
  const found = envVarsFromSources(pkg.path, root);
  for (const depName of pkg.workspaceDeps) {
    const dep = packageByName.get(depName);
    if (!dep) continue;
    for (const name of packageEnvVars(dep, root, packageByName, seen)) found.add(name);
  }
  return found;
}

function envDefaultsFromArtifactToml(packageDir) {
  const tomlPath = path.join(packageDir, ".replit-artifact", "artifact.toml");
  if (!existsSync(tomlPath)) return new Map();
  const defaults = new Map();
  const lines = readFileSync(tomlPath, "utf8").split(/\r?\n/);
  let inEnvBlock = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      inEnvBlock = line.endsWith(".env]") || line === "[services.env]";
      continue;
    }
    if (!inEnvBlock) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/);
    if (match) defaults.set(match[1], match[2]);
  }
  return defaults;
}

function isSecret(name) {
  const upper = name.toUpperCase();
  return SECRET_HINTS.some((hint) => upper.includes(hint));
}

function renderEnvExample(names, defaults) {
  const sorted = [...new Set([...names, ...defaults.keys()])].sort();
  const lines = [
    "# Generated from source environment-variable usage.",
    "# Copy this file to .env, then fill required values.",
    "",
  ];
  for (const name of sorted) {
    const value = isSecret(name) ? "" : defaults.get(name) || "";
    lines.push(`${name}=${value}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function writeEnvExamples(root, packages, writeEnv) {
  const packageByName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  let targets = packages.filter((pkg) => pkg.isArtifact);
  if (!targets.length) targets = packages.filter((pkg) => pkg.path !== root);
  if (!targets.length) targets = packages.filter((pkg) => pkg.path === root);

  for (const pkg of targets) {
    const envExample = path.join(pkg.path, ".env.example");
    const rel = path.relative(root, pkg.path) || ".";
    if (existsSync(envExample)) {
      console.log(`[OK] ${rel}/.env.example exists`);
      continue;
    }

    const names = packageEnvVars(pkg, root, packageByName);
    const defaults = envDefaultsFromArtifactToml(pkg.path);
    for (const name of defaults.keys()) names.add(name);

    if (!names.size) {
      console.log(`[INFO] ${rel}: no env vars found; no .env.example needed`);
      continue;
    }

    const content = renderEnvExample(names, defaults);
    if (writeEnv) {
      writeFileSync(envExample, content);
      console.log(`[WRITE] Created ${envExample}`);
    } else {
      console.log(`[DRY] Would create ${envExample}`);
      console.log(content);
    }
  }
}

function packageManagerName(usesPnpm) {
  return usesPnpm ? "pnpm" : "npm";
}

function readPackageJsonSafe(packageDir) {
  const pkgPath = path.join(packageDir, "package.json");
  if (!existsSync(pkgPath)) return {};
  try {
    return readJson(pkgPath);
  } catch {
    return {};
  }
}

function collectDependencyNames(packages) {
  const names = new Set();
  for (const pkg of packages) {
    const json = readPackageJsonSafe(pkg.path);
    for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const name of Object.keys(json[section] || {})) names.add(name);
    }
  }
  return names;
}

function hasAny(deps, names) {
  return names.some((name) => deps.has(name));
}

function stackLines(packages, usesPnpm) {
  const deps = collectDependencyNames(packages);
  const lines = [
    `- **Monorepo tool**: ${usesPnpm ? "pnpm workspaces" : "package.json workspaces or single package"}`,
    `- **Package manager**: ${packageManagerName(usesPnpm)}`,
  ];
  if (hasAny(deps, ["typescript"])) lines.push("- **Language**: TypeScript");
  if (hasAny(deps, ["express"])) lines.push("- **API framework**: Express");
  if (hasAny(deps, ["drizzle-orm"])) lines.push("- **Database**: Drizzle ORM");
  if (hasAny(deps, ["zod", "drizzle-zod"])) lines.push("- **Validation**: Zod");
  if (hasAny(deps, ["orval"])) lines.push("- **API codegen**: Orval");
  if (hasAny(deps, ["esbuild"])) lines.push("- **Build**: esbuild");
  if (hasAny(deps, ["react"])) lines.push("- **Frontend**: React");
  if (hasAny(deps, ["vite"])) lines.push("- **Frontend build**: Vite");
  if (hasAny(deps, ["tailwindcss", "@tailwindcss/vite"])) lines.push("- **Styling**: TailwindCSS");
  if (hasAny(deps, ["wouter"])) lines.push("- **Routing**: wouter");
  return lines.join("\n");
}

function structureTree(root, packages) {
  const artifacts = packages.filter((pkg) => pkg.isArtifact);
  const libs = packages.filter((pkg) => !pkg.isArtifact && pkg.path !== root);
  const artifactLines = artifacts.map((pkg) => `│   ├── ${path.relative(path.join(root, "artifacts"), pkg.path)}/`.replace("├──", "├──"));
  const libLines = libs
    .filter((pkg) => path.relative(root, pkg.path).startsWith("lib/"))
    .map((pkg) => `│   ├── ${path.relative(path.join(root, "lib"), pkg.path)}/`);
  return [
    "project/",
    artifacts.length ? "├── artifacts/              # Deployable applications" : "├── artifacts/              # Deployable applications (none detected)",
    ...artifactLines,
    libs.length ? "├── lib/                    # Shared libraries" : "├── lib/                    # Shared libraries (none detected)",
    ...libLines,
    "├── scripts/                # Utility scripts",
    "├── pnpm-workspace.yaml",
    "├── tsconfig.base.json",
    "├── tsconfig.json",
    "└── package.json",
  ].join("\n");
}

function packageSection(root, pkg, usesPnpm) {
  const rel = path.relative(root, pkg.path) || ".";
  const scripts = [];
  if (pkg.scripts.dev) scripts.push(`- \`${packageManagerName(usesPnpm)} --filter ${pkg.name} run dev\` — dev server`);
  if (pkg.scripts.build) scripts.push(`- \`${packageManagerName(usesPnpm)} --filter ${pkg.name} run build\` — production build`);
  if (pkg.scripts.typecheck) scripts.push(`- \`${packageManagerName(usesPnpm)} --filter ${pkg.name} run typecheck\` — typecheck`);
  if (!scripts.length) scripts.push("- No standard local scripts detected.");
  return `### \`${rel}\` (${pkg.name})

${pkg.isArtifact ? "Deployable application/package." : "Shared workspace package."}

${scripts.join("\n")}`;
}

// Keep heading order aligned with references/replit-md-structure.md.
// If root replit.md exists, the script copies it instead of using this fallback.
function renderReplitStyleOverview(root, packages, usesPnpm) {
  const rootPackage = packages.find((pkg) => pkg.path === root);
  const artifacts = packages.filter((pkg) => pkg.isArtifact);
  const libs = packages.filter((pkg) => !pkg.isArtifact && pkg.path !== root);
  const rootScripts = [
    rootPackage?.scripts?.build ? `- \`${packageManagerName(usesPnpm)} run build\` — build the workspace` : null,
    rootPackage?.scripts?.typecheck ? `- \`${packageManagerName(usesPnpm)} run typecheck\` — typecheck the workspace` : null,
  ].filter(Boolean);
  const packageSections = [...artifacts, ...libs].map((pkg) => packageSection(root, pkg, usesPnpm)).join("\n\n");

  return `# Workspace

## Overview

${usesPnpm ? "pnpm workspace monorepo" : "JavaScript/TypeScript repository"} using local package scripts.

## Stack

${stackLines(packages, usesPnpm)}

## Brand

- Not documented yet. Add product colors, typography, tone, and brand assets after product review.

## Structure

\`\`\`text
${structureTree(root, packages)}
\`\`\`

## Pages

- Not documented yet. Inspect frontend router/page files and list user-facing routes here.

## API Endpoints

- Not documented yet. Inspect OpenAPI specs, API route files, or backend router files and list endpoints here.

## TypeScript & Composite Projects

- If this repository uses TypeScript project references, typecheck from the root.
- If package-level typecheck scripts exist, run them before local handoff.

## Root Scripts

${rootScripts.length ? rootScripts.join("\n") : "- No root build/typecheck scripts detected."}

## Packages

${packageSections || "- No workspace packages detected."}
`;
}

function renderSystemArchitecture(root, packages, usesPnpm) {
  const artifacts = packages.filter((pkg) => pkg.isArtifact);
  const libs = packages.filter((pkg) => !pkg.isArtifact && pkg.path !== root);
  const artifactLines = artifacts.length
    ? artifacts.map((pkg) => `- \`${path.relative(root, pkg.path)}\` (${pkg.name})`).join("\n")
    : "- No deployable artifacts detected.";
  const libLines = libs.length
    ? libs.map((pkg) => `- \`${path.relative(root, pkg.path)}\` (${pkg.name})`).join("\n")
    : "- No shared packages detected.";

  return `# System Architecture

## Package Manager

${packageManagerName(usesPnpm)}

## Deployable Artifacts

${artifactLines}

## Shared Packages

${libLines}

## Environment

Environment variables should be documented in \`.env.example\` files next to the package or artifact that reads them. Secrets must stay out of git.

## Verification

Run package typechecks before local handoff. If typecheck fails because dependencies are missing, run \`${packageManagerName(usesPnpm)} install\` first.
`;
}

function ensureGitignore(root, writeFiles) {
  const gitignorePath = path.join(root, ".gitignore");
  const requiredEntries = [".env", ".env.local", ".env.*.local", ".claude/", ".superset/"];
  const starter = [
    "# dependencies",
    "node_modules/",
    "",
    "# build output",
    "dist/",
    "tmp/",
    "*.tsbuildinfo",
    "",
    "# local environment",
    ...requiredEntries,
    "",
    "# system files",
    ".DS_Store",
  ].join("\n") + "\n";

  if (!existsSync(gitignorePath)) {
    if (writeFiles) {
      writeFileSync(gitignorePath, starter);
      console.log(`[WRITE] Created ${gitignorePath}`);
    } else {
      console.log(`[DRY] Would create ${gitignorePath}`);
      console.log(starter);
    }
    return;
  }

  const existing = readFileSync(gitignorePath, "utf8");
  const existingLines = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = requiredEntries.filter((entry) => !existingLines.has(entry));
  if (!missing.length) {
    console.log("[OK] .gitignore already ignores .env, .claude, and .superset");
    return;
  }

  const block = `\n# local environment and agent state\n${missing.join("\n")}\n`;
  if (writeFiles) {
    writeFileSync(gitignorePath, existing.replace(/\s*$/, "\n") + block);
    console.log(`[WRITE] Updated ${gitignorePath}`);
  } else {
    console.log(`[DRY] Would append to ${gitignorePath}:`);
    console.log(block);
  }
}

function ensureProjectFiles(root, packages, usesPnpm, writeFiles) {
  const steeringDir = path.join(root, ".kiro", "steering");
  const replitMd = path.join(root, "replit.md");
  const overviewMd = path.join(steeringDir, "overview.md");
  const projectOverviewMd = path.join(steeringDir, "project-overview.md");
  const systemArchitectureMd = path.join(steeringDir, "system-architecture.md");

  if (existsSync(replitMd)) {
    const content = readFileSync(replitMd, "utf8");
    if (writeFiles) {
      mkdirSync(steeringDir, { recursive: true });
      writeFileSync(overviewMd, content);
      console.log(`[WRITE] Copied ${replitMd} to ${overviewMd}`);
    } else {
      console.log(`[DRY] Would copy ${replitMd} to ${overviewMd}`);
    }
  } else {
    const overviewContent = renderReplitStyleOverview(root, packages, usesPnpm);
    const files = [
      [overviewMd, overviewContent],
      [projectOverviewMd, overviewContent],
      [systemArchitectureMd, renderSystemArchitecture(root, packages, usesPnpm)],
    ];
    for (const [file, content] of files) {
      if (existsSync(file)) {
        console.log(`[OK] ${file} exists`);
        continue;
      }
      if (writeFiles) {
        mkdirSync(steeringDir, { recursive: true });
        writeFileSync(file, content);
        console.log(`[WRITE] Created ${file}`);
      } else {
        console.log(`[DRY] Would create ${file}`);
        console.log(content);
      }
    }
  }

  ensureGitignore(root, writeFiles);
}

function installDependencies(root, usesPnpm) {
  const cmd = usesPnpm ? "pnpm" : "npm";
  const args = usesPnpm ? ["install"] : ["install"];
  console.log(`[RUN] ${cmd} ${args.join(" ")}`);
  const result = run(cmd, args, root);
  if (result.stdout) console.log(result.stdout.trimEnd());
  if (result.stderr) console.error(result.stderr.trimEnd());
  if (result.status !== 0) throw new Error("Dependency install failed. Fix install error above, then rerun.");
}

function runTypechecks(root, packages, usesPnpm) {
  if (!existsSync(path.join(root, "node_modules"))) {
    console.log("[BLOCKED] node_modules missing. Run dependency install first:");
    console.log(usesPnpm ? "  pnpm install" : "  npm install");
    return 1;
  }

  const typecheckPackages = packages.filter((pkg) => pkg.path !== root && pkg.scripts.typecheck);
  const rootPackage = packages.find((pkg) => pkg.path === root);
  let failures = 0;

  if (!typecheckPackages.length && rootPackage?.scripts.typecheck) {
    const cmd = usesPnpm ? "pnpm" : "npm";
    const args = ["run", "typecheck"];
    console.log(`[RUN] ${cmd} ${args.join(" ")}`);
    const result = run(cmd, args, root);
    if (result.stdout) console.log(result.stdout.trimEnd());
    if (result.stderr) console.error(result.stderr.trimEnd());
    return result.status === 0 ? 0 : 1;
  }

  for (const pkg of typecheckPackages) {
    const cmd = usesPnpm ? "pnpm" : "npm";
    const args = usesPnpm ? ["--filter", pkg.name, "run", "typecheck"] : ["run", "typecheck"];
    console.log(`[RUN] ${cmd} ${args.join(" ")}`);
    const result = run(cmd, args, usesPnpm ? root : pkg.path);
    if (result.stdout) console.log(result.stdout.trimEnd());
    if (result.stderr) console.error(result.stderr.trimEnd());
    if (result.status === 0) console.log(`[OK] typecheck passed for ${pkg.name}`);
    else {
      console.log(`[FAIL] typecheck failed for ${pkg.name} at ${pkg.path}`);
      failures++;
    }
  }
  return failures ? 1 : 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root);
  if (!existsSync(path.join(root, "package.json"))) {
    throw new Error(`${root} does not look like a JS repo root; package.json not found.`);
  }

  const usesPnpm = repoUsesPnpm(root);
  console.log(`[INFO] root=${root}`);
  console.log(`[INFO] package_manager=${usesPnpm ? "pnpm" : "npm/unknown"}`);
  verifyRuntime(root, usesPnpm);

  if (args.install) installDependencies(root, usesPnpm);

  const packages = discoverPackages(root);
  console.log(`[INFO] packages_found=${packages.length}`);
  for (const pkg of packages) {
    console.log(`[INFO] ${pkg.isArtifact ? "artifact" : "package"}: ${pkg.name} (${path.relative(root, pkg.path) || "."})`);
  }

  if (args.writeProjectFiles || args.dryRun) {
    ensureProjectFiles(root, packages, usesPnpm, args.writeProjectFiles && !args.dryRun);
  }

  if (args.writeEnv || args.dryRun) {
    writeEnvExamples(root, packages, args.writeEnv && !args.dryRun);
  }

  let exitCode = 0;
  if (args.typecheck) exitCode = runTypechecks(root, packages, usesPnpm);
  process.exit(exitCode);
}

try {
  main();
} catch (error) {
  console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
