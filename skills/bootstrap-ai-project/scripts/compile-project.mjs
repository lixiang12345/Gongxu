#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  extractManagedBlock,
  hashOwnedContent,
  normalizeRelative,
  readTextIfExists,
  removeManagedRegion,
  resolveInside,
  sha256,
  writeAtomic,
} from "./lib/files.mjs";
import {
  GENERATOR_NAME,
  GENERATOR_VERSION,
  HUMAN_OWNED_PATHS,
  SCHEMA_VERSION,
  managedOwnershipForPath,
  validateBlueprint,
} from "./lib/model.mjs";
import { renderArtifacts } from "./lib/render.mjs";

function usage() {
  return `Usage: compile-project.mjs --root <repo> --blueprint <file> [--dry-run] [--force-path <relative-path>]\n`;
}

function parseArgs(argv) {
  const options = { dryRun: false, forcePaths: new Set() };
  const takeValue = (name, index) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--root") options.root = takeValue(arg, index++);
    else if (arg === "--blueprint") options.blueprint = takeValue(arg, index++);
    else if (arg === "--force-path") {
      const path = normalizeRelative(takeValue(arg, index++));
      if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) {
        throw new Error(`--force-path must be a repository-relative file path: ${path}`);
      }
      options.forcePaths.add(path);
    }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.root || !options.blueprint) throw new Error("--root and --blueprint are required.");
  return options;
}

function loadJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot parse ${label} JSON at ${path}: ${error.message}`);
  }
}

function loadManifest(root) {
  const path = resolveInside(root, ".ai/manifest.json");
  if (!existsSync(path)) return null;
  const manifest = loadJson(path, "manifest");
  if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.generator?.name !== GENERATOR_NAME) {
    throw new Error("Existing .ai/manifest.json is not a supported Gongxu manifest.");
  }
  if (!Array.isArray(manifest.managedFiles)) throw new Error("Existing manifest has no managedFiles array.");
  const seen = new Set();
  for (const entry of manifest.managedFiles) {
    if (!entry || typeof entry.path !== "string" || !new Set(["file", "region"]).has(entry.ownership) || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error("Existing manifest contains an invalid managedFiles entry.");
    }
    const expectedOwnership = managedOwnershipForPath(entry.path);
    if (!expectedOwnership) throw new Error(`Existing manifest claims an unsupported managed artifact: ${entry.path}.`);
    if (entry.ownership !== expectedOwnership) {
      throw new Error(`Existing manifest ownership for ${entry.path} must be ${expectedOwnership}.`);
    }
    if (seen.has(entry.path)) throw new Error(`Existing manifest contains duplicate managed path: ${entry.path}`);
    resolveInside(root, entry.path);
    seen.add(entry.path);
  }
  return manifest;
}

function assertAdoptableAiDirectory(root, manifest) {
  const aiPath = resolveInside(root, ".ai");
  if (!existsSync(aiPath) || manifest) return;
  if (!statSync(aiPath).isDirectory()) throw new Error(".ai exists but is not a directory.");
  const entries = readdirSync(aiPath);
  if (entries.length > 0) {
    throw new Error(".ai already contains user-owned content but has no Gongxu manifest. Import or migrate it explicitly before compiling.");
  }
}

function currentOwnedHash(root, entry) {
  const absolute = resolveInside(root, entry.path);
  const content = readTextIfExists(absolute);
  if (content === null) return { exists: false, hash: null, content: null, error: null };
  try {
    return { exists: true, hash: hashOwnedContent(content, entry.ownership), content, error: null };
  } catch (error) {
    return { exists: true, hash: null, content, error: error.message };
  }
}

function snapshotFile(path) {
  if (!existsSync(path)) return { exists: false, content: null, mode: null };
  const metadata = lstatSync(path);
  if (!metadata.isFile()) throw new Error(`Cannot snapshot a non-file managed path: ${path}`);
  return {
    exists: true,
    content: readFileSync(path, "utf8"),
    mode: metadata.mode & 0o7777,
  };
}

function missingParentDirectories(root, path) {
  const missing = [];
  let directory = dirname(path);
  while (directory !== root && !existsSync(directory)) {
    missing.push(directory);
    directory = dirname(directory);
  }
  return missing;
}

function restoreSnapshot(path, snapshot) {
  if (!snapshot.exists) {
    if (!existsSync(path)) return;
    const metadata = lstatSync(path);
    if (metadata.isDirectory()) throw new Error(`Refusing to remove a directory created at managed file path: ${path}`);
    rmSync(path, { force: true });
    return;
  }

  if (existsSync(path)) {
    const metadata = lstatSync(path);
    if (metadata.isFile() && readFileSync(path, "utf8") === snapshot.content) {
      if ((metadata.mode & 0o7777) !== snapshot.mode) chmodSync(path, snapshot.mode);
      return;
    }
    if (metadata.isDirectory()) throw new Error(`Refusing to replace a directory at managed file path: ${path}`);
    rmSync(path, { force: true });
  }
  writeAtomic(path, snapshot.content, snapshot.mode);
}

function rollbackCompile(journal, createdDirectories) {
  const errors = [];
  for (const entry of [...journal].reverse()) {
    try {
      restoreSnapshot(entry.path, entry.snapshot);
    } catch (error) {
      errors.push(`${entry.path}: ${error.message}`);
    }
  }
  for (const directory of [...createdDirectories].sort((a, b) => b.length - a.length)) {
    try {
      rmdirSync(directory);
    } catch (error) {
      if (!new Set(["ENOENT", "ENOTEMPTY", "EEXIST"]).has(error.code)) {
        errors.push(`${directory}: ${error.message}`);
      }
    }
  }
  return errors;
}

function applyCompilePlan(root, actions, manifestContent) {
  const operations = actions
    .filter((action) => action.type !== "unchanged")
    .map((action) => ({
      path: action.path,
      type: action.type === "delete" || (action.type === "remove-region" && action.content === "") ? "delete" : "write",
      content: action.content,
      mode: action.mode,
    }));
  const manifestPath = resolveInside(root, ".ai/manifest.json");
  if (readTextIfExists(manifestPath) !== manifestContent) {
    operations.push({ path: ".ai/manifest.json", type: "write", content: manifestContent, mode: 0o644 });
  }

  const journal = [];
  const createdDirectories = new Set();
  try {
    for (const operation of operations) {
      const absolute = resolveInside(root, operation.path);
      const snapshot = snapshotFile(absolute);
      journal.push({ path: absolute, snapshot });
      if (operation.type === "delete") {
        rmSync(absolute, { force: true });
        continue;
      }
      for (const directory of missingParentDirectories(root, absolute)) createdDirectories.add(directory);
      writeAtomic(absolute, operation.content, operation.mode);
    }
  } catch (error) {
    const rollbackErrors = rollbackCompile(journal, createdDirectories);
    const rollbackResult = rollbackErrors.length === 0
      ? "All attempted file changes were rolled back."
      : `Rollback was incomplete: ${rollbackErrors.join("; ")}`;
    throw new Error(`${error.message} ${rollbackResult}`);
  }
}

function planActions(root, rendered, manifest, forcePaths) {
  const actions = [];
  const conflicts = [];
  const priorEntries = new Map((manifest?.managedFiles || []).map((entry) => [entry.path, entry]));

  for (const artifact of rendered.values()) {
    const absolute = resolveInside(root, artifact.path);
    const existing = readTextIfExists(absolute);
    const same = existing === artifact.content;

    if (artifact.ownership === "source") {
      actions.push({ type: existing === null ? "create" : same ? "unchanged" : "update", ...artifact });
      continue;
    }

    const prior = priorEntries.get(artifact.path);
    if (prior) {
      const current = currentOwnedHash(root, prior);
      const drifted = !current.exists || current.error || current.hash !== prior.sha256;
      priorEntries.delete(artifact.path);
      if (drifted && !forcePaths.has(artifact.path)) {
        conflicts.push({
          path: artifact.path,
          reason: current.error || (!current.exists ? "managed file was removed" : "managed content changed since the last compile"),
        });
        continue;
      }
      actions.push({ type: same ? "unchanged" : "update", ...artifact, forced: drifted });
      continue;
    }

    if (existing !== null) {
      if (artifact.ownership === "region") {
        let existingRegion;
        try {
          existingRegion = extractManagedBlock(existing);
        } catch (error) {
          conflicts.push({ path: artifact.path, reason: error.message });
          continue;
        }
        if (existingRegion !== null && !forcePaths.has(artifact.path)) {
          conflicts.push({ path: artifact.path, reason: "Gongxu markers exist without a manifest ownership record" });
          continue;
        }
      } else if (!same && !forcePaths.has(artifact.path)) {
        conflicts.push({ path: artifact.path, reason: "target path exists without a manifest ownership record" });
        continue;
      }
    }
    actions.push({ type: existing === null ? "create" : same ? "unchanged" : "update", ...artifact, forced: existing !== null && !same });
  }

  for (const prior of priorEntries.values()) {
    const current = currentOwnedHash(root, prior);
    const drifted = !current.exists || current.error || current.hash !== prior.sha256;
    if (drifted && !forcePaths.has(prior.path)) {
      conflicts.push({
        path: prior.path,
        reason: current.error || (!current.exists ? "obsolete managed file was already removed" : "obsolete managed content was modified"),
      });
      continue;
    }
    if (!current.exists) continue;
    if (prior.ownership === "region") {
      actions.push({ type: "remove-region", path: prior.path, ownership: "region", content: removeManagedRegion(current.content), forced: drifted });
    } else {
      actions.push({ type: "delete", path: prior.path, ownership: "file", content: null, forced: drifted });
    }
  }

  return { actions, conflicts };
}

function buildManifest(blueprint, rendered, generatedAt) {
  const managedFiles = [...rendered.values()]
    .filter((artifact) => artifact.ownership !== "source")
    .map((artifact) => {
      const expectedOwnership = managedOwnershipForPath(artifact.path);
      if (expectedOwnership !== artifact.ownership) {
        throw new Error(`Renderer produced an unsupported managed artifact: ${artifact.path}.`);
      }
      return {
        path: artifact.path,
        ownership: artifact.ownership,
        sha256: hashOwnedContent(artifact.content, artifact.ownership),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    schemaVersion: SCHEMA_VERSION,
    generator: { name: GENERATOR_NAME, version: GENERATOR_VERSION },
    generatedAt,
    projectId: blueprint.project.id,
    sourceRevision: blueprint.evidence.sourceRevision,
    adapters: blueprint.adapters,
    managedFiles,
    humanOwnedPaths: [...HUMAN_OWNED_PATHS],
  };
}

function summarize(actions, conflicts, warnings) {
  const counts = {};
  for (const action of actions) counts[action.type] = (counts[action.type] || 0) + 1;
  return {
    ok: conflicts.length === 0,
    counts,
    actions: actions.filter((action) => action.type !== "unchanged").map((action) => ({
      type: action.type,
      path: action.path,
      forced: action.forced === true,
    })),
    conflicts,
    warnings,
  };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}`);
    process.exit(2);
  }

  const rootInput = resolve(options.root);
  if (!existsSync(rootInput) || !statSync(rootInput).isDirectory()) {
    process.stderr.write(`Repository root does not exist: ${rootInput}\n`);
    process.exit(2);
  }
  const root = realpathSync(rootInput);
  const blueprintPath = resolve(options.blueprint);
  let blueprint;
  try {
    blueprint = loadJson(blueprintPath, "blueprint");
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  const validation = validateBlueprint(blueprint, root);
  if (validation.errors.length > 0) {
    process.stderr.write(`${JSON.stringify({ ok: false, errors: validation.errors, warnings: validation.warnings }, null, 2)}\n`);
    process.exit(1);
  }

  let manifest;
  try {
    manifest = loadManifest(root);
    assertAdoptableAiDirectory(root, manifest);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }

  let rendered;
  try {
    rendered = renderArtifacts(blueprint, root);
  } catch (error) {
    process.stderr.write(`Cannot render blueprint: ${error.message}\n`);
    process.exit(1);
  }
  const knownManagedPaths = new Set([
    ...[...rendered.values()].filter((artifact) => artifact.ownership !== "source").map((artifact) => artifact.path),
    ...(manifest?.managedFiles || []).map((entry) => entry.path),
  ]);
  const unknownForcePaths = [...options.forcePaths].filter((path) => !knownManagedPaths.has(path));
  if (unknownForcePaths.length > 0) {
    process.stderr.write(`--force-path does not match a managed file: ${unknownForcePaths.join(", ")}\n`);
    process.exit(2);
  }
  let plan;
  try {
    plan = planActions(root, rendered, manifest, options.forcePaths);
  } catch (error) {
    process.stderr.write(`Cannot plan compile: ${error.message}\n`);
    process.exit(1);
  }
  const summary = summarize(plan.actions, plan.conflicts, validation.warnings);
  if (plan.conflicts.length > 0 || options.dryRun) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exit(plan.conflicts.length > 0 ? 1 : 0);
  }

  const changed = plan.actions.some((action) => action.type !== "unchanged");
  const generatedAt = changed || !manifest ? new Date().toISOString() : manifest.generatedAt;
  let manifestContent;
  try {
    manifestContent = `${JSON.stringify(buildManifest(blueprint, rendered, generatedAt), null, 2)}\n`;
  } catch (error) {
    process.stderr.write(`Cannot build manifest: ${error.message}\n`);
    process.exit(1);
  }

  try {
    applyCompilePlan(root, plan.actions, manifestContent);
  } catch (error) {
    process.stderr.write(`Cannot apply compile plan: ${error.message}\n`);
    process.exit(1);
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main();
