#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { extractCiRunCommands } from "./lib/ci-commands.mjs";

const SCANNER_VERSION = "0.1.0";
const MAX_FILES = 20_000;
const MAX_READ_BYTES = 1_000_000;

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".next",
  ".nuxt",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

const SENSITIVE_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".npmrc",
  ".pypirc",
  "credentials",
  "credentials.json",
  "id_rsa",
  "id_ed25519",
  "secrets.json",
]);

const SENSITIVE_DIRECTORIES = new Set([
  ".aws",
  ".gnupg",
  ".ssh",
  "credentials",
  "secrets",
]);

const SAFE_ENV_TEMPLATES = new Set([
  ".env.example",
  ".env.sample",
  ".env.template",
]);

const NON_PROJECT_SIGNAL_DIRECTORIES = new Set([
  "__fixtures__",
  "examples",
  "fixtures",
  "samples",
  "testdata",
]);

const PACKAGE_MANAGER_LOCKFILES = new Map([
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
]);

const VERIFICATION_SCRIPT_NAMES = ["test", "lint", "typecheck", "check", "build", "test:unit", "test:e2e"];

const LANGUAGE_EXTENSIONS = new Map([
  [".ts", "TypeScript"],
  [".tsx", "TypeScript"],
  [".js", "JavaScript"],
  [".jsx", "JavaScript"],
  [".mjs", "JavaScript"],
  [".cjs", "JavaScript"],
  [".py", "Python"],
  [".go", "Go"],
  [".rs", "Rust"],
  [".java", "Java"],
  [".kt", "Kotlin"],
  [".kts", "Kotlin"],
  [".cs", "C#"],
  [".rb", "Ruby"],
  [".php", "PHP"],
  [".swift", "Swift"],
  [".dart", "Dart"],
  [".vue", "Vue"],
  [".svelte", "Svelte"],
  [".cpp", "C++"],
  [".cc", "C++"],
  [".c", "C"],
  [".h", "C/C++ Header"],
  [".sql", "SQL"],
  [".tf", "Terraform"],
]);

function fail(message) {
  process.stderr.write(`inspect-project: ${message}\n`);
  process.exit(1);
}

function normalizePath(path) {
  return path.split(sep).join("/");
}

function isSensitiveBasename(name) {
  const lower = name.toLowerCase();
  if (SENSITIVE_BASENAMES.has(lower)) return true;
  if (lower.startsWith(".env.") && !SAFE_ENV_TEMPLATES.has(lower)) return true;
  return /\.(?:pem|key|p12|pfx)$/i.test(name);
}

function hasSensitiveDirectory(relPath) {
  return normalizePath(relPath).split("/").some((part) => SENSITIVE_DIRECTORIES.has(part.toLowerCase()));
}

function isProjectSignalPath(relPath) {
  return !normalizePath(relPath).split("/").some((part) => NON_PROJECT_SIGNAL_DIRECTORIES.has(part.toLowerCase()));
}

function resolveTarget(input) {
  const target = resolve(input || process.cwd());
  if (!existsSync(target)) fail(`target does not exist: ${target}`);
  if (!statSync(target).isDirectory()) fail(`target is not a directory: ${target}`);
  return realpathSync(target);
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).replace(/\r?\n$/, "");
  } catch {
    return null;
  }
}

function scopedStatusPath(path, prefix) {
  const normalized = normalizePath(path);
  if (prefix && !normalized.startsWith(prefix)) {
    throw new Error("Git status returned a path outside the inspection target.");
  }
  const scoped = prefix ? normalized.slice(prefix.length) : normalized;
  if (!scoped || isAbsolute(scoped) || /^[A-Za-z]:\//.test(scoped) || scoped.split("/").includes("..")) {
    throw new Error("Git status returned an invalid target-relative path.");
  }
  return scoped;
}

