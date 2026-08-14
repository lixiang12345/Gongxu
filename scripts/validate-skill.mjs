#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const skillRoot = resolve(process.argv[2] || "");
if (!process.argv[2] || !existsSync(skillRoot) || !statSync(skillRoot).isDirectory()) {
  fail("Usage: validate-skill.mjs <skill-directory>");
}

const skillPath = resolve(skillRoot, "SKILL.md");
if (!existsSync(skillPath)) fail("SKILL.md not found.");
const content = readFileSync(skillPath, "utf8");
const match = content.match(/^---\n([\s\S]*?)\n---\n/);
if (!match) fail("SKILL.md has invalid YAML frontmatter delimiters.");

const metadata = new Map();
for (const [index, line] of match[1].split("\n").entries()) {
  const field = line.match(/^([a-z][a-z0-9-]*):\s*(.*)$/);
  if (!field) fail(`Unsupported frontmatter syntax on line ${index + 2}.`);
  if (metadata.has(field[1])) fail(`Duplicate frontmatter field: ${field[1]}`);
  metadata.set(field[1], field[2].replace(/^(["'])([\s\S]*)\1$/, "$2").trim());
}

const unexpected = [...metadata.keys()].filter((key) => !new Set(["name", "description"]).has(key));
if (unexpected.length > 0) fail(`Unexpected frontmatter fields: ${unexpected.join(", ")}`);

const name = metadata.get("name") || "";
const description = metadata.get("description") || "";
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
  fail("Skill name must be lowercase hyphen-case and at most 64 characters.");
}
if (basename(skillRoot) !== name) fail("Skill directory name must match the frontmatter name.");
if (!description || description.length > 1024 || /[<>]/.test(description)) {
  fail("Skill description must be non-empty, at most 1024 characters, and contain no angle brackets.");
}
if (content.split(/\r?\n/).length > 500) fail("SKILL.md must stay below 500 lines.");

const openaiPath = resolve(skillRoot, "agents/openai.yaml");
if (!existsSync(openaiPath)) fail("agents/openai.yaml not found.");
const openai = readFileSync(openaiPath, "utf8");
const displayName = openai.match(/^\s*display_name:\s*"([^"]+)"\s*$/m)?.[1];
const shortDescription = openai.match(/^\s*short_description:\s*"([^"]+)"\s*$/m)?.[1];
const defaultPrompt = openai.match(/^\s*default_prompt:\s*"([^"]+)"\s*$/m)?.[1];
if (!displayName) fail("agents/openai.yaml needs a quoted display_name.");
if (!shortDescription || shortDescription.length < 25 || shortDescription.length > 64) {
  fail("agents/openai.yaml short_description must be 25-64 characters.");
}
if (!defaultPrompt?.includes(`$${name}`)) {
  fail(`agents/openai.yaml default_prompt must mention $${name}.`);
}

const forbidden = readdirSync(skillRoot).filter((entry) => /^(?:README|CHANGELOG|INSTALLATION_GUIDE|QUICK_REFERENCE)(?:\.|$)/i.test(entry));
if (forbidden.length > 0) fail(`Skill contains auxiliary files: ${forbidden.join(", ")}`);

process.stdout.write("Skill is valid.\n");
