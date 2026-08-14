import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { extractCiRunCommands } from "./ci-commands.mjs";

export const GENERATOR_NAME = "gongxu";
export const GENERATOR_VERSION = "0.1.0";
export const SCHEMA_VERSION = 1;
export const SUPPORTED_ADAPTERS = new Set(["codex", "claude"]);
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const FACT_STATUSES = new Set(["observed", "confirmed", "inferred", "unknown"]);
export const RULE_SCOPES = new Set(["project", "architecture", "workflow", "verification", "security", "ui"]);
export const RULE_SEVERITIES = new Set(["guide", "warn", "block"]);
export const HUMAN_OWNED_PATHS = Object.freeze([
  ".ai/blueprint.json",
  ".ai/architecture/decisions/",
  ".ai/memory/",
]);
const RESERVED_MARKERS = ["<!-- gongxu:begin -->", "<!-- gongxu:end -->"];
const MANAGED_REGION_PATHS = new Set(["AGENTS.md", "CLAUDE.md"]);
const MANAGED_FILE_PATHS = new Set([
  ".ai/project/profile.md",
  ".ai/project/facts.json",
  ".ai/project/repo-map.md",
  ".ai/architecture/current.md",
  ".ai/architecture/model.json",
  ".ai/architecture/boundaries.md",
  ".ai/rules/catalog.json",
  ".ai/examples/catalog.json",
  ".ai/verification/checks.json",
  ".ai/verification/run.mjs",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validId(value) {
  return nonEmpty(value) && value.length <= 80 && ID_PATTERN.test(value);
}

export function managedOwnershipForPath(path) {
  if (typeof path !== "string") return null;
  if (MANAGED_REGION_PATHS.has(path)) return "region";
  if (MANAGED_FILE_PATHS.has(path)) return "file";

  const rule = path.match(/^\.ai\/rules\/([a-z]+)\.md$/);
  if (rule && RULE_SCOPES.has(rule[1])) return "file";
  for (const pattern of [
    /^\.ai\/skills\/([^/]+)\/SKILL\.md$/,
    /^\.ai\/workflows\/([^/]+)\.md$/,
    /^\.agents\/skills\/gongxu-([^/]+)\/SKILL\.md$/,
    /^\.claude\/skills\/gongxu-([^/]+)\/SKILL\.md$/,
  ]) {
    const match = path.match(pattern);
    if (match && validId(match[1])) return "file";
  }
  return null;
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

function isSafeRelativePath(value, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) return false;
  if (value.length === 0) return true;
  if (value.includes("\0") || value.includes("\\")) return false;
  if (value.startsWith("/") || /^[A-Za-z]:\//.test(value)) return false;
  const parts = value.split("/");
  return !parts.includes("..") && !parts.includes("");
}

function isWithinRoot(root, relativePath) {
  const absolute = resolve(root, relativePath || ".");
  return absolute === root || absolute.startsWith(`${root}${sep}`);
}

function pathExists(root, relativePath, type = null) {
  if (!isSafeRelativePath(relativePath, { allowEmpty: true })) return false;
  if (!isWithinRoot(root, relativePath)) return false;
  const absolute = resolve(root, relativePath || ".");
  if (!existsSync(absolute)) return false;
  let canonical;
  let canonicalRoot;
  try {
    canonicalRoot = realpathSync(root);
    canonical = realpathSync(absolute);
  } catch {
    return false;
  }
  if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${sep}`)) return false;
  if (type === "directory") return statSync(canonical).isDirectory();
  if (type === "file") return statSync(canonical).isFile();
  return true;
}

function currentGitRevision(root) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

function unquoteCommand(value) {
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed[0] !== trimmed.at(-1) || !new Set(["\"", "'"]).has(trimmed[0])) {
    return trimmed;
  }
  if (trimmed[0] === "\"") {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed.slice(1, -1).replaceAll("''", "'");
}

function commandFromLine(line) {
  const run = line.match(/^\s*(?:-\s+)?run:\s*(.*?)\s*$/);
  const blockScalar = run?.[1].replace(/\s+#.*$/, "").trim();
  if (blockScalar && /^[|>][0-9+-]*$/.test(blockScalar)) return null;
  return unquoteCommand(run ? run[1] : line);
}

function jsonPointerSegments(pointer) {
  if (pointer.startsWith("/")) {
    const segments = pointer.slice(1).split("/");
    if (segments.some((segment) => /~(?:[^01]|$)/.test(segment))) return null;
    return segments.map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  }
  return pointer.split(".");
}

function commandAtFilePointer(root, relativePath, pointer) {
  let content;
  try {
    content = readFileSync(resolve(root, relativePath), "utf8");
  } catch {
    return null;
  }

  const linePointer = pointer.match(/^line:([1-9][0-9]*)$/);
  if (linePointer) {
    let canonicalPath;
    try {
      canonicalPath = relative(realpathSync(root), realpathSync(resolve(root, relativePath))).split(sep).join("/");
    } catch {
      return null;
    }
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(canonicalPath)) {
      const candidate = extractCiRunCommands(relativePath, content).candidates
        .find((item) => item.source.pointer === pointer);
      return candidate?.command ?? null;
    }
    const line = content.split(/\r?\n/)[Number(linePointer[1]) - 1];
    return line === undefined ? null : commandFromLine(line);
  }

  let value;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  const segments = jsonPointerSegments(pointer);
  if (segments === null) return null;
  for (const segment of segments) {
    if ((!isObject(value) && !Array.isArray(value)) || !Object.hasOwn(value, segment)) return null;
    value = value[segment];
  }
  return typeof value === "string" ? value.trim() : null;
}

function checkUniqueIds(items, path, errors) {
  const seen = new Set();
  for (let index = 0; index < items.length; index += 1) {
    const id = items[index]?.id;
    if (!validId(id)) errors.push(`${path}[${index}].id must be lowercase hyphen-case.`);
    if (seen.has(id)) errors.push(`${path} contains duplicate id: ${id}`);
    seen.add(id);
  }
}

function checkStringArray(value, path, errors, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
    return;
  }
  if (!allowEmpty && value.length === 0) errors.push(`${path} must not be empty.`);
  for (let index = 0; index < value.length; index += 1) {
    if (!nonEmpty(value[index])) errors.push(`${path}[${index}] must be a non-empty string.`);
  }
  if (new Set(value).size !== value.length) errors.push(`${path} must not contain duplicates.`);
}

function validateReservedMarkers(value, path, errors) {
  if (typeof value === "string") {
    if (RESERVED_MARKERS.some((marker) => value.includes(marker))) {
      errors.push(`${path} contains a reserved Gongxu managed marker.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      validateReservedMarkers(value[index], `${path}[${index}]`, errors);
    }
    return;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      validateReservedMarkers(child, `${path}.${key}`, errors);
    }
  }
}

