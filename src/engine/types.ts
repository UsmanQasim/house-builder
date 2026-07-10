/* Shared domain types for the ForthHome engine (browser + Node). */

export type RoomType = 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'dining' | 'garage' | 'corridor' | 'room';
export type Side = 'left' | 'right' | 'top' | 'bottom';
export type StyleName = 'modern' | 'traditional' | 'minimalist' | 'scandinavian' | 'industrial';

export interface Door { side: Side; pos: number; width: number; }
export interface Win { side: Side; pos: number; len: number; }

export interface Room {
  type: RoomType;
  name: string;
  x: number; y: number; w: number; h: number;
  area: number;
  door: Door | null;
  windows: Win[];
}

export interface Rect { x: number; y: number; w: number; h: number; }
export interface Entrance { x: number; y: number; width: number; }

export interface Floor {
  index: number;
  rooms: Room[];
  corridor: Rect | null;
  entrance: Entrance | null;
  stairs: Rect | null;
}

export interface Layout {
  plotW: number; plotD: number;
  foot: Rect;
  corridorX: number; CW: number;
  floors: Floor[];
  partitions: boolean;
  planSource?: string;
  templateId?: string;
  planConcept?: string;
  planInspiration?: string;
}

export interface Spec {
  plotW: number; plotD: number;
  floors: number;
  bedrooms: number; bathrooms: number; kitchens: number; living: number;
  dining: boolean; garage: boolean;
  style: StyleName | string;
  prompt?: string;
  accents?: Partial<Record<RoomType, string>>;
  /** When true, validateLayout also enforces exact bedroom/bathroom counts. */
  strictCounts?: boolean;
}

export interface Validation { ok: boolean; score: number; issues: string[]; }

/* Raw (untrusted) AI plan shapes */
export interface RawDoor { side?: string; pos?: number | string; width?: number; }
export interface RawRoom { type?: string; name?: string; x?: number; y?: number; w?: number; h?: number; door?: RawDoor; }
export interface RawFloor { rooms?: RawRoom[]; corridor?: Partial<Rect>; entrance?: { x?: number; y?: number; width?: number }; stairs?: Partial<Rect>; }
export interface RawPlan { floors?: RawFloor[]; concept?: string; inspiration?: string; }

/* 3D scene description */
export type ItemKind = 'ground' | 'slabwall' | 'plinth' | 'path' | 'wall' | 'glass' | 'trim' | 'floor' | 'underlay' | 'ceil' | 'roof' | 'roofpitch' | 'door' | 'furn' | 'lamp' | 'tree' | 'hedge' | 'shrub' | 'modelslot' | 'curtain' | 'art';
export type GeoKind = 'box' | 'cyl' | 'cone' | 'sphere';

export interface SceneItem {
  t: ItemKind;
  x: number; y: number; z: number;
  w: number; h: number; d: number;
  color: string;
  tex: string | null;
  floor: number;
  ry: number;
  geo: GeoKind;
  slot: string | null;
  model?: string;
}

export interface CollisionBox { floor: number; minX: number; maxX: number; minZ: number; maxZ: number; }

export interface SceneDescription {
  items: SceneItem[];
  collision: CollisionBox[];
  floors: number;
  wallH: number; slab: number; eye: number; pr: number;
  spawn: { x: number; z: number };
  plotW: number; plotD: number;
}
