/**
 * src/components/heroPrintStage.js
 *
 * Interactive 3D Bambu Lab A1 Mini Build Volume Stage for the Hero Section.
 *
 * Features:
 * - 180x180x180 mm glowing translucent holographic build-volume cage with mm ruler ticks
 * - Textured PEI spring steel build plate with millimeter measuring grid
 * - Animated vertical laser scan plane sweeping continuously through the volume
 * - Real solid 3D model sitting upright in the center of the bed
 * - "Try a Model" Switcher Bar (Mecha Figure, 3DBenchy, Crystal Dragon, Gear Bearing) with geometry caching
 * - 5 clickable filament spool colors with real-time smooth material transitions
 * - "Solid Print View" vs "X-Ray Infill View" toggle
 * - OrbitControls with enableZoom: false (page scrolling is never hijacked) + turntable auto-rotation
 * - IntersectionObserver to pause render loop when off-screen
 */

import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { fitGeometryToA1MiniBed, fitMultiPartGeometriesToA1MiniBed } from '../utils/fitGeometryToBed.js';
import { analyzeMeshShells, buildShellExplodableGroup, updateExplodableGroup } from '../utils/explodableAssembly.js';
import { createFDMLayerBumpTexture, createPEIBumpTexture } from '../utils/physicalAssemblies.js';
import { resolvePixelRatio, attachTouchScrollLock } from '../utils/viewerTouchControls.js';

const stlLoader = new STLLoader();
const geometryCache = new Map();

export class HeroStageRenderer {
  constructor(containerEl) {
    this.container = containerEl;
    this.canvas = containerEl.querySelector('.hero-stage-canvas');
    this.loadingOverlay = containerEl.querySelector('.hero-stage-loading');
    this.modelButtons = containerEl.querySelectorAll('.model-switch-btn');
    this.swatchButtons = containerEl.querySelectorAll('.hero-swatch-pill');
    this.viewModeBtn = containerEl.querySelector('.view-mode-toggle-btn');
    this.viewModeLabel = containerEl.querySelector('.view-mode-label');
    this.explodeBtn = containerEl.querySelector('.hero-explode-toggle-btn');
    this.explodeLabel = containerEl.querySelector('.hero-explode-label');
    this.sendToSlicerBtn = containerEl.querySelector('.hero-send-slicer-btn');
    this.modelNameBadge = containerEl.querySelector('.hero-model-name');
    this.triCountBadge = containerEl.querySelector('.hero-tri-count');

    // State
    this.currentColor = '#FF6500';
    this.isXRayMode = false;
    this.isExploded = false;
    this.explodeTarget = 0;
    this.activeModelId = 'mecha';
    this.activeModelUrl = '/models/posable-snap-fit-mecha.stl';
    this.activeBaseUrl = '/models/posable-snap-fit-mecha-base.stl';
    this.activeAccentUrl = '/models/posable-snap-fit-mecha-accent.stl';
    this.activePartBase = 'Inner Ball-Joint Skeleton';
    this.activePartAccent = 'Snap-On Armor Plates';
    this.activeModelName = 'Posable Snap-Fit Mecha';
    this.activeAssemblyType = 'multi-part';
    this.activeCanExplode = true;
    this.assemblyBadge = containerEl.querySelector('.hero-assembly-badge');

    // Three.js instances
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.stageGroup = null;
    this.modelGroup = null;
    this.solidMesh = null;
    this.infillWireMesh = null;
    this.explodableGroup = null;
    // Genuine two-plate assembly (never plane-sliced): base plate stays seated,
    // accent plate lifts along +Y with dashed alignment guides.
    this.baseMesh = null;
    this.accentMesh = null;
    this.explodeGuides = null;
    this.explodeCurrent = 0;
    this.maxExplode = 40;
    this.laserPlane = null;
    this.laserLight = null;

    // Materials
    this.solidMaterial = null;
    this.accentMaterial = null;
    this.xrayShellMaterial = null;
    this.infillWireMaterial = null;

    // Loop & visibility
    this.animId = null;
    this.isVisible = false;
    this.hasInitialized = false;
    this.clock = new THREE.Clock();

    this.initObserver();
    this.bindEvents();
  }

