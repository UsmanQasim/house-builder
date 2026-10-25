/* Architectural area schedule, wall/glazing takeoffs, and regional construction cost estimator. */
import type { Layout, Room, Spec } from './types.js';

export type CostMarketId = 'us' | 'uk' | 'pk' | 'ae';
export type FinishTierId = 'essential' | 'signature' | 'bespoke';

export interface MarketConfig {
  id: CostMarketId;
  label: string;
  currency: string;
  symbol: string;
  /** Base construction cost per m² of heated interior space (Signature tier). */
  baseRatePerM2: number;
  /** Multiplier for garage / unconditioned utility zones. */
  garageRateFactor: number;
  /** Typical architectural & engineering soft-cost percentage. */
  softCostPct: number;
  /** Typical contingency percentage. */
  contingencyPct: number;
}

export const MARKETS: Record<CostMarketId, MarketConfig> = {
  us: { id: 'us', label: 'United States (USD)', currency: 'USD', symbol: '$', baseRatePerM2: 2650, garageRateFactor: 0.48, softCostPct: 0.12, contingencyPct: 0.10 },
  uk: { id: 'uk', label: 'United Kingdom (GBP)', currency: 'GBP', symbol: '£', baseRatePerM2: 2350, garageRateFactor: 0.50, softCostPct: 0.12, contingencyPct: 0.10 },
  ae: { id: 'ae', label: 'UAE / GCC (AED)', currency: 'AED', symbol: 'AED ', baseRatePerM2: 6800, garageRateFactor: 0.45, softCostPct: 0.10, contingencyPct: 0.08 },
  pk: { id: 'pk', label: 'Pakistan (PKR)', currency: 'PKR', symbol: 'PKR ', baseRatePerM2: 115000, garageRateFactor: 0.52, softCostPct: 0.08, contingencyPct: 0.08 }
};

export const FINISH_TIERS: Record<FinishTierId, { id: FinishTierId; label: string; multiplier: number; note: string }> = {
  essential: { id: 'essential', label: 'Essential Build', multiplier: 0.82, note: 'Builder-grade finishes, standard fixtures & ceramic tile' },
  signature: { id: 'signature', label: 'Signature Studio', multiplier: 1.0, note: 'Engineered timber, architectural glazing & custom joinery' },
  bespoke: { id: 'bespoke', label: 'Bespoke Luxury', multiplier: 1.38, note: 'Natural stone, floor-to-ceiling glazing & smart home integration' }
};

export interface RoomScheduleRow {
  floorIndex: number;
  floorLabel: string;
  name: string;
  type: Room['type'];
  widthM: number;
  depthM: number;
  areaM2: number;
  areaFt2: number;
  windowsCount: number;
  glazingLinearM: number;
  hasDoor: boolean;
  estimatedCost: number;
}

export interface BoqCategoryLine {
  category: string;
  sharePct: number;
  amount: number;
  summary: string;
}

export interface ProjectEstimate {
  market: MarketConfig;
  tier: { id: FinishTierId; label: string; multiplier: number; note: string };
  siteAreaM2: number;
  footprintAreaM2: number;
  siteCoveragePct: number;
  grossFloorAreaM2: number;
  grossFloorAreaFt2: number;
  netHabitableAreaM2: number;
  circulationAreaM2: number;
  garageAreaM2: number;
  efficiencyPct: number;
  exteriorWallLinearM: number;
  interiorWallLinearM: number;
  totalGlazingLinearM: number;
  doorsCount: number;
  windowsCount: number;
  hardConstructionCost: number;
  softDesignEngineeringCost: number;
  contingencyCost: number;
  totalProjectBudget: number;
  costPerM2: number;
  costPerFt2: number;
  roomSchedule: RoomScheduleRow[];
  boqLines: BoqCategoryLine[];
}

const M2_TO_FT2 = 10.7639;

const ROOM_WEIGHT: Record<Room['type'], number> = {
  kitchen: 1.45,
  bathroom: 1.55,
  living: 1.05,
  dining: 1.0,
  bedroom: 0.95,
  room: 1.0,
  corridor: 0.72,
  garage: 0.48
};