function validateProject(project, errors) {
  const keys = ["id", "name", "summary", "stage", "kind", "primaryUsers", "domains", "constraints"];
  if (!checkObjectShape(project, "project", keys, keys, errors)) return;
  if (!validId(project.id)) errors.push("project.id must be lowercase hyphen-case.");
  for (const key of ["name", "summary", "stage", "kind"]) {
    if (!nonEmpty(project[key])) errors.push(`project.${key} must be a non-empty string.`);
  }
  if (!new Set(["greenfield", "prototype", "active", "mature", "legacy"]).has(project.stage)) {
    errors.push("project.stage is not supported.");
  }
  checkStringArray(project.primaryUsers, "project.primaryUsers", errors);
  checkStringArray(project.domains, "project.domains", errors);
  checkStringArray(project.constraints, "project.constraints", errors);
}

function validateEvidence(ledger, root, answerIds, errors, warnings) {
  const ledgerKeys = ["sourceRevision", "facts", "unknowns", "answers", "assumptions"];
  if (!checkObjectShape(ledger, "evidence", ledgerKeys, ledgerKeys, errors)) return new Map();
  if (!Array.isArray(ledger.facts)) {
    errors.push("evidence.facts must be an array.");
    return new Map();
  }
  checkUniqueIds(ledger.facts, "evidence.facts", errors);
  const facts = new Map();

  for (let index = 0; index < ledger.facts.length; index += 1) {
    const fact = ledger.facts[index];
    const path = `evidence.facts[${index}]`;
    const factKeys = ["id", "subject", "value", "status", "confidence", "evidence"];
    if (!checkObjectShape(fact, path, factKeys, factKeys, errors)) continue;
    facts.set(fact.id, fact);
    if (!nonEmpty(fact.subject)) errors.push(`${path}.subject must be non-empty.`);
    if (!FACT_STATUSES.has(fact.status)) errors.push(`${path}.status is invalid.`);
    if (typeof fact.confidence !== "number" || fact.confidence < 0 || fact.confidence > 1) {
      errors.push(`${path}.confidence must be between 0 and 1.`);
    }
    if (!Array.isArray(fact.evidence)) errors.push(`${path}.evidence must be an array.`);
    const evidence = Array.isArray(fact.evidence) ? fact.evidence : [];
    if ((fact.status === "observed" || fact.status === "confirmed") && evidence.length === 0) {
      errors.push(`${path} requires provenance for ${fact.status} status.`);
    }
    for (let evidenceIndex = 0; evidenceIndex < evidence.length; evidenceIndex += 1) {
      const record = evidence[evidenceIndex];
      const recordPath = `${path}.evidence[${evidenceIndex}]`;
      const recordKeys = ["kind", "path", "pointer", "note"];
      if (!checkObjectShape(record, recordPath, ["kind", "note"], recordKeys, errors)) continue;
      if (!new Set(["file", "command", "interview", "existing-config"]).has(record.kind)) {
        errors.push(`${recordPath}.kind is invalid.`);
        continue;
      }
      if (!nonEmpty(record.note)) errors.push(`${recordPath}.note must be non-empty.`);
      if (record.path !== undefined && typeof record.path !== "string") errors.push(`${recordPath}.path must be a string.`);
      if (record.pointer !== undefined && typeof record.pointer !== "string") errors.push(`${recordPath}.pointer must be a string.`);
      if (record.kind === "file" || record.kind === "existing-config") {
        if (!nonEmpty(record.path) || !pathExists(root, record.path)) {
          errors.push(`${recordPath}.path does not exist: ${record.path ?? "<missing>"}`);
        }
      } else if (record.kind === "command" && !nonEmpty(record.pointer)) {
        errors.push(`${recordPath}.pointer must record the observed command.`);
      } else if (record.kind === "interview" && (!nonEmpty(record.pointer) || !answerIds.has(record.pointer))) {
        errors.push(`${recordPath}.pointer must reference an evidence.answers id.`);
      }
    }
    if (fact.status === "observed" && !evidence.some((record) => ["file", "command", "existing-config"].includes(record?.kind))) {
      errors.push(`${path} observed fact requires file, command, or existing-config provenance.`);
    }
    if (fact.status === "confirmed" && !evidence.some((record) => ["interview", "existing-config"].includes(record?.kind))) {
      errors.push(`${path} confirmed fact requires interview or existing-config provenance.`);
    }
  }

  if (!Array.isArray(ledger.unknowns)) errors.push("evidence.unknowns must be an array.");
  else {
    checkUniqueIds(ledger.unknowns, "evidence.unknowns", errors);
    for (let index = 0; index < ledger.unknowns.length; index += 1) {
      const unknown = ledger.unknowns[index];
      const path = `evidence.unknowns[${index}]`;
      const keys = ["id", "question", "impact", "blocking"];
      if (!checkObjectShape(unknown, path, keys, keys, errors)) continue;
      if (!nonEmpty(unknown.question) || !nonEmpty(unknown.impact)) {
        errors.push(`Unknown ${unknown.id || "<missing>"} needs question and impact.`);
      }
      if (typeof unknown.blocking !== "boolean") errors.push(`${path}.blocking must be boolean.`);
      if (unknown.blocking === true) errors.push(`Blocking unknown must be resolved before compilation: ${unknown.id}`);
    }
  }
  if (!Array.isArray(ledger.answers)) errors.push("evidence.answers must be an array.");
  else {
    checkUniqueIds(ledger.answers, "evidence.answers", errors);
    for (let index = 0; index < ledger.answers.length; index += 1) {
      const answer = ledger.answers[index];
      const path = `evidence.answers[${index}]`;
      const keys = ["id", "question", "answer"];
      if (!checkObjectShape(answer, path, keys, keys, errors)) continue;
      if (!nonEmpty(answer.question) || !nonEmpty(answer.answer)) errors.push(`${path} needs question and answer.`);
    }
  }
  checkStringArray(ledger.assumptions, "evidence.assumptions", errors);
  if (!(ledger.sourceRevision === null || nonEmpty(ledger.sourceRevision))) {
    errors.push("evidence.sourceRevision must be a non-empty string or null.");
  } else {
    const currentRevision = currentGitRevision(root);
    if (currentRevision && ledger.sourceRevision === null) {
      warnings.push(`evidence.sourceRevision is missing; current Git HEAD is ${currentRevision}.`);
    } else if (currentRevision && ledger.sourceRevision !== currentRevision) {
      warnings.push(`evidence.sourceRevision ${ledger.sourceRevision} differs from current Git HEAD ${currentRevision}; refresh repository evidence before adding new rules.`);
    }
  }
  return facts;
}

