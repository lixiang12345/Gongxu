#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import {
  extractManagedBlock,
  hashOwnedContent,
  readTextIfExists,
  resolveInside,
} from "./lib/files.mjs";
import {
  GENERATOR_NAME,
  HUMAN_OWNED_PATHS,
  SCHEMA_VERSION,
  managedOwnershipForPath,
  validateBlueprint,
} from "./lib/model.mjs";
import { renderArtifacts } from "./lib/render.mjs";
import { validateSkillDocument } from "./lib/skill-documents.mjs";

const MANIFEST_KEYS = [
  "schemaVersion",
  "generator",
  "generatedAt",
  "projectId",
  "sourceRevision",
  "adapters",
  "managedFiles",
  "humanOwnedPaths",
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkObjectShape(value, path, required, allowed, errors) {
  if (!isObject(value)) {
    errors.push(`${path} must be an object.`);
    return false;
  }
  for (const key of required) {
    if (!(key in value)) errors.push(`${path}.${key} is required.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key} is not supported.`);
  }
  return true;
}

function validateManifestContract(manifest, blueprint, errors) {
  if (!checkObjectShape(manifest, "manifest", MANIFEST_KEYS, MANIFEST_KEYS, errors)) return;
  if (!checkObjectShape(manifest.generator, "manifest.generator", ["name", "version"], ["name", "version"], errors)) {
    return;
  }
  if (manifest.schemaVersion !== SCHEMA_VERSION) errors.push(`Manifest schemaVersion must equal ${SCHEMA_VERSION}.`);
  if (manifest.generator.name !== GENERATOR_NAME) errors.push("Manifest generator is not Gongxu.");
  if (typeof manifest.generator.version !== "string" || manifest.generator.version.length === 0) {
    errors.push("Manifest generator version is missing.");
  }
  if (typeof manifest.generatedAt !== "string" || Number.isNaN(Date.parse(manifest.generatedAt))) {
    errors.push("Manifest generatedAt must be an ISO timestamp.");
  } else if (new Date(manifest.generatedAt).toISOString() !== manifest.generatedAt) {
    errors.push("Manifest generatedAt must use canonical ISO format.");
  }
  if (manifest.projectId !== blueprint.project?.id) errors.push("Manifest projectId does not match the blueprint.");
  if (manifest.sourceRevision !== blueprint.evidence?.sourceRevision) {
    errors.push("Manifest sourceRevision does not match the blueprint.");
  }
  if (!Array.isArray(manifest.adapters)) errors.push("Manifest adapters must be an array.");
  else if (JSON.stringify(manifest.adapters) !== JSON.stringify(blueprint.adapters)) {
    errors.push("Manifest adapters do not match the blueprint.");
  }
  if (!Array.isArray(manifest.managedFiles)) errors.push("Manifest managedFiles must be an array.");
  if (!Array.isArray(manifest.humanOwnedPaths)) errors.push("Manifest humanOwnedPaths must be an array.");
  else if (JSON.stringify(manifest.humanOwnedPaths) !== JSON.stringify(HUMAN_OWNED_PATHS)) {
    errors.push("Manifest humanOwnedPaths do not match the Gongxu ownership contract.");
  }
}

function loadJson(path, label, errors) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`Cannot parse ${label} JSON at ${path}: ${error.message}`);
    return null;
  }
}