function parseGitStatus(output, prefix) {
  if (output === "") return [];
  const records = output.split("\0");
  if (records.pop() !== "") throw new Error("Git status output is not NUL terminated.");
  const status = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4 || record[2] !== " ") throw new Error("Git status output is malformed.");
    const code = record.slice(0, 2);
    const path = scopedStatusPath(record.slice(3), prefix);
    status.push(`${code} ${path}`);
    if (code.includes("R") || code.includes("C")) {
      if (index + 1 >= records.length) throw new Error("Git rename status is incomplete.");
      index += 1;
    }
  }
  return status;
}

function scopedGitStatus(cwd) {
  try {
    const options = {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    };
    const prefix = normalizePath(
      execFileSync("git", ["rev-parse", "--show-prefix"], options).replace(/\r?\n$/, "")
    );
    if (prefix && (!prefix.endsWith("/") || isAbsolute(prefix) || prefix.split("/").includes(".."))) {
      throw new Error("Git returned an invalid target prefix.");
    }
    const output = execFileSync("git", [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
    ], options);
    return parseGitStatus(output, prefix);
  } catch {
    return null;
  }
}

function walk(root) {
  const files = [];
  const skippedSensitive = [];
  let truncated = false;

  function visit(directory) {
    if (files.length >= MAX_FILES) {
      truncated = true;
      return;
    }

    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      const absolute = join(directory, entry.name);
      const rel = normalizePath(relative(root, absolute));

      if (entry.isSymbolicLink()) {
        files.push({ path: rel, type: "symlink" });
        continue;
      }
      if (entry.isDirectory()) {
        if (SENSITIVE_DIRECTORIES.has(entry.name.toLowerCase())) {
          skippedSensitive.push(`${rel}/`);
        } else if (!IGNORED_DIRECTORIES.has(entry.name)) {
          visit(absolute);
        }
        continue;
      }
      if (!entry.isFile()) continue;

      let size = null;
      try {
        size = lstatSync(absolute).size;
      } catch {
        // Keep the path evidence even when metadata becomes unavailable.
      }
      const sensitive = isSensitiveBasename(entry.name);
      files.push({ path: rel, type: "file", size, sensitive });
      if (sensitive) skippedSensitive.push(rel);
    }
  }

  visit(root);
  return { files, skippedSensitive, truncated };
}

function readAllowed(root, relPath) {
  const absolute = resolve(root, relPath);
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) return null;
  if (hasSensitiveDirectory(relPath) || isSensitiveBasename(basename(absolute))) return null;
  if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink() || !statSync(absolute).isFile()) return null;
  if (statSync(absolute).size > MAX_READ_BYTES) return null;
  try {
    return readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
}

function packageScriptCommand(manager, script, packagePath) {
  const prefix = packagePath === "package.json" ? "" : ` --dir ${JSON.stringify(packagePath.replace(/\/package\.json$/, ""))}`;
  if (manager === "pnpm") return `pnpm${prefix} run ${script}`;
  if (manager === "yarn") return packagePath === "package.json" ? `yarn ${script}` : `yarn --cwd ${JSON.stringify(packagePath.replace(/\/package\.json$/, ""))} ${script}`;
  if (manager === "bun") return packagePath === "package.json" ? `bun run ${script}` : `bun --cwd ${JSON.stringify(packagePath.replace(/\/package\.json$/, ""))} run ${script}`;
  return packagePath === "package.json" ? `npm run ${script}` : `npm --prefix ${JSON.stringify(packagePath.replace(/\/package\.json$/, ""))} run ${script}`;
}