function validateArchitectureState(state, statePath, root, errors, { target = false } = {}) {
  const keys = target ? ["summary", "style", "modules", "status"] : ["summary", "style", "modules"];
  if (!checkObjectShape(state, statePath, keys, keys, errors)) return new Map();
  if (!nonEmpty(state.summary) || !nonEmpty(state.style)) {
    errors.push(`${statePath}.summary and style must be non-empty.`);
  }
  if (!Array.isArray(state.modules)) {
    errors.push(`${statePath}.modules must be an array.`);
    return new Map();
  }
  checkUniqueIds(state.modules, `${statePath}.modules`, errors);
  const modules = new Map(state.modules.filter(isObject).map((module) => [module.id, module]));
  for (let index = 0; index < state.modules.length; index += 1) {
    const module = state.modules[index];
    const modulePath = `${statePath}.modules[${index}]`;
    const moduleKeys = ["id", "name", "responsibilities", "dependencies", "paths", "planned"];
    if (!checkObjectShape(module, modulePath, moduleKeys, moduleKeys, errors)) continue;
    if (!nonEmpty(module.name)) errors.push(`${modulePath}.name must be non-empty.`);
    checkStringArray(module.responsibilities, `${modulePath}.responsibilities`, errors);
    checkStringArray(module.dependencies, `${modulePath}.dependencies`, errors);
    checkStringArray(module.paths, `${modulePath}.paths`, errors);
    if (typeof module.planned !== "boolean") errors.push(`${modulePath}.planned must be boolean.`);
    for (const dependency of module.dependencies || []) {
      if (!validId(dependency)) errors.push(`${modulePath}.dependencies contains an invalid module id: ${dependency}`);
      if (!modules.has(dependency)) errors.push(`${modulePath} references unknown module dependency: ${dependency}`);
      if (dependency === module.id) errors.push(`${modulePath} must not depend on itself.`);
    }
    for (const path of module.paths || []) {
      if (!isSafeRelativePath(path)) errors.push(`${modulePath}.paths is not a safe repository-relative path: ${path}`);
      else if (!module.planned && !pathExists(root, path)) errors.push(`${modulePath}.paths does not exist: ${path}`);
    }
  }
  return modules;
}

