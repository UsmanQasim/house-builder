/* High-detail parametric 3D furniture & architectural mesh builder for Three.js.
 * Replaces primitive box placeholders and low-poly toy GLBs with clean, multi-part,
 * bevelled PBR architectural furniture and landscaping assets that export directly to GLB. */
import * as THREE from 'three';
import type { SceneItem } from './types.js';

function matStd(color: string | number, roughness = 0.65, metalness = 0.05, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness, ...extra });
}

function addBox(
  parent: THREE.Group,
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  mat: THREE.Material,
  rx = 0, ry = 0, rz = 0
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function addCyl(
  parent: THREE.Group,
  rTop: number, rBot: number, h: number,
  x: number, y: number, z: number,
  mat: THREE.Material,
  segs = 20,
  rx = 0, ry = 0, rz = 0
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, segs), mat);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Build a luxury architectural double/king bed with channeled headboard, platform frame,
 * mattress, layered duvet, throw blanket, 4 pillows, and twin bedside sconces. */
function buildBedMesh(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const wood = matStd('#8b623b', 0.52, 0.06);
  const darkWood = matStd('#4e3620', 0.58, 0.08);
  const fabricHead = matStd('#d8d2c7', 0.85, 0.02);
  const sheet = matStd('#f7f6f2', 0.78, 0.01);
  const duvet = matStd('#e7e2d8', 0.82, 0.02);
  const throwBlanket = matStd('#5c7065', 0.86, 0.02);
  const brass = matStd('#c5a059', 0.28, 0.82);

  // Recessed shadow plinth + platform frame
  addBox(g, w * 0.88, 0.10, d * 0.88, 0, 0.05, 0.04, darkWood);
  addBox(g, w, 0.22, d * 0.94, 0, 0.21, 0.03, wood);

  // Upholstered channeled headboard at -z
  const hbH = Math.min(h, 1.08), hbZ = -d / 2 + 0.06;
  addBox(g, w + 0.08, hbH, 0.09, 0, hbH / 2, hbZ, wood);
  const channels = 7, chW = (w - 0.08) / channels;
  for (let i = 0; i < channels; i++) {
    const cx = -w / 2 + 0.04 + chW * (i + 0.5);
    addBox(g, chW - 0.018, hbH - 0.14, 0.065, cx, hbH / 2 + 0.04, hbZ + 0.045, fabricHead);
  }

  // Plush mattress + quilted duvet + accent throw
  const matW = w - 0.10, matD = d * 0.86;
  addBox(g, matW, 0.24, matD, 0, 0.43, 0.04, sheet);
  addBox(g, matW + 0.02, 0.20, matD * 0.72, 0, 0.46, d * 0.15, duvet);
  addBox(g, matW + 0.03, 0.21, matD * 0.26, 0, 0.465, d * 0.34, throwBlanket);

  // 4 angled sleeping & bolster pillows
  const pw = matW * 0.41, pd = 0.28;
  addBox(g, pw, 0.13, pd, -matW * 0.24, 0.60, -d * 0.28, sheet, 0.22, 0, 0);
  addBox(g, pw, 0.13, pd, matW * 0.24, 0.60, -d * 0.28, sheet, 0.22, 0, 0);
  addBox(g, pw * 0.82, 0.12, pd * 0.82, -matW * 0.24, 0.61, -d * 0.18, throwBlanket, 0.15, 0, 0);
  addBox(g, pw * 0.82, 0.12, pd * 0.82, matW * 0.24, 0.61, -d * 0.18, throwBlanket, 0.15, 0, 0);

  // Brass corner accents
  addCyl(g, 0.022, 0.016, 0.12, -w * 0.46, 0.06, d * 0.46, brass, 12);
  addCyl(g, 0.022, 0.016, 0.12, w * 0.46, 0.06, d * 0.46, brass, 12);
  return g;
}

