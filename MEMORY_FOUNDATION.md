# AXIOM Memory Foundation
### Block 2 / Step 3 / Part 1
Role: Senior AI Memory Systems Engineer
Scope: Memory system only — no UI redesign, no new AI capabilities, no unrelated pages touched.

---

## 1. Audit — what was actually there

The Memory page (`memory.html` + `js/pages/memory-ultimate.js`) looked fully
featured — timeline, crystals view, knowledge graph, tags, filters, pinning,
importance/confidence meters, import/export — but underneath, the entire
thing was cosmetic:

| Area | Finding |
|---|---|
| Memory architecture | None. A single hardcoded `MEMORY_ITEMS` array of 15 fake memories, deep-cloned into page state on load. |
| Storage layer | None. Nothing was written to disk anywhere. A hard refresh silently discarded every pin, edit, or added memory. |
| Conversation history | None on this page. No message log, no per-conversation store. |
| Session memory | None. "Working Memory" was a static, unchanging array of 3 hardcoded strings. |
| Temporary / short-term memory | Cosmetic only. The "Short-Term Cache" metric was `Math.random()`-jittered every 3 seconds — it measured nothing. |
| Long-term memory | None. "Long-term Memory archive" was a label over the same static array. |
| Memory indexing | None. Every filter/search/tag operation did a linear `.filter()` scan of the 15-item array each time. |
| Memory retrieval | Array `.find()` by id against in-memory mock data only. |
| Placeholders / mock data | The "Save Memory" button in the Add Memory modal (`memory.html`) had **no click handler at all** — clicking it did nothing. The Export button serialized whatever happened to be in the mock array. `AxiomMemory.getState()` exposed the same throwaway object. |

Elsewhere in the codebase, `db/schema.sql` already has a real `agent_memory`
Postgres table (with RLS, tags, pinning, categories) — but it is scoped to
per-agent notes and nothing on `memory.html` reads or writes it. That table
is a separate, valid future integration point and is untouched by this pass.

## 2. What was built

A new module, **`os/core/memory-engine.js`**, exposing `window.AxiomMemoryEngine`.
It follows the same architectural convention already established by
`conversation-bridge.js` and `axiom-brain.js` in this codebase: a
narrow, well-documented public API; internal state; a pub/sub layer for
consumers; localStorage as the persistence backend, namespaced and
schema-versioned so the backend can be swapped later (e.g. for IndexedDB or
a Supabase-backed remote store) without callers changing.

### Storage layer
A single `StorageAdapter` (read/write/remove) is the only thing that ever
touches `localStorage`. Every other piece of the engine goes through it —
so a future migration to IndexedDB or a remote store only requires
rewriting `StorageAdapter`, not the engine's logic or any consumer.

Keys are namespaced under `axiom:memory:v1:` and split by concern
(`sessions`, `conversations`, `messages:<conversationId>`, `memories`,
`working`, `meta`) so a large conversation's message history never has to
be read or rewritten just to touch an unrelated memory record.

### Session memory
- `getOrCreateSession()` resumes the most recent session if it went idle
  less than 30 minutes ago (`SESSION_TTL_MS`), otherwise starts a fresh one
  and resets working memory.
- `touchSession()` is a heartbeat, called every 60s and on every write.
- Sessions are retained for 30 days after they end (`SESSION_RETENTION_MS`)
  as an audit trail, then purged by cleanup.

### Conversation history
- `startConversation()` / `endConversation()` / `addMessage()` /
  `getConversationHistory()` / `listConversations()`.
- Messages are stored per-conversation, in order, with `id`, `role`,
  `content`, `ts`, `agent`, and a free-form `meta` bag.
- Lifecycle cap: `MAX_MESSAGES_PER_CONVERSATION = 500` — history beyond
  that is trimmed from the oldest end automatically (`trimConversationHistory`),
  so a runaway conversation can't grow storage unbounded.

### Message indexing
Non-semantic secondary indices — `Map<key, Set<id>>` for tag, agent,
project, and type — are maintained incrementally on every add/update/delete
and rebuilt once on load. `queryMemories(filter)` intersects these indices
before falling back to a linear scan only for free-text search, so filtering
by an indexed field is a Set lookup, not a scan of every memory. **No
embeddings, no vector store, no semantic similarity** — this is explicitly
out of scope for this pass, per the spec.

### Metadata storage
Every memory record carries `importance`, `confidence`, `tags`, `agent`,
`project`, `type`, `pinned`, plus lifecycle metadata: `createdAt`,
`updatedAt`, `lastAccessedAt`, `accessCount`, and an optional `ttl` for
memories that are meant to be ephemeral rather than permanent.

