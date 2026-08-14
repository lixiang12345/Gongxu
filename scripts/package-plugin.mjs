#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_NAME = "gongxu";
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const canonicalSkill = join(repositoryRoot, "skills/bootstrap-ai-project");
const packageMetadata = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));

function usage() {
  return "Usage: package-plugin.mjs [--output <path-ending-in-gongxu>] [--force]\n";
}

function parseArgs(argv) {
  const options = { output: resolve(repositoryRoot, "dist/gongxu"), force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force") options.force = true;
    else if (arg === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--output requires a value.");
      options.output = resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (basename(options.output) !== PLUGIN_NAME) {
    throw new Error(`Plugin output directory must be named ${PLUGIN_NAME}: ${options.output}`);
  }
  return options;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function inventory(root) {
  const entries = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      if (entry.isSymbolicLink()) throw new Error(`Plugin trees must not contain symbolic links: ${path}`);
      if (entry.isDirectory()) {
        entries.push({ path, type: "directory" });
        visit(absolute);
      } else if (entry.isFile()) {
        entries.push({ path, type: "file", sha256: sha256(readFileSync(absolute)) });
      } else {
        throw new Error(`Plugin trees contain an unsupported entry: ${path}`);
      }
    }
  }
  visit(root);
  return entries;
}

function pluginManifest() {
  return {
    name: PLUGIN_NAME,
    version: packageMetadata.version,
    description: "Initialize evidence-backed AI engineering systems for existing repositories.",
    author: {
      name: "mingji",
      url: "https://github.com/lixiang12345",
    },
    homepage: "https://github.com/lixiang12345/Gongxu",
    repository: "https://github.com/lixiang12345/Gongxu",
    license: packageMetadata.license,
    keywords: ["agent-skills", "ai-engineering", "repository-bootstrap"],
    skills: "./skills/",
    interface: {
      displayName: "Gongxu",
      shortDescription: "Initialize an evidence-backed AI engineering system.",
      longDescription: "Inspect a repository, resolve consequential unknowns, and compile a validated .ai project contract with thin agent adapters.",
      developerName: "mingji",
      category: "Developer Tools",
      capabilities: ["Repository analysis", "Project rule compilation", "Agent adapter generation"],
      websiteURL: "https://github.com/lixiang12345/Gongxu",
      defaultPrompt: "Analyze this repository and initialize its evidence-backed AI engineering system.",
    },
  };
}

function assertReplaceable(output) {
  if (lstatSync(output).isSymbolicLink() || !lstatSync(output).isDirectory()) {
    throw new Error(`Refusing to replace a non-directory plugin output: ${output}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(output, ".codex-plugin/plugin.json"), "utf8"));
  } catch {
    throw new Error(`Refusing to replace an output without a readable Gongxu plugin manifest: ${output}`);
  }
  if (manifest.name !== PLUGIN_NAME) {
    throw new Error(`Refusing to replace an output owned by plugin ${String(manifest.name)}: ${output}`);
  }
}

function buildPlugin(pluginRoot) {
  const manifestDirectory = join(pluginRoot, ".codex-plugin");
  mkdirSync(manifestDirectory, { recursive: true });
  writeFileSync(join(manifestDirectory, "plugin.json"), `${JSON.stringify(pluginManifest(), null, 2)}\n`);
  cpSync(canonicalSkill, join(pluginRoot, "skills/bootstrap-ai-project"), { recursive: true });
}

function packagePlugin(options) {
  inventory(canonicalSkill);
  const outputParent = dirname(options.output);
  mkdirSync(outputParent, { recursive: true });
  const stagingDirectory = mkdtempSync(join(outputParent, ".gongxu-package-"));
  const stagedPlugin = join(stagingDirectory, PLUGIN_NAME);
  let changed = true;
  try {
    buildPlugin(stagedPlugin);
    const stagedInventory = inventory(stagedPlugin);
    if (existsSync(options.output)) {
      assertReplaceable(options.output);
      if (JSON.stringify(inventory(options.output)) === JSON.stringify(stagedInventory)) {
        changed = false;
        return { output: options.output, changed, files: stagedInventory.filter((entry) => entry.type === "file").length };
      }
      if (!options.force) {
        throw new Error(`Plugin output differs from the canonical package; rerun with --force to replace: ${options.output}`);
      }
      rmSync(options.output, { recursive: true });
    }
    renameSync(stagedPlugin, options.output);
    return { output: options.output, changed, files: stagedInventory.filter((entry) => entry.type === "file").length };
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    const result = packagePlugin(options);
    process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${options ? "" : usage()}`);
    process.exit(1);
  }
}

main();
