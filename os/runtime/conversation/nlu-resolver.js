// ============================================================
// AXIOM AI OS — Milestone 10: Natural Language Understanding
// ------------------------------------------------------------
// Milestone 8's AxiomTaskPlanner already turns free text into ordered,
// agent-routed steps (splitClauses/analyzeIntent/decompose) — that is
// still the ONLY thing that decides which agents run. This module does
// not re-implement any of that. It sits strictly BEFORE the planner in
// the pipeline and does the one thing the planner cannot: look at text
// that only makes sense in light of an earlier turn ("play something
// relaxing on it", "save the best ones", "open them in Browser") and
// rewrite it into a self-contained sentence the existing planner/router
// can already handle on its own.
//
// It is a linguistic heuristic — pattern + recency, not a trained
// coreference model — documented plainly, exactly like the "honest
// heuristic, not a fake NLU engine" framing already used for semantic
// recall (memory-intelligence.js) and search planning
// (browser-intelligence.js). It never touches storage, the bus, or any
// agent; it is a pure text-in/text-out module plus a couple of small
// pure helpers, so it has no state of its own to manage.
//
// Public surface — window.AxiomNLU:
//   .extractTopic(text)                 -> string | null
//   .hasReference(text)                 -> boolean
//   .resolveReferences(text, state)     -> { resolvedText, usedReference, matched, reason }
//   .needsReferenceClarification(text, state) -> { required, reason }
//   .injectImplicitObject(text, state)  -> { text, injected }
// ============================================================
window.AxiomNLU = (function () {
  'use strict';

  // Whole-word reference markers this module knows how to resolve.
  // Ordered longest-phrase-first so "the previous one" is matched before
  // a bare "one" style pattern ever could be.
  var REFERENCE_PATTERNS = [
    { re: /\bthe previous one\b/gi, kind: 'literal-previous' },
    { re: /\bthe last one\b/gi, kind: 'literal-previous' },
    { re: /\bthe same (?:one|thing)\b/gi, kind: 'literal-previous' },
    { re: /\bthose\b/gi, kind: 'topic-plural' },
    { re: /\bthem\b/gi, kind: 'topic-plural' },
    { re: /\bthese\b/gi, kind: 'topic-plural' },
    { re: /\bthe best ones?\b/gi, kind: 'topic-plural' },
    { re: /\bit\b/gi, kind: 'topic' },
    { re: /\bthat\b/gi, kind: 'topic' }
  ];

  var BARE_REFERENCE_ONLY = /^(do it|fix it|fix that|handle it|handle that|do that|do this|open it|open that|save it|save that|use it|use that)\.?$/i;

  // Verbs whose object is being talked ABOUT, i.e. the thing worth
  // remembering as "the active topic" for later turns to refer back to.
  var TOPIC_VERBS = /\b(?:research|find|search(?:\s+for)?|look up|open|play|summarize|read|investigate|explore|check out|browse)\b\s+(.+)/i;

  function clean(s) {
    return String(s || '').trim().replace(/^(and|then|also|now)\s+/i, '').replace(/[.!?\s]+$/, '');
  }

  // A light heuristic subject extractor: prefer the object of a known
  // "topic verb", fall back to a quoted phrase, then to the whole clause
  // with a leading article/verb stripped. This mirrors how
  // AxiomTaskPlanner already treats clause text as the unit of meaning —
  // it just picks the noun-ish part of it out for reuse later.
  function extractTopic(text) {
    var raw = clean(text);
    if (!raw) return null;

    var quoted = raw.match(/"([^"]+)"|'([^']+)'/);
    if (quoted) return (quoted[1] || quoted[2]).trim();

    var verbMatch = raw.match(TOPIC_VERBS);
    if (verbMatch && verbMatch[1]) {
      return clean(verbMatch[1]).replace(/\s+(?:and|,).*$/i, '');
    }

    // No recognizable topic verb — the clause itself (minus a leading
    // filler verb like "create"/"make"/"build") is the best we can do.
    var stripped = raw.replace(/^(create|make|build|generate|start|set up)\s+(a|an|the)?\s*/i, '');
    return stripped || raw;
  }

  function hasReference(text) {
    var raw = String(text || '');
    return REFERENCE_PATTERNS.some(function (p) {
      p.re.lastIndex = 0;
      return p.re.test(raw);
    });
  }

  // Rewrites reference words into the resolved topic. `state` is the
  // plain { activeTopic, activeTopicPlural, lastFullText } snapshot the
  // Conversation Manager already tracks — this module never reaches into
  // conversation state itself, so it stays trivially unit-testable.
  function resolveReferences(text, state) {
    var raw = String(text || '');
    state = state || {};
    var topic = state.activeTopic || null;
    var previous = state.lastFullText || topic;
    var matchedKinds = [];

    if (!hasReference(raw)) {
      return { resolvedText: raw, usedReference: false, matched: [], reason: null };
    }

    if (!topic && !previous) {
      return { resolvedText: raw, usedReference: false, matched: [], reason: 'no-topic-in-history' };
    }

    var resolved = raw;
    REFERENCE_PATTERNS.forEach(function (p) {
      p.re.lastIndex = 0;
      if (!p.re.test(resolved)) return;
      var replacement = p.kind === 'literal-previous' ? (previous || topic) : (topic || previous);
      if (!replacement) return;
      matchedKinds.push(p.kind);
      var re = new RegExp(p.re.source, 'gi');
      resolved = resolved.replace(re, replacement);
    });

    return {
      resolvedText: clean(resolved),
      usedReference: matchedKinds.length > 0,
      matched: matchedKinds,
      reason: null
    };
  }

  // A reference is only a hard blocker (ask, don't guess) when there is
  // truly nothing in the conversation to resolve it against. A single
  // bare pronoun with no history is what Executive AI's own
  // needsClarification already catches for a single turn in isolation;
  // this adds the cross-turn case: "play it" as literally the first
  // thing said in a brand-new conversation.
  function needsReferenceClarification(text, state) {
    var raw = clean(text);
    state = state || {};
    if (!raw) return { required: false, reason: null };

    var bareRef = BARE_REFERENCE_ONLY.test(raw);
    var hasRef = hasReference(raw);
    if (!hasRef && !bareRef) return { required: false, reason: null };

    var topic = state.activeTopic || state.lastFullText || null;
    if (!topic) {
      return {
        required: true,
        reason: 'The request refers to something ("it"/"that"/"those"/"the previous one") but there is no earlier topic in this conversation to resolve it to.'
      };
    }
    return { required: false, reason: null };
  }

  // Follow-ups often drop the object entirely rather than pronoun-ify it
  // ("Now save the best ones." -> "Create a roadmap." with no stated
  // subject). If the clause looks like a bare action template with no
  // object of its own, and a topic exists, attach it — this is additive
  // context, never a guess about WHAT to do, only WHAT it's about.
  var BARE_ACTION_TEMPLATES = /^(create|make|build|generate|draft|write)\s+(a|an|the)?\s*(roadmap|plan|summary|report|outline|list|schedule|timeline)$/i;

  function injectImplicitObject(text, state) {
    var raw = clean(text);
    state = state || {};
    var topic = state.activeTopic || null;
    if (!raw || !topic) return { text: raw, injected: false };
    if (!BARE_ACTION_TEMPLATES.test(raw)) return { text: raw, injected: false };
    return { text: raw + ' for ' + topic, injected: true };
  }

  return {
    extractTopic: extractTopic,
    hasReference: hasReference,
    resolveReferences: resolveReferences,
    needsReferenceClarification: needsReferenceClarification,
    injectImplicitObject: injectImplicitObject
  };
})();