/** Full-height architectural millwork wardrobe with shadow-gap doors and brass pulls. */
function buildWardrobeMesh(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const carcass = matStd('#4a3c31', 0.55, 0.05);
  const doorMat = matStd('#d8cfc2', 0.62, 0.04);
  const brass = matStd('#b89352', 0.28, 0.82);

  // Wardrobe depth is along X or Z depending on caller; build with width=w, height=h, depth=d
  const bodyW = w, bodyH = h, bodyD = d;
  addBox(g, bodyW, bodyH, bodyD * 0.92, 0, bodyH / 2, -bodyD * 0.04, carcass);

  const doors = Math.max(2, Math.round(Math.max(bodyW, bodyD) / 0.55));
  if (bodyD >= bodyW) {
    // Oriented along Z
    const seg = (bodyD - 0.08) / doors;
    for (let i = 0; i < doors; i++) {
      const cz = -bodyD / 2 + 0.04 + seg * (i + 0.5);
      addBox(g, 0.03, bodyH - 0.12, seg - 0.02, bodyW / 2 - 0.01, bodyH / 2, cz, doorMat);
      addBox(g, 0.02, 0.42, 0.018, bodyW / 2 + 0.015, bodyH * 0.48, cz + (i % 2 === 0 ? seg * 0.35 : -seg * 0.35), brass);
    }
  } else {
    const seg = (bodyW - 0.08) / doors;
    for (let i = 0; i < doors; i++) {
      const cx = -bodyW / 2 + 0.04 + seg * (i + 0.5);
      addBox(g, seg - 0.02, bodyH - 0.12, 0.03, cx, bodyH / 2, bodyD / 2 - 0.01, doorMat);
      addBox(g, 0.018, 0.42, 0.02, cx + (i % 2 === 0 ? seg * 0.35 : -seg * 0.35), bodyH * 0.48, bodyD / 2 + 0.015, brass);
    }
  }
  return g;
}

/** Designer 3-seat modular bouclé sofa with individual cushions, track arms, and throw pillows. */
function buildSofaMesh(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const boucle = matStd('#dedad0', 0.88, 0.01);
  const boucleDark = matStd('#c7c1b4', 0.88, 0.02);
  const accentPillow = matStd('#5f7568', 0.84, 0.02);
  const warmPillow = matStd('#b3835b', 0.84, 0.02);
  const oak = matStd('#8c633b', 0.5, 0.06);

  // Timber plinth & tapered legs
  addBox(g, w * 0.96, 0.07, d * 0.92, 0, 0.08, 0, oak);
  [[-w * 0.45, -d * 0.40], [w * 0.45, -d * 0.40], [-w * 0.45, d * 0.40], [w * 0.45, d * 0.40]].forEach(([lx, lz]) => {
    addCyl(g, 0.028, 0.018, 0.08, lx, 0.04, lz, oak, 12);
  });

  // Backrest frame & track arms
  const armW = 0.22, innerW = w - armW * 2;
  addBox(g, w, h * 0.78, 0.20, 0, h * 0.45, -d / 2 + 0.10, boucleDark);
  addBox(g, armW, h * 0.64, d * 0.94, -w / 2 + armW / 2, h * 0.38, 0.02, boucleDark);
  addBox(g, armW, h * 0.64, d * 0.94, w / 2 - armW / 2, h * 0.38, 0.02, boucleDark);

  // 3 seat cushions + 3 angled back cushions
  const seats = 3, cw = (innerW - 0.04) / seats;
  for (let i = 0; i < seats; i++) {
    const cx = -innerW / 2 + 0.02 + cw * (i + 0.5);
    addBox(g, cw - 0.02, 0.22, d * 0.74, cx, 0.22, 0.08, boucle);
    addBox(g, cw - 0.03, 0.40, 0.18, cx, 0.50, -d / 2 + 0.26, boucle, -0.14, 0, 0);
  }

  // Throw cushions
  addBox(g, 0.34, 0.32, 0.12, -innerW * 0.36, 0.48, -d * 0.10, accentPillow, -0.18, 0.25, 0.08);
  addBox(g, 0.34, 0.32, 0.12, innerW * 0.36, 0.48, -d * 0.10, warmPillow, -0.18, -0.25, -0.08);
  return g;
}

