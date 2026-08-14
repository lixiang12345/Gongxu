export const MAX_SKILL_NAME_LENGTH = 64;
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024;
export const MAX_SKILL_DOCUMENT_LINES = 500;
export const SKILL_ADAPTER_PREFIX = "gongxu-";
export const MAX_PROJECT_SKILL_ID_LENGTH = MAX_SKILL_NAME_LENGTH - SKILL_ADAPTER_PREFIX.length;

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_METADATA_FIELDS = new Set(["name", "description"]);
const ADAPTER_NAMES = Object.freeze({
  codex: "Codex",
  claude: "Claude Code",
});

function characterCount(value) {
  return [...value].length;
}

function documentLineCount(content) {
  if (content.length === 0) return 0;
  const lines = content.split(/\r\n|\r|\n/);
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

function directoryNameForSkillPath(path) {
  const parts = String(path).replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.length >= 2 ? parts.at(-2) : null;
}

function parseScalar(raw, lineNumber) {
  const value = raw.trim();
  if (!value.startsWith("\"") && !value.startsWith("'")) return { value };
  if (value.startsWith("\"")) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== "string") throw new Error("value is not a string");
      return { value: parsed };
    } catch (error) {
      return { error: `has invalid quoted YAML on frontmatter line ${lineNumber}: ${error.message}` };
    }
  }
  if (!value.endsWith("'") || value.length < 2) {
    return { error: `has invalid quoted YAML on frontmatter line ${lineNumber}` };
  }
  return { value: value.slice(1, -1).replaceAll("''", "'") };
}

function parseFrontmatter(content) {
  const match = content.match(/^---(?:\r\n|\n)([\s\S]*?)(?:\r\n|\n)---(?:(?:\r\n|\n)|$)/);
  if (!match) return { metadata: null, errors: ["has no valid YAML frontmatter"] };

  const metadata = new Map();
  const errors = [];
  for (const [index, line] of match[1].split(/\r\n|\r|\n/).entries()) {
    const lineNumber = index + 2;
    const field = line.match(/^([a-z][a-z0-9-]*):[ \t]*(.*)$/);
    if (!field) {
      errors.push(`has unsupported YAML syntax on frontmatter line ${lineNumber}`);
      continue;
    }
    if (metadata.has(field[1])) {
      errors.push(`has duplicate frontmatter field: ${field[1]}`);
      continue;
    }
    const parsed = parseScalar(field[2], lineNumber);
    if (parsed.error) errors.push(parsed.error);
    else metadata.set(field[1], parsed.value);
  }
  const unexpected = [...metadata.keys()].filter((field) => !SKILL_METADATA_FIELDS.has(field));
  if (unexpected.length > 0) errors.push(`has unsupported frontmatter fields: ${unexpected.join(", ")}`);
  return { metadata, errors };
}

export function canonicalSkillMetadata(skill) {
  const triggers = Array.isArray(skill.triggers) ? skill.triggers : [];
  return {
    name: skill.id,
    description: `${skill.description} Use when ${triggers.join("; ")}.`,
  };
}

export function adapterSkillMetadata(skill, adapter) {
  const adapterName = ADAPTER_NAMES[adapter];
  if (!adapterName) throw new Error(`Unsupported Skill adapter: ${adapter}`);
  return {
    name: `${SKILL_ADAPTER_PREFIX}${skill.id}`,
    description: `${skill.description} This is the ${adapterName} adapter for the canonical Gongxu project skill.`,
  };
}

export function validateSkillName(name, expectedName = null) {
  const errors = [];
  if (typeof name !== "string" || !SKILL_NAME_PATTERN.test(name)) {
    errors.push("must be lowercase hyphen-case");
  } else if (name.length > MAX_SKILL_NAME_LENGTH) {
    errors.push(`must be at most ${MAX_SKILL_NAME_LENGTH} characters`);
  }
  if (expectedName !== null && name !== expectedName) {
    errors.push(`must match its directory name ${JSON.stringify(expectedName)}`);
  }
  return errors;
}

export function validateSkillDescription(description) {
  const errors = [];
  if (typeof description !== "string" || description.trim().length === 0) {
    errors.push("must be non-empty");
    return errors;
  }
  if (characterCount(description) > MAX_SKILL_DESCRIPTION_LENGTH) {
    errors.push(`must be at most ${MAX_SKILL_DESCRIPTION_LENGTH} characters`);
  }
  if (/[<>]/.test(description)) errors.push("must not contain angle brackets");
  return errors;
}

export function validateSkillDocument(path, content) {
  const errors = [];
  if (typeof content !== "string") {
    return { metadata: null, errors: [`${path} cannot be read as text.`] };
  }

  const parsed = parseFrontmatter(content);
  errors.push(...parsed.errors.map((error) => `${path} ${error}.`));
  if (parsed.metadata) {
    const name = parsed.metadata.get("name");
    const description = parsed.metadata.get("description");
    for (const error of validateSkillName(name, directoryNameForSkillPath(path))) {
      errors.push(`${path} skill name ${error}.`);
    }
    for (const error of validateSkillDescription(description)) {
      errors.push(`${path} skill description ${error}.`);
    }
  }
  const lineCount = documentLineCount(content);
  if (lineCount > MAX_SKILL_DOCUMENT_LINES) {
    errors.push(`${path} has ${lineCount} lines; Skill documents must not exceed ${MAX_SKILL_DOCUMENT_LINES} lines.`);
  }
  return {
    metadata: parsed.metadata
      ? {
          name: parsed.metadata.get("name"),
          description: parsed.metadata.get("description"),
        }
      : null,
    errors,
  };
}
