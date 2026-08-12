# AXIOM AI OS — Milestone 12 Deliverables
Knowledge & Memory Intelligence

Milestones 4, 8, 9, 10 and 11 are preserved exactly as delivered. This
milestone adds one new layer on top of all of them — a read-only Knowledge
Graph over the existing memory store, a semantic search upgrade, automatic
tagging/categorization, duplicate detection, memory summaries, a real
importance signal, and a non-destructive Executive AI upgrade — and changes
nothing else in the runtime, UI, or visual layer.

---

## 1. Architecture Summary

Milestone 8 gave AXIOM a memory that could be tagged, pinned, categorized
and keyword-recalled (Milestones 1/5/6), plus a composite ranker that
blended relevance/recency/importance — but treated importance as a neutral
placeholder (`0.5`) because nothing upstream computed a real value, and had
no notion of how memories relate to one another beyond a shared scope.
Milestone 9's Executive AI already calls that ranker automatically on every
request (`loadMemory()` → `AxiomMemoryIntelligence.rankedRecall()`), but had
no way to pull in a memory that was *relevant by association* rather than by
keyword match.

Milestone 12 fills exactly that gap, as a layer that sits **beside** Memory
Intelligence and **above** the same `agent_memory` data every earlier
milestone already reads and writes — it introduces no second memory store,
no second ranking algorithm, and no edit to `executive-ai.js` or
`memory-intelligence.js` themselves:

```
 agent_memory rows (Milestones 1/5/6 — UNCHANGED table, UNCHANGED writes)
    │
    ▼
 AxiomAgents.getMemoryNotes / searchMemories / listAll   <- UNCHANGED, M1-9
    │
    ├──> AxiomKnowledgeGraph.build()        (NEW) nodes: memory/tag/category/agent
    │       edges: has-tag, in-category, belongs-to, related-to (shared tag/
    │       category or token-overlap above a threshold)
    │
    ├──> AxiomSemanticSearch.search()        (NEW) TF-IDF cosine re-scoring
    │       of the SAME candidate pool searchMemories() already returns
    │
    ├──> AxiomAutoTagger.classify()/.autoTag() (NEW) suggests via the
    │       EXISTING memory-intelligence.js suggestTags(), classifies a
    │       category, and applies through the EXISTING tagMemory()/
    │       setCategory() writes — blanks only, never overwrites
    │
    ├──> AxiomDuplicateDetector.findDuplicates() (NEW) token-overlap
    │       grouping; .merge() consolidates through the EXISTING
    │       updateMemory()/deleteMemory() writes — report-only by default
    │
    ├──> AxiomImportanceRanker.score()        (NEW) real importance signal
    │       (pinned + tags + category + recency + graph centrality +
    │       duplicate penalty) fed INTO the UNCHANGED M8 rank() — one
    │       ranking system, real inputs
    │
    └──> AxiomMemorySummarizer.summarize()   (NEW) extractive digest built
            from the above — no second data source

 window.AxiomMemoryIntelligence.rankedRecall()  <- WRAPPED, not edited
    (executive-knowledge-extension.js swaps in a graph-expanding version;
     AxiomExecutiveAI's own handle()/loadMemory() call site is untouched
     and automatically benefits)
```

Nothing in this list writes a new column, introduces a second memory table,
or duplicates the M8 ranking/tagging/recall algorithms — every module here
either reads through an existing public function or feeds a genuinely new
signal into one that already existed.

---

## 2. New Modules Added

All under `os/runtime/knowledge/` (new folder, no existing folder touched):

