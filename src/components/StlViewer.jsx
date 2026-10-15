import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import {
  saveWorkspaceModel,
  loadWorkspaceModel,
  saveWorkspaceSettings,
} from '../utils/workspaceCache';
import {
  saveActiveQuote,
  loadActiveQuote,
  clearActiveQuote,
} from '../utils/quoteStore';
import {
  computeFaceData,
  evaluatePose,
  findBestOrientation,
  isOverhangNormal,
  quatMul,
  orientedBBox,
  transformFaceData,
  rotateVecByQuat,
  IDENTITY_QUAT,
  PRINT_PROFILES,
  MATERIALS,
  calculateSlicerMetrics,
  computeSupportWeight,
} from './stlAnalysis';
import UpiPaymentQr from './UpiPaymentQr';
import { buildShellExplodableGroup, analyzeMeshShells, applyLayerSwapVertexColors, updateExplodableGroup, getPartNamesForDesign } from '../utils/explodableAssembly';
import { PROCEDURAL_DESIGNS, createFDMLayerBumpTexture } from '../utils/physicalAssemblies';
import { detectAutoBrim, BRIM_WEIGHT_G, LAYER_SWAP_FEE_INR, exceedsBuildVolume } from '../utils/pricingEngine';
import { resolvePixelRatio, attachTouchScrollLock } from '../utils/viewerTouchControls';

const SUPPORT_GRID_MM = 6;
const SUPPORT_PILLAR_COLOR = 0x10b981;
const SUPPORT_BRIM_COLOR = 0x065f46;

if (typeof THREE !== 'undefined' && THREE.BufferGeometry && THREE.BufferGeometry.prototype) {
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
}

const STANDARD_BUILD_LIMIT = { x: 180, y: 180, z: 180 };
const CONCRETE_GREY = 0x8E9296;
const SUPPORT_CORAL = 0xFF5147; // bold red/coral for faces that require supports

export const MATERIAL_PRESETS = [
  { id: 'concrete', name: 'Concrete Grey', hex: 0x788292, bg: '#788292', roughness: 0.52, metalness: 0.08 },
  { id: 'carbon', name: 'Carbon Black', hex: 0x1E2024, bg: '#1E2024', roughness: 0.55, metalness: 0.08 },
  { id: 'orange', name: 'Signal Orange', hex: 0xEA580C, bg: '#EA580C', roughness: 0.48, metalness: 0.06 },
  { id: 'emerald', name: 'Cyber Emerald', hex: 0x2E7D32, bg: '#2E7D32', roughness: 0.48, metalness: 0.06 },
  { id: 'white', name: 'Arctic White', hex: 0xE5E7EB, bg: '#E5E7EB', roughness: 0.45, metalness: 0.05 },
  { id: 'cyan', name: 'Translucent Cyan', hex: 0x0284C7, bg: '#0284C7', roughness: 0.46, metalness: 0.08 },
  { id: 'crimson', name: 'Crimson Red', hex: 0xDC2626, bg: '#DC2626', roughness: 0.48, metalness: 0.06 },
  { id: 'navy', name: 'Cobalt Navy', hex: 0x1D4ED8, bg: '#1D4ED8', roughness: 0.48, metalness: 0.08 },
  { id: 'gold', name: 'Silk Gold', hex: 0xCA8A04, bg: '#CA8A04', roughness: 0.42, metalness: 0.35 },
  { id: 'purple', name: 'Cyber Purple', hex: 0x7E22CE, bg: '#7E22CE', roughness: 0.46, metalness: 0.08 },
  { id: 'military', name: 'Tactical Olive', hex: 0x3F6212, bg: '#3F6212', roughness: 0.52, metalness: 0.06 },
  { id: 'silver', name: 'Titanium Silver', hex: 0x94A3B8, bg: '#94A3B8', roughness: 0.38, metalness: 0.45 },
];

/**
 * Returns a high-contrast filament preset for multi-part (No-AMS) assemblies
 * ensuring accent parts (snap-fit lids, bezels, ramp deflectors) stand out visually.
 */
export const getContrastPreset = (primaryName) => {
  const contrastMap = {
    'Concrete Grey': 'Signal Orange',
    'Carbon Black': 'Signal Orange',
    'Signal Orange': 'Carbon Black',
    'Cyber Emerald': 'Carbon Black',
    'Arctic White': 'Signal Orange',
    'Translucent Cyan': 'Carbon Black',
    'Crimson Red': 'Arctic White',
    'Cobalt Navy': 'Signal Orange',
    'Silk Gold': 'Carbon Black',
    'Cyber Purple': 'Cyber Emerald',
    'Tactical Olive': 'Signal Orange',
    'Titanium Silver': 'Signal Orange',
  };
  const targetName = contrastMap[primaryName] || 'Signal Orange';
  return MATERIAL_PRESETS.find((p) => p.name === targetName) || MATERIAL_PRESETS[2];
};

/**
 * Print space (STL-native, +Z up — the slicer frame used by the analysis) is
 * mapped to scene space (+Y up) with a fixed -90° pitch about X, so gravity in
 * the analysis always matches "down" on screen.
 */
const buildPrintToSceneQuat = () =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

const toThreeQuat = (q) => new THREE.Quaternion(q.x, q.y, q.z, q.w);

/**
 * Write per-face vertex colors: Concrete Grey for printable faces, bold
 * Red/Coral for overhang faces evaluated under the given print-space
 * orientation. Geometry from STLLoader is non-indexed, so the three vertices
 * of each triangle share one flat face color.
 */
const applySupportColors = (geometry, faceData, printQuat) => {
  const grey = new THREE.Color(CONCRETE_GREY);
  const coral = new THREE.Color(SUPPORT_CORAL);
  const colors = new Float32Array(faceData.count * 9);
  for (let f = 0; f < faceData.count; f++) {
    const r = rotateVecByQuat(
      {
        x: faceData.normals[f * 3],
        y: faceData.normals[f * 3 + 1],
        z: faceData.normals[f * 3 + 2],
      },
      printQuat,
    );
    const c = isOverhangNormal(r.z) ? coral : grey;
    for (let k = 0; k < 3; k++) {
      colors[f * 9 + k * 3] = c.r;
      colors[f * 9 + k * 3 + 1] = c.g;
      colors[f * 9 + k * 3 + 2] = c.b;
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
};

/** Text sprite label for plate measurement ticks (canvas texture). */
const makeTextSprite = (text, color = '#FF6500') => {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 30px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(30, 7.5, 1);
  return sp;
};

/**
 * Boundary measuring group for the 180×180 plate: orange border lines,
 * grey coordinate ticks every 15 mm, laser-green calibration crosshairs
 * at the corners, and 180MM edge labels.
 */
const buildMeasureGroup = () => {
  const group = new THREE.Group();
  const H = 93;
  const y = 0.25;

  const edgePts = [];
  const corners = [[-H, -H], [H, -H], [H, H], [-H, H]];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    edgePts.push(a[0], y, a[1], b[0], y, b[1]);
  }
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edgePts), 3));
  group.add(new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
    color: 0xff6500, transparent: true, opacity: 0.55,
  })));

  const tickPts = [];
  for (let d = -75; d <= 75; d += 15) {
    if (d === 0) continue;
    tickPts.push(d, y, -H, d, y, -H + 4, d, y, H, d, y, H - 4);
    tickPts.push(-H, y, d, -H + 4, y, d, H, y, d, H - 4, y, d);
  }
  const tickGeo = new THREE.BufferGeometry();
  tickGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tickPts), 3));
  group.add(new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({
    color: 0x9aa0a8, transparent: true, opacity: 0.65,
  })));

  const crossPts = [];
  for (const [cx, cz] of corners) {
    crossPts.push(cx - 5, y, cz, cx + 5, y, cz, cx, y, cz - 5, cx, y, cz + 5);
  }
  const crossGeo = new THREE.BufferGeometry();
  crossGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(crossPts), 3));
  group.add(new THREE.LineSegments(crossGeo, new THREE.LineBasicMaterial({
    color: 0x00ff66, transparent: true, opacity: 0.9,
  })));

  const labelN = makeTextSprite('180MM');
  labelN.position.set(0, 3, -H);
  const labelS = makeTextSprite('180MM');
  labelS.position.set(0, 3, H);
  const labelW = makeTextSprite('180MM');
  labelW.position.set(-H, 3, 0);
  const labelE = makeTextSprite('180MM');
  labelE.position.set(H, 3, 0);
  group.add(labelN, labelS, labelW, labelE);

  // Vertical height scale rail at corner [-H, -H]
  const vertPts = [
    -H, 0, -H, -H, 180, -H,
    -H, 0, -H, -H + 6, 0, -H,
    -H, 18, -H, -H + 6, 18, -H,
    -H, 90, -H, -H + 6, 90, -H,
    -H, 180, -H, -H + 6, 180, -H,
  ];
  const vertGeo = new THREE.BufferGeometry();
  vertGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertPts), 3));
  group.add(new THREE.LineSegments(vertGeo, new THREE.LineBasicMaterial({
    color: 0x00ff66, transparent: true, opacity: 0.65,
  })));

  const label0 = makeTextSprite('0', '#00FF66');
  label0.position.set(-H - 6, 2, -H);
  const label18 = makeTextSprite('18mm', '#00FF66');
  label18.position.set(-H - 8, 18, -H);
  const label180 = makeTextSprite('180mm', '#00FF66');
  label180.position.set(-H - 10, 180, -H);
  const labelPlate = makeTextSprite('180x180mm', '#00FF66');
  labelPlate.position.set(0, 2, H + 8);
  group.add(label0, label18, label180, labelPlate);

  return group;
};

/** Dispose a helper group (geometries, materials, sprite textures). */
const disposeObjectGroup = (group) => {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
};
const seatMeshOnPlate = (mesh) => {
  mesh.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(mesh);
  mesh.position.x -= (box.min.x + box.max.x) / 2;
  mesh.position.z -= (box.min.z + box.max.z) / 2;
  mesh.position.y -= box.min.y;
  mesh.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(mesh);
  return box;
};

/**
 * Dynamic Camera Auto-Framing: positions PerspectiveCamera and OrbitControls.target
 * based on the object's bounding sphere with generous padding (>20% margin) to prevent
 * clipping in any aspect ratio (minimum distance 210mm).
 */
const fitCameraToObject = (camera, controls, object, coverage = 0.70) => {
  if (!camera || !controls || !object) return;
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const center = sphere.center;
  const radius = Math.max(sphere.radius, 15);

  const fovRad = THREE.MathUtils.degToRad(camera.fov || 45);
  const aspect = camera.aspect || 1;
  const horizontalFov = 2 * Math.atan(Math.tan(fovRad / 2) * aspect);

  const targetRadius = radius / Math.max(0.1, Math.min(coverage, 0.70));
  const distVertical = targetRadius / Math.sin(fovRad / 2);
  const distHorizontal = targetRadius / Math.sin(horizontalFov / 2);
  const distance = Math.max(distVertical, distHorizontal, radius * 2.6, 210);

  const dir = new THREE.Vector3(0.75, 0.65, 0.85).normalize();
  controls.target.set(0, center.y, 0);
  camera.position.set(dir.x * distance, center.y + dir.y * distance, dir.z * distance);
  camera.near = 0.5;
  camera.far = 4000;
  camera.updateProjectionMatrix();
  camera.lookAt(0, center.y, 0);
  controls.update();
};

