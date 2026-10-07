import assert from "node:assert/strict";
import test from "node:test";
import schemaModule from "../api/_mcp-schema.js";

const { sanitizeMcpInputSchema, validateMcpArguments } = schemaModule;

function validate(schema, value) {
  const sanitized = sanitizeMcpInputSchema(schema);
  assert.ok(sanitized, "schema should be accepted by the supported JSON Schema subset");
  return validateMcpArguments(sanitized, value).ok;
}

test("MCP schema rejects unknown keywords, remote refs, unsafe patterns, and oversized input", () => {
  assert.equal(sanitizeMcpInputSchema({ type: "object", properties: {}, unevaluatedProperties: false }), null);
  assert.equal(sanitizeMcpInputSchema({ type: "object", properties: { x: { $ref: "https://example.com/schema.json" } } }), null);
  assert.equal(sanitizeMcpInputSchema({ type: "object", properties: { x: { $ref: "#not-a-pointer" } } }), null);
  assert.equal(sanitizeMcpInputSchema({ type: "object", properties: { x: { $ref: "#/missing" } } }), null);
  assert.equal(sanitizeMcpInputSchema({ type: "object", properties: { x: { type: "string", pattern: "(a+)+$" } } }), null);
  assert.equal(sanitizeMcpInputSchema({ type: "object", properties: { x: { type: "string", unknownRule: true } } }), null);
  assert.equal(sanitizeMcpInputSchema({ type: "object", properties: { x: { type: "string", pattern: "a".repeat(129) } } }), null);
});

test("MCP validates required fields, types, additional properties, enums, and bounds", () => {
  const schema = {
    type: "object",
    properties: {
      query: { type: "string", minLength: 2, maxLength: 40, pattern: "^[A-Za-z0-9 _-]+$" },
      depth: { enum: ["normal", "deep"] },
      count: { type: "integer", minimum: 1, maximum: 5 },
    },
    required: ["query", "depth"],
    additionalProperties: false,
  };
  assert.equal(validate(schema, { query: "find docs", depth: "normal", count: 3 }), true);
  assert.equal(validate(schema, { query: "x", depth: "normal" }), false);
  assert.equal(validate(schema, { query: "valid", depth: "wide" }), false);
  assert.equal(validate(schema, { query: "valid", depth: "deep", extra: true }), false);
  assert.equal(validate(schema, { query: "valid", depth: "deep", count: 6 }), false);
  assert.equal(validate(schema, { query: "bad!", depth: "deep" }), false);
});

test("MCP validates nested arrays, prefixItems plus items, uniqueness, and compositions", () => {
  const schema = {
    type: "object",
    properties: {
      tuple: { type: "array", prefixItems: [{ type: "string" }, { type: "integer" }], items: { type: "number" }, minItems: 2 },
      choice: { oneOf: [{ type: "string", const: "read" }, { type: "integer", minimum: 1 }] },
      ids: { type: "array", items: { type: "integer" }, uniqueItems: true },
    },
    required: ["tuple", "choice", "ids"],
    additionalProperties: false,
  };
  assert.equal(validate(schema, { tuple: ["id", 2, 3.5], choice: "read", ids: [1, 2] }), true);
  assert.equal(validate(schema, { tuple: ["id", "wrong"], choice: "read", ids: [1] }), false);
  assert.equal(validate(schema, { tuple: ["id", 2], choice: "read", ids: [1, 1] }), false);
  assert.equal(validate(schema, { tuple: ["id", 2], choice: true, ids: [1] }), false);
});

test("MCP supports bounded local recursive refs and boolean schemas", () => {
  const booleanRef = sanitizeMcpInputSchema({ type: "object", properties: { denied: { $ref: "#/$defs/deny" } }, $defs: { deny: false } });
  assert.ok(booleanRef);
  assert.equal(validateMcpArguments(booleanRef, { denied: true }).ok, false);
  const schema = sanitizeMcpInputSchema({
    type: "object",
    properties: { tree: { $ref: "#/$defs/node" }, always: true },
    required: ["tree"],
    additionalProperties: false,
    $defs: {
      node: {
        type: "object",
        properties: { value: { type: "string" }, child: { $ref: "#/$defs/node" } },
        required: ["value"],
        additionalProperties: false,
      },
    },
  });
  assert.ok(schema);
  assert.equal(validateMcpArguments(schema, { tree: { value: "root", child: { value: "leaf" } }, always: "anything" }).ok, true);
  assert.equal(validateMcpArguments(schema, { tree: { value: 7 } }).ok, false);
  assert.equal(validateMcpArguments(sanitizeMcpInputSchema({ type: "object", properties: { no: false } }), { no: true }).ok, false);
});

test("MCP rejects malformed compositions and enforces boolean subschemas", () => {
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    assert.equal(sanitizeMcpInputSchema({ type: "object", [keyword]: { type: "object" } }), null);
  }
  assert.equal(sanitizeMcpInputSchema({ type: "object", prefixItems: [{ type: "string" }], items: [{ type: "number" }] }), null);
  assert.equal(validate({ type: "object", properties: { values: { type: "array", contains: false } }, required: ["values"] }, { values: [1] }), false);
  assert.equal(validate({ type: "object", propertyNames: false }, { field: "value" }), false);
  assert.equal(validate({ type: "object", dependencies: { active: false } }, { active: true }), false);
  assert.equal(validate({ type: "object", properties: { value: { not: true } } }, { value: "any" }), false);
});

test("MCP rejects prototype-polluting keys and oversized arguments", () => {
  const schema = sanitizeMcpInputSchema({ type: "object", additionalProperties: true });
  assert.ok(schema);
  assert.equal(validateMcpArguments(schema, JSON.parse('{"__proto__":{"polluted":true}}')).ok, false);
  assert.equal(validateMcpArguments(schema, { huge: "x".repeat(12_001) }).ok, false);
});