| File | Role |
|---|---|
| `knowledge-graph.js` (`window.AxiomKnowledgeGraph`) | Objectives 1 and 4. Builds a read-only graph from the existing `agent_memory` rows: memory/tag/category/agent nodes and `has-tag`/`in-category`/`belongs-to`/`related-to` edges. `related-to` edges are computed from shared tags/category plus Jaccard token overlap above a threshold — never a full second index. Scopes to scan come from the two existing agent registries (`AxiomAgents.listAll()`, `AxiomAgentManager.list()`), not an invented list. `.build()`, `.neighbors()`, `.relatedMemories()`, `.centrality()`, `.stats()`. Degrades to an empty graph (not a throw) with no memory backend on the page. |
| `semantic-search.js` (`window.AxiomSemanticSearch`) | Objective 2. Re-scores the SAME candidate pool `AxiomAgents.searchMemories()` already returns with TF-IDF cosine similarity over note+tags+category text, instead of the flat keyword-overlap count Milestone 6's `semanticRecall()` uses — a genuine step toward semantic relevance while staying honest about having no embeddings backend. `.search(scope, query, limit)`, `.searchAll(query, limit)` (cross-scope). |
| `auto-tagger.js` (`window.AxiomAutoTagger`) | Objective 3. `.classify(note)` reuses Milestone 8's `suggestTags()` verbatim for tags (no second tagging algorithm) and adds a small keyword-based category classifier — the one genuinely new piece. `.autoTag(scope, row)` applies the result through the EXISTING `tagMemory()`/`setCategory()` writes, but **only fills blanks** — a note that already has tags or a category is never overwritten, protecting data set by a person or an earlier milestone's UI. `.autoTagScope()` batch-applies across one scope's untagged notes. |
| `duplicate-detector.js` (`window.AxiomDuplicateDetector`) | Objective 5. Jaccard token-overlap similarity, grouped via union-find so a chain of near-duplicates is reported as one group. `.findDuplicates()`/`.findDuplicatesAll()` are report-only — nothing is deleted automatically, since silently discarding a saved note would be an unsafe, irreversible surprise. `.merge(keepId, discardIds)` is provided for an explicit caller (Memory workspace action, or a deliberate Executive AI decision) to consolidate a group, through the existing `updateMemory()`/`deleteMemory()` writes only. |
| `importance-ranker.js` (`window.AxiomImportanceRanker`) | Objective 7. Computes a genuine 0–1 importance score per note from signals every earlier milestone already stores (pinned, tag richness, category presence, recency) plus two Milestone 12 signals (knowledge-graph centrality, duplicate-group membership) — then hands the SAME notes, with `.importance` now populated, to the **unmodified** `AxiomMemoryIntelligence.rank()`. This is the missing input Milestone 8's ranker always had a slot for, not a second ranking system. `.score(note, ctx)`, `.rankScope(scope, opts)`. |
| `memory-summarizer.js` (`window.AxiomMemorySummarizer`) | Objective 6. An honest, dependency-free extractive summarizer — no external LLM call is assumed to exist for this milestone. Composes a short digest from note count, date range, top tags/categories, pinned count, and the most important notes (via `AxiomImportanceRanker`). `.summarize(scope, opts)`, `.summarizeAll(opts)`. |
| `executive-knowledge-extension.js` | Objective 8. The SAME non-destructive technique Milestone 11's `autonomous-executive.js` already used on `window.AxiomExecutiveAI` (`Object.assign`, zero edits to the target file) — applied here one layer down, on `window.AxiomMemoryIntelligence.rankedRecall()`, the ONE function `executive-ai.js`'s private `loadMemory()` already calls on every `handle()`. The wrap expands the top hits with their knowledge-graph-related memories, merges and re-ranks through the unmodified `rank()`, and falls back to unmodified Milestone 8 behaviour whenever the graph hasn't been built. Also adds two small, additive, read-only capabilities to `AxiomExecutiveAI` itself: `.graphContext(text, limit)` (preview what a request would recall, without running it) and `.knowledgeStats()` (passthrough to the graph's stats). |
| `m12-bootstrap.js` | Verifies every Milestone 12 module initialized and that the `rankedRecall` wrap actually took (a `__m12Enhanced` marker, checked rather than assumed), extends `window.AxiomRuntime` with a `.knowledge` accessor (same additive pattern as `m8-bootstrap.js`/`m9-bootstrap.js`/`m11-bootstrap.js`), and adds `AxiomRuntime.selfTestM12()`. |

Load order added to `os-shell.html`, directly after the Milestone 11 block
and before `os/core/window-manager.js` — no existing `<script>` tag was
moved, reordered, or removed.

---

## 3. Objectives Checklist

| # | Objective | Status | Where |
|---|---|---|---|
| 1 | Build a Knowledge Graph | ✅ | `knowledge-graph.js` |
| 2 | Add semantic memory search | ✅ | `semantic-search.js` |
| 3 | Add automatic tagging and categorization | ✅ | `auto-tagger.js` |
| 4 | Link related memories | ✅ | `knowledge-graph.js` (`related-to` edges, `.relatedMemories()`) |
| 5 | Detect duplicate memories | ✅ | `duplicate-detector.js` |
| 6 | Generate memory summaries | ✅ | `memory-summarizer.js` |
| 7 | Add memory importance ranking | ✅ | `importance-ranker.js` (feeds the existing M8 `rank()`) |
| 8 | Improve Executive AI using the Knowledge Graph | ✅ | `executive-knowledge-extension.js` |

---

## 4. Reuse / No-Duplication Audit

- **Event Bus** — `executive-knowledge-extension.js` emits
  `knowledge:memory-recall-enhanced` on the existing
  `AxiomAgentRuntime.bus`; no second bus or event channel introduced.
- **Agent Manager** — scope discovery in `knowledge-graph.js`,
  `semantic-search.js`, `duplicate-detector.js` and `memory-summarizer.js`
  all read `AxiomAgentManager.list()` for the 10 core agent ids; none of
  them register, dispatch to, or otherwise touch an agent directly.
- **Memory** — every module reads through `AxiomAgents.getMemoryNotes()` /
  `.searchMemories()` and writes only through `AxiomAgents.tagMemory()` /
  `.setCategory()` / `.updateMemory()` / `.deleteMemory()` — the exact same
  `agent_memory` table and API Milestones 1/5/6 already shipped. No new
  table, no new columns, no client-side second store.
