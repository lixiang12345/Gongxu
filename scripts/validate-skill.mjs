#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { validateSkillDocument } from "../skills/bootstrap-ai-project/scripts/lib/skill-documents.mjs";

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
const documentValidation = validateSkillDocument(skillPath, content);
if (documentValidation.errors.length > 0) fail(documentValidation.errors.join("\n"));
const { name } = documentValidation.metadata;

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