  initObserver() {
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          this.isVisible = entry.isIntersecting;
          if (this.isVisible) {
            if (!this.hasInitialized) {
              this.initThree();
            } else {
              this.startLoop();
            }
          } else {
            this.stopLoop();
          }
        });
      },
      { threshold: 0.1 }
    );
    this.observer.observe(this.container);
  }

  initThree() {
    this.hasInitialized = true;
    const parent = this.canvas.parentElement || this.container;
    const rect = parent.getBoundingClientRect();
    const width = Math.max(parent.clientWidth || rect.width || 540, 200);
    const height = Math.max(parent.clientHeight || rect.height || 460, 200);

    // 1. Scene
    this.scene = new THREE.Scene();

    // 2. Camera
    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.5, 2000);
    this.camera.position.set(0, 140, 290);

    // 3. Renderer with tone mapping
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(resolvePixelRatio());
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // RoomEnvironment for realistic specular reflections and bevel highlights
    try {
      const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
      pmremGenerator.compileEquirectangularShader();
      const envScene = new RoomEnvironment();
      this.scene.environment = pmremGenerator.fromScene(envScene, 0.04).texture;
      envScene.dispose();
      pmremGenerator.dispose();
    } catch (envErr) {
      console.warn('[HeroStage] Could not initialize RoomEnvironment:', envErr);
    }

    // WebGL Context Loss Recovery
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[HeroStage] WebGL context lost. Pausing loop.');
      this.stopLoop();
    }, { once: true });

    this.canvas.addEventListener('webglcontextrestored', () => {
      console.log('[HeroStage] WebGL context restored. Rebuilding scene.');
      this.hasInitialized = false;
      this.initThree();
    }, { once: true });

    // 4. Orbit Controls (Strict: enableZoom = false to protect page scrolling)
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 1.6;
    this.controls.minPolarAngle = Math.PI * 0.15;
    this.controls.maxPolarAngle = Math.PI * 0.52; // prevent camera going deep below plate
    this.controls.target.set(0, 45, 0);

    // Pause auto-rotation on user drag, resume after delay
    let interactionTimer = null;
    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false;
      if (interactionTimer) clearTimeout(interactionTimer);
    });
    this.controls.addEventListener('end', () => {
      interactionTimer = setTimeout(() => {
        this.controls.autoRotate = true;
      }, 3500);
    });

    // 5. Studio Lighting Rig
    this.setupLighting();

    // 6. Stage Group (Bed + 180mm Cage + Animated Laser)
    this.stageGroup = new THREE.Group();
    this.scene.add(this.stageGroup);
    this.buildA1MiniStage();

    // 7. Model Group
    this.modelGroup = new THREE.Group();
    this.stageGroup.add(this.modelGroup);

    // 8. Materials
    this.setupMaterials();

    // 9. Load Initial 3D Model
    this.loadModel(this.activeModelUrl, this.activeModelName);

    // 10. Handle Window Resizes & Container ResizeObserver
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0 && this.camera && this.renderer) {
          this.camera.aspect = w / h;
          this.camera.updateProjectionMatrix();
          this.renderer.setSize(w, h, false);
        }
      }
    });
    this.resizeObserver.observe(parent);
    window.addEventListener('resize', this.onResize.bind(this));

    // 10b. Mobile scroll-trap guard: on touch devices a floating pill lets the
    //      user lock one-finger orbiting so the page scrolls cleanly over the
    //      canvas (Canvas starts locked so scrolling "just works").
    this.touchLock = attachTouchScrollLock({
      container: parent,
      controls: this.controls,
      defaultLocked: true,
    });

    // 11. Start RAF Loop
    this.startLoop();
  }

  setupLighting() {
    // Soft studio ambient light floor
    const ambLight = new THREE.AmbientLight(0xffffff, 0.22);
    this.scene.add(ambLight);

    // Hemisphere ambient light (cool ceiling, warm floor bounce)
    const hemiLight = new THREE.HemisphereLight(0xdce4f0, 0x14161a, 0.9);
    this.scene.add(hemiLight);

    // Key directional light (warm neutral 4500K studio softbox from front-right)
    const keyLight = new THREE.DirectionalLight(0xfff8ee, 2.8);
    keyLight.position.set(110, 160, 130);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.radius = 3.0;
    keyLight.shadow.camera.left = -140;
    keyLight.shadow.camera.right = 140;
    keyLight.shadow.camera.top = 200;
    keyLight.shadow.camera.bottom = -20;
    keyLight.shadow.camera.near = 10;
    keyLight.shadow.camera.far = 600;
    keyLight.shadow.bias = -0.0004;
    this.scene.add(keyLight);

    // Soft cool studio fill light (lifts underside shadows without washing out contrast)
    const fillLight = new THREE.DirectionalLight(0xdbe4f0, 0.85);
    fillLight.position.set(-100, 90, 90);
    this.scene.add(fillLight);

    // Crisp neutral studio rim/hair light (grazes bevels, chamfers, and silhouettes)
    const rimLight = new THREE.DirectionalLight(0xffffff, 1.35);
    rimLight.position.set(-120, 140, -100);
    this.scene.add(rimLight);

    // Back kicker light for clean silhouette separation
    const backLight = new THREE.DirectionalLight(0xf1f5f9, 0.65);
    backLight.position.set(0, 70, -150);
    this.scene.add(backLight);
  }

  setupMaterials() {
    const fdmBump = createFDMLayerBumpTexture();
    this.solidMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(this.currentColor),
      roughness: 0.48,
      metalness: 0.06,
      clearcoat: 0.10,
      clearcoatRoughness: 0.38,
      flatShading: false,
      ...(fdmBump ? { bumpMap: fdmBump, bumpScale: 0.02 } : {}),
    });

    this.xrayShellMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(this.currentColor),
      roughness: 0.22,
      metalness: 0.05,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });

    // Photorealistic accent plate (contrasting second spool, same studio finish)
    this.accentMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#EA580C'),
      roughness: 0.48,
      metalness: 0.06,
      clearcoat: 0.10,
      clearcoatRoughness: 0.38,
      flatShading: false,
      ...(fdmBump ? { bumpMap: fdmBump, bumpScale: 0.02 } : {}),
    });

    this.infillWireMaterial = new THREE.LineBasicMaterial({
      color: 0x00ff66,
      transparent: true,
      opacity: 0.85,
    });
  }

  buildA1MiniStage() {
    const bedSize = 180; // mm
    const halfBed = bedSize / 2;
    const maxHeight = 180; // mm

    // --- 1. PEI Spring Steel Build Plate Slab ---
    const bedGeo = new THREE.BoxGeometry(bedSize, 2, bedSize);
    const bedMat = new THREE.MeshStandardMaterial({
      color: 0x14161a,
      roughness: 0.7,
      metalness: 0.4,
    });
    const bedMesh = new THREE.Mesh(bedGeo, bedMat);
    bedMesh.position.y = -1;
    this.stageGroup.add(bedMesh);

    // Gold/textured PEI top sheet with subtle border
    const peiBump = createPEIBumpTexture();
    const sheetGeo = new THREE.PlaneGeometry(bedSize - 2, bedSize - 2);
    const sheetMat = new THREE.MeshStandardMaterial({
      color: 0x16181d,
      roughness: 0.72,
      metalness: 0.15,
      ...(peiBump ? { bumpMap: peiBump, bumpScale: 0.015 } : {}),
    });
    const sheetMesh = new THREE.Mesh(sheetGeo, sheetMat);
    sheetMesh.rotation.x = -Math.PI / 2;
    sheetMesh.position.y = 0.05;
    sheetMesh.receiveShadow = true;
    this.stageGroup.add(sheetMesh);

    // --- 2. 180x180 mm Grid Lines (10mm squares, 50mm major) ---
    const grid = new THREE.GridHelper(bedSize, 18, 0xea580c, 0x242832);
    grid.position.y = 0.1;
    if (grid.material) {
      grid.material.transparent = true;
      grid.material.opacity = 0.45;
    }
    this.stageGroup.add(grid);

    // Center Crosshair Marker
    const crossGeo = new THREE.BufferGeometry();
    const crossVerts = new Float32Array([
      -12, 0.2, 0,  12, 0.2, 0,
      0, 0.2, -12,  0, 0.2, 12,
    ]);
    crossGeo.setAttribute('position', new THREE.BufferAttribute(crossVerts, 3));
    const crossMat = new THREE.LineBasicMaterial({ color: 0x00ff66, transparent: true, opacity: 0.75 });
    const crosshair = new THREE.LineSegments(crossGeo, crossMat);
    this.stageGroup.add(crosshair);

    // Soft grounded contact shadow catcher just above the PEI sheet (sheet top ≈ 0.05)
    const heroCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(bedSize - 2, bedSize - 2),
      new THREE.ShadowMaterial({ opacity: 0.55 })
    );
    heroCatcher.rotation.x = -Math.PI / 2;
    heroCatcher.position.y = 0.06;
    heroCatcher.receiveShadow = true;
    this.stageGroup.add(heroCatcher);

    // --- 3. 180x180x180 mm Glowing Holographic Cage with Corner Brackets ---
    const cageGeo = new THREE.BufferGeometry();
    const cageVerts = [];

    // Base boundary
    cageVerts.push(
      -halfBed, 0, -halfBed,  halfBed, 0, -halfBed,
      halfBed, 0, -halfBed,   halfBed, 0, halfBed,
      halfBed, 0, halfBed,   -halfBed, 0, halfBed,
      -halfBed, 0, halfBed,  -halfBed, 0, -halfBed
    );

    // Top boundary
    cageVerts.push(
      -halfBed, maxHeight, -halfBed,  halfBed, maxHeight, -halfBed,
      halfBed, maxHeight, -halfBed,   halfBed, maxHeight, halfBed,
      halfBed, maxHeight, halfBed,   -halfBed, maxHeight, halfBed,
      -halfBed, maxHeight, halfBed,  -halfBed, maxHeight, -halfBed
    );

    // 4 Corner Vertical Columns
    cageVerts.push(
      -halfBed, 0, -halfBed,  -halfBed, maxHeight, -halfBed,
      halfBed, 0, -halfBed,   halfBed, maxHeight, -halfBed,
      halfBed, 0, halfBed,    halfBed, maxHeight, halfBed,
      -halfBed, 0, halfBed,   -halfBed, maxHeight, halfBed
    );

    // Ruler Ticks along the 4 vertical pillars (every 45mm: 45, 90, 135mm)
    [45, 90, 135].forEach((h) => {
      const tickLen = 4;
      // Front-left pillar
      cageVerts.push(-halfBed, h, halfBed, -halfBed + tickLen, h, halfBed);
      cageVerts.push(-halfBed, h, halfBed, -halfBed, h, halfBed - tickLen);
      // Front-right pillar
      cageVerts.push(halfBed, h, halfBed, halfBed - tickLen, h, halfBed);
      cageVerts.push(halfBed, h, halfBed, halfBed, h, halfBed - tickLen);
    });

    cageGeo.setAttribute('position', new THREE.Float32BufferAttribute(cageVerts, 3));
    const cageMat = new THREE.LineBasicMaterial({
      color: 0x00ff66,
      transparent: true,
      opacity: 0.35,
    });
    const cageMesh = new THREE.LineSegments(cageGeo, cageMat);
    this.stageGroup.add(cageMesh);

    // --- 4. Animated Laser Scan Plane ---
    const laserPlaneGeo = new THREE.PlaneGeometry(bedSize - 2, bedSize - 2);
    const laserPlaneMat = new THREE.MeshBasicMaterial({
      color: 0x00ff66,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.laserPlane = new THREE.Mesh(laserPlaneGeo, laserPlaneMat);
    this.laserPlane.rotation.x = -Math.PI / 2;
    this.laserPlane.position.y = 15;

    // Glowing laser boundary ring
    const laserRingGeo = new THREE.BufferGeometry();
    const ringVerts = [
      -halfBed, 0, -halfBed,  halfBed, 0, -halfBed,
      halfBed, 0, -halfBed,   halfBed, 0, halfBed,
      halfBed, 0, halfBed,   -halfBed, 0, halfBed,
      -halfBed, 0, halfBed,  -halfBed, 0, -halfBed,
    ];
    laserRingGeo.setAttribute('position', new THREE.Float32BufferAttribute(ringVerts, 3));
    const laserRingMat = new THREE.LineBasicMaterial({
      color: 0x00ff66,
      transparent: true,
      opacity: 0.8,
    });
    const laserRing = new THREE.LineSegments(laserRingGeo, laserRingMat);
    this.laserPlane.add(laserRing);

    // Moving point light for dynamic laser glow reflection
    this.laserLight = new THREE.PointLight(0x00ff66, 1.2, 80);
    this.laserPlane.add(this.laserLight);

    this.stageGroup.add(this.laserPlane);
  }

  updateAssemblyBadge() {
    if (this.assemblyBadge) {
      if (this.activeCanExplode) {
        if (this.isExploded && (this.baseMesh || this.explodableGroup)) {
          const baseName = this.baseMesh?.userData?.partName || 'Base Plate Assembly';
          const accentName = this.accentMesh?.userData?.partName || 'Accent Plate Assembly';
          this.assemblyBadge.textContent = `Separating: ${baseName} ▼ · ${accentName} ▲`;
        } else {
          this.assemblyBadge.textContent = 'Multi-Plate Snap-Fit • 0g AMS Purge Waste';
        }
        this.assemblyBadge.className = 'hero-assembly-badge telemetry text-[9px] font-mono mt-1.5 px-2 py-1 rounded border border-[#00FF66]/40 bg-[#00FF66]/10 text-[#00FF66] max-w-[280px] leading-snug';
      } else if (this.activeAssemblyType === 'print-in-place') {
        this.assemblyBadge.textContent = '🔒 PRINT-IN-PLACE MONOLITH — Hinges print pre-assembled; item cannot be exploded.';
        this.assemblyBadge.className = 'hero-assembly-badge telemetry text-[9px] font-mono mt-1.5 px-2 py-1 rounded border border-amber-500/50 bg-amber-950/60 text-amber-300 max-w-[280px] leading-snug';
      } else {
        this.assemblyBadge.textContent = '🔒 SINGLE-PIECE SOLID PRINT — Item cannot be exploded.';
        this.assemblyBadge.className = 'hero-assembly-badge telemetry text-[9px] font-mono mt-1.5 px-2 py-1 rounded border border-zinc-600/60 bg-zinc-900/80 text-zinc-300 max-w-[280px] leading-snug';
      }
    }
    if (this.explodeBtn) {
      const locked = !this.activeCanExplode;
      this.explodeBtn.disabled = locked;
      this.explodeBtn.classList.toggle('opacity-40', locked);
      this.explodeBtn.classList.toggle('cursor-not-allowed', locked);
      this.explodeBtn.title = locked ? 'Locked: single-piece / print-in-place model cannot be exploded' : 'Toggle Exploded Assembly View (Separates multi-part plates with dashed alignment guides)';
    }
    if (this.explodeLabel) {
      this.explodeLabel.textContent = this.activeCanExplode ? (this.isExploded ? 'Assemble' : 'Explode Assembly') : '🔒 Cannot Explode';
    }
  }

  loadModel(url, displayName) {
    if (this.loadingOverlay) {
      this.loadingOverlay.classList.remove('opacity-0', 'pointer-events-none');
    }

    // Genuine two-plate assemblies load their real base + accent STLs — the
    // combined single STL is never plane-sliced into fake floating chunks.
    if (this.activeCanExplode && this.activeBaseUrl && this.activeAccentUrl) {
      const cacheKey = `plates:${this.activeBaseUrl}|${this.activeAccentUrl}`;
      if (geometryCache.has(cacheKey)) {
        const cached = geometryCache.get(cacheKey);
        this.applyPlateGeometries(cached.base, cached.accent, displayName);
        return;
      }
      Promise.all([stlLoader.loadAsync(this.activeBaseUrl), stlLoader.loadAsync(this.activeAccentUrl)])
        .then(([baseGeo, accentGeo]) => {
          fitMultiPartGeometriesToA1MiniBed(baseGeo, accentGeo, 135, true);
          geometryCache.set(cacheKey, { base: baseGeo, accent: accentGeo });
          this.applyPlateGeometries(baseGeo, accentGeo, displayName);
        })
        .catch((err) => {
          console.warn(`[HeroStage] Plate STLs unavailable for ${url}, checking shells:`, err);
          this.loadSingleGeometry(url, displayName, true);
        });
      return;
    }

    this.loadSingleGeometry(url, displayName, false);
  }

  loadSingleGeometry(url, displayName, allowUnlock = false) {
    if (geometryCache.has(url)) {
      this.applySingleGeometry(geometryCache.get(url), displayName, allowUnlock);
      return;
    }

    stlLoader.load(
      url,
      (geometry) => {
        // Strict Mathematical Containment & Centering Engine
        fitGeometryToA1MiniBed(geometry, 135, true);
        geometryCache.set(url, geometry);
        this.applySingleGeometry(geometry, displayName, allowUnlock);
      },
      undefined,
      (err) => {
        console.warn(`[HeroStage] Error loading STL from ${url}, rendering procedural fallback mesh:`, err);
        const fallbackGeo = new THREE.TorusKnotGeometry(26, 7.5, 128, 32, 2, 3);
        fitGeometryToA1MiniBed(fallbackGeo, 110, false);
        geometryCache.set(url, fallbackGeo);
        this.applySingleGeometry(fallbackGeo, `${displayName || 'Precision Target'} (Calibration Mesh)`, allowUnlock);
      }
    );
  }

  clearModelMeshes() {
    // Clear old meshes
    if (this.solidMesh) {
      this.modelGroup.remove(this.solidMesh);
      this.solidMesh.geometry.dispose();
      this.solidMesh = null;
    }
    if (this.baseMesh) {
      this.modelGroup.remove(this.baseMesh);
      this.baseMesh.geometry.dispose();
      this.baseMesh = null;
    }
    if (this.accentMesh) {
      this.modelGroup.remove(this.accentMesh);
      this.accentMesh.geometry.dispose();
      this.accentMesh = null;
    }
    if (this.explodeGuides) {
      this.modelGroup.remove(this.explodeGuides);
      this.explodeGuides.geometry.dispose();
      this.explodeGuides.material.dispose();
      this.explodeGuides = null;
    }
    if (this.infillWireMesh) {
      this.modelGroup.remove(this.infillWireMesh);
      this.infillWireMesh.geometry.dispose();
      this.infillWireMesh = null;
    }
    if (this.explodableGroup) {
      this.modelGroup.remove(this.explodableGroup);
      this.explodableGroup = null;
    }
    this.explodeCurrent = 0;
  }

  applyPlateGeometries(baseGeo, accentGeo, displayName) {
    this.clearModelMeshes();
    this.isExploded = false;
    this.explodeTarget = 0;

    // 1. Genuine physical plates with photorealistic studio materials:
    // Base inner skeleton rendered in authentic Matte Charcoal PLA+ with subtle polymer sheen
    const chassisColor = new THREE.Color(0x22262e);
    const chassisMaterial = new THREE.MeshPhysicalMaterial({
      color: chassisColor,
      roughness: 0.42,
      metalness: 0.15,
      clearcoat: 0.12,
      clearcoatRoughness: 0.35,
      flatShading: false,
    });
    this.baseMesh = new THREE.Mesh(baseGeo, this.isXRayMode ? this.xrayShellMaterial : chassisMaterial);
    this.baseMesh.castShadow = true;
    this.baseMesh.receiveShadow = true;
    this.baseMesh.userData.partName = this.activePartBase || 'Inner Skeleton Frame';
    this.modelGroup.add(this.baseMesh);

    // Accent plate: Tactical snap armor rendered in active filament swatch
    this.accentMesh = new THREE.Mesh(accentGeo, this.accentMaterial);
    this.accentMesh.castShadow = true;
    this.accentMesh.receiveShadow = true;
    this.accentMesh.userData.partName = this.activePartAccent || 'Snap-On Armor Plates';
    this.modelGroup.add(this.accentMesh);

    // 2. Dashed orange CAD alignment guides (base top → accent bottom)
    const baseBox = baseGeo.boundingBox;
    const accentBox = accentGeo.boundingBox;
    if (baseBox && accentBox) {
      const topY = baseBox.max.y;
      const z0 = (baseBox.min.z + baseBox.max.z) / 2;
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([
        0, topY, z0,
        0, accentBox.min.y, z0,
      ], 3));
      const lineMat = new THREE.LineDashedMaterial({
        color: 0xff6500, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.85,
      });
      this.explodeGuides = new THREE.LineSegments(lineGeo, lineMat);
      this.explodeGuides.computeLineDistances();
      this.explodeGuides.visible = false;
      this.modelGroup.add(this.explodeGuides);
      const lift = Math.max(30, Math.min(70, (accentBox.max.y - accentBox.min.y) * 1.2 + 20));
      this.maxExplode = lift;
    }

    // 3. Infill Wireframe Inner Mesh (Visible in X-Ray View)
    const wireGeo = new THREE.WireframeGeometry(baseGeo);
    this.infillWireMesh = new THREE.LineSegments(wireGeo, this.infillWireMaterial);
    this.infillWireMesh.visible = this.isXRayMode;
    this.modelGroup.add(this.infillWireMesh);

    this.finishGeometryMount(baseGeo, accentGeo, displayName);
  }

  applySingleGeometry(geometry, displayName, allowUnlock = false) {
    this.clearModelMeshes();
    this.isExploded = false;
    this.explodeTarget = 0;

    // Honest monolith policy: a single STL is exploded ONLY when shell analysis
    // proves it contains genuinely disconnected physical shells (and the
    // catalog entry did not explicitly lock it). Never plane-slice.
    let shellGroup = null;
    try {
      const analysis = analyzeMeshShells(geometry, 0.02);
      if (allowUnlock && analysis.shellCount >= 2) {
        shellGroup = buildShellExplodableGroup(geometry, this.currentColor, '#00FF66', THREE, analysis);
        shellGroup.visible = false;
        this.modelGroup.add(shellGroup);
      }
    } catch (_) {
      shellGroup = null;
    }
    if (!shellGroup) {
      // Single solid body (or locked catalog monolith): render intact, lock explode.
      this.activeCanExplode = false;
      this.updateAssemblyBadge();
    } else {
      this.activeCanExplode = true;
      this.updateAssemblyBadge();
    }
    this.explodableGroup = shellGroup;

    // 1. Solid Mesh
    this.solidMesh = new THREE.Mesh(
      geometry,
      this.isXRayMode ? this.xrayShellMaterial : this.solidMaterial
    );
    this.solidMesh.castShadow = true;
    this.solidMesh.receiveShadow = true;
    this.solidMesh.visible = true;
    this.modelGroup.add(this.solidMesh);

    // 3. Infill Wireframe Inner Mesh (Visible in X-Ray View)
    const wireGeo = new THREE.WireframeGeometry(geometry);
    this.infillWireMesh = new THREE.LineSegments(wireGeo, this.infillWireMaterial);
    this.infillWireMesh.visible = this.isXRayMode;
    this.modelGroup.add(this.infillWireMesh);

    this.finishGeometryMount(geometry, null, displayName);
  }

  applyGeometry(geometry, displayName) {
    // Legacy entry point: route through the honest single-geometry path.
    this.applySingleGeometry(geometry, displayName);
  }

  finishGeometryMount(primaryGeo, accentGeo, displayName) {
    // 3. Update badges
    const triCount = (primaryGeo.attributes.position.count / 3)
      + (accentGeo ? accentGeo.attributes.position.count / 3 : 0);
    if (this.triCountBadge) {
      this.triCountBadge.textContent = `${Math.round(triCount).toLocaleString()} Tris`;
    }
    if (this.modelNameBadge) {
      this.modelNameBadge.textContent = displayName || 'Custom 3D Model';
    }

    // 4. Smooth camera focus
    const sphere = primaryGeo.boundingSphere;
    if (sphere) {
      const targetY = Math.max(sphere.center.y, 25);
      this.controls.target.set(0, targetY, 0);
    }

    // Hide loader
    if (this.loadingOverlay) {
      this.loadingOverlay.classList.add('opacity-0', 'pointer-events-none');
    }
  }

  setFilamentColor(hexColor) {
    this.currentColor = hexColor;
    const threeColor = new THREE.Color(hexColor);
    if (this.solidMaterial) {
      this.solidMaterial.color.copy(threeColor);
    }
    if (this.accentMaterial) {
      this.accentMaterial.color.copy(threeColor);
    }
    if (this.xrayShellMaterial) {
      this.xrayShellMaterial.color.copy(threeColor);
    }
    if (this.explodableGroup && this.explodableGroup.userData?.setColors) {
      this.explodableGroup.userData.setColors(hexColor, '#00FF66');
    }
  }

  toggleExplode() {
    if (!this.activeCanExplode) return;
    // Genuine plates must actually be mounted — never toggle a fake group.
    if (!this.accentMesh && !this.explodableGroup) return;
    this.isExploded = !this.isExploded;
    this.explodeTarget = this.isExploded ? 1 : 0;

    if (this.isExploded) {
      if (this.solidMesh && this.explodableGroup) this.solidMesh.visible = false;
      if (this.infillWireMesh) this.infillWireMesh.visible = false;
      if (this.explodableGroup) this.explodableGroup.visible = true;
      if (this.explodeLabel) this.explodeLabel.textContent = 'Assemble';
      if (this.explodeBtn) {
        this.explodeBtn.classList.add('border-[#FF6500]', 'text-[#FF6500]', 'bg-[#FF6500]/20');
      }
    } else {
      if (this.explodeLabel) this.explodeLabel.textContent = 'Explode Assembly';
      if (this.explodeBtn) {
        this.explodeBtn.classList.remove('border-[#FF6500]', 'text-[#FF6500]', 'bg-[#FF6500]/20');
      }
    }
    this.updateAssemblyBadge();
  }

  toggleViewMode() {
    this.isXRayMode = !this.isXRayMode;

    if (this.solidMesh) {
      this.solidMesh.material = this.isXRayMode
        ? this.xrayShellMaterial
        : this.solidMaterial;
    }

    if (this.infillWireMesh) {
      this.infillWireMesh.visible = this.isXRayMode;
    }

    if (this.viewModeLabel) {
      this.viewModeLabel.textContent = this.isXRayMode
        ? 'X-Ray Infill Active'
        : 'Solid Print View';
    }

    if (this.viewModeBtn) {
      if (this.isXRayMode) {
        this.viewModeBtn.classList.add('text-[#00FF66]', 'border-[#00FF66]');
      } else {
        this.viewModeBtn.classList.remove('text-[#00FF66]', 'border-[#00FF66]');
      }
    }
  }

  bindEvents() {
    // 1. Model Switcher Buttons
    this.modelButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const url = btn.getAttribute('data-stl');
        const name = btn.getAttribute('data-name');
        const id = btn.getAttribute('data-id');
        if (!url) return;

        this.modelButtons.forEach((b) => {
          b.classList.remove('active', 'border-[#FF6500]', 'text-white', 'bg-black');
          b.classList.add('border-zinc-800', 'text-zinc-400');
        });
        btn.classList.add('active', 'border-[#FF6500]', 'text-white', 'bg-black');
        btn.classList.remove('border-zinc-800', 'text-zinc-400');

        this.activeModelId = id;
        this.activeModelUrl = url;
        this.activeModelName = name;
        this.activeBaseUrl = btn.getAttribute('data-base-stl') || '';
        this.activeAccentUrl = btn.getAttribute('data-accent-stl') || '';
        this.activePartBase = btn.getAttribute('data-part-base') || 'Base Plate Assembly';
        this.activePartAccent = btn.getAttribute('data-part-accent') || 'Accent Plate Assembly';
        this.activeAssemblyType = btn.getAttribute('data-assembly-type') || 'multi-part';
        this.activeCanExplode = btn.getAttribute('data-can-explode') !== 'false';
        // Reset explode state when switching to a locked monolith
        this.isExploded = false;
        this.explodeTarget = 0;
        this.updateAssemblyBadge();
        this.loadModel(url, name);
      });
    });

    // 2. Swatch Buttons
    this.swatchButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const color = btn.getAttribute('data-color');
        if (!color) return;

        this.swatchButtons.forEach((b) => b.classList.remove('ring-2', 'ring-white', 'scale-115'));
        btn.classList.add('ring-2', 'ring-white', 'scale-115');

        this.setFilamentColor(color);
      });
    });

    // 3. Explode Toggle
    if (this.explodeBtn) {
      this.explodeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!this.activeCanExplode) return;
        this.toggleExplode();
      });
    }

    // 4. View Mode Toggle
    if (this.viewModeBtn) {
      this.viewModeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleViewMode();
      });
    }

    // 5. Send to Slicer CTA
    if (this.sendToSlicerBtn) {
      this.sendToSlicerBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const hasPlates = Boolean(this.activeBaseUrl && this.activeAccentUrl && this.activeCanExplode);
        const detail = {
          url: this.activeModelUrl,
          baseUrl: hasPlates ? this.activeBaseUrl : null,
          accentUrl: hasPlates ? this.activeAccentUrl : null,
          assemblyType: this.activeAssemblyType || 'snap-fit',
          canExplode: this.activeCanExplode,
          assemblyKind: this.activeAssemblyType || 'single-piece',
          partCount: hasPlates ? 2 : 1,
          name: `${this.activeModelId}.stl`,
          displayName: this.activeModelName,
          color: this.currentColor,
        };
        // Canonical handoff (with-supports pipeline) + legacy alias
        window.dispatchEvent(new CustomEvent('snkb:load-model', { detail }));
        window.dispatchEvent(
          new CustomEvent('snkb:load-design', {
            detail: {
              url: this.activeModelUrl,
              baseUrl: hasPlates ? this.activeBaseUrl : null,
              accentUrl: hasPlates ? this.activeAccentUrl : null,
              assemblyType: this.activeAssemblyType || 'snap-fit',
              canExplode: this.activeCanExplode,
              assemblyKind: this.activeAssemblyType || 'single-piece',
              name: `${this.activeModelId}.stl`,
              displayName: this.activeModelName,
            },
          })
        );
        const slicerSection = document.getElementById('instant-quote');
        if (slicerSection) {
          slicerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }
    this.updateAssemblyBadge();
  }

  startLoop() {
    if (this.animId) return;
    const animate = () => {
      this.animId = requestAnimationFrame(animate);
      this.render();
    };
    animate();
  }

  stopLoop() {
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  render() {
    if (!this.renderer || !this.scene || !this.camera) return;

    const time = this.clock.getElapsedTime();

    // 1. Oscillate animated laser plane smoothly between Y = 4 and Y = 160 mm
    if (this.laserPlane) {
      const scanHeight = 82 + Math.sin(time * 1.5) * 78;
      this.laserPlane.position.y = scanHeight;
    }

    // 2. Animate genuine plate lift + shell assemblies (never plane-sliced)
    if (this.accentMesh) {
      const targetY = this.explodeTarget * this.maxExplode;
      this.explodeCurrent += (targetY - this.explodeCurrent) * 0.12;
      this.accentMesh.position.y = this.explodeCurrent;
      if (this.explodeGuides) {
        this.explodeGuides.visible = this.explodeCurrent > 2;
        if (this.explodeGuides.visible) {
          const posAttr = this.explodeGuides.geometry.attributes.position;
          const baseTop = posAttr.getY(0);
          posAttr.setY(1, baseTop + this.explodeCurrent);
          posAttr.needsUpdate = true;
          this.explodeGuides.computeLineDistances();
        }
      }
    }
    if (this.explodableGroup) {
      updateExplodableGroup(this.explodableGroup, this.explodeTarget, 0.12);
      if (!this.isExploded && this.explodableGroup.userData.currentExplode < 0.01) {
        if (!this.isXRayMode && this.solidMesh) {
          this.solidMesh.visible = true;
          this.explodableGroup.visible = false;
        }
      }
    }

    // 3. Update controls (damping + auto-rotation)
    if (this.controls) {
      this.controls.update();
    }

    // 4. Render frame
    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    if (!this.canvas || !this.renderer || !this.camera) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(rect.width || 540, 200);
    const height = Math.max(rect.height || 460, 200);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
}

export function initHeroPrintStage() {
  const container = document.querySelector('.hero-print-stage');
  if (container && !container.__heroStageInstance) {
    container.__heroStageInstance = new HeroStageRenderer(container);
  }
}