function inspectPackages(root, files) {
  const packagePaths = files
    .filter((file) => file.type === "file" && /(^|\/)package\.json$/.test(file.path))
    .map((file) => file.path)
    .slice(0, 200);
  const packages = [];

  for (const path of packagePaths) {
    const content = readAllowed(root, path);
    if (!content) continue;
    try {
      const parsed = JSON.parse(content);
      const scripts = parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
      const dependencies = {
        ...(parsed.dependencies && typeof parsed.dependencies === "object" ? parsed.dependencies : {}),
        ...(parsed.devDependencies && typeof parsed.devDependencies === "object" ? parsed.devDependencies : {}),
      };
      packages.push({
        path,
        name: typeof parsed.name === "string" ? parsed.name : null,
        private: parsed.private === true,
        packageManager: typeof parsed.packageManager === "string" ? parsed.packageManager : null,
        workspaces: Array.isArray(parsed.workspaces)
          ? parsed.workspaces
          : Array.isArray(parsed.workspaces?.packages)
            ? parsed.workspaces.packages
            : [],
        scripts,
        dependencies: Object.keys(dependencies).sort(),
      });
    } catch {
      packages.push({ path, parseError: "Invalid JSON" });
    }
  }
  return packages;
}

function packageManagerFromDeclaration(value) {
  if (typeof value !== "string") return null;
  return value.trim().match(/^(npm|pnpm|yarn|bun)@\S+$/)?.[1] || null;
}

function packageManagerFromCommand(command) {
  if (typeof command !== "string") return null;
  return command.trim().match(/^(?:corepack\s+)?(npm|pnpm|yarn|bun)(?:\s|$)/)?.[1] || null;
}

function detectPackageManager(files, packages, ciCandidates) {
  const evidence = [];
  const warnings = [];

  for (const file of files) {
    if (file.type !== "file") continue;
    const manager = PACKAGE_MANAGER_LOCKFILES.get(basename(file.path));
    if (!manager) continue;
    evidence.push({ manager, kind: "lockfile", path: file.path, note: `${manager} lockfile` });
  }

  for (const pkg of packages) {
    if (!pkg.packageManager) continue;
    const manager = packageManagerFromDeclaration(pkg.packageManager);
    if (!manager) {
      warnings.push(`Unrecognized packageManager declaration at ${pkg.path}; it was not used as evidence.`);
      continue;
    }
    evidence.push({
      manager,
      kind: "package-json",
      path: pkg.path,
      pointer: "packageManager",
      note: `Declared ${pkg.packageManager}`,
    });
  }

  for (const candidate of ciCandidates) {
    const manager = packageManagerFromCommand(candidate.command);
    if (!manager) continue;
    evidence.push({
      manager,
      kind: "ci-command",
      path: candidate.source.path,
      pointer: candidate.source.pointer,
      note: `CI command: ${candidate.command}`,
    });
  }

  const managers = [...new Set(evidence.map((item) => item.manager))].sort();
  const hasVerificationScripts = packages.some((pkg) => VERIFICATION_SCRIPT_NAMES.some((name) => typeof pkg.scripts?.[name] === "string"));
  if (managers.length > 1) {
    warnings.push(`Conflicting package manager evidence found (${managers.join(", ")}); package-script commands were not generated.`);
  } else if (managers.length === 0 && hasVerificationScripts) {
    warnings.push("Package scripts were found without package manager evidence; package-script commands were not generated.");
  }

  return {
    name: managers.length === 1 ? managers[0] : null,
    status: managers.length > 1 ? "conflicting" : managers.length === 1 ? "observed" : "unknown",
    evidence,
    warnings,
  };
}

function packageVerificationCandidates(packages, packageManager) {
  if (!packageManager.name) return [];
  const candidates = [];
  for (const pkg of packages) {
    for (const script of VERIFICATION_SCRIPT_NAMES) {
      if (typeof pkg.scripts?.[script] !== "string") continue;
      candidates.push({
        id: `${pkg.path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}-${script.replace(/[^a-z0-9]+/gi, "-")}`,
        name: `${pkg.name || pkg.path}: ${script}`,
        command: packageScriptCommand(packageManager.name, script, pkg.path),
        cwd: ".",
        status: "inferred",
        source: { path: pkg.path, pointer: `scripts.${script}`, note: `Package script: ${pkg.scripts[script]}` },
      });
    }
  }
  return candidates;
}

