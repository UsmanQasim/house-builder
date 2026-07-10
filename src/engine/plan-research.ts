/* Shared floor-plan web research query builder (TypeScript, browser + Node). */
import type { Spec } from './types.js';

export function researchQuery(spec: Spec): string {
  const parts = [
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

export const PlanResearch = { researchQuery };
export default PlanResearch;