/** Sculptural coffee table with fluted pedestal legs, art books, and ceramic vase. */
function buildCoffeeTableMesh(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const travertine = matStd('#e2dcd0', 0.45, 0.04);
  const oak = matStd('#7a5533', 0.52, 0.06);
  const book1 = matStd('#2f3e35', 0.6, 0.05);
  const book2 = matStd('#d4cdc0', 0.7, 0.02);
  const vase = matStd('#b87d56', 0.4, 0.1);
  const stem = matStd('#486b49', 0.75, 0.02);

  addBox(g, w, 0.05, d, 0, h - 0.025, 0, travertine);
  addCyl(g, 0.11, 0.11, h - 0.05, -w * 0.30, (h - 0.05) / 2, 0, oak, 20);
  addCyl(g, 0.11, 0.11, h - 0.05, w * 0.30, (h - 0.05) / 2, 0, oak, 20);

  // Stacked architecture books + ceramic vase
  addBox(g, 0.28, 0.035, 0.22, -w * 0.18, h + 0.018, 0.02, book1, 0, 0.08, 0);
  addBox(g, 0.24, 0.03, 0.19, -w * 0.18, h + 0.05, 0.02, book2, 0, -0.05, 0);
  addCyl(g, 0.045, 0.065, 0.18, w * 0.20, h + 0.09, -0.03, vase, 16);
  addCyl(g, 0.04, 0.01, 0.14, w * 0.20, h + 0.22, -0.03, stem, 10);
  return g;
}

/** Solid timber dining table with architectural trestle legs and centerpiece bowl. */
function buildDiningTableMesh(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const oak = matStd('#9e7246', 0.48, 0.06);
  const darkMetal = matStd('#2c3035', 0.38, 0.75);
  const ceramic = matStd('#ebe7df', 0.35, 0.05);

  addBox(g, w, 0.055, d, 0, h - 0.028, 0, oak);
  // Sculptural A-frame / trestle legs
  [-w * 0.36, w * 0.36].forEach(lx => {
    addBox(g, 0.07, h - 0.05, 0.07, lx, (h - 0.05) / 2, -d * 0.32, darkMetal, 0.12, 0, 0);
    addBox(g, 0.07, h - 0.05, 0.07, lx, (h - 0.05) / 2, d * 0.32, darkMetal, -0.12, 0, 0);
    addBox(g, 0.06, 0.05, d * 0.56, lx, h * 0.35, 0, darkMetal);
  });
  // Centerpiece bowl
  addCyl(g, 0.18, 0.09, 0.07, 0, h + 0.035, 0, ceramic, 20);
  return g;
}

/** Designer dining / task chair with upholstered seat, curved backrest, and 4 tapered legs. */
function buildChairMesh(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const oak = matStd('#855d37', 0.5, 0.05);
  const seatFab = matStd('#d6d0c4', 0.82, 0.02);

  const seatH = 0.45;
  addBox(g, w * 0.88, 0.055, d * 0.86, 0, seatH, 0, seatFab);
  // Curved backrest at -z
  addBox(g, w * 0.86, 0.24, 0.045, 0, h - 0.15, -d * 0.38, oak, -0.08, 0, 0);
  addBox(g, w * 0.78, 0.18, 0.035, 0, h - 0.15, -d * 0.35, seatFab, -0.08, 0, 0);
  // 4 tapered legs
  [[-w * 0.36, -d * 0.36], [w * 0.36, -d * 0.36], [-w * 0.36, d * 0.36], [w * 0.36, d * 0.36]].forEach(([lx, lz]) => {
    const legH = lz < 0 ? h - 0.08 : seatH;
    addCyl(g, 0.022, 0.015, legH, lx, legH / 2, lz, oak, 10);
  });
  return g;
}