function detectFrameworks(packages, root, filePaths) {
  const dependencies = new Set(packages.flatMap((pkg) => pkg.dependencies || []));
  const frameworks = [];
  const addDependency = (name, label) => {
    if (dependencies.has(name)) frameworks.push({ name: label, evidence: `dependency:${name}` });
  };

  addDependency("next", "Next.js");
  addDependency("react", "React");
  addDependency("vue", "Vue");
  addDependency("@angular/core", "Angular");
  addDependency("svelte", "Svelte");
  addDependency("express", "Express");
  addDependency("@nestjs/core", "NestJS");
  addDependency("hono", "Hono");

  const pyproject = readAllowed(root, "pyproject.toml") || "";
  const requirements = readAllowed(root, "requirements.txt") || "";
  const pythonText = `${pyproject}\n${requirements}`.toLowerCase();
  for (const [needle, label] of [["django", "Django"], ["fastapi", "FastAPI"], ["flask", "Flask"]]) {
    if (pythonText.includes(needle)) frameworks.push({ name: label, evidence: pyproject ? "pyproject.toml" : "requirements.txt" });
  }

  const pom = readAllowed(root, "pom.xml") || "";
  const gradle = readAllowed(root, "build.gradle") || readAllowed(root, "build.gradle.kts") || "";
  if (/spring-boot/i.test(`${pom}\n${gradle}`)) {
    frameworks.push({ name: "Spring Boot", evidence: pom ? "pom.xml" : "build.gradle" });
  }

  const unique = new Map();
  for (const framework of frameworks) unique.set(framework.name, framework);
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function detectLanguages(files) {
  const counts = new Map();
  for (const file of files) {
    if (file.type !== "file") continue;
    const language = LANGUAGE_EXTENSIONS.get(extname(file.path).toLowerCase());
    if (language) counts.set(language, (counts.get(language) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, fileCount]) => ({ name, fileCount }))
    .sort((a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name));
}

function findMatches(paths, patterns, limit = 200) {
  return paths.filter((path) => patterns.some((pattern) => pattern.test(path))).slice(0, limit);
}

function extractCiCommands(root, ciPaths) {
  const candidates = [];
  const warnings = [];
  for (const path of ciPaths) {
    const content = readAllowed(root, path);
    if (!content) continue;
    const result = extractCiRunCommands(path, content);
    candidates.push(...result.candidates);
    warnings.push(...result.warnings);
  }
  return { candidates: candidates.slice(0, 100), warnings };
}

function main() {
  const input = process.argv.slice(2).find((arg) => !arg.startsWith("--")) || process.cwd();
  const root = resolveTarget(input);
  const walkResult = walk(root);
  const files = walkResult.files;
  const filePaths = files.map((file) => file.path);
  const projectFiles = files.filter((file) => isProjectSignalPath(file.path));
  const projectFilePaths = projectFiles.map((file) => file.path);
  const pathSet = new Set(projectFilePaths);
  const packages = inspectPackages(root, projectFiles);

  const ciPaths = findMatches(projectFilePaths, [
    /^\.github\/workflows\/[^/]+\.(?:yml|yaml)$/,
    /^\.gitlab-ci\.yml$/,
    /^azure-pipelines\.ya?ml$/,
    /^Jenkinsfile$/,
  ]);
  const documentationPaths = findMatches(projectFilePaths, [
    /(^|\/)README(?:\.[^/]+)?$/i,
    /(^|\/)docs\//i,
    /(^|\/)adr(?:s)?\//i,
    /architecture/i,
    /openapi/i,
    /asyncapi/i,
  ]);
  const testPaths = findMatches(filePaths, [
    /(^|\/)(?:tests?|specs?)\//i,
    /\.(?:test|spec)\.[^/]+$/i,
    /(^|\/)__tests__\//i,
  ]);
  const aiPaths = findMatches(projectFilePaths, [
    /(^|\/)AGENTS(?:\.override)?\.md$/,
    /(^|\/)CLAUDE(?:\.local)?\.md$/,
    /^\.ai\//,
    /^\.agents\//,
    /^\.claude\//,
    /^\.cursor\//,
    /^\.github\/copilot-instructions\.md$/,
  ]);
  const deploymentPaths = findMatches(projectFilePaths, [
    /(^|\/)Dockerfile$/i,
    /docker-compose/i,
    /(^|\/)k8s\//i,
    /(^|\/)kubernetes\//i,
    /(^|\/)terraform\//i,
    /\.tf$/i,
    /serverless/i,
    /vercel\.json$/i,
    /fly\.toml$/i,
  ]);
  const ciInspection = extractCiCommands(root, ciPaths);
  const ciCandidates = ciInspection.candidates;
  const packageManager = detectPackageManager(projectFiles, packages, ciCandidates);
  const packageCandidates = packageVerificationCandidates(packages, packageManager);

  const gitRoot = git(["rev-parse", "--show-toplevel"], root);
  const gitHead = git(["rev-parse", "HEAD"], root);
  const gitBranch = git(["branch", "--show-current"], root);
  const gitStatus = gitRoot ? scopedGitStatus(root) : null;
  const topLevelDirectories = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name))
    .map((entry) => entry.name)
    .sort();

  const manifestPaths = findMatches(projectFilePaths, [
    /(^|\/)package\.json$/,
    /^pyproject\.toml$/,
    /^requirements(?:-[^/]+)?\.txt$/,
    /^go\.mod$/,
    /^Cargo\.toml$/,
    /^pom\.xml$/,
    /^build\.gradle(?:\.kts)?$/,
    /^Gemfile$/,
    /^composer\.json$/,
    /^pubspec\.yaml$/,
  ]);
  const workspaceSignals = ["pnpm-workspace.yaml", "nx.json", "turbo.json", "lerna.json"].filter((path) => pathSet.has(path));
  const isMonorepo = workspaceSignals.length > 0 || packages.length > 1;

  const output = {
    scanner: { name: "gongxu-inspect", version: SCANNER_VERSION },
    scannedAt: new Date().toISOString(),
    root,
    git: {
      repository: gitRoot !== null,
      root: gitRoot,
      head: gitHead,
      branch: gitBranch,
      statusAvailable: gitStatus !== null,
      dirty: gitStatus === null ? null : gitStatus.length > 0,
      status: gitStatus,
    },
    inventory: {
      fileCount: files.length,
      truncated: walkResult.truncated,
      topLevelDirectories,
      manifestPaths,
      documentationPaths,
      testPaths,
      ciPaths,
      deploymentPaths,
      skippedSensitivePaths: walkResult.skippedSensitive,
    },
    detected: {
      languages: detectLanguages(projectFiles),
      frameworks: detectFrameworks(packages, root, projectFilePaths),
      packageManager: packageManager.name,
      packageManagerStatus: packageManager.status,
      packageManagerEvidence: packageManager.evidence,
      packages,
      repositoryShape: isMonorepo ? "monorepo" : "single-project",
      workspaceSignals,
    },
    verificationCandidates: [
      ...packageCandidates,
      ...ciCandidates,
    ],
    existingAi: {
      gongxu: pathSet.has(".ai/manifest.json") && pathSet.has(".ai/blueprint.json"),
      paths: aiPaths,
    },
    warnings: [
      ...(walkResult.truncated ? [`File inventory stopped at ${MAX_FILES} entries.`] : []),
      ...(walkResult.skippedSensitive.length > 0 ? ["Sensitive-looking files were listed but never read."] : []),
      ...(!gitRoot ? ["Target is not inside a Git repository."] : []),
      ...(gitRoot && !isAbsolute(gitRoot) ? ["Git returned a non-absolute repository root."] : []),
      ...(gitRoot && gitStatus === null ? ["Git working tree status could not be inspected; inspected contents may not match git.head."] : []),
      ...(gitStatus?.length > 0 ? ["Git working tree has uncommitted changes; git.head does not uniquely identify inspected contents."] : []),
      ...packageManager.warnings,
      ...ciInspection.warnings,
    ],
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main();
