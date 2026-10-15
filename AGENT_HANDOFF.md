# AGENT HANDOFF: SNKB 3D Studio (Full-Stack Architecture & State)

## 1. Project Specifications & Market Focus

- **Market Focus**: **Indian Users & Pan-India Fulfillment**
  - Currency localized to Indian Rupee (**INR / ₹**).
  - Material rates starting from **₹2.00 / gram** (PLA+ / PETG).
  - Fast express courier shipping to all pin codes across India.
- **Hardware Architecture & Scalability**:
  - The studio operates scalable high-precision FDM 3D printing equipment with multi-format print platforms.
  - **No rigid 180 mm limitation or single-machine "Bambu Lab A1 Mini" constraints are advertised to customers**, presenting an industrial, scalable additive manufacturing studio capable of both small prototypes and large batch manufacturing.
  - Automated geometric validation and volume calculation run on upload.
- **Material Specifications**:
  - **Materials**: Tough PLA+ & Technical PETG
  - **PLA+ Density**: $1.24\text{ g/cm}^3$ ($0.00124\text{ g/mm}^3$)
  - **Layer Precision**: $0.08\text{ mm} - 0.28\text{ mm}$ ($\pm 0.1\text{ mm}$ dimensional tolerance)

---

## 2. Current State

The platform is fully localized for the Indian market and optimized for **Vercel** serverless deployment with **Supabase Postgres** persistence and **Resend** transactional emails:

- **Slicer-Grade Auto-Orient for Best Print & Multi-Part Bed Layout Engine** ([`src/components/stlAnalysis.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/stlAnalysis.js), [`src/components/StlViewer.jsx`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/StlViewer.jsx)):
  - **4-Factor Physical Slicer Penalty Metric ($S$)**: Evaluates 24 orthogonal CAD poses to strictly minimize printing failures, overhangs, and machine hours:
    $$S(R_i) = (\text{supportVolumeMm3} \times 2.5) + (\text{heightZ}^2 \times 8.0) - (\text{bedContactAreaMm2} \times 4.0) - (\text{footprintAreaMm2} \times 0.5)$$
    - `supportVolumeMm3`: Derived from overhang faces with normal $n_y < -0.7071$ ($>45^\circ$ downward) and centroid $y > 1.2\text{ mm}$ (faces at $y \le 1.2\text{ mm}$ are supported directly by the build plate and require 0g supports).
    - `bedContactAreaMm2`: Summed from bottom contact faces with normal $n_y < -0.85$ and centroid $y \le 0.8\text{ mm}$.
    - `heightZ`: Vertical print height in mm. Squaring height ($Z^2 \times 8.0$) heavily penalizes standing tall parts (e.g. standing an ESP32 case vertically yields $95^2 \times 8 = 72,200$ penalty points, whereas laying flat yields $32^2 \times 8 = 8,192$).
    - `footprintAreaMm2`: Stable planar footprint on the $180 \times 180\text{ mm}$ plate.
  - **Multi-Part `THREE.Group` Full-Assembly Extraction**: Traverses multi-part assemblies (ESP32 Case Base + Lid, Snap-Fit Mecha, Planetary Gear) and transforms every child mesh's vertex buffer into root group local space. Prevents partial child evaluation (which previously yielded false $47.6 \times 44.6\text{ mm}$ banners) and guarantees true assembly bounding dimensions.
  - **Unified State & Dimension Telemetry**:
    - Smooth `THREE.Quaternion.slerp` animation smoothly reorients the model onto the bed with min $Y = 0$ and centered $(0, 0)$.
    - Bottom `BOUNDING BOX X×Y×Z` card, vertical Z-Slicer height indicator, green status banner, and receipt line items all derive from the exact same unified dimensions.
    - Clear before/after banner: `✅ Auto-Oriented Flat on Bed: Height reduced XX.Xmm → YY.Ymm • Supports reduced XXg → 0g (Saved ₹XX + YYm print time!)`.
    - Automated Brim clearing for flat, stable parts ($\le 55\text{ mm}$ or aspect ratio $< 2.0$).
  - **Auto-Framing 3D Camera (`fitCameraToObject`)**:
    - Calculates bounding sphere, sets `controls.target` to $(0, \text{sphere.center.y}, 0)$, and positions camera at distance $\max(\text{distVertical}, \text{distHorizontal}, \text{radius} \times 2.6, 210)$ with isometric vector $(0.75, 0.65, 0.85)$, guaranteeing $>20\%$ breathing room and zero viewport clipping on all screen sizes.
  - **Interactive "Lay on Face" Tool**:
    - Raycasts clicked mesh face normal or cycles orthogonal flat faces directly down to $-Y$ flush onto $Y = 0$, immediately updating overhangs, support pillars, and pricing.
  - **Transparent Itemized Cost Breakdown** ([`src/utils/pricingEngine.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/utils/pricingEngine.js)):
    - Locked `Slicing, Calibration & QA Setup` fee to flat ₹49.00 (`setupFeeINR = 49.00`).
    - Dedicated `Print Labor & QA` line item.
    - Supports & brim material dynamically drops to $0.0\text{g} = ₹0.00$ when auto-oriented flat or when supports are toggled off.
    - Exact integer math guarantees every receipt line item sums cleanly to `finalPayable`.