function validateArchitecture(architecture, root, facts, errors) {
  const keys = ["current", "target", "boundaries"];
  if (!checkObjectShape(architecture, "architecture", keys, keys, errors)) return;
  validateArchitectureState(architecture.current, "architecture.current", root, errors);
  validateArchitectureState(architecture.target, "architecture.target", root, errors, { target: true });
  if (!new Set(["preserve-current", "confirmed", "proposed"]).has(architecture.target?.status)) {
    errors.push("architecture.target.status is invalid.");
  }
  if (!Array.isArray(architecture.boundaries)) {
    errors.push("architecture.boundaries must be an array.");
    return;
  }
  checkUniqueIds(architecture.boundaries, "architecture.boundaries", errors);
  for (let index = 0; index < architecture.boundaries.length; index += 1) {
    const boundary = architecture.boundaries[index];
    const path = `architecture.boundaries[${index}]`;
    const boundaryKeys = ["id", "from", "to", "policy", "rationale", "sourceFactIds"];
    if (!checkObjectShape(boundary, path, boundaryKeys, boundaryKeys, errors)) continue;
    for (const key of ["from", "to", "rationale"]) {
      if (!nonEmpty(boundary[key])) errors.push(`${path}.${key} must be non-empty.`);
    }
    if (!new Set(["allow", "deny", "approval"]).has(boundary.policy)) errors.push(`${path}.policy is invalid.`);
    checkStringArray(boundary.sourceFactIds, `${path}.sourceFactIds`, errors, { allowEmpty: false });
    for (const factId of boundary.sourceFactIds || []) {
      const fact = facts.get(factId);
      if (!fact) errors.push(`${path} references unknown fact: ${factId}`);
      else if (!new Set(["observed", "confirmed"]).has(fact.status) && boundary.policy !== "allow") {
        errors.push(`${path} ${boundary.policy} policy relies on unconfirmed fact: ${factId}`);
      }
    }
  }
}