export default function StlViewer() {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const currentMeshRef = useRef(null);

  const [fileName, setFileName] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [quoteData, setQuoteData] = useState(null);
  const [hasActiveModel, setHasActiveModel] = useState(false);
  // meshReady is true only while a parsed mesh is actually mounted in the 3D
  // scene. Quote badge + receipt + telemetry stay in standby until the mesh,
  // the Loaded badge and the price receipt can appear in the same tick.
  const [meshReady, setMeshReady] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

  // Mobile workspace tab (< lg). Desktop shows all three columns at once and
  // ignores this entirely. 'model' = .STL/filament, 'slicer' = profile + add-ons,
  // 'quote' = itemized receipt + payment.
  const [mobileTab, setMobileTab] = useState('model');
  // Anchor for the mobile cockpit: lets a tab / bottom-bar jump scroll the
  // workbench back under the sticky header.
  const workbenchRef = useRef(null);
  const goToMobileTab = useCallback((tab) => {
    setMobileTab(tab);
    if (typeof window === 'undefined' || !workbenchRef.current) return;
    if (window.innerWidth < 1024) {
      const rect = workbenchRef.current.getBoundingClientRect();
      window.scrollTo({ top: rect.top + window.scrollY - 60, behavior: 'smooth' });
    }
  }, []);

  // Interactive Material & Display Mode State
  const [selectedMaterialType, setSelectedMaterialType] = useState('pla'); // 'pla' | 'petg' | 'tpu'
  const [selectedProfile, setSelectedProfile] = useState('standard'); // 'draft' | 'standard' | 'heavy-duty'
  const [infillPercent, setInfillPercent] = useState(20); // 10% to 100% infill density
  const [layerHeightMm, setLayerHeightMm] = useState(null); // null = profile default, else 0.08-0.28 override
  const [partQuantity, setPartQuantity] = useState(1);
  const [selectedMaterial, setSelectedMaterial] = useState('Concrete Grey');
  const [selectedAccentMaterial, setSelectedAccentMaterial] = useState('Signal Orange');
  const [activePlate, setActivePlate] = useState('base'); // 'base' | 'accent'
  const [explodedProgress, setExplodedProgress] = useState(0); // 0 to 100%
  const [isExploded, setIsExploded] = useState(false);
  const explodeAnimRef = useRef(null);
  const [isWireframe, setIsWireframe] = useState(false);
  const [autoSpin, setAutoSpin] = useState(false);
  const [polyCount, setPolyCount] = useState(null);
  const [multiPartMeta, setMultiPartMeta] = useState(null);
  // Honest assembly gating (single-extruder physics): only genuine multi-part
  // assemblies or multi-shell uploads may explode. Single-piece / print-in-place
  // monoliths lock the Explode button with an explicit CAD badge.
  const [assemblyKind, setAssemblyKind] = useState('single-piece'); // 'multi-part' | 'print-in-place' | 'single-piece'
  const [canExplode, setCanExplode] = useState(false);
  const [shellInfo, setShellInfo] = useState(null); // { shellCount }
  // Procedural physical assembly (quick-sample showpieces): real named parts.
  const [proceduralMeta, setProceduralMeta] = useState(null); // { designKey, partNames[] }
  // Single-extruder pause-at-height layer swap (no AMS): second color only via Z split
  const [layerSwapEnabled, setLayerSwapEnabled] = useState(false);
  const [pauseHeightMm, setPauseHeightMm] = useState(3);
  // A1 Mini bedslinger auto-brim stability (+1.5g)
  const [autoBrim, setAutoBrim] = useState(false);
  const [brimDismissed, setBrimDismissed] = useState(false);

  // Unit & Scale controls
  const [scalePercent, setScalePercent] = useState(100);
  const [isTinyModel, setIsTinyModel] = useState(false);
  const [isInchConverted, setIsInchConverted] = useState(false);
  const rawDimensionsRef = useRef(null);
  const [rawDimensions, setRawDimensions] = useState(null);

  // Slicer analysis state
  const [showSupports, setShowSupports] = useState(true);
  const showSupportsRef = useRef(true);
  // With-supports vs without-supports 3D visual mode + pricing toggle
  const [supportsEnabled, setSupportsEnabled] = useState(true);
  const supportsEnabledRef = useRef(true);
  const supportGroupRef = useRef(null);
  const [supportWeightInfo, setSupportWeightInfo] = useState(null);
  const supportWeightRef = useRef(null);
  const [supportStats, setSupportStats] = useState(null);
  const statsRef = useRef(null);
  const [orientResult, setOrientResult] = useState(null);
  const [isOrienting, setIsOrienting] = useState(false);
  const faceDataRef = useRef(null);
  const printBoxRef = useRef(null);
  const orientQuatRef = useRef({ ...IDENTITY_QUAT });
  const orientAnimRef = useRef(null);
  const pendingAssemblyRef = useRef(null);
  const shellInfoRef = useRef(null);
  const canExplodeRef = useRef(false);
  useEffect(() => { shellInfoRef.current = shellInfo; }, [shellInfo]);
  useEffect(() => { canExplodeRef.current = canExplode; }, [canExplode]);

  // Industrial arena overlays & live mirrors (refs avoid per-frame re-renders)
  const seatedBoxRef = useRef(null);
  const bboxHelperRef = useRef(null);
  const scanMeshRef = useRef(null);
  const scanRef = useRef({ active: false, t0: 0, dur: 1800, maxY: 0 });
  const clipPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, -1, 0), 1000));
  const [crossSectionActive, setCrossSectionActive] = useState(false);
  const [crossSectionProgress, setCrossSectionProgress] = useState(100); // 1 to 100%
  const crossSectionPlaneMeshRef = useRef(null);
  const gridRef = useRef(null);
  const measureGroupRef = useRef(null);
  const tagRefs = useRef({});
  const weightRef = useRef(0);
  const costRef = useRef(0);
  // Value-added Post-Processing Add-Ons
  const [addOns, setAddOns] = useState({
    buildPlateTexture: 'textured', // 'textured' | 'smooth_pei' | 'carbon_fiber'
    heatSetInserts: 0,
    supportSanding: false,
  });

  // Live Filament Spool Inventory
  const [spools, setSpools] = useState([]);
  useEffect(() => {
    fetch('/api/spools')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.spools)) {
          setSpools(data.spools);
        }
      })
      .catch((err) => console.warn('Could not fetch spools in viewer:', err));
  }, []);

  // Web Worker Geometry Analyzer
  const workerRef = useRef(null);
  useEffect(() => {
    if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
      try {
        workerRef.current = new Worker(
          new URL('../workers/meshAnalyzer.worker.js', import.meta.url),
          { type: 'module' }
        );
      } catch (err) {
        console.warn('Web Worker initialization fallback:', err);
      }
    }
    return () => {
      if (workerRef.current) workerRef.current.terminate();
    };
  }, []);

  // Lay on Face Tool
  const [layOnFaceActive, setLayOnFaceActive] = useState(false);
  const layOnFaceActiveRef = useRef(false);
  const faceHighlightMeshRef = useRef(null);
  const [layOnFaceStatus, setLayOnFaceStatus] = useState(null);

  useEffect(() => {
    layOnFaceActiveRef.current = layOnFaceActive;
    if (!layOnFaceActive && faceHighlightMeshRef.current) {
      faceHighlightMeshRef.current.visible = false;
    }
  }, [layOnFaceActive]);

  // Point-to-Point 3D Digital Caliper Tool
  const [caliperActive, setCaliperActive] = useState(false);
  const caliperActiveRef = useRef(false);
  const [caliperPoints, setCaliperPoints] = useState([]);
  const [caliperDistMm, setCaliperDistMm] = useState(null);
  const caliperGroupRef = useRef(null);

  useEffect(() => {
    caliperActiveRef.current = caliperActive;
  }, [caliperActive]);

  // Pointer tracking & Raycaster for 3D interactions
  const pointerDownPosRef = useRef({ x: 0, y: 0, time: 0 });
  const raycasterRef = useRef(new THREE.Raycaster());

  // Share 3D Quote Link State
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareSuccessUrl, setShareSuccessUrl] = useState(null);

  // Rapid-tick total readout (mechanical count-up micro-interaction)
  const [displayTotal, setDisplayTotal] = useState(0);

  // Live UTC clock for the Control Center printer-status module
  const [clock, setClock] = useState('');
  useEffect(() => {
    const tickClock = () => setClock(new Date().toISOString().slice(11, 19));
    tickClock();
    const id = setInterval(tickClock, 1000);
    return () => clearInterval(id);
  }, []);

  const setTagRef = (key) => (el) => {
    tagRefs.current[key] = el;
  };

  // Dynamic mesh appearance updater (supports single meshes & multi-part No-AMS groups)
  const updateMeshMaterial = (matName, accentMatName, wireframe, supports) => {
    const obj = currentMeshRef.current;
    if (!obj) return;
    // Procedural physical assemblies keep factory filament colors — spool
    // preview must never repaint real named parts.
    if (obj.userData?.isProceduralAssembly) return;
    const preset = MATERIAL_PRESETS.find((p) => p.name === matName) || MATERIAL_PRESETS[0];
    const accentPreset = MATERIAL_PRESETS.find((p) => p.name === accentMatName) || getContrastPreset(preset.name);

    const fdmBump = createFDMLayerBumpTexture();
    const applyToMat = (mat, p) => {
      if (!mat) return;
      mat.wireframe = wireframe;
      mat.clippingPlanes = crossSectionActive && crossSectionProgress < 100 ? [clipPlaneRef.current] : [];
      mat.clipShadows = true;
      if (supports) {
        mat.vertexColors = true;
        mat.color.set(0xffffff);
      } else {
        mat.vertexColors = false;
        mat.color.set(p.hex);
        mat.roughness = p.roughness;
        mat.metalness = p.metalness;
        if (fdmBump && !mat.bumpMap) {
          mat.bumpMap = fdmBump;
          mat.bumpScale = 0.015;
        }
      }
      mat.needsUpdate = true;
    };

    if (obj.isGroup) {
      const baseChild = obj.children.find((c) => c.name === 'base') || obj.children[0];
      const accentChild = obj.children.find((c) => c.name === 'accent') || obj.children[1];
      if (baseChild && baseChild.material) applyToMat(baseChild.material, preset);
      if (accentChild && accentChild.material) applyToMat(accentChild.material, accentPreset);
    } else if (obj.material) {
      applyToMat(obj.material, preset);
    }
    if (obj.userData?.explodableGroup?.userData?.setColors) {
      obj.userData.explodableGroup.userData.setColors(preset.bg, accentPreset.bg);
    }
  };

  // Update Three.js local clipping plane constant and visual slice indicator mesh
  const updateCrossSection = (active, progress) => {
    const box = seatedBoxRef.current;
    const maxHeight = box ? Math.max(5, box.max.y) : 40;
    const cutY = (progress / 100) * maxHeight;

    if (active && progress < 100) {
      clipPlaneRef.current.constant = Math.max(0.05, cutY);
    } else {
      clipPlaneRef.current.constant = 10000;
    }

    const sliceMesh = crossSectionPlaneMeshRef.current;
    if (sliceMesh) {
      if (active && progress < 100) {
        sliceMesh.visible = true;
        sliceMesh.position.y = Math.max(0.05, cutY);
      } else {
        sliceMesh.visible = false;
      }
    }

    const obj = currentMeshRef.current;
    if (obj) {
      const planes = active && progress < 100 ? [clipPlaneRef.current] : [];
      if (obj.isGroup) {
        obj.children.forEach((c) => {
          if (c.material) {
            c.material.clippingPlanes = planes;
            c.material.clipShadows = true;
            c.material.needsUpdate = true;
          }
        });
      } else if (obj.material) {
        obj.material.clippingPlanes = planes;
        obj.material.clipShadows = true;
        obj.material.needsUpdate = true;
      }
    }
  };

  const handleToggleCrossSection = () => {
    const next = !crossSectionActive;
    setCrossSectionActive(next);
    const prog = next && crossSectionProgress === 100 ? 60 : crossSectionProgress;
    if (next && crossSectionProgress === 100) {
      setCrossSectionProgress(60);
    }
    updateCrossSection(next, prog);
  };

  const handleCrossSectionChange = (val) => {
    const clamped = Math.max(1, Math.min(100, Number(val) || 1));
    setCrossSectionProgress(clamped);
    updateCrossSection(crossSectionActive, clamped);
  };

  // Convert Inches to Millimeters (multiply geometry by 25.4)
  const handleConvertInchesToMm = () => {
    const raw = rawDimensionsRef.current;
    if (!raw) return;

    const nextConverted = !isInchConverted;
    setIsInchConverted(nextConverted);

    const effScale = (scalePercent / 100) * (nextConverted ? 25.4 : 1.0);
    const obj = currentMeshRef.current;
    if (obj) {
      obj.scale.set(effScale, effScale, effScale);
      obj.updateMatrixWorld(true);
      seatMeshOnPlate(obj);
      refreshOverlays();
      updateCrossSection(crossSectionActive, crossSectionProgress);
      fitCameraToObject(cameraRef.current, controlsRef.current, obj, 0.70);
      try { regenerateSupportPillars(); } catch {}
    }
  };

  // Live scale % change capped strictly at the 180×180×180 mm Bambu Lab A1 Mini limit
  const handleScaleChange = (val) => {
    const raw = rawDimensionsRef.current;
    const factor = isInchConverted ? 25.4 : 1.0;
    const maxScale = raw
      ? Math.max(
          10,
          Math.floor(
            Math.min(
              STANDARD_BUILD_LIMIT.x / (raw.x * factor),
              STANDARD_BUILD_LIMIT.y / (raw.y * factor),
              STANDARD_BUILD_LIMIT.z / (raw.z * factor)
            ) * 100
          )
        )
      : 500;

    const num = Math.max(5, Math.min(maxScale, Number(val) || 100));
    setScalePercent(num);

    const effScale = (num / 100) * factor;
    const obj = currentMeshRef.current;
    if (obj) {
      obj.scale.set(effScale, effScale, effScale);
      obj.updateMatrixWorld(true);
      seatMeshOnPlate(obj);
      refreshOverlays();
      updateCrossSection(crossSectionActive, crossSectionProgress);
      try { regenerateSupportPillars(); } catch {}
    }
  };

  // 1-Click Auto-Scale to Fit 180x180x180mm Bambu Lab A1 Mini Bed
  const handleAutoScaleToFitBed = () => {
    const raw = rawDimensionsRef.current;
    const factor = isInchConverted ? 25.4 : 1.0;
    const maxRawAxis = raw ? Math.max(raw.x, raw.y, raw.z) * factor : 0;
    const curDims = currentDimensions || quoteData?.dimensions;
    const maxCurAxis = curDims ? Math.max(curDims.x, curDims.y, curDims.z) : 0;
    const effectiveMax = maxRawAxis > 0 ? maxRawAxis : (maxCurAxis > 0 ? maxCurAxis : 200);

    // Target max 175mm so the longest axis fits the 180mm envelope with margin
    const targetScale = Math.max(5, Math.floor((175 / effectiveMax) * 100));
    handleScaleChange(targetScale);

    // Clear oversized error states so user gets immediate quotation
    setError(null);
    setQuoteData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        error: null,
        success: true,
      };
    });

    const obj = currentMeshRef.current;
    if (obj) {
      fitCameraToObject(cameraRef.current, controlsRef.current, obj, 0.70);
    }
  };

  // Apply Exploded Assembly offset to accent mesh and generate dashed alignment guide lines
  const applyExplodedOffset = (progress) => {
    const obj = currentMeshRef.current;
    if (!obj) return;

    // P0. Procedural physical assemblies: per-part vectors + spin via controller
    if (obj.userData?.isProceduralAssembly && typeof obj.userData.update === 'function') {
      updateExplodableGroup(obj, progress / 100, 1.0);
      refreshOverlays();
      return;
    }

    // A. Multi-part No-AMS models (with separate base and accent meshes)
    const accent = obj.children ? obj.children.find((c) => c.name === 'accent') : null;
    const base = obj.children ? obj.children.find((c) => c.name === 'base') : null;
    if (accent && base && accent.geometry && base.geometry) {
      const accentGeo = accent.geometry;
      const baseGeo = base.geometry;
      if (accentGeo.boundingBox && baseGeo.boundingBox) {
        const height = accentGeo.boundingBox.max.z - accentGeo.boundingBox.min.z;
        const maxExplode = Math.max(35, Math.min(80, height * 1.4 + 25));
        const delta = (progress / 100) * maxExplode;

        accent.position.set(0, 0, delta);
        accent.updateMatrixWorld(true);

        let guides = obj.children.find((c) => c.name === 'guides');
        if (!guides) {
          guides = new THREE.Group();
          guides.name = 'guides';
          obj.add(guides);
        }

        // Clear previous guide lines
        while (guides.children.length > 0) {
          const child = guides.children.pop();
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        }

        if (delta > 2) {
          const bb = accentGeo.boundingBox;
          const z0 = bb.min.z;
          const z1 = bb.min.z + delta;
          const corners = [
            [bb.min.x + 2, bb.min.y + 2],
            [bb.max.x - 2, bb.min.y + 2],
            [bb.max.x - 2, bb.max.y - 2],
            [bb.min.x + 2, bb.max.y - 2],
          ];

          const pts = [];
          corners.forEach(([cx, cy]) => {
            pts.push(cx, cy, z0);
            pts.push(cx, cy, z1);
          });

          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
          const mat = new THREE.LineDashedMaterial({
            color: 0xff6500,
            dashSize: 3,
            gapSize: 2,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
          });
          const lines = new THREE.LineSegments(geo, mat);
          lines.computeLineDistances();
          guides.add(lines);
        }

        refreshOverlays();
        return;
      }
    }

    // B. Single-mesh STL: honest shell explode only (never fake-slice a monolith)
    const shellCount = shellInfoRef.current?.shellCount ?? 1;
    if (shellCount < 2) return;
    const geom = obj.isMesh ? obj.geometry : (obj.children?.find((c) => c.isMesh)?.geometry);
    if (!geom) return;

    if (!obj.userData.explodableGroup) {
      const primaryHex = activePreset ? '#' + activePreset.hex.toString(16).padStart(6, '0') : '#FF6500';
      const contrast = getContrastPreset(activePreset ? activePreset.name : 'Concrete Grey');
      const accentHex = contrast ? '#' + contrast.hex.toString(16).padStart(6, '0') : '#00FF66';
      let explodable = null;
      try {
        const analysis = analyzeMeshShells(geom, 0.02);
        if (analysis.shellCount >= 2) {
          explodable = buildShellExplodableGroup(geom, primaryHex, accentHex, THREE, analysis);
        }
      } catch {}
      if (!explodable) return;
      explodable.name = 'explodableGroup';
      obj.add(explodable);
      obj.userData.explodableGroup = explodable;
    }

    const explodable = obj.userData.explodableGroup;
    if (explodable) {
      if (progress === 0) {
        if (obj.isMesh) obj.visible = true;
        explodable.visible = false;
      } else {
        if (obj.isMesh) obj.visible = false;
        explodable.visible = true;
        updateExplodableGroup(explodable, progress / 100, 1.0);
      }
    }
    refreshOverlays();
  };

  const handleToggleExplode = () => {
    if (!canExplodeRef.current) return;
    if (explodeAnimRef.current) {
      cancelAnimationFrame(explodeAnimRef.current);
      explodeAnimRef.current = null;
    }
    const startProgress = explodedProgress;
    const targetProgress = startProgress > 10 ? 0 : 100;
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dur = 450;

    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const currentVal = Math.round(startProgress + (targetProgress - startProgress) * e);
      setExplodedProgress(currentVal);
      applyExplodedOffset(currentVal);
      if (t < 1) {
        explodeAnimRef.current = requestAnimationFrame(step);
      } else {
        explodeAnimRef.current = null;
        setIsExploded(targetProgress > 0);
      }
    };
    explodeAnimRef.current = requestAnimationFrame(step);
  };

  const handleSliderExplode = (e) => {
    if (!canExplodeRef.current) return;
    if (explodeAnimRef.current) {
      cancelAnimationFrame(explodeAnimRef.current);
      explodeAnimRef.current = null;
    }
    const val = parseInt(e.target.value, 10) || 0;
    setExplodedProgress(val);
    setIsExploded(val > 0);
    applyExplodedOffset(val);
  };

  // Sync auto-rotation with OrbitControls
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoSpin;
      controlsRef.current.autoRotateSpeed = 2.0;
    }
  }, [autoSpin]);

  // Customer Checkout Form State
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [colorChoice, setColorChoice] = useState('Concrete Grey');
  const [customerNotes, setCustomerNotes] = useState('');
  const [confirmingOrder, setConfirmingOrder] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState(null);
  const [confirmationError, setConfirmationError] = useState(null);
  const [copiedRef, setCopiedRef] = useState(false);
  // Slide-over checkout drawer (dedicated UPI checkout space)
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  // Delivery estimator state (pincode-based courier quote)
  const [deliveryPin, setDeliveryPin] = useState('');
  const [deliveryQuote, setDeliveryQuote] = useState(null);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryError, setDeliveryError] = useState(null);

  // Payment mode: Prepaid (UPI/cards, collected at checkout) or COD (cash on dispatch)
  const [paymentMode, setPaymentMode] = useState('Prepaid');
  const [paymentUtr, setPaymentUtr] = useState('');

  // Initialize Three.js Scene
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    if (container.dataset.initialized === 'true' && container.querySelector('canvas')) return;
    container.dataset.initialized = 'true';

    const width = Math.max(container.clientWidth || 600, 300);
    const height = Math.max(container.clientHeight || 520, 420);

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x18181b); // Zinc-900 dark slate
    sceneRef.current = scene;

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 1, 2000);
    camera.position.set(160, 160, 240);
    cameraRef.current = camera;

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(resolvePixelRatio());
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true; // Z-axis cross-section clipping plane
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // WebGL Context Priority & Recovery
    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[StlViewer] WebGL context lost. Slicer arena recovering...');
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      console.log('[StlViewer] WebGL context restored.');
    });

    // RoomEnvironment for realistic specular reflections and bevel highlights
    try {
      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      pmremGenerator.compileEquirectangularShader();
      const envScene = new RoomEnvironment();
      scene.environment = pmremGenerator.fromScene(envScene, 0.04).texture;
      envScene.dispose();
      pmremGenerator.dispose();
    } catch (envErr) {
      console.warn('[StlViewer] Could not initialize RoomEnvironment:', envErr);
    }

    // 4. OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    // Allow dipping ~153° below the horizon so operators can orbit underneath
    // and visually inspect downward-facing support warnings.
    controls.maxPolarAngle = Math.PI * 0.85;
    controls.minDistance = 30;
    controls.maxDistance = 600;
    controls.target.set(0, 30, 0);
    controlsRef.current = controls;

    // 4b. Mobile scroll-trap guard: on touch devices a floating pill locks
    //      one-finger orbiting so the page can be scrolled over the canvas.
    //      (Desktop gets null and the normal drag-to-orbit behaviour.)
    const touchLock = attachTouchScrollLock({
      container,
      controls,
      defaultLocked: true,
    });

    // 5. Lighting — slicer-grade studio rig: ambient base + shadow-casting key + rim speculars
    // HemisphereLight for soft natural gradient
    const hemiLight = new THREE.HemisphereLight(0xdce4f0, 0x14161a, 0.9);
    hemiLight.position.set(0, 200, 0);
    scene.add(hemiLight);

    // AmbientLight floor so shadowed faces maintain depth without crushing
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.22);
    scene.add(ambientLight);

    // Directional Key Light with soft shadows for a premium solid appearance.
    // Warm neutral studio softbox (4500K)
    const keyLight = new THREE.DirectionalLight(0xfff8ee, 2.6);
    keyLight.position.set(90, 240, 90);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.radius = 3.0;
    keyLight.shadow.camera.left = -160;
    keyLight.shadow.camera.right = 160;
    keyLight.shadow.camera.top = 160;
    keyLight.shadow.camera.bottom = -160;
    keyLight.shadow.camera.near = 10;
    keyLight.shadow.camera.far = 600;
    keyLight.shadow.bias = -0.0004;
    scene.add(keyLight);

    // Directional Fill Light (cool softbox)
    const fillLight = new THREE.DirectionalLight(0xdbe4f0, 0.85);
    fillLight.position.set(-110, 100, 90);
    scene.add(fillLight);

    // Crisp Studio Rim / Edge Light (highlights chamfers, bevels, and silhouettes)
    const rimLight = new THREE.DirectionalLight(0xffffff, 1.25);
    rimLight.position.set(-90, 130, -110);
    scene.add(rimLight);

    // 6. Build Plate Representation (180x180mm print bed).
    // Grid + edge rails give the physical read; a ShadowMaterial catcher shows
    // only the soft shadow from above and stays see-through from below, so
    // operators can orbit underneath and inspect support warnings.
    const gridHelper = new THREE.GridHelper(180, 18, 0xea580c, 0x242832);
    gridHelper.position.y = 0.1;
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.55;
    scene.add(gridHelper);
    gridRef.current = gridHelper;

    const catcher = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 180),
      new THREE.ShadowMaterial({ opacity: 0.55 })
    );
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = 0.01;
    catcher.receiveShadow = true;
    scene.add(catcher);

    const railMat = new THREE.MeshStandardMaterial({
      color: 0x3f3f46,
      roughness: 0.6,
      metalness: 0.3
    });
    const railLong = new THREE.BoxGeometry(184, 3, 2);
    const railSide = new THREE.BoxGeometry(2, 3, 184);
    for (const [geo, x, z] of [
      [railLong, 0, 91],
      [railLong, 0, -91],
      [railSide, 91, 0],
      [railSide, -91, 0],
    ]) {
      const rail = new THREE.Mesh(geo, railMat);
      rail.position.set(x, -1.5, z);
      rail.receiveShadow = true;
      scene.add(rail);
    }

    // Boundary measuring group: orange border + coordinate ticks + green
    // calibration crosshairs + 180MM edge labels (static plate furniture).
    const measureGroup = buildMeasureGroup();
    scene.add(measureGroup);
    measureGroupRef.current = measureGroup;

    // Z-axis scan plane: one-shot in-scene sweep on every model load.
    const scanMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 180),
      new THREE.MeshBasicMaterial({
        color: 0xff6500, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    scanMesh.rotation.x = -Math.PI / 2;
    scanMesh.position.y = 0.2;
    scanMesh.visible = false;
    scene.add(scanMesh);
    scanMeshRef.current = scanMesh;

    // Z-axis cross-section slice plane visualizer
    const slicePlaneGroup = new THREE.Group();
    const slicePlaneGeo = new THREE.PlaneGeometry(180, 180);
    const slicePlaneMat = new THREE.MeshBasicMaterial({
      color: 0x00ff66,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const slicePlaneMesh = new THREE.Mesh(slicePlaneGeo, slicePlaneMat);
    slicePlaneMesh.rotation.x = -Math.PI / 2;
    slicePlaneGroup.add(slicePlaneMesh);

    const sliceEdgeGeo = new THREE.BufferGeometry();
    const sH = 90;
    const sliceEdgePts = [
      -sH, 0, -sH,  sH, 0, -sH,
       sH, 0, -sH,  sH, 0,  sH,
       sH, 0,  sH, -sH, 0,  sH,
      -sH, 0,  sH, -sH, 0, -sH,
    ];
    sliceEdgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sliceEdgePts), 3));
    const sliceEdgeMat = new THREE.LineBasicMaterial({
      color: 0x00ff66,
      transparent: true,
      opacity: 0.85,
    });
    slicePlaneGroup.add(new THREE.LineSegments(sliceEdgeGeo, sliceEdgeMat));
    slicePlaneGroup.position.y = 0.2;
    slicePlaneGroup.visible = false;
    scene.add(slicePlaneGroup);
    crossSectionPlaneMeshRef.current = slicePlaneGroup;

    // Lay on Face interactive highlight disc
    const highlightGeo = new THREE.RingGeometry(1.5, 5, 32);
    const highlightMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });
    const highlightMesh = new THREE.Mesh(highlightGeo, highlightMat);
    highlightMesh.visible = false;
    highlightMesh.renderOrder = 999;
    scene.add(highlightMesh);
    faceHighlightMeshRef.current = highlightMesh;

    // 3D Caliper dimension line group
    const caliperGroup = new THREE.Group();
    caliperGroup.name = 'caliper_group';
    scene.add(caliperGroup);
    caliperGroupRef.current = caliperGroup;

    // Pointer events for 3D interactions (Lay on Face & 3D Caliper)
    const onPointerDown = (e) => {
      pointerDownPosRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
    };

    const onPointerMove = (e) => {
      if (!container || !cameraRef.current || !currentMeshRef.current) return;
      if (!layOnFaceActiveRef.current && !caliperActiveRef.current) return;

      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = raycasterRef.current;
      raycaster.setFromCamera(mouse, cameraRef.current);

      const intersects = raycaster.intersectObject(currentMeshRef.current, true);
      if (intersects.length > 0) {
        const hit = intersects[0];
        if (layOnFaceActiveRef.current && faceHighlightMeshRef.current && hit.face) {
          const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
          faceHighlightMeshRef.current.position.copy(hit.point).addScaledVector(normal, 0.25);
          faceHighlightMeshRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
          faceHighlightMeshRef.current.visible = true;
        }
        container.style.cursor = 'crosshair';
      } else {
        if (faceHighlightMeshRef.current) faceHighlightMeshRef.current.visible = false;
        container.style.cursor = '';
      }
    };

    const onPointerUp = (e) => {
      if (!container || !cameraRef.current || !currentMeshRef.current) return;
      const down = pointerDownPosRef.current;
      const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (dist > 6) return; // camera orbit / pan

      if (!layOnFaceActiveRef.current && !caliperActiveRef.current) return;

      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = raycasterRef.current;
      raycaster.setFromCamera(mouse, cameraRef.current);

      const intersects = raycaster.intersectObject(currentMeshRef.current, true);
      if (intersects.length === 0) return;

      const hit = intersects[0];
      if (layOnFaceActiveRef.current && hit.face) {
        const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
        executeLayOnFace(normal);
      } else if (caliperActiveRef.current) {
        executeCaliperClick(hit.point);
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // Animation Loop (drives orient slerp, grid pulse, Z scan, coordinate tags)
    let animationFrameId;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const anim = orientAnimRef.current;
      if (anim && anim.active && currentMeshRef.current) {
        const t = Math.min(1, (now - anim.t0) / anim.dur);
        const e = t * t * (3 - 2 * t); // smoothstep easing
        currentMeshRef.current.quaternion.slerpQuaternions(anim.q0, anim.q1, e);
        currentMeshRef.current.position.lerpVectors(anim.p0, anim.p1, e);
        if (t >= 1) {
          anim.active = false;
          if (anim.onDone) {
            const cb = anim.onDone;
            anim.onDone = null;
            cb();
          }
        }
      }
      // Animated grid plate: gentle opacity breathing
      if (gridRef.current) {
        gridRef.current.material.opacity = 0.72 + 0.18 * Math.sin(now / 900);
      }
      // Z scan sweep: plane rises 0 -> model top, then parks invisible
      const scan = scanRef.current;
      const scanTarget = scanMeshRef.current;
      if (scan && scan.active && scanTarget) {
        const t = Math.min(1, (now - scan.t0) / scan.dur);
        scanTarget.position.y = 0.2 + (scan.maxY - 0.2) * t;
        scanTarget.material.opacity = 0.22 * (1 - t * 0.6);
        if (t >= 1) {
          scan.active = false;
          scanTarget.visible = false;
        }
      }
      updateTags(camera);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize Handler with ResizeObserver & window resize fallback
    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const newWidth = Math.max(container.clientWidth || 600, 300);
      const newHeight = Math.max(container.clientHeight || 520, 420);
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };
    window.addEventListener('resize', handleResize);

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width: w, height: h } = entry.contentRect;
          if (w > 0 && h > 0 && camera && renderer) {
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
          }
        }
      });
      resizeObserver.observe(container);
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      if (renderer.domElement) {
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer.domElement.removeEventListener('pointermove', onPointerMove);
        renderer.domElement.removeEventListener('pointerup', onPointerUp);
      }
      if (explodeAnimRef.current) {
        cancelAnimationFrame(explodeAnimRef.current);
        explodeAnimRef.current = null;
      }
      if (faceHighlightMeshRef.current) {
        scene.remove(faceHighlightMeshRef.current);
        faceHighlightMeshRef.current.geometry.dispose();
        faceHighlightMeshRef.current.material.dispose();
        faceHighlightMeshRef.current = null;
      }
      if (caliperGroupRef.current) {
        scene.remove(caliperGroupRef.current);
        disposeObjectGroup(caliperGroupRef.current);
        caliperGroupRef.current = null;
      }
      if (measureGroupRef.current) {
        scene.remove(measureGroupRef.current);
        disposeObjectGroup(measureGroupRef.current);
        measureGroupRef.current = null;
      }
      if (supportGroupRef.current) {
        scene.remove(supportGroupRef.current);
        disposeObjectGroup(supportGroupRef.current);
        supportGroupRef.current = null;
      }
      if (scanMeshRef.current) {
        scene.remove(scanMeshRef.current);
        scanMeshRef.current.geometry.dispose();
        scanMeshRef.current.material.dispose();
        scanMeshRef.current = null;
      }
      if (bboxHelperRef.current) {
        scene.remove(bboxHelperRef.current);
        bboxHelperRef.current.geometry.dispose();
        bboxHelperRef.current.material.dispose();
        bboxHelperRef.current = null;
      }
      if (gridRef.current) {
        scene.remove(gridRef.current);
        gridRef.current.geometry.dispose();
        gridRef.current.material.dispose();
        gridRef.current = null;
      }
      if (crossSectionPlaneMeshRef.current) {
        scene.remove(crossSectionPlaneMeshRef.current);
        disposeObjectGroup(crossSectionPlaneMeshRef.current);
        crossSectionPlaneMeshRef.current = null;
      }
      controls.dispose();
      if (touchLock && touchLock.pill && touchLock.pill.parentNode) {
        touchLock.pill.parentNode.removeChild(touchLock.pill);
      }
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Clear 3D Caliper measurement visual elements
  const clearCaliperVisuals = useCallback(() => {
    if (caliperGroupRef.current) {
      while (caliperGroupRef.current.children.length > 0) {
        const child = caliperGroupRef.current.children.pop();
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      }
    }
    setCaliperPoints([]);
    setCaliperDistMm(null);
  }, []);

  // Point-to-Point 3D Digital Caliper click handler
  const executeCaliperClick = useCallback((pt) => {
    const group = caliperGroupRef.current;
    if (!group) return;

    if (caliperPoints.length === 0 || caliperPoints.length === 2) {
      clearCaliperVisuals();
      const ptA = pt.clone();
      setCaliperPoints([ptA]);
      setCaliperDistMm(null);

      // Marker A
      const dotA = new THREE.Mesh(
        new THREE.SphereGeometry(1.8, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0x00ff66, depthTest: false })
      );
      dotA.position.copy(ptA);
      dotA.renderOrder = 998;
      group.add(dotA);

      const labelA = makeTextSprite('A', '#00FF66');
      labelA.position.copy(ptA).add(new THREE.Vector3(0, 4, 0));
      labelA.renderOrder = 999;
      group.add(labelA);
    } else if (caliperPoints.length === 1) {
      const ptA = caliperPoints[0];
      const ptB = pt.clone();
      setCaliperPoints([ptA, ptB]);

      const dist = ptA.distanceTo(ptB);
      const distStr = `${dist.toFixed(2)} mm`;
      setCaliperDistMm(dist.toFixed(2));

      // Marker B
      const dotB = new THREE.Mesh(
        new THREE.SphereGeometry(1.8, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0x00ff66, depthTest: false })
      );
      dotB.position.copy(ptB);
      dotB.renderOrder = 998;
      group.add(dotB);

      const labelB = makeTextSprite('B', '#00FF66');
      labelB.position.copy(ptB).add(new THREE.Vector3(0, 4, 0));
      labelB.renderOrder = 999;
      group.add(labelB);

      // CAD Dimension line with end ticks
      const ab = ptB.clone().sub(ptA);
      const len = ab.length();
      if (len > 0.05) {
        const dir = ab.clone().normalize();
        const perp = Math.abs(dir.y) < 0.9
          ? new THREE.Vector3(0, 1, 0).cross(dir).normalize().multiplyScalar(3.0)
          : new THREE.Vector3(1, 0, 0).cross(dir).normalize().multiplyScalar(3.0);

        const pts = [
          ptA.x, ptA.y, ptA.z,  ptB.x, ptB.y, ptB.z,
          ptA.x - perp.x, ptA.y - perp.y, ptA.z - perp.z,  ptA.x + perp.x, ptA.y + perp.y, ptA.z + perp.z,
          ptB.x - perp.x, ptB.y - perp.y, ptB.z - perp.z,  ptB.x + perp.x, ptB.y + perp.y, ptB.z + perp.z,
        ];

        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
        const lineMat = new THREE.LineBasicMaterial({
          color: 0x00ff66,
          linewidth: 2,
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        });
        const dimLines = new THREE.LineSegments(lineGeo, lineMat);
        dimLines.renderOrder = 998;
        group.add(dimLines);

        // Floating Euclidean distance badge in 3D
        const mid = ptA.clone().add(ptB).multiplyScalar(0.5);
        const distBadge = makeTextSprite(distStr, '#00FF66');
        distBadge.position.copy(mid).add(new THREE.Vector3(0, 6, 0));
        distBadge.renderOrder = 999;
        group.add(distBadge);
      }
    }
  }, [caliperPoints, clearCaliperVisuals]);

  // Lay on Face: align clicked face normal to (0, -1, 0) on the Y=0 build plate
  const executeLayOnFace = useCallback((worldNormal) => {
    const mesh = currentMeshRef.current;
    if (!mesh) return;

    const qAlign = new THREE.Quaternion().setFromUnitVectors(worldNormal, new THREE.Vector3(0, -1, 0));
    const targetQuat = qAlign.clone().multiply(mesh.quaternion);

    const q0 = mesh.quaternion.clone();
    const p0 = mesh.position.clone();
    mesh.quaternion.copy(targetQuat);
    mesh.updateMatrixWorld(true);
    seatMeshOnPlate(mesh);
    const p1 = mesh.position.clone();
    mesh.quaternion.copy(q0);
    mesh.position.copy(p0);

    orientAnimRef.current = {
      active: true,
      t0: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      dur: 750,
      q0,
      q1: targetQuat,
      p0,
      p1,
      onDone: () => {
        const sceneInv = buildPrintToSceneQuat().invert();
        const totalPrint = sceneInv.multiply(targetQuat.clone());
        orientQuatRef.current = { x: totalPrint.x, y: totalPrint.y, z: totalPrint.z, w: totalPrint.w };

        if (mesh.isGroup) {
          mesh.traverse((c) => {
            if (c.isMesh && c.geometry && c.userData?.faceData) {
              applySupportColors(c.geometry, c.userData.faceData, totalPrint);
            }
          });
        } else if (mesh.geometry && faceDataRef.current) {
          applySupportColors(mesh.geometry, faceDataRef.current, totalPrint);
        }

        if (faceDataRef.current && printBoxRef.current) {
          const scored = evaluatePose(faceDataRef.current, totalPrint, printBoxRef.current);
          setSupportStats({
            overhangArea: scored.overhangArea,
            fraction: scored.overhangFraction,
            contactArea: scored.contactArea,
            supportArea: scored.supportArea,
          });
        }

        if (mesh) {
          const seated = seatMeshOnPlate(mesh);
          const sz = seated.getSize(new THREE.Vector3());
          const unifiedDims = { x: Number(sz.x.toFixed(1)), y: Number(sz.z.toFixed(1)), z: Number(sz.y.toFixed(1)) };
          setRawDimensions(unifiedDims);
          rawDimensionsRef.current = unifiedDims;
        }
        refreshOverlays();
        updateCrossSection(crossSectionActive, crossSectionProgress);
        try { regenerateSupportPillars(); } catch {}
        setLayOnFaceStatus('Model laid flat on selected face.');
        setTimeout(() => setLayOnFaceStatus(null), 3500);
        setLayOnFaceActive(false);
        if (faceHighlightMeshRef.current) faceHighlightMeshRef.current.visible = false;
      },
    };
  }, [crossSectionActive, crossSectionProgress]);

  // Automatic refresh session restoration via quoteStore & IndexedDB
  useEffect(() => {
    let active = true;
    async function restoreWorkspace() {
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      if (params.get('design')) return; // catalog design loader takes precedence

      // First check active quote store (memory/IndexedDB), fallback to workspace model
      const stored = await loadActiveQuote();
      const cached = stored || (await loadWorkspaceModel());
      if (!active || !cached) return;

      try {
        if (cached.settings) {
          if (cached.settings.materialType) setSelectedMaterialType(cached.settings.materialType);
          if (cached.settings.profile) setSelectedProfile(cached.settings.profile);
          if (cached.settings.infillPercent != null) setInfillPercent(cached.settings.infillPercent);
          if (cached.settings.layerHeightMm != null) setLayerHeightMm(cached.settings.layerHeightMm);
          if (cached.settings.supportsEnabled != null) {
            setSupportsEnabled(Boolean(cached.settings.supportsEnabled));
            supportsEnabledRef.current = Boolean(cached.settings.supportsEnabled);
          }
          if (cached.settings.quantity) setPartQuantity(cached.settings.quantity);
          if (cached.settings.material) setSelectedMaterial(cached.settings.material);
          if (cached.settings.accentMaterial) setSelectedAccentMaterial(cached.settings.accentMaterial);
          if (cached.settings.scalePercent != null) setScalePercent(cached.settings.scalePercent);
          if (cached.settings.addOns) setAddOns(cached.settings.addOns);
        }
        if (cached.fileName && cached.buffer) setFileName(cached.fileName);
        // NOTE: quoteData + hasActiveModel are set inside renderStlGeometry only
        // after the mesh parses AND mounts in the scene — never optimistically
        // here, so the badge/receipt can never appear without a visible mesh.
        if (cached.buffer) {
          renderStlGeometry(cached.buffer, null, cached.fileName);
        }
      } catch (err) {
        console.warn('Failed restoring cached workspace from quoteStore/IndexedDB:', err);
      }
    }
    restoreWorkspace();
    return () => { active = false; };
  }, []);

  // Save print configuration settings changes into IndexedDB & quoteStore
  useEffect(() => {
    const nextSettings = {
      materialType: selectedMaterialType,
      profile: selectedProfile,
      infillPercent,
      layerHeightMm,
      supportsEnabled,
      quantity: partQuantity,
      material: selectedMaterial,
      accentMaterial: selectedAccentMaterial,
      scalePercent,
      addOns,
    };
    saveWorkspaceSettings(nextSettings);
    if (typeof window !== 'undefined' && window.__SNKB_QUOTE_STATE__) {
      saveActiveQuote({
        ...window.__SNKB_QUOTE_STATE__,
        settings: nextSettings,
      });
    }
  }, [selectedMaterialType, selectedProfile, infillPercent, layerHeightMm, supportsEnabled, partQuantity, selectedMaterial, selectedAccentMaterial, scalePercent, addOns]);

  // Share 3D Quote Link generator
  const handleShareQuoteLink = async () => {
    setShareLoading(true);
    try {
      const payload = {
        fileName: fileName || 'model.stl',
        material: selectedMaterialType,
        color: selectedMaterial,
        accentColor: selectedAccentMaterial,
        profile: selectedProfile,
        layerHeightMm: layerHeightMm || slicerQuote?.layerHeightMm || undefined,
        infillPercent,
        quantity: partQuantity,
        scale: scalePercent,
        dimensions: dims,
        weightGrams: weight,
        partWeightGrams: slicerQuote?.partWeightGrams ?? undefined,
        supportWeightGrams: supportsEnabled ? (slicerQuote?.supportWeightGrams ?? 0) : 0,
        supportsEnabled,
        totalPrice: cost,
        breakdown: slicerQuote,
        addOns,
      };

      const res = await fetch('/api/quote/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to create shareable quote link');
      }

      const fullUrl = `${window.location.origin}${data.shareUrl}`;
      setShareSuccessUrl(fullUrl);
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(fullUrl);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 3500);
      }
    } catch (err) {
      console.error('Share quote failed:', err);
      alert('Could not share quote: ' + err.message);
    } finally {
      setShareLoading(false);
    }
  };
  // (re)seat: model load and auto-orient completion.
  const refreshOverlays = () => {
    const scene = sceneRef.current;
    const mesh = currentMeshRef.current;
    if (!scene || !mesh) return;
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    seatedBoxRef.current = box.clone();
    if (bboxHelperRef.current) {
      scene.remove(bboxHelperRef.current);
      bboxHelperRef.current.geometry.dispose();
      bboxHelperRef.current.material.dispose();
      bboxHelperRef.current = null;
    }
    const boxSize = new THREE.Vector3();
    box.getSize(boxSize);
    const isExceeded =
      boxSize.x > STANDARD_BUILD_LIMIT.x ||
      boxSize.y > STANDARD_BUILD_LIMIT.y ||
      boxSize.z > STANDARD_BUILD_LIMIT.z ||
      box.min.x < -90.5 ||
      box.max.x > 90.5 ||
      box.min.z < -90.5 ||
      box.max.z > 90.5 ||
      box.max.y > 180.5;

    const helperColor = isExceeded ? 0xFF2A4B : 0x00FF66;
    const helper = new THREE.Box3Helper(box, helperColor);
    helper.material.transparent = true;
    helper.material.opacity = isExceeded ? 0.95 : 0.85;
    bboxHelperRef.current = helper;
    scene.add(helper);
  };

  const getActiveDensity = () => {
    const key = String(selectedMaterialType || 'pla').toLowerCase();
    if (key.includes('petg')) return 1.27;
    if (key.includes('tpu')) return 1.21;
    return 1.24;
  };

  const clearSupportPillars = () => {
    const scene = sceneRef.current;
    const group = supportGroupRef.current;
    if (group) {
      if (scene) scene.remove(group);
      disposeObjectGroup(group);
      supportGroupRef.current = null;
    }
  };

  // Traverse seated mesh in world/bed space (Y=0 plate, Y>0 up).
  // Flag faces with normal.y < -cos45 (~-0.707) AND centroid.y > 0.8mm.
  const collectOverhangTriangles = () => {
    const mesh = currentMeshRef.current;
    if (!mesh) return { triangles: [], totalArea: 0 };
    mesh.updateMatrixWorld(true);
    const triangles = [];
    let totalArea = 0;
    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const n = new THREE.Vector3();
    const cen = new THREE.Vector3();
    const targets = [];
    if (mesh.isGroup) {
      mesh.children.forEach((c) => { if (c.isMesh) targets.push(c); });
    } else if (mesh.isMesh) {
      targets.push(mesh);
    }
    for (const child of targets) {
      const pos = child.geometry && child.geometry.getAttribute('position');
      if (!pos) continue;
      const arr = pos.array;
      for (let i = 0; i < arr.length; i += 9) {
        vA.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(child.matrixWorld);
        vB.set(arr[i + 3], arr[i + 4], arr[i + 5]).applyMatrix4(child.matrixWorld);
        vC.set(arr[i + 6], arr[i + 7], arr[i + 8]).applyMatrix4(child.matrixWorld);
        e1.subVectors(vB, vA);
        e2.subVectors(vC, vA);
        n.crossVectors(e1, e2);
        const area2 = n.length();
        const area = area2 / 2;
        totalArea += area;
        if (area < 1e-9) continue;
        n.normalize();
        cen.set((vA.x + vB.x + vC.x) / 3, (vA.y + vB.y + vC.y) / 3, (vA.z + vB.z + vC.z) / 3);
        if (n.y < -Math.SQRT1_2 && cen.y > 0.8) {
          triangles.push({ areaMm2: area, normalY: n.y, centroidYMm: cen.y, cx: cen.x, cz: cen.z });
        }
      }
    }
    return { triangles, totalArea };
  };

  // Procedural InstancedMesh support pillars: 6mm XZ grid, Y=0 -> overhang height,
  // emerald semi-transparent + 1.5mm brim pad look (0.6mm disc, 3mm radius).
  const regenerateSupportPillars = () => {
    const scene = sceneRef.current;
    if (!scene || !currentMeshRef.current) return;
    clearSupportPillars();
    const { triangles, totalArea } = collectOverhangTriangles();
    const density = getActiveDensity();
    const info = computeSupportWeight({
      triangles: triangles.map((t) => ({ areaMm2: t.areaMm2, normalY: t.normalY, centroidYMm: t.centroidYMm })),
      totalAreaMm2: totalArea,
      supportsEnabled: true,
      density,
    });
    const enriched = {
      ...info,
      totalAreaMm2: totalArea,
      triangleCount: triangles.length,
    };
    setSupportWeightInfo(enriched);
    supportWeightRef.current = enriched;

    if (triangles.length === 0) return;

    // Bucket centroids into 6mm x 6mm XZ grid (max height per cell wins)
    const cells = new Map();
    for (const t of triangles) {
      const gx = Math.floor(t.cx / SUPPORT_GRID_MM);
      const gz = Math.floor(t.cz / SUPPORT_GRID_MM);
      const key = `${gx},${gz}`;
      const prev = cells.get(key);
      const cx = (gx + 0.5) * SUPPORT_GRID_MM;
      const cz = (gz + 0.5) * SUPPORT_GRID_MM;
      if (!prev || t.centroidYMm > prev.h) {
        cells.set(key, { x: cx, z: cz, h: t.centroidYMm });
      }
    }
    if (cells.size === 0) return;

    const group = new THREE.Group();
    group.name = 'support_pillars';
    const list = Array.from(cells.values()).filter((c) => c.h > 1.2);
    if (list.length === 0) {
      supportGroupRef.current = group;
      scene.add(group);
      group.visible = supportsEnabledRef.current;
      return;
    }

    const pillarGeo = new THREE.CylinderGeometry(1.1, 1.5, 1, 8, 1, false);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: SUPPORT_PILLAR_COLOR,
      emissive: 0x00ffcc,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.55,
      roughness: 0.4,
      metalness: 0.1,
      depthWrite: false,
    });
    const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, list.length);
    const brimGeo = new THREE.CylinderGeometry(3, 3, 0.6, 12);
    const brimMat = new THREE.MeshStandardMaterial({
      color: SUPPORT_BRIM_COLOR,
      transparent: true,
      opacity: 0.7,
      roughness: 0.6,
      metalness: 0.1,
      depthWrite: false,
    });
    const brims = new THREE.InstancedMesh(brimGeo, brimMat, list.length);
    const dummy = new THREE.Object3D();
    list.forEach((cell, idx) => {
      const h = Math.max(1.5, cell.h);
      dummy.position.set(cell.x, h / 2, cell.z);
      dummy.scale.set(1, h, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      pillars.setMatrixAt(idx, dummy.matrix);
      dummy.position.set(cell.x, 0.3, cell.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      brims.setMatrixAt(idx, dummy.matrix);
    });
    pillars.instanceMatrix.needsUpdate = true;
    brims.instanceMatrix.needsUpdate = true;
    pillars.renderOrder = 5;
    brims.renderOrder = 4;
    group.add(brims);
    group.add(pillars);
    group.visible = supportsEnabledRef.current;
    scene.add(group);
    supportGroupRef.current = group;
  };

  const handleToggleSupportsEnabled = (next) => {
    const val = typeof next === 'boolean' ? next : !supportsEnabled;
    setSupportsEnabled(val);
    supportsEnabledRef.current = val;
    if (supportGroupRef.current) {
      supportGroupRef.current.visible = val;
    }
  };

  // Recompute support weight when engineering material changes (density/rate shift)
  useEffect(() => {
    if (currentMeshRef.current && faceDataRef.current) {
      try { regenerateSupportPillars(); } catch {}
    }
    // TPU 95A guardrail: 0.08/0.12mm jam flexible filament — force 0.20mm Standard
    if (selectedMaterialType === 'tpu') {
      setLayerHeightMm((prev) => {
        const v = prev ?? (selectedProfile === 'draft' ? 0.24 : selectedProfile === 'heavy-duty' ? 0.16 : 0.2);
        if (v < 0.16) return 0.2;
        if (v > 0.24) return 0.2;
        return prev;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMaterialType]);

  // One-shot Z scan sweep up to the seated model top on every load.
  const startScan = (topY) => {
    const mesh = scanMeshRef.current;
    if (!mesh) return;
    mesh.visible = true;
    mesh.position.y = 0.2;
    scanRef.current = {
      active: true,
      t0: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      dur: 1800,
      maxY: Math.max(topY, 4),
    };
  };

  // Project seated-bounds anchors to screen space for the coordinate tags.
  // Direct DOM writes (no React state) keep this at full frame rate.
  const updateTags = (camera) => {
    const container = mountRef.current;
    const tags = tagRefs.current;
    const mesh = currentMeshRef.current;
    const keys = ['bbox', 'weight', 'price', 'zscan', 'overhang'];
    keys.forEach((k) => {
      if (tags[k]) tags[k].style.display = 'none';
    });
    if (!mesh || !camera || !container || !faceDataRef.current) return;
    let box = seatedBoxRef.current;
    if (orientAnimRef.current && orientAnimRef.current.active) {
      mesh.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(mesh);
      seatedBoxRef.current = box.clone();
    }
    if (!box) return;
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    const v = new THREE.Vector3();
    const place = (el, x, y, z) => {
      v.set(x, y, z).project(camera);
      if (v.z > 1 || v.z < -1) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'block';
      el.style.left = `${((v.x * 0.5 + 0.5) * w).toFixed(1)}px`;
      el.style.top = `${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px`;
    };
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (tags.bbox) {
      tags.bbox.textContent = `BOUNDING BOX: ${size.x.toFixed(0)}×${size.y.toFixed(0)}×${size.z.toFixed(0)}MM`;
      place(tags.bbox, center.x, box.max.y + 8, center.z);
    }
    if (tags.weight) {
      tags.weight.textContent = `EST. WEIGHT: ${Number(weightRef.current).toFixed(1)}G`;
      place(tags.weight, box.max.x + 10, center.y, center.z);
    }
    if (tags.price) {
      tags.price.textContent = `EST. PRICE: ₹${Number(costRef.current).toFixed(0)}`;
      place(tags.price, box.min.x - 10, center.y, center.z);
    }
    const scan = scanRef.current;
    if (tags.zscan) {
      if (scan && scan.active && scanMeshRef.current) {
        const y = scanMeshRef.current.position.y;
        tags.zscan.textContent = `+ Z-OVERLAY ${y.toFixed(0)}MM`;
        place(tags.zscan, center.x, y, box.max.z + 8);
      } else {
        tags.zscan.style.display = 'none';
      }
    }
    if (tags.overhang) {
      const need = showSupportsRef.current && (statsRef.current?.supportArea ?? 0) > 1;
      if (need) {
        tags.overhang.textContent = 'OVERHANG HAZARDS';
        place(tags.overhang, center.x, Math.max(box.min.y - 2, 0.5), box.max.z + 6);
      } else {
        tags.overhang.style.display = 'none';
      }
    }
  };

  // Render STL or 3MF geometry into the Three.js scene with slicer-style analysis.
  // Supports single meshes and multi-part No-AMS snap-fit assemblies (contrasting dual-color plates).
  const renderStlGeometry = (arrayBuffer, multiPartBuffers = null, targetFileName = null) => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Cancel any in-flight orientation/explode animation and reset analysis state
    orientAnimRef.current = null;
    if (explodeAnimRef.current) {
      cancelAnimationFrame(explodeAnimRef.current);
      explodeAnimRef.current = null;
    }
    setExplodedProgress(0);
    setIsExploded(false);
    setIsOrienting(false);
    // New geometry is not mounted yet — drop back to standby until scene.add.
    setMeshReady(false);
    setProceduralMeta(null);
    faceDataRef.current = null;
    printBoxRef.current = null;
    orientQuatRef.current = { ...IDENTITY_QUAT };
    setSupportStats(null);
    setOrientResult(null);
    setPolyCount(null);

    // Remove previous mesh if present
    if (currentMeshRef.current) {
      scene.remove(currentMeshRef.current);
      if (currentMeshRef.current.isGroup) {
        disposeObjectGroup(currentMeshRef.current);
      } else {
        if (currentMeshRef.current.geometry) currentMeshRef.current.geometry.dispose();
        if (currentMeshRef.current.material) currentMeshRef.current.material.dispose();
      }
      currentMeshRef.current = null;
    }

    try {
      const lowerName = (targetFileName || fileName || '').toLowerCase();
      const is3mf = lowerName.endsWith('.3mf') ||
        (arrayBuffer && new Uint8Array(arrayBuffer)[0] === 0x50 && new Uint8Array(arrayBuffer)[1] === 0x4B);

      let geometry;
      const stlLoader = new STLLoader();
      if (is3mf) {
        const threeMFLoader = new ThreeMFLoader();
        const group = threeMFLoader.parse(arrayBuffer);
        const geometries = [];
        group.traverse((child) => {
          if (child.isMesh && child.geometry) {
            let geo = child.geometry.clone();
            if (geo.index) geo = geo.toNonIndexed();
            child.updateMatrixWorld(true);
            geo.applyMatrix4(child.matrixWorld);
            geometries.push(geo);
          }
        });
        if (geometries.length === 0) {
          throw new Error('No mesh data found in 3MF archive.');
        }
        geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
      } else {
        geometry = stlLoader.parse(arrayBuffer);
      }

      if (geometry.index) geometry = geometry.toNonIndexed();
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      geometry.computeBoundsTree();

      const bb = geometry.boundingBox;
      const rawDim = {
        x: bb.max.x - bb.min.x,
        y: bb.max.y - bb.min.y,
        z: bb.max.z - bb.min.z,
      };
      rawDimensionsRef.current = rawDim;
      setRawDimensions(rawDim);
      setScalePercent(100);
      setIsInchConverted(false);

      const maxDim = Math.max(rawDim.x, rawDim.y, rawDim.z);
      if (maxDim < 12) {
        setIsTinyModel(true);
      } else {
        setIsTinyModel(false);
      }
      // Slicer analysis in print space: per-face normals/areas + overhang flags
      const faceData = computeFaceData(geometry.getAttribute('position').array);
      faceDataRef.current = faceData;
      setPolyCount(faceData.count);

      printBoxRef.current = {
        min: { x: bb.min.x, y: bb.min.y, z: bb.min.z },
        max: { x: bb.max.x, y: bb.max.y, z: bb.max.z },
      };
      applySupportColors(geometry, faceData, IDENTITY_QUAT);
      const scored = evaluatePose(faceData, IDENTITY_QUAT, printBoxRef.current);
      setSupportStats({
        overhangArea: scored.overhangArea,
        fraction: scored.overhangFraction,
        contactArea: scored.contactArea,
        supportArea: scored.supportArea,
      });

      // Web Worker off-thread analysis using transferable Float32Array buffers
      if (workerRef.current && geometry.getAttribute('position')) {
        try {
          const rawPos = geometry.getAttribute('position').array;
          const posCopy = new Float32Array(rawPos);
          const reqId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
          workerRef.current.onmessage = (e) => {
            if (e.data && e.data.id === reqId && e.data.success) {
              const { overhangMetrics } = e.data.result;
              if (overhangMetrics) {
                setSupportStats({
                  overhangArea: overhangMetrics.overhangArea,
                  fraction: overhangMetrics.overhangPercent / 100,
                  contactArea: overhangMetrics.bedContactArea,
                  supportArea: overhangMetrics.supportNeededArea,
                });
              }
            }
          };
          workerRef.current.postMessage(
            {
              id: reqId,
              type: 'ANALYZE_POSITIONS',
              payload: {
                positions: posCopy,
                options: { currentQuat: IDENTITY_QUAT },
              },
            },
            [posCopy.buffer]
          );
        } catch (workerErr) {
          console.warn('Worker offload fallback to main thread:', workerErr);
        }
      }

      // Client-side signed tetrahedron volume and surface area calculation
      const posArray = geometry.getAttribute('position').array;
      let signedVol = 0;
      const triCount = Math.floor(posArray.length / 9);
      for (let i = 0; i < triCount; i++) {
        const o = i * 9;
        const ax = posArray[o], ay = posArray[o + 1], az = posArray[o + 2];
        const bx = posArray[o + 3], by = posArray[o + 4], bz = posArray[o + 5];
        const cx = posArray[o + 6], cy = posArray[o + 7], cz = posArray[o + 8];
        signedVol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
      }
      let volMm3 = Math.abs(signedVol) / 6;
      if (!volMm3 || volMm3 < 1) {
        volMm3 = (rawDim.x * rawDim.y * rawDim.z) * 0.4;
      }
      const surfAreaMm2 = faceData.totalArea > 0 ? faceData.totalArea : (6 * Math.cbrt(volMm3) ** 2);

      // Check if raw model dimensions exceed 180x180x180 build boundary
      const isOverBuildVolume = rawDim.x > STANDARD_BUILD_LIMIT.x || rawDim.y > STANDARD_BUILD_LIMIT.y || rawDim.z > STANDARD_BUILD_LIMIT.z;
      if (isOverBuildVolume) {
        setError('Model exceeds the maximum build volume of 180 × 180 × 180 mm.');
        setQuoteData({
          success: false,
          error: 'build_volume_exceeded',
          message: 'Model exceeds the maximum build volume of 180 × 180 × 180 mm.',
          dimensions: rawDim,
          boundingBox: rawDim,
        });
        setHasActiveModel(false);
      } else {
        setHasActiveModel(true);
        const computedQuote = {
          success: true,
          currency: 'INR',
          orderId: 'ORD-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
          fileName: targetFileName || fileName || 'model.stl',
          volumeMm3: Math.round(volMm3),
          surfaceAreaMm2: Math.round(surfAreaMm2),
          dimensions: rawDim,
          boundingBox: rawDim,
          material: selectedMaterialType,
          profile: selectedProfile,
          layerHeightMm: layerHeightMm || 0.20,
          infillPercent: infillPercent || 20,
          quantity: partQuantity || 1,
          supportsEnabled: Boolean(supportsEnabled),
          clientCalculated: true,
        };
        setQuoteData((prev) => {
          if (prev && prev.success && prev.totalPrice) {
            return { ...prev, dimensions: rawDim, boundingBox: rawDim, volumeMm3: Math.round(volMm3), surfaceAreaMm2: Math.round(surfAreaMm2) };
          }
          return computedQuote;
        });

        // Persist to quoteStore
        saveActiveQuote({
          fileName: targetFileName || fileName || 'model.stl',
          dimensions: rawDim,
          volumeMm3: Math.round(volMm3),
          surfaceAreaMm2: Math.round(surfAreaMm2),
          settings: {
            materialType: selectedMaterialType,
            profile: selectedProfile,
            infillPercent,
            layerHeightMm,
            supportsEnabled,
            quantity: partQuantity,
            material: selectedMaterial,
            accentMaterial: selectedAccentMaterial,
            scalePercent,
            addOns,
          },
          quoteData: computedQuote,
          buffer: arrayBuffer,
        });
      }

      // Persist uploaded model buffer & settings to IndexedDB
      if (arrayBuffer) {
        saveWorkspaceModel({
          buffer: arrayBuffer,
          fileName: targetFileName || fileName || 'model.stl',
          fileType: is3mf ? '3mf' : 'stl',
          settings: {
            materialType: selectedMaterialType,
            profile: selectedProfile,
            quantity: partQuantity,
            material: selectedMaterial,
            accentMaterial: selectedAccentMaterial,
            scalePercent: 100,
            addOns,
          },
        });
      }

      const activePreset = MATERIAL_PRESETS.find((p) => p.name === selectedMaterial) || MATERIAL_PRESETS[0];
      const accentPreset = MATERIAL_PRESETS.find((p) => p.name === selectedAccentMaterial) || getContrastPreset(activePreset.name);

      let rootObject;

      if (multiPartBuffers && multiPartBuffers.baseBuffer && multiPartBuffers.accentBuffer) {
        let baseGeo = stlLoader.parse(multiPartBuffers.baseBuffer);
        if (baseGeo.index) baseGeo = baseGeo.toNonIndexed();
        baseGeo.computeVertexNormals();
        baseGeo.computeBoundingBox();
        baseGeo.computeBoundingSphere();
        baseGeo.computeBoundsTree();

        let accentGeo = stlLoader.parse(multiPartBuffers.accentBuffer);
        if (accentGeo.index) accentGeo = accentGeo.toNonIndexed();
        accentGeo.computeVertexNormals();
        accentGeo.computeBoundingBox();
        accentGeo.computeBoundingSphere();
        accentGeo.computeBoundsTree();

        const baseFaceData = computeFaceData(baseGeo.getAttribute('position').array);
        applySupportColors(baseGeo, baseFaceData, IDENTITY_QUAT);

        const accentFaceData = computeFaceData(accentGeo.getAttribute('position').array);
        applySupportColors(accentGeo, accentFaceData, IDENTITY_QUAT);

        const fdmBump = createFDMLayerBumpTexture();
        const baseMat = new THREE.MeshPhysicalMaterial({
          color: showSupports ? 0xffffff : activePreset.hex,
          vertexColors: showSupports,
          wireframe: isWireframe,
          roughness: activePreset.roughness,
          metalness: activePreset.metalness,
          clearcoat: 0.28,
          clearcoatRoughness: 0.2,
          bumpMap: fdmBump || null,
          bumpScale: 0.015,
          clippingPlanes: crossSectionActive && crossSectionProgress < 100 ? [clipPlaneRef.current] : [],
          clipShadows: true,
        });

        const accentMat = new THREE.MeshPhysicalMaterial({
          color: showSupports ? 0xffffff : accentPreset.hex,
          vertexColors: showSupports,
          wireframe: isWireframe,
          roughness: accentPreset.roughness,
          metalness: accentPreset.metalness,
          clearcoat: 0.28,
          clearcoatRoughness: 0.2,
          bumpMap: fdmBump || null,
          bumpScale: 0.015,
          clippingPlanes: crossSectionActive && crossSectionProgress < 100 ? [clipPlaneRef.current] : [],
          clipShadows: true,
        });

        const baseMesh = new THREE.Mesh(baseGeo, baseMat);
        baseMesh.name = 'base';
        baseMesh.castShadow = true;
        baseMesh.receiveShadow = true;
        baseMesh.userData = { faceData: baseFaceData };

        const accentMesh = new THREE.Mesh(accentGeo, accentMat);
        accentMesh.name = 'accent';
        accentMesh.castShadow = true;
        accentMesh.receiveShadow = true;
        accentMesh.userData = { faceData: accentFaceData };

        // Honest physical sub-assembly names for the two genuine plates
        try {
          const plateNames = getPartNamesForDesign(targetFileName || fileName || '');
          baseMesh.userData.partName = plateNames.base;
          accentMesh.userData.partName = plateNames.accent;
        } catch {}

        const group = new THREE.Group();
        group.add(baseMesh);
        group.add(accentMesh);
        group.quaternion.copy(buildPrintToSceneQuat());
        scene.add(group);
        rootObject = group;

        setMultiPartMeta({
          assemblyType: multiPartBuffers.assemblyType || 'snap-fit',
          baseTriangles: baseFaceData.count,
          accentTriangles: accentFaceData.count,
        });
        setAssemblyKind('multi-part');
        setCanExplode(true);
        setShellInfo({ shellCount: 2, source: 'catalog-multi-part' });
        setExplodedProgress(0);
        setIsExploded(false);
      } else {
        // Honest connected-shell detection: never fake-slice a 1-body monolith
        let shellCount = 1;
        try {
          const analysis = analyzeMeshShells(geometry, 0.02);
          shellCount = analysis.shellCount;
          setShellInfo({ shellCount, source: 'stl-shell-scan' });
          const pending = pendingAssemblyRef.current;
          if (analysis.shellCount >= 2) {
            setAssemblyKind('multi-part');
            setCanExplode(true);
          } else if (pending && pending.assemblyKind) {
            setAssemblyKind(pending.assemblyKind);
            setCanExplode(Boolean(pending.canExplode));
          } else {
            setAssemblyKind('single-piece');
            setCanExplode(false);
          }
        } catch {
          setShellInfo({ shellCount: 1, source: 'stl-shell-scan-fallback' });
          setAssemblyKind('single-piece');
          setCanExplode(false);
        }
        setExplodedProgress(0);
        setIsExploded(false);
        const fdmBump = createFDMLayerBumpTexture();
        const material = new THREE.MeshPhysicalMaterial({
          color: showSupports ? 0xffffff : activePreset.hex,
          vertexColors: showSupports,
          wireframe: isWireframe,
          roughness: activePreset.roughness,
          metalness: activePreset.metalness,
          clearcoat: 0.28,
          clearcoatRoughness: 0.2,
          bumpMap: fdmBump || null,
          bumpScale: 0.015,
          clippingPlanes: crossSectionActive && crossSectionProgress < 100 ? [clipPlaneRef.current] : [],
          clipShadows: true,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.quaternion.copy(buildPrintToSceneQuat());
        scene.add(mesh);
        rootObject = mesh;
        setMultiPartMeta(null);
      }

      currentMeshRef.current = rootObject;
      // Mesh is 100% mounted in the scene here — badge, telemetry and receipt
      // may now appear in the same tick (zero desync).
      setMeshReady(true);

      // Seat on the build plate
      const seatedBox = seatMeshOnPlate(rootObject);
      const size = seatedBox.getSize(new THREE.Vector3());

      // Update unified bounding box (width x depth x height)
      const unifiedDims = {
        x: Number(size.x.toFixed(1)),
        y: Number(size.z.toFixed(1)),
        z: Number(size.y.toFixed(1)),
      };
      setRawDimensions(unifiedDims);
      rawDimensionsRef.current = unifiedDims;

      if (rootObject.isGroup) {
        const allPos = [];
        rootObject.traverse((c) => {
          if (c.isMesh && c.geometry) {
            const p = c.geometry.getAttribute('position');
            if (p) allPos.push(...p.array);
          }
        });
        if (allPos.length > 0) {
          const groupFaceData = computeFaceData(new Float32Array(allPos));
          faceDataRef.current = groupFaceData;
          setPolyCount(groupFaceData.count);
          printBoxRef.current = {
            min: { x: seatedBox.min.x, y: seatedBox.min.z, z: seatedBox.min.y },
            max: { x: seatedBox.max.x, y: seatedBox.max.z, z: seatedBox.max.y },
          };
        }
      }

      // Arena overlays: wireframe bounds + one-shot Z scan sweep
      refreshOverlays();
      updateCrossSection(crossSectionActive, crossSectionProgress);
      startScan(size.y);

      // Dynamic Camera Auto-Framing: frame cleanly with >20% padding
      fitCameraToObject(cameraRef.current, controlsRef.current, rootObject, 0.70);

      // Build live 3D support pillars + slicer-accurate support weight
      try {
        regenerateSupportPillars();
      } catch (pillarErr) {
        console.warn('Support pillar generation failed:', pillarErr);
      }
    } catch (parseErr) {
      console.error('Three.js STLLoader error:', parseErr);
      setError('Failed to parse 3D geometry in Three.js: ' + parseErr.message);
    }
  };

  // Camera view presets (unit direction from the orbit target). Bottom dips
  // below the plate so operators can inspect undersides and support warnings.
  const handleViewPreset = (name) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const dirs = {
      top: [0, 1, 0.001],
      front: [0, 0.32, 1],
      bottom: [0, -0.72, 0.7],
      iso: [0.62, 0.55, 0.72],
    };
    const dir = new THREE.Vector3(...(dirs[name] || dirs.iso)).normalize();
    const dist = Math.min(
      Math.max(camera.position.distanceTo(controls.target), 60),
      600
    );
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    camera.lookAt(controls.target);
    controls.update();
  };

  // Toggle the Red/Coral support-warning overlay on and off
  const handleToggleSupports = (e) => {
    const next = e.target.checked;
    setShowSupports(next);
    updateMeshMaterial(selectedMaterial, selectedAccentMaterial, isWireframe, next);
  };

  // Switch filament material preview
  const handleSelectMaterial = (preset) => {
    if (canExplode && multiPartMeta && !multiPartMeta.procedural && activePlate === 'accent') {
      setSelectedAccentMaterial(preset.name);
      updateMeshMaterial(selectedMaterial, preset.name, isWireframe, showSupports);
    } else {
      setSelectedMaterial(preset.name);
      setColorChoice(preset.name);
      updateMeshMaterial(preset.name, selectedAccentMaterial, isWireframe, showSupports);
    }
    if (showSupports) {
      setShowSupports(false);
      updateMeshMaterial(
        multiPartMeta && !multiPartMeta.procedural && activePlate === 'accent' ? selectedMaterial : preset.name,
        multiPartMeta && !multiPartMeta.procedural && activePlate === 'accent' ? preset.name : selectedAccentMaterial,
        isWireframe,
        false
      );
    }
  };

  // Toggle wireframe mode
  const handleToggleWireframe = () => {
    const next = !isWireframe;
    setIsWireframe(next);
    updateMeshMaterial(selectedMaterial, selectedAccentMaterial, next, showSupports);
  };

  // Toggle 360-degree auto-rotation
  const handleToggleAutoSpin = () => {
    setAutoSpin((prev) => !prev);
  };

  // Reset camera to default isometric view
  const handleResetCamera = () => {
    if (currentMeshRef.current) {
      fitCameraToObject(cameraRef.current, controlsRef.current, currentMeshRef.current, 0.70);
    } else {
      handleViewPreset('iso');
    }
  };

  // 5-way D-pad manual camera orbit / pitch / pan
  const handleDpadMove = (direction) => {
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    if (!controls || !camera) return;
    const step = 0.22;
    if (direction === 'left') {
      const pos = camera.position.clone().sub(controls.target);
      pos.applyAxisAngle(new THREE.Vector3(0, 1, 0), step);
      camera.position.copy(controls.target).add(pos);
    } else if (direction === 'right') {
      const pos = camera.position.clone().sub(controls.target);
      pos.applyAxisAngle(new THREE.Vector3(0, 1, 0), -step);
      camera.position.copy(controls.target).add(pos);
    } else if (direction === 'up') {
      camera.position.y += 20;
    } else if (direction === 'down') {
      camera.position.y = Math.max(camera.position.y - 20, 15);
    } else if (direction === 'center') {
      handleResetCamera();
    }
    camera.lookAt(controls.target);
    controls.update();
  };

  // Slicer-grade Auto-Orient for Best Print:
  // Evaluates orthogonal CAD orientations minimizing the true FDM penalty cost:
  // S = (supportVolumeMm3 * 2.5) + (heightZ^2 * 8.0) - (bedContactAreaMm2 * 4.0) - (footprintAreaMm2 * 0.5)
  // Handles single meshes AND multi-part THREE.Group assemblies (e.g. ESP32 Case, Mecha, Gears).
  const handleAutoOrient = async () => {
    const mesh = currentMeshRef.current;
    if (!mesh || isOrienting) return;

    setIsOrienting(true);
    await new Promise((resolve) => setTimeout(resolve, 30));

    try {
      mesh.updateMatrixWorld(true);
      const initialBox = new THREE.Box3().setFromObject(mesh);
      const initialSize = initialBox.getSize(new THREE.Vector3());
      const heightBefore = initialSize.y;
      const supportBeforeG = supportWeightRef.current?.supportWeightGrams ?? (slicerQuote?.supportWeightGrams ?? 0);

      // Collect all triangles in local root space (merges all child meshes for groups)
      const triangles = [];
      const rootInv = mesh.matrixWorld.clone().invert();
      mesh.traverse((child) => {
        if (child.isMesh && child.geometry) {
          const posAttr = child.geometry.getAttribute('position');
          if (!posAttr) return;
          const childM = child.matrixWorld.clone().premultiply(rootInv);
          const pos = posAttr.array;
          const triCount = Math.floor(pos.length / 9);
          const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
          for (let i = 0; i < triCount; i++) {
            const o = i * 9;
            vA.set(pos[o], pos[o + 1], pos[o + 2]).applyMatrix4(childM);
            vB.set(pos[o + 3], pos[o + 4], pos[o + 5]).applyMatrix4(childM);
            vC.set(pos[o + 6], pos[o + 7], pos[o + 8]).applyMatrix4(childM);
            triangles.push({
              ax: vA.x, ay: vA.y, az: vA.z,
              bx: vB.x, by: vB.y, bz: vB.z,
              cx: vC.x, cy: vC.y, cz: vC.z,
            });
          }
        }
      });

      if (triangles.length === 0) {
        setIsOrienting(false);
        return;
      }

      // Orthogonal CAD candidate rotations (Euler XYZ in local root space):
      // Primary 6 orthogonal directions + 24 full orthogonal cube poses:
      const candidateRotations = [
        new THREE.Euler(0, 0, 0),
        new THREE.Euler(Math.PI / 2, 0, 0),
        new THREE.Euler(-Math.PI / 2, 0, 0),
        new THREE.Euler(Math.PI, 0, 0),
        new THREE.Euler(0, 0, Math.PI / 2),
        new THREE.Euler(0, 0, -Math.PI / 2),
        new THREE.Euler(0, Math.PI / 2, 0),
        new THREE.Euler(0, -Math.PI / 2, 0),
        new THREE.Euler(0, Math.PI, 0),
        new THREE.Euler(Math.PI / 2, Math.PI / 2, 0),
        new THREE.Euler(Math.PI / 2, -Math.PI / 2, 0),
        new THREE.Euler(-Math.PI / 2, Math.PI / 2, 0),
        new THREE.Euler(-Math.PI / 2, -Math.PI / 2, 0),
        new THREE.Euler(Math.PI / 2, 0, Math.PI / 2),
        new THREE.Euler(Math.PI / 2, 0, -Math.PI / 2),
        new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2),
        new THREE.Euler(-Math.PI / 2, 0, -Math.PI / 2),
        new THREE.Euler(0, Math.PI / 2, Math.PI / 2),
        new THREE.Euler(0, Math.PI / 2, -Math.PI / 2),
        new THREE.Euler(0, -Math.PI / 2, Math.PI / 2),
        new THREE.Euler(0, -Math.PI / 2, -Math.PI / 2),
        new THREE.Euler(Math.PI, Math.PI / 2, 0),
        new THREE.Euler(Math.PI, -Math.PI / 2, 0),
        new THREE.Euler(Math.PI, 0, Math.PI / 2),
      ];

      let bestScore = Infinity;
      let bestEuler = candidateRotations[0];
      let bestQuat = new THREE.Quaternion().setFromEuler(bestEuler);
      let bestMetrics = null;
      let identityMetrics = null;

      const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
      const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();

      for (const euler of candidateRotations) {
        const qCand = new THREE.Quaternion().setFromEuler(euler);
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        // Step 1: find rotated bounds
        for (let i = 0; i < triangles.length; i++) {
          const t = triangles[i];
          vA.set(t.ax, t.ay, t.az).applyQuaternion(qCand);
          vB.set(t.bx, t.by, t.bz).applyQuaternion(qCand);
          vC.set(t.cx, t.cy, t.cz).applyQuaternion(qCand);

          if (vA.x < minX) minX = vA.x; if (vA.x > maxX) maxX = vA.x;
          if (vA.y < minY) minY = vA.y; if (vA.y > maxY) maxY = vA.y;
          if (vA.z < minZ) minZ = vA.z; if (vA.z > maxZ) maxZ = vA.z;

          if (vB.x < minX) minX = vB.x; if (vB.x > maxX) maxX = vB.x;
          if (vB.y < minY) minY = vB.y; if (vB.y > maxY) maxY = vB.y;
          if (vB.z < minZ) minZ = vB.z; if (vB.z > maxZ) maxZ = vB.z;

          if (vC.x < minX) minX = vC.x; if (vC.x > maxX) maxX = vC.x;
          if (vC.y < minY) minY = vC.y; if (vC.y > maxY) maxY = vC.y;
          if (vC.z < minZ) minZ = vC.z; if (vC.z > maxZ) maxZ = vC.z;
        }

        const heightZ = maxY - minY;
        const footprintAreaMm2 = (maxX - minX) * (maxZ - minZ);
        let bedContactAreaMm2 = 0;
        let supportVolumeMm3 = 0;
        let overhangArea = 0;
        let totalArea = 0;

        // Step 2: compute slicer metrics with build plate at minY
        for (let i = 0; i < triangles.length; i++) {
          const t = triangles[i];
          vA.set(t.ax, t.ay, t.az).applyQuaternion(qCand);
          vB.set(t.bx, t.by, t.bz).applyQuaternion(qCand);
          vC.set(t.cx, t.cy, t.cz).applyQuaternion(qCand);

          ab.subVectors(vB, vA);
          ac.subVectors(vC, vA);
          n.crossVectors(ab, ac);
          const len = n.length();
          const area = len / 2;
          totalArea += area;
          if (len > 0) n.divideScalar(len);

          const cy = (vA.y + vB.y + vC.y) / 3;
          const relY = cy - minY;

          // Downward face: ny < -0.7071
          if (n.y < -0.7071) {
            overhangArea += area;
            if (relY > 1.2) {
              supportVolumeMm3 += area * Math.abs(n.y) * relY;
            }
          }

          // Bottom bed contact: ny < -0.85 and relY <= 0.8mm
          if (n.y < -0.85 && relY <= 0.8) {
            bedContactAreaMm2 += area;
          }
        }

        // True 4-Factor Slicer Cost Function (Lower is Better):
        // S = (supportVolumeMm3 * 2.5) + (heightZ^2 * 8.0) - (bedContactAreaMm2 * 4.0) - (footprintAreaMm2 * 0.5)
        const penalty =
          supportVolumeMm3 * 2.5 +
          heightZ * heightZ * 8.0 -
          bedContactAreaMm2 * 4.0 -
          footprintAreaMm2 * 0.5;

        const metrics = {
          heightZ,
          footprintAreaMm2,
          bedContactAreaMm2,
          supportVolumeMm3,
          overhangFraction: totalArea > 0 ? overhangArea / totalArea : 0,
          penalty,
          width: maxX - minX,
          depth: maxZ - minZ,
        };

        // candidates[0] is the untouched pose, so it doubles as our baseline.
        if (identityMetrics === null) identityMetrics = metrics;

        if (penalty < bestScore) {
          bestScore = penalty;
          bestEuler = euler;
          bestQuat = qCand;
          bestMetrics = metrics;
        }
      }

      // Check current pose metrics for comparison
      const q0 = mesh.quaternion.clone();
      const p0 = mesh.position.clone();
      const targetQuat = bestQuat.clone();

      // Test winning pose position and bounds
      mesh.quaternion.copy(targetQuat);
      mesh.updateMatrixWorld(true);
      const seatedTest = seatMeshOnPlate(mesh);
      const testSize = seatedTest.getSize(new THREE.Vector3());
      const p1 = mesh.position.clone();
      mesh.quaternion.copy(q0);
      mesh.position.copy(p0);

      const heightAfter = Number(testSize.y.toFixed(1));
      const widthAfter = Number(testSize.x.toFixed(1));
      const depthAfter = Number(testSize.z.toFixed(1));

      // A pose only counts as "re-oriented" when it buys a real geometric win:
      // a shorter build height, a measurably cheaper slicer cost, or fewer
      // overhangs. A bare quaternion delta must NOT trigger the animation or
      // claim "saved time" — symmetric parts (e.g. a cube) tie with the identity
      // pose and are already optimal.
      const penaltyImprovement =
        bestMetrics && identityMetrics ? identityMetrics.penalty - bestMetrics.penalty : 0;
      const penaltyThreshold = Math.max(1e-3, Math.abs(identityMetrics?.penalty ?? 0) * 0.01);

      const isSignificantlyRotated =
        heightBefore - heightAfter > 0.5 ||
        penaltyImprovement > penaltyThreshold ||
        (bestMetrics && bestMetrics.overhangFraction < (supportStats?.fraction ?? 0) - 0.02);

      const rateForSave = getActiveDensity() === 1.27 ? 2.5 : getActiveDensity() === 1.21 ? 3.5 : 2.0;

      if (!isSignificantlyRotated) {
        setIsOrienting(false);
        setOrientResult({
          rotated: false,
          widthMm: widthAfter,
          depthMm: depthAfter,
          heightMm: heightAfter,
          supportGrams: supportBeforeG,
        });
        try { regenerateSupportPillars(); } catch {}
        return;
      }

      // Smooth quaternion slerp transition into winning flat orientation
      orientAnimRef.current = {
        active: true,
        t0: typeof performance !== 'undefined' ? performance.now() : Date.now(),
        dur: 750,
        q0,
        q1: targetQuat,
        p0,
        p1,
        onDone: () => {
          if (currentMeshRef.current) {
            const finalSeated = seatMeshOnPlate(currentMeshRef.current);
            const sz = finalSeated.getSize(new THREE.Vector3());
            const finalW = Number(sz.x.toFixed(1));
            const finalD = Number(sz.z.toFixed(1));
            const finalH = Number(sz.y.toFixed(1));

            // Unified bounding box update: card, Z-slicer, quoter all agree!
            const unifiedDims = { x: finalW, y: finalD, z: finalH };
            setRawDimensions(unifiedDims);
            rawDimensionsRef.current = unifiedDims;

            // Clear auto-brim if model is now flat / squat
            if (finalH <= 55 || finalH / Math.max(0.01, Math.min(finalW, finalD)) < 2.0) {
              setAutoBrim(false);
              setBrimDismissed(true);
            }

            // Re-color overhangs
            currentMeshRef.current.traverse((c) => {
              if (c.isMesh && c.geometry) {
                try {
                  const fd = computeFaceData(c.geometry.getAttribute('position').array);
                  c.userData.faceData = fd;
                  applySupportColors(c.geometry, fd, IDENTITY_QUAT);
                } catch {}
              }
            });

            refreshOverlays();
            updateCrossSection(crossSectionActive, crossSectionProgress);

            try {
              regenerateSupportPillars();
              const afterG = supportWeightRef.current?.supportWeightGrams ?? 0;
              const savedG = Math.max(0, supportBeforeG - afterG);
              const savedInr = Math.round(savedG * rateForSave + (savedG / 12) * 25);
              const savedMins = Math.round((savedG / 12) * 60);

              // Tilt telemetry for the arena-header tooltip (angle + dominant axis).
              const tiltDeg = THREE.MathUtils.radToDeg(q0.angleTo(targetQuat));
              const qDelta = q0.clone().invert().multiply(targetQuat);
              const sinHalf = Math.sqrt(Math.max(0, 1 - qDelta.w * qDelta.w));
              let tiltAxis = 'Z';
              if (sinHalf > 1e-4) {
                const axAbs = Math.abs(qDelta.x), ayAbs = Math.abs(qDelta.y), azAbs = Math.abs(qDelta.z);
                tiltAxis = axAbs >= ayAbs && axAbs >= azAbs ? 'X' : ayAbs >= azAbs ? 'Y' : 'Z';
              }
              const fromPct = (supportStats?.fraction ?? 0) * 100;
              const toPct = bestMetrics ? bestMetrics.overhangFraction * 100 : fromPct;

              setOrientResult({
                rotated: true,
                tiltDeg,
                tiltAxis,
                fromPct,
                toPct,
                heightBefore: Number(heightBefore.toFixed(1)),
                heightAfter: finalH,
                supportBeforeG,
                supportAfterG: afterG,
                savedG,
                savedInr,
                savedMins: Math.max(15, savedMins),
                widthMm: finalW,
                depthMm: finalD,
                heightMm: finalH,
              });
            } catch {}
          }
          setIsOrienting(false);
        },
      };
    } catch (orientErr) {
      console.error('Auto-orient failed:', orientErr);
      setIsOrienting(false);
    }
  };

  // Process file upload and request /api/quote simultaneously
  const processStlFile = async (file, multiPartBuffers = null) => {
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.stl') && !lower.endsWith('.3mf')) {
      setError('Please upload a valid .stl or .3mf file.');
      return;
    }

    setFileName(file.name);
    setLoading(true);
    setError(null);
    setConfirmedOrder(null);
    setConfirmationError(null);
    setDeliveryQuote(null);
    setDeliveryError(null);

    // If multiPartBuffers wasn't provided, check if companion multi-part STLs exist for this model
    let resolvedMultiPart = multiPartBuffers;
    if (!resolvedMultiPart) {
      if (lower.includes('mecha')) {
        try {
          const [bRes, aRes] = await Promise.all([
            fetch('/models/posable-snap-fit-mecha-base.stl'),
            fetch('/models/posable-snap-fit-mecha-accent.stl'),
          ]);
          if (bRes.ok && aRes.ok) {
            const [bBuf, aBuf] = await Promise.all([bRes.arrayBuffer(), aRes.arrayBuffer()]);
            resolvedMultiPart = { baseBuffer: bBuf, accentBuffer: aBuf, assemblyType: 'snap-fit' };
          }
        } catch (_) {}
      } else if (lower.includes('esp32')) {
        try {
          const [bRes, aRes] = await Promise.all([
            fetch('/models/esp32-wled-controller-case-base.stl'),
            fetch('/models/esp32-wled-controller-case-accent.stl'),
          ]);
          if (bRes.ok && aRes.ok) {
            const [bBuf, aBuf] = await Promise.all([bRes.arrayBuffer(), aRes.arrayBuffer()]);
            resolvedMultiPart = { baseBuffer: bBuf, accentBuffer: aBuf, assemblyType: 'snap-fit' };
          }
        } catch (_) {}
      } else if (lower.includes('planetary')) {
        try {
          const [bRes, aRes] = await Promise.all([
            fetch('/models/planetary-gear-fidget-spinner-base.stl'),
            fetch('/models/planetary-gear-fidget-spinner-accent.stl'),
          ]);
          if (bRes.ok && aRes.ok) {
            const [bBuf, aBuf] = await Promise.all([bRes.arrayBuffer(), aRes.arrayBuffer()]);
            resolvedMultiPart = { baseBuffer: bBuf, accentBuffer: aBuf, assemblyType: 'print-in-place' };
          }
        } catch (_) {}
      }
    }

    // 1. Read file as ArrayBuffer for Three.js client-side rendering
    const reader = new FileReader();
    reader.onload = (e) => {
      renderStlGeometry(e.target.result, resolvedMultiPart, file.name);
    };
    reader.onerror = () => {
      setError('Could not read file locally.');
    };
    reader.readAsArrayBuffer(file);

    // 2. Send file to /api/quote backend endpoint (direct to Supabase Storage if > 4MB to bypass Vercel 4.5MB limit)
    try {
      let response;
      let directUploadedPath = null;

      // Bypassing Vercel 4.5MB limit: If file is > 4MB, attempt direct upload to Supabase Storage
      if (file.size > 4 * 1024 * 1024) {
        try {
          const cfgRes = await fetch('/api/storage/config');
          if (cfgRes.ok) {
            const cfg = await cfgRes.json();
            if (cfg.enabled && cfg.url && cfg.anonKey) {
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              const unique = Math.random().toString(36).substring(2, 8);
              const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
              const storageKey = `uploads/${timestamp}-${unique}-${safeName}`;
              const is3mf = file.name.toLowerCase().endsWith('.3mf');
              const contentType = is3mf ? 'model/3mf' : 'model/stl';

              const directRes = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket || 'stl-uploads'}/${storageKey}`, {
                method: 'POST',
                headers: {
                  'apikey': cfg.anonKey,
                  'Authorization': `Bearer ${cfg.anonKey}`,
                  'Content-Type': contentType,
                  'x-upsert': 'true',
                },
                body: file,
              });

              if (directRes.ok) {
                directUploadedPath = storageKey;
              }
            }
          }
        } catch (directErr) {
          console.warn('Direct Supabase Storage upload attempt failed, falling back to server upload:', directErr);
        }
      }

      if (directUploadedPath) {
        response = await fetch('/api/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storagePath: directUploadedPath,
            fileName: file.name,
            material: selectedMaterialType,
            profile: selectedProfile,
            layerHeightMm: layerHeightMm || undefined,
            infillPercent: String(infillPercent),
            quantity: String(partQuantity),
            overhangAreaMm2: supportWeightInfo?.overhangAreaMm2 ?? supportStats?.overhangArea,
            totalAreaMm2: supportWeightInfo?.totalAreaMm2 ?? undefined,
            supportsEnabled,
            dimensions: currentDimensions || undefined,
            color: colorChoice,
          }),
        });
      } else {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('material', selectedMaterialType);
        formData.append('profile', selectedProfile);
        if (layerHeightMm) formData.append('layerHeightMm', String(layerHeightMm));
        formData.append('infillPercent', String(infillPercent));
        formData.append('quantity', String(partQuantity));
        formData.append('supportsEnabled', supportsEnabled ? '1' : '0');
        formData.append('color', colorChoice);
        const liveOverhang = supportWeightInfo?.overhangAreaMm2 ?? supportStats?.overhangArea;
        if (liveOverhang) {
          formData.append('overhangAreaMm2', String(liveOverhang));
        }
        if (supportWeightInfo?.totalAreaMm2) {
          formData.append('totalAreaMm2', String(supportWeightInfo.totalAreaMm2));
        }
        if (currentDimensions) {
          formData.append('dimensions', JSON.stringify(currentDimensions));
        }

        response = await fetch('/api/quote', {
          method: 'POST',
          body: formData,
        });
      }

      const data = await response.json();

      if (!response.ok) {
        // Backend returned 400 (e.g., build volume exceeded or invalid STL)
        setError(data.message || data.error || 'Server rejected model.');
        setQuoteData(data); // preserve any parsed boundingBox details
      } else {
        setQuoteData(data);
        setHasActiveModel(true);
        setError(null);
        saveActiveQuote({
          fileName: file.name,
          dimensions: currentDimensions || rawDimensionsRef.current,
          volumeMm3: data.volumeMm3,
          surfaceAreaMm2: data.surfaceAreaMm2,
          settings: {
            materialType: selectedMaterialType,
            profile: selectedProfile,
            infillPercent,
            layerHeightMm,
            supportsEnabled,
            quantity: partQuantity,
            material: selectedMaterial,
            accentMaterial: selectedAccentMaterial,
            scalePercent,
            addOns,
          },
          quoteData: data,
        });
      }
    } catch (fetchErr) {
      console.error('API Quote error:', fetchErr);
      setError('Could not reach the quoting service. Check your connection and try again (large files over 4MB need Supabase direct upload enabled).');
    } finally {
      setLoading(false);
    }
  };

  const handleClearModel = useCallback(() => {
    clearActiveQuote();
    setQuoteData(null);
    setHasActiveModel(false);
    setMeshReady(false);
    setFileName(null);
    setError(null);
    setSupportStats(null);
    setSupportWeightInfo(null);
    supportWeightRef.current = null;
    setShellInfo(null);
    setProceduralMeta(null);
    setAssemblyKind('single-piece');
    setCanExplode(false);
    setMultiPartMeta(null);
    setExplodedProgress(0);
    setIsExploded(false);
    setPolyCount(null);
    setRawDimensions(null);
    setIsTinyModel(false);
    setIsInchConverted(false);
    setScalePercent(100);
    setAutoBrim(false);
    setBrimDismissed(false);
    setLayerSwapEnabled(false);
    setCheckoutOpen(false);
    setConfirmedOrder(null);
    setConfirmationError(null);
    setDeliveryQuote(null);
    setPaymentUtr('');
    rawDimensionsRef.current = null;
    if (currentMeshRef.current && sceneRef.current) {
      sceneRef.current.remove(currentMeshRef.current);
      if (currentMeshRef.current.isGroup) {
        disposeObjectGroup(currentMeshRef.current);
      } else {
        if (currentMeshRef.current.geometry) currentMeshRef.current.geometry.dispose();
        if (currentMeshRef.current.material) currentMeshRef.current.material.dispose();
      }
      currentMeshRef.current = null;
    }
    if (controlsRef.current && cameraRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      cameraRef.current.position.set(160, 160, 240);
      controlsRef.current.update();
    }
  }, []);

  const handleConfirmOrder = async (e) => {
    e.preventDefault();
    // Hard checkout locks: empty bed or over-volume can never place an order.
    if (!hasActiveModel || !meshReady) {
      setConfirmationError('No 3D model on the build plate. Load a model before checkout.');
      return;
    }
    if (isOversized) {
      const d = dims || currentDimensions;
      setConfirmationError(
        `Model exceeds the 180 × 180 × 180 mm build volume${d ? ` (${Number(d.x).toFixed(1)} × ${Number(d.y).toFixed(1)} × ${Number(d.z).toFixed(1)} mm)` : ''}. Click “Auto-Scale to Fit 180mm Bed” to continue.`
      );
      return;
    }
    const orderId = quoteData?.orderId || quoteData?.order?.id;
    if (!orderId) {
      setConfirmationError('Missing active order ID. Please re-upload your STL.');
      return;
    }
    if (!customerName.trim()) {
      setConfirmationError('Please enter your name.');
      return;
    }
    if (!customerEmail.trim() || !customerEmail.includes('@')) {
      setConfirmationError('Please enter a valid email address.');
      return;
    }

    try {
      setConfirmingOrder(true);
      setConfirmationError(null);
      const res = await fetch('/api/orders/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          customerName: customerName.trim(),
          email: customerEmail.trim(),
          color: colorChoice,
          notes: customerNotes.trim(),
          pincode: (deliveryPin || '').trim(),
          paymentMode,
          paymentUtr: paymentUtr.trim(),
          utr: paymentUtr.trim(),
          material: selectedMaterialType,
          profile: selectedProfile,
          layerHeightMm: layerHeightMm || slicerQuote?.layerHeightMm || undefined,
          layer_height: layerHeightMm || slicerQuote?.layerHeightMm || undefined,
          infillPercent,
          quantity: partQuantity,
          supportsEnabled,
          supports_enabled: supportsEnabled,
          partWeightGrams: slicerQuote?.partWeightGrams ?? undefined,
          part_weight_grams: slicerQuote?.partWeightGrams ?? undefined,
          supportWeightGrams: supportsEnabled ? (slicerQuote?.supportWeightGrams ?? supportWeightInfo?.supportWeightGrams ?? 0) : 0,
          support_weight_grams: supportsEnabled ? (slicerQuote?.supportWeightGrams ?? supportWeightInfo?.supportWeightGrams ?? 0) : 0,
          totalWeightGrams: slicerQuote?.totalWeightGrams ?? weight ?? undefined,
          total_weight_grams: slicerQuote?.totalWeightGrams ?? weight ?? undefined,
          dimensionsMm: dims || currentDimensions || undefined,
          dimensions_mm: dims || currentDimensions || undefined,
          totalPriceInr: checkoutTotal,
          total_price_inr: checkoutTotal,
          addOns,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setConfirmationError(data.message || 'Failed to confirm order.');
      } else {
        setConfirmedOrder(data.order);
        if (typeof window !== 'undefined') {
          setTimeout(() => {
            window.location.href = `/track/${data.orderId}`;
          }, 1600);
        }
      }
    } catch (err) {
      setConfirmationError('Network error confirming order: ' + err.message);
    } finally {
      setConfirmingOrder(false);
    }
  };

  // Delivery estimate for the checkout form (server-authoritative quote)
  const handleCalculateDelivery = async (pinOverride) => {
    const orderId = quoteData?.orderId || quoteData?.order?.id;
    if (!orderId) {
      setDeliveryQuote(null);
      return;
    }
    const pin = (pinOverride || deliveryPin || '').trim();
    if (!/^[1-9][0-9]{5}$/.test(pin)) {
      setDeliveryQuote(null);
      return;
    }
    setDeliveryLoading(true);
    setDeliveryError(null);
    try {
      const res = await fetch(
        `/api/orders/delivery?orderId=${orderId}&pincode=${encodeURIComponent(pin)}`
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        setDeliveryQuote(null);
      } else {
        setDeliveryQuote(data.delivery);
      }
    } catch (err) {
      setDeliveryQuote(null);
    } finally {
      setDeliveryLoading(false);
    }
  };

  // Frictionless background delivery estimate when a valid 6-digit PIN is entered
  useEffect(() => {
    const pin = (deliveryPin || '').trim();
    if (/^[1-9][0-9]{5}$/.test(pin) && (quoteData?.orderId || quoteData?.order?.id)) {
      handleCalculateDelivery(pin);
    } else {
      setDeliveryQuote(null);
    }
  }, [deliveryPin, quoteData]);

  const handleCopyRef = (id) => {
    const text = `SNKB-ORD-${id}`;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 2500);
    }
  };

  const handleFileInput = (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) processStlFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragActive(false);
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) processStlFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = () => {
    setIsDragActive(false);
  };

  // Helper to load bundled sample files or catalog designs (supports multi-part No-AMS STLs)
  const loadSample = async (samplePath, name, multiPartConfig = null) => {
    try {
      setLoading(true);
      setError(null);

      let effectiveMultiPart = multiPartConfig;
      const lower = (name || samplePath || '').toLowerCase();
      if (!effectiveMultiPart) {
        if (lower.includes('mecha')) {
          effectiveMultiPart = {
            baseUrl: '/models/posable-snap-fit-mecha-base.stl',
            accentUrl: '/models/posable-snap-fit-mecha-accent.stl',
            assemblyType: 'snap-fit',
          };
          samplePath = '/models/posable-snap-fit-mecha.stl';
          name = 'posable-snap-fit-mecha.stl';
        } else if (lower.includes('planetary')) {
          effectiveMultiPart = {
            baseUrl: '/models/planetary-gear-fidget-spinner-base.stl',
            accentUrl: '/models/planetary-gear-fidget-spinner-accent.stl',
            assemblyType: 'print-in-place',
          };
          samplePath = '/models/planetary-gear-fidget-spinner.stl';
          name = 'planetary-gear-fidget-spinner.stl';
        } else if (lower.includes('esp32')) {
          effectiveMultiPart = {
            baseUrl: '/models/esp32-wled-controller-case-base.stl',
            accentUrl: '/models/esp32-wled-controller-case-accent.stl',
            assemblyType: 'snap-fit',
          };
          samplePath = '/models/esp32-wled-controller-case.stl';
          name = 'esp32-wled-controller-case.stl';
        }
      }

      let multiPartBuffers = null;
      let combinedBlob = null;

      if (effectiveMultiPart && effectiveMultiPart.baseUrl && effectiveMultiPart.accentUrl) {
        try {
          const [combinedRes, baseRes, accentRes] = await Promise.all([
            fetch(samplePath),
            fetch(effectiveMultiPart.baseUrl),
            fetch(effectiveMultiPart.accentUrl),
          ]);

          if (combinedRes.ok && baseRes.ok && accentRes.ok) {
            combinedBlob = await combinedRes.blob();
            const [baseBuf, accentBuf] = await Promise.all([
              baseRes.arrayBuffer(),
              accentRes.arrayBuffer(),
            ]);
            multiPartBuffers = {
              baseBuffer: baseBuf,
              accentBuffer: accentBuf,
              assemblyType: effectiveMultiPart.assemblyType || 'snap-fit',
            };
          } else if (combinedRes.ok) {
            combinedBlob = await combinedRes.blob();
          }
        } catch (fetchErr) {
          console.warn('Multi-part fetch failed, falling back to combined STL:', fetchErr);
        }
      }

      if (!combinedBlob) {
        try {
          const res = await fetch(samplePath);
          if (!res.ok) {
            throw new Error(`HTTP ${res.status} fetching ${samplePath}`);
          }
          combinedBlob = await res.blob();
        } catch (fetchErr) {
          console.warn(`[StlViewer] Sample fetch failed for ${samplePath}, generating procedural fallback binary STL:`, fetchErr);
          const fallbackGeo = new THREE.TorusKnotGeometry(25, 7.5, 64, 16, 2, 3);
          fallbackGeo.computeVertexNormals();
          fallbackGeo.computeBoundingBox();
          const minY = fallbackGeo.boundingBox.min.y;
          fallbackGeo.translate(0, -minY, 0);

          const g = fallbackGeo.index ? fallbackGeo.toNonIndexed() : fallbackGeo;
          const pos = g.attributes.position.array;
          const triCount = pos.length / 9;
          const buffer = new ArrayBuffer(84 + triCount * 50);
          const view = new DataView(buffer);
          view.setUint32(80, triCount, true);
          let offset = 84;
          for (let i = 0; i < triCount; i++) {
            offset += 12; // normal
            for (let v = 0; v < 3; v++) {
              const idx = (i * 3 + v) * 3;
              view.setFloat32(offset, pos[idx], true);
              view.setFloat32(offset + 4, pos[idx + 1], true);
              view.setFloat32(offset + 8, pos[idx + 2], true);
              offset += 12;
            }
            offset += 2;
          }
          combinedBlob = new Blob([buffer], { type: 'application/octet-stream' });
        }
      }

      const file = new File([combinedBlob], name, { type: 'application/octet-stream' });
      processStlFile(file, multiPartBuffers);
    } catch (err) {
      setError('Failed to load sample: ' + err.message);
      setLoading(false);
    }
  };

  const removeCurrentMesh = () => {
    const scene = sceneRef.current;
    if (currentMeshRef.current) {
      if (scene) scene.remove(currentMeshRef.current);
      disposeObjectGroup(currentMeshRef.current);
      currentMeshRef.current = null;
    }
    clearSupportPillars();
  };

  // Load a real procedural physical assembly (named multi-component object).
  // Analysis runs over the merged part geometries so volume, supports and
  // pricing stay honest; display keeps discrete named meshes for explode.
  const renderProceduralAssembly = (designKey) => {
    const entry = PROCEDURAL_DESIGNS[designKey];
    const scene = sceneRef.current;
    if (!entry || !scene) return;
    try {
      setLoading(true);
      setError(null);
      setConfirmedOrder(null);
      setConfirmationError(null);
      setDeliveryQuote(null);
      setDeliveryError(null);
      orientAnimRef.current = null;
      if (explodeAnimRef.current) {
        cancelAnimationFrame(explodeAnimRef.current);
        explodeAnimRef.current = null;
      }
      setExplodedProgress(0);
      setIsExploded(false);
      setIsOrienting(false);
      setMeshReady(false);
      setSupportStats(null);
      setOrientResult(null);
      setPolyCount(null);
      setProceduralMeta(null);
      removeCurrentMesh();
      orientQuatRef.current = { ...IDENTITY_QUAT };

      const built = entry.build();
      const group = built.group;
      const merged = built.mergedGeometry;

      const bb = new THREE.Box3().setFromObject(group);
      const rawDim = {
        x: Number((bb.max.x - bb.min.x).toFixed(2)),
        y: Number((bb.max.y - bb.min.y).toFixed(2)),
        z: Number((bb.max.z - bb.min.z).toFixed(2)),
      };
      rawDimensionsRef.current = rawDim;
      setRawDimensions(rawDim);
      setScalePercent(100);
      setIsInchConverted(false);
      setBrimDismissed(false);
      const maxDim = Math.max(rawDim.x, rawDim.y, rawDim.z);
      setIsTinyModel(maxDim < 12);

      const faceData = computeFaceData(merged.getAttribute('position').array);
      faceDataRef.current = faceData;
      setPolyCount(faceData.count);
      printBoxRef.current = {
        min: { x: bb.min.x, y: bb.min.y, z: bb.min.z },
        max: { x: bb.max.x, y: bb.max.y, z: bb.max.z },
      };
      // Per-part support paint in print space (parts model +Z-up natively)
      group.traverse((child) => {
        if (!child.isMesh || !child.geometry) return;
        try {
          const fd = computeFaceData(child.geometry.getAttribute('position').array);
          child.userData.faceData = fd;
          applySupportColors(child.geometry, fd, IDENTITY_QUAT);
        } catch {}
      });
      const scored = evaluatePose(faceData, IDENTITY_QUAT, printBoxRef.current);
      setSupportStats({
        overhangArea: scored.overhangArea,
        fraction: scored.overhangFraction,
        contactArea: scored.contactArea,
        supportArea: scored.supportArea,
      });

      const volMm3 = Math.max(1, Math.round(built.volumeMm3));
      const surfAreaMm2 = Math.max(1, Math.round(built.surfaceAreaMm2));
      const computedQuote = {
        success: true,
        currency: 'INR',
        orderId: 'ORD-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
        fileName: entry.fileName,
        volumeMm3: volMm3,
        surfaceAreaMm2: surfAreaMm2,
        dimensions: rawDim,
        boundingBox: rawDim,
        material: selectedMaterialType,
        profile: selectedProfile,
        layerHeightMm: layerHeightMm || 0.20,
        infillPercent: infillPercent || 20,
        quantity: partQuantity || 1,
        supportsEnabled: Boolean(supportsEnabled),
        clientCalculated: true,
        proceduralDesign: designKey,
      };
      const isOverBuildVolume = rawDim.x > STANDARD_BUILD_LIMIT.x || rawDim.y > STANDARD_BUILD_LIMIT.y || rawDim.z > STANDARD_BUILD_LIMIT.z;
      if (isOverBuildVolume) {
        setError('Model exceeds the maximum build volume of 180 × 180 × 180 mm.');
        setQuoteData({
          success: false,
          error: 'build_volume_exceeded',
          message: 'Model exceeds the maximum build volume of 180 × 180 × 180 mm.',
          dimensions: rawDim,
          boundingBox: rawDim,
        });
        setHasActiveModel(false);
      } else {
        setHasActiveModel(true);
        setQuoteData(computedQuote);
        saveActiveQuote({
          fileName: entry.fileName,
          dimensions: rawDim,
          volumeMm3: volMm3,
          surfaceAreaMm2: surfAreaMm2,
          settings: {
            materialType: selectedMaterialType,
            profile: selectedProfile,
            infillPercent,
            layerHeightMm,
            supportsEnabled,
            quantity: partQuantity,
            material: selectedMaterial,
            accentMaterial: selectedAccentMaterial,
            scalePercent: 100,
            addOns,
          },
          quoteData: computedQuote,
          buffer: null,
        });
      }

      setFileName(entry.fileName);
      pendingAssemblyRef.current = { assemblyKind: 'multi-part', canExplode: true, partCount: entry.partCount };
      group.quaternion.copy(buildPrintToSceneQuat());
      scene.add(group);
      currentMeshRef.current = group;
      // Mesh is 100% mounted — badge, telemetry and receipt go live together.
      setMeshReady(true);
      setMultiPartMeta({
        assemblyType: 'procedural-snap',
        procedural: true,
        designKey,
        baseTriangles: faceData.count,
        accentTriangles: 0,
      });
      setAssemblyKind('multi-part');
      setCanExplode(true);
      setShellInfo({ shellCount: built.parts.length, source: 'procedural-assembly' });
      setProceduralMeta({ designKey, partNames: built.parts });
      setExplodedProgress(0);
      setIsExploded(false);

      const seatedBox = seatMeshOnPlate(group);
      const size = seatedBox.getSize(new THREE.Vector3());
      const unifiedDims = {
        x: Number(size.x.toFixed(1)),
        y: Number(size.z.toFixed(1)),
        z: Number(size.y.toFixed(1)),
      };
      setRawDimensions(unifiedDims);
      rawDimensionsRef.current = unifiedDims;
      refreshOverlays();
      updateCrossSection(crossSectionActive, crossSectionProgress);
      startScan(size.y);
      fitCameraToObject(cameraRef.current, controlsRef.current, group, 0.70);
      try {
        regenerateSupportPillars();
      } catch (pillarErr) {
        console.warn('Support pillar generation failed:', pillarErr);
      }
    } catch (err) {
      console.error('Procedural assembly failed:', err);
      setError('Failed to build procedural assembly: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Listen for catalog "Quote This Design" events, hero "load-model" handoff & deep-links
  useEffect(() => {
    const applyColorChoice = (colorHexOrName) => {
      if (!colorHexOrName) return;
      const byHex = MATERIAL_PRESETS.find(
        (p) => p.bg.toLowerCase() === String(colorHexOrName).toLowerCase()
      );
      const byName = MATERIAL_PRESETS.find(
        (p) => p.name.toLowerCase() === String(colorHexOrName).toLowerCase()
      );
      const preset = byHex || byName;
      if (preset) {
        setSelectedMaterial(preset.name);
        setColorChoice(preset.name);
        updateMeshMaterial(preset.name, selectedAccentMaterial, isWireframe, showSupports);
      }
    };
    const handleLoadDesign = (e) => {
      if (e.detail && e.detail.url) {
        const isGenuineMulti = Boolean(e.detail.canExplode) && (e.detail.assemblyKind || e.detail.assemblyType) !== undefined && (e.detail.assemblyKind === 'multi-part' || (e.detail.canExplode && e.detail.baseUrl && e.detail.accentUrl));
        const multiPart = (e.detail.baseUrl && e.detail.accentUrl) ? {
          baseUrl: e.detail.baseUrl,
          accentUrl: e.detail.accentUrl,
          assemblyType: e.detail.assemblyType || 'snap-fit',
        } : null;
        pendingAssemblyRef.current = {
          assemblyKind: e.detail.assemblyKind || (multiPart ? 'multi-part' : (e.detail.canExplode === false ? 'single-piece' : null)),
          canExplode: e.detail.canExplode ?? Boolean(multiPart),
          partCount: e.detail.partCount ?? 1,
        };
        if (pendingAssemblyRef.current.assemblyKind) setAssemblyKind(pendingAssemblyRef.current.assemblyKind);
        setCanExplode(Boolean(pendingAssemblyRef.current.canExplode));
        if (e.detail.color) applyColorChoice(e.detail.color);
        if (e.detail.displayName) setFileName(e.detail.displayName);
        loadSample(e.detail.url, e.detail.name || 'product-design.stl', multiPart);
      }
    };
    const handleSelectMaterial = (e) => {
      const id = String(e.detail?.materialId || e.detail?.material || '').toLowerCase();
      if (id.includes('petg')) setSelectedMaterialType('petg');
      else if (id.includes('tpu')) setSelectedMaterialType('tpu');
      else if (id.includes('pla')) setSelectedMaterialType('pla');
    };
    window.addEventListener('snkb:load-design', handleLoadDesign);
    window.addEventListener('snkb:load-model', handleLoadDesign);
    window.addEventListener('snkb:select-material', handleSelectMaterial);

    // Initial query-param check (e.g. ?design=esp32-wled-controller-case)
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        const design = params.get('design');
        if (design) {
          loadSample(`/models/${design}.stl`, `${design}.stl`, {
            baseUrl: `/models/${design}-base.stl`,
            accentUrl: `/models/${design}-accent.stl`,
            assemblyType: 'snap-fit',
          });
        }
      } catch (_) {}
    }

    return () => {
      window.removeEventListener('snkb:load-design', handleLoadDesign);
      window.removeEventListener('snkb:load-model', handleLoadDesign);
      window.removeEventListener('snkb:select-material', handleSelectMaterial);
    };
  }, []);

  const activePreset = MATERIAL_PRESETS.find((p) => p.name === selectedMaterial) || MATERIAL_PRESETS[0];
  const accentPreset = MATERIAL_PRESETS.find((p) => p.name === selectedAccentMaterial) || getContrastPreset(activePreset.name);
  const activePresetIdx = MATERIAL_PRESETS.findIndex((p) => p.name === selectedMaterial);
  // Physical plate names for the loaded design (genuine 2-plate assemblies only)
  const partNames = useMemo(() => getPartNamesForDesign(fileName || ''), [fileName]);

  // Cycle to next filament material preset (for swatch dial & mechanical style click)
  const handleCycleMaterial = () => {
    const targetName = (canExplode && multiPartMeta && !multiPartMeta.procedural && activePlate === 'accent') ? selectedAccentMaterial : selectedMaterial;
    const currentIndex = MATERIAL_PRESETS.findIndex((p) => p.name === targetName);
    const nextIndex = (currentIndex + 1) % MATERIAL_PRESETS.length;
    handleSelectMaterial(MATERIAL_PRESETS[nextIndex]);
  };

  const effectiveScale = (scalePercent / 100) * (isInchConverted ? 25.4 : 1.0);

  const baseDimensionsForScale = rawDimensions || quoteData?.dimensions || (quoteData?.boundingBox && typeof quoteData.boundingBox.x === 'number' ? quoteData.boundingBox : null);

  const currentDimensions = React.useMemo(() => {
    if (!baseDimensionsForScale) return null;
    return {
      x: Number((baseDimensionsForScale.x * effectiveScale).toFixed(2)),
      y: Number((baseDimensionsForScale.y * effectiveScale).toFixed(2)),
      z: Number((baseDimensionsForScale.z * effectiveScale).toFixed(2)),
    };
  }, [baseDimensionsForScale, effectiveScale]);

  const maxScalePercent = React.useMemo(() => {
    if (!baseDimensionsForScale) return 500;
    const factor = isInchConverted ? 25.4 : 1.0;
    return Math.max(
      10,
      Math.floor(
        Math.min(
          STANDARD_BUILD_LIMIT.x / (baseDimensionsForScale.x * factor),
          STANDARD_BUILD_LIMIT.y / (baseDimensionsForScale.y * factor),
          STANDARD_BUILD_LIMIT.z / (baseDimensionsForScale.z * factor)
        ) * 100
      )
    );
  }, [baseDimensionsForScale, isInchConverted]);

  // A1 Mini bedslinger auto-brim: tall/narrow parts get +1.5g stability brim
  useEffect(() => {
    if (!currentDimensions) return;
    if (brimDismissed) return;
    try {
      const seated = seatedBoxRef.current;
      let heightMm, widthMm, depthMm;
      if (seated) {
        const sz = seated.getSize(new THREE.Vector3());
        widthMm = sz.x * effectiveScale;
        heightMm = sz.y * effectiveScale;
        depthMm = sz.z * effectiveScale;
      } else {
        widthMm = currentDimensions.x;
        heightMm = currentDimensions.z;
        depthMm = currentDimensions.y;
      }
      const check = detectAutoBrim({ size: { widthMm, depthMm, heightMm, x: widthMm, y: heightMm, z: depthMm } });
      setAutoBrim(check.needsBrim);
    } catch { setAutoBrim(false); }
  }, [currentDimensions, brimDismissed, effectiveScale]);

  // Single-extruder pause-at-height preview: split mesh at pauseHeightMm
  useEffect(() => {
    const obj = currentMeshRef.current;
    if (!obj || multiPartMeta) return;
    const mesh = obj.isMesh ? obj : obj.children?.find((c) => c.isMesh);
    if (!mesh || !mesh.geometry) return;
    try {
      if (layerSwapEnabled && !canExplode) {
        const seated = seatedBoxRef.current;
        const maxY = seated ? seated.max.y : 40;
        const h = Math.max(1, Math.min(maxY - 0.5, pauseHeightMm / Math.max(0.05, effectiveScale)));
        const pHex = activePreset.bg;
        const aHex = accentPreset.bg;
        applyLayerSwapVertexColors(mesh.geometry, h, pHex, aHex);
        if (mesh.material) {
          mesh.material.vertexColors = true;
          mesh.material.color.set(0xffffff);
          mesh.material.needsUpdate = true;
        }
      } else if (!showSupports) {
        updateMeshMaterial(selectedMaterial, selectedAccentMaterial, isWireframe, false);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerSwapEnabled, pauseHeightMm, canExplode, effectiveScale]);

  const slicerQuote = React.useMemo(() => {
    if (!quoteData || !quoteData.volumeMm3) return null;
    const baseDims = quoteData?.dimensions || (quoteData?.boundingBox && typeof quoteData.boundingBox.x === 'number' ? quoteData.boundingBox : { x: 20, y: 20, z: 20 });
    const modelDims = currentDimensions || baseDims;
    // Prefer live 3D pillar measurement (world-space, scale-aware) over the
    // analysis-space estimate; fall back to supportStats when pillars pending.
    const pillarArea = supportWeightInfo?.overhangAreaMm2 ?? 0;
    const fallbackArea = (supportStats?.overhangArea || 0) * Math.pow(effectiveScale, 2);
    const overhangMm2 = pillarArea > 0 ? pillarArea : fallbackArea;
    const scaledVol = quoteData.volumeMm3 * Math.pow(effectiveScale, 3);
    const scaledArea = (quoteData.surfaceAreaMm2 || (quoteData.volumeMm3 * 0.4)) * Math.pow(effectiveScale, 2);

    return calculateSlicerMetrics({
      volumeMm3: scaledVol,
      surfaceAreaMm2: scaledArea,
      dimensions: modelDims,
      profile: selectedProfile,
      layerHeightMm: layerHeightMm || undefined,
      infillPercent,
      material: selectedMaterialType,
      overhangAreaMm2: overhangMm2,
      avgOverhangHeightMm: modelDims.z ? modelDims.z * 0.5 : 10,
      totalAreaMm2: scaledArea,
      supportsEnabled,
      quantity: partQuantity,
      addOns,
      autoBrim,
      layerSwap: layerSwapEnabled,
      // Zero-model guardrail flows straight into the engine: no mesh on the
      // bed means every weight, cost and total is exactly 0 (never ₹149).
      hasActiveModel,
    });
  }, [quoteData, hasActiveModel, selectedProfile, layerHeightMm, infillPercent, selectedMaterialType, partQuantity, supportStats, supportWeightInfo, supportsEnabled, currentDimensions, effectiveScale, addOns, autoBrim, layerSwapEnabled]);

  const activeSpool = useMemo(() => {
    if (!spools || spools.length === 0) return null;
    return spools.find((s) => s.color_name.toLowerCase() === selectedMaterial.toLowerCase()) || null;
  }, [spools, selectedMaterial]);

  const isLowSpool = useMemo(() => {
    if (!activeSpool) return false;
    const neededWeight = slicerQuote?.totalWeightGrams ?? quoteData?.weightGrams ?? 50;
    return Number(activeSpool.remaining_grams) < Number(neededWeight);
  }, [activeSpool, slicerQuote, quoteData]);

  const dims = currentDimensions || quoteData?.dimensions || (quoteData?.boundingBox && typeof quoteData.boundingBox.x === 'number' ? quoteData.boundingBox : null);
  const cost = slicerQuote?.totalPrice ?? quoteData?.totalPrice ?? quoteData?.materialCost ?? quoteData?.finalEstimatedMaterialPrice ?? 0;
  const materialLine = slicerQuote?.batchMaterialCost ?? quoteData?.materialCost ?? 0;
  const machineLine = slicerQuote?.batchMachineCost ?? quoteData?.machineCost ?? 0;
  const machineHoursLine = slicerQuote?.totalMachineHours ?? quoteData?.machineHours ?? 0;
  const makingLine = slicerQuote?.batchMakingCost ?? quoteData?.makingCost ?? 0;
  const serviceHandlingLine = slicerQuote ? (slicerQuote.serviceFee + slicerQuote.handlingFee) : ((quoteData?.serviceFee ?? 0) + (quoteData?.handlingFee ?? 0));
  const minimumApplied = slicerQuote?.minimumApplied ?? quoteData?.minimumApplied ?? false;
  // Staleness guard: a quote without the INR breakdown comes from a backend
  // older than the pricing engine — never render its numbers as rupees.
  const quoteIsCurrent =
    (quoteData?.success === true &&
    quoteData?.currency === 'INR' &&
    quoteData?.totalPrice !== null &&
    quoteData?.totalPrice !== undefined) || Boolean(slicerQuote);
  const weight = slicerQuote?.totalWeightGrams ?? quoteData?.weightGrams ?? quoteData?.weightInGrams ?? 0;
  const unitWeight = slicerQuote?.unitWeightGrams ?? weight;
  const unitPrice = slicerQuote?.unitPrice ?? cost;
  const volumeMm3 = quoteData?.volumeMm3 ?? 0;
  const volumeCm3 = quoteData?.volumeCm3 ?? (volumeMm3 ? Number((volumeMm3 / 1000).toFixed(2)) : 0);

  const isOversized = quoteData?.error === 'build_volume_exceeded' ||
    quoteData?.error === 'Build volume limit exceeded' ||
    (dims && (
      dims.x > STANDARD_BUILD_LIMIT.x ||
      dims.y > STANDARD_BUILD_LIMIT.y ||
      dims.z > STANDARD_BUILD_LIMIT.z
    ));

  // Bed readiness: receipt, telemetry, QR and checkout only go live when a
  // parsed mesh is actually mounted in the scene (kills ghost-price desync).
  const bedReady = hasActiveModel && meshReady;
  // Single checkout number: the exact engine totalPriceINR. Receipt Total, UPI
  // QR am= and Scan badge all read checkoutTotal — 0 on empty/oversized beds.
  const checkoutTotal = (!bedReady || isOversized) ? 0 : (slicerQuote?.totalPriceINR ?? cost);

  // Mechanical count-up micro-interaction on every fresh total
  useEffect(() => {
    const target = Number(checkoutTotal) || 0;
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dur = 700;
    let raf;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      setDisplayTotal(target * e);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [checkoutTotal]);

  // Mirror render-cycle values for the per-frame tag projector
  weightRef.current = weight;
  costRef.current = cost;
  showSupportsRef.current = showSupports;
  supportsEnabledRef.current = supportsEnabled;
  statsRef.current = supportStats;

  return (
    <div className="w-full ind-stage border-y border-[#2b2e36] pb-20 lg:pb-0">
      <div className="h-[3px] stripes-hazard-thin opacity-70"></div>
      {/* Top CAD Border Frame strip with clock, calibration crosshairs, and 180mm max scale */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-2 border-b border-[#2b2e36] bg-black/60 text-xs font-mono select-none">
        <div className="flex items-center gap-3">
          <span className="text-[#00FF66] font-bold tracking-wider">{clock || '00:23'}</span>
          <span className="text-[#00FF66] font-bold">+</span>
        </div>
        <div className="hidden sm:flex items-center gap-12 text-zinc-500 text-[11px] telemetry">
          <span className="text-[#00FF66]">+</span>
          <span>CALIBRATION GRID · 180MM SPECTRAL MATRIX</span>
          <span className="text-[#00FF66]">+</span>
        </div>
        <div className="flex items-center gap-3 text-right">
          <span className="text-[#00FF66]">+</span>
          <span className="text-zinc-400 text-[11px] font-mono">180mm max</span>
        </div>
      </div>

      {/* Tri-panel bento cockpit: controls 340px · 3D arena 1fr · live quote receipt 380px.
          < lg it becomes a single-column flow with a pinned 3D viewport + tabs. */}
      <div ref={workbenchRef} className="flex flex-col items-stretch lg:grid lg:grid-cols-[340px_minmax(0,1fr)_380px] lg:items-start gap-6 w-full p-4 sm:p-5 xl:p-6">

        {/* ================= LEFT: CONTROL CENTER ================= */}
        <aside className={`panel-ind-deep border border-[#2b2e36] p-5 space-y-4 relative min-w-0 lg:max-h-[880px] lg:overflow-y-auto cockpit-scroll rounded-lg order-3 lg:order-1 ${mobileTab === 'model' ? '' : 'hidden'} lg:block`}>
          <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-[#FF6500]/60 pointer-events-none"></div>
          <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-[#FF6500]/60 pointer-events-none"></div>

          {/* Brand & Control Center Header */}
          <div className="border-b border-[#2b2e36] pb-3 bg-black/30 -mx-5 px-5 -mt-2 pt-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-3 bg-[#00FF66] inline-block shadow-[0_0_6px_#00FF66]"></span>
                <span className="telemetry text-[11px] font-bold text-[#00FF66]">CONTROL CENTER</span>
              </div>
              <span className="telemetry text-[10px] text-zinc-500 font-mono">{clock} UTC</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl font-black logo-snkb">SNKB</span>
              <span className="text-2xl font-black logo-3d-studio">3D STUDIO</span>
            </div>
          </div>

          {/* UPLOAD STL tactical module */}
          <div className="border border-[#2b2e36] cut-sm bg-black/50 shadow-xl relative">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#2b2e36] bg-black/40">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-[#FF6500]"></span>
                <span className="telemetry text-[11px] font-bold text-[#FF6500]">UPLOAD STL</span>
              </div>
              <div className="w-14 h-3.5 stripes-hazard-thin cut-sm opacity-90"></div>
            </div>
            <div className="p-3">
              <div className="flex items-center gap-2">
                {/* Left LED tick bar */}
                <div className="led-tick-bar pl-0.5">
                  <span className="led-tick active-green"></span>
                  <span className="led-tick active-green"></span>
                  <span className="led-tick active-orange"></span>
                  <span className="led-tick"></span>
                </div>
                {/* Dropzone */}
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  className={`flex-1 border-2 border-dashed px-3 py-5 text-center cursor-pointer transition-colors duration-150 cut-sm bg-black/40 ${isDragActive ? 'border-[#00FF66] bg-[#00FF66]/5' : 'border-[#3a3d45] hover:border-[#FF6500]'}`}
                >
                  <label className="cursor-pointer flex flex-col items-center gap-1.5">
                    <svg className="w-7 h-7 text-[#FF6500] drop-shadow-[0_0_6px_rgba(255,101,0,0.6)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <span className="text-xs font-black tracking-wider text-zinc-100 font-mono">DRAG-AND-DROP</span>
                    <span className="telemetry text-[9px] text-zinc-400">STYLED ZONE</span>
                    <input
                      type="file"
                      accept=".stl,.3mf,model/stl,model/3mf,application/vnd.ms-package.3dmanufacturing-3dmodel+xml"
                      onChange={handleFileInput}
                      className="hidden"
                    />
                  </label>
                </div>
                {/* Right LED tick bar */}
                <div className="led-tick-bar pr-0.5">
                  <span className="led-tick active-green"></span>
                  <span className="led-tick active-green"></span>
                  <span className="led-tick active-orange"></span>
                  <span className="led-tick"></span>
                </div>
              </div>
            </div>
            <div className="stripes-hazard-thin h-2.5 mx-3 mb-2 opacity-90"></div>
            <div className="px-3 pb-2 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="telemetry text-[10px] text-zinc-500 mr-1">Demo Models:</span>
              <button
                type="button"
                onClick={() => loadSample('/models/3dbenchy.stl', '3dbenchy.stl')}
                className="btn-mech cut-sm px-2.5 py-1 text-zinc-200"
                title="Load classic 3DBenchy calibration tugboat"
              >
                🚢 3DBenchy Boat
              </button>
              <button
                type="button"
                onClick={() => loadSample('/models/posable-snap-fit-mecha.stl', 'posable-snap-fit-mecha.stl', { baseUrl: '/models/posable-snap-fit-mecha-base.stl', accentUrl: '/models/posable-snap-fit-mecha-accent.stl', assemblyType: 'snap-fit' })}
                className="btn-mech cut-sm px-2.5 py-1 text-[#00FF66] border-[#00FF66]/50"
                title="Load posable snap-fit mecha (Dual-Plate Explodable)"
              >
                🤖 Snap-Fit Mecha
              </button>
              <button
                type="button"
                onClick={() => loadSample('/models/esp32-wled-controller-case.stl', 'esp32-wled-controller-case.stl', { baseUrl: '/models/esp32-wled-controller-case-base.stl', accentUrl: '/models/esp32-wled-controller-case-accent.stl', assemblyType: 'snap-fit' })}
                className="btn-mech cut-sm px-2.5 py-1 text-[#00FF66] border-[#00FF66]/50"
                title="Load snap-fit ESP32 enclosure (Dual-Plate Explodable)"
              >
                🧩 ESP32 Case
              </button>
              <button
                type="button"
                onClick={() => loadSample('/models/planetary-gear-fidget-spinner.stl', 'planetary-gear-fidget-spinner.stl', { baseUrl: '/models/planetary-gear-fidget-spinner-base.stl', accentUrl: '/models/planetary-gear-fidget-spinner-accent.stl', assemblyType: 'print-in-place' })}
                className="btn-mech cut-sm px-2.5 py-1 text-[#00FF66] border-[#00FF66]/50"
                title="Load planetary gear mechanism (Explodable)"
              >
                ⚙️ Planetary Gear
              </button>
              <button
                type="button"
                onClick={() => loadSample('/samples/tiny_bracket_10mm_binary.stl', 'tiny_bracket_10mm.stl')}
                className="btn-mech cut-sm px-2 py-1 text-amber-300 border-amber-900"
                title="Tiny 10mm model — tests Unit Auto-Detection (< 12mm)"
              >
                📏 10mm Inch
              </button>
              <button
                type="button"
                onClick={() => loadSample('/samples/cube_20mm_binary.stl', 'cube_20mm.stl')}
                className="btn-mech cut-sm px-2 py-1 text-zinc-300"
                title="Standard 20mm calibration cube"
              >
                🧊 20mm Cube
              </button>
              <button
                type="button"
                onClick={() => loadSample('/samples/oversized_200mm_binary.stl', 'oversized_200mm.stl')}
                className="btn-mech cut-sm px-2 py-1 text-rose-300 border-rose-900"
                title="200mm model — triggers 180mm overflow lock"
              >
                ⚠️ 200mm Overflow
              </button>
            </div>
            {fileName && (
              <div className="px-3 pb-2 text-xs text-zinc-300 flex items-center gap-2">
                <span className="text-zinc-500 shrink-0">Loaded:</span>
                <span className="font-mono bg-black/60 px-2.5 py-1 border border-[#2b2e36] truncate max-w-[240px]">
                  {fileName}
                </span>
                <button
                  type="button"
                  onClick={handleClearModel}
                  className="btn-mech px-2 py-1 text-[10px] text-zinc-400 hover:text-white hover:border-zinc-500 shrink-0 cursor-pointer"
                  title="Clear the bed and upload a fresh file"
                >
                  ✕ Clear Bed / Reset
                </button>
              </div>
            )}
            {/* Prominent Unit Warning Banner for Tiny Models (< 12mm) */}
            {isTinyModel && !isInchConverted && rawDimensions && (
              <div className="m-3 p-3 cut-sm bg-amber-950/70 border-2 border-amber-500 text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.25)] flex flex-col gap-2.5">
                <div className="flex items-start gap-2">
                  <span className="text-amber-400 text-base leading-none">📏</span>
                  <div className="flex-1">
                    <div className="font-bold text-amber-300 telemetry tracking-wider text-xs">
                      📏 Tiny Model ({Number(rawDimensions.x).toFixed(1)}×{Number(rawDimensions.y).toFixed(1)}×{Number(rawDimensions.z).toFixed(1)} mm) — Model looks tiny—was it exported in Inches?
                    </div>
                    <p className="text-[11px] text-zinc-300 mt-0.5 leading-snug">
                      Max dimension is only {Math.max(rawDimensions.x, rawDimensions.y, rawDimensions.z).toFixed(1)} mm ({((Math.max(rawDimensions.x, rawDimensions.y, rawDimensions.z)) / 25.4).toFixed(2)} in). FDM slicers assume metric millimeters by default.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleConvertInchesToMm}
                  className="btn-mech cut-sm py-1.5 px-3 bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs transition flex items-center justify-center gap-2 shadow-[0_0_10px_rgba(245,158,11,0.4)] cursor-pointer"
                >
                  <span>Convert Inches → mm (Scale ×25.4)</span>
                </button>
              </div>
            )}
            {isInchConverted && (
              <div className="m-3 p-2.5 cut-sm bg-[#00FF66]/10 border border-[#00FF66]/60 text-xs font-mono flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[#00FF66]">✓</span>
                  <span className="text-[#00FF66] font-bold telemetry text-[11px]">CONVERTED: INCHES → MM (×25.4)</span>
                </div>
                <button
                  type="button"
                  onClick={handleConvertInchesToMm}
                  className="text-[10px] text-zinc-400 hover:text-white underline cursor-pointer"
                >
                  Undo
                </button>
              </div>
            )}
            {/* Error Banner (e.g. build volume limit exceeded) */}
            {error && (
              <div className={`m-3 p-3 cut-sm ${isOversized ? 'bg-[#FF0055]/15 border border-[#FF0055] text-white shadow-lg shadow-[#FF0055]/20' : 'bg-rose-950/60 border border-rose-800 text-rose-200'}`}>
                <p className="font-semibold text-xs flex items-center gap-1.5">
                  {isOversized && <span className="text-[#FF0055]">⚠</span>}
                  <span>{isOversized ? 'Print Volume Rejection' : 'Error'}</span>
                </p>
                <p className="text-[11px] text-zinc-300 mt-0.5">{error}</p>
                {dims && (
                  <p className="text-[11px] text-[#FF0055] mt-1 font-mono font-bold">
                    Model Dimensions: {Number(dims.x).toFixed(2)} × {Number(dims.y).toFixed(2)} × {Number(dims.z).toFixed(2)} mm
                  </p>
                )}
                {isOversized && (
                  <div className="mt-2.5">
                    <button
                      type="button"
                      onClick={handleAutoScaleToFitBed}
                      className="px-3 py-1.5 text-xs font-mono font-bold bg-[#FF0055] hover:bg-[#FF0055]/90 text-white rounded shadow-lg shadow-[#FF0055]/30 transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer"
                    >
                      <span>⚡</span>
                      <span>Auto-Scale to Fit 180mm Bed</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* UNIT & SCALE CONTROLS module (Live Scale % capped at 180mm Bambu Lab A1 Mini limit) */}
          <div className="border border-[#2b2e36] cut-sm bg-black/50 shadow-xl">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#2b2e36] bg-black/40">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-[#00FF66]"></span>
                <span className="telemetry text-[11px] font-bold text-[#00FF66]">UNIT &amp; SCALE CONTROLS</span>
              </div>
              <span className="telemetry text-[10px] text-zinc-400">
                CAP: 180×180×180MM
              </span>
            </div>
            <div className="p-3 space-y-2.5">
              {isOversized && (
                <div className="p-2 bg-[#FF0055]/15 border border-[#FF0055]/60 rounded">
                  <div className="text-[11px] font-mono text-[#FF0055] font-bold mb-1.5 flex items-center gap-1">
                    <span>⚠</span>
                    <span>OVERSIZED MODEL DETECTED</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleAutoScaleToFitBed}
                    className="w-full py-1.5 px-2 bg-[#FF0055] hover:bg-[#FF0055]/90 text-white text-xs font-mono font-bold rounded flex items-center justify-center gap-1.5 transition-all shadow-md shadow-[#FF0055]/30 cursor-pointer"
                  >
                    <span>⚡</span>
                    <span>Auto-Scale to Fit 180mm Bed</span>
                  </button>
                </div>
              )}
              {dims && (
                <div className="text-[10px] font-mono text-zinc-400 bg-black/40 px-2 py-1.5 rounded border border-[#2b2e36]/70 flex justify-between items-center">
                  <span>DIMENSIONS:</span>
                  <span className="text-zinc-200">
                    <span className={Number(dims.x) > 180 ? 'text-[#FF0055] font-bold' : ''}>{Number(dims.x).toFixed(1)}</span>
                    {' × '}
                    <span className={Number(dims.y) > 180 ? 'text-[#FF0055] font-bold' : ''}>{Number(dims.y).toFixed(1)}</span>
                    {' × '}
                    <span className={Number(dims.z) > 180 ? 'text-[#FF0055] font-bold' : ''}>{Number(dims.z).toFixed(1)}</span>
                    {' mm'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* MATERIAL SELECTOR tactical module (PLA+ / PETG / TPU) */}
          <div className="border border-[#2b2e36] cut-sm bg-black/50 shadow-xl">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#2b2e36] bg-black/40">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-[#FF6500]"></span>
                <span className="telemetry text-[11px] font-bold text-[#FF6500]">ENGINEERED MATERIAL</span>
              </div>
              <span className="telemetry text-[10px] text-zinc-400">
                {selectedMaterialType === 'pla' ? '1.24 g/cm³ · RIGID' : selectedMaterialType === 'petg' ? '1.27 g/cm³ · TOUGH' : '1.21 g/cm³ · ELASTIC'}
              </span>
            </div>
            <div className="p-3">
              {/* Segmented material pill bar — zero text collision */}
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-black/60 border border-[#2b2e36] rounded-lg text-xs font-mono" role="group" aria-label="Engineered material">
                {[
                  { id: 'pla', label: 'Tough PLA+', activeClass: 'bg-[#FF6500]/20 text-white border-[#FF6500]' },
                  { id: 'petg', label: 'PETG', activeClass: 'bg-sky-500/20 text-white border-sky-400' },
                  { id: 'tpu', label: 'TPU 95A', activeClass: 'bg-[#00FF66]/20 text-white border-[#00FF66]' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedMaterialType(m.id)}
                    aria-pressed={selectedMaterialType === m.id}
                    className={`px-2 py-2 rounded-md border text-center font-bold transition cursor-pointer ${
                      selectedMaterialType === m.id
                        ? m.activeClass + ' shadow-[0_0_10px_rgba(255,101,0,0.25)]'
                        : 'border-transparent text-zinc-400 hover:text-zinc-100 hover:bg-white/5'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {/* Single shared rate + description box */}
              <div className="mt-2 px-3 py-2.5 rounded-lg bg-black/40 border border-[#2b2e36]/70 flex items-center justify-between gap-3">
                <p className="text-[11px] text-zinc-300 font-sans leading-snug">
                  {selectedMaterialType === 'pla' && 'High rigidity, impact resistance & precision.'}
                  {selectedMaterialType === 'petg' && 'Heat & chemical resistant, industrial.'}
                  {selectedMaterialType === 'tpu' && 'Rubber-like elasticity & vibration damping.'}
                </p>
                <span className="text-[11px] font-mono font-bold shrink-0">
                  {selectedMaterialType === 'pla' && <span className="text-[#FF6500]">₹2.00/g</span>}
                  {selectedMaterialType === 'petg' && <span className="text-sky-400">₹2.50/g</span>}
                  {selectedMaterialType === 'tpu' && <span className="text-[#00FF66]">₹3.50/g</span>}
                </span>
              </div>
              {selectedMaterialType === 'pla' && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[10px] font-mono">
                  <span className="px-2 py-1 rounded border border-amber-500/40 bg-amber-950/50 text-amber-300">🌡️ Heat Limit: 55°C (Indoor Use)</span>
                  <button type="button" onClick={() => setSelectedMaterialType('petg')} className="px-2 py-1 rounded border border-sky-500/50 bg-sky-950/50 text-sky-300 hover:bg-sky-900/60 transition cursor-pointer">Printing for Car Dashboard / Outdoor Sun (up to 80°C)? Switch to PETG →</button>
                </div>
              )}
              {selectedMaterialType === 'tpu' && (
                <div className="mt-2.5 space-y-1.5 text-[10px] font-mono">
                  <div className="px-2 py-1.5 rounded border border-sky-500/40 bg-sky-950/50 text-sky-200">ℹ️ TPU 95A requires 0.16–0.24mm layers for reliable flexible extrusion.</div>
                  {canExplode && (
                    <div className="px-2 py-1.5 rounded border border-amber-500/50 bg-amber-950/60 text-amber-200">⚠️ Mechanical Fit Warning: TPU 95A is rubber-flexible; snap-fit joints/hinges will bend rather than lock rigidly. Tough PLA+ or PETG recommended.</div>
                  )}
                  {(slicerQuote?.supportWeightGrams ?? 0) > 4 && (
                    <div className="px-2 py-1.5 rounded border border-amber-500/50 bg-amber-950/60 text-amber-200">⚠️ TPU Support Warning: Flexible TPU bonds tightly to support structures. Click Auto-Orient to reduce overhangs.</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* PRINT PROFILE (SLICER) tactical module */}
          <div className="border border-[#2b2e36] cut-sm bg-black/50 shadow-xl">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#2b2e36] bg-black/40">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-[#00FF66]"></span>
                <span className="telemetry text-[11px] font-bold text-[#00FF66]">PRINT PROFILE (SLICER)</span>
              </div>
              <span className="telemetry text-[10px] text-zinc-400 uppercase">
                {selectedProfile === 'draft' ? `0.24mm · ${infillPercent}% INFILL` : selectedProfile === 'heavy-duty' ? `0.16mm · ${infillPercent}% INFILL · 4 WALLS` : `0.20mm · ${infillPercent}% INFILL`}
              </span>
            </div>
            <div className="p-3">
              <div className="grid grid-cols-3 gap-1.5 text-xs font-mono">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProfile('draft');
                    setInfillPercent(10);
                  }}
                  className={`cut-sm p-2 border text-center transition cursor-pointer ${
                    selectedProfile === 'draft' && infillPercent <= 15
                      ? 'bg-[#FF6500]/20 border-[#FF6500] text-white shadow-[0_0_8px_rgba(255,101,0,0.3)]'
                      : 'bg-black/40 border-[#2b2e36] text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  <span className="block font-bold text-zinc-200">Draft</span>
                  <span className="text-[10px] text-[#FF6500] block mt-0.5">0.24mm</span>
                  <span className="text-[9px] text-zinc-500 block">10% Infill</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedProfile('standard');
                    setInfillPercent(20);
                  }}
                  className={`cut-sm p-2 border text-center transition cursor-pointer ${
                    selectedProfile === 'standard' && infillPercent > 15 && infillPercent < 40
                      ? 'bg-[#00FF66]/20 border-[#00FF66] text-white shadow-[0_0_8px_rgba(0,255,102,0.3)]'
                      : 'bg-black/40 border-[#2b2e36] text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  <span className="block font-bold text-zinc-200">Standard</span>
                  <span className="text-[10px] text-[#00FF66] block mt-0.5">0.20mm</span>
                  <span className="text-[9px] text-zinc-500 block">20% Infill</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedProfile('heavy-duty');
                    setInfillPercent(45);
                  }}
                  className={`cut-sm p-2 border text-center transition cursor-pointer ${
                    selectedProfile === 'heavy-duty' || infillPercent >= 40
                      ? 'bg-[#00FF66]/20 border-[#00FF66] text-white shadow-[0_0_8px_rgba(0,255,102,0.3)]'
                      : 'bg-black/40 border-[#2b2e36] text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  <span className="block font-bold text-zinc-200">Heavy-Duty</span>
                  <span className="text-[10px] text-[#00FF66] block mt-0.5">0.16mm</span>
                  <span className="text-[9px] text-zinc-500 block">45% · 4 Walls</span>
                </button>
              </div>

              {/* Advanced slicer fine-tuning — open by default */}
              <details open className="group mt-3 border border-[#2b2e36]/70 rounded-lg bg-black/30">
                <summary className="flex items-center justify-between px-3 py-2.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden select-none">
                  <span className="text-[11px] font-mono font-bold text-zinc-300 flex items-center gap-2">
                    <span>⚙️</span>
                    <span>Fine-Tune Scale, Infill &amp; Layer Height (Optional)</span>
                  </span>
                  <svg className="w-3.5 h-3.5 text-[#00FF66] transition-transform duration-150 group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <div className="px-3 pb-3 pt-1 space-y-4 border-t border-[#2b2e36]/60">
                {/* Manual Scale Factor % */}
                <div className="pt-2.5">
                  <div className="flex items-center justify-between text-[11px] font-mono text-zinc-300 mb-1">
                    <span>SCALE FACTOR</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="1"
                        max={maxScalePercent}
                        value={scalePercent}
                        onChange={(e) => handleScaleChange(e.target.value)}
                        className="w-16 px-1.5 py-0.5 bg-black/80 border border-[#2b2e36] rounded text-right font-mono text-[#00FF66] font-bold text-xs focus:border-[#00FF66] outline-none"
                        aria-label="Scale Percentage"
                      />
                      <span className="text-zinc-400 text-xs">%</span>
                    </div>
                  </div>

                  <input
                    type="range"
                    min="5"
                    max={maxScalePercent}
                    value={scalePercent}
                    onChange={(e) => handleScaleChange(e.target.value)}
                    className="w-full accent-[#00FF66] cursor-pointer bg-zinc-800 h-1.5 rounded"
                    aria-label="Scale Percentage Slider"
                  />

                  <div className="flex justify-between items-center text-[10px] font-mono text-zinc-500 mt-1.5">
                    <span>5% Min</span>
                    <div className="flex items-center gap-1">
                      {[50, 100, 150].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          disabled={preset > maxScalePercent}
                          onClick={() => handleScaleChange(preset)}
                          className={`px-1.5 py-0.5 rounded text-[9px] border transition cursor-pointer ${
                            scalePercent === preset
                              ? 'border-[#00FF66] text-[#00FF66] bg-[#00FF66]/10'
                              : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 disabled:opacity-30'
                          }`}
                        >
                          {preset}%
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => handleScaleChange(maxScalePercent)}
                        className={`px-1.5 py-0.5 rounded text-[9px] border transition cursor-pointer ${
                          scalePercent === maxScalePercent
                            ? 'border-[#FF6500] text-[#FF6500] bg-[#FF6500]/10'
                            : 'border-zinc-700 text-zinc-400 hover:border-[#FF6500]'
                        }`}
                        title="Fit max printable volume (180mm max)"
                      >
                        Fit Max ({maxScalePercent}%)
                      </button>
                    </div>
                    <span>{maxScalePercent}% Max</span>
                  </div>
                </div>

              {/* Interactive Infill Density Slider & Tactical Selector */}
              <div className="mt-3 pt-3 border-t border-[#2b2e36]/70">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00FF66] animate-pulse"></span>
                    <span className="text-[10px] uppercase font-bold text-zinc-300 font-mono tracking-wider">
                      INFILL DENSITY
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                      infillPercent >= 100
                        ? 'text-cyan-400 bg-cyan-950/40 border-cyan-500/40'
                        : infillPercent >= 50
                        ? 'text-[#00FF66] bg-[#00FF66]/10 border-[#00FF66]/30'
                        : infillPercent >= 25
                        ? 'text-amber-400 bg-amber-950/30 border-amber-500/30'
                        : 'text-zinc-400 bg-zinc-900 border-zinc-700'
                    }`}>
                      {infillPercent}% {infillPercent >= 100 ? '· SOLID BLOCK' : infillPercent >= 60 ? '· ULTRA-DENSE' : infillPercent >= 40 ? '· STRUCTURAL' : ''}
                    </span>
                  </div>
                </div>

                {/* Range Slider */}
                <div className="relative flex items-center mb-2">
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="5"
                    value={infillPercent}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10) || 20;
                      setInfillPercent(val);
                      if (val <= 12) setSelectedProfile('draft');
                      else if (val >= 45) setSelectedProfile('heavy-duty');
                      else setSelectedProfile('standard');
                    }}
                    className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#00FF66]"
                  />
                </div>

                {/* Quick Density Chips */}
                <div className="grid grid-cols-6 gap-1 text-[9px] font-mono text-center">
                  {[
                    { label: '10%', val: 10, name: 'Draft' },
                    { label: '20%', val: 20, name: 'Std' },
                    { label: '35%', val: 35, name: 'Rigid' },
                    { label: '50%', val: 50, name: 'Heavy' },
                    { label: '75%', val: 75, name: 'Tough' },
                    { label: '100%', val: 100, name: 'Solid' },
                  ].map((chip) => (
                    <button
                      key={chip.val}
                      type="button"
                      onClick={() => {
                        setInfillPercent(chip.val);
                        if (chip.val <= 12) setSelectedProfile('draft');
                        else if (chip.val >= 45) setSelectedProfile('heavy-duty');
                        else setSelectedProfile('standard');
                      }}
                      className={`py-1 px-0.5 rounded border transition cursor-pointer ${
                        infillPercent === chip.val
                          ? 'bg-[#00FF66]/20 border-[#00FF66] text-[#00FF66] font-bold shadow-[0_0_6px_rgba(0,255,102,0.3)]'
                          : 'bg-black/30 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                      }`}
                      title={`${chip.name} (${chip.val}% infill)`}
                    >
                      <span className="block">{chip.label}</span>
                      <span className="block text-[7px] text-zinc-500 truncate">{chip.name}</span>
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-zinc-800/60 text-[9px] font-mono text-zinc-500">
                  <span>More infill = higher mass, strength &amp; material</span>
                  {infillPercent > 20 && (
                    <span className="text-[#00FF66]">
                      +{Math.round((infillPercent - 20) * 1.5)}% density scale
                    </span>
                  )}
                </div>
                {slicerQuote?.isThinWalled && (
                  <div className="mt-2 px-2 py-1.5 rounded border border-sky-500/40 bg-sky-950/50 text-sky-200 text-[10px] font-mono">ℹ️ Thin-Walled Part — Geometry is &gt;82% solid perimeter walls; infill % has minimal impact on weight.</div>
                )}
              </div>

              {/* Layer Height override 0.08-0.28mm (thinner = finer + slower) */}
              <div className="mt-3 pt-3 border-t border-[#2b2e36]/70">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] uppercase font-bold text-zinc-300 font-mono tracking-wider">
                    Layer Height
                  </span>
                  <span className="text-[11px] font-mono font-bold text-[#00FF66] px-1.5 py-0.5 rounded border border-[#00FF66]/30 bg-[#00FF66]/10">
                    {(layerHeightMm || (selectedProfile === 'draft' ? 0.24 : selectedProfile === 'heavy-duty' ? 0.16 : 0.2)).toFixed(2)}mm
                  </span>
                </div>
                <input
                  type="range"
                  min={selectedMaterialType === 'tpu' ? '0.16' : '0.08'}
                  max="0.28"
                  step="0.02"
                  value={layerHeightMm || (selectedProfile === 'draft' ? 0.24 : selectedProfile === 'heavy-duty' ? 0.16 : 0.2)}
                  onChange={(e) => setLayerHeightMm(Number(e.target.value))}
                  disabled={false}
                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#00FF66] disabled:opacity-50"
                  aria-label="Layer Height in millimeters"
                />
                {selectedMaterialType === 'tpu' && (
                  <div className="mt-1.5 text-[10px] font-mono text-sky-300">TPU 95A: 0.08/0.12mm disabled (jams on 0.4mm nozzle) — 0.16–0.24mm only.</div>
                )}
                <div className="flex justify-between text-[9px] font-mono text-zinc-500 mt-1">
                  <span>0.08 Fine</span>
                  <button type="button" onClick={() => setLayerHeightMm(null)} className="underline hover:text-zinc-300 cursor-pointer">Reset to profile</button>
                  <span>0.28 Fast</span>
                </div>
              </div>
                </div>
              </details>
            </div>
          </div>

          {/* FILAMENT SPEC tactical module */}
          <div className="border border-[#2b2e36] cut-sm bg-black/50 shadow-xl">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#2b2e36] bg-black/40">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-[#FF6500]"></span>
                <span className="telemetry text-[11px] font-bold text-[#FF6500]">FILAMENT SPEC</span>
              </div>
              <span className="telemetry text-[10px] text-zinc-500">
                {selectedMaterialType === 'pla' ? '1.24 g/cm³' : '1.21 g/cm³'}
              </span>
            </div>
            <div className="p-3">
              <div className="flex items-center justify-between mb-3 bg-black/40 p-2.5 rounded border border-[#2b2e36]/70">
                <div>
                  <div className="text-sm font-bold text-white font-mono flex items-center gap-2">
                    <span>{activePreset.name}</span>
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider"
                      style={{
                        backgroundColor: `${activePreset.bg}22`,
                        color: activePreset.bg === '#22252a' ? '#94a3b8' : activePreset.bg,
                        border: `1px solid ${activePreset.bg}44`,
                      }}
                    >
                      Active
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 font-mono flex items-center gap-1.5 mt-0.5">
                    <span
                      className="w-2 h-2 rounded-full inline-block shrink-0 shadow-sm"
                      style={{ backgroundColor: activePreset.bg }}
                    ></span>
                    <span>{activePreset.name} · {selectedMaterialType === 'petg' ? 'PETG' : selectedMaterialType === 'tpu' ? 'TPU 95A' : 'Tough PLA+'}</span>
                  </div>
                  {isLowSpool && (
                    <div className="mt-2 p-1.5 rounded bg-amber-950/80 border border-amber-700/80 text-amber-200 text-[10px] font-mono flex items-center gap-1.5 shadow-[0_0_8px_rgba(245,158,11,0.2)]">
                      <span>⚠️</span>
                      <span className="font-bold">Low Spool — +3 Days Restock</span>
                      <span className="text-zinc-400">({Number(activeSpool.remaining_grams).toFixed(0)}g left)</span>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleCycleMaterial}
                  className="swatch-split shrink-0 group flex items-center justify-center cursor-pointer"
                  style={{
                    '--swatch-color': activePreset.bg,
                    '--swatch-glow': `${activePreset.bg}80`,
                    background: `linear-gradient(135deg, ${activePreset.bg} 0%, ${activePreset.bg} 50%, #1e2025 50%, #121316 100%)`,
                    borderColor: activePreset.bg,
                    boxShadow: `inset 0 2px 6px rgba(0,0,0,0.8), 0 0 16px ${activePreset.bg}66`,
                  }}
                  title={`Active: ${activePreset.name}. Click circle dial to cycle colors.`}
                  aria-label={`Cycle filament material preset. Current: ${activePreset.name}`}
                >
                  <span className="sr-only">Cycle filament material</span>
                  <span className="w-2.5 h-2.5 rounded-full bg-white/80 shadow group-hover:scale-125 transition-transform"></span>
                </button>
              </div>
              {canExplode && multiPartMeta && !multiPartMeta.procedural && (
                <div className="mb-3 p-2 bg-[#00FF66]/10 border border-[#00FF66]/40 rounded text-[11px] font-mono text-zinc-200">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="telemetry text-[10px] text-[#00FF66] font-bold flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-[#00FF66] rounded-full animate-pulse"></span>
                      MULTI-PART NO-AMS ({multiPartMeta.assemblyType.toUpperCase()})
                    </span>
                    <span className="text-[10px] text-zinc-400">2 PLATES</span>
                  </div>
                  <div className="text-[10px] text-[#00FF66] mb-1.5">Multi-Plate Snap-Fit • 0g AMS Purge Waste</div>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setActivePlate('base')}
                      className={`flex items-center gap-1.5 px-2 py-1.5 rounded border transition text-left cursor-pointer ${
                        activePlate === 'base'
                          ? 'bg-[#FF6500]/20 border-[#FF6500] text-white shadow-[0_0_8px_rgba(255,101,0,0.3)]'
                          : 'bg-black/50 border-white/10 text-zinc-400 hover:border-white/30'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 shrink-0 rounded-full" style={{ backgroundColor: activePreset.bg }}></span>
                      <div className="truncate">
                        <span className="block font-bold text-[9px] uppercase tracking-wider text-zinc-400">Plate 1 (Base)</span>
                        <span className="truncate block font-mono text-zinc-200">{activePreset.name}</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActivePlate('accent')}
                      className={`flex items-center gap-1.5 px-2 py-1.5 rounded border transition text-left cursor-pointer ${
                        activePlate === 'accent'
                          ? 'bg-[#00FF66]/20 border-[#00FF66] text-white shadow-[0_0_8px_rgba(0,255,102,0.3)]'
                          : 'bg-black/50 border-white/10 text-zinc-400 hover:border-white/30'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 shrink-0 rounded-full" style={{ backgroundColor: accentPreset.bg }}></span>
                      <div className="truncate">
                        <span className="block font-bold text-[9px] uppercase tracking-wider text-zinc-400">Plate 2 (Accent)</span>
                        <span className="truncate block font-mono text-zinc-200">{accentPreset.name}</span>
                      </div>
                    </button>
                  </div>
                </div>
              )}
              {canExplode && multiPartMeta?.procedural && proceduralMeta && (
                <div className="mb-3 p-2 bg-[#00FF66]/10 border border-[#00FF66]/40 rounded text-[11px] font-mono text-zinc-200">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="telemetry text-[10px] text-[#00FF66] font-bold flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-[#00FF66] rounded-full animate-pulse"></span>
                      PHYSICAL ASSEMBLY · {proceduralMeta.partNames.length} PARTS
                    </span>
                    <span className="text-[10px] text-zinc-400">FACTORY COLORS</span>
                  </div>
                  <div className="text-[10px] text-[#00FF66] mb-1.5">Real Components • 0g AMS Purge Waste</div>
                  <ul className="space-y-1 text-[10px]">
                    {proceduralMeta.partNames.map((n, i) => (
                      <li key={i} className="flex items-center gap-1.5 text-zinc-300">
                        <span className="text-[#FF6500] font-bold">{String(i + 1).padStart(2, '0')}</span>
                        <span className="truncate">{n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-1">
                {!canExplode && hasActiveModel && (
                  <div className="col-span-2 mb-1 p-2 rounded border border-[#FF6500]/40 bg-[#FF6500]/10 text-[10px] font-mono space-y-2">
                    <div className="text-zinc-200">Primary Spool: <span className="font-bold" style={{ color: activePreset.bg === '#22252a' ? '#94a3b8' : activePreset.bg }}>{activePreset.name}</span> — single-extruder print, no second plate.</div>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input type="checkbox" checked={layerSwapEnabled} onChange={(e) => setLayerSwapEnabled(e.target.checked)} className="accent-[#FF6500] w-3.5 h-3.5" />
                      <span className="text-zinc-100 font-bold">+ Pause-at-Height Layer Color Swap (₹30)</span>
                    </label>
                    {layerSwapEnabled && (
                      <div>
                        <div className="flex justify-between text-[10px] text-zinc-300 mb-1"><span>Z-LAYER HEIGHT</span><span className="text-[#FF6500] font-bold">{pauseHeightMm.toFixed(1)}mm · top in {accentPreset.name}</span></div>
                        <input type="range" min="1" max={Math.max(5, Math.ceil((currentDimensions?.y ?? 40)))} step="0.5" value={Math.min(pauseHeightMm, Math.max(5, Math.ceil((currentDimensions?.y ?? 40))))} onChange={(e) => setPauseHeightMm(Number(e.target.value))} className="w-full accent-[#FF6500] cursor-pointer bg-zinc-800 h-1.5 rounded" aria-label="Pause at height in millimeters" />
                        <div className="text-[9px] text-zinc-400 mt-1">Bottom (y &lt; {pauseHeightMm.toFixed(1)}mm) prints in {activePreset.name}; top layers print in {accentPreset.name} after manual spool swap.</div>
                      </div>
                    )}
                  </div>
                )}
                {MATERIAL_PRESETS.map((preset) => {
                  const isCurrent = canExplode && multiPartMeta && !multiPartMeta.procedural && activePlate === 'accent'
                    ? selectedAccentMaterial === preset.name
                    : selectedMaterial === preset.name;
                  const spoolItem = spools.find((s) => s.color_name.toLowerCase() === preset.name.toLowerCase());
                  const isItemLow = spoolItem && Number(spoolItem.remaining_grams) < 200;

                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectMaterial(preset)}
                      className={`btn-mech cut-sm flex items-center justify-between px-2 py-1.5 text-[11px] font-medium transition ${
                        isCurrent
                          ? 'text-white border-[#FF6500]'
                          : 'text-zinc-400'
                      }`}
                      title={spoolItem ? `${spoolItem.remaining_grams}g remaining in farm` : undefined}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span
                          className="w-2.5 h-2.5 shrink-0 border border-white/20"
                          style={{ backgroundColor: preset.bg }}
                        />
                        <span className="truncate">{preset.name}</span>
                      </div>
                      {isItemLow && (
                        <span className="text-[9px] font-mono text-amber-400 shrink-0" title="Low remaining filament">
                          ⚠️
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* EXPLODED ASSEMBLY VIEW tactical module */}
          <div className={`border cut-sm shadow-xl ${canExplode ? 'border-[#00FF66]/40 bg-black/60' : 'border-zinc-700/60 bg-zinc-950/70'}`}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#2b2e36] bg-black/40">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 ${canExplode ? 'bg-[#00FF66]' : 'bg-zinc-500'}`}></span>
                <span className={`telemetry text-[11px] font-bold ${canExplode ? 'text-[#00FF66]' : 'text-zinc-400'}`}>EXPLODED ASSEMBLY VIEW</span>
              </div>
              <span className="telemetry text-[10px] text-zinc-400">
                {!canExplode ? 'LOCKED' : explodedProgress === 0 ? 'ASSEMBLED (0%)' : `SEPARATED (${explodedProgress}%)`}
              </span>
            </div>
            {!canExplode ? (
              <div className="p-3 font-mono text-[11px] space-y-2">
                <div className="px-2 py-2 rounded border border-zinc-600/60 bg-zinc-900/80 text-zinc-300 leading-snug">
                  {assemblyKind === 'print-in-place' || (shellInfo && shellInfo.shellCount === 1 && assemblyKind !== 'multi-part' && fileName && /dragon|flexi|articulated/i.test(fileName))
                    ? '🔒 PRINT-IN-PLACE MONOLITH — Hinges print pre-assembled; item cannot be exploded.'
                    : shellInfo && shellInfo.shellCount === 1
                    ? '🔒 1 Solid Body Detected — Single-Piece Print (Cannot Explode).'
                    : assemblyKind === 'print-in-place'
                    ? '🔒 PRINT-IN-PLACE MONOLITH — Hinges print pre-assembled; item cannot be exploded.'
                    : '🔒 SINGLE-PIECE SOLID PRINT — Item cannot be exploded.'}
                </div>
                <button type="button" disabled className="btn-mech cut-sm w-full py-1.5 px-3 text-xs font-bold flex items-center justify-center gap-2 opacity-40 cursor-not-allowed border-zinc-700 text-zinc-500" title="Locked: single-piece / print-in-place model cannot be exploded">
                  <span>🔒 Cannot Explode — Single Body</span>
                </button>
              </div>
            ) : (
            <div className="p-3 space-y-2.5 font-mono text-[11px]">
              {shellInfo && shellInfo.shellCount >= 2 && !multiPartMeta && (
                <div className="px-2 py-1.5 rounded border border-[#00FF66]/40 bg-[#00FF66]/10 text-[#00FF66] text-[10px]">🧩 {shellInfo.shellCount} Separate Parts Detected — Click Explode to Inspect Assembly</div>
              )}
              {multiPartMeta && !multiPartMeta.procedural && (
                <div className="px-2 py-1.5 rounded border border-[#00FF66]/40 bg-black/60 text-[10px] text-zinc-200 leading-relaxed">
                  <span className="text-zinc-500 block">SEPARATING PHYSICAL SUB-ASSEMBLIES</span>
                  <span className="text-[#FF6500] font-bold">▼ {partNames.base}</span>
                  <span className="text-zinc-600 mx-1">·</span>
                  <span className="text-[#00FF66] font-bold">▲ {partNames.accent}</span>
                </div>
              )}
              {multiPartMeta?.procedural && proceduralMeta && (
                <div className="px-2 py-1.5 rounded border border-[#00FF66]/40 bg-black/60 text-[10px] text-zinc-200 leading-relaxed">
                  <span className="text-zinc-500 block">SEPARATING {proceduralMeta.partNames.length} PHYSICAL PARTS</span>
                  {proceduralMeta.partNames.map((n, i) => (
                    <span key={i} className="block truncate">
                      <span className="text-[#FF6500] font-bold">{String(i + 1).padStart(2, '0')}</span>
                      <span className="text-zinc-300"> {n}</span>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleToggleExplode}
                  className={`btn-mech cut-sm flex-1 py-1.5 px-3 text-xs font-bold transition flex items-center justify-center gap-2 ${
                    explodedProgress > 10
                      ? 'border-[#00FF66] text-[#00FF66] bg-[#00FF66]/10 shadow-[0_0_10px_rgba(0,255,102,0.2)]'
                      : 'border-[#3a3d45] text-zinc-300 hover:border-[#00FF66]'
                  }`}
                >
                  <span>{explodedProgress > 10 ? '🔒 Assemble Parts' : '💥 Explode Assembly'}</span>
                </button>
                <span className="telemetry text-[10px] text-zinc-400 px-2 py-1 bg-black/60 border border-[#2b2e36] rounded">
                  {explodedProgress}%
                </span>
              </div>
              <div>
                <div className="flex justify-between text-[10px] telemetry text-zinc-400 mb-1">
                  <span>SEPARATION DISTANCE</span>
                  <span className="text-[#00FF66]">GUIDE LINES ACTIVE</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={explodedProgress}
                  onChange={handleSliderExplode}
                  className="w-full accent-[#00FF66] cursor-pointer bg-zinc-800 h-1.5 rounded"
                />
                <div className="flex justify-between text-[9px] text-zinc-500 mt-1 font-mono">
                  <span>0% Assembled</span>
                  <span>100% Separated</span>
                </div>
              </div>
              <p className="text-[10px] text-zinc-400 leading-relaxed border-t border-[#2b2e36]/60 pt-2">
                Dashed orange/green alignment lines show press-fit / glued assembly channels. Separate plates print in pure contrasting colors with zero AMS waste.
              </p>
            </div>
            )}
          </div>

          {/* PRINTER STATUS telemetry module */}
          <div className="border border-[#2b2e36] cut-sm bg-black/50 shadow-xl">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#2b2e36] bg-black/40">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-[#00FF66]"></span>
                <span className="telemetry text-[11px] font-bold text-[#00FF66]">PRINTER STATUS</span>
              </div>
              <span className="telemetry text-[10px] text-zinc-500">FDM_FARM</span>
            </div>
            <div className="p-3 space-y-3 font-mono text-[11px]">
              {/* Micro-Charts & Sparkline */}
              <div className="flex items-center justify-between bg-black/40 p-2 rounded border border-[#2b2e36]/70">
                <div className="relative w-36 h-11 bg-black/60 border border-[#2b2e36] rounded overflow-hidden">
                  <svg className="w-full h-full" viewBox="0 0 100 40" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#FF6500" stopOpacity="0.5" />
                        <stop offset="100%" stopColor="#FF6500" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>
                    <line x1="0" y1="10" x2="100" y2="10" stroke="#2b2e36" strokeDasharray="2,2" strokeWidth="0.5" />
                    <line x1="0" y1="20" x2="100" y2="20" stroke="#2b2e36" strokeDasharray="2,2" strokeWidth="0.5" />
                    <line x1="0" y1="30" x2="100" y2="30" stroke="#2b2e36" strokeDasharray="2,2" strokeWidth="0.5" />
                    <path d="M 0,32 Q 15,10 30,22 T 60,12 T 85,25 L 100,16 L 100,40 L 0,40 Z" fill="url(#chartGrad)" />
                    <path d="M 0,32 Q 15,10 30,22 T 60,12 T 85,25 L 100,16" fill="none" stroke="#FF6500" strokeWidth="1.5" />
                  </svg>
                </div>
                <div className="text-right text-[10px] space-y-0.5">
                  <span className="telemetry text-[9px] text-[#00FF66] block">MICRO-CHARTS</span>
                  <div className="text-zinc-400">Height: <span className="text-zinc-200">100%</span></div>
                  <div className="text-zinc-400">Length: <span className="text-zinc-200">100%</span></div>
                </div>
              </div>

              {/* Digital Telemetry Segmented Bar */}
              <div>
                <div className="flex justify-between text-[10px] telemetry text-zinc-400 mb-1">
                  <span>DIGITAL TELEMETRY</span>
                  <span className="text-[#00FF66]">1800:MM</span>
                </div>
                <div className="flex gap-1 h-2 bg-black/60 p-0.5 border border-[#2b2e36] rounded">
                  {[...Array(12)].map((_, i) => (
                    <div key={i} className={`flex-1 rounded-[1px] ${i < 9 ? 'bg-[#00FF66] shadow-[0_0_4px_#00FF66]' : 'bg-zinc-800'}`}></div>
                  ))}
                </div>
              </div>

              {/* Mechanical Style Slider Indicator */}
              <div>
                <div className="flex justify-between text-[10px] telemetry text-zinc-400 mb-1">
                  <span>MECHANICAL STYLE</span>
                  <span
                    className="font-bold transition-colors font-mono"
                    style={{ color: activePreset.bg === '#22252a' ? '#94a3b8' : activePreset.bg }}
                  >
                    {activePreset.name}
                  </span>
                </div>
                <div
                  className="relative h-2 bg-zinc-800 rounded cursor-pointer group"
                  onClick={handleCycleMaterial}
                  title="Click to cycle mechanical style finish"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleCycleMaterial(); }}
                  aria-label={`Mechanical style: ${activePreset.name}. Press to cycle.`}
                >
                  <div
                    className="absolute left-0 top-0 bottom-0 rounded transition-all duration-300"
                    style={{
                      width: `${Math.max(16, ((Math.max(0, activePresetIdx) + 1) / MATERIAL_PRESETS.length) * 100)}%`,
                      background: `linear-gradient(90deg, #FF6500 0%, ${activePreset.bg} 100%)`,
                    }}
                  ></div>
                  <div
                    className="absolute -top-1 w-4 h-4 -ml-2 rounded-full border-2 shadow-md transition-all duration-300 group-hover:scale-125"
                    style={{
                      left: `${Math.min(96, Math.max(4, (Math.max(0, activePresetIdx) / (MATERIAL_PRESETS.length - 1)) * 100))}%`,
                      backgroundColor: activePreset.bg,
                      borderColor: '#ffffff',
                      boxShadow: `0 0 8px ${activePreset.bg}`,
                    }}
                  ></div>
                </div>
                <div className="flex justify-between text-[9px] font-mono text-zinc-500 mt-1">
                  <span>{MATERIAL_PRESETS[0].name.split(' ')[0]}</span>
                  <span>{MATERIAL_PRESETS[MATERIAL_PRESETS.length - 1].name.split(' ')[0]}</span>
                </div>
              </div>

              {/* Telemetry specs rows */}
              <div className="space-y-1 pt-1.5 border-t border-[#2b2e36]/60">
                <div className="flex items-center justify-between text-zinc-400">
                  <span>PRINTER</span>
                  <span className="text-zinc-100 font-semibold">FDM_FARM_UNIT_01</span>
                </div>
                <div className="flex items-center justify-between text-zinc-400">
                  <span>BED</span>
                  <span className="text-zinc-100">180×180MM</span>
                </div>
                <div className="flex items-center justify-between text-zinc-400">
                  <span>NOZZLE</span>
                  <span className="text-zinc-100">0.4MM · 0.20MM LAYERS</span>
                </div>
              </div>
            </div>
          </div>

          {/* Mini total readout with rapid tick-up */}
          {quoteIsCurrent && (
            <div className="border border-[#00FF66]/40 cut-sm bg-black/50 px-3 py-2.5 flex items-center justify-between">
              <span className="telemetry text-[11px] text-zinc-400">Est. Total</span>
              <span key={String(cost)} className="tick-flash font-mono font-bold text-[#00FF66] text-lg">
                ₹{Number(displayTotal).toFixed(2)}
              </span>
            </div>
          )}

          <div className="telemetry text-xs font-bold text-center text-[#00FF66] border border-[#00FF66]/50 bg-[#00FF66]/10 px-3 py-2 cut-sm shadow-[0_0_12px_rgba(0,255,102,0.15)]">
            SYSTEM: ACTIVE
          </div>
        </aside>

        {/* ================= CENTER: 3D SPECTRAL ARENA ================= */}
        <section className="relative min-w-0 flex flex-col order-1 lg:order-2 ind-stage lg:max-h-[880px] lg:overflow-y-auto cockpit-scroll border border-[#2b2e36] rounded-lg">
          {/* Arena header strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-[#2b2e36] bg-black/30">
            <div className="flex items-center gap-3">
              <span className="w-2 h-5 bg-[#00FF66]"></span>
              <h3 className="text-base font-extrabold tracking-wide text-white">3D SPECTRAL ARENA</h3>
              <span className="telemetry text-[10px] text-zinc-500">180x180mm</span>
            </div>
            <div className="flex items-center gap-2">
              {canExplode && multiPartMeta?.procedural && proceduralMeta ? (
                <span className="telemetry text-[10px] text-[#00FF66] border border-[#00FF66]/50 bg-[#00FF66]/10 px-2.5 py-1 flex items-center gap-1.5 shadow-[0_0_8px_rgba(0,255,102,0.2)]">
                  <span className="w-1.5 h-1.5 bg-[#00FF66] rounded-full animate-pulse"></span>
                  PROCEDURAL {proceduralMeta.partNames.length}-PART ASSEMBLY
                </span>
              ) : canExplode && multiPartMeta ? (
                <span className="telemetry text-[10px] text-[#00FF66] border border-[#00FF66]/50 bg-[#00FF66]/10 px-2.5 py-1 flex items-center gap-1.5 shadow-[0_0_8px_rgba(0,255,102,0.2)]">
                  <span className="w-1.5 h-1.5 bg-[#00FF66] rounded-full animate-pulse"></span>
                  🧩 MULTI-PART ASSEMBLY (EXPLODABLE)
                </span>
              ) : hasActiveModel ? (
                <span className="telemetry text-[10px] text-zinc-300 border border-zinc-700/60 bg-zinc-900/80 px-2.5 py-1 flex items-center gap-1.5">
                  {assemblyKind === 'print-in-place' ? '🔒 PRINT-IN-PLACE MONOLITH' : shellInfo?.shellCount === 1 ? '🔒 1 SOLID BODY — SINGLE-PIECE' : '🔒 SINGLE-PIECE SOLID'}
                </span>
              ) : null}
              {autoBrim && (
                <span className="telemetry text-[10px] text-amber-300 border border-amber-500/50 bg-amber-950/60 px-2.5 py-1 flex items-center gap-1.5">🛡️ AUTO-BRIM (+1.5G)</span>
              )}
              <span className="telemetry text-[10px] text-[#00FF66] border border-[#00FF66]/50 px-2 py-1">System: Active</span>
              <span className="telemetry text-[10px] text-zinc-300 border border-[#2b2e36] px-2 py-1">Fleet: FDM_FARM_ACTIVE</span>
            </div>
          </div>


      {/* Bar 1 — Primary Slicer Bar (horizontally scrollable touch ribbon on mobile) */}
      <div className="slicer-ribbon px-2 sm:px-3 py-2 border-b border-[#2b2e36] bg-black/20 flex items-stretch sm:items-center gap-2 overflow-x-auto no-scrollbar touch-rail sm:flex-wrap sm:overflow-visible sm:justify-between">
        <div className="flex items-center gap-2 shrink-0">
        {/* With-supports vs Without-supports 3D visual + pricing mode */}
        <div className="flex items-center cut-sm border border-[#2b2e36] bg-black/60 overflow-hidden" role="group" aria-label="Support 3D view mode">
          <button
            type="button"
            onClick={() => handleToggleSupportsEnabled(false)}
            disabled={!fileName}
            className={`px-3 py-1.5 text-xs font-mono font-bold transition cursor-pointer ${!supportsEnabled ? 'bg-zinc-200 text-black' : 'text-zinc-400 hover:text-white'}`}
            title="Hide 3D support pillars and remove support cost from quote"
          >
            View Without Supports
          </button>
          <button
            type="button"
            onClick={() => handleToggleSupportsEnabled(true)}
            disabled={!fileName}
            className={`px-3 py-1.5 text-xs font-mono font-bold transition cursor-pointer ${supportsEnabled ? 'bg-[#10b981] text-black shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'text-zinc-400 hover:text-white'}`}
            title="Show emerald 3D support pillars and include support grams in quote"
          >
            View With Supports
          </button>
        </div>

        <button
          type="button"
          onClick={handleAutoOrient}
          disabled={!fileName || isOrienting}
          className="btn-mech btn-primary cut-sm px-3.5 py-1.5 text-xs flex items-center gap-1.5"
          title="Test 90° rotations on every axis and animate to the pose with the least overhang"
        >
          {isOrienting ? (
            <>
              <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
              </svg>
              <span>Orienting…</span>
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Auto-Orient for Best Print</span>
            </>
          )}
        </button>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
        {/* "Lay on Face" Tool (three-mesh-bvh accelerated face alignment) */}
        <button
          type="button"
          onClick={() => {
            const next = !layOnFaceActive;
            setLayOnFaceActive(next);
            if (next && caliperActive) setCaliperActive(false);
            if (!next && faceHighlightMeshRef.current) faceHighlightMeshRef.current.visible = false;
          }}
          disabled={!fileName}
          className={`btn-mech cut-sm px-3 py-1.5 text-xs flex items-center gap-1.5 transition cursor-pointer ${
            layOnFaceActive
              ? 'text-white border-[#00E5FF] bg-[#00E5FF]/20 shadow-[0_0_10px_rgba(0,229,255,0.4)]'
              : 'text-zinc-300'
          }`}
          title="Click a surface face on the 3D model to seat it flat on the build plate"
        >
          <span>📐</span>
          <span>{layOnFaceActive ? 'Lay on Face (Click Face)' : 'Lay on Face'}</span>
        </button>

        {/* Point-to-Point 3D Digital Caliper Tool */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const next = !caliperActive;
              setCaliperActive(next);
              if (next && layOnFaceActive) setLayOnFaceActive(false);
              if (!next) clearCaliperVisuals();
            }}
            disabled={!fileName}
            className={`btn-mech cut-sm px-3 py-1.5 text-xs flex items-center gap-1.5 transition cursor-pointer ${
              caliperActive
                ? 'text-white border-[#00FF66] bg-[#00FF66]/20 shadow-[0_0_10px_rgba(0,255,102,0.4)]'
                : 'text-zinc-300'
            }`}
            title="Point-to-Point 3D Digital Caliper: click 2 points on the model to measure exact Euclidean distance in mm"
          >
            <span>📏</span>
            <span>
              {caliperActive
                ? caliperDistMm
                  ? `Caliper: ${caliperDistMm} mm`
                  : caliperPoints.length === 1
                  ? 'Pick Point B'
                  : 'Pick Point A'
                : '3D Caliper'}
            </span>
          </button>
          {caliperActive && (caliperPoints.length > 0 || caliperDistMm) && (
            <button
              type="button"
              onClick={clearCaliperVisuals}
              className="btn-mech cut-sm px-2 py-1 text-[10px] text-zinc-400 hover:text-white cursor-pointer"
              title="Reset caliper points"
            >
              Clear
            </button>
          )}
        </div>
          <button
            type="button"
            onClick={handleToggleExplode}
            disabled={!fileName || !canExplode}
            className={`btn-mech cut-sm px-2.5 py-1.5 text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              explodedProgress > 10
                ? 'text-white border-[#00FF66] bg-[#00FF66]/15 shadow-[0_0_8px_rgba(0,255,102,0.3)]'
                : 'text-zinc-300'
            }`}
            title={canExplode ? 'Toggle exploded assembly view with dashed alignment guides' : 'Locked: single-piece / print-in-place model cannot be exploded'}
          >
            <span>{explodedProgress > 10 ? '🔒 Assemble' : canExplode ? '💥 Explode View' : '🔒 Explode'}</span>
            <span className="telemetry text-[9px] text-[#00FF66] font-mono">
              {explodedProgress}%
            </span>
          </button>
        </div>
      </div>

      {/* Bar 2 — Compact Sub-Status & Camera Presets (single slim row) */}
      <div className="slicer-ribbon px-2 sm:px-3 py-1.5 border-b border-[#2b2e36] bg-black/20 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <label className="switch-tactical flex items-center gap-1.5 cursor-pointer select-none shrink-0" title="Toggle red/coral support-warning paint">
            <input
              type="checkbox"
              checked={showSupports}
              onChange={handleToggleSupports}
              className="sr-only"
            />
            <span className="switch-track w-8 h-4 bg-zinc-700 border border-[#2b2e36] relative transition-colors duration-150">
              <span className="switch-knob absolute top-0.5 left-0.5 w-3 h-3 bg-white transition-transform duration-150" />
            </span>
            <span className="text-[11px] font-medium text-zinc-300">Show Support Warnings</span>
          </label>
          {supportStats ? (
            <span className="text-[11px] font-mono text-zinc-400 truncate" title={orientResult?.rotated && typeof orientResult.tiltDeg === 'number' ? `Auto-oriented: tilt ${orientResult.tiltDeg.toFixed(0)}° about ${orientResult.tiltAxis || '—'} · overhang ${(orientResult.fromPct ?? 0).toFixed(1)}% → ${(orientResult.toPct ?? 0).toFixed(1)}%` : 'Overhang share of surface at >45°'}>
              Overhang: {(supportStats.fraction * 100).toFixed(1)}% of surface • {(supportsEnabled ? (supportWeightInfo?.supportWeightGrams ?? 0) : 0)}g Supports ({supportStats.supportArea > 10 || (supportWeightInfo?.supportWeightGrams ?? 0) > 0 ? 'supports recommended' : 'on-plate supported'})
              {orientResult?.rotated && typeof orientResult.tiltDeg === 'number' ? ` · tilted ${orientResult.tiltDeg.toFixed(0)}°` : ''}
            </span>
          ) : (
            <span className="text-[11px] font-mono text-zinc-600">Overhang: — • load a model for support analysis</span>
          )}
          {supportWeightInfo && !supportsEnabled && (supportWeightInfo.supportWeightGrams ?? 0) > 3 && (
            <span className="px-1.5 py-0.5 rounded bg-amber-950/80 border border-amber-500/60 text-amber-300 font-bold text-[10px] font-mono shrink-0">
              ⚠️ &gt;45° overhangs need supports or Auto-Orient
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 text-[11px] shrink-0 overflow-x-auto no-scrollbar touch-rail max-w-full">
          {[
            ['top', 'Top', 'Top-down view'],
            ['front', 'Front', 'Front elevation view'],
            ['bottom', 'Bottom', 'Bottom underside view (inspect supports)'],
            ['iso', 'Iso', 'Reset isometric view'],
          ].map(([key, label, title]) => (
            <button
              key={key}
              type="button"
              onClick={() => handleViewPreset(key)}
              title={title}
              className="btn-mech cut-sm px-2 py-1 text-zinc-300"
            >
              {label}
            </button>
          ))}
          <span className="text-zinc-700 mx-0.5">|</span>
          <button
            type="button"
            onClick={handleResetCamera}
            className="btn-mech cut-sm px-2 py-1 text-zinc-300"
            title="Reset to default isometric angle"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleToggleCrossSection}
            className={`btn-mech cut-sm px-2 py-1 transition ${
              crossSectionActive ? 'text-white border-[#00FF66] bg-[#00FF66]/15' : 'text-zinc-300'
            }`}
            title="Toggle Z-Axis cross-section cut plane to inspect internal infill"
          >
            Cross-Section{crossSectionActive ? ` ${crossSectionProgress}%` : ''}
          </button>
          <button
            type="button"
            onClick={handleToggleWireframe}
            className={`btn-mech cut-sm px-2 py-1 transition ${
              isWireframe ? 'text-white border-[#FF6500]' : 'text-zinc-300'
            }`}
          >
            {isWireframe ? 'Solid' : 'Wireframe'}
          </button>
          <button
            type="button"
            onClick={handleToggleAutoSpin}
            className={`btn-mech cut-sm px-2 py-1 transition ${
              autoSpin ? 'text-white border-[#00FF66]' : 'text-zinc-300'
            }`}
          >
            Spin
          </button>
        </div>
      </div>

      {orientResult && (
        <div className="px-3 py-2 border-b border-emerald-500/40 bg-emerald-950/60 flex items-center justify-between gap-2">
          <span className="text-[11px] font-mono text-emerald-200">
            {orientResult.rotated
              ? `✅ Auto-Oriented Flat on Bed: Height reduced ${orientResult.heightBefore}mm → ${orientResult.heightAfter}mm • Supports reduced ${orientResult.supportBeforeG}g → ${orientResult.supportAfterG}g (Saved ₹${orientResult.savedInr} + ${orientResult.savedMins}m print time!)`
              : `✅ Optimal Orientation: Model seated flat on build plate • Footprint ${orientResult.widthMm || orientResult.footprintX?.toFixed(1)} × ${orientResult.depthMm || orientResult.footprintY?.toFixed(1)} mm • Height ${orientResult.heightMm || orientResult.height?.toFixed(1)} mm`}
          </span>
          <button
            type="button"
            onClick={() => setOrientResult(null)}
            className="text-[11px] font-mono text-emerald-400 hover:text-white underline cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {autoBrim && dims && (
        <div className="px-3 py-1.5 border-b border-amber-500/30 bg-amber-950/40 flex items-center justify-between gap-2">
          <span className="text-[11px] font-mono text-amber-200">🛡️ Tall Aspect Ratio on Moving Y-Bed — Auto-Brim (+1.5g) enabled for stability (or click Auto-Orient to lay flat).</span>
          <button type="button" onClick={() => { setBrimDismissed(true); setAutoBrim(false); }} className="text-[11px] font-mono text-amber-300 underline hover:text-white cursor-pointer shrink-0">Dismiss</button>
        </div>
      )}

      {/* Z-Axis Cross-Section Cut Plane Slider */}
      {crossSectionActive && (
        <div className="px-4 sm:px-5 py-2.5 border-b border-[#2b2e36] bg-black/40 flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-[#00FF66] animate-pulse"></span>
            <span className="telemetry text-[11px] font-bold text-[#00FF66]">Z-AXIS CROSS-SECTION:</span>
            <span className="telemetry text-[11px] font-mono text-white">
              {((crossSectionProgress / 100) * (seatedBoxRef.current?.max.y || 20)).toFixed(1)} mm / {(seatedBoxRef.current?.max.y || 20).toFixed(1)} mm
            </span>
            <span className="telemetry text-[10px] text-zinc-400">({crossSectionProgress}%)</span>
          </div>

          <div className="flex-1 flex items-center gap-2 min-w-[200px]">
            <span className="text-[10px] font-mono text-zinc-500">0%</span>
            <input
              type="range"
              min="1"
              max="100"
              value={crossSectionProgress}
              onChange={(e) => handleCrossSectionChange(e.target.value)}
              className="flex-1 accent-[#00FF66] cursor-pointer h-1.5 bg-zinc-800 rounded"
              aria-label="Z-Axis Cross Section Cut Height"
            />
            <span className="text-[10px] font-mono text-zinc-500">100%</span>
          </div>

          <div className="flex items-center gap-1 font-mono">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => handleCrossSectionChange(pct)}
                className={`btn-mech cut-sm px-2 py-0.5 text-[9px] ${
                  crossSectionProgress === pct ? 'border-[#00FF66] text-[#00FF66]' : 'text-zinc-400'
                }`}
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>
      )}

      {/* CAD coordinate scale rail (top) */}
      <div className="flex items-center gap-3 px-4 sm:px-5 pt-2.5">
        <span className="telemetry text-[10px] text-[#FF6500]">+</span>
        <div className="flex-1 h-3 cad-ruler-x opacity-70"></div>
        <span className="telemetry text-[10px] text-zinc-500">180MM MAX</span>
        <span className="telemetry text-[10px] text-[#FF6500]">+</span>
      </div>

      {/* 3D Canvas Container — pinned height on mobile, flexes on desktop */}
      <div
        className="relative w-full flex-1 h-[300px] sm:h-[380px] lg:h-[min(68vh,680px)] min-h-[300px] sm:min-h-[380px] lg:min-h-[480px] bg-[#0e0f12] flex items-center justify-center cursor-grab active:cursor-grabbing select-none overflow-hidden"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <div ref={mountRef} className="w-full h-full min-h-0 relative" />

        {/* Cyber HUD Corner Accents */}
        <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-[#FF6500]/60 pointer-events-none"></div>
        <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-[#FF6500]/60 pointer-events-none"></div>
        <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-[#FF6500]/60 pointer-events-none"></div>
        <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-[#FF6500]/60 pointer-events-none"></div>
        {/* Calibration crosshairs */}
        <span className="absolute top-1 left-6 telemetry text-[10px] text-[#00FF66]/70 pointer-events-none">+</span>
        <span className="absolute top-1 right-6 telemetry text-[10px] text-[#00FF66]/70 pointer-events-none">+</span>
        <span className="absolute bottom-1 left-6 telemetry text-[10px] text-[#00FF66]/70 pointer-events-none">+</span>
        <span className="absolute bottom-1 right-6 telemetry text-[10px] text-[#00FF66]/70 pointer-events-none">+</span>

        {/* Live coordinate tags removed for an unobstructed mesh view — all four
            metrics (bounding box, weight, price, overhang) already live in the
            telemetry strip directly beneath the canvas. updateTags() no-ops
            safely via its existing ref guards. */}

        {/* Slim Z-Layer Slicer pill — compact until Cross-Section mode is active */}
        <div
          className={`absolute left-3 top-12 bottom-12 z-20 flex-col items-center justify-between pointer-events-auto backdrop-blur-md border cut-sm select-none ${
            crossSectionActive
              ? 'flex bg-black/85 border-[#2b2e36] px-2.5 py-3 shadow-[0_0_20px_rgba(0,0,0,0.85)]'
              : 'flex w-9 bg-black/60 border-[#2b2e36]/60 px-1 py-2 shadow-lg'
          }`}
          title="Z-Axis Layer Cross-Section Slicer"
        >
          {/* Top Badge & Max Height */}
          <div className="flex flex-col items-center gap-1 text-center">
            <div className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${crossSectionActive ? 'bg-[#00FF66] animate-pulse shadow-[0_0_6px_#00FF66]' : 'bg-zinc-600'}`}></span>
              <span className={`telemetry text-[9px] font-bold ${crossSectionActive ? 'text-[#00FF66]' : 'text-zinc-400'} tracking-wider`}>Z-SLICER</span>
            </div>
            {crossSectionActive && (
              <span className="telemetry text-[8px] text-zinc-400 font-mono">
                {(seatedBoxRef.current?.max.y || (dims?.z ? Number(dims.z) : 20)).toFixed(0)}mm TOP
              </span>
            )}
          </div>

          {/* Vertical Range Track */}
          <div className="relative flex-1 my-2 flex items-center justify-center">
            {/* Ticks on the rail */}
            {crossSectionActive && (
              <div className="absolute right-7 top-0 bottom-0 flex flex-col justify-between text-[8px] font-mono text-zinc-500 pointer-events-none select-none">
                <span>100%</span>
                <span>75%</span>
                <span>50%</span>
                <span>25%</span>
                <span>0%</span>
              </div>
            )}

            <input
              type="range"
              orient="vertical"
              min="1"
              max="100"
              value={crossSectionProgress}
              onChange={(e) => {
                if (!crossSectionActive) setCrossSectionActive(true);
                handleCrossSectionChange(e.target.value);
              }}
              className="cursor-pointer accent-[#00FF66] h-40 sm:h-48 w-3"
              style={{
                writingMode: 'vertical-lr',
                direction: 'rtl',
                WebkitAppearance: 'slider-vertical',
              }}
              aria-label="Vertical Z-Layer Slicer Slider"
            />
          </div>

          {/* Bottom Controls & Readout */}
          <div className="flex flex-col items-center gap-1.5 text-center">
            <span className="telemetry text-[10px] font-bold text-white font-mono">
              {((crossSectionProgress / 100) * (seatedBoxRef.current?.max.y || (dims?.z ? Number(dims.z) : 20))).toFixed(1)}mm
            </span>
            {crossSectionActive && (
              <span className="telemetry text-[8px] text-[#00FF66] font-mono">
                {crossSectionProgress}%
              </span>
            )}
            <button
              type="button"
              onClick={handleToggleCrossSection}
              className={`btn-mech cut-sm px-2 py-0.5 text-[9px] font-bold transition flex items-center gap-1 cursor-pointer ${
                crossSectionActive
                  ? 'text-[#00FF66] border-[#00FF66] bg-[#00FF66]/15 shadow-[0_0_8px_rgba(0,255,102,0.3)]'
                  : 'text-zinc-400 border-zinc-700 hover:text-white'
              }`}
              title="Toggle Z-Axis local clipping plane"
            >
              <span>🔪 {crossSectionActive ? 'ACTIVE' : 'OFF'}</span>
            </button>
          </div>
        </div>

        {/* Floating Right Tool Strip (Quick View & Mode Actions) */}
        <div className="absolute right-3 top-14 z-20 flex flex-col gap-1.5 p-1 bg-black/80 backdrop-blur border border-[#2b2e36] rounded-md shadow-2xl pointer-events-auto">
          <button
            type="button"
            onClick={handleToggleExplode}
            title={explodedProgress > 10 ? 'Assemble Parts' : 'Explode Assembly View'}
            className={`tool-strip-btn ${explodedProgress > 10 ? 'active' : ''}`}
          >
            💥
          </button>
          <button
            type="button"
            onClick={handleToggleCrossSection}
            title={crossSectionActive ? `Disable Cross-Section (${crossSectionProgress}%)` : 'Enable Z-Axis Cross-Section'}
            className={`tool-strip-btn ${crossSectionActive ? 'active' : ''}`}
          >
            🔪
          </button>
          <button
            type="button"
            onClick={() => handleDpadMove('center')}
            title="Center / Reset Camera"
            className="tool-strip-btn"
          >
            🎯
          </button>
          <button
            type="button"
            onClick={handleToggleWireframe}
            title="Wireframe vs Solid View"
            className={`tool-strip-btn ${isWireframe ? 'active' : ''}`}
          >
            🔲
          </button>
          <button
            type="button"
            onClick={() => handleViewPreset('top')}
            title="Top View"
            className="tool-strip-btn"
          >
            📐
          </button>
          <button
            type="button"
            onClick={() => handleViewPreset('bottom')}
            title="Bottom View (Inspect Supports)"
            className="tool-strip-btn"
          >
            🔍
          </button>
          <button
            type="button"
            onClick={handleToggleAutoSpin}
            title="Auto-Spin 360°"
            className={`tool-strip-btn ${autoSpin ? 'active' : ''}`}
          >
            🔄
          </button>
        </div>

        {/* D-pad removed — orbit via mouse drag + Top/Front/Iso/Reset pills above */}
        <div className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-1.5 pointer-events-none">
          <div className="telemetry text-[9px] text-[#00FF66] border border-[#00FF66]/40 bg-black/80 px-2 py-0.5 rounded">
            PRINTER: FDM_FARM_ACTIVE
          </div>
        </div>

        {/* Viewport Telemetry Badge (Top Left) */}
        <div className="absolute top-3 left-3 flex items-center gap-2 bg-zinc-900/85 backdrop-blur border border-zinc-800/80 px-2.5 py-1 rounded-md text-[11px] font-mono text-zinc-300 pointer-events-none">
          <span className={`w-2 h-2 rounded-full ${fileName ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`}></span>
          <span>{fileName ? '3D VIEWPORT · ACTIVE' : '3D VIEWPORT · STANDBY'}</span>
        </div>

        {/* Polycount / Mesh Badge (Top Right) */}
        {polyCount && (
          <div className="absolute top-3 right-16 flex items-center gap-1.5 bg-zinc-900/85 backdrop-blur border border-zinc-800/80 px-2.5 py-1 rounded-md text-[11px] font-mono text-zinc-300 pointer-events-none">
            <span className="text-indigo-400">MESH:</span>
            <span>{polyCount.toLocaleString()} Triangles</span>
          </div>
        )}

        {/* Lay on Face HUD Overlay */}
        {layOnFaceActive && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-[#0e1626]/90 backdrop-blur-md border border-[#00E5FF] px-4 py-1.5 rounded-full text-xs font-mono text-cyan-200 shadow-[0_0_20px_rgba(0,229,255,0.35)] pointer-events-none animate-pulse">
            <span className="w-2 h-2 rounded-full bg-[#00E5FF]"></span>
            <span>LAY ON FACE ACTIVE: Click any surface face to seat flat on build plate</span>
          </div>
        )}

        {/* 3D Caliper HUD Overlay */}
        {caliperActive && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-[#0e1f18]/90 backdrop-blur-md border border-[#00FF66] px-4 py-1.5 rounded-full text-xs font-mono text-emerald-200 shadow-[0_0_20px_rgba(0,255,102,0.35)] pointer-events-none">
            <span className="w-2 h-2 rounded-full bg-[#00FF66] animate-ping"></span>
            <span>
              {caliperDistMm
                ? `3D CALIPER: Exact Euclidean Distance = ${caliperDistMm} mm`
                : caliperPoints.length === 1
                ? '3D CALIPER: Point A Set — Click Point B to Measure'
                : '3D CALIPER ACTIVE: Click Point A on the model'}
            </span>
          </div>
        )}

        {/* Lay on Face Status Toast */}
        {layOnFaceStatus && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-black/90 backdrop-blur border border-cyan-400/60 px-3.5 py-1.5 rounded text-xs font-mono text-cyan-300 pointer-events-none shadow-lg">
            <span>📐 {layOnFaceStatus}</span>
          </div>
        )}

        {/* Drag Over Overlay */}
        {isDragActive && (
          <div className="absolute inset-0 bg-indigo-900/60 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none border-2 border-dashed border-indigo-400">
            <svg className="w-16 h-16 text-indigo-300 animate-bounce mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-lg font-medium text-white">Drop your .stl file here to quote</p>
          </div>
        )}

        {/* Empty State Prompt (if no file loaded yet) */}
        {!fileName && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center pointer-events-none bg-zinc-950/40">
            <div className="w-16 h-16 rounded-2xl bg-zinc-800/80 border border-zinc-700 flex items-center justify-center text-zinc-400 mb-4 shadow-lg">
              <svg className="w-8 h-8 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
              </svg>
            </div>
            <h4 className="text-zinc-200 font-medium text-base mb-1">No 3D Model Loaded</h4>
            <p className="text-zinc-400 text-sm max-w-sm mb-4">
              Drag & drop a <span className="text-zinc-200 font-mono">.stl</span> file here, or choose a file below.
            </p>
          </div>
        )}

        {/* Tactical HUD Loading Overlay */}
        {loading && (
          <div className="absolute inset-0 bg-[#0e0f12]/85 backdrop-blur-md flex flex-col items-center justify-center gap-3 text-white z-30">
            <div className="relative flex items-center justify-center">
              <div className="w-16 h-16 rounded-full border-2 border-[#FF6500]/20 border-t-[#FF6500] animate-spin"></div>
              <div className="absolute w-10 h-10 rounded-full border-2 border-[#00FF66]/30 border-b-[#00FF66] animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1s' }}></div>
              <span className="absolute text-xs font-mono font-bold text-[#00FF66]">CAD</span>
            </div>
            <div className="text-center font-mono">
              <span className="telemetry text-xs font-bold text-[#00FF66] block">
                PROCESSING 3D GEOMETRY
              </span>
              <span className="text-[11px] text-zinc-400 mt-0.5 block">
                Computing Slicer Analysis &amp; Auto-Framing Matrix…
              </span>
            </div>
            {fileName && (
              <span className="text-[10px] font-mono text-zinc-400 bg-black/60 px-3 py-1 border border-[#2b2e36] rounded">
                Target: {fileName}
              </span>
            )}
          </div>
        )}

        {/* Bed Dimension Legend Overlay */}
        <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur border border-[#2b2e36] px-3 py-1.5 text-[11px] text-zinc-400 font-mono pointer-events-none flex flex-wrap items-center gap-2 cut-sm">
          <span>Print Bed Grid: 180×180mm</span>
          <span className="text-[#FF6500]">•</span>
          {multiPartMeta?.procedural && proceduralMeta ? (
            <span className="text-[#00FF66]">Procedural · {proceduralMeta.partNames.length} physical parts</span>
          ) : (
            <span>Plate 1: {selectedMaterial}</span>
          )}
          {multiPartMeta && !multiPartMeta.procedural && (
            <>
              <span className="text-[#00FF66]">•</span>
              <span className="text-[#00FF66]">Plate 2: {selectedAccentMaterial}</span>
            </>
          )}
          {explodedProgress > 0 && (
            <>
              <span className="text-[#00FF66]">•</span>
              <span className="text-[#00FF66]">Exploded: {explodedProgress}%</span>
            </>
          )}
          {isWireframe && <span className="text-amber-400 font-semibold">• Wireframe</span>}
          {autoSpin && <span className="text-cyan-400 font-semibold">• 360° Spin</span>}
        </div>
      </div>

        {/* ===== Live Model Telemetry & Dimension Strip (fills the space under the canvas) ===== */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 px-3 sm:px-4 py-3 border-t border-[#2b2e36] bg-black/40">
          <div className="p-2.5 cut-sm bg-black/50 border border-[#2b2e36]">
            <span className="telemetry text-[9px] text-zinc-500 block mb-0.5">Bounding Box X×Y×Z</span>
            <span className="font-mono text-[13px] text-zinc-100 font-semibold">
              {bedReady && dims ? `${Number(dims.x).toFixed(1)} × ${Number(dims.y).toFixed(1)} × ${Number(dims.z).toFixed(1)}` : '0 × 0 × 0'}
            </span>
            <span className="text-[10px] text-zinc-500 font-mono ml-1">mm</span>
          </div>

          <div className="p-2.5 cut-sm bg-black/50 border border-[#2b2e36]">
            <span className="telemetry text-[9px] text-zinc-500 block mb-0.5">Part Volume &amp; Mesh</span>
            <span className="font-mono text-[13px] text-zinc-100 font-semibold">
              {bedReady ? Number(volumeCm3 || 0).toFixed(2) : '0.00'} <span className="text-[10px] text-zinc-500">cm³</span>
              <span className="text-zinc-600 mx-1">·</span>
              {bedReady ? (polyCount || 0).toLocaleString() : '0'} <span className="text-[10px] text-zinc-500">tris</span>
            </span>
          </div>

          <div className="p-2.5 cut-sm bg-black/50 border border-[#2b2e36]">
            <span className="telemetry text-[9px] text-zinc-500 block mb-0.5">Overhang &amp; Supports</span>
            <span className="font-mono text-[13px] font-semibold">
              <span className={bedReady && supportStats && supportStats.fraction > 0.05 ? 'text-rose-400' : 'text-[#00FF66]'}>
                {bedReady && supportStats ? (supportStats.fraction * 100).toFixed(1) : '0.0'}% ∠45°
              </span>
              <span className="text-zinc-600 mx-1">·</span>
              <span className={bedReady && supportsEnabled && (supportWeightInfo?.supportWeightGrams ?? 0) > 0 ? 'text-[#10b981]' : 'text-zinc-400'}>
                {bedReady && supportsEnabled ? `${supportWeightInfo?.supportWeightGrams ?? 0} g` : '0 g'}
              </span>
            </span>
          </div>

          <div className="p-2.5 cut-sm bg-black/50 border border-[#2b2e36]">
            <span className="telemetry text-[9px] text-zinc-500 block mb-0.5">A1 Mini Bed Fit · 180³</span>
            {(!bedReady || !dims) ? (
              <span className="text-[10px] font-mono text-zinc-500">Awaiting 3D Geometry...</span>
            ) : (() => {
              const maxDim = dims ? Math.max(Number(dims.x), Number(dims.y), Number(dims.z)) : 0;
              const pct = Math.min(100, (maxDim / 180) * 100);
              const over = maxDim > 180;
              return (
                <div className="mt-0.5">
                  <div className="h-1.5 w-full bg-zinc-800 rounded overflow-hidden">
                    <div className={`h-full rounded ${over ? 'bg-[#FF0055]' : pct > 85 ? 'bg-amber-400' : 'bg-[#00FF66]'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={`text-[10px] font-mono ${over ? 'text-[#FF0055] font-bold' : 'text-zinc-400'}`}>
                    {maxDim.toFixed(1)} / 180 mm{over ? ' · OVER' : ' · Standard Print Fit'}
                  </span>
                </div>
              );
            })()}
          </div>
        </div>

        {/* ===== Quick-Load Demo Models Bar ===== */}
        <div className="flex flex-wrap items-center gap-1.5 px-3 sm:px-4 py-2.5 border-t border-[#2b2e36] bg-black/30">
          <span className="telemetry text-[9px] text-zinc-500 mr-1">QUICK-LOAD DEMO MODELS:</span>
          <button type="button" onClick={() => loadSample('/models/3dbenchy.stl', '3dbenchy.stl')} className="btn-mech cut-sm px-2.5 py-1 text-[11px] text-zinc-200" title="Load the classic 3DBenchy calibration tugboat">🚢 3DBenchy Boat</button>
          <button type="button" onClick={() => loadSample('/models/posable-snap-fit-mecha.stl', 'posable-snap-fit-mecha.stl', { baseUrl: '/models/posable-snap-fit-mecha-base.stl', accentUrl: '/models/posable-snap-fit-mecha-accent.stl', assemblyType: 'snap-fit' })} className="btn-mech cut-sm px-2.5 py-1 text-[11px] text-[#00FF66] border-[#00FF66]/40" title="Load the posable snap-fit mecha action figure (Explodable)">🤖 Snap-Fit Mecha</button>
          <button type="button" onClick={() => loadSample('/models/esp32-wled-controller-case.stl', 'esp32-wled-controller-case.stl', { baseUrl: '/models/esp32-wled-controller-case-base.stl', accentUrl: '/models/esp32-wled-controller-case-accent.stl', assemblyType: 'snap-fit' })} className="btn-mech cut-sm px-2.5 py-1 text-[11px] text-[#00FF66] border-[#00FF66]/40" title="Load snap-fit ESP32 enclosure (Explodable)">🧩 ESP32 Case</button>
          <button type="button" onClick={() => loadSample('/models/planetary-gear-fidget-spinner.stl', 'planetary-gear-fidget-spinner.stl', { baseUrl: '/models/planetary-gear-fidget-spinner-base.stl', accentUrl: '/models/planetary-gear-fidget-spinner-accent.stl', assemblyType: 'print-in-place' })} className="btn-mech cut-sm px-2.5 py-1 text-[11px] text-[#00FF66] border-[#00FF66]/40" title="Load the planetary gear fidget spinner (Explodable)">⚙️ Planetary Gear</button>
        </div>

        {/* Arena footer strip */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-t border-[#2b2e36] bg-black/30">
          <span className="telemetry text-[10px] text-[#00FF66]">Array: FDM_FARM_ONLINE</span>
          <span className="telemetry text-[10px] text-zinc-500">Build Plate 180 × 180 MM · Drag to orbit · Scroll to zoom</span>
        </div>
        </section>

        {/* ============ MOBILE WORKSPACE TAB SWITCHER (< lg, sticky) ============ */}
        <div className="lg:hidden order-2 sticky top-[67px] z-30 py-2 px-1 bg-[#0e0f12]/95 backdrop-blur-md border-y border-[#2b2e36]">
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { id: 'model', label: '📁 1. Model & Filament' },
              { id: 'slicer', label: '⚙️ 2. Slicer & Add-Ons' },
              { id: 'quote', label: '🧾 3. Final Quote & Pay' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => goToMobileTab(t.id)}
                aria-pressed={mobileTab === t.id}
                className={`min-h-[44px] px-1.5 py-2 rounded-md text-[10px] font-mono font-bold border transition leading-tight cursor-pointer ${
                  mobileTab === t.id
                    ? 'bg-[#FF6500] text-black border-[#ff8c3a] shadow-[0_0_12px_rgba(255,101,0,0.35)]'
                    : 'bg-black/60 text-zinc-300 border-[#2b2e36] hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ================= RIGHT: LIVE QUOTE RECEIPT & CHECKOUT ================= */}
        <aside className={`panel-ind-deep border border-[#2b2e36] p-4 relative min-w-0 lg:max-h-[880px] lg:overflow-y-auto cockpit-scroll rounded-lg order-4 lg:order-3 ${(mobileTab === 'slicer' || mobileTab === 'quote') ? '' : 'hidden'} lg:block`}>
          <div className="h-[3px] stripes-hazard-thin opacity-70 -mt-1 mb-3"></div>
          <div className="space-y-4">

        {/* Right-panel header */}
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#FF6500] animate-pulse"></span>
          <span className="telemetry text-[10px] text-[#FF6500]">LIVE QUOTE RECEIPT &amp; CHECKOUT</span>
        </div>

        {/* Hardware standby: shown ONLY when the bed is empty. No ghost price,
            no UPI QR, no checkout — the engine prices an empty bed at exactly ₹0. */}
        {!bedReady && !quoteData && (
          <div className="panel-ind-deep cut-sm p-4 space-y-4">
            <div className="flex items-center gap-2.5 p-4 rounded-xl bg-zinc-950/70 border border-zinc-700/70">
              <span className="text-2xl leading-none">⏸️</span>
              <div>
                <p className="font-mono text-xs font-bold text-zinc-100 tracking-wide">
                  NO 3D MODEL LOADED IN ARENA
                </p>
                <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                  Drag &amp; drop an .STL/.3MF file or click a Quick Sample Part on the
                  left to generate a live ₹ INR quote.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between px-1">
              <span className="telemetry text-[10px] text-zinc-500">BED STATUS</span>
              <span className="telemetry text-[10px] text-zinc-400 border border-zinc-700 px-2 py-0.5">STANDBY · ₹0.00</span>
            </div>
          </div>
        )}

        {/* Stale-backend guard: a "successful" quote without the INR breakdown
            comes from a server older than the pricing engine — its numbers
            must never render as rupees. Restart `npm start` to fix. */}
        {quoteData && quoteData.success && !quoteIsCurrent && (
          <div className="mb-6 p-4 rounded-xl bg-amber-950/60 border border-amber-800 text-amber-200">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="font-semibold text-sm">Quote Service Outdated</p>
                <p className="text-xs text-amber-300 mt-0.5">
                  The connected backend predates the INR pricing engine, so no price is shown.
                  Restart the API server (`npm start`) and re-upload your model.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Oversized lock: replaces QR + checkout while any axis exceeds 180mm.
            Auto-Scale shrinks to 175mm max axis and immediately re-unlocks. */}
        {isOversized && (bedReady || quoteData) && (
          <div className="panel-ind-deep cut-sm p-5 border-[#FF2A4B]/60" style={{ borderColor: '#FF2A4B' }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg leading-none">⚠️</span>
              <span className="telemetry text-xs font-bold" style={{ color: '#FF2A4B' }}>
                DIMENSION OVERFLOW
              </span>
            </div>
            <p className="font-mono text-[11px] text-white font-bold">
              {(dims || quoteData?.dimensions)
                ? `${Number((dims || quoteData.dimensions).x).toFixed(1)} × ${Number((dims || quoteData.dimensions).y).toFixed(1)} × ${Number((dims || quoteData.dimensions).z).toFixed(1)} mm`
                : '— × — × — mm'}
            </p>
            <p className="text-[11px] text-zinc-300 mt-1.5 leading-relaxed">
              Exceeds Bambu Lab A1 Mini 180×180×180mm build volume. UPI payment and
              checkout are locked until the part fits the bed.
            </p>
            <button
              type="button"
              onClick={handleAutoScaleToFitBed}
              className="mt-3 h-11 w-full px-4 text-xs font-bold text-white rounded flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer"
              style={{ backgroundColor: '#FF2A4B' }}
            >
              <span>🪄</span>
              <span>Auto-Scale to Fit 180mm Bed</span>
            </button>
            <p className="text-[10px] text-zinc-500 font-mono text-center mt-2">
              Scales longest axis to 175mm · price + UPI QR unlock instantly
            </p>
          </div>
        )}

        {/* Quoting Results Card — only when a mesh is mounted, in volume, and priced */}
        {!isOversized && !error && bedReady && (hasActiveModel || (quoteData && quoteData.success)) && (
          <div className="panel-ind-deep cut-sm p-5">
            <div className="flex items-center justify-between gap-2 border-b border-[#2b2e36] pb-3 mb-3">
              <span className="telemetry text-xs text-[#00FF66] bg-[#00FF66]/10 px-2 py-0.5 border border-[#00FF66]/40">
                Quote Confirmed
              </span>
              <button
                type="button"
                onClick={handleClearModel}
                className="btn-mech px-2.5 py-1 text-[11px] text-zinc-400 hover:text-white hover:border-zinc-500 cursor-pointer"
                title="Clear current model and upload or select a new STL"
              >
                ✕ Clear / Upload New STL
              </button>
            </div>

            {/* ===== MOBILE TAB 2 (< lg): MODEL SUMMARY + QUANTITY + ADD-ONS ===== */}
            <div className={`${mobileTab === 'quote' ? 'hidden' : ''} lg:block`}>

            {/* Active Model & Material Summary Header */}
            <div className="p-3.5 bg-black/40 border border-[#2b2e36]/80 cut-sm">
              <span className="telemetry text-[10px] text-zinc-500 block mb-1">ACTIVE MODEL</span>
              <div className="font-mono text-xs text-white font-bold truncate" title={fileName || 'Custom 3D Model'}>
                {fileName || 'Custom 3D Model'}
              </div>
              <div className="text-[11px] font-mono text-zinc-400 mt-1">
                {dims ? `X: ${Number(dims.x).toFixed(2)} mm · Y: ${Number(dims.y).toFixed(2)} mm · Z: ${Number(dims.z).toFixed(2)} mm` : '— × — × — mm'}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-zinc-200 bg-black/60 border border-[#2b2e36] rounded-full px-2.5 py-1">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: activePreset.bg }}></span>
                  {activePreset.name} · {selectedMaterialType === 'petg' ? 'PETG' : selectedMaterialType === 'tpu' ? 'TPU 95A' : 'Tough PLA+'}
                </span>
                <span className="inline-flex items-center text-[10px] font-mono text-[#00FF66] bg-[#00FF66]/10 border border-[#00FF66]/40 rounded-full px-2.5 py-1">
                  {selectedProfile === 'draft' ? 'Draft 0.24mm' : selectedProfile === 'heavy-duty' ? 'Heavy-Duty 0.16mm' : 'Standard 0.20mm'} · {infillPercent}%
                </span>
              </div>
            </div>

            {/* ================= STEP 2: QUANTITY & MANUFACTURING ADD-ONS ================= */}
            {/* Quantity Multiplier Stepper */}
            <div className="mt-3 p-3 bg-black/40 border border-[#2b2e36]/80 cut-sm flex items-center justify-between gap-3">
              <div>
                <span className="telemetry text-[10px] text-zinc-400 block font-medium">QUANTITY MULTIPLIER</span>
                <span className={`text-[10px] font-mono ${partQuantity >= 10 ? 'text-[#00FF66] font-bold' : partQuantity >= 5 ? 'text-[#FF6500] font-bold' : 'text-zinc-500'}`}>
                  {partQuantity >= 10 ? '★ 20% BULK DISCOUNT' : partQuantity >= 5 ? '★ 10% BULK DISCOUNT' : 'Standard batch run'}
                </span>
              </div>
              <div className="flex items-center border border-[#2b2e36] cut-sm bg-black/60 shrink-0">
                <button
                  type="button"
                  onClick={() => setPartQuantity((prev) => Math.max(1, prev - 1))}
                  className="px-3 py-1.5 text-zinc-400 hover:text-white hover:bg-white/5 transition font-bold cursor-pointer text-xs"
                  aria-label="Decrease quantity"
                >
                  -
                </button>
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={partQuantity}
                  onChange={(e) => setPartQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-12 text-center font-mono font-bold text-white bg-transparent outline-none text-xs"
                  aria-label="Quantity"
                />
                <button
                  type="button"
                  onClick={() => setPartQuantity((prev) => Math.min(200, prev + 1))}
                  className="px-3 py-1.5 text-zinc-400 hover:text-white hover:bg-white/5 transition font-bold cursor-pointer text-xs"
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
            </div>

            {/* Manufacturing Add-Ons & Hardware */}
            <div className="mt-3 p-3.5 bg-black/40 border border-[#2b2e36]/80 text-xs cut-sm">
              <div className="flex items-center justify-between mb-3 border-b border-[#2b2e36]/60 pb-2">
                <span className="telemetry text-xs font-bold text-white flex items-center gap-1.5">
                  <span className="text-[#FF6500]">⚙</span>
                  <span>Manufacturing Add-Ons &amp; Hardware</span>
                </span>
                <span className="text-[10px] font-mono text-zinc-400">
                  {slicerQuote?.addOns?.total > 0 ? (
                    <span className="text-[#00FF66] font-bold">+₹{Number(slicerQuote.addOns.total).toFixed(2)} selected</span>
                  ) : (
                    'Optional'
                  )}
                </span>
              </div>

              <div className="space-y-2.5">
                {/* Build Plate Texture */}
                <div className="p-2.5 bg-zinc-900/60 border border-zinc-800 rounded">
                  <label className="text-[11px] font-mono text-zinc-300 block mb-1 font-medium">
                    Build Plate Texture
                  </label>
                  <select
                    value={addOns.buildPlateTexture || 'textured'}
                    onChange={(e) => setAddOns((prev) => ({ ...prev, buildPlateTexture: e.target.value }))}
                    className="field-mech w-full px-2 py-1.5 text-base sm:text-xs text-zinc-200"
                  >
                    <option value="textured">Textured PEI (Standard, ₹0)</option>
                    <option value="smooth_pei">Smooth PEI (+₹29)</option>
                    <option value="carbon_fiber">Carbon Fiber PEO (+₹49)</option>
                  </select>
                  <p className="text-[10px] text-zinc-500 mt-1">
                    First-layer bottom surface appearance
                  </p>
                </div>

                {/* Heat-Set Brass Inserts */}
                <div className="p-2.5 bg-zinc-900/60 border border-zinc-800 rounded">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-mono text-zinc-300 font-medium">
                      Heat-Set Brass Inserts
                    </label>
                    <span className="text-[10px] font-mono text-[#00FF66]">₹15 / ea</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAddOns((prev) => ({ ...prev, heatSetInserts: Math.max(0, (prev.heatSetInserts || 0) - 1) }))}
                      className="btn-mech px-2.5 py-0.5 text-xs text-zinc-300 cursor-pointer"
                    >
                      -
                    </button>
                    <span className="font-mono text-xs font-bold text-white px-2">
                      {addOns.heatSetInserts || 0}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAddOns((prev) => ({ ...prev, heatSetInserts: Math.min(20, (prev.heatSetInserts || 0) + 1) }))}
                      className="btn-mech px-2.5 py-0.5 text-xs text-zinc-300 cursor-pointer"
                    >
                      +
                    </button>
                    <span className="text-[10px] text-zinc-400 font-mono ml-auto">
                      {(addOns.heatSetInserts || 0) > 0 ? `+₹${(addOns.heatSetInserts || 0) * 15}` : 'None'}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1">
                    M3 threaded brass inserts thermally pressed
                  </p>
                </div>

                {/* Support Sanding & Surface QA */}
                <div className="p-2.5 bg-zinc-900/60 border border-zinc-800 rounded flex items-center justify-between gap-2">
                  <div>
                    <label htmlFor="sanding-addon" className="text-[11px] font-mono text-zinc-300 font-medium cursor-pointer block">
                      Support Sanding &amp; Surface QA
                    </label>
                    <p className="text-[10px] text-zinc-500 mt-0.5">
                      Hand-trimmed support nubs &amp; micro-sanding
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono text-[#00FF66] font-bold">+₹49</span>
                    <input
                      id="sanding-addon"
                      type="checkbox"
                      checked={Boolean(addOns.supportSanding)}
                      onChange={(e) => setAddOns((prev) => ({ ...prev, supportSanding: e.target.checked }))}
                      className="accent-[#00FF66] w-4 h-4 rounded cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>

            </div>

            {/* ===== MOBILE TAB 3 (< lg): FINAL QUOTE RECEIPT + PAYMENT ===== */}
            <div className={`${mobileTab === 'slicer' ? 'hidden' : ''} lg:block`}>

            {/* ================= STEP 3: THE SINGLE FINAL ITEMIZED QUOTE RECEIPT ================= */}
            {(() => {
              const calcRatePerG = slicerQuote?.material?.retailRatePerG ?? (selectedMaterialType === 'tpu' ? 3.5 : selectedMaterialType === 'petg' ? 2.5 : 2.0);
              const calcPartWeight = slicerQuote?.partWeightTotalGrams ?? (Number(slicerQuote?.partWeightGrams ?? weight) * partQuantity);
              const calcPartCost = Number((slicerQuote?.partMaterialCost ?? (calcPartWeight * calcRatePerG)).toFixed(2));

              const calcSupportWeight = supportsEnabled ? (slicerQuote?.supportWeightTotalGrams ?? (Number(slicerQuote?.supportWeightGrams ?? 0) * partQuantity)) : 0;
              const calcBrimWeight = slicerQuote?.autoBrim ? (slicerQuote?.brimWeightTotalGrams ?? (Number(slicerQuote?.brimWeightGrams ?? 0) * partQuantity)) : 0;
              const calcSupportBrimWeight = Number((calcSupportWeight + calcBrimWeight).toFixed(1));
              const calcSupportCost = supportsEnabled ? Number(((slicerQuote?.supportMaterialCost ?? (calcSupportWeight * calcRatePerG)) + (calcBrimWeight * calcRatePerG)).toFixed(2)) : 0;

              const calcMachineHours = Number(slicerQuote?.totalMachineHours ?? machineHoursLine ?? 0);
              const calcMachineCost = Number((slicerQuote?.batchMachineCost ?? machineLine ?? (calcMachineHours * 25)).toFixed(2));

              const calcAddOnsTotal = Number((slicerQuote?.addOns?.total ?? 0).toFixed(2));
              const calcDiscount = Number((slicerQuote?.discountAmount ?? 0).toFixed(2));
              const finalPayable = Number(checkoutTotal || cost || 0);
              const calcSetupFee = 49.00;
              const calcMakingCost = Number((slicerQuote?.batchMakingCost ?? (slicerQuote?.unitMakingCost ? slicerQuote.unitMakingCost * partQuantity : (calcPartWeight + calcSupportWeight) * 1.0)).toFixed(2));

              // Exact balance check:
              const computedSubtotal = Number((calcPartCost + calcSupportCost + calcMachineCost + calcMakingCost + calcSetupFee + calcAddOnsTotal - calcDiscount).toFixed(2));
              const floorAdjustment = Number(Math.max(0, finalPayable - computedSubtotal).toFixed(2));

              return (
                <div className="mt-4 bg-black/40 border border-[#2b2e36]/80 cut-sm px-3.5 text-sm">
                  <div className="flex items-center justify-between border-b border-[#2b2e36]/60 py-2.5">
                    <span className="telemetry text-xs font-bold text-white flex items-center gap-1.5">
                      <span className="text-[#00FF66]">🧾</span>
                      <span>Itemized Cost Breakdown</span>
                      <span className="sr-only">Instant 3D Print Quote Breakdown</span>
                    </span>
                    <span className="text-[10px] font-mono text-zinc-400">
                      {partQuantity > 1 ? `${partQuantity} Units Batch` : 'Single Part'}
                    </span>
                  </div>

                  {/* Model Filament */}
                  <div className="flex items-center justify-between gap-3 py-2 border-b border-white/5">
                    <span className="text-zinc-300 text-xs">
                      Model Filament ({calcPartWeight.toFixed(1)}g @ ₹{calcRatePerG.toFixed(2)}/g)
                    </span>
                    <span className="font-mono text-zinc-100 font-semibold shrink-0">
                      ₹{calcPartCost.toFixed(2)}
                    </span>
                  </div>

                  {/* Support & Brim Material */}
                  <div className="flex items-center justify-between gap-3 py-2 border-b border-white/5">
                    <span className="text-zinc-300 text-xs">
                      Support &amp; Brim ({supportsEnabled ? calcSupportBrimWeight.toFixed(1) : '0.0'}g @ ₹{calcRatePerG.toFixed(2)}/g)
                      {slicerQuote?.autoBrim && <span className="block text-[10px] text-amber-300 font-mono">🛡️ incl. Auto-Brim +1.5g</span>}
                    </span>
                    <span className="font-mono text-zinc-100 font-semibold shrink-0">
                      ₹{supportsEnabled ? calcSupportCost.toFixed(2) : '0.00'}
                    </span>
                  </div>

                  {/* Machine Print Time */}
                  <div className="flex items-center justify-between gap-3 py-2 border-b border-white/5">
                    <span className="text-zinc-300 text-xs">
                      Machine Time ({Math.floor(calcMachineHours)}h {Math.round((calcMachineHours % 1) * 60)}m @ ₹25/h)
                    </span>
                    <span className="font-mono text-zinc-100 font-semibold shrink-0">
                      ₹{calcMachineCost.toFixed(2)}
                    </span>
                  </div>

                  {/* Print Labor & Finishing */}
                  <div className="flex items-center justify-between gap-3 py-2 border-b border-white/5">
                    <span className="text-zinc-300 text-xs">
                      Print Labor &amp; QA ({(calcPartWeight + (supportsEnabled ? calcSupportBrimWeight : 0)).toFixed(1)}g @ ₹1.00/g)
                    </span>
                    <span className="font-mono text-zinc-100 font-semibold shrink-0">
                      ₹{calcMakingCost.toFixed(2)}
                    </span>
                  </div>

                  {/* Base Setup Fee */}
                  <div className="flex items-center justify-between gap-3 py-2 border-b border-white/5">
                    <span className="text-zinc-300 text-xs">
                      Slicing, Calibration &amp; QA Setup
                    </span>
                    <span className="font-mono text-zinc-100 font-semibold shrink-0">
                      ₹{calcSetupFee.toFixed(2)}
                    </span>
                  </div>

                  {/* Selected Add-Ons (if any) */}
                  {calcAddOnsTotal > 0 && (
                    <div className="flex items-center justify-between gap-3 py-2 border-b border-white/5 text-[#00E5FF]">
                      <span className="text-xs flex items-center gap-1 font-medium">
                        <span>⚙</span>
                        <span>Manufacturing Add-Ons</span>
                      </span>
                      <span className="font-mono font-semibold shrink-0">
                        +₹{calcAddOnsTotal.toFixed(2)}
                      </span>
                    </div>
                  )}

                  {/* Small-Order Floor Adjustment (if applicable) */}
                  {floorAdjustment > 0 && (
                    <div className="flex items-center justify-between gap-3 py-2 border-b border-white/5 text-amber-300">
                      <span className="text-xs flex items-center gap-1 font-medium">
                        <span>🛡️</span>
                        <span>Small-Order Minimum Floor Adjustment</span>
                      </span>
                      <span className="font-mono font-semibold shrink-0">
                        +₹{floorAdjustment.toFixed(2)}
                      </span>
                    </div>
                  )}

                  {/* Bulk Discount (if any) */}
                  {calcDiscount > 0 && (
                    <div className="flex items-center justify-between gap-3 py-2 border-b border-white/5 text-[#00FF66]">
                      <span className="text-xs flex items-center gap-1 font-bold">
                        <span>★</span>
                        <span>Bulk Discount ({slicerQuote.discountPercentage}% OFF)</span>
                      </span>
                      <span className="font-mono font-bold shrink-0">
                        -₹{calcDiscount.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Large Total Payable Callout */}
            <div className="mt-3 p-4 bg-[#00FF66]/5 border border-[#00FF66]/30 cut-sm flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="telemetry text-[10px] text-zinc-400 block">FINAL TOTAL PAYABLE</span>
                {partQuantity > 1 && (
                  <span className="text-[11px] font-mono text-[#00FF66] block mt-0.5">
                    (₹{Number(unitPrice).toFixed(2)} / unit · {partQuantity} units)
                  </span>
                )}
              </div>
              <span key={String(checkoutTotal)} className="tick-flash font-mono font-extrabold text-white text-3xl shrink-0">
                ₹{Number(displayTotal).toFixed(2)}
                <span className="text-xs font-normal text-zinc-400 ml-1">INR</span>
              </span>
            </div>

            {/* Minimum Order Floor note */}
            {minimumApplied && (
              <div className="mt-2 px-3.5 py-2 border border-[#2b2e36]/80 bg-black/40 text-[11px] text-amber-300/90 cut-sm">
                Small-print minimum ₹{quoteData?.pricing?.minOrderValue ?? 149} applied — covers handling &amp; small-order calibration.
              </div>
            )}

            {/* ================= STEP 4: PAYMENT MODE, PINCODE & CHECKOUT ================= */}
            {/* Payment Mode Selector */}
            <div className="mt-3 border border-[#2b2e36] bg-black/40 p-3.5 cut-sm">
              <span className="telemetry block text-[11px] text-zinc-300 font-medium mb-2">
                Payment Mode
              </span>
              <div className="grid grid-cols-1 gap-2">
                <label className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition border ${paymentMode === 'Prepaid' ? 'border-[#FF6500] bg-[#FF6500]/10' : 'border-[#2b2e36] hover:border-zinc-600'}`}>
                  <input
                    type="radio"
                    name="paymentModeReceipt"
                    value="Prepaid"
                    checked={paymentMode === 'Prepaid'}
                    onChange={() => setPaymentMode('Prepaid')}
                    className="accent-[#FF6500]"
                  />
                  <span>
                    <span className="block text-zinc-100 font-medium text-xs">Prepaid · Instant UPI</span>
                    <span className="block text-[10px] text-zinc-500">Pay now, immediate print queue priority</span>
                  </span>
                </label>
                <label className={`flex items-center gap-2.5 border px-3 py-2 cursor-pointer transition ${paymentMode === 'COD' ? 'border-amber-500 bg-amber-950/30' : 'border-[#2b2e36] hover:border-zinc-600'}`}>
                  <input
                    type="radio"
                    name="paymentModeReceipt"
                    value="COD"
                    checked={paymentMode === 'COD'}
                    onChange={() => setPaymentMode('COD')}
                    className="accent-amber-500"
                  />
                  <span>
                    <span className="block text-zinc-100 font-medium text-xs">Cash on Delivery</span>
                    <span className="block text-[10px] text-zinc-500">Pay cash when courier delivers package</span>
                  </span>
                </label>
              </div>
            </div>

            {/* Delivery PIN Code Checker */}
            <div className="mt-3 border border-[#2b2e36] bg-black/40 p-3 text-xs space-y-1.5 cut-sm">
              <div className="flex items-center justify-between">
                <label className="telemetry text-[11px] text-zinc-300 font-medium">
                  Delivery PIN Code (Pan-India)
                </label>
                {deliveryLoading && (
                  <span className="text-[10px] text-[#FF6500] flex items-center gap-1 font-mono">
                    <svg className="animate-spin h-3 w-3 text-[#FF6500]" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                    </svg>
                    Checking…
                  </span>
                )}
              </div>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="e.g. 450221"
                value={deliveryPin}
                onChange={(e) => setDeliveryPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="field-mech w-full px-3 py-1.5 text-zinc-100 text-base sm:text-xs font-mono"
              />
              <p className="text-[11px] text-zinc-400">
                {deliveryQuote
                  ? `Delivery to ${deliveryQuote.pincode}: ${deliveryQuote.freeShipping ? 'FREE' : `₹${Number(deliveryQuote.deliveryCharge).toFixed(2)}`}`
                  : 'Flat ₹99 Pan-India courier (FREE on orders ₹499+)'}
              </p>
            </div>

            {/* Primary Full-Width Single Checkout CTA */}
            <button
              type="button"
              onClick={() => setCheckoutOpen(true)}
              className="mt-3 h-12 w-full px-4 text-sm font-bold text-white bg-[#FF6500] hover:bg-[#e05800] transition flex items-center justify-center gap-2 cut-sm shadow-lg shadow-orange-950/40 cursor-pointer"
            >
              <span>Proceed to Instant UPI Checkout →</span>
            </button>
            <p className="mt-1.5 text-[10px] text-zinc-500 text-center">
              Prices inclusive of 18% GST · Delivery confirmed by PIN.
            </p>

            {/* Share 3D Quote Link & Permalink Actions */}
            <div className="flex flex-wrap items-center gap-2.5 mt-3 pt-3 border-t border-[#2b2e36]/60">
              <button
                type="button"
                onClick={handleShareQuoteLink}
                disabled={shareLoading}
                className="btn-mech cut-sm px-3.5 py-1.5 text-xs text-zinc-200 border-zinc-700 hover:border-[#00E5FF] hover:text-[#00E5FF] flex items-center gap-1.5 transition cursor-pointer"
                title="Generate a permanent shareable URL for this 3D quote"
              >
                <span>🔗</span>
                <span>{shareLoading ? 'Generating Link…' : shareCopied ? '✓ Link Copied to Clipboard!' : 'Share 3D Quote Link'}</span>
              </button>
              {shareSuccessUrl && (
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-cyan-300 bg-black/60 px-2.5 py-1 border border-cyan-800/80 rounded">
                  <span className="text-zinc-500">Permalink:</span>
                  <a
                    href={shareSuccessUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline text-cyan-400 truncate max-w-xs sm:max-w-md"
                  >
                    {shareSuccessUrl}
                  </a>
                </div>
              )}
            </div>

            {/* Customer Checkout & Confirmation Card */}
            <div className="mt-6 pt-6 border-t border-zinc-800">
              {confirmedOrder ? (
                <div className="p-5 rounded-xl bg-emerald-950/60 border border-emerald-800 text-emerald-200 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        <span className="text-xs font-mono uppercase tracking-wider text-emerald-400 font-bold">
                          Order Confirmed!
                        </span>
                      </div>
                      <h4 className="text-lg font-bold text-white">
                        Order #{confirmedOrder.id} successfully placed
                      </h4>
                      <p className="text-xs text-zinc-300 mt-1">
                        Redirecting to your live order tracking page...
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopyRef(confirmedOrder.id)}
                        className="px-3.5 py-2 rounded-lg bg-zinc-900 border border-emerald-700 text-xs font-mono text-emerald-300 hover:bg-zinc-800 transition flex items-center gap-1.5"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        <span>SNKB-ORD-{confirmedOrder.id}</span>
                        {copiedRef ? <span>✓ Copied!</span> : <span>(Copy)</span>}
                      </button>

                      <a
                        href={`/track/${confirmedOrder.id}`}
                        className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center gap-1 shadow-lg"
                      >
                        <span>Track Order Now</span>
                        <span>→</span>
                      </a>
                    </div>
                  </div>

                  {/* Dynamic UPI Payment QR & WhatsApp Sharing */}
                  <UpiPaymentQr
                    orderId={confirmedOrder.id}
                    amount={confirmedOrder.grand_total || confirmedOrder.grandTotal || (deliveryQuote ? deliveryQuote.grandTotal : cost)}
                    fileName={confirmedOrder.file_name || confirmedOrder.fileName || fileName}
                    deliveryPincode={confirmedOrder.pincode || deliveryPin}
                    paymentMode={confirmedOrder.payment_mode || confirmedOrder.paymentMode || paymentMode}
                    initialUtr={confirmedOrder.payment_utr || confirmedOrder.paymentUtr || paymentUtr}
                    showWhatsApp={true}
                  />
                </div>
              ) : (
                checkoutOpen && typeof document !== 'undefined' && createPortal(
                <div className="fixed inset-0 z-[100] flex justify-end" role="dialog" aria-modal="true" aria-label="Instant UPI Checkout">
                  <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setCheckoutOpen(false)} />
                  <div className="relative w-full max-w-md h-full overflow-y-auto bg-[#101114] border-l border-[#2b2e36] shadow-2xl z-10">
                    <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-[#101114]/95 backdrop-blur border-b border-[#2b2e36]">
                      <span className="telemetry text-[11px] font-bold text-white flex items-center gap-2">
                        <span className="w-2 h-2 bg-[#FF6500]"></span>
                        <span>INSTANT UPI CHECKOUT</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setCheckoutOpen(false)}
                        className="btn-mech px-3 py-1.5 text-[11px] text-zinc-300 hover:text-white cursor-pointer"
                      >
                        ✕ Close
                      </button>
                    </div>
                    <div className="p-4 pb-8">
                <div className="panel-ind cut-sm p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-[#2b2e36]/80">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <span className="w-2 h-2 bg-[#FF6500]"></span>
                        <span>Confirm Order & Customer Details</span>
                      </h4>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Provide contact information to queue your model for high-precision slicing & manufacturing.
                      </p>
                    </div>

                    {(quoteData?.orderId || quoteData?.order?.id) && (
                      <button
                        type="button"
                        onClick={() => handleCopyRef(quoteData?.orderId || quoteData?.order?.id)}
                        className="text-[11px] font-mono text-zinc-400 hover:text-zinc-200 bg-zinc-950 px-2.5 py-1 rounded border border-zinc-800 flex items-center gap-1 shrink-0 self-start sm:self-auto"
                        title="Click to copy pending order reference"
                      >
                        <span>Ref: SNKB-ORD-{quoteData?.orderId || quoteData?.order?.id}</span>
                        {copiedRef ? <span className="text-emerald-400">✓</span> : <span>📋</span>}
                      </button>
                    )}
                  </div>

                  {confirmationError && (
                    <div className="mb-4 p-3 rounded-lg bg-rose-950/70 border border-rose-800 text-rose-200 text-xs flex items-center gap-2">
                      <svg className="w-4 h-4 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span>{confirmationError}</span>
                    </div>
                  )}

                  <form onSubmit={handleConfirmOrder} className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 text-xs">
                      <div>
                        <label className="telemetry block text-[11px] text-zinc-300 font-medium mb-1">
                          Customer Name <span className="text-rose-400">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Alex Chen"
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          className="field-mech w-full px-3 py-2 text-zinc-100 text-base sm:text-xs transition"
                        />
                      </div>

                      <div>
                        <label className="telemetry block text-[11px] text-zinc-300 font-medium mb-1">
                          Email Address <span className="text-rose-400">*</span>
                        </label>
                        <input
                          type="email"
                          required
                          placeholder="alex.chen@example.com"
                          value={customerEmail}
                          onChange={(e) => setCustomerEmail(e.target.value)}
                          className="field-mech w-full px-3 py-2 text-zinc-100 text-base sm:text-xs transition"
                        />
                      </div>

                      <div>
                        <label className="telemetry block text-[11px] text-zinc-300 font-medium mb-1">
                          Filament Color Choice
                        </label>
                        <select
                          value={colorChoice}
                          onChange={(e) => {
                            setColorChoice(e.target.value);
                            setSelectedMaterial(e.target.value);
                            updateMeshMaterial(e.target.value, selectedAccentMaterial, isWireframe, showSupports);
                          }}
                          className="field-mech w-full px-3 py-2 text-zinc-100 text-base sm:text-xs transition"
                        >
                          {MATERIAL_PRESETS.map((m) => (
                            <option key={m.id} value={m.name}>
                              {m.name} ({selectedMaterialType === 'petg' ? 'PETG' : selectedMaterialType === 'tpu' ? 'TPU 95A' : 'Tough PLA+'})
                            </option>
                          ))}
                          <option value="Dark Gray">Dark Gray (Technical PLA+)</option>
                        </select>
                      </div>

                      <div>
                        <label className="telemetry block text-[11px] text-zinc-300 font-medium mb-1">
                          Optional Notes / Infill Preference
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. 20% infill, smooth surface"
                          value={customerNotes}
                          onChange={(e) => setCustomerNotes(e.target.value)}
                          className="field-mech w-full px-3 py-2 text-zinc-100 text-base sm:text-xs transition"
                        />
                      </div>
                    </div>

                    {/* Delivery & Shipping: Frictionless PIN input + Courier Dispatch */}
                    <div className="border border-[#2b2e36] bg-black/40 p-3.5 space-y-2.5">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="telemetry text-[11px] text-zinc-300 font-medium">
                            Delivery PIN Code (Pan-India)
                          </label>
                          {deliveryLoading && (
                            <span className="text-[11px] text-[#FF6500] flex items-center gap-1 font-mono">
                              <svg className="animate-spin h-3 w-3 text-[#FF6500]" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                              </svg>
                              Checking courier…
                            </span>
                          )}
                        </div>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="e.g. 450221"
                          value={deliveryPin}
                          onChange={(e) => {
                            setDeliveryPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                          }}
                          className="field-mech w-full px-3 py-2 text-zinc-100 text-base sm:text-xs transition font-mono"
                        />
                      </div>

                      {/* Courier & Dispatch status badge */}
                      <div className="bg-black/40 border border-[#2b2e36]/90 p-3 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-zinc-200 font-medium">
                            <span>🚚</span>
                            <span>Shipping & Logistics</span>
                          </span>
                          <span className="telemetry text-[10px] px-2 py-0.5 bg-[#FF6500]/10 text-[#FF6500] border border-[#FF6500]/50">
                            Delhivery · Blue Dart
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-400">
                          {deliveryQuote
                            ? `Delivery to ${deliveryQuote.pincode} · Standard courier (2–4 days): ${deliveryQuote.freeShipping ? 'FREE' : `₹${Number(deliveryQuote.deliveryCharge).toFixed(2)}`}`
                            : 'Flat ₹99 Pan-India Delivery via Delhivery / Blue Dart (FREE on ₹499+)'}
                        </p>
                        {deliveryQuote?.freeShipping && (
                          <p className="text-[11px] text-emerald-400 font-medium">
                            ✓ FREE delivery unlocked on orders ₹499 and above.
                          </p>
                        )}
                        {deliveryQuote && !deliveryQuote.freeShipping && (
                          <p className="text-[10px] text-amber-400 font-mono">
                            ⚡ Add ₹{Math.max(0, 499 - (deliveryQuote.grandTotal - deliveryQuote.deliveryCharge)).toFixed(0)} more of parts for FREE delivery!
                          </p>
                        )}
                        {deliveryQuote && (
                          <div className="flex flex-wrap items-center gap-2 pt-1 text-[10px] text-zinc-400 font-mono">
                            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                              ⏱ Estimated Dispatch: 24–48 hrs
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                              📍 Region: {deliveryQuote.pincode?.slice(0, 2) === '11' || deliveryQuote.pincode?.slice(0, 2) === '40' || deliveryQuote.pincode?.slice(0, 2) === '56' ? 'Metro Air Express (2–3 Days)' : 'Regional Surface (3–5 Days)'}
                            </span>
                          </div>
                        )}
                        {deliveryQuote && (
                          <div className="flex items-center justify-between pt-1 mt-1 border-t border-zinc-800">
                            <span className="font-semibold text-zinc-200">Grand total (print + delivery)</span>
                            <span className="font-mono font-bold text-white">
                              ₹{Number(deliveryQuote.grandTotal).toFixed(2)}{' '}
                              <span className="font-normal text-zinc-500">INR</span>
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Payment mode: Prepaid vs Cash on Delivery */}
                    <div className="border border-[#2b2e36] bg-black/40 p-3.5">
                      <span className="telemetry block text-[11px] text-zinc-300 font-medium mb-2">
                        Payment Mode
                      </span>
                      <div className="grid grid-cols-1 gap-2.5">
                        <label className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition border ${paymentMode === 'Prepaid' ? 'border-[#FF6500] bg-[#FF6500]/10' : 'border-[#2b2e36] hover:border-zinc-600'}`}>
                          <input
                            type="radio"
                            name="paymentMode"
                            value="Prepaid"
                            checked={paymentMode === 'Prepaid'}
                            onChange={() => setPaymentMode('Prepaid')}
                            className="accent-[#FF6500]"
                          />
                          <span>
                            <span className="block text-zinc-100 font-medium">Prepaid · UPI</span>
                            <span className="block text-[11px] text-zinc-500">Pay now, print on priority</span>
                          </span>
                        </label>
                        <label className={`flex items-center gap-2.5 border px-3 py-2.5 cursor-pointer transition ${paymentMode === 'COD' ? 'border-amber-500 bg-amber-950/30' : 'border-[#2b2e36] hover:border-zinc-600'}`}>
                          <input
                            type="radio"
                            name="paymentMode"
                            value="COD"
                            checked={paymentMode === 'COD'}
                            onChange={() => setPaymentMode('COD')}
                            className="accent-amber-500"
                          />
                          <span>
                            <span className="block text-zinc-100 font-medium">Cash on Delivery</span>
                            <span className="block text-[11px] text-zinc-500">Pay cash when the courier arrives</span>
                          </span>
                        </label>
                      </div>

                      {paymentMode === 'Prepaid' && (
                        <div className="mt-3 pt-3 border-t border-[#2b2e36]">
                          <UpiPaymentQr
                            orderId={quoteData?.orderId || quoteData?.order?.id || 'PENDING'}
                            amount={deliveryQuote ? deliveryQuote.grandTotal : checkoutTotal}
                            fileName={fileName}
                            deliveryPincode={deliveryPin}
                            paymentMode="Prepaid"
                            initialUtr={paymentUtr}
                            onUtrSaved={(utr) => setPaymentUtr(utr)}
                            compact={true}
                            showWhatsApp={false}
                          />
                        </div>
                      )}
                    </div>

                    <div className="pt-2 flex flex-col gap-3 pb-4">
                      <div className="text-xs text-zinc-400 flex items-center justify-between">
                        <span>Total estimate:</span>
                        <span className="font-mono font-bold text-white text-sm">
                          ₹{deliveryQuote ? Number(deliveryQuote.grandTotal).toFixed(2) : Number(checkoutTotal).toFixed(2)} INR
                        </span>
                      </div>
                      {!deliveryQuote && (
                        <span className="block text-[10px] text-zinc-500">
                          + ₹99 flat delivery (via Delhivery / Blue Dart)
                        </span>
                      )}

                      <button
                        type="submit"
                        disabled={confirmingOrder}
                        className="h-12 w-full px-6 text-sm font-bold text-white bg-[#FF6500] hover:bg-[#e05800] transition flex items-center justify-center gap-2 cut-sm shadow-lg shadow-orange-950/40 cursor-pointer disabled:opacity-50"
                      >
                        {confirmingOrder ? (
                          <>
                            <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                            </svg>
                            <span>Submitting Order...</span>
                          </>
                        ) : (
                          <>
                            <span>Confirm &amp; Queue Print Job</span>
                            <span>→</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
                    </div>
                  </div>
                </div>,
                document.body
                )
              )}
            </div>
            </div>
          </div>
        )}
          </div>
        </aside>
      </div>

      {/* ============ MOBILE STICKY CHECKOUT BAR (< lg) ============ */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 pb-safe pointer-events-none">
        <div className="pointer-events-auto mx-2 mb-2 flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-[#2b2e36] bg-[#101114]/95 backdrop-blur-xl shadow-2xl">
          <div className="min-w-0">
            <div className="telemetry text-[9px] text-zinc-500 truncate">
              {fileName ? fileName : 'No 3D model loaded'}
            </div>
            <div className="font-mono text-[11px] text-zinc-300 truncate">
              {bedReady ? `${Number(weight || 0).toFixed(1)}g` : '0.0g'} • {bedReady ? selectedMaterial : 'Standby'}
            </div>
            <div className="font-mono font-extrabold text-white text-base leading-tight">
              ₹{Number(displayTotal || 0).toFixed(2)} <span className="text-[10px] font-normal text-zinc-400">INR</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => goToMobileTab('quote')}
            disabled={!bedReady || isOversized}
            className="shrink-0 min-h-[44px] px-4 cut-sm text-xs font-bold text-white bg-[#FF6500] hover:bg-[#e05800] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 cursor-pointer"
          >
            <span>Review &amp; Pay</span>
            <span>→</span>
          </button>
        </div>
      </div>
    </div>
  );
}