/** Stainless-steel French-door refrigerator with twin handles and dispenser niche. */
function buildRefrigeratorMesh(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const body = matStd('#5c6269', 0.35, 0.75);
  const steel = matStd('#c2c7cc', 0.25, 0.86);
  const chrome = matStd('#e4e8ec', 0.18, 0.92);
  const dark = matStd('#202428', 0.4, 0.3);

  addBox(g, w, h, d * 0.88, 0, h / 2, -d * 0.05, body);
  // Upper French doors
  const upperH = h * 0.62, lowerH = h * 0.34, doorW = (w - 0.03) / 2;
  addBox(g, doorW, upperH, 0.05, -doorW / 2 - 0.008, h - upperH / 2 - 0.02, d * 0.41, steel);
  addBox(g, doorW, upperH, 0.05, doorW / 2 + 0.008, h - upperH / 2 - 0.02, d * 0.41, steel);
  // Lower freezer drawer
  addBox(g, w - 0.02, lowerH, 0.05, 0, lowerH / 2 + 0.02, d * 0.41, steel);
  // Handles & ice dispenser
  addCyl(g, 0.012, 0.012, upperH * 0.65, -0.035, h - upperH / 2, d * 0.45, chrome, 10);
  addCyl(g, 0.012, 0.012, upperH * 0.65, 0.035, h - upperH / 2, d * 0.45, chrome, 10);
  addCyl(g, 0.012, 0.012, w * 0.7, 0, lowerH - 0.06, d * 0.45, chrome, 10, 0, 0, Math.PI / 2);
  addBox(g, doorW * 0.48, 0.24, 0.015, -doorW * 0.5, h * 0.62, d * 0.435, dark);
  return g;
}

/** Freestanding soaking bathtub with water surface and brushed-brass filler faucet. */
function buildBathtubMesh(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const ceramic = matStd('#f5f6f7', 0.22, 0.05);
  const water = matStd('#8ccad6', 0.12, 0.1, { transparent: true, opacity: 0.78 });
  const brass = matStd('#c49f58', 0.24, 0.85);
  const wood = matStd('#9c7044', 0.5, 0.05);

  // Outer sculpted shell + inner water plane + bath caddy
  addBox(g, w, h * 0.92, d, 0, h * 0.46, 0, ceramic);
  addBox(g, w - 0.14, 0.04, d - 0.14, 0, h * 0.78, 0, water);
  addBox(g, 0.22, 0.025, d + 0.04, w * 0.12, h * 0.93, 0, wood);
  // Floor-standing brass faucet at -x
  addCyl(g, 0.02, 0.025, h + 0.22, -w / 2 + 0.08, (h + 0.22) / 2, -d * 0.25, brass, 12);
  addBox(g, 0.14, 0.025, 0.025, -w / 2 + 0.14, h + 0.21, -d * 0.25, brass);
  return g;
}

/** Modern contoured two-piece ceramic toilet with cistern and chrome flush plate. */
function buildToiletMesh(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const ceramic = matStd('#f4f5f6', 0.22, 0.05);
  const chrome = matStd('#d8dde2', 0.2, 0.9);

  // Cistern tank at -z, bowl extending toward +z
  addBox(g, w * 0.88, h * 0.52, d * 0.36, 0, h * 0.72, -d * 0.28, ceramic);
  addBox(g, w * 0.92, 0.035, d * 0.38, 0, h * 0.98, -d * 0.28, ceramic);
  addBox(g, 0.08, 0.015, 0.04, 0, h * 1.0, -d * 0.28, chrome);
  addCyl(g, w * 0.42, w * 0.34, h * 0.54, 0, h * 0.27, d * 0.08, ceramic, 18);
  addBox(g, w * 0.76, h * 0.52, d * 0.48, 0, h * 0.26, -d * 0.06, ceramic);
  addCyl(g, w * 0.43, w * 0.43, 0.035, 0, h * 0.55, d * 0.08, ceramic, 18);
  return g;
}

