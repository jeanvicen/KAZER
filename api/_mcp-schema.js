const MAX_SCHEMA_BYTES = 32_768;
const MAX_SCHEMA_NODES = 512;
const MAX_SCHEMA_DEPTH = 14;
const MAX_ARGUMENT_BYTES = 12_000;
const MAX_VALUE_DEPTH = 16;
const MAX_VALIDATION_STEPS = 4096;
const TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
const SAFE_FORMATS = new Set(["date", "date-time", "time", "email", "hostname", "ipv4", "ipv6", "uri", "uuid"]);
const SAFE_KEYWORDS = new Set([
  "$schema", "$id", "$ref", "$defs", "definitions", "$comment", "title", "description", "default", "examples", "deprecated", "readOnly", "writeOnly",
  "type", "properties", "required", "additionalProperties", "patternProperties", "propertyNames", "items", "prefixItems", "additionalItems", "contains", "minContains", "maxContains",
  "enum", "const", "allOf", "anyOf", "oneOf", "not", "dependentRequired", "dependencies",
  "minProperties", "maxProperties", "minItems", "maxItems", "uniqueItems", "minLength", "maxLength", "pattern", "format",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
]);
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function isSafePattern(pattern) {
  if (typeof pattern !== "string" || pattern.length > 128) return false;
  let source = pattern;
  if (source.startsWith("^")) source = source.slice(1);
  if (source.endsWith("$")) source = source.slice(0, -1);
  let index = 0;
  let unboundedQuantifiers = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
      if (index >= source.length || !/[dDsSwW.-]/.test(source[index])) return false;
      index += 1;
    } else if (char === "[") {
      index += 1;
      if (source[index] === "^") index += 1;
      let found = false;
      while (index < source.length && source[index] !== "]") {
        if (source[index] === "\\") index += 1;
        if (index >= source.length || /[\[\]\n\r]/.test(source[index])) return false;
        found = true;
        index += 1;
      }
      if (!found || source[index] !== "]") return false;
      index += 1;
    } else if (char === "." || /[A-Za-z0-9_\-: @/]/.test(char)) {
      index += 1;
    } else {
      return false;
    }
    if (source[index] === "*" || source[index] === "+") {
      unboundedQuantifiers += 1;
      if (unboundedQuantifiers > 1) return false;
      index += 1;
    } else if (source[index] === "?") {
      index += 1;
    } else if (source[index] === "{") {
      const match = source.slice(index).match(/^\{(\d{1,3})(?:,(\d{0,3}))?\}/);
      if (!match) return false;
      const min = Number(match[1]);
      const max = match[2] === undefined || match[2] === "" ? min : Number(match[2]);
      if (max < min || max > 256) return false;
      index += match[0].length;
    }
  }
  try { new RegExp(pattern); return true; } catch { return false; }
}

