/* Shared floor-plan web research query builder (browser + Node). */
(function (global) {
  'use strict';
  function researchQuery(spec) {
    var parts = [
      spec.bedrooms + ' bedroom',
      spec.bathrooms + ' bathroom',
      spec.floors + ' storey',
      spec.style + ' house floor plan',
      Math.round(spec.plotW) + 'x' + Math.round(spec.plotD) + ' metres'
    ];
    if (spec.garage) parts.push('garage');
    if (spec.dining) parts.push('dining room');
    parts.push('residential layout');
    return parts.join(' ');
  }
  var api = { researchQuery: researchQuery };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.PlanResearch = api;
})(typeof window !== 'undefined' ? window : globalThis);