### Memory lifecycle
`addMemory` → `touchMemory` (records an access) → `updateMemory` (patches
fields, bumps `updatedAt`) → `deleteMemory` (removes from the store **and**
every index it was in). Pinning is a normal `updateMemory` call, not a
side-channel mutation.

### Memory cleanup
`cleanup()` — run automatically every 5 minutes and once at startup, and
callable on demand:
1. Closes out sessions idle past their TTL that were never explicitly ended.
2. Purges sessions past the 30-day retention window.
3. Expires ephemeral (`ttl`-bearing) memories whose TTL has elapsed.
4. Re-applies the per-conversation message cap.

It is a documented no-op when nothing has aged out, and safe to call
repeatedly (verified in the regression suite).

### Memory state management
A small pub/sub (`onChange(fn)` / returns an unsubscribe function) emits on
every mutation (`session:started`, `conversation:started`, `message:added`,
`memory:added` / `updated` / `accessed` / `deleted`, `working:updated`,
`cleanup:ran`, `imported`, `engine:initialized`) so any page can react to
writes without polling or re-reading localStorage itself.

## 3. Integration — memory.html / memory-ultimate.js

- `memory.html` now loads `os/core/memory-engine.js` before
  `memory-world.js` / `memory-ultimate.js`.
- `memory-ultimate.js` no longer treats its 15-item array as the source of
  truth. That array is now `SEED_MEMORY_ITEMS` — written through
  `engine.addMemory()` exactly once, only if the engine reports zero stored
  memories (a brand-new browser), so real data is never overwritten on
  reload.
- Reading: `state.memories` is populated from `engine.queryMemories({})` on
  init and refreshed on every `memory:*` change event.
- Writing: pinning (both the table's pin buttons and the detail overlay's
  Pin/Unpin button) now calls `engine.updateMemory(id, { pinned })` instead
  of mutating a local object that a refresh would discard.
- **The Add Memory modal's Save button, which previously had no click
  handler at all, is now wired** — it reads the textarea/agent select,
  calls `engine.addMemory()`, and closes the modal. This was the clearest
  placeholder found in the audit and is now a real write path.
- Export now calls `engine.exportAll()` — a full-fidelity backup of
  sessions, conversations, messages, and memories — rather than serializing
  only the rows currently visible in the table.
- Opening the memory detail overlay now calls `engine.touchMemory(id)`,
  recording a real access instead of nothing.
- The "Short-Term Cache" metric is now `engine.getStats().shortTermCacheLoad`
  (working-memory item count over a soft capacity) instead of a random
  walk that measured nothing.
- No markup, layout, or visual styling was changed. The table/timeline/
  crystals/graph renderers, filters, and search UI are untouched — they
  still read the same shaped objects (`id`, `text`, `agent`, `date`, `ts`,
  `type`, `pinned`, `importance`, `confidence`, `project`, `tags`), just
  sourced from the engine instead of a static array.

## 4. Validation

Ran `test-evidence/block2-step3-part1-memory-foundation-regression-suite.js`
against the real, unmodified `os/core/memory-engine.js` (35 checks, all
passing — output in the matching `-output.txt`):

- Memory initializes correctly: `init()` is idempotent (a second call does
  not create a second session); a session exists immediately after.
- Conversations are stored: messages persist in order, `messageCount`
  tracks the real history length, and the 500-message cap keeps the most
  recent messages, not the oldest.
- Sessions persist correctly: a **second, independent engine instance**
  reading the same `localStorage` sees the same memories the first instance
  wrote — proving persistence goes through the storage layer, not an
  in-process array.
- No placeholder memory remains: memory CRUD, indexing (tag/agent/project/
  pinned, including the case where a filter value doesn't exist in the
  index — which correctly returns empty rather than falling through to
  "everything"), lifecycle timestamps/access tracking, TTL-based expiry,
  pub/sub notifications (and that unsubscribing actually stops them), and
  export/import round-tripping are all exercised against the real file.
- No console errors: the suite loads and executes the real file end to end
  under Node's `vm` sandbox without throwing.

Manual check: `memory.html` was inspected end-to-end for any remaining
static/mock data paths after the integration changes above — none found
beyond the one-time seed, which is documented and guarded against
overwriting real data.

## 5. Explicitly not done (by design, per spec)

- No semantic search / embeddings.
- No vector database.
- No UI redesign — same markup, same visuals, same page.
- No new AI capabilities.
- No changes to any page other than `memory.html`, its script, and its
  modal markup.
- The existing Postgres `agent_memory` table was not touched or wired in —
  this pass is a client-side foundation; a server-synced tier is a
  reasonable next step but out of scope here.