/** Botanical indoor Monstera / Fiddle-Leaf plant in a ribbed ceramic planter. */
function buildPottedPlantMesh(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const potMat = matStd('#d6cec2', 0.55, 0.04);
  const soilMat = matStd('#3b2d22', 0.9, 0.01);
  const stemMat = matStd('#3c5936', 0.7, 0.02);
  const leafMat = matStd('#3c6e3f', 0.52, 0.04);
  const leafLight = matStd('#4e844f', 0.55, 0.04);

  const potR = Math.min(w, d) * 0.24, potH = h * 0.32;
  addCyl(g, potR, potR * 0.78, potH, 0, potH / 2, 0, potMat, 20);
  addCyl(g, potR * 0.92, potR * 0.92, 0.03, 0, potH - 0.01, 0, soilMat, 16);

  // Branching stems + sculpted angled leaves
  const leafCount = 11;
  for (let i = 0; i < leafCount; i++) {
    const angle = (i / leafCount) * Math.PI * 2 + (i % 2) * 0.2;
    const tier = i / leafCount;
    const reach = potR * (0.5 + tier * 0.95);
    const ly = potH + 0.12 + tier * (h - potH - 0.18);
    const lx = Math.cos(angle) * reach, lz = Math.sin(angle) * reach;
    addCyl(g, 0.012, 0.016, ly - potH + 0.08, lx * 0.45, (potH + ly) / 2, lz * 0.45, stemMat, 8, Math.sin(angle) * 0.25, 0, -Math.cos(angle) * 0.25);
    addBox(g, 0.22, 0.018, 0.30, lx, ly, lz, i % 2 === 0 ? leafMat : leafLight, 0.35 + tier * 0.2, -angle + Math.PI / 2, 0.12);
  }
  return g;
}

/** Sleek metallic graphite architectural SUV / crossover (replaces cartoon yellow car). */
function buildCarMesh(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = matStd('#2f3640', 0.24, 0.78);
  const roofMat = matStd('#1e232a', 0.20, 0.82);
  const glassMat = matStd('#162029', 0.10, 0.90);
  const tireMat = matStd('#1a1c1e', 0.85, 0.05);
  const rimMat = matStd('#c8cfd6', 0.25, 0.88);
  const headlight = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xffe8b0, emissiveIntensity: 0.9, roughness: 0.2 });
  const taillight = new THREE.MeshStandardMaterial({ color: 0xd93829, emissive: 0xb82518, emissiveIntensity: 0.7, roughness: 0.25 });

  const cw = Math.min(w, 1.88), cd = Math.min(d, 4.35), ch = Math.min(h, 1.52);
  // Lower sculpted body & rocker panels
  addBox(g, cw, ch * 0.42, cd, 0, ch * 0.36, 0, bodyMat);
  addBox(g, cw * 0.92, ch * 0.12, cd * 0.96, 0, ch * 0.20, 0, roofMat);

  // Upper aerodynamic greenhouse cabin + tinted glass
  addBox(g, cw * 0.84, ch * 0.38, cd * 0.54, 0, ch * 0.74, -cd * 0.04, roofMat);
  addBox(g, cw * 0.86, ch * 0.30, cd * 0.48, 0, ch * 0.73, -cd * 0.04, glassMat);
  // Sloped windshield & rear glass
  addBox(g, cw * 0.80, ch * 0.34, 0.08, 0, ch * 0.70, cd * 0.24, glassMat, -0.55, 0, 0);
  addBox(g, cw * 0.80, ch * 0.32, 0.08, 0, ch * 0.70, -cd * 0.32, glassMat, 0.48, 0, 0);

  // 4 wheels with alloy rims
  const wr = ch * 0.23, wx = cw * 0.48, wz = cd * 0.31;
  [[-wx, -wz], [wx, -wz], [-wx, wz], [wx, wz]].forEach(([x, z]) => {
    addCyl(g, wr, wr, 0.22, x, wr, z, tireMat, 20, 0, 0, Math.PI / 2);
    addCyl(g, wr * 0.62, wr * 0.62, 0.23, x, wr, z, rimMat, 14, 0, 0, Math.PI / 2);
  });

  // LED Headlights (+z) and Taillight bar (-z)
  addBox(g, cw * 0.24, 0.06, 0.04, -cw * 0.32, ch * 0.48, cd / 2 + 0.01, headlight);
  addBox(g, cw * 0.24, 0.06, 0.04, cw * 0.32, ch * 0.48, cd / 2 + 0.01, headlight);
  addBox(g, cw * 0.78, 0.055, 0.04, 0, ch * 0.50, -cd / 2 - 0.01, taillight);
  return g;
}

