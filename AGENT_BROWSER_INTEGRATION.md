# Agent Browser Integration & Tool Registry — Block 2 · Step 5 · Part 5

**Role:** Senior AI Platform & Browser Systems Architect  
**Scope:** Architectural guide for AI Agent browser tool-calling, centralized Browser Tool Registry, security pipeline, and OpenRouter integration extension points.

---

## 1. Execution Pipeline & Architecture

Every browser action executed by an AI agent or automated script passes through a single, strictly-ordered security pipeline:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          AI Agent / OpenRouter / AI OS                      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (1. Invokes Tool)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BrowserToolRegistry                               │
│                (os/runtime/capabilities/browser-tool-registry.js)           │
│                                                                             │
│  Discovery: getTools(), listTools(), getSchema(name), hasTool(name)         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (2. Validates Input & Scheme)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             BrowserSandbox                                  │
│                      (os/core/browser-sandbox.js)                           │
│                                                                             │
│  Protocol Allowlist | Scheme Blocking | Origin Verification                  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (3. Verifies Action Permission)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Permission Check Layer                            │
│                  (BrowserSandbox.checkPermission(action))                    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (4. Routes Approved Command)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             BrowserManager                                  │
│                      (os/core/browser-manager.js)                           │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (5. Modifies Engine State)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Axiom Browser Engine                              │
│                      (os/core/browser-engine.js)                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Browser Tool Registry Capabilities & Schemas

`window.AxiomBrowserToolRegistry` provides formal discovery methods and OpenAI/OpenRouter compatible JSON schemas:

### Discovery Methods
- `getTools()`: Returns dictionary of all registered tool definitions.
- `listTools()`: Returns array of tool specs.
- `getSchema(toolName)`: Returns OpenAI function-calling schema object for `toolName`.
- `hasTool(toolName)`: Returns boolean check.

### Registered Tools List

| Tool Name | Action | OpenRouter Tool Calling Ready |
|---|---|---|
| `browser_navigate` | Navigates active tab to target URL | Yes |
| `browser_go_back` | Navigates backward in history | Yes |
| `browser_go_forward` | Navigates forward in history | Yes |
| `browser_refresh` | Reloads current page | Yes |
| `browser_search` | Executes web search query | Yes |
| `browser_open_tab` | Opens new tab | Yes |
| `browser_close_tab` | Closes specified tab | Yes |
| `browser_switch_tab` | Switches active tab | Yes |
| `browser_read_history` | Reads visit history log | Yes |
| `browser_manage_sessions` | Manages browser sessions | Yes |
| `browser_extract_content` | Reads URL, status, or page snapshot | Yes |

---

## 3. Security Model & Guardrails

1. **Protocol Allowlist:** `http:`, `https:`, `about:blank`, `axiom:`
2. **Blocked URI Schemes:** `javascript:`, `data:`, `file:`, `vbscript:`, `blob:`
3. **Permission Check:** Evaluates `hasPermission(action, scope)`. Actions like `history:clear` or `session:close` require explicit granted level.
4. **Sanitizing Flow:** Any malformed or prohibited URL is rejected at `BrowserSandbox` before hitting `BrowserManager`.

---

## 4. Extension Points for Future OpenRouter Integration

The architecture is prepared for future autonomous AI browsing and OpenRouter integration without breaking changes:

1. **Tool Export for LLM Messages:**
   ```js
   // Export all tools directly to OpenRouter API payload
   const toolsForOpenRouter = AxiomBrowserToolRegistry.listTools().map(t => ({
     type: "function",
     function: t
   }));
   ```

2. **Autonomous Tool Dispatching:**
   ```js
   // Execute tool call returned from LLM completion
   const toolCall = response.choices[0].message.tool_calls[0];
   AxiomBrowserToolRegistry.executeTool(toolCall.function.name, JSON.parse(toolCall.function.arguments));
   ```

3. **Multi-Agent Collaboration:**
   Agents can query tool schemas via `getSchema()` and execute browser operations safely through the `BrowserToolRegistry -> BrowserSandbox -> Permission Check -> BrowserManager` chain.
