// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2C-1A: OpenRouter Tool Calling
// Tool Schema
// ------------------------------------------------------------
// Pure validation + normalization of OpenRouter/OpenAI-compatible
// "function" tool schemas. This file owns NO storage, NO registry,
// and NO event bus of its own — tool-manager.js is the only caller
// that holds onto tools across calls; this file is stateless,
// synchronous, and side-effect-free (no logging, no emit, no
// network). Every function here is a pure function of its input.
//
// Consumed tool shape (Part 2C-1A's own author-facing input, per the
// build spec):
//   { name, description, parameters, metadata }
//
// Produced wire shape (what OpenRouter's `tools` request field
// expects — this file's normalizeTool() output, and the only shape
// tool-manager.js's getToolDefinitions() ever returns):
//   {
//     type: "function",
//     function: { name, description, parameters: { type: "object",
//                                                     properties: {},
//                                                     required: [] } }
//   }
// `metadata` is intentionally NOT part of the wire shape — it is an
// AXIOM-local field (kept by tool-manager.js's own registry record,
// never sent to OpenRouter). Callers that need it back use
// getTool()/getTools(), not getToolDefinitions().
//
// Relationship to the existing OpenRouter files (audited before
// writing this file, none modified, none duplicated):
//   - response-parser.js already owns normalizeToolCalls() /
//     normalizeMessage() — parsing tool_calls OUT of a model's
//     response. That is the opposite direction from this file, which
//     validates/normalizes tool DEFINITIONS going INTO a request.
//     No logic is shared or re-implemented between the two; they
//     operate on disjoint data (response tool_calls vs. request
//     tools) and this file does not read or write anything
//     response-parser.js owns.
//   - model-manager.js's getCapabilities(id).tools already reports
//     whether a given model *supports* the OpenRouter `tools` request
//     field at all. This file does not duplicate that capability
//     check (it has no model-awareness whatsoever) — it only
//     validates that a tool definition is well-formed JSON Schema,
//     independent of which model, if any, will receive it. Whether a
//     tool should be sent to a particular model is a future
//     tool-calling Part's concern, not this one's.
//
// Supported JSON Schema parameter types (per the build spec):
//   string, number, integer, boolean, object, array
//   — plus required/optional properties, nested objects, and arrays
//     of any of the above (recursively).
//
// Explicitly out of scope (schema/registration only — see
// tool-manager.js's own header for the matching security posture):
//   - No eval(), no Function(), no dynamic code execution anywhere in
//     this file.
//   - No tool is ever invoked/executed here. Tool arguments a caller
//     might later receive from a model are DATA to this layer, never
//     code — this file doesn't even see them; it only validates the
//     declared *shape* a tool expects such arguments to have.
//
// Public API — window.AxiomOpenRouterToolSchema:
//   validateTool(tool)          -> { valid, errors: string[] }
//   validateParameters(params)  -> { valid, errors: string[] }
//   normalizeTool(tool)         -> wire-shape function object | null
//                                  (null when validateTool(tool) is invalid)
//   isValidToolName(name)       -> boolean
// ============================================================
(function (global) {
  'use strict';

  // OpenAI/OpenRouter function-name convention: letters, digits,
  // underscores, hyphens, 1-64 chars. Matches the constraint every
  // OpenRouter-compatible provider enforces on `function.name`.
  var NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

  var SUPPORTED_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'];

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isValidToolName(name) {
    return typeof name === 'string' && NAME_PATTERN.test(name);
  }

  // ---------- schema node validation (recursive) ----------
  // A "schema node" is any JSON-Schema-shaped fragment: the top-level
  // `parameters` object itself, or any entry inside a `properties`
  // map, or an `items` schema inside an array node. Same recursive
  // shape at every depth, so one function handles all of them.
  function validateSchemaNode(node, errors, path) {
    if (!isPlainObject(node)) {
      errors.push(path + ': malformed schema — expected an object');
      return;
    }

    if (typeof node.type !== 'string' || SUPPORTED_TYPES.indexOf(node.type) === -1) {
      errors.push(path + ': invalid or missing parameter type (expected one of ' + SUPPORTED_TYPES.join(', ') + ')');
      return;
    }

    if (node.type === 'object') {
      validateObjectNode(node, errors, path);
    } else if (node.type === 'array') {
      validateArrayNode(node, errors, path);
    }
    // string/number/integer/boolean are leaf types — nothing further
    // to recurse into. Extra descriptive keys (description, enum,
    // default, etc.) are permitted and intentionally not validated —
    // this file only enforces the shape the build spec calls out.
  }

  function validateObjectNode(node, errors, path) {
    var properties = node.properties;
    if (properties === undefined) {
      // Treated as an object with no declared properties (an empty
      // params object is a legitimate, if trivial, tool signature) —
      // normalizeTool() fills in {} for this case. Only an explicitly
      // *malformed* properties value is rejected below.
      properties = {};
    }
    if (!isPlainObject(properties)) {
      errors.push(path + '.properties: malformed — expected an object');
      return;
    }

    var propNames = Object.keys(properties);
    for (var i = 0; i < propNames.length; i++) {
      var propName = propNames[i];
      validateSchemaNode(properties[propName], errors, path + '.properties.' + propName);
    }

    if (node.required !== undefined) {
      if (!Array.isArray(node.required)) {
        errors.push(path + '.required: malformed required array — expected an array of strings');
      } else {
        for (var r = 0; r < node.required.length; r++) {
          var reqName = node.required[r];
          if (typeof reqName !== 'string') {
            errors.push(path + '.required[' + r + ']: malformed required array — every entry must be a string');
          } else if (propNames.indexOf(reqName) === -1) {
            errors.push(path + '.required[' + r + ']: "' + reqName + '" is not a declared property');
          }
        }
      }
    }
  }

  function validateArrayNode(node, errors, path) {
    if (node.items === undefined) {
      errors.push(path + '.items: missing — array parameters must declare an items schema');
      return;
    }
    validateSchemaNode(node.items, errors, path + '.items');
  }

  function validateParameters(parameters) {
    var errors = [];
    if (parameters === undefined || parameters === null) {
      errors.push('parameters: missing');
      return { valid: false, errors: errors };
    }
    if (!isPlainObject(parameters)) {
      errors.push('parameters: malformed — expected an object');
      return { valid: false, errors: errors };
    }
    // Top-level parameters must describe an object (the arguments bag
    // a tool call passes as a whole) — same convention OpenRouter/
    // OpenAI's own function-calling schema requires.
    if (parameters.type !== undefined && parameters.type !== 'object') {
      errors.push('parameters.type: must be "object" at the top level');
      return { valid: false, errors: errors };
    }
    validateObjectNode(Object.assign({}, parameters, { type: 'object' }), errors, 'parameters');
    return { valid: errors.length === 0, errors: errors };
  }

  // ---------- tool validation ----------

  function validateTool(tool) {
    var errors = [];

    if (!isPlainObject(tool)) {
      errors.push('tool: malformed — expected an object');
      return { valid: false, errors: errors };
    }

    if (tool.name === undefined || tool.name === null || tool.name === '') {
      errors.push('name: missing');
    } else if (!isValidToolName(tool.name)) {
      errors.push('name: invalid — must be 1-64 characters of letters, digits, underscore, or hyphen');
    }

    if (tool.description !== undefined && typeof tool.description !== 'string') {
      errors.push('description: invalid — must be a string');
    }

    var paramsResult = validateParameters(tool.parameters);
    if (!paramsResult.valid) {
      errors = errors.concat(paramsResult.errors);
    }

    if (tool.metadata !== undefined && tool.metadata !== null && !isPlainObject(tool.metadata)) {
      errors.push('metadata: invalid — must be an object');
    }

    return { valid: errors.length === 0, errors: errors };
  }

  // ---------- normalization (fills defaults, never mutates input) ----------

  function normalizeSchemaNode(node) {
    var out = { type: node.type };
    var keys = Object.keys(node);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === 'type' || k === 'properties' || k === 'required' || k === 'items') continue;
      // Pass through descriptive/constraint keys (description, enum,
      // default, etc.) verbatim — this layer only owns the structural
      // keys it validates above.
      out[k] = node[k];
    }

    if (node.type === 'object') {
      var properties = isPlainObject(node.properties) ? node.properties : {};
      var normalizedProps = {};
      Object.keys(properties).forEach(function (propName) {
        normalizedProps[propName] = normalizeSchemaNode(properties[propName]);
      });
      out.properties = normalizedProps;
      out.required = Array.isArray(node.required) ? node.required.slice() : [];
    } else if (node.type === 'array') {
      out.items = normalizeSchemaNode(node.items);
    }

    return out;
  }

  function normalizeTool(tool) {
    var result = validateTool(tool);
    if (!result.valid) return null;

    return {
      type: 'function',
      function: {
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : '',
        parameters: normalizeSchemaNode(Object.assign({}, tool.parameters, { type: 'object' }))
      }
    };
  }

  var ToolSchema = {
    validateTool: validateTool,
    validateParameters: validateParameters,
    normalizeTool: normalizeTool,
    isValidToolName: isValidToolName
  };

  global.AxiomOpenRouterToolSchema = ToolSchema;
})(typeof window !== 'undefined' ? window : globalThis);