function parseArgs(argv) {
  const options = { allowDrift: false };
  for (const arg of argv) {
    if (arg === "--allow-drift") options.allowDrift = true;
    else if (!options.root) options.root = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  options.root ||= process.cwd();
  return options;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }

  const inputRoot = resolve(options.root);
  if (!existsSync(inputRoot) || !statSync(inputRoot).isDirectory()) {
    process.stderr.write(`Target is not a directory: ${inputRoot}\n`);
    process.exit(2);
  }
  const root = realpathSync(inputRoot);
  const errors = [];
  const warnings = [];
  const drift = [];

  let blueprintPath;
  let manifestPath;
  try {
    blueprintPath = resolveInside(root, ".ai/blueprint.json");
    manifestPath = resolveInside(root, ".ai/manifest.json");
  } catch (error) {
    errors.push(`Cannot resolve Gongxu project files: ${error.message}`);
    process.stdout.write(`${JSON.stringify({ ok: false, errors, warnings, drift }, null, 2)}\n`);
    process.exit(1);
  }
  if (!existsSync(blueprintPath)) errors.push("Missing .ai/blueprint.json.");
  if (!existsSync(manifestPath)) errors.push("Missing .ai/manifest.json.");
  if (errors.length > 0) {
    process.stdout.write(`${JSON.stringify({ ok: false, errors, warnings, drift }, null, 2)}\n`);
    process.exit(1);
  }

  const blueprint = loadJson(blueprintPath, "blueprint", errors);
  const manifest = loadJson(manifestPath, "manifest", errors);
  if (!blueprint || !manifest) {
    process.stdout.write(`${JSON.stringify({ ok: false, errors, warnings, drift }, null, 2)}\n`);
    process.exit(1);
  }

  const validation = validateBlueprint(blueprint, root);
  errors.push(...validation.errors);
  warnings.push(...validation.warnings);
  validateManifestContract(manifest, blueprint, errors);

  const validManifestEntries = [];
  const seenManifestPaths = new Set();
  const rawManifestEntries = Array.isArray(manifest.managedFiles) ? manifest.managedFiles : [];
  for (const [index, entry] of rawManifestEntries.entries()) {
    const path = `manifest.managedFiles[${index}]`;
    if (!checkObjectShape(entry, path, ["path", "ownership", "sha256"], ["path", "ownership", "sha256"], errors)) {
      continue;
    }
    if (!entry || typeof entry.path !== "string" || !new Set(["file", "region"]).has(entry.ownership) || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      errors.push(`${path} is invalid.`);
      continue;
    }
    const expectedOwnership = managedOwnershipForPath(entry.path);
    if (!expectedOwnership) {
      errors.push(`${path}.path is not a supported Gongxu managed artifact: ${entry.path}`);
      continue;
    }
    if (entry.ownership !== expectedOwnership) {
      errors.push(`${path}.ownership for ${entry.path} must be ${expectedOwnership}.`);
      continue;
    }
    if (seenManifestPaths.has(entry.path)) {
      errors.push(`Manifest contains duplicate managed path: ${entry.path}`);
      continue;
    }
    try {
      resolveInside(root, entry.path);
    } catch (error) {
      errors.push(`${path}: ${error.message}`);
      continue;
    }
    seenManifestPaths.add(entry.path);
    validManifestEntries.push(entry);
  }

  let rendered;
  try {
    rendered = renderArtifacts(blueprint, root);
  } catch (error) {
    errors.push(`Cannot render blueprint: ${error.message}`);
    rendered = new Map();
  }

  const manifestEntries = new Map(validManifestEntries.map((entry) => [entry.path, entry]));
  for (const artifact of rendered.values()) {
    if (artifact.ownership === "source") continue;
    const entry = manifestEntries.get(artifact.path);
    if (!entry) {
      errors.push(`Manifest does not own generated artifact: ${artifact.path}`);
      continue;
    }
    if (entry.ownership !== artifact.ownership) errors.push(`Ownership mismatch for ${artifact.path}.`);
    let expectedHash;
    try {
      expectedHash = hashOwnedContent(artifact.content, artifact.ownership);
    } catch (error) {
      errors.push(`Cannot hash expected ${artifact.path}: ${error.message}`);
      continue;
    }
    if (entry.sha256 !== expectedHash) {
      drift.push({ path: artifact.path, kind: "blueprint-drift", detail: "Manifest hash does not match the current blueprint output." });
    }
    let current;
    try {
      const absolute = resolveInside(root, artifact.path);
      current = readTextIfExists(absolute);
    } catch (error) {
      errors.push(`${artifact.path}: ${error.message}`);
      manifestEntries.delete(artifact.path);
      continue;
    }
    if (current === null) {
      drift.push({ path: artifact.path, kind: "missing", detail: "Managed artifact is missing." });
      manifestEntries.delete(artifact.path);
      continue;
    }
    try {
      const currentHash = hashOwnedContent(current, artifact.ownership);
      if (currentHash !== entry.sha256) drift.push({ path: artifact.path, kind: "content-drift", detail: "Managed content differs from the manifest." });
      if (currentHash !== expectedHash) drift.push({ path: artifact.path, kind: "render-drift", detail: "Managed content differs from the current blueprint rendering." });
    } catch (error) {
      drift.push({ path: artifact.path, kind: "marker-drift", detail: error.message });
    }
    if (/\[(?:TODO|PLACEHOLDER)[^\]]*\]|\{\{[^}]+\}\}/i.test(artifact.content)) {
      errors.push(`Generated artifact contains an unresolved placeholder: ${artifact.path}`);
    }
    if (/\.ai\/skills\/[^/]+\/SKILL\.md$/.test(artifact.path) || /\.(?:agents|claude)\/skills\/[^/]+\/SKILL\.md$/.test(artifact.path)) {
      errors.push(...validateSkillDocument(artifact.path, current).errors);
    }
    manifestEntries.delete(artifact.path);
  }

  for (const stale of manifestEntries.values()) {
    drift.push({ path: stale.path, kind: "stale-manifest-entry", detail: "Manifest owns an artifact not produced by the current blueprint." });
  }

  let agentsContent = null;
  try {
    agentsContent = readTextIfExists(resolveInside(root, "AGENTS.md"));
  } catch (error) {
    errors.push(`AGENTS.md: ${error.message}`);
  }
  if (agentsContent) {
    try {
      const block = extractManagedBlock(agentsContent);
      if (block && block.split(/\r?\n/).length > 120) errors.push("The managed AGENTS.md region exceeds 120 lines.");
    } catch (error) {
      errors.push(`AGENTS.md: ${error.message}`);
    }
  }

  try {
    const runnerPath = resolveInside(root, ".ai/verification/run.mjs");
    if (existsSync(runnerPath) && (statSync(runnerPath).mode & 0o111) === 0) {
      warnings.push(".ai/verification/run.mjs is not executable; it can still be run with node.");
    }
  } catch (error) {
    errors.push(`.ai/verification/run.mjs: ${error.message}`);
  }

  const driftErrors = options.allowDrift ? [] : drift.map((item) => `${item.path}: ${item.detail}`);
  errors.push(...driftErrors);
  const result = {
    ok: errors.length === 0,
    projectId: blueprint.project?.id ?? null,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    drift: [...new Map(drift.map((item) => [`${item.path}:${item.kind}`, item])).values()],
    counts: {
      facts: blueprint.evidence?.facts?.length ?? 0,
      rules: blueprint.rules?.length ?? 0,
      skills: blueprint.skills?.length ?? 0,
      workflows: blueprint.workflows?.length ?? 0,
      checks: blueprint.verification?.length ?? 0,
      managedFiles: manifest.managedFiles?.length ?? 0,
    },
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
}

main();