function validateChecks(checks, root, answers, errors) {
  if (!Array.isArray(checks)) {
    errors.push("verification must be an array.");
    return new Map();
  }
  checkUniqueIds(checks, "verification", errors);
  const map = new Map();
  for (let index = 0; index < checks.length; index += 1) {
    const check = checks[index];
    const path = `verification[${index}]`;
    const checkKeys = ["id", "name", "command", "cwd", "required", "source"];
    if (!checkObjectShape(check, path, checkKeys, checkKeys, errors)) continue;
    map.set(check.id, check);
    if (!nonEmpty(check.name) || !nonEmpty(check.command)) errors.push(`${path} needs name and command.`);
    if (typeof check.command === "string" && /[\r\n\0]/.test(check.command)) {
      errors.push(`${path}.command must be a single line without NUL bytes.`);
    }
    if (typeof check.required !== "boolean") errors.push(`${path}.required must be boolean.`);
    if (typeof check.cwd !== "string" || !isSafeRelativePath(check.cwd || ".") || !pathExists(root, check.cwd || ".", "directory")) {
      errors.push(`${path}.cwd does not exist: ${check.cwd ?? "<missing>"}`);
    }
    const sourceKeys = ["kind", "path", "pointer", "note"];
    if (checkObjectShape(check.source, `${path}.source`, ["kind", "path", "note"], sourceKeys, errors)) {
      if (!nonEmpty(check.source.note)) errors.push(`${path}.source.note must be non-empty.`);
      if (check.source.pointer !== undefined && typeof check.source.pointer !== "string") {
        errors.push(`${path}.source.pointer must be a string.`);
      }
      if (!new Set(["file", "interview", "existing-config"]).has(check.source.kind)) {
        errors.push(`${path}.source.kind is invalid.`);
      } else if (check.source.kind === "file" || check.source.kind === "existing-config") {
        const sourceExists = nonEmpty(check.source.path) && pathExists(root, check.source.path, "file");
        if (!sourceExists) {
          errors.push(`${path}.source.path does not exist: ${check.source.path ?? "<missing>"}`);
        }
        if (!nonEmpty(check.source.pointer)) {
          errors.push(`${path}.source.pointer must identify an exact line or JSON value.`);
        } else if (sourceExists && nonEmpty(check.command)) {
          const sourcedCommand = commandAtFilePointer(root, check.source.path, check.source.pointer);
          if (sourcedCommand !== check.command.trim()) {
            errors.push(`${path}.source.pointer does not resolve to the exact command ${JSON.stringify(check.command.trim())}.`);
          }
        }
      } else if (!nonEmpty(check.source.path)) {
        errors.push(`${path}.source.path must identify the confirming interview answer.`);
      } else if (!answers.has(check.source.path)) {
        errors.push(`${path}.source.path references unknown interview answer: ${check.source.path}`);
      } else if (nonEmpty(check.command)) {
        const answer = answers.get(check.source.path)?.answer;
        if (typeof answer !== "string" || answer.trim() !== check.command.trim()) {
          errors.push(`${path}.source interview answer must exactly equal the command ${JSON.stringify(check.command.trim())}.`);
        }
      }
    }
  }
  return map;
}

