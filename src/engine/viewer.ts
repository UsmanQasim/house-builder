/* ForthHome 3D viewer — modern Three.js (TypeScript, ES modules).
 * PBR materials, physical sky + PMREM environment lighting, soft shadows,
 * SSAO + bloom postprocessing, day/night toggle, orbit + first-person walk. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { describeHouse, PR } from './house3d.js';
import type { CollisionBox, Layout, SceneDescription, SceneItem, Spec } from './types.js';

/* ---------- procedural PBR fallback textures (offline-safe) ---------- */
const S = 512;
function mkCanvas(draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = S;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function rnd(a: number, b: number): number { return a + Math.random() * (b - a); }
function tex(kind: string): THREE.CanvasTexture {
  if (kind === 'wood') return mkCanvas(g => { for (let y = 0; y < S; y += 48) { const v = rnd(150, 195); g.fillStyle = `rgb(${v},${v - 8},${v - 18})`; g.fillRect(0, y, S, 48);
    g.fillStyle = 'rgba(40,30,20,.5)'; g.fillRect(0, y, S, 2); g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, y + 2, S, 2);
    for (let k = 0; k < 26; k++) { g.strokeStyle = `rgba(70,50,35,${rnd(.05, .16)})`; g.lineWidth = rnd(.5, 1.5); g.beginPath(); const yy = y + rnd(4, 44); g.moveTo(0, yy); g.bezierCurveTo(S / 3, yy + rnd(-3, 3), 2 * S / 3, yy + rnd(-3, 3), S, yy + rnd(-4, 4)); g.stroke(); } } });
  if (kind === 'tile' || kind === 'marble') return mkCanvas(g => { const ts = kind === 'tile' ? 128 : S; g.fillStyle = '#dadada'; g.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += ts) for (let y = 0; y < S; y += ts) { const v = rnd(205, 240); g.fillStyle = `rgb(${v},${v},${v - 3})`; g.fillRect(x + 2, y + 2, ts - 4, ts - 4);
      if (kind === 'marble') for (let k = 0; k < 6; k++) { g.strokeStyle = `rgba(150,150,160,${rnd(.05, .2)})`; g.lineWidth = rnd(.5, 2); g.beginPath(); g.moveTo(rnd(0, S), 0); g.bezierCurveTo(rnd(0, S), S / 3, rnd(0, S), 2 * S / 3, rnd(0, S), S); g.stroke(); } }
    if (kind === 'tile') { g.strokeStyle = '#9a9a9a'; g.lineWidth = 4; for (let i = 0; i <= S; i += ts) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); } } });
  if (kind === 'brick') return mkCanvas(g => { g.fillStyle = '#cac6bf'; g.fillRect(0, 0, S, S); const bh = 36, bw = 86;
    for (let r = 0, row = 0; r < S; r += bh, row++) { const off = (row % 2) * bw / 2; for (let x = -bw; x < S; x += bw) { const v = rnd(120, 175); g.fillStyle = `rgb(${v},${v - 18},${v - 30})`; g.fillRect(x + off + 3, r + 3, bw - 6, bh - 6); } } });
  if (kind === 'siding') return mkCanvas(g => { for (let y = 0; y < S; y += 34) { const v = rnd(185, 210); g.fillStyle = `rgb(${v},${v},${v - 6})`; g.fillRect(0, y, S, 34); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, y + 30, S, 4); } });
  if (kind === 'shingle') return mkCanvas(g => { g.fillStyle = '#7d7d80'; g.fillRect(0, 0, S, S); const sh = 30, sw = 52;
    for (let r = 0, row = 0; r < S; r += sh, row++) { const off = (row % 2) * sw / 2; for (let x = -sw; x < S; x += sw) { const v = rnd(95, 140); g.fillStyle = `rgb(${v},${v},${v + 4})`; g.fillRect(x + off + 1, r + 1, sw - 2, sh + 6); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + off + 1, r + sh + 4, sw - 2, 3); } } });
  if (kind === 'carpet') return mkCanvas(g => { g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, S, S); for (let k = 0; k < 9000; k++) { g.fillStyle = `rgba(${rnd(150, 210)},${rnd(150, 210)},${rnd(150, 210)},.4)`; g.fillRect(Math.random() * S, Math.random() * S, 2, 2); } });
  if (kind === 'concrete') return mkCanvas(g => { g.fillStyle = '#c2c2c0'; g.fillRect(0, 0, S, S); for (let k = 0; k < 5000; k++) { g.fillStyle = `rgba(120,120,118,${rnd(0, .18)})`; g.fillRect(Math.random() * S, Math.random() * S, rnd(1, 3), rnd(1, 3)); } for (let c2 = 0; c2 < 5; c2++) { g.strokeStyle = 'rgba(90,90,88,.25)'; g.beginPath(); g.moveTo(rnd(0, S), 0); g.lineTo(rnd(0, S), S); g.stroke(); } });
  if (kind === 'grass') return mkCanvas(g => { g.fillStyle = '#5f8a4a'; g.fillRect(0, 0, S, S); for (let k = 0; k < 14000; k++) { g.strokeStyle = `rgba(${rnd(50, 90)},${rnd(110, 160)},${rnd(45, 80)},.7)`; g.lineWidth = 1; const x = Math.random() * S, y = Math.random() * S; g.beginPath(); g.moveTo(x, y); g.lineTo(x + rnd(-1, 1), y - rnd(3, 6)); g.stroke(); } });
  if (kind === 'membrane') return mkCanvas(g => { g.fillStyle = '#43464c'; g.fillRect(0, 0, S, S); for (let k = 0; k < 3000; k++) { g.fillStyle = `rgba(30,32,36,${rnd(0, .3)})`; g.fillRect(Math.random() * S, Math.random() * S, 2, 2); } for (let y = 0; y < S; y += 86) { g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(0, y, S, 3); } });
  return mkCanvas(g => { g.fillStyle = '#ededeb'; g.fillRect(0, 0, S, S); for (let k = 0; k < 2600; k++) { g.fillStyle = `rgba(150,150,150,${rnd(0, .08)})`; g.fillRect(Math.random() * S, Math.random() * S, 3, 3); } }); // plaster
}
const ROUGH: Record<string, number> = { wood: 0.55, tile: 0.25, marble: 0.2, brick: 0.92, siding: 0.75, shingle: 0.85, carpet: 1, concrete: 0.9, grass: 1, plaster: 0.9, membrane: 0.7 };
const METAL: Record<string, number> = { tile: 0.02, marble: 0.05 };

