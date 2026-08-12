// ============================================
// AXIOM — Module 3: Workspace premium polish
// Purely additive/visual. Does not touch upload logic, Supabase
// calls, auth, or file-processing — only shows a skeleton placeholder
// in #fileGrid until workspace.js performs its first real render,
// which naturally replaces this markup via its own innerHTML write.
// ============================================
(function () {
  'use strict';

  var grid = document.getElementById('fileGrid');
  if (!grid) return;

  // Only show a skeleton if the grid is empty at this point in parsing
  // (i.e. workspace.js hasn't rendered anything into it yet).
  if (grid.children.length === 0) {
    var card =
      '<div class="file-skeleton-card" aria-hidden="true">' +
        '<div class="file-skeleton-thumb"></div>' +
        '<div class="file-skeleton-line"></div>' +
        '<div class="file-skeleton-line short"></div>' +
      '</div>';
    grid.innerHTML = card.repeat(6);
    grid.classList.add('is-loading');

    var stopWhenRendered = function () {
      grid.classList.remove('is-loading');
      observer.disconnect();
    };
    var observer = new MutationObserver(stopWhenRendered);
    observer.observe(grid, { childList: true });

    // Safety net in case the library never mutates the grid
    // (e.g. an early auth/network error is handled elsewhere).
    setTimeout(function () {
      if (grid.querySelector('.file-skeleton-card')) {
        stopWhenRendered();
      }
    }, 8000);
  }
})();