function validateRules(rules, facts, checks, errors) {
  if (!Array.isArray(rules)) {
    errors.push("rules must be an array.");
    return;
  }
  checkUniqueIds(rules, "rules", errors);
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    const path = `rules[${index}]`;
    const required = ["id", "scope", "statement", "rationale", "severity", "sourceFactIds"];
    const allowed = [...required, "checkId", "approvalRequired"];
    if (!checkObjectShape(rule, path, required, allowed, errors)) continue;
    if (!RULE_SCOPES.has(rule.scope)) errors.push(`${path}.scope is invalid.`);
    if (!RULE_SEVERITIES.has(rule.severity)) errors.push(`${path}.severity is invalid.`);
    if (!nonEmpty(rule.statement) || !nonEmpty(rule.rationale)) errors.push(`${path} needs statement and rationale.`);
    checkStringArray(rule.sourceFactIds, `${path}.sourceFactIds`, errors, { allowEmpty: false });
    for (const factId of rule.sourceFactIds || []) {
      const fact = facts.get(factId);
      if (!fact) errors.push(`${path} references unknown fact: ${factId}`);
      else if ((rule.severity === "warn" || rule.severity === "block") && !new Set(["observed", "confirmed"]).has(fact.status)) {
        errors.push(`${path} ${rule.severity} rule relies on unconfirmed fact: ${factId}`);
      }
    }
    if (rule.checkId !== undefined && !validId(rule.checkId)) errors.push(`${path}.checkId must be lowercase hyphen-case.`);
    else if (rule.checkId && !checks.has(rule.checkId)) errors.push(`${path} references unknown check: ${rule.checkId}`);
    if (rule.approvalRequired !== undefined && typeof rule.approvalRequired !== "boolean") {
      errors.push(`${path}.approvalRequired must be boolean.`);
    }
    if (rule.severity === "block" && !rule.checkId && rule.approvalRequired !== true) {
      errors.push(`${path} blocking rule needs checkId or approvalRequired=true.`);
    }
  }
}

function validateSkills(skills, root, checks, errors, warnings) {
  if (!Array.isArray(skills)) {
    errors.push("skills must be an array.");
    return;
  }
  checkUniqueIds(skills, "skills", errors);
  for (let index = 0; index < skills.length; index += 1) {
    const skill = skills[index];
    const path = `skills[${index}]`;
    const keys = ["id", "name", "description", "triggers", "context", "steps", "verificationCheckIds"];
    if (!checkObjectShape(skill, path, keys, keys, errors)) continue;
    for (const key of ["name", "description"]) if (!nonEmpty(skill[key])) errors.push(`${path}.${key} must be non-empty.`);
    checkStringArray(skill.triggers, `${path}.triggers`, errors, { allowEmpty: false });
    checkStringArray(skill.context, `${path}.context`, errors);
    checkStringArray(skill.steps, `${path}.steps`, errors, { allowEmpty: false });
    checkStringArray(skill.verificationCheckIds, `${path}.verificationCheckIds`, errors);
    for (const contextPath of skill.context || []) {
      if (!isSafeRelativePath(contextPath)) {
        errors.push(`${path}.context path is not repository-relative: ${contextPath}`);
      } else if (!contextPath.startsWith(".ai/") && !pathExists(root, contextPath)) {
        warnings.push(`${path}.context path is unresolved: ${contextPath}`);
      }
    }
    for (const checkId of skill.verificationCheckIds || []) {
      if (!checks.has(checkId)) errors.push(`${path} references unknown check: ${checkId}`);
    }
  }
}