interface MatEntry { mat: THREE.MeshStandardMaterial; rep: number; }
type TexState = THREE.Texture | 'pending' | 'failed';

export class Viewer {
  container: HTMLElement;
  mode: 'orbit' | 'walk' = 'orbit';
  floor = 0; cut = false; noclip = false; night = false;
  keys: Record<string, boolean> = {};
  private texCache: Record<string, THREE.CanvasTexture> = {};
  private matCache: Record<string, THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial> = {};
  private matsByKind: Record<string, MatEntry[]> = {};
  private realTex: Record<string, TexState> = {};
  private realNor: Record<string, THREE.Texture> = {};
  private realRough: Record<string, THREE.Texture> = {};
  private coll: CollisionBox[] = [];
  private floorGroups: Record<number, THREE.Group> = {};
  private ceil: THREE.Mesh[] = [];
  private roof: THREE.Group | null = null;
  private root: THREE.Group | null = null;
  private modelCache: Record<string, THREE.Object3D | 'failed'> = {};
  private mq: Record<string, ((m: THREE.Object3D | null) => void)[] | null> = {};
  private slotMeshes: Record<string, THREE.Object3D[]> = {};
  private modelSlots: { it: SceneItem; group: THREE.Group }[] = [];
  private interiorLights: THREE.PointLight[] = [];
  private dead = false;
  desc!: SceneDescription;
  cfg!: Spec;
  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  private sky!: Sky;
  private sunPos = new THREE.Vector3();
  private hemi!: THREE.HemisphereLight;
  private amb!: THREE.AmbientLight;
  private sun!: THREE.DirectionalLight;
  private moon!: THREE.DirectionalLight;
  private pmrem!: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private composer: EffectComposer | null = null;
  private ssao: SSAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private orbit!: OrbitControls;
  private pl!: PointerLockControls;
  private clock!: THREE.Clock;