function sanitizeMcpInputSchema(input) {
  try {
    if (!isObject(input) || Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_SCHEMA_BYTES) return null;
    const root = JSON.parse(JSON.stringify(input));
    let nodes = 0;
    const references = [];
    const visit = (schema, depth) => {
      if (schema === true || schema === false) return;
      if (!isObject(schema) || depth > MAX_SCHEMA_DEPTH || ++nodes > MAX_SCHEMA_NODES) throw new Error("schema_bounds");
      for (const key of Object.keys(schema)) {
        if (FORBIDDEN_KEYS.has(key) || !SAFE_KEYWORDS.has(key)) throw new Error("schema_keyword_unsupported");
      }
      if (schema.type !== undefined) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (!types.length || types.some((type) => !TYPES.has(type)) || new Set(types).size !== types.length) throw new Error("schema_type_invalid");
      }
      if (schema.$ref !== undefined) {
        if (typeof schema.$ref !== "string" || !(schema.$ref === "#" || schema.$ref.startsWith("#/"))) throw new Error("schema_ref_external");
        references.push(schema.$ref);
      }
      for (const key of ["properties", "patternProperties", "$defs", "definitions"]) {
        if (schema[key] !== undefined) {
          if (!isObject(schema[key])) throw new Error("schema_map_invalid");
          for (const [name, child] of Object.entries(schema[key])) {
            if (FORBIDDEN_KEYS.has(name)) throw new Error("schema_property_invalid");
            if (key === "patternProperties" && !isSafePattern(name)) throw new Error("schema_pattern_unsafe");
            visit(child, depth + 1);
          }
        }
      }
      if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.length > 128 || schema.required.some((key) => typeof key !== "string" || FORBIDDEN_KEYS.has(key)) || new Set(schema.required).size !== schema.required.length)) throw new Error("schema_required_invalid");
      for (const key of ["additionalProperties", "additionalItems", "propertyNames", "contains", "not"]) {
        if (schema[key] !== undefined && schema[key] !== true && schema[key] !== false) visit(schema[key], depth + 1);
      }
      if (schema.items !== undefined) {
        if (Array.isArray(schema.items)) {
          if (Array.isArray(schema.prefixItems)) throw new Error("schema_items_dialect_mixed");
          if (schema.items.length > 64) throw new Error("schema_items_too_many");
          schema.items.forEach((item) => visit(item, depth + 1));
        } else visit(schema.items, depth + 1);
      }
      if (schema.prefixItems !== undefined) {
        if (!Array.isArray(schema.prefixItems) || schema.prefixItems.length > 64) throw new Error("schema_prefix_items_invalid");
        schema.prefixItems.forEach((item) => visit(item, depth + 1));
      }
      for (const key of ["allOf", "anyOf", "oneOf"]) {
        if (schema[key] === undefined) continue;
        if (!Array.isArray(schema[key]) || schema[key].length > 32 || (key !== "allOf" && schema[key].length === 0)) throw new Error("schema_composition_invalid");
        schema[key].forEach((item) => visit(item, depth + 1));
      }
      if (schema.dependencies !== undefined) {
        if (!isObject(schema.dependencies) || Object.keys(schema.dependencies).length > 32) throw new Error("schema_dependency_invalid");
        for (const [name, dependency] of Object.entries(schema.dependencies)) {
          if (FORBIDDEN_KEYS.has(name)) throw new Error("schema_dependency_invalid");
          if (Array.isArray(dependency)) {
            if (dependency.length > 128 || dependency.some((value) => typeof value !== "string" || FORBIDDEN_KEYS.has(value))) throw new Error("schema_dependency_invalid");
          } else visit(dependency, depth + 1);
        }
      }
      if (schema.dependentRequired !== undefined) {
        if (!isObject(schema.dependentRequired)) throw new Error("schema_dependency_invalid");
        for (const [name, values] of Object.entries(schema.dependentRequired)) {
          if (FORBIDDEN_KEYS.has(name) || !Array.isArray(values) || values.length > 128 || values.some((value) => typeof value !== "string" || FORBIDDEN_KEYS.has(value))) throw new Error("schema_dependency_invalid");
        }
      }
      if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.length > 128)) throw new Error("schema_enum_invalid");
      if (schema.pattern !== undefined && !isSafePattern(schema.pattern)) throw new Error("schema_pattern_unsafe");
      if (schema.format !== undefined && !SAFE_FORMATS.has(schema.format)) throw new Error("schema_format_unsupported");
      for (const key of ["minProperties", "maxProperties", "minItems", "maxItems", "minLength", "maxLength", "minContains", "maxContains"]) {
        if (schema[key] !== undefined && (!Number.isInteger(schema[key]) || schema[key] < 0 || schema[key] > 10_000)) throw new Error("schema_bound_invalid");
      }
      for (const key of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"]) {
        if (schema[key] !== undefined && (typeof schema[key] !== "number" || !Number.isFinite(schema[key]) || (key === "multipleOf" && schema[key] <= 0))) throw new Error("schema_number_bound_invalid");
      }
    };
    visit(root, 0);
    if (references.some((reference) => resolveLocalRef(root, reference) === null)) return null;
    if (root.type !== undefined && root.type !== "object" && !(Array.isArray(root.type) && root.type.includes("object"))) return null;
    root.type = "object";
    return root;
  } catch {
    return null;
  }
}