export function computeProjectEstimate(
  layout: Layout,
  spec: Spec,
  marketId: CostMarketId = 'us',
  tierId: FinishTierId = 'signature'
): ProjectEstimate {
  const market = MARKETS[marketId] || MARKETS.us;
  const tier = FINISH_TIERS[tierId] || FINISH_TIERS.signature;

  const siteAreaM2 = Math.max(1, spec.plotW * spec.plotD);
  const footprintAreaM2 = Math.max(1, layout.foot.w * layout.foot.h);
  const siteCoveragePct = Math.min(100, Math.round((footprintAreaM2 / siteAreaM2) * 100));

  const effectiveBaseRate = market.baseRatePerM2 * tier.multiplier;

  let grossFloorAreaM2 = 0;
  let netHabitableAreaM2 = 0;
  let circulationAreaM2 = 0;
  let garageAreaM2 = 0;
  let interiorWallLinearM = 0;
  let totalGlazingLinearM = 0;
  let doorsCount = 0;
  let windowsCount = 0;
  let hardConstructionCost = 0;

  const roomSchedule: RoomScheduleRow[] = [];

  layout.floors.forEach((floor, fIdx) => {
    const floorLabel = `Level ${fIdx + 1}`;
    floor.rooms.forEach(room => {
      const areaM2 = Math.max(0, room.w * room.h);
      const areaFt2 = areaM2 * M2_TO_FT2;
      grossFloorAreaM2 += areaM2;

      if (room.type === 'corridor') {
        circulationAreaM2 += areaM2;
      } else if (room.type === 'garage') {
        garageAreaM2 += areaM2;
      } else {
        netHabitableAreaM2 += areaM2;
      }

      const winCount = (room.windows || []).length;
      const glazM = (room.windows || []).reduce((acc, w) => acc + (Number.isFinite(w.len) ? w.len : 0), 0);
      windowsCount += winCount;
      totalGlazingLinearM += glazM;
      if (room.door) doorsCount += 1;

      // Shared internal partitions approximated as half perimeter of non-exterior edges
      interiorWallLinearM += (room.w + room.h);

      const weight = room.type === 'garage' ? market.garageRateFactor : (ROOM_WEIGHT[room.type] ?? 1.0);
      const roomCost = Math.round(areaM2 * effectiveBaseRate * weight);
      hardConstructionCost += roomCost;

      roomSchedule.push({
        floorIndex: fIdx,
        floorLabel,
        name: room.name || room.type,
        type: room.type,
        widthM: Number(room.w.toFixed(2)),
        depthM: Number(room.h.toFixed(2)),
        areaM2: Number(areaM2.toFixed(1)),
        areaFt2: Math.round(areaFt2),
        windowsCount: winCount,
        glazingLinearM: Number(glazM.toFixed(1)),
        hasDoor: !!room.door,
        estimatedCost: roomCost
      });
    });
  });

  const exteriorWallLinearM = Number((2 * (layout.foot.w + layout.foot.h) * layout.floors.length).toFixed(1));
  interiorWallLinearM = Number(interiorWallLinearM.toFixed(1));
  totalGlazingLinearM = Number(totalGlazingLinearM.toFixed(1));
  grossFloorAreaM2 = Number(grossFloorAreaM2.toFixed(1));
  const grossFloorAreaFt2 = Math.round(grossFloorAreaM2 * M2_TO_FT2);
  netHabitableAreaM2 = Number(netHabitableAreaM2.toFixed(1));
  circulationAreaM2 = Number(circulationAreaM2.toFixed(1));
  garageAreaM2 = Number(garageAreaM2.toFixed(1));

  const efficiencyPct = grossFloorAreaM2 > 0
    ? Math.round(((netHabitableAreaM2 + garageAreaM2) / grossFloorAreaM2) * 100)
    : 0;

  // Add multi-storey structural premium (+4% per upper floor)
  const storeyFactor = 1 + Math.max(0, layout.floors.length - 1) * 0.04;
  hardConstructionCost = Math.round(hardConstructionCost * storeyFactor);

  const softDesignEngineeringCost = Math.round(hardConstructionCost * market.softCostPct);
  const contingencyCost = Math.round(hardConstructionCost * market.contingencyPct);
  const totalProjectBudget = hardConstructionCost + softDesignEngineeringCost + contingencyCost;

  const costPerM2 = grossFloorAreaM2 > 0 ? Math.round(hardConstructionCost / grossFloorAreaM2) : 0;
  const costPerFt2 = grossFloorAreaFt2 > 0 ? Math.round(hardConstructionCost / grossFloorAreaFt2) : 0;

  const boqRaw: Array<{ category: string; sharePct: number; summary: string }> = [
    { category: 'Substructure & Reinforced Concrete Frame', sharePct: 24, summary: `Foundation pad (${footprintAreaM2.toFixed(0)} m²) & ${layout.floors.length}-level structural frame` },
    { category: 'Exterior Envelope, Roofing & Thermal Glazing', sharePct: 19, summary: `${exteriorWallLinearM} m facade perimeter & ${windowsCount} glazing units (${totalGlazingLinearM} m)` },
    { category: 'Interior Partitions, Doors & Millwork', sharePct: 16, summary: `${interiorWallLinearM} m partition framing & ${doorsCount} architectural doorsets` },
    { category: 'MEP Systems (HVAC, Electrical, Plumbing)', sharePct: 21, summary: `${spec.bathrooms} wet cores, ${spec.kitchens} kitchen rough-ins & climate zoning` },
    { category: 'Flooring, Wall Finishes & Wet-Area Fitout', sharePct: 20, summary: `${netHabitableAreaM2} m² habitable finish package (${tier.label})` }
  ];

  const boqLines: BoqCategoryLine[] = boqRaw.map(item => ({
    category: item.category,
    sharePct: item.sharePct,
    amount: Math.round((hardConstructionCost * item.sharePct) / 100),
    summary: item.summary
  }));

  return {
    market,
    tier,
    siteAreaM2: Number(siteAreaM2.toFixed(1)),
    footprintAreaM2: Number(footprintAreaM2.toFixed(1)),
    siteCoveragePct,
    grossFloorAreaM2,
    grossFloorAreaFt2,
    netHabitableAreaM2,
    circulationAreaM2,
    garageAreaM2,
    efficiencyPct,
    exteriorWallLinearM,
    interiorWallLinearM,
    totalGlazingLinearM,
    doorsCount,
    windowsCount,
    hardConstructionCost,
    softDesignEngineeringCost,
    contingencyCost,
    totalProjectBudget,
    costPerM2,
    costPerFt2,
    roomSchedule,
    boqLines
  };
}

export function formatMoney(amount: number, market: MarketConfig): string {
  const rounded = Math.round(amount);
  return `${market.symbol}${rounded.toLocaleString('en-US')}`;
}

