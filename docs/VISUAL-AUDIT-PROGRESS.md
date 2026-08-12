# Visual Consistency Audit — Progress

## Phase A — Color Corrections (In Progress)
- [ ] memory-ultimate.js — `rgba(167,139,250,.08)` → `rgba(96,165,250,.08)`
- [ ] analytics-automation-ultimate.js — `#A855F7` / `rgba(168,85,247,.3)` → `#60A5FA` / `rgba(96,165,250,.3)`
- [ ] brain-ultimate.js — `#A855F7` / `#EC4899` / `rgba(168,85,247,.3)` → `#60A5FA` / `rgba(96,165,250,.3)`

## Phase B — Global Color Audit
- [ ] Search for remaining `#A855F7`, `#8B5CF6`, `#7C3AED`, `#EC4899` in all JS/CSS/HTML files
- [ ] Search for `#FF00FF`, `#FF0080`, `#00FFFF`, `#00E5FF` (neon colors)
- [ ] Search for `#6C5CE7` usage (keep only as agent brand)
- [ ] Search for `rgba(168,85,247`, `rgba(236,72,153` patterns
- [ ] Search for non-standard gradient patterns

## Phase C — Glow Consistency
- [ ] Standardize all box-shadow glows to AXIOM design system
- [ ] Primary: `0 0 24px rgba(96,165,250,.35)`
- [ ] Success: `0 0 18px rgba(126,231,135,.30)`
- [ ] Warning: `0 0 18px rgba(251,191,36,.30)`
- [ ] Error: `0 0 18px rgba(255,107,107,.30)`

## Phase D — Dashboard Integration
- [ ] Ensure CPU/RAM/GPU/Network/Memory/Brain all use Blue palette
- [ ] Green only for success states
- [ ] Amber only for warnings
- [ ] Red only for errors

## Phase E — AI Core State Colors (Preserve)
- [ ] Verify semantic state colors are correct (idle, thinking, speaking, etc.)

## Phase F — Final Verification
- [ ] Full project re-scan for remaining non-standard colors
- [ ] Confirm visual consistency across all modules
- [ ] Update TODO.md

