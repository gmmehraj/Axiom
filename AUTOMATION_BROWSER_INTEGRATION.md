# Automation ↔ Browser Integration — Block 2 · Step 5 · Part 4

**Role:** Senior Automation Platform Architect  
**Scope:** Integrate the Browser Engine (`os/core/browser-engine.js`) with the Automation Engine (`os/core/automation-engine.js`, `os/core/automation-manager.js`) via a single public entry point: **`BrowserManager`** (`os/core/browser-manager.js`).

---

## 1. Executive Summary & Architecture Overview

Before Part 4, browser capabilities were scattered across `AxiomBrowserEngine`, `AxiomBrowserLive` (renderer), and `AxiomBrowserBridge`. Automation Engine steps executed with simulated network delays but lacked a unified interface for initiating real browser operations or listening to browser events.

Part 4 establishes **`BrowserManager`** (`window.AxiomBrowserManager` & `window.BrowserManager`) as the **single public entry point** for browser operations. Automation Engine steps, AI Agents (`agent.browser`), and external bridges route exclusively through `BrowserManager` APIs.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Automation Engine / AI Agents                      │
│                  (automation-engine.js, browser-agent.js)                   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼ (Public Entry Point)
┌─────────────────────────────────────────────────────────────────────────────┐
│                             BrowserManager                                  │
│                      (os/core/browser-manager.js)                           │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────────┐  │
│  │  Navigation API  │  │   Session API    │  │        History API        │  │
│  └──────────────────┘  └──────────────────┘  └───────────────────────────┘  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────────┐  │
│  │   Browser Events │  │     Tab API      │  │        Metrics API        │  │
│  └──────────────────┘  └──────────────────┘  └───────────────────────────┘  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼ (Engine Internals)
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Axiom Browser Engine                               │
│                      (os/core/browser-engine.js)                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. API Specifications

### A. Navigation API (`BrowserManager.navigation`)
Exposes stable navigation operations with URL validation, protocol allowlisting, and state tracking:
- `navigate(url, opts)`: Validates URL protocol (`http:`, `https:`, `about:blank`), resolves relative URLs, and initiates navigation.
- `back(sessionId, tabId)`: Navigates back in history stack.
- `forward(sessionId, tabId)`: Navigates forward in history stack.
- `refresh(sessionId, tabId)`: Reloads active page.
- `stop(sessionId, tabId)`: Cancels in-flight loading.
- `redirect(url, sessionId, tabId)`: Handles server/client redirection.
- `getCurrentUrl(sessionId, tabId)`: Returns current tab URL.
- `getNavigationStatus(sessionId, tabId)`: Returns full status object:
  ```json
  {
    "sessionId": "default",
    "tabId": "tab_123",
    "navigating": false,
    "phase": "completed",
    "url": "https://axiom.ai/docs",
    "title": "AXIOM Documentation",
    "status": "loaded",
    "canGoBack": true,
    "canGoForward": false,
    "error": null
  }
  ```

### B. Session API (`BrowserManager.sessions`)
Encapsulates browser session lifecycle:
- `createSession(opts)`: Instantiates new session with metadata.
- `closeSession(sessionId)`: Teardowns session and associated tab set.
- `restoreSession(snapshot)`: Restores tabs and state from serialized snapshot.
- `switchSession(sessionId)`: Sets active window/workspace session.
- `getActiveSession()`: Returns active session details.
- `getSessionMetadata(sessionId)`: Returns session metadata.

### C. History API (`BrowserManager.history`)
Provides read-only access to visit history and aggregate analytics:
- `readHistory(opts)`: Query visits with limit and keyword search (`opts.query`).
- `clearHistory()`: Purges visit history.
- `getRecentPages(limit)`: Gets recent page list.
- `getNavigationTimeline(opts)`: Chronological timeline array of page loads.
- `getHistoryMetadata()`: Summary stats (`totalVisits`, `uniqueDomains`).

### D. Browser Events API (`BrowserManager.events` / `BrowserManager.on`)
Event-driven pub/sub bus emitting normalized events for Automation:
- `navigation:started`: Emitted when navigation begins.
- `navigation:completed`: Emitted on successful page load.
- `navigation:failed`: Emitted on navigation failure or protocol block.
- `page:loaded`: Emitted when page DOM content is ready.
- `session:changed`: Emitted on session creation, switch, or close.
- `tab:changed`: Emitted on tab creation, switch, reorder, or close.
- `browser:error`: Emitted on runtime errors.
- `loading:progress`: Emitted on granular phase changes (`started` → `connecting` → `loading` → `content-ready` → `completed`).

### E. Metrics API (`BrowserManager.getMetrics()`)
Exposes browser runtime performance counters for status dashboards & future Analytics:
```json
{
  "totalNavigations": 12,
  "successfulNavigations": 11,
  "failedNavigations": 1,
  "sessionsCreated": 1,
  "sessionsClosed": 0,
  "historyReads": 4,
  "activeTabs": 2,
  "lastNavigationTime": 1722500000000
}
```

---

## 3. Automation Workflow Integration Flow

1. **Step Execution (`os/core/automation-engine.js`)**:
   - `runStep()` detects browser-related step types (`'Browser Automation'`, `'Navigate'`, `'Browser Search'`, `'Page Fetch'`).
   - Dispatches step directly to `window.AxiomBrowserManager.executeBrowserOp(op, params)`.
   - Result envelope, navigation status, and timestamp are captured in the run log.

2. **Manager & Bridge Layer (`os/core/automation-manager.js`, `os/runtime/capabilities/browser-bridge.js`)**:
   - `AxiomAutomationManager.browser` exposes direct accessors to `BrowserManager`.
   - `AxiomBrowserBridge.command()` routes same-window calls directly through `BrowserManager` while maintaining fallback to `AxiomBrowserLive` and cross-frame `postMessage`.

3. **Agent Integration (`os/runtime/agent-definitions/browser-agent.js`)**:
   - `agent.browser` handler routes browser tasks through `BrowserManager` and `BrowserBridge`.

---

## 4. Files Modified / Created

| File | Action | Purpose |
|---|---|---|
| `os/core/browser-manager.js` | **NEW** | Central public interface (`BrowserManager`) for Browser operations & events. |
| `os/core/automation-engine.js` | **MODIFY** | Integrates `BrowserManager.executeBrowserOp()` into step execution. |
| `os/core/automation-manager.js` | **MODIFY** | Adds `browser` accessor on `AxiomAutomationManager`. |
| `os/runtime/capabilities/browser-bridge.js` | **MODIFY** | Routes bridge commands through `BrowserManager`. |
| `os/runtime/agent-definitions/browser-agent.js` | **MODIFY** | Aligns `agent.browser` to `BrowserManager` / `BrowserBridge`. |
| `automation.html` | **MODIFY** | Includes `os/core/browser-manager.js` script tag. |
| `browser.html` | **MODIFY** | Includes `os/core/browser-manager.js` script tag. |
| `AUTOMATION_BROWSER_INTEGRATION.md` | **NEW** | Architectural documentation of Part 4. |
| `CHANGELOG.md` | **MODIFY** | Documents Part 4 release details. |

---

## 5. Remaining Work Before Part 5

1. **Browser Public APIs & Agent Tool Schemas (Part 5)**: Define JSON schemas for OpenRouter / autonomous agent tool calling (`browser_navigate`, `browser_click`, `browser_extract`).
2. **Security Sandboxing (Part 5)**: Implement formal token authentication for cross-origin background execution.
3. **Multi-Agent Browser Handoffs (Part 5)**: Enable parallel agent browser queries via `AxiomSkillRegistry`.
