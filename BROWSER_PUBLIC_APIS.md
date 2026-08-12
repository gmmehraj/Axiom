# Public Browser APIs Reference — Block 2 · Step 5 · Part 5

**Role:** Senior AI Platform & Browser Systems Architect  
**Scope:** Complete technical reference for public Browser APIs exposed by `BrowserManager` (`os/core/browser-manager.js`) and secured by `BrowserSandbox` (`os/core/browser-sandbox.js`).

---

## 1. Overview & Versioning

- **Module Name:** `window.AxiomBrowserManager` (also available as `window.BrowserManager`)
- **API Version:** `1.0.0`
- **Security & Permissions Layer:** `window.AxiomBrowserSandbox` (`os/core/browser-sandbox.js`)
- **Tool Registry Layer:** `window.AxiomBrowserToolRegistry` (`os/runtime/capabilities/browser-tool-registry.js`)

`BrowserManager` is the single public gateway for all browser operations. Direct state manipulation outside `BrowserManager` is forbidden.

```
Execution Pipeline:
BrowserToolRegistry -> BrowserSandbox -> Permission Check -> BrowserManager -> Browser Engine
```

---

## 2. Navigation API (`BrowserManager.navigation` / `BrowserManager.navigate`)

Exposes stable navigation methods with automated protocol allowlisting (`http:`, `https:`, `about:blank`, `axiom:`), sanitization, and permission checks.

### `navigate(url, options)`
- **Parameters:**
  - `url` (`string`): Target URL or search query.
  - `options` (`object`, optional): `{ sessionId?: string, tabId?: string }`
- **Returns:** `{ ok: boolean, url: string|null, reason: string|null }`

### `back(sessionId?, tabId?)`
- **Returns:** `boolean`

### `forward(sessionId?, tabId?)`
- **Returns:** `boolean`

### `refresh(sessionId?, tabId?)`
- **Returns:** `boolean`

### `stop(sessionId?, tabId?)`
- **Returns:** `boolean`

### `redirect(url, sessionId?, tabId?)`
- **Returns:** `boolean`

### `getCurrentUrl(sessionId?, tabId?)`
- **Returns:** `string|null`

### `getNavigationStatus(sessionId?, tabId?)`
- **Returns:**
  ```json
  {
    "sessionId": "default",
    "tabId": "tab_101",
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

---

## 3. Session API (`BrowserManager.sessions`)

### `createSession(options?)`
- **Parameters:** `{ label?: string, metadata?: object }`
- **Returns:** Session object with ID, tab map, and metadata.

### `closeSession(sessionId)`
- **Returns:** `boolean`

### `restoreSession(snapshot)`
- **Returns:** Restored session object.

### `switchSession(sessionId)`
- **Returns:** `boolean`

### `getActiveSession()`
- **Returns:** Active session details.

### `getSessionMetadata(sessionId?)`
- **Returns:** Metadata object.

---

## 4. History API (`BrowserManager.history`)

### `readHistory(options?)`
- **Parameters:** `{ limit?: number, query?: string }`
- **Returns:** `{ history: Array<{ url, title, time }>, total: number }`

### `clearHistory()`
- **Returns:** `boolean`

### `getRecentPages(limit?)`
- **Returns:** Array of recent page visit objects.

### `getNavigationTimeline(options?)`
- **Returns:** Chronological array of visit records.

### `getHistoryMetadata()`
- **Returns:** `{ totalVisits: number, uniqueDomains: number }`

---

## 5. Tab API (`BrowserManager.tabs`)

### `create(sessionId?, url?)`
### `close(sessionId?, tabId)`
### `switch(sessionId?, tabId)`
### `getActive(sessionId?)`
### `list(sessionId?)`
### `duplicate(sessionId?, tabId?)`
### `reorder(sessionId?, tabId, index)`

---

## 6. Browser Events API (`BrowserManager.events` / `BrowserManager.on`)

Standardized event emitter emitting consistent browser events across Brain, Automation, and Agents:
- `navigation:started`
- `navigation:completed`
- `navigation:failed`
- `page:loaded`
- `session:changed`
- `tab:changed`
- `browser:error`
- `loading:progress`

```js
// Example Event Subscription
BrowserManager.on('navigation:completed', function(detail) {
  console.log('Navigated to:', detail.url);
});
```

---

## 7. Metrics API (`BrowserManager.getMetrics()`)

Exposes real-time runtime counters:
```json
{
  "totalNavigations": 18,
  "successfulNavigations": 17,
  "failedNavigations": 1,
  "sessionsCreated": 2,
  "sessionsClosed": 0,
  "historyReads": 6,
  "activeTabs": 2,
  "lastNavigationTime": 1722500000000
}
```

---

## 8. Security & Sandbox Guardrails (`BrowserSandbox`)

Enforced on all tool invocations and navigation requests:
- **Allowed Protocols:** `http:`, `https:`, `about:blank`, `axiom:`
- **Blocked Schemes:** `javascript:`, `data:`, `file:`, `vbscript:`, `blob:`
- **Permission Check:** `BrowserSandbox.checkPermission(action, context)` supports granular permission rules (`allow`, `prompt`, `deny`).