function resolveLocalRef(root, ref) {
  if (ref === "#") return root;
  if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
  let current = root;
  for (const part of ref.slice(2).split("/")) {
    if (/~(?:[^01]|$)/.test(part)) return null;
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (FORBIDDEN_KEYS.has(key) || !isObject(current) || !Object.prototype.hasOwnProperty.call(current, key)) return null;
    current = current[key];
  }
  return isObject(current) || typeof current === "boolean" ? current : null;
}

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (isObject(value)) return "object";
  return typeof value;
}

function safeFormatMatches(format, value) {
  if (typeof value !== "string") return true;
  if (format === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (format === "date-time") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && !Number.isNaN(Date.parse(value));
  if (format === "time") return /^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value);
  if (format === "email") return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (format === "hostname") return value.length <= 253 && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i.test(value);
  if (format === "ipv4") return value.split(".").length === 4 && value.split(".").every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  if (format === "ipv6") return value.length <= 45 && /^[0-9a-f:]+$/i.test(value) && value.includes(":");
  if (format === "uuid") return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  if (format === "uri") { try { const url = new URL(value); return Boolean(url.protocol); } catch { return false; } }
  return false;
}

function validateMcpArguments(schema, args) {
  if (!isObject(schema) || !isObject(args)) return { ok: false, error: "mcp_arguments_object_required" };
  let serialized;
  try { serialized = JSON.stringify(args); } catch { return { ok: false, error: "mcp_arguments_invalid" }; }
  if (Buffer.byteLength(serialized, "utf8") > MAX_ARGUMENT_BYTES) return { ok: false, error: "mcp_arguments_too_large" };
  let steps = 0;
  const root = schema;
  const fail = (path, keyword) => ({ ok: false, error: `mcp_arguments_schema_mismatch:${String(path || "$.$").slice(0, 160)}:${keyword}` });
  const check = (value, rule, path, depth, refs = new Set()) => {
    if (rule === true) return true;
    if (rule === false || !isObject(rule) || depth > MAX_VALUE_DEPTH || ++steps > MAX_VALIDATION_STEPS) return false;
    if (rule.$ref !== undefined) {
      const target = resolveLocalRef(root, rule.$ref);
      if (!target || !check(value, target, path, depth + 1, new Set(refs))) return false;
    }
    if (rule.type !== undefined) {
      const expected = Array.isArray(rule.type) ? rule.type : [rule.type];
      const actual = valueType(value);
      if (!expected.includes(actual) && !(actual === "integer" && expected.includes("number"))) return false;
    }
    if (rule.const !== undefined && canonicalJson(value) !== canonicalJson(rule.const)) return false;
    if (rule.enum !== undefined && !rule.enum.some((item) => canonicalJson(item) === canonicalJson(value))) return false;
    for (const child of rule.allOf || []) if (!check(value, child, path, depth + 1, refs)) return false;
    if (rule.anyOf && !rule.anyOf.some((child) => check(value, child, path, depth + 1, new Set(refs)))) return false;
    if (rule.oneOf && rule.oneOf.filter((child) => check(value, child, path, depth + 1, new Set(refs))).length !== 1) return false;
    if (rule.not !== undefined && check(value, rule.not, path, depth + 1, new Set(refs))) return false;
    if (typeof value === "string") {
      const length = [...value].length;
      if (rule.minLength !== undefined && length < rule.minLength) return false;
      if (rule.maxLength !== undefined && length > rule.maxLength) return false;
      if (rule.pattern !== undefined && (!isSafePattern(rule.pattern) || !new RegExp(rule.pattern).test(value))) return false;
      if (rule.format !== undefined && !safeFormatMatches(rule.format, value)) return false;
    }
    if (typeof value === "number") {
      if (rule.minimum !== undefined && value < rule.minimum) return false;
      if (rule.maximum !== undefined && value > rule.maximum) return false;
      if (rule.exclusiveMinimum !== undefined && value <= rule.exclusiveMinimum) return false;
      if (rule.exclusiveMaximum !== undefined && value >= rule.exclusiveMaximum) return false;
      if (rule.multipleOf !== undefined && Math.abs(value / rule.multipleOf - Math.round(value / rule.multipleOf)) > 1e-10) return false;
    }
    if (Array.isArray(value)) {
      if (rule.minItems !== undefined && value.length < rule.minItems) return false;
      if (rule.maxItems !== undefined && value.length > rule.maxItems) return false;
      if (rule.uniqueItems && new Set(value.map(canonicalJson)).size !== value.length) return false;
      const prefixLength = Array.isArray(rule.prefixItems) ? rule.prefixItems.length : 0;
      if (rule.prefixItems) {
        for (let index = 0; index < Math.min(value.length, prefixLength); index += 1) if (!check(value[index], rule.prefixItems[index], `${path}[${index}]`, depth + 1, refs)) return false;
      }
      if (rule.items === false && value.length > prefixLength) return false;
      if (rule.items !== undefined && rule.items !== false) {
        for (let index = 0; index < value.length; index += 1) {
          if (Array.isArray(rule.prefixItems) && index < prefixLength) continue;
          const itemRule = Array.isArray(rule.items) ? rule.items[index] : rule.items;
          if (itemRule === undefined) { if (Array.isArray(rule.items) && rule.additionalItems === false && index >= rule.items.length) return false; continue; }
          if (!check(value[index], itemRule, `${path}[${index}]`, depth + 1, refs)) return false;
        }
      }
      if (rule.contains !== undefined) {
        const matches = value.filter((item, index) => check(item, rule.contains, `${path}[${index}]`, depth + 1, new Set(refs))).length;
        if (matches < (rule.minContains ?? 1) || (rule.maxContains !== undefined && matches > rule.maxContains)) return false;
      }
    }
    if (isObject(value)) {
      const keys = Object.keys(value);
      if (rule.minProperties !== undefined && keys.length < rule.minProperties) return false;
      if (rule.maxProperties !== undefined && keys.length > rule.maxProperties) return false;
      if (keys.some((key) => FORBIDDEN_KEYS.has(key))) return false;
      for (const name of rule.required || []) if (!Object.prototype.hasOwnProperty.call(value, name)) return false;
      for (const [name, propertyRule] of Object.entries(rule.properties || {})) {
        if (Object.prototype.hasOwnProperty.call(value, name) && !check(value[name], propertyRule, `${path}.${name}`, depth + 1, refs)) return false;
      }
      for (const [pattern, propertyRule] of Object.entries(rule.patternProperties || {})) {
        const regex = new RegExp(pattern);
        for (const name of keys) if (regex.test(name) && !check(value[name], propertyRule, `${path}.${name}`, depth + 1, refs)) return false;
      }
      for (const name of keys) {
        if (Object.prototype.hasOwnProperty.call(rule.properties || {}, name) || Object.entries(rule.patternProperties || {}).some(([pattern]) => new RegExp(pattern).test(name))) continue;
        if (rule.additionalProperties === false) return false;
        if (isObject(rule.additionalProperties) && !check(value[name], rule.additionalProperties, `${path}.${name}`, depth + 1, refs)) return false;
      }
      if (rule.propertyNames !== undefined) for (const name of keys) if (!check(name, rule.propertyNames, `${path}.[key]`, depth + 1, refs)) return false;
      for (const [name, dependency] of Object.entries(rule.dependentRequired || {})) if (Object.prototype.hasOwnProperty.call(value, name) && dependency.some((required) => !Object.prototype.hasOwnProperty.call(value, required))) return false;
      for (const [name, dependency] of Object.entries(rule.dependencies || {})) {
        if (!Object.prototype.hasOwnProperty.call(value, name)) continue;
        if (Array.isArray(dependency) && dependency.some((required) => !Object.prototype.hasOwnProperty.call(value, required))) return false;
        if ((dependency === false || isObject(dependency)) && !check(value, dependency, path, depth + 1, refs)) return false;
      }
    }
    return true;
  };
  try {
    return check(args, schema, "$", 0) ? { ok: true, args } : fail("$", "schema");
  } catch {
    return { ok: false, error: "mcp_arguments_schema_validation_failed" };
  }
}

module.exports = {
  MAX_ARGUMENT_BYTES,
  MAX_SCHEMA_BYTES,
  canonicalJson,
  sanitizeMcpInputSchema,
  validateMcpArguments,
};