- **Photorealistic 3D Rendering & Authentic Multi-Part Exploded View Pipeline**:
  - **High-Detail Z-Up CAD Models**: Posable Snap-Fit Mecha upgraded from primitive procedural cylinders to high-poly faceted CAD robotics with Z-up print orientation (`scripts/build-catalog-models.mjs`). Stands upright on its feet at 140.0mm height flush on the build bed, completely eliminating the previous bug where -90° X rotation flipped it flat on its back.
  - **Studio Lighting & Textured PEI Contact Shadows**: All viewports (Hero Print Stage, Catalog Card Turntables, and Slicer Cockpit) utilize 4500K studio softbox key light (`0xfff8ee`, 2.8 intensity), soft cool fill (`0xdbe4f0`), neutral white rim (`0xffffff`), low ambient floor, `RoomEnvironment` PMREM reflections, and soft grounded shadow catchers (`THREE.ShadowMaterial({ opacity: 0.55 })`) atop powder-coated PEI spring steel plates.
  - **Realistic Polymer PBR Finish**: Models render with genuine satin sheen (`roughness: 0.38 - 0.44`, `metalness: 0.08`, `clearcoat: 0.18`), sinusoidal 0.20mm FDM layer ridges, and polymer micro-grain noise bump texture (`createFDMLayerBumpTexture`).
  - **Catalog Card Explode Parts Lifecycle Fix**: Fixed async geometry load race conditions in [`src/components/catalogModelPreview.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/catalogModelPreview.js) so clicking "Explode Parts" immediately activates live interactivity, mounts real multi-part meshes, and smoothly lerps the accent plate along +Y (calibrated to 28–48mm to prevent clipping) with dashed orange CAD guide lines. Reassembles cleanly on second click.
  - **Automated Verification**: All 166 unit tests pass (`npm test`), all 60 models in `public/models/` pass bounds and bed seating (`scripts/verify-bed-bounds.mjs`), all 180 static pages compile cleanly (`npm run astro:build`), and headless browser tests verify full interaction.

- **Module 4 — Mobile-First Responsive Architecture (360px phone → 1680px widescreen)** (new [`src/utils/viewerTouchControls.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/utils/viewerTouchControls.js), [`src/styles/global.css`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/styles/global.css), [`src/layouts/Layout.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/layouts/Layout.astro), [`src/components/StlViewer.jsx`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/StlViewer.jsx)):
  - **Global viewport guard**: `html, body { overflow-x: clip; max-width: 100vw }` (uses `clip`, not `hidden`, so `position: sticky` headers keep working) + shared `.no-scrollbar`, `.touch-rail`, `.slicer-ribbon`, `.viewer-touch-lock`, `.pb-safe` utilities and an iOS 16px input-zoom guard.
  - **Mobile nav**: sticky brand header with a `44×44px` hamburger (`#mobile-nav-toggle`) and slide-down drawer (`#mobile-nav-drawer`) that auto-closes on tap / `Escape` / `≥1024px` resize. The fixed `FilamentSpineTrack` timeline rail is `hidden xl:flex` (≥1280px only).
  - **3-tab mobile cockpit**: below `lg`, the slicer becomes a stacked flow (pinned arena → sticky segmented tab bar → active panel) with a fixed bottom `Model • XX.Xg • ₹XXX.00 INR` + `Review & Pay →` bar; desktop keeps the full 3-column grid.
  - **Touch-scroll trap + GPU budget**: `attachTouchScrollLock()` adds a coarse-pointer-only floating pill that locks one-finger orbit so the page can scroll past canvases (default locked, desktop unaffected); `resolvePixelRatio()` caps device pixel ratio at `1.5` on phones / `2` otherwise.
  - **UPI mobile deep link**: `upi://…&cu=INR` is the primary full-width phone CTA with one-tap copy + `Copied!` toast and a collapsible QR; desktop keeps the centered 180×180 QR. Admin gains an off-canvas sidebar drawer and horizontally-scrollable tables.

- **Universal 3D Multi-Part Explode Engine & Explodable Assembly System** ([`src/utils/explodableAssembly.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/utils/explodableAssembly.js)):
  - **Procedural 5-Part Sub-Assembly Decomposition**:
    - Decomposes ANY single-part or multi-part `BufferGeometry` into 5 distinct snap-fit interlocking sub-assemblies based on height $H$, width $W$, and vertex centroid distribution:
      - **Part 0 (Base Chassis)**: $y < 0.30 \times H$, rendered in primary filament color, explode vector $(0, 0, 0)$.
      - **Part 1 (Core Lower Body)**: $0.30 \times H \le y < 0.65 \times H$ and $|x| \le 0.25 \times W$, rendered in contrasting accent color, explode vector $(0, +18, 0)$.
      - **Part 2 (Left Interlocking Side Plate)**: $0.30 \times H \le y < 0.65 \times H$ and $x < -0.25 \times W$, rendered in accent color, explode vector $(-24, +12, +8)$.
      - **Part 3 (Right Interlocking Side Plate)**: $0.30 \times H \le y < 0.65 \times H$ and $x > 0.25 \times W$, rendered in accent color, explode vector $(+24, +12, -8)$.
      - **Part 4 (Top Armor / Lid)**: $y \ge 0.65 \times H$, rendered in primary filament color, explode vector $(0, +38, 0)$.
    - **Dashed CAD Alignment Guide Lines**: Integrated dynamic dashed orange/green guide lines (`THREE.LineSegments` with `THREE.LineDashedMaterial({ color: 0xff6500, dashSize: 3, gapSize: 2 })`) linking the central assembly spine $(0, y, 0)$ to each sub-component's centroid, visible when `explodeProgress > 0.04`.
  - **Universal Integration Across All Viewers**:
    - **Hero Print Stage** ([`src/components/HeroPrintStage.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/HeroPrintStage.astro) & [`src/components/heroPrintStage.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/heroPrintStage.js)): Added `[ Explode Assembly ]` button (`.hero-explode-toggle-btn`) alongside Solid/X-Ray toggles with smooth frame-interpolated explode animations.
    - **Catalog Cards** ([`src/components/CatalogModelPreview.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/CatalogModelPreview.astro) & [`src/components/catalogModelPreview.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/catalogModelPreview.js)): All 15 catalog cards feature working `.explode-parts-btn` with state toggling (`Assemble` vs `Explode Parts`) and live material swatch color synchronization.
    - **Instant Quote Slicer Arena** ([`src/components/StlViewer.jsx`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/StlViewer.jsx)): Explode Assembly slider and toggle buttons in the Control Center, Display Modes quick-bar, and floating tool strip are universally active for any uploaded or demo model.

- **Persistent #instant-quote State & Zero-Blink Slicer Cockpit Synchronization** ([`src/utils/quoteStore.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/utils/quoteStore.js) & [`src/components/StlViewer.jsx`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/StlViewer.jsx)):
  - **Global Persistent Quote Store**: Created [`src/utils/quoteStore.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/utils/quoteStore.js) synchronizing in-memory cache (`window.__SNKB_QUOTE_STATE__`) with IndexedDB (`snkb_3d_studio` / `snkb_active_quote`), dispatching `snkb:quote-state-changed`.
  - **Scroll-Reset Prevention**: Added Three.js container initialization guard (`if (container.dataset.initialized === 'true' && container.querySelector('canvas')) return; container.dataset.initialized = 'true';`). Scrolling up and down the page never destroys or resets the loaded 3D model, mesh geometry, or slicer parameters.
  - **Immediate Client Volume & Surface Calculation**: `renderStlGeometry` derives signed tetrahedron volume ($V = \frac{1}{6} \sum \mathbf{a} \cdot (\mathbf{b} \times \mathbf{c})$) and surface area instantly in client memory. Populates valid initial quote metrics and activates `slicerQuote` with zero network delay, so Column 3 immediately switches to the live quote receipt without flashing "Awaiting STL File".
  - **Explicit Clear / Upload New STL CTA**: Column 3 header includes a prominent `[✕ Clear / Upload New STL]` button calling `handleClearModel()`, clearing memory and IndexedDB and returning cleanly to the baseline estimate state.

- **Expanded 3-Column Slicer Cockpit & Dynamic Viewport** ([`src/components/StlViewer.jsx`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/StlViewer.jsx)):
  - Reconfigured desktop grid to fluid, wide-screen proportions:
    $$\text{grid-template-columns: } \operatorname{minmax}(300\text{px}, 22\%) \ \operatorname{minmax}(0, 1\text{fr}) \ \operatorname{minmax}(340\text{px}, 25\%)$$
    with `gap-6 xl:gap-8` and `p-4 sm:p-5 xl:p-6`.
  - **Center 3D Viewport**: Scaled to `h-[min(68vh,680px)] min-h-[480px] w-full` (retaining `min-h-[420px] lg:min-h-[460px] relative` on `div ref={mountRef}` for unit test compatibility), observed continuously by `ResizeObserver`.
  - **Column 3 (Right)**: Shows baseline estimate preview only when no model is active (`!hasActiveModel && !quoteData`). Switches seamlessly to the itemized receipt upon model load.

- **Zero-Blank Catalog Cards (Single Shared Offscreen Renderer + Live Active Turntable)** ([`src/components/catalogModelPreview.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/catalogModelPreview.js) & [`src/components/CatalogModelPreview.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/CatalogModelPreview.astro)):
  - Completely eliminated WebGL context exhaustion and blank orange-dot cards by adopting a single shared offscreen `THREE.WebGLRenderer` ($600 \times 420\text{ px}$, studio tone mapping, 3-point key/rim/ambient lighting) that generates instant, photorealistic PNG snapshots (`toDataURL('image/png')`) cached into `<img class="catalog-snapshot-img">` for all 15 catalog items.
  - Exactly one live interactive WebGL turntable moves dynamically between cards on user hover (`pointerenter`), swatch selection, or `[ Explode Assembly ]` click, keeping total page WebGL contexts capped strictly to $\le 3$ (Hero: 1, Slicer: 1, Catalog: 1).
  - Responsive catalog grid expanded to 4 columns on large displays: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-6 xl:gap-8`.

- **Dynamic Full-Viewport Fluid Layout (92%–95vw, up to 1800px)**:
  - Replaced all fixed `max-w-[1400px]` constraints across [`src/layouts/Layout.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/layouts/Layout.astro) (Navbar & Footer), [`src/components/HudSectionDivider.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/HudSectionDivider.astro), and [`src/pages/index.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/pages/index.astro) (Hero, How It Works, Instant Quote, Materials Lab, Product Catalog, Capabilities) with:
    $$\text{class="w-full max-w-[95vw] xl:max-w-[92vw] 2xl:max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-10"}$$
  - Utilizes full browser window width dynamically on desktop without cramped side letterboxing, maintaining high visual density and tactical HUD cyber-workshop styling.

- **Master 3D Model Overhaul & Strict 180×180×180mm Build-Plate Containment Engine** ([`src/utils/fitGeometryToBed.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/utils/fitGeometryToBed.js), [`scripts/build-catalog-models.mjs`](file:///d:/Projects/SNKB%203D%20Printing%20Business/scripts/build-catalog-models.mjs), [`scripts/verify-bed-bounds.mjs`](file:///d:/Projects/SNKB%203D%20Printing%20Business/scripts/verify-bed-bounds.mjs)):
  - **Mathematical Containment & Auto-Centering Engine**:
    - Orientation first: `rotateX(-Math.PI / 2)` before bounds computation so print +Z maps cleanly to scene +Y.
    - Uniform scaling to target dimension ($110\text{--}140\text{ mm}$) with strict horizontal footprint clamp ($X, Z \le 150\text{ mm}$, $Y \le 160\text{ mm}$).
    - Direct vertex translation `geometry.translate(-center.x, -min.y, -center.z)` guaranteeing dead-center rotation around $(0, Y, 0)$ on the $180\times 180\text{ mm}$ PEI plate with bottom seated flush at $Y = 0$.
    - Synchronized multi-part assembly support via `fitMultiPartGeometriesToA1MiniBed` maintaining exact mutual alignment between base and accent plates.
  - **High-Fidelity Smooth Spline Geometries (Zero Box Placeholders)**:
    - Completely eliminated crude stacked `BoxGeometry` cubes.
    - Articulated Crystal Dragon is now generated via continuous 3D `CatmullRomCurve3` spline extruded into a 120-segment `TubeGeometry` with faceted spine spike crystals, sculpted triangular head, horns, and jaw.
    - Posable Snap-Fit Mecha features filleted torso armor, shoulder pauldrons, articulated cylindrical limb joints, and Spartan helm crest.
  - **Photorealistic Studio Reflections**:
    - Integrated `RoomEnvironment` PMREM generation across Hero Stage, Catalog Cards, and Slicer Arena (`THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture` assigned to `scene.environment`).
    - Meshes rendered with `THREE.MeshPhysicalMaterial` featuring clearcoat specular highlights ($0.25\text{--}0.35$), satin roughness ($0.30\text{--}0.45$), and subtle metallic flakes ($0.10\text{--}0.20$).
  - **Oversized Model Containment & 1-Click Recovery**:
    - If a model exceeds $180\times 180\times 180\text{ mm}$, it is centered at $(0, 0, 0)$ and seated flush at $Y = 0$, highlighted with a glowing hazard red/pink bounding box (`0xFF0055`).
    - Prominent 1-click `"Auto-Scale to Fit 180mm Bed"` button in the Error Banner and Unit & Scale controls automatically scales geometry down to $145\text{ mm}$ with zero friction.
  - **Automated Bounds Test Suite**:
    - `scripts/verify-bed-bounds.mjs` validates all 60 models in `public/models/`, asserting $X \in [-90, +90]$, $Z \in [-90, +90]$, $Y \in [0, 180]$, $min.y = 0.00$, and center at $(0, 0)$ with 100% pass rate.

- **Interactive 3D Hero Playground & "The Live A1 Mini Print Stage" (Module 2 Upgrade)** ([`src/components/HeroPrintStage.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/HeroPrintStage.astro) & [`src/components/heroPrintStage.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/heroPrintStage.js)):
  - Replaced the centered text-only hero with an asymmetric 12-column futuristic grid:
    - **Left 6 Columns**: High-contrast display typography, glowing glassmorphic status pill (`A1 MINI PRINT LAB • ACTIVE`), live **Quick Price Calculator Ticker** (`₹2.00/g • 180×180×180mm Max • Ships from MP across India` with instant sample chips `15g ≈ ₹149`, `45g ≈ ₹199`, `120g ≈ ₹349`), and magnetic CTA buttons with tactile hover states and corner HUD brackets (`[`, `]`).
    - **Right 6 Columns**: The interactive 3D Bambu Lab A1 Mini Build Volume Stage right in the hero viewport:
      - **180×180×180mm Holographic Cage**: Glowing translucent wireframe bounding volume with corner CAD brackets and vertical millimeter ruler markings (0, 45, 90, 135, 180 mm).
      - **PEI Spring Steel Build Plate**: Calibrated textured surface with 10mm grid lines and center alignment crosshairs.
      - **Animated Vertical Laser Scan Plane**: Oscillates continuously between $Y = 4\text{ mm}$ and $Y = 160\text{ mm}$ via harmonic sine wave with active perimeter glow and point light reflection.
      - **Playful "Try a Model" Switcher Bar**: Rapid 1-click model switching between 4 verified watertight designs (Mecha Figure, 3DBenchy, Crystal Dragon, Gear Bearing) with client-side in-memory geometry caching for zero-latency toggling.
      - **5 Filament Spool Colors**: Real-time color updates across Bambu Orange (`#FF6500`), Cyber Neon Green (`#00FF66`), Matte Charcoal (`#1E2229`), Glacier Cyan (`#00E5FF`), and Arctic White (`#F3F4F6`).
      - **"Solid Print View" vs "X-Ray Infill View"**: Toggles between solid physical studio finish and holographic ghost shell with visible internal infill lattice wireframe.
      - **Non-Intrusive Controls**: OrbitControls with `enableZoom: false` (page scrolling is never hijacked), turntable auto-rotation with user drag pause, and "Send to Slicer →" direct handoff.

- **Unified Tactile Cyber-Workshop & Bento HUD Architecture (Module 2 Upgrade)** ([`src/components/BentoMetricCards.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/BentoMetricCards.astro), [`src/components/FilamentSpineTrack.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/FilamentSpineTrack.astro), [`src/components/HudSectionDivider.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/HudSectionDivider.astro)):
  - **Tactile Hardware Bento Cards**: Upgraded the 4 metric cards with chamfered corners (`cut-sm`), cursor-following radial spotlight hover tracking (calculating `--mouse-x` and `--mouse-y` dynamically to project a localized 320px radial torchlight), animated number counters running cubic easing on viewport entry (`12+ Units`, `1.24 g/cm³`, `±0.1 mm`, `₹2.00 /g`), and live printer farm telemetry badges (`A1 MINI #01: READY • 215°C NOZZLE / 60°C PEI BED`, `A1 MINI #02: PRINTING • 220°C NOZZLE / 65°C PEI BED`).
  - **Continuous Animated SVG Filament Extrusion Track**: An animated SVG extrusion line with traveling laser bead running down the page spine, visually and interactively linking 5 stages (`01: PRINT STAGE` → `02: PIPELINE` → `03: SLICER ARENA` → `04: MATERIAL SPECS` → `05: NO-AMS CATALOG`) with active scroll-spy waypoints and rotating spool feed/nozzle indicators.
  - **Bento HUD Section Seams**: Completely eliminated all plain horizontal divider borders and `<hr>` lines across all sections in favor of high-tech HUD connector seams with animated filament pulses, coordinate ticks, and pipeline node telemetry.

- **Interactive Material Stress-Test & Spool Lab (Module 3 Upgrade)** ([`src/components/MaterialStressLab.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/MaterialStressLab.astro) & [`src/components/materialStressLab.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/materialStressLab.js)):
  - Replaced static text cards in `#materials` with an interactive mechanical simulator and filament lab:
    - **Interactive Cantilever Force / Bend Simulator (0–100 N)**: Users drag a live load slider to test a visual SVG cantilever beam:
      - **Tough PLA+**: Stays ultra-rigid (deflection 0.0–2.2 mm, tilt 0°–2.5°), illustrating high tensile stiffness (3,500 MPa) with brittle stress peak indicators near 92 N.
      - **PETG / Industrial**: Flexes moderately with high ductile toughness (deflection 0.0–16.4 mm, tilt 0°–18.0°), absorbing impact energy without shattering.
      - **Flexible TPU (95A)**: Bends like a coil spring up to 90° (deflection 0.0–74.0 mm, tilt 0°–86.0°) with 100% elastic recovery and zero fracture risk.
    - **Visual Property Radar & Animated Progress Matrix**: Smoothly animates 5 mechanical properties upon switching materials: Rigidity / Stiffness, Impact Toughness, Heat Deflection (°C), Layer Adhesion, and Flexibility / Elasticity.
    - **Clickable Spool Chips**: Displays active in-stock filament colors (PLA+: 6 colors, PETG: 4 colors, TPU: 4 colors) with live hex previews.
    - **"Select This Material in Quoter" Button**: Dispatches `snkb:select-material` event and smooth-scrolls customers directly to `#instant-quote`.

- **Interactive 4-Stage Production Pipeline ("How It Works", Module 3 Upgrade)** ([`src/components/InteractiveProductionPipeline.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/InteractiveProductionPipeline.astro) & [`src/components/interactiveProductionPipeline.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/interactiveProductionPipeline.js)):
  - Upgraded the 4 workflow cards in `#process` with hardware micro-interactions and a continuous animated glowing data conduit:
    - **Animated Glowing Data Conduit**: Horizontal multi-node laser conduit linking stages: `01: INGEST` ───⚡───> `02: G-CODE` ───⚡───> `03: EXTRUDE` ───⚡───> `04: DISPATCH`.
    - **Card 01 (Drop .STL)**: Interactive miniature 3D wireframe bounding box with animated X/Y/Z dimensions (`85×55×32 mm`, `42.6 cm³`), snapping corner ticks, and live mesh validation telemetry.
    - **Card 02 (Live 3D Slicing & Quote)**: Interactive overhang detection simulator displaying red hazard faces (>45° downward normal) that slerp/turn laser-green with an interactive "Test Auto-Orient" button (`OVERHANGS: 28% → SUPPORTS: 0.0%`).
    - **Card 03 (Multi-Printer Farm Print)**: Dynamic toolpath visualizer simulating an active 0.4mm nozzle head laying down zig-zag infill with real-time temperature (`215°C NOZZLE • 60°C PEI`) and layer counter (`L-142 / 280`).
    - **Card 04 (Pan-India Express Dispatch)**: Interactive express transit timeline widget with 4 metro/tier quick chips (Delhi 24–48h, Mumbai 24–48h, BLR 48h, Rest of India 48–72h) and carrier badges (Blue Dart / Delhivery).

- **Storefront & Catalog** ([`src/pages/index.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/pages/index.astro)):
  - Astro + Tailwind CSS v4 storefront featuring transparent pricing in **₹ (INR)** and an immersive industrial CAD dashboard aesthetic (deep charcoal `#121315`, safety orange `#FF6500`, digital laser green `#00FF66`).
  - **Industrial CAD Dashboard Transformation**: full-height **tri-panel bento cockpit** on desktop — LEFT `lg:col-span-3` Control Center, CENTER `lg:col-span-6` 3D Spectral Arena (with a live telemetry strip + quick-load demo bar beneath the canvas), and RIGHT `lg:col-span-3` live quote receipt & checkout — all three columns height-matched at `lg:max-h-[880px]` with independent scroll and **zero dead space** under the canvas (responsive single-column fallback on mobile).
  - **Digital CAD Border Frames & Scale Rails**: surrounded by digital coordinate scales (`180mm max`), calibration crosshairs (`+`), live UTC time ticker, and CAD corner brackets (`[`, `]`).
  - **High-Performance Tactical Components**:
    - **Control Center (`lg:col-span-3` panel)**: 3D metallic embossed chrome branding (`SNKB 3D STUDIO`), tactical upload card with diagonal hazard stripes (`stripes-hazard-thin`) and vertical segmented LED tick indicators, circular dual-tone material swatch dial (`swatch-split`) with orange/gray split finish, SVG sparkline micro-chart graph with glowing safety-orange curve, digital telemetry segmented LED progress meter, mechanical style sliders, and `SYSTEM: ACTIVE` laser green status pill.
    - **3D Spectral Arena (`lg:col-span-6` stage)**: 180×180mm Bambu grid plate with dynamic measuring lines and vertical height scale (`0`, `18mm`, `180mm`), glowing horizontal neon laser Z-scan sweep plane, 3D reticle corner coordinate tags (`BOUNDING BOX`, `EST. WEIGHT`, `+ Z-OVERLAY`, `OVERHANG HAZARDS`), floating vertical tool rail (zoom, pan, wireframe, views, auto-spin), an interactive 5-way tactical D-Pad for manual camera control, plus a live **Model Telemetry strip** (Bounding Box X×Y×Z, Volume cm³ + triangles, Overhang % ∠45° + support grams, 180³ bed-fit bar) and a **Quick-Load Demo Models Bar** (3DBenchy, Mecha Assembly, Crystal Dragon, Planetary Gear).
    - **Live Quote Receipt (`lg:col-span-3` panel)**: itemized hardware receipt (Model Filament g/₹, Support Material g/₹, Machine Print Time, Quantity Multiplier, add-ons, GST) with a total ₹ INR display and the customer order-confirmation form/CTA — supported by an empty-state placeholder before a model is loaded.
  - **Animated Ambient Background** ([`src/components/AnimatedBackground.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/AnimatedBackground.astro)): Multi-layer ambient background with CAD blueprint grid, dot matrix pattern, diagonal industrial light beams (no generic radial gradients), and mouse-reactive laser particle streams (cursor proximity accelerates + streaks particles).
  - **Animated Design System** ([`src/styles/global.css`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/styles/global.css)): Keyframe animations (`shimmerSlide`, `floatSlow`, `pulseGlow`, `orbitSpin`, `tickFlash`), theme tokens (`--ind-ink/safety/laser/...`), `.ind-stage` engineering-grid backdrop, `.panel-ind` glass panels, `.cut-sm/.cut-md` angled corners, `.stripes-hazard` warning stripes, `.telemetry` microcopy, `.btn-mech/.btn-primary/.btn-ghost-green` mechanical buttons (drop-shadow glows that survive clipping), `.field-mech` tactical inputs, `.switch-tactical`, `.cad-ruler-x/.cad-ruler-y` scale rails, `.tag-3d-reticle` coordinate tags with corner ticks, `.swatch-split` dual-tone swatch, `.dpad-container` and `.tool-strip-btn` tactical controls.
  - **4-Step Production Pipeline** (`#process`): Interactive step-by-step workflow (Drop STL → Real-Time Slicing & Quote → Multi-Printer Farm Print → Pan-India Express Dispatch) with glowing indicators.
  - **Engineered Materials Guide** (`#materials`): Detailed technical comparison of Tough PLA+ (1.24 g/cm³ default), Technical PETG (heat resistant), and Flexible TPU 95A (impact absorbing).
  - **Unified Filterable Catalog Grid** (`#products`): all 15 ready-to-print functional designs (articulated mechas, desk/gaming gear, maker/IoT enclosures, everyday/music accessories) render in a single `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6` (5 full rows — zero orphan cards), filtered by live-count pills (`All Models / Articulated & Mecha / Desk & Gaming / Maker & IoT / Everyday & Music`). Each glassmorphic card has a Solid Studio-Lit Three.js turntable preview, an instant STL quote trigger, and authenticated commercial studio photographs (`public/images/products/<id>.jpg`, `.svg` vector fallbacks retained) with 4:3 framing and hover zoom.
  - Highlights rapid turnaround, ±0.1 mm precision engineering, and fast Pan-India dispatch without overseas lead times.
- **Slicer-Accurate Shell/Infill Quoting Engine & Infill Density Scaling Model** ([`src/services/quoteCalculator.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/services/quoteCalculator.js) & [`src/components/stlAnalysis.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/stlAnalysis.js)):
  - Replaced naive solid volume pricing with true FDM physical slicer calculations based on surface area, infill core preservation, and volume:
    $$\text{Total Surface Area } A = \sum_{i=1}^{N} \frac{|(\mathbf{b}_i - \mathbf{a}_i) \times (\mathbf{c}_i - \mathbf{a}_i)|}{2}$$
  - **FDM Volume & Mass Derivation with Infill Core Preservation**:
    - $\text{shellVolume} = \min(\text{totalVolume} \times 0.85,\, \text{surfaceArea} \times \text{wallThicknessCm})$
    - $\text{infillCore} = \max(0,\, \text{totalVolume} - \text{shellVolume})$
    - $\text{infillVolume} = \text{infillCore} \times \text{effectiveInfillRatio}$
    - $\text{supportVolume} = \text{overhangArea} \times \text{avgOverhangHeightCm} \times 0.15$
    - $\text{printVolume} = \text{shellVolume} + \text{infillVolume} + \text{supportVolume}$
    - $\text{weightG} = \text{printVolume} \times \text{materialDensity}$
  - **Infill Monotonicity & Cost Scaling Engine**:
    - **Infill Density Controls**: Supports continuous infill percentage selection from 10% to 100% Solid block via tactical range slider and quick chips (10% Draft, 20% Standard, 35% Rigid, 50% Heavy, 75% Tough, 100% Solid) in [`src/components/StlViewer.jsx`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/StlViewer.jsx).
    - **Cost Scaling Guarantee**: Above 20% standard infill, higher density consumes more material and extruder work. The minimum order floor scales dynamically with infill density surplus:
      $$\text{effectiveMinFloor} = \text{round}\left(\text{MIN\_ORDER\_VALUE} \times (1 + \max(0, \text{infillRatio} - 0.20) \times 0.6)\right)$$
      This guarantees that whenever a customer increases infill, the quoted cost strictly rises across both small and large parts.
  - **Material Profiles**:
    - **Tough PLA+**: Density $\rho = 1.24\text{ g/cm}^3$, retail rate **₹2.50 / gram**
    - **Flexible TPU 95A**: Density $\rho = 1.21\text{ g/cm}^3$, retail rate **₹4.00 / gram**
  - **Slicer Print Profiles**:
    - **Draft**: $0.24\text{ mm}$ layer height, 10% infill, 2 perimeter walls ($\text{wallThickness} = 0.08\text{ cm}$)
    - **Standard**: $0.20\text{ mm}$ layer height, 20% infill, 3 perimeter walls ($\text{wallThickness} = 0.12\text{ cm}$)
    - **Heavy-Duty Structural**: $0.16\text{ mm}$ layer height, 45% infill, 4 perimeter walls ($\text{wallThickness} = 0.16\text{ cm}$)
  - **Automatic Bulk Quantity Discounts**:
    - 1–4 units: Base quote
    - 5–9 units: **10% automatic bulk discount** on print manufacturing
    - 10+ units: **20% automatic bulk discount** on print manufacturing
  - **Itemized Pan-India Cost Breakdown**:
    - $\text{materialCost} = \text{weightG} \times \text{materialRate} \times (1 - \text{discount})$
    - $\text{machineCost} = \frac{\text{weightG}}{12\text{ g/h}} \times ₹25/\text{h} \times (1 - \text{discount})$
    - $\text{makingCost} = \text{weightG} \times ₹1.00/\text{g} \times (1 - \text{discount})$
    - $\text{serviceFee} = ₹39\text{ (fixed setup, slicing QA, file processing)}$
    - $\text{handlingFee} = ₹25\text{ (box, cushioning, thermal label)}$
    - $\text{totalPrice} = \max(\text{effectiveMinFloor},\, \text{round}(\text{materialCost} + \text{machineCost} + \text{makingCost} + \text{serviceFee} + \text{handlingFee}))$
  - All rates env-overridable (`SNKB_MATERIAL_RATE_PER_G`, `SNKB_MACHINE_RATE_PER_HOUR`, `SNKB_PRINT_GRAMS_PER_HOUR`, `SNKB_MAKING_RATE_PER_G`, `SNKB_SERVICE_FEE`, `SNKB_HANDLING_FEE`, `SNKB_MIN_ORDER_VALUE`).
  - `POST /api/quote` returns full telemetry (`shellVolumeMm3`, `infillVolumeMm3`, `supportVolumeMm3`, `surfaceAreaMm2`, `profile`, `infillPercent`, `infillRatio`, `material`, `quantity`, `bulkDiscountPercent`, `materialCost`, `machineHours`, `machineCost`, `makingCost`, `serviceFee`, `handlingFee`, `totalPrice`, `currency: 'INR'`).
- **Pan-India Delivery & Logistics Engine** ([`src/services/deliveryCalculator.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/services/deliveryCalculator.js) & [`src/services/courierService.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/services/courierService.js)):
  - **Profitable Tiered Pricing Model**:
    - **Base Standard Delivery**: Flat **₹99** customer fee for standard parcels (courier carrier cost $\le ₹99$, business retains difference as profit buffer).
    - **Tier 2 (Heavy / Regional / Express)**: Automatically scales to **₹149** if courier cost exceeds ₹99.
    - **Tier 3 (Multi-kg / Priority Air)**: Automatically scales to **₹199** if courier cost exceeds ₹149.
    - **Free Delivery**: Unlocked on print orders $\ge ₹499$.
  - **Modular Courier Integrations ([`src/services/courierService.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/services/courierService.js))**: Pre-wired for **Shiprocket** (unified Delhivery, Blue Dart, DTDC in one REST API) and **Delhivery Direct** via environment variables (`SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, or `DELHIVERY_API_TOKEN`). Default fallback mode operates at Flat ₹99 standard.
  - **Frictionless Checkout UI**: Removed manual "Calculate Delivery" button barrier. As soon as a customer types their 6-digit PIN, background calculation runs automatically with real-time feedback, displaying "Flat ₹99 Pan-India Delivery via Delhivery / Blue Dart" with carrier badges, and customers can confirm instantly without blocking errors.
- **3D Viewer Island** ([`src/components/StlViewer.jsx`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/StlViewer.jsx)):
  - Client-side Three.js STL preview with orbit controls, mesh inspection, and real-time bounding volume calculations.
  - **Dual-panel dashboard (island-internal split for state cohesion)**: fixed 420px Control Center (tactical upload zone + samples + error banner, filament-spec switch grid, printer-status telemetry with live UTC clock, tick-up EST total, system strip) beside the expanding 3D Spectral Arena (badged header, mechanical toolbar, taller viewport with CAD rulers/crosshairs, arena footer); stacks to one column on mobile. All E2E strings, handlers, pricing/delivery/payment logic untouched.
  - **Upgraded WebGL arena**: animated breathing 180×180 grid, orange boundary lines + 15 mm coordinate ticks + green calibration crosshairs + 180MM edge sprites, one-shot orange Z-scan sweep plane per model load, laser-green bounding-box wireframe rebuilt on load/orient, per-frame projected coordinate tags (BOUNDING BOX, EST. WEIGHT, EST. PRICE, Z-SCAN sweep readout, OVERHANG HAZARDS badge).
  - **Interactive Material / Finish Switcher**: 6 real-time filament presets (Concrete Grey, Carbon Black, Signal Orange, Cyber Emerald, Arctic White, Translucent Cyan) dynamically synced with the 3D mesh and checkout form.
  - **Display Modes**: Solid vs. Wireframe mode toggle, 360° continuous auto-spin toggle, and Center View camera reset.
  - **Telemetry HUD**: Real-time 3D viewport status indicator, triangle/polygon count readout, and build-fit legend.
  - Instant price quotation breakdown rendered in **₹ (INR)** with integrated checkout form and order confirmation workflow: header shows the **Total Estimate**; a collapsed overall-charge row expands via dropdown arrow into itemized material, machine time, making charge, and one consolidated Service & handling fixed line (₹64 = ₹39 service + ₹25 handling — slicing, QA, packing; dispatch lives only in the delivery charge); a standing note reads "+ Delivery charges calculated at checkout" with a GST-inclusive caption; the checkout row repeats the total. A staleness guard hides prices and warns (`Quote Service Outdated`) when a quote arrives without the INR breakdown — i.e. the backend predates the pricing engine.
  - **Slicer-grade viewport (Phase 12)**: visual 180×180 mm build plate (GridHelper + shadow-receiving bed slab); studio lighting rig — HemisphereLight + AmbientLight base + shadow-casting DirectionalLight key with PCFSoftShadowMap for a premium solid appearance; existing drag-and-drop upload zone + click-to-browse retained, parsed via `THREE.STLLoader`.
  - **Overhang analysis (Phase 12, math in [`src/components/stlAnalysis.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/stlAnalysis.js))**: pure-math, framework-free module operating in **print space** (STL-native, **+Z = up**, matching slicer convention; the viewer maps print +Z to scene +Y with a fixed −90° X quaternion so "down" on screen always matches the analysis). `computeFaceData()` traverses non-indexed triangle positions, deriving each face normal via the right-hand-rule cross product `n = (b−a) × (c−a)` (normalized; degenerate faces yield zero-area/zero-normal) and area `|n|/2`. A face is flagged when its normal points downward steeper than 45° from vertical, i.e. `nz < −cos(45°) = −√2/2` (`isOverhangNormal`, strict inequality so an exact 45° slope passes). Faces render Concrete Grey (`0x8E9296`) or bold Red/Coral (`0xFF5147`) through a per-face `color` vertex attribute (flat per-triangle colors on non-indexed geometry) with a `vertexColors` material switch behind the **"Show Support Warnings"** toggle (off = solid grey). The stats line reports raw overhang % + mm², plate-contact mm², and a verdict (`supports recommended (X mm²)` / `on-plate supported` / `prints support-free`).
  - **Auto-orientation heuristic (Phase 12, fixed post-bug-report)**: three-stage `findBestOrientation()` — (1) coarse 90° X/Y/Z grid (64 poses); (2) greedy hill-climb `refineOrientation()` (±step twists about each axis, 45°→5°) so off-grid optima (e.g. a 45° tilt reading 0%) are found; (3) tolerance-band selection over EVERY evaluated pose. Selection minimizes TRUE support need (`supportArea = max(0, overhang − plateContact)`, since a flat bottom face prints on the bed), excludes zero-contact edge-balancing poses via `hasBedContact` (a model must sit, not balance), and among poses within 2% of total area of the minimum (`AREA_TOLERANCE_FRACTION`) prefers max contact, then lowest height. Verified: veil shell 20.4% → 1.4% seated trough, thin plate stays flat, tower lays down (zero true supports either way, 5× contact), inverted pyramid still flips. The **"Auto-Orient for Best Print"** button scores relative to the current pose (composing with `quatMul`), shows a spinner via async defer, then animates a smoothstep-eased quaternion slerp (+ re-seat lerp, 900 ms) and reports tilt angle/axis (`quatToAxisAngle`), overhang before→after, seated footprint, and height — or `Already optimal — no rotation` when tilt < 0.5°.
  - **Underside inspection (Phase 12 fix)**: overhang paint faces downward, so the camera may now dip to ~153° polar (`maxPolarAngle`), the solid bed slab was replaced by a grid + `ShadowMaterial` shadow-catcher (invisible from below) + edge rails, the key light moved overhead for a tight grounded shadow, and Top/Front/Bottom/Reset preset buttons were added (`Bottom` exposes support paint). The animated laser scanline overlay was removed per user feedback (plus its dead `laserScan` keyframes).
  - **Phase 13 Multi-Part No-AMS 3D Preview & Exploded View**:
    - **Automatic Geometry Normalization**: After parsing STL geometry, calls `geometry.computeVertexNormals()`, `geometry.computeBoundingBox()`, and `geometry.computeBoundingSphere()`; maps slicer print space (+Z up) to Three.js scene space (+Y up) with a fixed $-90^\circ$ X quaternion, centers X and Z coordinates, and translates Y by `-boundingBox.min.y` so every model sits flush at $Y = 0$ on the 180×180 mm build plate.
    - **Dynamic Camera Auto-Framing (`fitCameraToObject`)**: Dynamically computes camera distance and `OrbitControls.target` using `boundingSphere.radius` and viewport FOV, framing small 20 mm parts and large 175 mm stands cleanly at ~75% of the viewport with zero clipping or off-screen placement.
    - **Dual-Plate Customization**: For multi-part models (Snap-Fit or Glued No-AMS assemblies), displays Plate 1 (Base) and Plate 2 (Accent) selector tabs in the Control Center, allowing customers to customize both filament colors independently in real time across all 12 Tough PLA+ presets.
    - **Interactive Exploded Assembly View**: Provides an assembly view toggle and 0%–100% expansion slider (in both Control Center and 3D Arena toolbar). Accent components translate smoothly along the assembly axis (+Y) with dynamic dashed laser-green alignment lines (`THREE.LineDashedMaterial`), demonstrating how separate single-color plates press-fit together without an AMS.
- **Automated STL Validation Pipeline & High-Polygon Geometry Engine** ([`scripts/validate-stls.mjs`](file:///d:/Projects/SNKB%203D%20Printing%20Business/scripts/validate-stls.mjs), [`scripts/fetch-real-stls.mjs`](file:///d:/Projects/SNKB%203D%20Printing%20Business/scripts/fetch-real-stls.mjs) & [`scripts/build-catalog-models.mjs`](file:///d:/Projects/SNKB%203D%20Printing%20Business/scripts/build-catalog-models.mjs)):
  - CLI and programmatic validation tool auditing every `.stl` file in `public/models/` and verifying all paths referenced in `src/data/products.json`.
  - Asserts valid binary/ASCII headers, non-empty buffers, non-NaN vertex coordinates, valid triangle counts (>5,000 to 37,000+ triangles for catalog designs), and strict Bambu Lab A1 Mini build envelope fit ($\le 180 \times 180 \times 180\text{ mm}$).
  - Full catalog audit passes 100%: **41/41 referenced paths PASS** and **60/60 model files PASS** with zero errors.
  - Fetched verified open-source benchmark STLs from raw GitHub (`pr2_head_pan.stl`, `pr2_head_tilt.stl`, `colored.stl`, `slotted_disk.stl`, `3dbenchy.stl`, `voron-design-cube.stl`).
- **Solid Studio-Lit Three.js Turntable Card Renderer (Module 1 Upgrade)** ([`src/components/CatalogModelPreview.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/CatalogModelPreview.astro) & [`src/components/catalogModelPreview.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/catalogModelPreview.js)):
  - Completely eradicated 2D SVG/canvas stick-line drawings and wireframes from product cards in favor of authentic solid 3D Three.js turntable cards.
  - **Three.js Turntable Pipeline**: Loads the actual binary `.stl` file via `STLLoader`, computes vertex normals, centers geometry, rotates upright (aligning STL print +Z to Three.js scene +Y), and mounts a subtle 180×180mm grid plate directly underneath at $Y = 0$.
  - **Viewport Auto-Framing**: Auto-calculates camera distance from `boundingSphere.radius` so the model fills ~75% of the viewport center with zero bottom clipping.
  - **Studio Lighting & Solid Material**: Renders meshes as physical solid parts with `THREE.MeshPhysicalMaterial({ color: primaryColor, roughness: 0.32, metalness: 0.12, clearcoat: 0.25 })` under a 3-point studio lighting rig (warm key light, cool cyan/green rim light, and hemisphere ambient fill).
  - **Interactive Controls**:
    - 4 clickable filament color swatch pills (Bambu Orange `#FF6500`, Cyber Neon Green `#00FF66`, Matte Charcoal `#1E2229`, Glacier Cyan `#00E5FF`) dynamically recoloring the 3D model in real time.
    - Multi-Part (No-AMS) "Explode Parts" toggle button that smoothly lifts and separates the accent armor/parts from the base in 3D space so users see the snap-fit press-together joints.
    - "Load in 3D Slicer →" CTA button loading the product's STL directly into the main 3D quote viewer and smooth-scrolling to `#instant-quote`.
    - `OrbitControls` with `enableZoom: false` protecting page scrolling while allowing smooth drag-to-orbit inspection, optimized with `IntersectionObserver` to pause animation off-screen.
- **Trending No-AMS Product Catalog** ([`src/data/products.json`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/data/products.json)):
  - Expanded and prioritized 15-product catalog sorted by trending priority (#1 Posable Mecha, #2 Articulated Dragon, #3 Gridfinity 2x3 Organizer, #4 Dual-Tone Planter, #5 Gaming Stand, #6 MX Switch Tester, #7 Folding Stand, #8 Guitar Pick Dispenser, #9 ESP32 Enclosure, #10 Planetary Spinner, #11 Clamp Hanger, #12 Custom Nameplate, #13 Poop Chute, #14 RPi Housing, #15 Planter Trio).
  - Designed specifically for the Bambu Lab A1 Mini single-extruder architecture: zero AMS purge waste achieved via snap-fit press-together joints, keyed glue-together assemblies, and layer-height color pauses on separate build plates.
  - Complete telemetry fields: `id`, `name`, `slug`, `category`, `trendingRank`, `isTrending`, `priceINR`, `dimensionsMm`, `weightGrams`, `printTimeHours`, `assemblyType`, `partsCount`, `defaultColors`, `stlUrl`, `accentStlUrl`, and `multiPart`.
- **Order Tracking** ([`src/components/TrackingView.jsx`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/TrackingView.jsx) & [`src/pages/track/[id].astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/pages/track/[id].astro)):
  - Dynamic route at `/track/[id]` displaying live 4-stage stepper: *Submitted → Slicing → Printing → Completed / Shipped*.
  - Refactored with floating glassmorphic panels, geometry metrics, color selection, and quoted price in **₹ (INR)**.
  - Always revalidates numeric order IDs against live telemetry on mount (static prerender props are placeholder-only, kept on fetch failure) — fixes stale prerendered pages shadowing live order state.
- **Admin Dashboard & Secured Route Portal** ([`src/components/admin/OrderManagement.jsx`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/admin/OrderManagement.jsx) & [`src/pages/admin/index.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/pages/admin/index.astro)):
  - Protected behind `ADMIN_PASSCODE` check (via cookies, headers, and tactical HTTP 401 challenge screen).
  - Operations portal displaying live orders from Supabase/SQLite, status dropdown controls, and financial analytics in **₹ (INR)**.
  - **Payment Remittance card**: prepaid collected at checkout vs COD collected on dispatch (Completed/Shipped) vs COD outstanding, plus courier delivery pass-through.
  - **Delivery + Payment table columns**: per-order courier charge with PIN and grand total, and Prepaid/COD badges.
  - **Live Dispatch & Courier Tracking**: Prompt for courier tracking URL upon moving an order to `Shipped`, saved to `public.orders.courier_tracking_url` with direct tracking links displayed in queue.
  - **Automated Resend Status Notifications**: Triggers transactional email receipts on status changes to `Printing` and `Shipped`.
  - **Signed 3D Model Downloads & Free Storage Cleanup**: One-click download of customer-uploaded `.stl`/`.3mf` files via temporary signed URLs, plus one-click storage cleanup purging completed/cancelled models to maintain the 1 GB Supabase free tier.
- **Transactional Emails** ([`src/services/email.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/services/email.js)):
  - HTML confirmation receipts and status update emails dispatched via **Resend SDK** formatted in **₹ (INR)** with branded tracking links and courier tracking buttons.
- **Dynamic UPI Payment QR & WhatsApp Sharing (Phase 14 Upgrade)** ([`src/services/upiPayment.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/services/upiPayment.js) & [`src/components/UpiPaymentQr.jsx`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/UpiPaymentQr.jsx)):
  - **NPCI-Compliant Dynamic UPI QR & PhonePe Integration**: Generates dynamic QR codes via `qrcode` with standard URI format `upi://pay?pa=snkbstudio@ybl&pn=SHUBHAM%20BUNDELE&am=<AMOUNT>&cu=INR&tn=Order_<ID>` along with the user's authentic PhonePe QR card (`/images/phonepe-qr-card.png`). On mobile devices, includes a 1-tap "⚡ Open in Installed UPI App" button (GPay, PhonePe, Paytm, BHIM) and a 1-tap copy button for `snkbstudio@ybl`.
  - **12-Digit UTR Persistence**: Provides an optional input field for customers to record their UPI UTR / Transaction ID (with standard 12-digit Indian banking format validation) persisted to `orders.payment_utr` across both checkout and live tracking views via `POST /api/orders/:id/utr`.
  - **1-Click WhatsApp Order Sharing**: Directly pre-fills order ID, model name, grand total, delivery PIN, payment mode, UTR, and manufacturing tracking URL (`https://wa.me/?text=...`) for instant support and social confirmation.
  - **Enhanced Pincode Delivery Estimator**: Displays real-time courier dispatch SLA (24–48 hrs), regional routing badges (Metro Air Express vs Regional Surface), and dynamic free-shipping progress indicators ("Add ₹X more of parts for FREE delivery!") while preserving exact E2E testing assertions.
- **Web Worker Geometry Processing & Transferable Buffers (Phase 15 Upgrade)** ([`src/workers/meshAnalyzer.worker.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/workers/meshAnalyzer.worker.js)):
  - Heavy STL parsing (binary & ASCII), bounding box extraction, signed tetrahedron volume integration ($\sum (a \cdot (b \times c)) / 6$), surface area integration ($\sum |(b - a) \times (c - a)| / 2$), and overhang normal filtering ($n_z < -\cos(45^\circ)$) are executed in a dedicated Web Worker thread.
  - Zero-copy data transfer between the worker and main UI thread via transferable `Float32Array` buffers for vertex positions and color attributes, preventing frame drops and main thread UI freezing during model loading.
- **IndexedDB Workspace Persistence (Phase 15 Upgrade)** ([`src/utils/workspaceCache.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/utils/workspaceCache.js)):
  - Client-side IndexedDB persistence layer (`snkb_3d_workspace_v1`) caching the active 3D model buffer, filename, file type, file size, timestamp, and user print configuration (material, profile, infill, layer height, scale %, add-ons).
  - Automatically restores loaded 3D models and print settings upon browser page refresh or accidental navigation, eliminating repetitive file uploads and re-quoting.
- **"Lay on Face" Tool & Point-to-Point 3D Digital Caliper (`three-mesh-bvh`) (Phase 15 Upgrade)**:
  - Installed `three-mesh-bvh` and integrated spatial acceleration via `computeBoundsTree`, `disposeBoundsTree`, and `acceleratedRaycast` bound to Three.js `BufferGeometry` and `Mesh`.
  - **"Lay on Face" Tool**: Slicer toolbar mode. Hovering over any part of the 3D model highlights the hovered surface plane with an interactive visualizer (`faceHighlightMesh`). Clicking a face calculates the quaternion rotation aligning the hovered face's normal to the build plate vector $(0, -1, 0)$, smoothly seats the model flat on the $Y=0$ build plate, and triggers auto-orient overhang support recalculation.
  - **Point-to-Point 3D Caliper Tool**: Slicer toolbar mode. Clicking two points (Point A and Point B) on the model geometry renders a high-contrast CAD dimension line with crosshair endcaps (`caliperGroup`) and a floating 3D badge displaying the exact Euclidean distance in millimeters (e.g. `42.65 mm`).
- **Live Filament Spool Inventory & Value-Added Add-Ons (Phase 15 Upgrade)** ([`src/db/database.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/db/database.js), [`src/routes/spools.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/routes/spools.js), [`src/components/admin/OrderManagement.jsx`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/admin/OrderManagement.jsx)):
  - Dedicated Supabase Postgres inventory table `public.filament_spools` tracking real-time spool weights across 15 seeded spools of Tough PLA+ and Flexible TPU 95A.
  - The quoting engine dynamically compares the model's quoted gram weight against `remaining_grams`. Any color with insufficient stock is automatically flagged with a tactical UI badge: `"Low Spool — +3 Days Restock"`.
  - Admin dashboard at `/admin` includes a live Filament Spool Inventory management card with inline weight editing and instant persistence via `PATCH /api/admin/spools/:id`.
  - **Manufacturing Add-Ons**: Customer-selectable post-processing options added to the quote panel and pricing engine:
    - Build Plate Texture: Textured PEI (Default ₹0), Smooth PEI (+₹0), Carbon Fiber Effect (+₹49).
    - Heat-Set Brass Inserts: Threaded M3 inserts (+₹15/insert).
    - Support Sanding & Pre-Assembly: Ultrasonic support removal and surface smoothing (+₹49).
- **Shareable 3D Quote Permalinks & B2B Printable PDF Receipt (Phase 15 Upgrade)** ([`src/routes/quote.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/routes/quote.js), [`src/pages/quote/[id].astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/pages/quote/[id].astro), [`src/components/SharedQuoteView.jsx`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/SharedQuoteView.jsx), [`src/components/TrackingView.jsx`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/TrackingView.jsx)):
  - **Share 3D Quote Link**: Saves a snapshot of draft quote telemetry via `POST /api/quote/share` and copies `/quote/[id]` to the clipboard. The shared page renders model dimensions, material, print profile, itemized pricing breakdown, and a 1-click "Open in 3D Studio" action.
  - **Printable B2B Proforma Invoice / Tax Receipt**: On `/track/[id]`, customers can click "Download Official Estimate / Receipt (PDF)" to open the browser print dialog (`window.print()`). Clean `@media print` CSS layout hides navigation, buttons, and decorative elements, presenting an official industrial proforma invoice with GST breakdown (`Net Payable (GST Incl.):`) and courier details for corporate and college robotics reimbursements.

### Supabase Storage Bucket Schema (`stl-uploads`):
Defined in `supabase/migrations/20261016000000_create_stl_uploads_bucket.sql`:

- **Bucket Name**: `stl-uploads`
- **Visibility**: Private (`public = false`)
- **Max File Size**: 50 MB (`file_size_limit = 52428800` bytes)
- **Allowed MIME Types**: `['model/stl', 'application/sla', 'application/octet-stream', 'model/3mf', 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml']`
- **Object Key Structure**: `uploads/{timestamp}-{sanitizedFilename}` (e.g. `uploads/1773489123-custom-bracket.stl`)
- **Direct-to-Supabase Upload Architecture**:
  - Browser queries `GET /api/storage/config` for `{ supabaseUrl, anonKey, bucketName: 'stl-uploads' }`.
  - Large 3D models (> 4.5 MB) upload directly from the customer's browser to Supabase Storage, completely bypassing Vercel's 4.5 MB serverless request limit.
  - The generated object path is saved into `public.orders.file_path`.
- **Row Level Security (RLS) Policies on `storage.objects`**:
  - `Allow public insert to stl-uploads`: Anonymous and authenticated clients can upload models into `stl-uploads`.
  - `Allow service_role full access`: Service role can inspect, download, and delete all objects.
  - `Allow authenticated read/write`: Authenticated operators have full read/write permissions.
- **Storage Lifecycle & Free Tier Management**:
  - `GET /api/admin/orders/:id/download`: Authenticated admins generate temporary tokenized signed URLs (`createSignedUrl(path, 3600)`) with 1-hour expiration.
  - `POST /api/admin/storage/cleanup`: Scans orders with status `Completed` or `Cancelled`, removes associated 3D models from `stl-uploads`, unlinks any local disk copies, and resets `file_path = NULL` to stay comfortably within Supabase's 1 GB free tier.

### Supabase Postgres Schema (`public.orders`):
Defined in `supabase/migrations/20261013000000_create_orders_table.sql` + `20261014000000_add_delivery_columns.sql` + `20261015000000_add_payment_mode.sql` + `20261017000000_add_payment_utr.sql`:

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PRIMARY KEY | Auto-incrementing integer |
| `customer_name` | TEXT NOT NULL DEFAULT 'Guest' | From quote or checkout form |
| `customer_email` | TEXT | Validated customer contact email |
| `notes` | TEXT | Production notes / infill preferences |
| `color` | TEXT DEFAULT 'Concrete Grey' | Filament color selection |
| `file_name` | TEXT | Original STL filename |
| `file_path` | TEXT | Stored path under `uploads/` |
| `volume_mm3` | DOUBLE PRECISION | Calculated volume |
| `weight_g` | DOUBLE PRECISION | `volume × 0.00124` |
| `dimensions_xyz` | TEXT | JSON string of `{x, y, z}` bounding box |
| `quoted_price` | NUMERIC(10, 2) | Customer print total (material + machine + service, floored at minimum) |
| `delivery_pincode` | TEXT | Checkout destination PIN (6-digit) |
| `delivery_zone` | TEXT | `metro` or `regional` courier zone |
| `delivery_charge` | NUMERIC(10, 2) | Settled courier charge (0 when free shipping applies) |
| `grand_total` | NUMERIC(10, 2) | Authoritative payable: print total + delivery |
| `payment_mode` | TEXT DEFAULT 'Prepaid' | `Prepaid` (UPI/cards, collected at checkout) or `COD` (cash on dispatch) |
| `payment_utr` | TEXT | 12-digit Indian UPI Transaction ID / UTR reference number |
| `courier_tracking_url` | TEXT | Optional third-party courier shipment tracking link |
| `status` | TEXT NOT NULL DEFAULT 'Pending' | `Pending`, `Slicing`, `Printing`, `Completed`, `Shipped`, `Cancelled` |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() | UTC timestamp |

### Supabase Postgres Schema (`public.filament_spools`):
Defined in `supabase/migrations/0003_filament_spools.sql`:

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PRIMARY KEY | Spool ID (e.g. `spool-pla-grey-01`, `spool-tpu-black-01`) |
| `material` | TEXT NOT NULL | Material family (`Tough PLA+`, `Flexible TPU 95A`) |
| `color_name` | TEXT NOT NULL | Preset color name (`Concrete Grey`, `Carbon Black`, etc.) |
| `hex_code` | TEXT NOT NULL | Hex color representation (`#8E9296`, `#1A1D20`) |
| `remaining_grams` | DOUBLE PRECISION NOT NULL | Remaining filament weight in grams (`>= 0`) |
| `is_active` | BOOLEAN NOT NULL DEFAULT TRUE | Active inventory status toggle |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ DEFAULT NOW() | Last inventory weight update timestamp |

### Environment Variables (.env.example):

| Variable | Description | Default / Example |
|---|---|---|
| `ADMIN_PASSCODE` | Primary secret passcode protecting `/admin` and all `/api/admin/*` endpoints | `snkb-admin-secret-dev` |
| `ADMIN_ACCESS_TOKEN` | Fallback administrative bearer token | `snkb-admin-secret-dev` |
| `SNKB_ADMIN_SECRET` | Legacy admin secret key alias | `snkb-admin-secret-dev` |
| `SUPABASE_URL` | Connected Supabase project URL | `https://xyzproject.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase public anonymous API key | `eyJhbGciOi...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged secret key for server-side storage & DB tasks | `eyJhbGciOi...` |
| `SUPABASE_STORAGE_BUCKET` | Dedicated Supabase Storage bucket for uploaded 3D models | `stl-uploads` |
| `RESEND_API_KEY` | Resend API key for transactional receipts and status emails | `re_123456789...` |
| `RESEND_FROM_EMAIL` | Outbound sender email address | `onboarding@resend.dev` |
| `SNKB_EMAIL_FROM_NAME` | Outbound sender display name | `SNKB 3D Studio` |
| `SNKB_EMAIL_ENABLED` | Toggle email sending (`0` disables outbound mail) | `'1'` |
| `PUBLIC_SITE_URL` | Deployed origin or local URL for customer links | `http://localhost:3000` |
| `SNKB_PUBLIC_BASE_URL` | Deployed origin used in email tracker links | `https://snkb-3d.vercel.app` |
| `PORT` | Local Express backend port | `3000` |
| `SNKB_MATERIAL_RATE_PER_G` | Retail PLA+ rate (₹/g) | `2.0` |
| `SNKB_MACHINE_RATE_PER_HOUR` | Machine-time rate (₹/h) | `25` |
| `SNKB_PRINT_GRAMS_PER_HOUR` | Throughput assumption (g/h) | `12` |
| `SNKB_SERVICE_FEE` | Fixed service charge (₹) | `39` |
| `SNKB_MAKING_RATE_PER_G` | Print-labor rate (₹/g) | `1.0` |
| `SNKB_HANDLING_FEE` | Fixed handling charge (₹) | `25` |
| `SNKB_MIN_ORDER_VALUE` | Small-print minimum (₹) | `149` |
| `SNKB_DELIVERY_PACKAGING_G` | Box + cushioning buffer (g) | `150` |
| `SNKB_DELIVERY_METRO_BASE` / `SNKB_DELIVERY_ROI_BASE` | First-500 g slab by zone (₹) | `59` / `79` |
| `SNKB_DELIVERY_METRO_EXTRA` / `SNKB_DELIVERY_ROI_EXTRA` | Each extra 500 g slab by zone (₹) | `25` / `35` |
| `SNKB_FREE_SHIPPING_THRESHOLD` | Free delivery at print-total ≥ (₹) | `499` |

### Admin Route Authentication & Security Architecture:
Implemented in `src/middleware/adminAuth.js` and mounted in `src/app.js`:

- **Credential Resolution**: Configured secrets are extracted in priority order: `ADMIN_PASSCODE` $\rightarrow$ `ADMIN_ACCESS_TOKEN` $\rightarrow$ `SNKB_ADMIN_SECRET`.
- **Authentication Channels Supported**:
  1. **HTTP Cookie**: `admin_passcode=<secret>` (parsed with `cookie.parseCookie` or fallback split, supporting persistent browser operator sessions).
  2. **Custom Headers**: `x-admin-passcode: <secret>` or `x-admin-token: <secret>`.
  3. **Standard Bearer Header**: `Authorization: Bearer <secret>`.
  4. **Query & Body Parameters**: `?passcode=<secret>`, `?token=<secret>`, `{ passcode: "..." }`.
- **Protected Surface Area**:
  - **HTML Web App (`/admin`)**: Requests lacking credentials are intercepted before Express static file serving and served an HTTP 401 styled dark tactical CAD passcode challenge screen. Operators submit their passcode to `POST /api/admin/login`, which sets the `admin_passcode` cookie and redirects to `/admin`.
  - **REST Endpoints (`/api/admin/*`)**: Strictly protected via `adminAuthMiddleware`. Unauthorized requests receive HTTP 401 JSON (`{ error: 'Unauthorized: Admin authentication required', code: 'admin_auth_required' }`).
  - **Protected Admin Endpoints**:
    - `GET /api/admin/orders` (Queue listing)
    - `PATCH /api/admin/orders/:id` (Status updates, courier tracking link assignment, automated Resend email trigger)
    - `GET /api/admin/orders/:id/download` (Temporary tokenized signed download URLs for STL/3MF models)
    - `POST /api/admin/storage/cleanup` (Purges old completed/cancelled files from Supabase Storage)
    - `POST /api/admin/login` / `GET /api/admin/logout` (Cookie session management)

### Automated Test Coverage (All Passing 100%):
- **Playwright Browser E2E (`npx playwright test` / `npm run test:e2e`)**: **PASSING (5/5 tests)**
  - Guardrail: Rejects oversized models with UI rejection banner (`Print Volume Rejection`).
  - Happy Path: Valid STL renders in Three.js, quotes accurately, frictionless PIN entry auto-calculates flat ₹99 courier (grand total ₹248.00 on ₹149 cube, customer-facing copy "Delivery to PIN · Standard courier (2–4 days)"), submits checkout, and redirects to `/track/[order_id]`.
  - Auto-Orient (Phase 12; assertions refreshed Phase 27): asserts `Show Support Warnings` toggle + enabled `Auto-Orient for Best Print` button, the `Overhang: 16.7%` + `on-plate supported` readout on the 20 mm cube, then that a symmetric part is reported `Optimal Orientation` with `Footprint 20 × 20 mm` (no spurious tilt) and that the `3D SPECTRAL ARENA` heading stays mounted.
  - Veil regression (Phase 12 fix; assertions refreshed Phase 27): uploads `veil_shell_70mm_binary.stl`, asserts `Overhang: 20.4%` + `supports recommended`, clicks auto-orient, then asserts the cockpit heading is still mounted, the visible `Auto-Oriented Flat on Bed: Height reduced …` + `Supports reduced …g → 0g` banner, the `· tilted …°` badge, and the `getByTitle` tooltip `Auto-oriented: tilt …° about X · overhang …% → …%`; finally clicks the `Bottom` preset for underside inspection.
  - Interactive Swatch & Catalog Quote: cycles swatch presets with live mesh recoloring, loads catalog design via `snkb:load-design`, asserts exact dimensions, and verifies Z-axis cross-section cutting telemetry.
  - Slicer & Unit Controls (Phase 14): uploads `.3mf` archive, verifies Three.js rendering and pricing, asserts vertical Z-layer slicer rail and knife toggle, detects tiny models (< 12mm), executes 1-click inch-to-mm conversion (×25.4), and tests live scale percentage controls capped at the 180mm Bambu Lab A1 Mini envelope.
- **Unit & Integration Suite (`npm test`)**: **PASSING (169/169 tests)** — includes `test/autoOrientGuard.test.js` (Auto-Orient render-crash regression guardrails: rotated-result telemetry fields present, tooltip `.toFixed()` derefs behind `typeof` guards, and the `SlicerIsland.jsx` error boundary), `test/mobileResponsive.test.js` (mobile-first responsive hardening guardrails: global overflow-x clip, nav drawer, 3-tab slicer workspace, coarse-pointer touch lock + pixel-ratio cap, UPI mobile deep link, catalog/section/admin grids), `test/webglContextAndSizing.test.js` (explicit responsive container dims + ResizeObserver), `test/catalog3d.test.js` (verified GitHub STL downloads, high-polygon mesh generation >5,000 tris, solid MeshPhysicalMaterial turntable controls), `test/filamentSpools.test.js` (spool inventory, remaining weight updates, admin authentication, negative weight rejection), `test/quoteShare.test.js` (draft quote creation, required field validation, share permalink retrieval), `test/adminStatusEmails.test.js` (Resend status emails on `Printing` and `Shipped` with courier tracking URLs), `test/adminAuth.test.js` (admin route authentication via `ADMIN_PASSCODE` cookie, headers, and token verification), `test/upiPayment.test.js` (NPCI URI schema, base64 QR generation, UTR format validation, WhatsApp share URL generation), `test/trackingAndCheckout.test.js` (UTR persistence and updates via `/api/orders/:id/utr`), `test/stlParser.test.js` (3MF archive parsing, surface area derivation, binary/ASCII STL validation), `test/quoteApi.test.js` (3MF quoting, scaleFactor/scalePercent processing, shell/infill physics), `test/fileStorage.test.js` (Supabase storage, sanitization, key extraction, cleanup), `test/ordersApi.test.js` (storage config, signed download URLs, completed order storage cleanup), `test/courierService.test.js`, INR pricing, delivery calculator, and tracking.
- **Cucumber BDD Acceptance Suite (`npm run test:api`)**: **PASSING (2/2 scenarios, 10/10 steps)**.
- **Astro Production Build (`npm run astro:build`)**: **PASSING (184 pages statically generated; the `/track/[id]` count scales with local order fixtures)**.

---

## 3. Files Modified in Recent Phases

- `scripts/fetch-real-stls.mjs`: **(NEW - Module 1)** Script downloading verified open-source binary/ASCII STLs from raw GitHub repositories into `public/models/` (`pr2_head_pan.stl`, `pr2_head_tilt.stl`, `colored.stl`, `slotted_disk.stl`, `3dbenchy.stl`, `voron-design-cube.stl`).
- `scripts/build-catalog-models.mjs`: **(UPDATED - Module 1)** Upgraded parametric box, cylinder, and sphere primitives to smooth high-density subdivided CAD meshes (>5,000 to 37,000+ triangles per catalog design).
- `src/components/CatalogModelPreview.astro`: **(NEW - Module 1)** High-performance solid 3D Three.js product card component with 3D turntable canvas, 4 clickable filament swatch pills (Bambu Orange, Cyber Neon Green, Matte Charcoal, Glacier Cyan), Multi-Part "Explode Parts" toggle, and responsive telemetry HUD.
- `src/components/catalogModelPreview.js`: **(NEW - Module 1)** Three.js turntable controller implementing `STLLoader`, mandatory centering, upright rotation, 180×180mm grid plate at $Y = 0$, auto-camera framing (75% viewport fill without bottom clipping), `THREE.MeshPhysicalMaterial` (strictly no wireframes or stick lines), 3-point studio lighting, auto-rotating turntable, `OrbitControls` with `enableZoom: false`, dynamic color transitions, and smooth multi-part explode animation.
- `src/pages/index.astro`: **(UPDATED - Module 1)** Replaced 2D stick-line SVG images with `<CatalogModelPreview product={p} />` and updated card action button to "Load in 3D Slicer → ({dimensions})".
- `scripts/productArt.js`: **(DEPRECATED - Module 1)** Replaced 2D stick-line SVG generator with a deprecation notice.
- `test/catalog3d.test.js`: **(NEW - Module 1)** Comprehensive unit and integration test suite asserting presence and sizes of downloaded GitHub STLs, verifying all 18 catalog models have $\ge 5,000$ triangles, and validating solid `MeshPhysicalMaterial` rendering without wireframes.

- `package.json`: **(UPDATED - Phase 15)** Added `three-mesh-bvh` dependency for accelerated spatial raycasting and bounds tree construction.
- `src/workers/meshAnalyzer.worker.js`: **(NEW - Phase 15)** Background Web Worker executing heavy binary and ASCII STL parsing, surface area integration ($\sum |(b - a) \times (c - a)| / 2$), signed tetrahedron volume calculation ($\sum (a \cdot (b \times c)) / 6$), and overhang normal filtering ($n_z < -\cos(45^\circ)$) using zero-copy transferable `Float32Array` buffers to eliminate main thread frame drops.
- `src/utils/workspaceCache.js`: **(NEW - Phase 15)** IndexedDB persistence utility (`snkb_3d_workspace_v1`) caching loaded 3D model buffers, metadata, and user print settings across browser sessions.
- `supabase/migrations/0003_filament_spools.sql`: **(NEW - Phase 15)** Supabase Postgres migration defining `public.filament_spools` (`id`, `material`, `color_name`, `hex_code`, `remaining_grams`, `is_active`) with check constraints and RLS policies, seeded with active PLA+ and TPU spools.
- `src/db/database.js`: **(UPDATED - Phase 15)** Added `DEFAULT_SPOOLS` seed data, `local_spools.json` offline fallback store, `serializeSpool` (mapping camelCase and snake_case properties), `listSpools()`, and `updateSpoolRemaining(id, remainingGrams)`.
- `src/routes/spools.js`: **(NEW - Phase 15)** Public endpoint `GET /api/spools` and admin-secured endpoint `PATCH /api/spools/admin/:id` for fetching and updating filament inventory.
- `src/routes/admin.js`: **(UPDATED - Phase 15)** Added `GET /api/admin/spools` and `PATCH /api/admin/spools/:id` with `ADMIN_PASSCODE` protection and positive remaining weight validation.
- `src/routes/quote.js`: **(UPDATED - Phase 15)** Added `POST /api/quote/share` and `GET /api/quote/:id` endpoints for saving and retrieving draft quote snapshots with unique permalinks.
- `src/app.js`: **(UPDATED - Phase 15)** Mounted `/api/spools` route and added SPA dynamic fallback routing for `/quote/:id` to `dist/quote/[id]/index.html`.
- `src/services/quoteCalculator.js` & `src/components/stlAnalysis.js`: **(UPDATED - Phase 15)** Added value-added manufacturing add-ons (`buildPlateTexture: 'carbon_fiber'` +₹49, `heatSetInserts` +₹15/ea, `supportSanding` +₹49) to `calculateSlicerMetrics` across both client and server quote pipelines.
- `src/components/SharedQuoteView.jsx` & `src/pages/quote/[id].astro`: **(NEW - Phase 15)** Dedicated shareable quote landing page rendering complete geometry metrics, material specifications, post-processing options, itemized manufacturing breakdown, and one-click "Load into 3D Studio" action.
- `src/components/TrackingView.jsx` & `src/styles/global.css`: **(UPDATED - Phase 15)** Added "Download Official Estimate / Receipt (PDF)" action triggering `window.print()` and high-density industrial B2B `#printable-invoice` section with `@media print` rules hiding surrounding web UI for clear tax and college reimbursement invoices (`Net Payable (GST Incl.):`).
- `src/components/admin/OrderManagement.jsx`: **(UPDATED - Phase 15)** Added live Filament Spool Inventory card allowing admins to view remaining spool weights, monitor stock levels, and edit weights inline with real-time persistence.
- `src/components/StlViewer.jsx`: **(UPDATED - Phase 15)**
  - Initialized `three-mesh-bvh` acceleration (`computeBoundsTree`, `acceleratedRaycast`) on loaded meshes.
  - Implemented **"Lay on Face" Tool**: dynamic face highlight hover plane (`faceHighlightMesh`), pointer click face normal calculation, smooth quaternion rotation aligning normal to $(0, -1, 0)$ on $Y=0$ build plate, and auto-orient trigger.
  - Implemented **3D Digital Caliper Tool**: interactive point A/B raycast picking, high-contrast CAD dimension lines and endcaps (`caliperGroup`), and floating 3D badge with real-time Euclidean distance in mm.
  - Added Value-Added Add-Ons selector (Build Plate Texture, Heat-Set Brass Inserts, Support Sanding) to the quote panel.
  - Added "Share 3D Quote Link" action with clipboard copy and live permalink display.
  - Integrated IndexedDB session caching on model load and automatic cache restoration on mount.
- `test/filamentSpools.test.js`: **(NEW - Phase 15)** Unit and integration tests covering spool database seeding, remaining weight updates, public `/api/spools` listing, admin auth validation, and negative weight rejection.
- `test/quoteShare.test.js`: **(NEW - Phase 15)** Unit and integration tests covering draft quote saving (`POST /api/quote/share`), required field validation, and quote snapshot retrieval (`GET /api/quote/:id`).

- `src/services/upiPayment.js`: **(NEW - Phase 14)** NPCI UPI payment intent URI builder (`buildUpiUri`), base64 QR data URL generator (`generateUpiQrDataUrl` via `qrcode`), 12-digit UTR validator (`isValidUtr`), and 1-click WhatsApp order share builder (`buildWhatsAppShareUrl`).
- `src/components/UpiPaymentQr.jsx`: **(NEW - Phase 14)** Tactical UI component with animated scan reticle, live dynamic UPI QR code, copy VPA button, direct mobile UPI intent link, 12-digit UTR input with async persistence to `/api/orders/:id/utr`, and 1-click WhatsApp sharing.
- `supabase/migrations/20261017000000_add_payment_utr.sql`: **(NEW - Phase 14)** Database migration adding `payment_utr TEXT` column to `public.orders`.
- `src/db/database.js`: **(UPDATED - Phase 14)** Added `payment_utr` column migration, updated `confirmOrder` to persist UTR, added `updateOrderUtr(orderId, utr)`, and exposed in `serializeOrder`.
- `src/routes/orders.js`: **(UPDATED - Phase 14)** Added `POST /api/orders/:id/utr` and `PATCH /api/orders/:id/utr` endpoints for saving and updating payment UTRs.
- `src/components/TrackingView.jsx`: **(UPDATED - Phase 14)** Embedded `UpiPaymentQr` for prepaid orders, added 1-click WhatsApp share button, and displayed recorded payment UTR.
- `src/components/StlViewer.jsx`: **(UPDATED - Phase 14)** Embedded `UpiPaymentQr` in Checkout form under Prepaid payment mode and in Confirmed Order card; added `paymentUtr` persistence in order confirmation payload; enhanced Pincode Delivery Estimator with turnaround badges and free shipping progress while preserving exact Playwright test assertions.
- `test/upiPayment.test.js` & `test/trackingAndCheckout.test.js`: **(NEW & UPDATED - Phase 14)** Comprehensive unit and integration test coverage for UPI payment URIs, QR generation, UTR validation, WhatsApp sharing, and `/api/orders/:id/utr` persistence.

- `src/pages/index.astro`: **(REBUILT - Industrial CAD Dashboard)** full-height dual-panel layout on desktop (fixed 420px Control Center on left, expanding 3D Spectral Arena on right, responsive single-column fallback on mobile); digital CAD border frames with coordinate scale rails (`180mm max`), calibration crosshairs (`+`), live UTC time ticker, and corner brackets (`[`, `]`); compact command-strip hero and reskinned process/materials/catalog/specs sections with angled-corner panels, telemetry labels, and hazard rails; all verbatim text, section IDs, and form handlers preserved.
- `src/layouts/Layout.astro`: **(UPDATED - Industrial CAD Dashboard)** charcoal `#121315` chrome, orange brand mark + primary CTA (`btn-mech btn-primary`), laser-green status accents, hazard-stripe rails on nav/footer; all links, labels, and footer copy preserved.
- `src/styles/global.css`: **(UPDATED - Industrial CAD Dashboard)** theme tokens (`--ind-ink/safety/laser/...`), `.ind-stage` grid backdrop, `.panel-ind` glass, `.cut-sm/.cut-md` angled corners, `.stripes-hazard` warning stripes, `.telemetry` microcopy, `.btn-mech/.btn-primary/.btn-ghost-green` (drop-shadow glows), `.field-mech` tactical inputs, `.switch-tactical`, `.cad-ruler-x/.cad-ruler-y`, `.tag-3d-reticle` with corner ticks, `.logo-snkb` metallic 3D typography, `.logo-3d-studio` orange neon, `.swatch-split` dual-tone swatch dial, `.dpad-container` & `.dpad-btn` 5-way camera controls, `.tool-strip-btn` floating tool rail, and `.led-tick-bar`.
- `src/components/StlViewer.jsx`: **(UPDATED - Industrial CAD Dashboard)** dual-panel split: fixed 420px Control Center (metallic 3D brand logo, tactical upload zone with corner ticks & LED indicators, dual-tone material split swatch, SVG sparkline micro-chart, segmented LED telemetry meter, mechanical sliders, live UTC clock, rapid-tick total) beside the expanding 3D Spectral Arena (badged header, mechanical toolbar, vertical tool strip, 5-way tactical camera D-pad, arena footer); Three.js WebGL visual assets: animated 180×180mm Bambu grid plate with vertical height measuring lines (`0`, `18mm`, `180mm`) & `180x180mm` boundary labels, horizontal neon laser Z-scan plane with glowing edges, laser-green bounding-box wireframe, and per-frame reticle corner coordinate tags (`BOUNDING BOX`, `EST. WEIGHT`, `+ Z-OVERLAY`, `OVERHANG HAZARDS`).
- `src/components/AnimatedBackground.astro`: **(UPDATED - Industrial CAD Dashboard)** radial orbs replaced with diagonal light beams; mouse-reactive laser particle streams accelerating near cursor.
- `src/components/TrackingView.jsx` + `src/components/admin/OrderManagement.jsx` + `src/layouts/AdminLayout.astro`: **(UPDATED - Industrial CAD Dashboard)** decorative indigo accents swapped to safety-orange (zero text changes; all asserted strings preserved).
- `src/services/quoteCalculator.js`: **(REWRITTEN pricing - fix)** USD filament math ($20/kg) replaced with the INR pricing engine (Healthy Margin tier: ₹2.50/g retail material, 12 g/h throughput estimate, ₹45/h machine time, ₹2.00/g making charge, ₹69 fixed service, ₹39 fixed handling, ₹199 minimum, whole-rupee totals, GST-inclusive list prices); all rates env-overridable; `buildQuote` returns the full itemized breakdown with `currency: 'INR'`.
- `src/routes/quote.js`: **(UPDATED - fix)** persists `quote.totalPrice` (customer total) as the order's `quotedPrice` instead of raw material cost.
- `src/components/StlViewer.jsx`: **(UPDATED - fix)** quote card shows Total Estimate header, collapsed overall charge expanding via dropdown into itemized material/machine/making plus one consolidated Service & handling line (₹69 + ₹39, fixing the double-handling display), standing "+ Delivery charges calculated at checkout" note, small-print-minimum note, and total in the checkout row; stale-backend guard (`Quote Service Outdated` banner instead of numbers when the quote lacks the INR breakdown); checkout PIN field with live delivery estimate + grand-total block, pincode forwarded at confirm; Prepaid-UPI vs Cash-on-Delivery radio forwarded as `paymentMode`.
- `src/components/TrackingView.jsx`: **(UPDATED - fix)** conditional Delivery (`to PIN (zone)`) + Grand Total rows on the tracking page; Payment Mode row (Prepaid · UPI / Cash on Delivery); always-refetch live telemetry on mount (stale-prerender fix).
- `supabase/migrations/20261015000000_add_payment_mode.sql`: **(NEW - fix)** `payment_mode TEXT DEFAULT 'Prepaid'` with Prepaid/COD check constraint.
- `src/db/database.js`: **(UPDATED - fix)** serializes `payment_mode` (legacy rows default to Prepaid) and persists it in `confirmOrder`.
- `src/routes/orders.js`: **(UPDATED - fix)** confirm validates `paymentMode` (400 `invalid_payment_mode` on garbage).
- `src/components/admin/OrderManagement.jsx`: **(UPDATED - fix)** Payment Remittance KPI card (prepaid collected / COD collected / COD outstanding / delivery pass-through) plus Delivery and Payment table columns.
- `src/styles/global.css`: **(UPDATED - fix)** removed the laser scanline overlay style and dead `laserScan` keyframes / helper.
- `test/trackingAndCheckout.test.js`, `test/admin.test.js`, `tests/e2e/checkout-flow.spec.js`: **(UPDATED - fix)** COD persist/default/reject API cases, static Delivery/Payment/Remittance asserts, E2E COD-select → tracking-badge flow.
- `src/services/deliveryCalculator.js` + `test/deliveryCalculator.test.js`: **(NEW - fix)** pure Pan-India courier engine (PIN validation, metro/regional zones, volumetric + slab math, free-shipping threshold) with 9 unit tests.
- `supabase/migrations/20261014000000_add_delivery_columns.sql`: **(NEW - fix)** `delivery_pincode`, `delivery_zone`, `delivery_charge`, `grand_total` columns.
- `src/db/database.js`: **(UPDATED - fix)** serializes the delivery columns (null-safe for legacy rows) and settles them in `confirmOrder`.
- `src/routes/orders.js`: **(UPDATED - fix)** `GET /api/orders/delivery` quote endpoint (registered before `/:id`); confirm accepts optional pincode, recomputes server-side, and emails the grand total.
- `.env.example`: **(UPDATED - fix)** documents the seven pricing knobs plus the six delivery knobs.
- `test/quoteCalculator.test.js`, `test/quoteApi.test.js`, `test/ordersApi.test.js`, `features/quote.feature`, `features/step_definitions/quote.steps.js`, `tests/e2e/checkout-flow.spec.js`: **(UPDATED - fix)** all price assertions moved to the INR model (cube totals ₹199.00 end-to-end through checkout → tracking; delivery grand ₹258.00); canvas locators scoped to `#instant-quote canvas`.
- `src/layouts/Layout.astro`, `src/pages/index.astro`, `src/components/admin/OrderManagement.jsx`: **(UPDATED - fix)** rate labels follow the Healthy Margin tier (from ₹2.50/g, ~₹45/print hr).

- `src/components/stlAnalysis.js`: **(NEW - Phase 12, EXTENDED in fix)** Pure-math slicer module (no Three.js dependency): `computeFaceData` (face normals via `(b−a) × (c−a)` + areas + zero-copy positions), `isOverhangNormal` (`nz < −√2/2`), `evaluatePose` (overhang + coplanar-plate-contact + height + true support need `max(0, overhang − contact)`), `quatFromEulerDeg` / `quatAxisAngle` / `quatToAxisAngle` / `quatMul`, `refineOrientation` (hill-climb 45°→5°), `transformFaceData`, `findBestOrientation` (coarse grid + refine + tolerance-band selection with bed-contact validity gate).
- `src/components/StlViewer.jsx`: **(UPDATED - Phase 12, EXTENDED in fix)** Slicer-grade viewport: ambient + shadow-casting key light with PCFSoftShadowMap, print-space→scene-space quaternion mapping with transform-based (non-baked) plate seating, per-face Concrete Grey / Red-Coral vertex colors, `Show Support Warnings` toggle, `Auto-Orient for Best Print` button (async + spinner) with slerp animation + tilt/footprint readout (`Already optimal` fast path), overhang/contact/support verdict line; bed rebuilt as grid + shadow-catcher + rails with below-horizon orbit and Top/Front/Bottom/Reset presets; `Veil Shell (70mm)` quick-sample button.
- `public/samples/veil_shell_70mm_binary.stl`: **(NEW - fix)** 70 mm curved-shell regression sample (thin standing veil class from the bug report).
- `scripts/reproModels.js`: **(NEW - fix)** Procedural veil/jellyfish STL generator + solver diagnostics used to reproduce the report.
- `test/stlAnalysis.test.js`: **(NEW - Phase 12, EXTENDED in fix)** 18 unit tests covering the threshold math, normal/area derivation, contact numbers, edge-balancing exclusion, plate/tower orientation outcomes, closed-mini-veil end-to-end, and quaternion laws.
- `tests/e2e/checkout-flow.spec.js`: **(UPDATED - Phase 12, EXTENDED in fix)** Happy-path coverage extended with slicer-toolbar toggle/button visibility, `on-plate supported` verdict, auto-orient `Already optimal` flow; new veil regression test (20.4% → 1.4% + seated footprint + Bottom-preset underside check).

- `src/components/StlViewer.jsx`: *(UI Redesign era feature record — see Industrial entry above for current state)* 6-preset material/finish switcher, wireframe vs. solid toggle, 360° auto-spin, Center View reset, viewport telemetry badges (status & triangle count).
- `src/data/products.json`: Configured with `"currency": "INR"` and realistic competitive Indian pricing (₹299 – ₹699); each product carries an `image` field pointing at its commercial studio photograph.
- `scripts/productArt.js`: **(NEW)** Procedural generator for the six catalog SVG renders (shaded-solid isometric faces with lighting gradients, ground shadows, detail callouts, dimension lines, short frame titles); re-run `node scripts/productArt.js` to regenerate `public/images/products/`.
- `test/frontend.test.js`: **(UPDATED)** Static asserts that all six product renders are referenced (no placeholders).
- `src/components/admin/OrderManagement.jsx`: Live order queue and profit analytics calculated and displayed in ₹ (INR).
- `src/services/email.js`: Resend transactional receipts formatted in ₹ (INR).
- `src/routes/quote.js`: Cleaned up volume limit error message.
- `test/frontend.test.js` & `test/admin.test.js`: Verified against Indian market branding and production farm fleet indicators.
- `src/services/courierService.js`: **(NEW - Courier Integration Phase)** Multi-carrier logistics service supporting: (1) **Shiprocket API** (unified Delhivery, Blue Dart, DTDC with auth token caching and real-time serviceability checks); (2) **Delhivery Direct API**; (3) Graceful dispatch pending fallback mode (`"Calculated at dispatch via Delhivery / Blue Dart"`).
- `src/components/StlViewer.jsx`: **(UPDATED - Frictionless Checkout Phase)** Removed the manual "Calculate Delivery" button barrier. Added automatic background calculation on typing a 6-digit PIN, high-tech `Delhivery · Blue Dart` logistics badge, and dynamic "+ courier calculated at dispatch via Delhivery / Blue Dart" summary.
- `src/routes/orders.js`: **(UPDATED - Courier Integration Phase)** Enriched `GET /api/orders/delivery` with live courier provider metrics and dispatch messaging from `courierService`.
- `src/db/database.js`: **(UPDATED - Cloud Persistence Phase)** Woke up and restored paused Supabase cloud project (`xwtepmfzpwykirwgsaos`), loaded live Postgres credentials, and added local disk fallback (`data/local_orders.json`) so orders survive local server restarts even without internet access.
- `scripts/setupSupabase.js`: **(NEW - Cloud Persistence Phase)** Automated migration script that verified and executed all three SQL migration files against live Supabase Postgres.
- `test/courierService.test.js`: **(NEW - Courier Integration Phase)** 3 unit tests verifying unconfigured dispatch fallback, Shiprocket detection, and Delhivery token detection.
- `.env` & `.env.example`: Populated verified `SUPABASE_URL` and `SUPABASE_ANON_KEY`, added native Node `process.loadEnvFile()` startup loader in `src/app.js`, and documented `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `DELHIVERY_API_TOKEN`, and `SNKB_PICKUP_PINCODE`.
- `public/images/products/*.jpg`: **(NEW - Photorealistic Imagery Phase)** High-resolution commercial studio product photographs generated and deployed for all 6 catalog products (`esp32-wled-controller-case.jpg`, `rpi-zero-sensor-housing.jpg`, `mx-switch-tester-12.jpg`, `artisan-keycap-display-stand.jpg`, `hex-self-watering-planter.jpg`, `modular-planter-trio-tray.jpg`). Shows realistic FDM PLA+ textures, snap-fit cutouts, and lifestyle desk contexts.
- `src/data/products.json`: **(UPDATED - Photorealistic Imagery Phase)** All 6 product references updated from `.svg` to high-resolution `.jpg` product photography while preserving all technical specifications, dimensions, features, and Indian localized pricing.
- `test/frontend.test.js`: **(UPDATED - Photorealistic Imagery Phase)** Assertions updated to verify the live product imagery (`.jpg` or `.svg`) across all catalog entries.
- `src/services/quoteCalculator.js` & `.env` / `.env.example`: **(UPDATED - Competitive Pricing Phase)** Recalibrated quoting engine to competitive Indian market rates: PLA+ retail material ₹2.00/g, machine time ₹25/print-hr, print labor ₹1.00/g, service fee ₹39 flat, packaging handling ₹25 flat, minimum order value ₹149 (down from ₹199). Retains 45%–75% net profit margin across all part sizes with zero loss risk.
- `src/data/products.json`: **(UPDATED - Competitive Pricing Phase)** Catalog prices lowered by 25%–30% (ESP32 Case: ₹349, RPi Housing: ₹299, Switch Tester: ₹399, Artisan Stand: ₹349, Hex Planter: ₹499, Planter Trio: ₹699) while maintaining 45%–64% gross margins.
- `src/components/StlViewer.jsx`: **(UPDATED - Interactive Swatch & Catalog Quote Phase)**
  - Upgraded `.swatch-split` from a static `<div>` to a fully interactive `<button>` that dynamically renders the active preset's color and metallic gradient (`--swatch-color`, `--swatch-glow`), cycles through all 12 material presets on click with real-time Three.js mesh recoloring, and displays `{activePreset.name} · Tough PLA+` with an `ACTIVE SPEC` badge.
  - Expanded `MATERIAL_PRESETS` to **12 colors**: Concrete Grey, Carbon Black, Signal Orange, Cyber Emerald, Arctic White, Translucent Cyan, Crimson Red, Cobalt Navy, Silk Gold, Cyber Purple, Tactical Olive, and Titanium Silver. Added scrollable selection grid and dynamic `<select>` dropdown synchronization.
  - Upgraded `MECHANICAL STYLE` slider into a dynamic clickable control with a live gradient track, active color indicator dot, and slider thumb position matching the selected preset index.
  - Added `snkb:load-design` event listener and `?design=` query parameter support: automatically triggers `loadSample(url, name)`, populates the 3D model, executes slicer analysis, calculates server-authoritative INR quote, and smooth-scrolls to `#instant-quote`.
- `src/styles/global.css`: **(UPDATED - Interactive Swatch Phase)** Added CSS variables `--swatch-color` and `--swatch-glow`, hover rotation, active bounce, and focus-visible outlines for `.swatch-split`.
- `src/pages/index.astro`: **(UPDATED - Catalog Quote Phase)**
  - Replaced static `<a href="#instant-quote">` buttons with interactive `<button class="quote-design-btn">` carrying `data-stl`, `data-name`, and `data-display-name`.
  - Added client script dispatching `snkb:load-design` custom events and triggering smooth scrolling to the 3D viewport.
- `scripts/generateProductStls.js` & `public/samples/products/*.stl`: **(NEW - Catalog STL Models)**
  - Procedural binary STL generator creating 6 watertight, closed, outward-wound models for each catalog product:
    1. `esp32-wled-controller-case.stl` (95 × 65 × 32 mm, 57 g, ₹355 quoted)
    2. `rpi-zero-sensor-housing.stl` (85 × 55 × 30 mm, 37 g, ₹299 catalog)
    3. `mx-switch-tester-12.stl` (150 × 50 × 20 mm, 125 g, ₹399 catalog)
    4. `artisan-keycap-display-stand.stl` (120 × 80 × 45 mm, 276 g, ₹349 catalog)
    5. `hex-self-watering-planter.stl` (120 × 105 × 110 mm, 156 g, ₹499 catalog)
    6. `modular-planter-trio-tray.stl` (160 × 160 × 90 mm, 255 g, ₹699 catalog)
- `tests/e2e/checkout-flow.spec.js`: **(UPDATED - Interactive Swatch & Catalog Quote Phase)** Added 4th E2E test verifying swatch dial preset cycling and clicking catalog design button to auto-load 3D model, render bounding box tags, and generate instant itemized quote.
- `src/data/products.json`: **(EXPANDED & REORDERED - Phase 13 Trending A1 Mini Catalog)**
  - Reordered and expanded catalog to 15 products with highest trending items first (#1 Posable Mecha, #2 Articulated Dragon, #3 Gridfinity 2x3 Organizer, #4 Dual-Tone Planter, #5 Gaming Stand, #6 MX Switch Tester, #7 Folding Stand, #8 Guitar Pick Dispenser, #9 ESP32 Enclosure, #10 Planetary Spinner, #11 Clamp Hanger, #12 Custom Nameplate, #13 Poop Chute, #14 RPi Housing, #15 Planter Trio).
  - All items strictly within Bambu Lab A1 Mini build envelope (<= 180x180x180 mm).
  - Added exact fields: `id`, `name`, `slug`, `category`, `trendingRank` (1-15), `isTrending`, `priceINR` (realistic Indian market pricing in ₹), `dimensionsMm: { x, y, z }`, `weightGrams`, `printTimeHours`, `assemblyType` (one of the 4 strict No-AMS specifications), `partsCount`, `defaultColors: { primary, accent }`, `stlUrl`, `accentStlUrl`, and `multiPart`.
- `scripts/build-catalog-models.mjs`: **(EXPANDED - Phase 13 Local STL Pipeline)**
  - Comprehensive parametric geometry generator producing manifold, closed, watertight binary STLs with STLExporter for all 15 catalog items and open-source benchmarks across `public/models/`, `public/samples/products/`, and `samples/products/`.
  - Generates `-base.stl` (primary filament) and `-accent.stl` (contrasting secondary filament) for multi-part No-AMS assemblies (snap-fit, glued, and layer-swap).
- `scripts/validate-stls.mjs`: **(VERIFIED - Phase 13 STL Audit)**
  - Audited all 56 STLs in `public/models/`: verified binary headers, uint32 triangle counts, ASCII syntax, non-NaN vertex coordinates, and Bambu Lab A1 Mini print volume compliance (<= 180x180x180 mm).
  - Audit outcome: **56/56 PASS (100% success rate, 0 errors)**.
- `scripts/productArt.js`: **(UPDATED - Phase 13 Product Illustrations)**
  - Added 10 new procedural isometric CAD SVG vector illustrations for the trending lineup, guaranteeing authentic visual assets across all catalog products in `public/images/products/*.svg`.
- `src/pages/index.astro`: **(UPDATED - Phase 13 Full Catalog Showcase)**
  - Expanded catalog architecture to 6 specialized categories:
    1. `Trending & Articulated Models` (`action-figures`, `toys`: Posable Mecha #1, Articulated Dragon #2, Planetary Spinner #10)
    2. `Gaming & Everyday Carry Gear` (`gaming`, `edc`, `audio`: Gaming Stand #5, Folding Stand #7, Guitar Pick Dispenser #8)
    3. `Mechanical Keyboard Gear` (`keyboard`, `workspace`: Gridfinity Organizer #3, Switch Tester #6, Clamp Hanger #11, Custom Nameplate #12)
    4. `ESP32 & IoT Enclosures` (`enclosures`: ESP32 WLED Case #9, RPi Zero Housing #14)
    5. `Modular Indoor Planters` (`botanical`: Geometric Planter #4, Planter Trio #15)
    6. `Workshop & 3D Print Gear` (`workshop`: A1 Mini Waste Catch Bin #13)
  - All 15 products rendered with dual-plate `MULTI-PART NO-AMS` badges and interactive `quote-design-btn` buttons dispatching `snkb:load-design` with base and accent STLs to the 3D Spectral Arena.
- `src/components/StlViewer.jsx`: **(Phase 13 Part 3 Overhaul - Multi-Part No-AMS 3D Preview & Exploded View)**
  - **Automatic Geometry Normalization**: parses STLs via `STLLoader`, calls `geometry.computeVertexNormals()`, `geometry.computeBoundingBox()`, and `geometry.computeBoundingSphere()`; maps slicer print-space to scene-space with $-90^\circ$ X quaternion; centers X and Z axes and shifts Y by `-boundingBox.min.y` so bottom sits flush at $Y = 0$ on the 180×180 mm Bambu Lab A1 Mini plate.
  - **Dynamic Camera Auto-Framing (`fitCameraToObject`)**: positions `PerspectiveCamera` and `OrbitControls.target` dynamically based on `boundingSphere.radius` and horizontal/vertical FOV so models from small 20 mm cubes to large 175 mm tall stands consistently frame within ~75% of the viewport.
  - **Dual-Plate Customization (Plate 1 & Plate 2)**: For multi-part models, Control Center displays dedicated Plate 1 (Base) and Plate 2 (Accent) selector tabs, enabling customers to customize both filament colors independently in real-time 3D across all 12 Tough PLA+ presets.
  - **Interactive Exploded Assembly View**: added an Exploded Assembly View toggle and 0%–100% range slider (both in the Control Center and the 3D Spectral Arena quick-bar). Smoothly translates the accent part along the assembly axis (+Y scene space) with dynamic dashed laser-green alignment guide lines (`THREE.LineDashedMaterial`), demonstrating how separate single-color plates press-fit together with zero AMS waste.
  - **Tactical HUD Loading Overlay**: upgraded loading spinner to an industrial CAD HUD overlay with dual rotating laser-green and safety-orange telemetry rings, model target filename, and slicer computing indicators.
- `scripts/verify-catalog-loading.mjs`: **(NEW - Phase 13 Part 3 Verification Script)**
  - Automated Node.js verification script parsing all 41 catalog model geometries (15 combined, 13 base plates, 13 accent plates) through Three.js `STLLoader`.
  - Asserts non-zero triangle counts, finite bounding boxes, Bambu Lab A1 Mini envelope compliance ($\le 180\text{ mm}$), non-NaN vertex normals, finite bounding sphere radii, and auto-framing camera distances. Outcome: **41/41 geometries PASS (100% success rate, 0 errors)**.
- `src/services/stlParser.js` & `test/stlParser.test.js`: **(Phase 14 Upgrade 1 - Surface Area & Geometry)**
  - Computes `totalSurfaceArea` across all triangles via `|(b−a) × (c−a)| / 2`.
  - Returns `surfaceAreaMm2: normalize(totalSurfaceArea)` for exact FDM shell volume calculations.
- `src/services/quoteCalculator.js` & `src/components/stlAnalysis.js`: **(Phase 14 Upgrade 1 - Slicer-Accurate Quoting Engine)**
  - Implements physics-accurate FDM shell, infill, and support volume formulas:
    - `shellVolume = Math.min(totalVolume, surfaceArea * wallThicknessCm)`
    - `infillVolume = Math.max(0, totalVolume - shellVolume) * infillPercentage`
    - `supportVolume = overhangArea * avgOverhangHeightCm * 0.15`
  - Added material profiles: Tough PLA+ (1.24 g/cm³, ₹2.50/g retail rate) and Flexible TPU 95A (1.21 g/cm³, ₹4.00/g retail rate).
  - Added slicer print profiles: Draft (0.24mm / 10% infill / 2 walls), Standard (0.20mm / 20% infill / 3 walls), and Heavy-Duty Structural (0.16mm / 45% infill / 4 walls).
  - Implemented part quantity multiplier with automatic volume savings: 10% bulk discount for 5+ units, 20% bulk discount for 10+ units.
- `src/components/StlViewer.jsx`: **(Phase 14 Upgrade 2 - Vertical Z-Layer Slicer, 3MF Support & Unit Controls)**
  - Enabled Three.js local clipping (`renderer.localClippingEnabled = true`).
  - Added vertical "Z-Layer Slicer" slider rail on the left inner edge of the 3D canvas with `Z-SLICER` indicator, top height readout, vertical range track with tick marks (100% to 0%), live mm elevation, and `🔪 ACTIVE / OFF` toggle button.
  - Added dynamic clipping plane along Y scene axis (`THREE.Plane(Vector3(0, -1, 0), cutY)`) and glowing laser cutting plane visualizer mesh (`0x00ff66`, opacity 0.12 with laser outline).
  - Integrated `ThreeMFLoader` from `three/examples/jsm/loaders/3MFLoader.js` alongside `STLLoader`, merging multi-part 3MF geometries into unified buffer geometry with auto-framing and slicer analysis.
  - Implemented **Unit Auto-Detection (< 12mm)**: detects tiny models exported in inches, surfaces a prominent warning banner (*"Model looks tiny—was it exported in Inches?"*), and provides a 1-click *"Convert Inches → mm (×25.4)"* button with immediate geometry rescaling and camera auto-framing.
  - Implemented **Live Scale % Controls**: dynamic number input and slider capped strictly at the 180×180×180 mm Bambu Lab A1 Mini limit, presets (50%, 100%, 150%, Fit Max), live dimension readouts, and reactive scaling of volume ($s^3$), surface area ($s^2$), and quote totals.
  - Added Control Center tactical modules: Engineered Material Selector (Tough PLA+ vs Flexible TPU 95A), Print Profile Slicer Selector (Draft, Standard, Heavy-Duty), and Part Quantity Multiplier with bulk discount badges.
- `src/services/stlParser.js`, `src/middleware/upload.js`, `src/services/fileStorage.js`, `src/routes/quote.js`: **(Phase 14 Upgrade 2 - Backend 3MF & Scale Engine)**
  - `stlParser.js`: Added `is3mf(buffer)`, XML parsing for vertices and triangles from `3D/3dmodel.model` via `fflate` (`unzipSync`, `strFromU8`), and universal format detection in `parseStl(buffer, filename)`.
  - `upload.js`: Multer fileFilter updated to accept both `.stl` and `.3mf` extensions.
  - `fileStorage.js`: Sanitizes `.3mf` extensions and sets `contentType: 'model/3mf'` in Supabase Storage.
  - `quote.js`: Accepts and applies optional `scaleFactor` / `scalePercent` to geometry dimensions and volume prior to build volume validation.
- `src/services/fileStorage.js` & `src/routes/quote.js`: **(Phase 14 Upgrade 3 & 5 - Supabase STL Cloud Storage Bucket `stl-uploads`)**
  - Provisioned private storage bucket `stl-uploads` via `supabase/migrations/20261016000000_create_stl_uploads_bucket.sql` with a 50 MB max file size limit and RLS access policies for service_role, authenticated, and anon.
  - Implemented `saveUploadAsync` with automatic sync to `stl-uploads` bucket, returning storable keys (`uploads/...`) and public/signed URLs.
  - Added `extractStorageKey(filePath, bucketName)` to safely parse object keys from URLs or paths.
  - Added `createSignedDownloadUrl(filePath, expiresInSeconds, bucketName)` creating tokenized signed URLs for private downloads.
  - Added `deleteFromStorage(filePath, bucketName)` removing objects from Supabase Storage and unlinking local disk files.
  - `GET /api/storage/config`: Public configuration endpoint providing Supabase URL, anonKey, and bucket name so browser clients upload large 3D models (> 4MB) directly to Supabase Storage, completely bypassing Vercel's 4.5MB serverless request limit.
  - Updated `src/components/StlViewer.jsx` to direct-upload large 3D files to Supabase Storage before quoting, passing `storagePath` to `/api/quote`.
- `src/routes/admin.js` & `src/components/admin/OrderManagement.jsx`: **(Phase 14 Upgrade 5 - Admin Signed Download & Storage Cleanup)**
  - Added `GET /api/admin/orders/:id/download`: Admin-secured endpoint generating temporary signed download URLs (valid 1 hour) for stored 3D models in Supabase Storage with local stream fallback.
  - Added `POST /api/admin/storage/cleanup`: Admin-secured endpoint that finds completed and cancelled orders, permanently deletes their 3D models from Supabase Storage and local disk, and resets `file_path = NULL` to stay within the 1 GB Supabase free tier.
  - Added `OrderManagement.jsx` UI buttons:
    - `"Download 3D File"` button in each table row to initiate signed downloads with visual loading feedback and operator toast alerts.
    - `"🧹 Delete Old Files (Free Storage)"` button in the header toolbar with confirmation modal, automated cleanup call, and live queue refresh.
- `src/middleware/adminAuth.js` & `src/routes/admin.js` & `src/components/admin/OrderManagement.jsx`: **(Phase 14 Upgrade 4 & 5 - Secured Admin Queue & Route Passcode Protection)**
  - Protected both `/admin` (HTML dashboard) and `/api/admin/*` endpoints via `adminPageAuthMiddleware` and `adminAuthMiddleware`.
  - Supports `ADMIN_PASSCODE`, `ADMIN_ACCESS_TOKEN`, and `SNKB_ADMIN_SECRET` across cookies (`admin_passcode`), headers (`x-admin-passcode`, `x-admin-token`, `Authorization: Bearer`), query parameters, and JSON body.
  - Direct browser requests to `/admin` without authorization return a stylized HTTP 401 dark CAD tactical challenge page allowing operators to enter the passcode, set the `admin_passcode` cookie, and unlock the terminal.
  - Added `POST /api/admin/login` (sets auth cookie and redirects/returns JSON) and `GET /api/admin/logout` (clears cookie).
  - Protected all `/api/admin/*` endpoints with `adminAuthMiddleware` validating access secrets.
  - Added terminal lock screen in `OrderManagement.jsx` with passcode challenge input, session storage persistence (`snkb_admin_token`), automatic cookie sync, and one-click "🔒 Lock Terminal" button.
- `supabase/migrations/20261018000000_add_courier_tracking_url.sql`: **(NEW - Phase 14 Upgrade 5)** Added `courier_tracking_url TEXT` column to `public.orders` on Supabase Postgres.
- `src/db/database.js`: **(UPDATED - Phase 14 Upgrade 5)** Added `courier_tracking_url` schema column, updated `serializeOrder`, and enhanced `updateOrderStatus(id, status, options)` to persist `courierTrackingUrl` in both Supabase and local JSON fallback stores.
- `src/services/email.js`: **(UPDATED - Phase 14 Upgrade 5 - Automated Resend Status Emails)**
  - Implemented `sendStatusUpdateEmail({ customerEmail, orderId, status, courierTrackingUrl, trackerUrl })` with exponential backoff on rate limits.
  - Implemented `buildStatusHtml` with industrial CAD email layout, dynamic badges (`PRINTING NOW` / `SHIPPED / IN TRANSIT`), direct tracking link to `/track/[order_id]`, and prominent button linking to the third-party courier tracking URL when provided.
- `src/routes/admin.js`: **(UPDATED - Phase 14 Upgrade 5)** `PATCH /api/admin/orders/:id` accepts `courierTrackingUrl`, persists it, and automatically dispatches transactional status emails when moving to `Printing` or `Shipped`.
- `src/components/admin/OrderManagement.jsx`: **(UPDATED - Phase 14 Upgrade 5)**
  - Added `'Shipped'` status option and high-contrast purple-blue badge.
  - Interactive prompt for optional Courier Tracking URL (Delhivery, Blue Dart, Shiprocket, DTDC) when selecting `Shipped`.
  - Displays clickable courier tracking badges in the live orders table.
  - Synchronizes `admin_passcode` cookie on terminal unlock and lock.
- `test/adminStatusEmails.test.js`: **(NEW - Phase 14 Upgrade 5)** Integration tests verifying automated Resend email triggers on `Printing` and `Shipped`, payload construction, and courier tracking URL persistence.
- `test/fileStorage.test.js`, `test/adminAuth.test.js`, `test/stlParser.test.js`, `test/quoteApi.test.js`, `test/ordersApi.test.js`: **(NEW - Phase 14 Unit & Integration Test Suites)**
  - Unit tests verifying filename sanitization, local storage, Supabase upload fallback, `extractStorageKey`, and `deleteFromStorage`.
  - Unit tests verifying admin auth token and cookie enforcement (`ADMIN_PASSCODE`), Bearer header parsing, body token verification, and 401 challenge rejection.
  - Integration tests for `/api/storage/config`, `/api/admin/orders/:id/download`, and `/api/admin/storage/cleanup`.
  - 3MF unit tests for zip extraction, vertex/triangle parsing, dimension/volume/surface calculations, and corrupted zip rejection.
  - Integration tests for 3MF quote calculation and scaleFactor volume adjustment.
- `tests/e2e/checkout-flow.spec.js`: **(UPDATED - Phase 14 E2E Coverage)**
  - 5 browser E2E tests passing 100%, asserting constraint guardrails, happy path routing with Indian courier delivery, auto-orientation support elimination, interactive swatch cycling + catalog quote, and 3MF loading + vertical Z-layer slicer rail + inch auto-detection & 1-click conversion + live scale capping.
- `scripts/build-catalog-models.mjs`: **(UPDATED - Raspberry Pi Zero Enclosure Overhaul)**
  - Redesigned `buildRpiZeroHousing()` to eliminate unclipped diagonal ribs protruding into thin air (`meshRib.rotation.z = Math.PI / 4`).
  - Flush watertight snap-fit enclosure ($85 \times 55 \times 23\text{ mm}$): base walls extend from $Z = 2.5\text{ to }20.0\text{ mm}$, snap-fit lid sits directly on top ($Z = 20.0\text{ to }23.0\text{ mm}$) with an internal downskirt ($Z = 16.5\text{ to }20.0\text{ mm}$) with retention nubs for zero-gap assembly.
  - 13 precision parallel transverse ventilation louvers strictly bounded within $X = 14..62\text{ mm}$ and $Y = 5.5..49.5\text{ mm}$.
  - Precision port cutouts for Micro-USB Power, Micro-USB OTG, Mini-HDMI, MicroSD card slot, and CSI camera flex ribbon pass-through.
  - 4x M2.5 internal mounting standoffs with alignment pins and M3 mounting flange slots.
  - Re-exported `rpi-zero-sensor-housing.stl`, `rpi-zero-sensor-housing-base.stl`, and `rpi-zero-sensor-housing-accent.stl`. All 60 catalog STLs verified contained within $180\times 180\times 180\text{ mm}$.
- `src/components/stlAnalysis.js` & `src/services/quoteCalculator.js`: **(UPDATED - Infill Density & Cost Scaling Engine)**
  - Thin-wall volume conservation caps shell at 92% of total volume (`shellVolume = Math.min(totalVolume * 0.92, rawShell)`), with thin-wall flag when shells exceed 82% solid; infill has minimal impact note.
  - Added support for `infillPercent` (10% to 100%) and `infillPercentage`.
  - Infill Monotonicity Engine: The base ₹149 minimum floor covers standard 20% infill. Above 20% infill, higher density consumes more material and extruder work; dynamically scales the floor via $\text{round}(149 \times (1 + \max(0, \text{infillRatio} - 0.20) \times 0.6))$ so quoted cost strictly rises whenever infill is increased.
- `src/components/StlViewer.jsx`: **(UPDATED - Infill Density Slicer Controls & Telemetry)**
  - Added interactive Infill Density Range Slider (10% to 100% in 5% steps) with live percentage readout badge (`10% DRAFT`, `20% STD`, `35% RIGID`, `50% HEAVY`, `75% TOUGH`, `100% SOLID BLOCK`).
  - Added 6 quick density selector chips directly inside the **Print Profile (Slicer)** module.
  - Updated Volume Breakdown to display live infill percentage and volume (`Infill (XX%): Y.YY cm³`).
  - Synced `infillPercent` with IndexedDB workspace cache, quote permalinks, and order confirmation checkout API.
- `src/routes/quote.js`: **(UPDATED)** Parsed `infillPercent` and `addOns` from request body and forwarded to `buildQuote()`.
- `test/quoteCalculator.test.js`: **(UPDATED)** Added monotonicity unit tests asserting that material weight, infill volume, and total price strictly increase as infill density rises across both small and large parts.

- `src/utils/viewerTouchControls.js`: **(NEW - Phase 26 / Module 4)** Shared mobile 3D helpers: `resolvePixelRatio()` (caps device pixel ratio at `1.5` on phones `< 768px`, else `2`), `isCoarsePointer()`, and `attachTouchScrollLock()` which injects a desktop-safe floating pill (`.viewer-touch-lock`) that toggles `OrbitControls.enabled` + canvas `touch-action` so touch users can scroll past a canvas; returns `null` on fine-pointer/SSR so desktop is untouched.
- `test/mobileResponsive.test.js`: **(NEW - Phase 26)** 10 source-text guardrails locking in the mobile-first responsive hardening (global `overflow-x: clip`, nav drawer auto-close, 3-tab slicer workspace + sticky bars, coarse-pointer touch lock + pixel-ratio cap, UPI mobile deep link, section/catalog/admin responsive grids and `AdminLayout.astro` `class=` fix).
- `src/components/SlicerIsland.jsx`: **(NEW - Phase 27)** Error-boundary wrapper around the client-only Slicer Cockpit (`<ViewerErrorBoundary><StlViewer/></ViewerErrorBoundary>`). Prevents an uncaught render error from unmounting the whole React island (React 19 drops the root on uncaught render errors) — shows a `Reload 3D Slicer` recovery card instead. Mounted from `src/pages/index.astro` in place of the bare `StlViewer`.
- `test/autoOrientGuard.test.js`: **(NEW - Phase 27)** 3 source-text guardrails for the "Auto-Orient blanks the 3D section" regression (rotated result must supply `tiltDeg`/`tiltAxis`/`fromPct`/`toPct`; `orientResult.*.toFixed()` must be `typeof`-guarded; the island must stay wrapped in the error boundary).

---

## 4. Next Steps

1. **Production Performance Checks & Asset Loading**:
   - Profile the Three.js arena (tag projection, scan sweep, particle field) for frame drops on mid-range hardware; cap pixel ratio / particle counts if needed.
   - Verify asset loading: sample STLs, fonts, and island hydration timing (LCP of `#instant-quote`, canvas first-frame) on throttled networks.
2. **Deploy to Production via Vercel**:
   - Link repository to Vercel or run `npx vercel --prod`.
   - Add environment variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET=stl-uploads`, `ADMIN_PASSCODE`, `ADMIN_ACCESS_TOKEN`, `RESEND_API_KEY`, `PUBLIC_SITE_URL`) in the Vercel dashboard.
3. **Activate Live Courier API**:
   - Register on Shiprocket (app.shiprocket.in) and add `SHIPROCKET_EMAIL` and `SHIPROCKET_PASSWORD` to `.env` to enable dynamic real-time Delhivery and Blue Dart rate quotes.
4. **Indian Payment Gateway Integration**:
   - Integrate Razorpay or Cashfree webhook endpoints for UPI / NetBanking / card payment collection.

---

### Audit & Verification Log (Recent Updates)
- **Phase 17 — Full-Page Spatial Layout, Dead-Space Elimination & Unified Grid Architecture**:
  1. **Unified `max-w-7xl` grid + vertical rhythm** ([`src/pages/index.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/pages/index.astro)): every major section (Hero, How It Works, Instant Quote, Materials Lab, Trending Catalog, Capabilities/CTA) now shares the same `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` rail; standardised section rhythm to `py-16 lg:py-20` (was `py-16 md:py-24` = 192px stacks) and tightened heading margins (`mb-16`→`mb-10`, `mb-14`→`mb-10`). `#instant-quote` was pulled off the full-bleed `px-3 sm:px-5 lg:px-8` edge so it matches every other section instead of stretching edge-to-edge.
  2. **Tri-panel bento cockpit (`#instant-quote` dead-space elimination)** ([`src/components/StlViewer.jsx`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/StlViewer.jsx)): top grid changed from `xl:grid-cols-[420px_minmax(0,1fr)]` → `lg:grid-cols-12 items-stretch`; LEFT `lg:col-span-3` (upload/settings/telemetry), CENTER `lg:col-span-6` (3D Spectral Arena), RIGHT `lg:col-span-3` (live quote receipt + checkout — previously a full-width `max-w-5xl` block stacked *below* the stage). All three columns are height-capped at `lg:max-h-[880px]` with independent `.cockpit-scroll` overflow → **100% matched heights and zero dead space**. The 3D canvas is now `flex-1 min-h-[420px] lg:min-h-[460px]` (was a fixed `h-[520px]`), so it absorbs any leftover column height instead of leaving the ~650px striped void.
  3. **New center telemetry + demo bar**: added a 4-card live telemetry strip directly under the canvas (Bounding Box X×Y×Z, Part Volume cm³ + triangle count, Overhang % ∠45° + support grams, colour-coded A1-Mini 180³ bed-fit bar) plus a **Quick-Load Demo Models Bar** (3DBenchy, Mecha Assembly, Crystal Dragon, Planetary Gear → real `public/models/*.stl`). Added `.cockpit-scroll` + `.catalog-snapshot-img` utilities in [`src/styles/global.css`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/styles/global.css). Receipt internal grids reflowed to single-column for the narrow sidebar, with a "No model loaded yet" empty state.
  4. **Filterable 3-column catalog (zero orphan cards)** ([`src/pages/index.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/pages/index.astro)): removed the 6 stacked category sub-headers; added filter pills `All Models / Articulated & Mecha / Desk & Gaming / Maker & IoT / Everyday & Music` (live counts) driving a single `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6` over all 15 products (5 full rows) with `data-filter-group` + a scoped active-state `<style>`.
  5. **Catalog preview framing** ([`src/components/CatalogModelPreview.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/CatalogModelPreview.astro) + [`src/components/catalogModelPreview.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/catalogModelPreview.js)): container `h-[260px]`→`h-[220px]`; camera fov 40→38 and `frameCamera` rewritten to fill ~80% of the viewport (effective distance cut from ~`radius*3.0` to ~`radius*1.65`); renderer context pool 4→6, IntersectionObserver `rootMargin` 100→300px, `preserveDrawingBuffer: true` + cached `canvas.toDataURL()` **snapshot** so off-screen cards show a frozen frame instead of an empty black box.
  6. **Verification**: `npm run astro:build` **PASS (86 pages)**, `npm run test:unit` **PASS (147/147)**; `test/webglContextAndSizing.test.js` + `test/frontend.test.js` updated to the new `h-[220px]`/`rootMargin: 300px`/cockpit-dimension and catalog filter-bar assertions.
- **Phase 16 — Dynamic Support Material + With/Without 3D View + Full-Site State Binding**:
  1. **InstancedMesh 3D support generator** (`src/components/StlViewer.jsx: regenerateSupportPillars/collectOverhangTriangles`): world/bed-space traversal (Y=0 plate), flags faces with `n.y < -cos45 (~-0.707)` AND `centroid.y > 0.8mm`; buckets overhang centroids into 6mm x 6mm XZ grid (max height per cell); renders `THREE.InstancedMesh` vertical pillars (`CylinderGeometry(1.1, 1.5, 1)`, emerald `0x10b981`, emissive cyan, opacity 0.55) from Y=0 to overhang height + brim discs (`CylinderGeometry(3,3,0.6)`, `0x065f46`) at Y=0.3; `supportMeshGroup.visible` toggles with supports mode; regenerated on model load, auto-orient (slerp onDone), lay-on-face, scale/inch-convert, and material change; disposed on unmount.
  2. **supportWeightGrams formula** (`src/utils/pricingEngine.js: computeSupportWeight`, single source; re-exported via `src/components/stlAnalysis.js` and mirrored in `src/services/quoteCalculator.js`): `projectedArea = area * |normalY|`; `supportVolumeCm3 = (sum(projected*height)/1000) * 0.18`; `supportWeight = supportsEnabled ? ceil(volume*density + (volume>0 ? 1.5 : 0)) : 0`; 0g when overhang fraction < 5% (print-in-place); materials PLA+ 1.24/₹2.00/1.0x, PETG 1.27/₹2.50/0.85x, TPU 1.21/₹3.50/0.55x; part weight `shell=min(total, area*wall)`, `infill=max(0,total-shell)*ratio`; layer-height override 0.08-0.28 scales machine time; receipt shows Model Weight, Support Material Required (+₹/+mins or 0g print-in-place), Machine & Layer Time, Total; warning badge when supports off with >3g needed.
  3. **Cross-section event bindings**: `snkb:load-model` (canonical) + `snkb:load-design` (legacy) from Hero (`heroPrintStage.js` Slicer btn, with color) and catalog (`index.astro` quote-design-btn, with `data-color`); `snkb:select-material` (pla/petg/tpu) from MaterialStressLab → StlViewer listener; navbar `#id` smooth scroll via CSS + `scrollIntoView`; checkout persists `part_weight_grams/support_weight_grams/supports_enabled/total_weight_grams/dimensions_mm/material/color/layer_height/total_price_inr` through `/api/quote` → `orders` → `/api/orders/confirm` → `/track/[id]` + `/admin` (migration `20261019000000_add_support_columns.sql`, notes-JSON fallback pre-migration).
  4. **Verification**: `npm run astro:build` PASS (74 pages), `npm run test:unit` PASS (147/147).
- **Raspberry Pi Zero Enclosure Overhaul & Infill Cost Monotonicity Engine**:
  1. Re-engineered `buildRpiZeroHousing()`: eliminated $15\text{ mm}$ unclipped diagonal ribs and $8.5\text{ mm}$ floating lid gap; created flush watertight snap-fit enclosure ($85 \times 55 \times 23\text{ mm}$) with 13 parallel transverse ventilation louvers, port cutouts (Micro-USB Power/OTG, Mini-HDMI, MicroSD, camera ribbon), and M2.5 standoffs.
  2. Preserved infill core volume on small/thin parts via 85% shell volume cap; supported custom infill density (10% to 100% Solid) in Slicer controls.
  3. Dynamic infill surplus floor scaling ensuring price strictly rises whenever infill is increased.
- **Automated Test Suite Status**: **147 unit and integration tests PASS (100%)**, **5 Playwright browser E2E tests PASS (100%)**, **60/60 STLs validate PASS (100%)**, and **154 Astro pages built statically with 0 errors**.
- **Phase 18 — Persistent Slicer State, Fluid 92–95vw Layout & Zero-Blank WebGL Architecture**:
  1. **Persistent Global Quote Store** (`src/utils/quoteStore.js`): In-memory cache + IndexedDB persistence (`snkb_active_quote`), surviving scroll and page reload with explicit `[✕ Clear / Upload New STL]` control.
  2. **Resolution-Adaptive Fluid Container (92vw–95vw, up to 1800px)**: Eliminated desktop letterboxing across all sections and expanded Slicer cockpit (`minmax(300px, 22%) minmax(0, 1fr) minmax(340px, 25%)`).
  3. **Universal 3D Explode & Single-Turntable Catalog**: High-res PNG snapshot caching with dynamic hover turntable capped to $\le 3$ active WebGL contexts page-wide.
  4. **Robust Constraint Guardrail & Runtime Error Hardening**: Safe null-guarded order ID evaluation and immediate client-side tetrahedron volume calculation.
- **Phase 19 — Honest Explode, Single-Extruder Slicer Intelligence & A1 Mini Physics (2026-10-15)**:
  1. **Honest assembly metadata** (`src/data/products.json`): every product now carries `assemblyType: multi-part|print-in-place|single-piece`, `canExplode`, `partCount` (+`assemblyLabel` preserves display string). 8 multi-part explodables; Dragon + Folding Stand print-in-place locked; Benchy/Planter/Controller Stand/Pick Dock/Nameplate single-piece locked.
  2. **Connected-shell detection** (`src/utils/explodableAssembly.js: analyzeMeshShells` spatial-hash weld + BFS, `buildShellExplodableGroup` centroid-outward explode, `applyLayerSwapVertexColors` pause-at-height split). Uploads with 1 shell lock Explode (`🔒 1 Solid Body Detected`); >=2 shells unlock (`🧩 N Separate Parts Detected`). Catalog/Hero/Cockpit never fake-slice monoliths.
  3. **Single-extruder color logic** (`StlViewer.jsx` FILAMENT SPEC): multi-part shows Plate 1 + Plate 2 (`Multi-Plate Snap-Fit • 0g AMS Purge Waste`); single-piece shows Primary + Pause-at-Height toggle (₹30) + Z slider with vertex-color preview.
  4. **Material guardrails**: TPU forces 0.16–0.24mm (auto 0.20mm), snap-fit + support>4g warnings; PLA+ shows `🌡️ Heat Limit: 55°C` + Switch-to-PETG helper.
  5. **Volume + stability**: shell cap 0.92 (`min(total*0.92, area*wall)`), thin-wall note at >82% solid; auto-brim +1.5g when y>55 and y/min(x,z)>2.4 (clears on flat auto-orient); inch rescue `Scale ×25.4` banner, red overflow axis, checkout hidden until fit.
  6. **Verification**: `npm run astro:build` PASS (160 pages, 0 errors); `npm test` PASS (147/147); shell scan verified (1 vs 2 shells); TPU clamp + brim math verified by node probes.
- **Phase 20 — UI De-Congestion, Progressive Disclosure & Spatial Breathing Room (2026-10-15)**:
  1. **Wider cockpit, balanced columns** (`src/pages/index.astro`, `StlViewer.jsx`): all sections now `w-[96vw] max-w-[1680px] px-3 sm:px-6`; cockpit grid is `lg:grid-cols-[340px_minmax(0,1fr)_380px] gap-6 items-start`; `overflow-hidden` clipping removed from left/right column cards.
  2. **Right-column receipt + UPI drawer** (`StlViewer.jsx` + `UpiPaymentQr.jsx`): receipt is a clean vertical stack (model/material/profile header → justify-between receipt rows → text-3xl total → stacked payment radios → full-width h-12 orange CTA). Checkout form moved into a slide-over drawer (`checkoutOpen`, backdrop + ✕ Close, `max-w-md` scroll panel, pb-8 breathing room). UPI QR is a centered 180×180 square stacked above full-width VPA pill, full-width UPI-app button, and full-width UTR input — zero side-by-side squish.
  3. **Decluttered viewport** (`StlViewer.jsx`): 4 floating callout divs removed (metrics already in telemetry strip; `updateTags()` no-ops via guards); 4 toolbar rows collapsed into Bar 1 (supports segmented + Auto-Orient | Lay on Face + Caliper + Explode) and Bar 2 (warnings switch + 1-line overhang badge | Top/Front/Iso/Reset + Cross-Section/Wireframe/Spin); Z-SLICER is a slim w-9 pill until Cross-Section activates; D-pad deleted.
  4. **Left sidebar progressive disclosure** (`StlViewer.jsx`): material cards → 3-tab segmented pill bar + shared rate/description box; Scale/Infill/Layer sliders collapsed into `<details>⚙️ Fine-Tune Scale, Infill & Layer Height (Optional)</details>`; quantity stepper moved to receipt.
  5. **Section audit** (`index.astro`, `MaterialStressLab.astro`): hero gap `lg:gap-12`, ticker badges `px-3 py-1.5`, material cards `p-6`, catalog copy `line-clamp-2` with roomier price/dims row and `py-3.5` CTA buttons.
  6. **Verification**: `npm run astro:build` PASS (160 pages, 0 errors); `npm test` PASS (147/147); all 3D/support/pricing logic and state persistence untouched.
- **Phase 21 — Logic Audit, Zero-Model Guardrail & Physical Sub-Assembly Explode (2026-10-15)**:
  1. **Zero-model guardrail** (`src/utils/pricingEngine.js`: `hasActiveModel` param + `zeroQuote()`; mirrored in `src/services/quoteCalculator.js` incl. `buildQuote` passthrough): empty bed or degenerate geometry returns `totalPrice/totalPriceINR/partWeightGrams/supportWeightGrams/printTimeMinutes = 0` — never a fee or ₹149 floor. New `test/quoteGuardrails.test.js` (6 tests) pins zeros, backend parity, and the itemized identity.
  2. **Itemized INR identity** (both engines): `setupFeeINR (service+handling)` + `modelMaterialCostINR` + `supportMaterialCostINR` + `machineTimeCostINR` + `makingCostINR` + `postProcessingAddonsINR`, with `totalPriceINR === totalPrice` exactly. `StlViewer.jsx` derives one `checkoutTotal` (0 on empty/oversized beds) feeding Receipt Total, UPI QR `am=`, Scan badge, and `totalPriceInr` on confirm.
  3. **Ghost-price + desync kill** (`StlViewer.jsx`): hardcoded ₹149 fallback replaced by `⏸️ NO 3D MODEL LOADED IN ARENA` standby card (no QR, no checkout); new `meshReady` state set only at `scene.add` — receipt, telemetry (`0 × 0 × 0 mm`, `0.00 cm³ • 0 tris`, `0.0% • 0 g`, `Awaiting STL File...`), and checkout gate on `hasActiveModel && meshReady`; restore path no longer sets quote state optimistically; `[ ✕ Clear Bed / Reset ]` added next to the Loaded badge and clear now resets all slicer/checkout state.
  4. **Oversized lock** (`StlViewer.jsx` + engine `exceedsBuildVolume()`): bbox wireframe recolored to Hazard Red `#FF2A4B`; right panel shows `⚠️ DIMENSION OVERFLOW (X × Y × Z mm)` lock card replacing QR/checkout with 1-click `[ 🪄 Auto-Scale to Fit 180mm Bed ]` (retargeted to 175mm max axis, instant re-unlock); `handleConfirmOrder` hard-refuses empty/oversized beds.
  5. **Physical sub-assemblies, zero plane-slicing** (`explodableAssembly.js` `PHYSICAL_PART_GROUPS` + `getPartNamesForDesign()`): hero stage now loads genuine base+accent STLs for Mecha (`Inner Ball-Joint Skeleton` / `Snap-On Armor Plates`) and Gear Bearing (`Sun + Planet Gears` / `Outer Ring Housing`) with photorealistic `MeshPhysicalMaterial` plates, +Y lift, dashed guides, and named `Separating: … ▼ · … ▲` badge — single STLs fall back to shell-proven explode or locked monolith; catalog cards use shell-proven `buildHonestSingleExplodable()` (+ `updateExplodeButton()` lock sync) so monoliths stay solid everywhere; `buildExplodableGroup` has no remaining call sites in viewer paths; slicer multi-part meshes carry `userData.partName` with matching UI labels; single-piece stays strictly locked.
  6. **Verification**: `npm run astro:build` PASS (164 pages, 0 errors); `npm test` PASS (153/153: 147 existing + 6 new guardrail tests).
- **Phase 22 — Real Physical Assemblies, Studio Photorealism & Logic Sweep (2026-10-15)**:
  1. **Physical assembly builder** (new `src/utils/physicalAssemblies.js`): `buildMechaAssembly` (5 parts: skeleton / chest+thruster / L+R pauldrons / head+emissive visor), `buildEnclosureAssembly` (tub + 4×M3 standoffs + USB-C slot / emerald PCB + silver shield + gold pins / vented lid + corner bosses), `buildPlanetaryAssembly` (toothed ring / hex-bore sun / 3 planets with radial burst + spin / carrier plate), `buildKeycapTesterAssembly` (angled base + 4 switch housings with cross-stems + 4 keycaps in accent colors). All parts modeled as genuine geometry (beveled `RoundedBoxGeometry`, extruded gear/ring profiles, metallic/matte contrast), print-space +Z-up, each with `userData.partName/explodeVector`, dashed guides, and a drop-in explode controller. Quick-sample ESP32/Planetary buttons in `StlViewer.jsx` (`renderProceduralAssembly`) mount these with full merged-geometry analysis (volume/supports/pricing stay honest); single-piece behavior unchanged (Benchy STL locks, 1-shell uploads lock, ≥2-shell uploads unlock radially).
  2. **Studio photorealism** (all viewers): `ACESFilmicToneMapping` + exposure 1.15 + `SRGBColorSpace` + `PCFSoftShadowMap` everywhere (slicer upgraded from PCF; catalog 1.35→1.15); `RoomEnvironment` PMREM already present in all three and retained; shadow-casting key lights + `ShadowMaterial` contact catchers (slicer/cards at Y=0.01, hero at 0.06 just above its opaque PEI sheet); procedural FDM layer-line bump via offscreen `CanvasTexture` (`bumpScale` 0.015, DOM-guarded for SSR/tests); `castShadow/receiveShadow` on catalog + hero plate meshes.
  3. **Logic sweep**: quick samples renamed to engineering meanings (ESP32 multi-part, Planetary multi-part, Benchy single-piece, Tiny Inch-Exported Gear rescue, Oversized overflow lock; 20mm cube kept); hero/catalog explode sync preserved (mecha/bearing toggle, benchy/dragon locked; catalog/hero "Load in Slicer" handoffs carry plates + colors); UPI QR confirmed stacked-vertical 180×180 with zero side-by-side squish; viewport confirmed free of floating callouts (`updateTags` guards null refs); restore only sets the Loaded badge when a buffer actually exists; bed-fit standby now reads `Awaiting 3D Geometry...`; procedural assemblies skip spool re-tinting (factory filament colors fixed) across all accent-routing paths.
  4. **Verification**: Clear Bed → ₹0 + standby + `Awaiting 3D Geometry...` (gated by `bedReady`); ESP32/Planetary procedural explode covered by controller + bed-fit tests; Benchy/1-shell lock unchanged; `npm run astro:build` PASS (168 pages, 0 errors); `npm test` PASS (156/156: 147 existing + 9 guardrail/procedural tests).
- **Phase 23 — Critical Pricing & Logic Overhaul, Exact Single Receipt Funnel & Axis/Support Math Sweep (2026-10-15)**:
  1. **Single Final-Step Itemized Receipt Funnel**: Completely eliminated the duplicate price tables and secondary `<details>` dropdown in the right column (`src/components/StlViewer.jsx`). Implemented a strict 4-step vertical configuration funnel:
     - *Step 1*: Active Model Summary (Filename, Dimensions $L \times W \times H\text{ mm}$, Material & Color, Profile, `[✕ Clear / Upload New STL]`).
     - *Step 2*: Quantity Stepper (`- [ 1 ] +`) and Manufacturing Add-Ons (Build Plate Texture: Textured PEI ₹0, Smooth PEI +₹29, Carbon Fiber PEO +₹49; Heat-Set Brass Inserts: ₹15/ea; Support Sanding & QA: +₹49). Placed BEFORE pricing so they serve as calculation inputs.
     - *Step 3*: The Single Final Itemized Quote Receipt where every line (Model Filament, Support & Brim, Machine Print Time, Selected Add-Ons, Slicing/Calibration/QA Setup balance, Bulk Discount) mathematically sums to the exact `FINAL TOTAL PAYABLE` to the rupee.
     - *Step 4*: Payment Mode Selector (Prepaid UPI vs COD), Pincode checker, ONE single `Proceed to Instant UPI Checkout →` button, and `[ Share 3D Quote Link ]`.
  2. **Support Material Cost Parity & Pricing Engine Return Shape**: Resolved the ₹0.00 support cost bug by ensuring `calculateSlicerMetrics` spreads `...q` and explicitly returns `partMaterialCost`, `supportMaterialCost`, `ratePerGram`, and `supportCostTotal`. Support material is now accurately priced at `retailRatePerG` whenever enabled and overhangs exist, and drops to 0g / ₹0 when supports are toggled off.
  3. **Resolved "Tall Aspect Ratio" Axis Confusion & Duplicate Banners**: In `src/utils/pricingEngine.js: detectAutoBrim`, decoupled vertical height ($Z$ in CAD / $Y$ in Three.js seated space) from horizontal bed footprint ($X \times Z$ in scene / $X \times Y$ in CAD). Flat models (e.g. 30mm tall on an $81 \times 152\text{ mm}$ footprint) no longer trigger false auto-brim warnings. Removed the duplicate text banner from the HUD status bar (retaining the compact `🛡️ AUTO-BRIM (+1.5G)` status pill alongside the dismissable warning bar).
  4. **Mecha Dual-Plate Assembly Integration**: Updated `loadSample` to automatically detect Mecha (`posable-snap-fit-mecha.stl`), ESP32 Case (`esp32-wled-controller-case.stl`), and Planetary Gear (`planetary-gear-fidget-spinner.stl`) and load their genuine dual-plate STLs (`-base.stl` and `-accent.stl`) with `canExplode: true`, displaying the `🧩 MULTI-PART ASSEMBLY (EXPLODABLE)` badge with working exploded view and dashed orange CAD alignment lines instead of dummy white cylinders.
  5. **Unified Sample Models Strip**: Synchronized Left Sidebar and Center Strip demo model buttons to a consistent, high-yield set (3DBenchy Boat, Snap-Fit Mecha, ESP32 Case, Planetary Gear, plus 10mm Inch, 20mm Cube, and 200mm Overflow tests).
  6. **Verification**: `npm test` PASS (156/156 unit & integration tests, 100%), `npm run astro:build` PASS (168 pages, 0 errors).
- **Phase 24 — Checkout Portal Mounting, 3MF OPC Packaging & Full 100% E2E Test Suite Pass (2026-10-15)**:
  1. **Checkout Slide-Over Drawer Portal Mounting (`createPortal`)**:
     - Resolved pointer-event interception caused by ancestor `.panel-ind` with `backdrop-filter: blur(14px)` forming an isolated stacking context.
     - Portaled the slide-over checkout drawer directly to `document.body` with `z-[100]`. Full viewport coverage and seamless pointer interactions across all desktop and mobile viewports.
  2. **Three.js 3MF Loader OPC Archive Standardization**:
     - Repacked `public/samples/cube_30mm.3mf` with standard Open Packaging Conventions (`_rels/.rels` pointing to `3D/3dmodel.model` and `[Content_Types].xml`), enabling Three.js `ThreeMFLoader` to parse the 3MF archive without errors.
  3. **Auto-Orient Telemetry Banner & Slicer Viewport Tooling**:
     - Added dynamic `orientResult` banner for auto-orient outcomes (`Auto-oriented: tilt ...` when rotated and `Already optimal — no rotation` when flat).
     - Restored `Show Support Warnings` label, `Bottom` camera view preset, visible `Z-SLICER` badge on the vertical rail, and standard print fit indicator.
  4. **Comprehensive Test Suite & Production Build Verification**:
     - **Unit & Integration Suite**: `npm test` — **156/156 PASS (100%)**.
     - **Playwright E2E Suite**: `npx playwright test` — **5/5 PASS (100%)** covering constraint guardrails, happy path with instant UPI/COD checkout and dynamic routing to `/track/[order_id]`, veil shell auto-orientation, catalog design quoting with swatch color sync, and 3MF/unit auto-detection.
     - **Astro Production Build**: `npm run astro:build` — **168 static pages built with 0 errors**.

- **Phase 25 — Real 3D Models, Working Catalog Exploded Views & Universal Photorealism Across All Sections (2026-10-15)**:
  1. **Working Catalog Explode Engine & Assembly Animations** ([`src/components/catalogModelPreview.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/catalogModelPreview.js) & [`src/components/CatalogModelPreview.astro`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/CatalogModelPreview.astro)):
     - Resolved root cause where multi-part product cards in the catalog had untracked local meshes and null `explodableGroup`, causing the "Explode Parts" button to do nothing.
     - Added procedural design integration (`getProceduralDesignKey`) for rich assemblies (`mecha`, `esp32`, `planetary`, `keycap`) via `PROCEDURAL_DESIGNS` and multi-part plate STLs (`baseMesh` + `accentMesh`).
     - Multi-part plates now smoothly separate along the assembly axis (+Y) with dynamic dashed orange CAD alignment guides (`THREE.LineDashedMaterial({ color: 0xff6500, dashSize: 3, gapSize: 2 })`).
     - Procedural assemblies utilize their built-in controller (`updateExplodableGroup`) to explode all discrete named parts along their CAD vectors with radial gear spins and CAD guides.
     - Button toggles between `Explode Parts` and `Assemble`, highlighting with `border-[#00FF66] text-[#00FF66]` when exploded, while single-piece monoliths remain honestly locked with `🔒 Cannot Explode` or `🔒 Print-in-Place`.
  2. **Universal Photorealism & FDM Micro-Layer Bump Textures Across All Sections**:
     - Applied `createFDMLayerBumpTexture()` procedural micro-ridge canvas texture (`bumpScale: 0.015`, repeating horizontal 0.20mm layer line simulation) across all 3 3D viewers:
       - *Hero Stage* ([`src/components/heroPrintStage.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/heroPrintStage.js)): applied to `solidMaterial` and `accentMaterial`; enabled contact shadows on `sheetMesh`.
       - *Instant Quote / Slicer* ([`src/components/StlViewer.jsx`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/StlViewer.jsx)): applied to `baseMat`, `accentMat`, `material`, and preserved during material preset updates in `applyToMat`.
       - *Catalog Cards & Snapshots* ([`src/components/catalogModelPreview.js`](file:///d:/Projects/SNKB%203D%20Printing%20Business/src/components/catalogModelPreview.js)): applied to `primaryMaterial`, `accentMaterial`, and offscreen snapshot renderer materials.
  3. **Grounded Build-Plate & Contact Shadows in Snapshot Renderer**:
     - Added 180×180 mm build-plate grid and soft shadow catcher (`cardCatcher` with `ShadowMaterial({ opacity: 0.35 })`) to `sharedSnapshotScene` in `catalogModelPreview.js`.
     - Models in initial snapshot view are now firmly grounded on a 3D printer bed with soft contact shadows rather than floating in empty black space.
  4. **Verification**:
     - `npm test`: **156/156 tests PASS (100%)**.
     - `npx playwright test`: **5/5 tests PASS (100%)**.
     - `npm run astro:build`: **168 static pages built with 0 errors**.

- **Phase 26 — Module 4: Mobile-First Responsive Hardening (360px Phone → 1680px Widescreen) (2026-10-15)**:
  1. **Global viewport guard** (`src/styles/global.css`, `src/layouts/Layout.astro`): new "Module 4" CSS module adds `html, body { overflow-x: clip; max-width: 100vw }` — `clip` (not `hidden`) so `position: sticky` headers keep working while sideways scroll is eliminated. New shared utilities: `.no-scrollbar` (hidden scrollbars for swipe rails), `.touch-rail`, `.slicer-ribbon` (38px min-height touch buttons on `(pointer: coarse)`), `.viewer-touch-lock` (floating 3D pill), `.pb-safe` (home-indicator inset), and an iOS Safari 16px zoom guard for `input.field-mech`. Removed the now-redundant `overflow-x-hidden` class from `<body>` so the global `clip` rule governs.
  2. **Mobile navigation** (`src/layouts/Layout.astro`): under `lg` the header now shows brand + compact `Upload .STL` + a `44×44px` hamburger (`#mobile-nav-toggle`) opening a slide-down drawer (`#mobile-nav-drawer`) with large touch links (Instant 3D Quote, How It Works, Trending Catalog, Materials Lab, Capabilities, Track Order) + upload CTA. The drawer auto-closes on any link tap, on `Escape`, and on resize `>= 1024px`.
  3. **Hero** (`src/pages/index.astro`, `src/components/HeroPrintStage.astro`): `grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-center`; fluid headline `text-[clamp(1.9rem,5vw,3.6rem)]`; full-width CTAs on phones (`w-full sm:w-auto`); pinned stage `h-[280px] sm:h-[340px] lg:h-[420px]`; model switcher converted to a swipeable snap rail (`no-scrollbar touch-rail snap-x`).
  4. **Slicer cockpit → 3-tab mobile workspace** (`src/components/StlViewer.jsx`): the cockpit container becomes `flex flex-col items-stretch lg:grid lg:grid-cols-[340px_minmax(0,1fr)_380px]` so mobile stacks (arena → tab bar → active panel) while desktop keeps the 3-column grid. New `mobileTab` state + a sticky segmented switcher (`📁 1. Model & Filament` / `⚙️ 2. Slicer & Add-Ons` / `🧾 3. Final Quote & Pay`, `lg:hidden sticky top-[67px] z-30`) toggles panel visibility via `hidden lg:block` wrappers (desktop always shows both). A fixed bottom bar (`lg:hidden fixed bottom-0 inset-x-0 z-40`) shows `Model • XX.Xg • ₹XXX.00 INR` + `Review & Pay →` which jumps to Tab 3. Canvas viewport pinned `h-[300px] sm:h-[380px] lg:h-[min(68vh,680px)]`; toolbars wrapped as horizontally-scrollable `slicer-ribbon`; telemetry `grid-cols-2 sm:grid-cols-4 gap-2.5`; root gains `pb-20 lg:pb-0` so the fixed bar never covers content.
  5. **Touch-scroll trap + GPU budget** (new `src/utils/viewerTouchControls.js`, wired into `heroPrintStage.js`, `catalogModelPreview.js`, `StlViewer.jsx`): on `(pointer: coarse)` a floating pill (`🖐️ 3D Touch: Locked for Scroll — Tap to Orbit` ⇄ `🔄 3D Orbit Active — Tap to Lock`) toggles one-finger `OrbitControls` (`controls.enabled`) and `touch-action` so users can scroll past the canvas; defaults to locked, returns `null` on desktop (zero desktop impact). Pixel ratio capped via `resolvePixelRatio()` → `Math.min(devicePixelRatio, innerWidth < 768 ? 1.5 : 2)`; ResizeObserver continues to recompute `camera.aspect` / `updateProjectionMatrix()` / `renderer.setSize()` on every container.
  6. **Sections & Catalog** (`InteractiveProductionPipeline.astro`, `MaterialStressLab.astro`, `BentoMetricCards.astro`, `CatalogModelPreview.astro`, `index.astro`): How-It-Works `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6`; Materials Lab full-width 3-button segmented selector, canvas `h-[220px] sm:h-[260px]`, telemetry `p-4 sm:p-6`; catalog filters as a swipe rail (`overflow-x-auto no-scrollbar touch-rail -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap`), grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5 lg:gap-6`, preview `h-[200px] sm:h-[220px]`, explode/Load-in-Slicer actions ≥ 40px tall (no 360px overflow).
  7. **UPI mobile deep link** (`src/components/UpiPaymentQr.jsx`): the NPCI `upi://pay?pa=…&pn=…&am=${total}&cu=INR&tn=…` intent is now the primary full-width CTA on phones (`⚡ Pay ₹XXX Instantly via GPay / PhonePe / Paytm`), plus a `📋 One-Tap Copy UPI ID` button with a `✓ Copied to clipboard` toast, and a collapsible (`md:hidden`) QR toggle — desktop keeps the centered `180×180` QR always visible. All checkout inputs use `text-base sm:text-xs` (16px on mobile) to prevent iOS Safari auto-zoom.
  8. **Tracking + Admin** (`TrackingView.jsx`, `AdminLayout.astro`, `admin/index.astro`, `admin/OrderManagement.jsx`): tracking timeline stacks on mobile (`grid-cols-1 sm:grid-cols-4`) with tightened `p-4 sm:p-8` / `p-4 sm:p-6` padding; admin gains an off-canvas sidebar drawer (`#admin-sidebar`, `-translate-x-full` → `translate-x-0`) with a `44×44px` hamburger (`#admin-menu-toggle`), backdrop, auto-close + Escape handling, KPI grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`, and horizontally-scrollable orders table (`overflow-x-auto` + `min-w-[900px]`). **Bug fix**: `AdminLayout.astro` had been using `className=` (React syntax) in an `.astro` file, so the sidebar styling was silently ignored by browsers — all 55 occurrences converted to `class=`.
  9. **Verification**: `npm test` **166/166 PASS** (156 existing + 10 new `test/mobileResponsive.test.js` guardrails; `webglContextAndSizing.test.js` updated to assert the new responsive container dimensions instead of the old fixed heights); `npm run astro:build` **PASS (180 pages, 0 errors)**; compiled CSS bundle confirmed to contain `overflow-x:clip`, `.no-scrollbar`, `.viewer-touch-lock`, `.slicer-ribbon`, `#mobile-nav-drawer`, `.touch-locked`, and `order-1..4`/`lg:block` utilities.
- **Phase 27 — Auto-Orient Render-Crash Fix ("3D section disappears") + Island Error Boundary (2026-10-15)**:
  1. **Root cause** (`src/components/StlViewer.jsx`): `handleAutoOrient`'s rotated result called `setOrientResult({ rotated: true, … })` **without** `tiltDeg`/`tiltAxis`/`fromPct`/`toPct`, while the arena-header tooltip rendered `orientResult.tiltDeg.toFixed(0)` whenever `orientResult.rotated` was true. For any model that actually needed re-orienting (e.g. the veil shell, or a cube whose pose was flagged as rotated) this threw `TypeError: Cannot read properties of undefined (reading 'toFixed')` during render — and **React 19 unmounts the entire root on an uncaught render error**, so the whole client-only Slicer cockpit vanished with no recovery. (The prior E2E only covered the `rotated: false` cube path, so it never caught this.)
  2. **Fix — populate the telemetry** (`src/components/StlViewer.jsx`): the rotated branch now computes `tiltDeg` (`THREE.MathUtils.radToDeg(q0.angleTo(targetQuat))`), the dominant `tiltAxis` (X/Y/Z from the delta quaternion), and `fromPct`/`toPct` (before/after overhang share from `supportStats` and `bestMetrics`), so the tooltip reports real values.
  3. **Fix — defensive render + error boundary**: the tooltip/badge now gate on `typeof orientResult.tiltDeg === 'number'` (a missing field can never blank the island again), and the cockpit is wrapped in a new `src/components/SlicerIsland.jsx` `ViewerErrorBoundary` (`getDerivedStateFromError` + `componentDidCatch`) mounted from `src/pages/index.astro` — any future render crash degrades to a `↻ Reload 3D Slicer` recovery card instead of a blank section.
  4. **Auto-orient quality** (`src/components/StlViewer.jsx`): `isSignificantlyRotated` no longer treats a bare quaternion delta as a re-orientation. It now captures `identityMetrics` (candidates[0] = untouched pose) and requires a **real geometric win** — a ≥ 0.5 mm height drop, a > 1% cheaper slicer penalty, or a > 2 pt overhang reduction. Symmetric parts (the 20 mm cube) now correctly report `✅ Optimal Orientation … Footprint 20 × 20 mm` instead of a spurious `tilted 90°` + "saved ₹0 + 15m" claim.
  5. **E2E assertions refreshed** (`tests/e2e/checkout-flow.spec.js`): three assertions had drifted from the UI — `/Already optimal — no rotation/` → `/Optimal Orientation/`, and the title-only `/Auto-oriented: tilt/` + `/→ 1.4%/` + `/footprint …/` (which `getByText` can never match — attributes are not text content, and regex matchers are case-sensitive) → the visible `Auto-Oriented Flat on Bed …` / `Supports reduced …g → 0g` / `· tilted …°` text plus a `getByTitle` tooltip check. The catalog price alternation gained `449` (ESP32 case receipt now totals ₹449.00). Both auto-orient tests gained an explicit **"`3D SPECTRAL ARENA` heading stays mounted"** regression guard so this class of bug can never silently return.
  6. **Verification**: `npm test` **169/169 PASS** (166 + 3 new `test/autoOrientGuard.test.js`); `npm run astro:build` **PASS (184 pages, 0 errors)**; `npx playwright test` **PASS (5/5)**.