  constructor(container: HTMLElement) {
    this.container = container;
    try { this.init(); } catch (e) { this.err('3D init failed: ' + (e as Error).message); }
  }
  private err(m: string): void {
    const d = (this.container.querySelector('.gl-err') as HTMLElement) || document.createElement('div');
    d.className = 'gl-err'; d.textContent = m;
    d.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;color:#ffb4b4;background:#161019;padding:20px;font:13px Inter,sans-serif;z-index:9';
    this.container.appendChild(d);
  }
  private t(k: string): THREE.CanvasTexture { return this.texCache[k] || (this.texCache[k] = tex(k)); }

  private applyReal(kind: string, e: MatEntry): void {
    const tx = this.realTex[kind];
    if (!tx || tx === 'failed' || tx === 'pending' || !e.mat) return;
    const cl = (src: THREE.Texture) => { const q = src.clone(); q.needsUpdate = true; q.wrapS = q.wrapT = THREE.RepeatWrapping; q.repeat.set(e.rep, e.rep); q.anisotropy = 8; return q; };
    const t = cl(tx); t.colorSpace = THREE.SRGBColorSpace;
    e.mat.map = t;
    if (this.realNor[kind]) { const n = cl(this.realNor[kind]); n.colorSpace = THREE.NoColorSpace; e.mat.normalMap = n; e.mat.normalScale = new THREE.Vector2(0.8, 0.8); e.mat.bumpMap = null; }
    else { e.mat.bumpMap = t; e.mat.bumpScale = 0.04; }
    if (this.realRough[kind]) { const r = cl(this.realRough[kind]); r.colorSpace = THREE.NoColorSpace; e.mat.roughnessMap = r; }
    e.mat.needsUpdate = true;
  }
  private register(kind: string, mat: THREE.MeshStandardMaterial, rep: number): void {
    const m = mat as THREE.MeshStandardMaterial & { _reg?: boolean };
    if (!m || m._reg) return; m._reg = true;
    (this.matsByKind[kind] = this.matsByKind[kind] || []).push({ mat, rep });
    const tx = this.realTex[kind];
    if (tx && tx !== 'failed' && tx !== 'pending') this.applyReal(kind, { mat, rep });
  }
  private mat(item: SceneItem): THREE.Material {
    if (item.t === 'glass') return this.matCache.glass || (this.matCache.glass = new THREE.MeshPhysicalMaterial({
      color: 0xdaeefc, transparent: true, opacity: 0.22, roughness: 0.04, metalness: 0, transmission: 0.6, ior: 1.5, envMapIntensity: 1.8, side: THREE.DoubleSide }));
    if (item.t === 'lamp') return this.matCache.lamp || (this.matCache.lamp = new THREE.MeshStandardMaterial({ color: 0xffe9c0, emissive: 0xffe2a8, emissiveIntensity: 0.9, roughness: 0.5 }));
    if (item.t === 'hedge' || item.t === 'shrub') return this.matCache.hedge || (this.matCache.hedge = new THREE.MeshStandardMaterial({ color: 0x43743f, roughness: 1 }));
    if (item.t === 'curtain') {
      const key = 'curtain' + item.color;
      return this.matCache[key] || (this.matCache[key] = new THREE.MeshStandardMaterial({ color: new THREE.Color(item.color), roughness: 0.95, side: THREE.DoubleSide }));
    }
    const key = (item.tex || 's') + item.color;
    const rep = (item.t === 'floor' || item.t === 'underlay') ? Math.max(1, Math.round(Math.max(item.w, item.d) / 1.5))
      : (item.t === 'ground' ? 8 : (item.tex === 'brick' || item.tex === 'siding' || item.tex === 'shingle') ? Math.max(2, Math.round(Math.max(item.w, item.d) / 1.5)) : 2);
    if (this.matCache[key]) { if (item.tex) this.register(item.tex, this.matCache[key] as THREE.MeshStandardMaterial, rep); return this.matCache[key]; }
    const o: THREE.MeshStandardMaterialParameters = {
      color: new THREE.Color(item.color),
      roughness: item.tex ? (ROUGH[item.tex] ?? 0.8) : 0.7,
      metalness: item.tex ? (METAL[item.tex] ?? 0.02) : 0.05
    };
    if (item.tex) { const t = this.t(item.tex).clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); o.map = t; o.bumpMap = t; o.bumpScale = 0.04; }
    const mat = new THREE.MeshStandardMaterial(o);
    this.matCache[key] = mat;
    if (item.tex) this.register(item.tex, mat, rep);
    return mat;
  }
  private enhance(): void {
    Object.keys(this.matsByKind).forEach(kind => {
      if (this.realTex[kind]) return;
      this.realTex[kind] = 'pending';
      const TL = new THREE.TextureLoader();
      const ap = () => (this.matsByKind[kind] || []).forEach(e => this.applyReal(kind, e));
      TL.load('/api/texture?name=' + kind, tx => { this.realTex[kind] = tx; ap();
        TL.load('/api/texture?name=' + kind + '&map=nor', n => { this.realNor[kind] = n; ap(); }, undefined, () => {});
        TL.load('/api/texture?name=' + kind + '&map=rough', r => { this.realRough[kind] = r; ap(); }, undefined, () => {});
      }, undefined, () => { this.realTex[kind] = 'failed'; });
    });
  }

  private init(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight || 400;
    this.camera = new THREE.PerspectiveCamera(56, w / h, 0.1, 2000);
    this.camera.position.set(20, 18, 26);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.sky = new Sky(); this.sky.scale.setScalar(4500); this.scene.add(this.sky);
    this.hemi = new THREE.HemisphereLight(0xdcecff, 0x70665a, 0.5); this.scene.add(this.hemi);
    this.amb = new THREE.AmbientLight(0xffffff, 0.12); this.scene.add(this.amb);
    this.sun = new THREE.DirectionalLight(0xfff1d8, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera; sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 240;
    this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.03; this.sun.shadow.radius = 4;
    this.scene.add(this.sun);
    this.moon = new THREE.DirectionalLight(0x8fa8d8, 0); this.moon.position.set(-30, 50, -20); this.scene.add(this.moon);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.applyDayNight();

    try {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.ssao = new SSAOPass(this.scene, this.camera, w, h);
      this.ssao.kernelRadius = 0.32; this.ssao.minDistance = 0.0008; this.ssao.maxDistance = 0.08;
      this.composer.addPass(this.ssao);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.14, 0.6, 0.92);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    } catch { this.composer = null; }

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true; this.orbit.maxPolarAngle = Math.PI * 0.49; this.orbit.target.set(0, 2, 0);
    this.pl = new PointerLockControls(this.camera, this.renderer.domElement);
    this.scene.add(this.plObject());

    this.container.addEventListener('click', () => { if (this.mode === 'walk' && this.pl) this.pl.lock(); });
    window.addEventListener('keydown', e => { this.keys[e.code] = true; if (e.code === 'KeyC' && this.mode === 'walk') this.noclip = !this.noclip; });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    window.addEventListener('resize', () => this._resize());
    this.clock = new THREE.Clock();
    this.animate();
  }
  private plObject(): THREE.Object3D {
    const p = this.pl as unknown as { object?: THREE.Object3D; getObject?: () => THREE.Object3D };
    return p.object || (p.getObject ? p.getObject() : this.camera);
  }

  setDayNight(night: boolean): void { this.night = night; this.applyDayNight(); }
  private applyDayNight(): void {
    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;
    if (!this.night) {
      const phi = THREE.MathUtils.degToRad(90 - 32), theta = THREE.MathUtils.degToRad(135);
      this.sunPos.setFromSphericalCoords(1, phi, theta);
      u.sunPosition.value.copy(this.sunPos);
      u.turbidity.value = 6; u.rayleigh.value = 1.8; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
      this.sun.position.copy(this.sunPos).multiplyScalar(90);
      this.sun.intensity = 2.4; this.sun.color.set(0xfff1d8);
      this.hemi.intensity = 0.5; this.amb.intensity = 0.12; this.moon.intensity = 0;
      this.renderer.toneMappingExposure = 0.85;
      this.scene.fog = new THREE.Fog(0xcfe0ee, 60, 260);
      this.interiorLights.forEach(l => { l.intensity = 0; });
      if (this.matCache.lamp) (this.matCache.lamp as THREE.MeshStandardMaterial).emissiveIntensity = 0.35;
      if (this.bloom) this.bloom.strength = 0.14;
    } else {
      const phi = THREE.MathUtils.degToRad(90 + 4), theta = THREE.MathUtils.degToRad(200);
      this.sunPos.setFromSphericalCoords(1, phi, theta);
      u.sunPosition.value.copy(this.sunPos);
      u.turbidity.value = 3; u.rayleigh.value = 0.12; u.mieCoefficient.value = 0.002; u.mieDirectionalG.value = 0.7;
      this.sun.intensity = 0;
      this.moon.intensity = 0.35;
      this.hemi.intensity = 0.06; this.amb.intensity = 0.05;
      this.renderer.toneMappingExposure = 0.7;
      this.scene.fog = new THREE.Fog(0x0a1020, 40, 200);
      this.interiorLights.forEach(l => { l.intensity = (l.userData.nightIntensity as number) || 12; });
      if (this.matCache.lamp) (this.matCache.lamp as THREE.MeshStandardMaterial).emissiveIntensity = 1.6;
      if (this.bloom) this.bloom.strength = 0.45;
    }
    try {
      const skyScene = new THREE.Scene();
      const s = this.sky.clone(); s.material = this.sky.material; skyScene.add(s);
      const rt = this.pmrem.fromScene(skyScene, 0.02);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = this.night ? 0.25 : 0.9;
    } catch { /* env optional */ }
  }

  _resize(): void {
    if (!this.renderer) return;
    const w = this.container.clientWidth, h = this.container.clientHeight || 400;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
    if (this.ssao) this.ssao.setSize(w, h);
  }

  private treeMesh(it: SceneItem): THREE.Group {
    const g = new THREE.Group();
    const trunkH = it.h * 0.38;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, trunkH, 8), new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 }));
    trunk.position.y = trunkH / 2; trunk.castShadow = true; g.add(trunk);
    const fol = new THREE.MeshStandardMaterial({ color: new THREE.Color(it.color), roughness: 1 });
    const fol2 = new THREE.MeshStandardMaterial({ color: 0x4a8048, roughness: 1 });
    const s1 = new THREE.Mesh(new THREE.IcosahedronGeometry(it.w * 0.62, 1), fol); s1.position.y = trunkH + it.w * 0.5; s1.scale.y = 1.15; s1.castShadow = true; g.add(s1);
    const s2 = new THREE.Mesh(new THREE.IcosahedronGeometry(it.w * 0.44, 1), fol2); s2.position.set(it.w * 0.3, trunkH + it.w * 0.85, it.w * 0.12); s2.castShadow = true; g.add(s2);
    const s3 = new THREE.Mesh(new THREE.IcosahedronGeometry(it.w * 0.36, 1), fol2); s3.position.set(-it.w * 0.3, trunkH + it.w * 0.78, -it.w * 0.15); s3.castShadow = true; g.add(s3);
    g.position.set(it.x, it.y, it.z); g.rotation.y = it.ry || 0;
    return g;
  }
  private fg(f: number): THREE.Group {
    if (!this.floorGroups[f]) { const g = new THREE.Group(); this.root!.add(g); this.floorGroups[f] = g; }
    return this.floorGroups[f];
  }
  private geo(it: SceneItem): THREE.BufferGeometry {
    if (it.geo === 'cyl') return new THREE.CylinderGeometry(it.w / 2, it.w / 2, it.h, 18);
    if (it.geo === 'cone') return new THREE.ConeGeometry(it.w / 2, it.h, 16);
    if (it.geo === 'sphere') return new THREE.SphereGeometry(Math.max(it.w, it.d) / 2, 18, 14);
    return new THREE.BoxGeometry(it.w, it.h, it.d);
  }
  private loadModel(name: string, cb: (m: THREE.Object3D | null) => void): void {
    if (this.modelCache[name] === 'failed') return cb(null);
    if (this.modelCache[name]) return cb(this.modelCache[name] as THREE.Object3D);
    if (this.mq[name]) { this.mq[name]!.push(cb); return; }
    this.mq[name] = [cb];
    new GLTFLoader().load('/api/model?type=' + encodeURIComponent(name),
      g => { this.modelCache[name] = g.scene; const q = this.mq[name]!; this.mq[name] = null; q.forEach(c => c(g.scene)); },
      undefined,
      () => { this.modelCache[name] = 'failed'; const q = this.mq[name] || []; this.mq[name] = null; q!.forEach(c => c(null)); });
  }
  /* Strict slot fitting: the model must fit INSIDE the slot box on every axis —
   * no more oversized furniture clipping through walls. Degenerate models are rejected. */
  private tryModel(it: SceneItem, group: THREE.Group): void {
    this.loadModel(it.model!, proto => {
      if (!proto) return;
      try {
        const m = proto.clone(true);
        let bb = new THREE.Box3().setFromObject(m);
        const size = new THREE.Vector3(); bb.getSize(size);
        if (size.x < 0.001 || size.y < 0.001 || size.z < 0.001) return; // broken/degenerate mesh — keep procedural
        let sc = Math.min(it.w / size.x, it.d / size.z, (it.h * 1.15) / size.y);
        if (!isFinite(sc) || sc <= 0) return;
        if (sc > 3) sc = 3; // never blow tiny models up into monsters
        m.scale.setScalar(sc);
        bb = new THREE.Box3().setFromObject(m);
        const c = new THREE.Vector3(); bb.getCenter(c);
        m.position.set(it.x - c.x, (it.y - it.h / 2) - bb.min.y, it.z - c.z);
        if (it.ry) m.rotation.y = it.ry;
        let meshCount = 0;
        m.traverse(o => { if ((o as THREE.Mesh).isMesh) { meshCount++; o.castShadow = true; o.receiveShadow = true; } });
        if (!meshCount) return;
        group.add(m);
        (this.slotMeshes[it.slot!] || []).forEach(mesh => { mesh.visible = false; });
      } catch { /* keep procedural furniture */ }
    });
  }

  build(L: Layout, cfg: Spec): void {
    try {
      if (this.root) this.scene.remove(this.root);
      this.interiorLights.forEach(l => l.parent?.remove(l)); this.interiorLights = [];
      this.root = new THREE.Group(); this.scene.add(this.root);
      this.floorGroups = {}; this.ceil = []; this.roof = new THREE.Group(); this.root.add(this.roof);
      this.slotMeshes = {}; this.modelSlots = [];

      const d = describeHouse(L, cfg); this.desc = d; this.coll = d.collision;
      for (let i = 0; i < d.items.length; i++) {
        const it = d.items[i]; let m: THREE.Object3D;
        if (it.t === 'modelslot') { this.modelSlots.push({ it, group: it.floor >= 0 ? this.fg(it.floor) : this.root }); continue; }
        if (it.t === 'roofpitch') m = this.pyramid(it);
        else if (it.t === 'tree') m = this.treeMesh(it);
        else { const mesh = new THREE.Mesh(this.geo(it), this.mat(it)); mesh.position.set(it.x, it.y, it.z); if (it.ry) mesh.rotation.y = it.ry; m = mesh; }
        const cast = ['wall', 'furn', 'roof', 'roofpitch', 'trim', 'tree', 'door', 'plinth', 'hedge', 'shrub', 'curtain', 'art'].includes(it.t);
        m.castShadow = cast;
        m.receiveShadow = !['glass', 'lamp', 'tree', 'curtain'].includes(it.t);
        if (it.t === 'roof' || it.t === 'roofpitch') this.roof.add(m);
        else if (it.t === 'ceil') { m.userData.floor = it.floor; this.ceil.push(m as THREE.Mesh); this.root.add(m); }
        else if (it.floor >= 0) this.fg(it.floor).add(m);
        else this.root.add(m);
        if (it.slot) (this.slotMeshes[it.slot] = this.slotMeshes[it.slot] || []).push(m);
        if (it.t === 'lamp' && it.floor >= 0) {
          const pt = new THREE.PointLight(0xffd9a0, 0, 7, 2);
          pt.position.set(it.x, it.y - 0.25, it.z);
          pt.userData.nightIntensity = 14;
          this.interiorLights.push(pt);
          this.fg(it.floor).add(pt);
        }
      }
      this.modelSlots.forEach(ms => this.tryModel(ms.it, ms.group));
      this.enhance();
      this.applyDayNight();
      this.cfg = cfg; this.floor = 0; this.spawn(); this.frame(); this.vis();
      const e = this.container.querySelector('.gl-err'); if (e) e.remove();
    } catch (err) { this.err('3D build failed: ' + (err as Error).message); }
  }
  private pyramid(it: SceneItem): THREE.Mesh {
    const hw = it.w / 2, hd = it.d / 2, H = it.h;
    const v = [-hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd, 0, H, 0], idx = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4];
    const uv = [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 1];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const o: THREE.MeshStandardMaterialParameters = { color: new THREE.Color(it.color), roughness: 0.9, side: THREE.DoubleSide };
    if (it.tex) { const t = this.t(it.tex).clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4); o.map = t; o.bumpMap = t; o.bumpScale = 0.05; }
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial(o));
    m.position.set(it.x, it.y, it.z);
    return m;
  }
  private spawn(): void { if (!this.pl) return; const sp = this.desc.spawn; this.plObject().position.set(sp.x, this.floor * (this.desc.wallH + this.desc.slab) + this.desc.eye, sp.z); this.camera.rotation.set(0, 0, 0); }
  private frame(): void { const span = Math.max(this.desc.plotW, this.desc.plotD), h = this.desc.wallH * this.desc.floors * 0.4; this.camera.position.set(span * 0.95, span * 0.8, span * 1.15); this.camera.lookAt(0, h, 0); if (this.orbit) { this.orbit.target.set(0, h, 0); this.orbit.update(); } }
  setMode(m: 'orbit' | 'walk'): void { this.mode = m; if (this.orbit) this.orbit.enabled = (m === 'orbit'); if (m === 'walk') this.spawn(); else if (this.pl && this.pl.isLocked) this.pl.unlock(); this.vis(); if (m === 'orbit') this.frame(); }
  setFloor(f: number): void { this.floor = f; if (this.mode === 'walk') this.spawn(); this.vis(); }
  setCutaway(b: boolean): void { this.cut = b; this.vis(); }

  /** Capture the exact canonical 3D design so AI renders can stay tied to the
   * project instead of inventing an unrelated house from text alone. */
  captureDataURL(): string {
    if (!this.renderer || !this.scene || !this.camera) throw new Error('The 3D scene is not ready yet.');
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  /** Export the generated house as a binary glTF asset. The export contains
   * the procedural architecture, furniture and embedded materials currently
   * loaded in the scene, without the editor lights/sky. */
  async exportGLB(): Promise<Blob> {
    if (!this.root) throw new Error('Generate a house before exporting it.');
    const project = this.root.clone(true);
    project.name = 'ForthHome_Project';
    project.userData = {
      generator: 'ForthHome',
      units: 'metres',
      floors: this.desc?.floors || 1,
      exportedAt: new Date().toISOString()
    };
    project.updateMatrixWorld(true);
    const binary = await new Promise<ArrayBuffer>((resolve, reject) => {
      new GLTFExporter().parse(
        project,
        result => {
          if (result instanceof ArrayBuffer) resolve(result);
          else reject(new Error('The exporter returned JSON instead of a binary asset.'));
        },
        error => reject(error instanceof Error ? error : new Error(String(error))),
        { binary: true, onlyVisible: false, maxTextureSize: 2048 }
      );
    });
    return new Blob([binary], { type: 'model/gltf-binary' });
  }

  private vis(): void {
    const ob = this.mode === 'orbit';
    if (this.roof) this.roof.visible = ob && !this.cut;
    this.ceil.forEach(c => { c.visible = ob && !this.cut; });
    Object.keys(this.floorGroups).forEach(k => { this.floorGroups[+k].visible = (ob && this.cut) ? (+k <= this.floor) : true; });
  }
  private animate(): void {
    requestAnimationFrame(() => this.animate());
    if (this.dead) return;
    try {
      const dt = Math.min(this.clock.getDelta(), 0.05);
      if (this.mode === 'walk' && this.pl && this.pl.isLocked) {
        const sp = ((this.keys.ShiftLeft || this.keys.ShiftRight) ? 6.5 : 3.4) * dt;
        const fwd = (this.keys.KeyW || this.keys.ArrowUp ? 1 : 0) - (this.keys.KeyS || this.keys.ArrowDown ? 1 : 0);
        const str = (this.keys.KeyD || this.keys.ArrowRight ? 1 : 0) - (this.keys.KeyA || this.keys.ArrowLeft ? 1 : 0);
        if (fwd || str) {
          const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
          const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
          let mx = dir.x * fwd + right.x * str, mz = dir.z * fwd + right.z * str;
          const l = Math.hypot(mx, mz) || 1; mx = mx / l * sp; mz = mz / l * sp;
          const o = this.plObject(), bx = this.coll, fl = this.floor;
          let nx = o.position.x + mx; if (!this.noclip && this.hit(nx, o.position.z, bx, fl)) nx = o.position.x;
          let nz = o.position.z + mz; if (!this.noclip && this.hit(nx, nz, bx, fl)) nz = o.position.z;
          o.position.x = nx; o.position.z = nz; o.position.y = fl * (this.desc.wallH + this.desc.slab) + this.desc.eye;
        }
      } else if (this.orbit) this.orbit.update();
      if (this.composer) this.composer.render();
      else this.renderer.render(this.scene, this.camera);
    } catch (e) { this.dead = true; this.err('3D render error: ' + (e as Error).message); }
  }
  private hit(x: number, z: number, b: CollisionBox[], fl: number): boolean {
    for (let i = 0; i < b.length; i++) { const w = b[i]; if (w.floor === fl && x > w.minX - PR && x < w.maxX + PR && z > w.minZ - PR && z < w.maxZ + PR) return true; }
    return false;
  }
}

export default Viewer;