function validateWorkflows(workflows, checks, errors) {
  if (!Array.isArray(workflows) || workflows.length === 0) {
    errors.push("workflows must contain at least one workflow.");
    return;
  }
  checkUniqueIds(workflows, "workflows", errors);
  for (let index = 0; index < workflows.length; index += 1) {
    const workflow = workflows[index];
    const path = `workflows[${index}]`;
    const keys = ["id", "name", "triggers", "steps"];
    if (!checkObjectShape(workflow, path, keys, keys, errors)) continue;
    if (!nonEmpty(workflow.name)) errors.push(`${path}.name must be non-empty.`);
    checkStringArray(workflow.triggers, `${path}.triggers`, errors, { allowEmpty: false });
    if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
      errors.push(`${path}.steps must not be empty.`);
      continue;
    }
    checkUniqueIds(workflow.steps, `${path}.steps`, errors);
    for (let stepIndex = 0; stepIndex < workflow.steps.length; stepIndex += 1) {
      const step = workflow.steps[stepIndex];
      const stepPath = `${path}.steps[${stepIndex}]`;
      const required = ["id", "action", "required"];
      const allowed = [...required, "checkId"];
      if (!checkObjectShape(step, stepPath, required, allowed, errors)) continue;
      if (!nonEmpty(step.action)) errors.push(`${path} step ${step.id} needs an action.`);
      if (typeof step.required !== "boolean") errors.push(`${path} step ${step.id} required must be boolean.`);
      if (step.checkId !== undefined && !validId(step.checkId)) errors.push(`${stepPath}.checkId must be lowercase hyphen-case.`);
      else if (step.checkId && !checks.has(step.checkId)) errors.push(`${path} step ${step.id} references unknown check: ${step.checkId}`);
    }
  }
}

function validateExamples(examples, root, facts, errors) {
  if (!Array.isArray(examples)) {
    errors.push("examples must be an array.");
    return;
  }
  checkUniqueIds(examples, "examples", errors);
  for (let index = 0; index < examples.length; index += 1) {
    const example = examples[index];
    const path = `examples[${index}]`;
    const keys = ["id", "path", "demonstrates", "sourceFactIds"];
    if (!checkObjectShape(example, path, keys, keys, errors)) continue;
    if (!nonEmpty(example.path) || !pathExists(root, example.path)) errors.push(`${path}.path does not exist: ${example.path}`);
    checkStringArray(example.demonstrates, `${path}.demonstrates`, errors, { allowEmpty: false });
    checkStringArray(example.sourceFactIds, `${path}.sourceFactIds`, errors, { allowEmpty: false });
    for (const factId of example.sourceFactIds || []) {
      const fact = facts.get(factId);
      if (!fact) errors.push(`${path} references unknown fact: ${factId}`);
      else if (!new Set(["observed", "confirmed"]).has(fact.status)) errors.push(`${path} relies on unconfirmed fact: ${factId}`);
    }
  }
}

export function validateBlueprint(blueprint, root) {
  const errors = [];
  const warnings = [];
  if (!isObject(blueprint)) return { errors: ["Blueprint must be a JSON object."], warnings };
  const keys = [
    "schemaVersion",
    "project",
    "evidence",
    "architecture",
    "rules",
    "skills",
    "workflows",
    "examples",
    "verification",
    "adapters",
  ];
  checkObjectShape(blueprint, "blueprint", keys, keys, errors);
  validateReservedMarkers(blueprint, "blueprint", errors);
  if (blueprint.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must equal ${SCHEMA_VERSION}.`);
  validateProject(blueprint.project, errors);
  const answers = new Map(
    (Array.isArray(blueprint.evidence?.answers) ? blueprint.evidence.answers : [])
      .filter((answer) => validId(answer?.id))
      .map((answer) => [answer.id, answer])
  );
  const facts = validateEvidence(blueprint.evidence, root, answers, errors, warnings);
  const checks = validateChecks(blueprint.verification, root, answers, errors);
  validateArchitecture(blueprint.architecture, root, facts, errors);
  validateRules(blueprint.rules, facts, checks, errors);
  validateSkills(blueprint.skills, root, checks, errors, warnings);
  validateWorkflows(blueprint.workflows, checks, errors);
  validateExamples(blueprint.examples, root, facts, errors);
  if (!Array.isArray(blueprint.adapters)) errors.push("adapters must be an array.");
  else {
    if (new Set(blueprint.adapters).size !== blueprint.adapters.length) errors.push("adapters must not contain duplicates.");
    for (const adapter of blueprint.adapters) {
      if (!SUPPORTED_ADAPTERS.has(adapter)) errors.push(`Unsupported adapter: ${adapter}`);
    }
  }
  return { errors, warnings };
}