/** Multi-stem architectural tree with natural bark branches and layered organic canopy. */
export function buildArchitecturalTreeMesh(it: SceneItem): THREE.Group {
  const g = new THREE.Group();
  const bark = matStd('#5c4633', 0.88, 0.02);
  const leaves1 = matStd('#436b42', 0.78, 0.02);
  const leaves2 = matStd('#527c4e', 0.80, 0.02);
  const leaves3 = matStd('#385b37', 0.76, 0.02);

  // Main trunk + secondary angled branches
  addCyl(g, 0.09, 0.16, 2.2, 0, 1.1, 0, bark, 12);
  addCyl(g, 0.05, 0.08, 1.3, -0.28, 2.1, 0.15, bark, 10, 0.22, 0, 0.38);
  addCyl(g, 0.05, 0.08, 1.2, 0.30, 2.2, -0.18, bark, 10, -0.24, 0, -0.36);

  // Layered organic canopy clusters (dodecahedron-like faceted spheres)
  const blobs: [number, number, number, number, THREE.Material][] = [
    [0, 2.95, 0, 1.15, leaves1],
    [-0.55, 2.55, 0.32, 0.82, leaves2],
    [0.58, 2.65, -0.28, 0.86, leaves3],
    [0.18, 3.45, 0.22, 0.76, leaves2],
    [-0.25, 3.25, -0.38, 0.72, leaves1]
  ];
  blobs.forEach(([x, y, z, r, mat]) => {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1), mat);
    m.position.set(x, y, z);
    m.scale.set(1.08, 0.82, 1.04);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  });

  // Tree planter ring at base
  addCyl(g, 0.52, 0.56, 0.08, 0, 0.04, 0, matStd('#7d776d', 0.8, 0.05), 18);
  g.position.set(it.x, it.y, it.z);
  if (it.ry) g.rotation.y = it.ry;
  return g;
}

/** Build a high-detail parametric 3D furniture group for a SceneItem modelslot. */
export function buildProceduralFurnitureMesh(it: SceneItem): THREE.Group | null {
  const kind = String(it.model || '').toLowerCase().trim();
  let group: THREE.Group | null = null;
  if (kind === 'bed') group = buildBedMesh(it.w, it.h, it.d);
  else if (kind === 'wardrobe') group = buildWardrobeMesh(it.w, it.h, it.d);
  else if (kind === 'sofa') group = buildSofaMesh(it.w, it.h, it.d);
  else if (kind === 'coffee table') group = buildCoffeeTableMesh(it.w, it.h, it.d);
  else if (kind === 'dining table') group = buildDiningTableMesh(it.w, it.h, it.d);
  else if (kind === 'chair') group = buildChairMesh(it.w, it.h, it.d);
  else if (kind === 'refrigerator') group = buildRefrigeratorMesh(it.w, it.h, it.d);
  else if (kind === 'bathtub') group = buildBathtubMesh(it.w, it.h, it.d);
  else if (kind === 'toilet') group = buildToiletMesh(it.w, it.h, it.d);
  else if (kind === 'potted plant') group = buildPottedPlantMesh(it.w, it.h, it.d);
  else if (kind === 'car') group = buildCarMesh(it.w, it.h, it.d);

  if (!group) return null;
  group.position.set(it.x, it.y - it.h / 2, it.z);
  if (it.ry) group.rotation.y = it.ry;
  return group;
}