- **Executive AI** — `executive-ai.js` is not edited. Its one integration
  point with memory (`AxiomMemoryIntelligence.rankedRecall()`, called from
  its private `loadMemory()`) is wrapped, exactly the way Milestone 11
  already extended this same object via `Object.assign` rather than a file
  edit.
- **Runtime** — `window.AxiomRuntime` is extended additively
  (`.knowledge`), matching `m8-bootstrap.js`/`m9-bootstrap.js`/
  `m11-bootstrap.js` precedent; no existing property on it is reassigned.
- **No duplicate systems** — tag *suggestion* is the existing
  `AxiomMemoryIntelligence.suggestTags()`, reused verbatim by
  `auto-tagger.js` (only category classification is new); the final
  relevance/recency/importance *ranking* is the existing
  `AxiomMemoryIntelligence.rank()`, reused verbatim by
  `importance-ranker.js` (only the importance *signal* feeding it is new).

---

## 5. Verification

Run:
```
node test-evidence/milestone12-regression-suite.js
```

The suite loads the REAL, unmodified `memory-intelligence.js` (Milestone 8)
and all seven Milestone 12 source files inside a Node `vm` context, against
a light in-memory fake of the one external backend they depend on
(`window.AxiomAgents` — documented as Supabase-backed since Milestone 5's
own suite, and mocked there for the same reason). No Milestone 12 file was
altered to make the harness work.

**19/19 checks passed** (`test-evidence/milestone12-regression-output.txt`):

- Knowledge graph builds real nodes/edges from seeded memory rows, links
  two genuinely related notes, and does not link an unrelated one.
- Semantic search returns TF-IDF-scored, ranked results and correctly
  orders a relevant note above an irrelevant one.
- Auto-tagger both suggests tags for an untagged note **and** proves it
  never overwrites tags a note already has.
- Duplicate detector groups two near-identical notes together and
  confirms an unrelated note is not swept into that group.
- Importance ranker scores a pinned + tagged note higher than a bare one,
  and the output still carries `rankScore` from the unmodified Milestone 8
  ranker (proof it's feeding the existing system, not replacing it).
- Summarizer produces a non-empty, correctly-counted summary.
- The `rankedRecall` wrap is confirmed by marker (not merely "didn't
  throw"), still resolves an array Executive AI's `loadMemory()` can
  consume, and is proven to surface a graph-related note that the raw
  keyword query alone would have missed.
- Regression: Milestone 8's `rank()` still works standalone, and the core
  10-agent registry is unchanged with no duplicates after all Milestone 12
  activity.

`os-shell.html` also gained `AxiomRuntime.selfTestM12()` (`m12-bootstrap.js`),
a sixth self-test in the same shape as `selfTest()`/`selfTestM8()`/
`selfTestM11()`, for in-browser verification against a real Supabase-backed
`AxiomAgents` — it seeds three notes (two near-duplicate, one unrelated),
exercises all seven modules against them, and cleans up after itself.

`test-evidence/milestone11-regression-suite.js` was re-run unchanged after
adding Milestone 12 and still passes **41/41** — confirming Milestone 12
introduced no regression in the Milestone 11 layer it sits beside.

---

## 6. Remaining Limitations

- **The knowledge graph is built on demand, not incrementally.** `.build()`
  re-fetches every scope's memories and reconstructs the graph from
  scratch; there is no live subscription that updates a single node the
  instant a note is remembered/tagged/deleted. A caller (or a future
  bootstrap hook) is expected to call `.refresh()` periodically or before
  a recall that needs current data — the same "call it when you need it"
  model Milestone 8's `rank()` already uses.
- **`related-to` edges are still a token/tag/category heuristic, not real
  semantic similarity** — the same honest limitation Milestone 6's
  `semanticRecall()` and this milestone's own `semantic-search.js`
  document; there is no embeddings backend in this project.
- **Auto-tagging's category classifier is a small, readable keyword map**,
  not a trained model — it will miss a category phrased with none of its
  listed keywords. It is intentionally conservative (only fills blanks) so
  a wrong guess never destroys real data, but a wrong guess can still be
  *applied* where no category previously existed.
- **Duplicate detection is O(n²) per scope**, bounded by the same
  `perScopeLimit`/`getMemoryNotes` cap other modules use (default ~100–200
  rows) — appropriate for a personal memory store, not for an
  unboundedly large one.
- **Memory summaries are extractive, not generative** — no external LLM
  call is invoked for this milestone, so the "summary" is a templated
  digest of statistics and top notes, not free-form prose. If a real
  summarization backend is added later, only `composeText()` inside
  `memory-summarizer.js` needs to change.
- **`jsdom` was unavailable in this execution environment** (no package
  registry access, matching Milestone 11's own note), so verification used
  a hand-built minimal `vm` shim rather than a full `jsdom` window/document
  — narrower than a full browser DOM, though it runs the identical
  unmodified source files in the identical load order.
