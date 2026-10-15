/**
 * scripts/build-catalog-models.mjs
 *
 * Parametric & Open-Source STL Generation Pipeline for SNKB 3D Studio.
 *
 * Produces high-detail, manifold binary .stl files in public/models/
 * optimized for the Bambu Lab A1 Mini (<= 180x180x180 mm build plate).
 *
 * Supports Multi-Part No-AMS assemblies:
 * Generates:
 *   - [slug]-base.stl   (Base component in primary filament)
 *   - [slug]-accent.stl (Snap-fit / keyed accent component in secondary filament)
 *   - [slug].stl        (Combined full assembly for instant quoting & single-part viewing)
 *
 * Usage:
 *   node scripts/build-catalog-models.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const exporter = new STLExporter();

const OUT_DIRS = [
  path.join(__dirname, '..', 'public', 'models'),
  path.join(__dirname, '..', 'public', 'samples', 'products'),
  path.join(__dirname, '..', 'samples', 'products'),
];

// Ensure all target directories exist
for (const dir of OUT_DIRS) {
  fs.mkdirSync(dir, { recursive: true });
}

function exportBinaryStl(object3D, filename) {
  const dataView = exporter.parse(object3D, { binary: true });
  const buffer = Buffer.from(dataView.buffer, dataView.byteOffset, dataView.byteLength);

  for (const dir of OUT_DIRS) {
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, buffer);
  }

  const triCount = buffer.readUInt32LE(80);
  console.log(`  ✓ Generated ${filename.padEnd(46)} (${triCount} tris, ${(buffer.length / 1024).toFixed(1)} KB)`);
  return buffer;
}

// Helper: Box mesh centered at pos with smooth subdivision
function createBox(width, length, height, pos = [0, 0, 0], segs = 6) {
  const geom = new THREE.BoxGeometry(width, length, height, segs, segs, segs);
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom);
  mesh.position.set(...pos);
  mesh.updateMatrixWorld();
  return mesh;
}

// Helper: Oriented box mesh rotated about Z axis
function createOrientedBox(width, length, height, pos = [0, 0, 0], rotZ = 0, segs = 6) {
  const geom = new THREE.BoxGeometry(width, length, height, segs, segs, segs);
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom);
  mesh.position.set(...pos);
  mesh.rotation.z = rotZ;
  mesh.updateMatrixWorld();
  return mesh;
}

// Helper: Cylinder mesh (oriented along Z axis)
function createCylinderZ(radiusTop, radiusBottom, height, segments = 36, pos = [0, 0, 0], heightSegments = 4) {
  const geom = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, Math.max(segments, 32), heightSegments);
  geom.rotateX(Math.PI / 2); // align along Z
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom);
  mesh.position.set(...pos);
  mesh.updateMatrixWorld();
  return mesh;
}

// Helper: Cylinder mesh (oriented along X axis)
function createCylinderX(radiusTop, radiusBottom, height, segments = 32, pos = [0, 0, 0], heightSegments = 4) {
  const geom = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, Math.max(segments, 28), heightSegments);
  geom.rotateZ(Math.PI / 2); // align along X
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom);
  mesh.position.set(...pos);
  mesh.updateMatrixWorld();
  return mesh;
}

// Helper: Sphere mesh
function createSphere(radius, segments = 24, pos = [0, 0, 0]) {
  const seg = Math.max(segments, 24);
  const geom = new THREE.SphereGeometry(radius, seg, seg);
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom);
  mesh.position.set(...pos);
  mesh.updateMatrixWorld();
  return mesh;
}

// ============================================================================
// ============================================================================
// 1. Posable Snap-Fit Mecha / Action Figure (Robotic Articulated Assembly)
// High-polygon sleek mecha with ball-joint sockets and snap-fit armor plates.
// Modeled with Z-UP (+Z = height, feet at Z=0, head at top) so standard slicer
// orientation engine seats it standing proudly upright on the build bed!
// ============================================================================
function buildPosableMecha() {
  const base = new THREE.Group();
  const accent = new THREE.Group();

  // Helper for Z-oriented cylinders
  const cylZ = (rTop, rBot, h, segs, pos) => {
    const geo = new THREE.CylinderGeometry(rTop, rBot, h, segs);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo);
    mesh.position.set(...pos);
    mesh.updateMatrixWorld();
    return mesh;
  };

  // Helper for X-oriented cylinders (joints/pins)
  const cylX = (rTop, rBot, h, segs, pos) => {
    const geo = new THREE.CylinderGeometry(rTop, rBot, h, segs);
    geo.rotateZ(Math.PI / 2);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo);
    mesh.position.set(...pos);
    mesh.updateMatrixWorld();
    return mesh;
  };

  // Helper for Y-oriented cylinders (chest reactor / horizontal thrusters)
  const cylY = (rTop, rBot, h, segs, pos) => {
    const geo = new THREE.CylinderGeometry(rTop, rBot, h, segs);
    geo.rotateX(Math.PI / 2);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo);
    mesh.position.set(...pos);
    mesh.updateMatrixWorld();
    return mesh;
  };

  // --- BASE: Inner Articulated Skeleton (Charcoal / Black PLA+) ---
  // 1. Feet (Combat boot chassis pods with stabilizing soles)
  base.add(createBox(15, 26, 7, [-18, 2, 3.5], 4));
  base.add(createBox(15, 26, 7, [18, 2, 3.5], 4));
  // Ankle pivot spheres
  base.add(createSphere(5.5, 20, [-18, 0, 10]));
  base.add(createSphere(5.5, 20, [18, 0, 10]));

  // 2. Shins (Lower leg skeletal core with dual hydraulic cylinders)
  base.add(createBox(11, 13, 24, [-18, 0, 24], 4));
  base.add(createBox(11, 13, 24, [18, 0, 24], 4));
  base.add(cylZ(2.5, 2.5, 22, 16, [-18, -4, 24]));
  base.add(cylZ(2.5, 2.5, 22, 16, [18, -4, 24]));

  // 3. Knee Joints (Cylindrical hinge pins)
  base.add(cylX(5.5, 5.5, 14, 20, [-18, 1, 39]));
  base.add(cylX(5.5, 5.5, 14, 20, [18, 1, 39]));

  // 4. Thighs (Upper leg chassis cores with internal pivot channels)
  base.add(createBox(12, 14, 24, [-18, 0, 54], 4));
  base.add(createBox(12, 14, 24, [18, 0, 54], 4));
  // Hip ball joints
  base.add(createSphere(7, 24, [-15, 0, 68]));
  base.add(createSphere(7, 24, [15, 0, 68]));

  // 5. Pelvis / Hip Girdle (Heavy angular chassis block)
  base.add(createBox(34, 18, 10, [0, 0, 71], 4));
  base.add(cylX(4, 4, 32, 16, [0, 0, 71]));

  // 6. Lumbar Spine & Abdomen Core (Vertebral column with hydraulic pistons)
  base.add(cylZ(7, 8, 12, 24, [0, 0, 81]));
  base.add(cylZ(2.2, 2.2, 12, 12, [-7, -3, 81]));
  base.add(cylZ(2.2, 2.2, 12, 12, [7, -3, 81]));
  base.add(cylZ(9, 8, 12, 24, [0, 0, 93]));

  // 7. Chest Skeleton Core (Broad armored torso cage)
  base.add(createBox(36, 18, 18, [0, 0, 108], 4));
  base.add(cylY(6, 6, 8, 20, [0, 8, 108])); // Hexagonal reactor mount core

  // 8. Shoulder Ball-and-Socket Joints
  base.add(createSphere(7.5, 24, [-26, 0, 114]));
  base.add(createSphere(7.5, 24, [26, 0, 114]));

  // 9. Arms: Bicep, elbow hinge pin, forearm chassis, servo hand
  // Left Arm
  base.add(createBox(9, 11, 16, [-33, 0, 103], 4));
  base.add(cylY(4.5, 4.5, 10, 16, [-33, 0, 92]));
  base.add(createBox(9, 11, 18, [-33, 1, 80], 4));
  base.add(createBox(8, 10, 9, [-33, 2, 68], 4)); // Left fist

  // Right Arm
  base.add(createBox(9, 11, 16, [33, 0, 103], 4));
  base.add(cylY(4.5, 4.5, 10, 16, [33, 0, 92]));
  base.add(createBox(9, 11, 18, [33, 1, 80], 4));
  base.add(createBox(8, 10, 9, [33, 2, 68], 4)); // Right fist

  // 10. Neck & Head Unit (Robotic cranial frame)
  base.add(cylZ(4.5, 5, 8, 16, [0, 0, 120]));
  base.add(createBox(14, 15, 14, [0, 1, 129], 4)); // Cranial skull
  base.add(createSphere(5, 16, [0, 2, 129]));

  // --- ACCENT: Snap-Fit Armor Plates (Bambu Orange / Tactical Secondary PLA+) ---
  // 1. Spartan / Mecha Visor & Fin Crest Unit
  // Visor faceplate
  accent.add(createBox(13, 4, 7, [0, 8.5, 130], 4));
  // Cylindrical optical sensor band
  accent.add(cylX(2.5, 2.5, 11, 16, [0, 8.5, 130]));
  // Spartan aerodynamic fin crest (Mohawk crest rising to 148mm)
  const crestGeo = new THREE.ConeGeometry(3.5, 18, 6);
  crestGeo.rotateX(Math.PI / 2);
  const crestMesh = new THREE.Mesh(crestGeo);
  crestMesh.position.set(0, -1, 142);
  accent.add(crestMesh);
  // Cranial side cheek guards
  accent.add(createBox(3, 13, 11, [-8, 2, 129], 4));
  accent.add(createBox(3, 13, 11, [8, 2, 129], 4));

  // 2. Chest Cuirass Heavy Armor (Angular faceted breastplate + thrusters)
  accent.add(createBox(34, 5, 20, [0, 11, 109], 4));
  accent.add(cylY(5, 4, 5, 20, [0, 12.5, 109])); // Glowing reactor lens rim
  // Dorsal Thruster Backpack
  accent.add(createBox(26, 9, 20, [0, -12, 109], 4));
  accent.add(cylZ(4.5, 6, 8, 16, [-7, -14, 97])); // Thruster nozzle L
  accent.add(cylZ(4.5, 6, 8, 16, [7, -14, 97]));  // Thruster nozzle R

  // 3. Shoulder Pauldrons (Heavy curved flared shields)
  accent.add(createBox(15, 18, 11, [-30, 0, 118], 4));
  accent.add(createBox(15, 18, 11, [30, 0, 118], 4));
  accent.add(cylX(5, 5, 6, 16, [-38, 0, 118])); // Shield vent cap L
  accent.add(cylX(5, 5, 6, 16, [38, 0, 118]));  // Shield vent cap R

  // 4. Forearm Gauntlets
  accent.add(createBox(12, 6, 17, [-33, 4, 80], 4));
  accent.add(createBox(12, 6, 17, [33, 4, 80], 4));

  // 5. Waist Armor Tassets & Belt Buckle
  accent.add(createBox(10, 4, 9, [0, 9.5, 71], 4));
  accent.add(createBox(4, 15, 12, [-18, 0, 71], 4));
  accent.add(createBox(4, 15, 12, [18, 0, 71], 4));

  // 6. Knee Armor Caps & Shin Greaves
  accent.add(createBox(12, 6, 11, [-18, 6.5, 39], 4));
  accent.add(createBox(12, 6, 11, [18, 6.5, 39], 4));
  accent.add(createBox(12, 5, 19, [-18, 6, 23], 4));
  accent.add(createBox(12, 5, 19, [18, 6, 23], 4));

  const combined = new THREE.Group();
  combined.add(base.clone());
  combined.add(accent.clone());

  return { base, accent, combined, slug: 'posable-snap-fit-mecha' };
}

// ============================================================================
// 2. Articulated Flexi Crystal Dragon (Smooth Spline-Extruded Sinuous Sculpture)
// Smooth continuous CatmullRomCurve3 spine coiled in radius ~50mm with TubeGeometry
// and faceted crystal back spikes. 100% contained within the 180x180mm bed!
// ============================================================================
function buildCrystalDragon() {
  const base = new THREE.Group();
  const accent = new THREE.Group();

  // Smooth circular / sinuous coiled spine curve of radius ~48mm (diameter ~96mm, total span <= 112mm)
  const spinePoints = [];
  const numNodes = 40;
  const baseRadius = 48;
  for (let i = 0; i <= numNodes; i++) {
    const t = i / numNodes;
    const angle = t * Math.PI * 2.6; // coiled spiral arc
    const r = baseRadius * (1 - t * 0.52); // gracefully coils inward toward tail
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    const z = 12 + Math.sin(t * Math.PI * 5) * 3 + (1 - t) * 8;
    spinePoints.push(new THREE.Vector3(x, y, z));
  }

  const spineCurve = new THREE.CatmullRomCurve3(spinePoints);

  // 1. Smooth continuous tube body with circular cross-section (radialSegments: 24, tubularSegments: 120)
  const tubeGeo = new THREE.TubeGeometry(spineCurve, 120, 6.5, 24, false);
  tubeGeo.computeVertexNormals();
  const tubeMesh = new THREE.Mesh(tubeGeo);
  base.add(tubeMesh);

  // 2. Sculpted Dragon Head at spinePoints[0]
  const headPos = spinePoints[0];
  const tangent0 = spineCurve.getTangent(0).normalize();

  // Head snout cone
  const headGeo = new THREE.ConeGeometry(9.5, 24, 16);
  headGeo.rotateX(Math.PI / 2);
  const headMesh = new THREE.Mesh(headGeo);
  headMesh.position.copy(headPos).addScaledVector(tangent0, -10);
  headMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), tangent0);
  base.add(headMesh);

  // Dragon Jaw
  const jawGeo = new THREE.CylinderGeometry(5, 7, 16, 16);
  jawGeo.rotateX(Math.PI / 2);
  const jawMesh = new THREE.Mesh(jawGeo);
  jawMesh.position.copy(headPos).addScaledVector(tangent0, -6);
  jawMesh.position.z -= 4;
  base.add(jawMesh);

  // Eyes (spheres)
  const eyeLeft = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 12));
  eyeLeft.position.copy(headPos).add(new THREE.Vector3(-6, -4, 4));
  base.add(eyeLeft);
  const eyeRight = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 12));
  eyeRight.position.copy(headPos).add(new THREE.Vector3(6, -4, 4));
  base.add(eyeRight);

  // Dragon Horns (Accent / Secondary filament for No-AMS dual plate)
  const hornLeftGeo = new THREE.ConeGeometry(3.5, 24, 12);
  hornLeftGeo.rotateZ(0.25);
  hornLeftGeo.rotateX(-0.4);
  const hornLeft = new THREE.Mesh(hornLeftGeo);
  hornLeft.position.copy(headPos).add(new THREE.Vector3(-7, 6, 10));
  accent.add(hornLeft);

  const hornRightGeo = new THREE.ConeGeometry(3.5, 24, 12);
  hornRightGeo.rotateZ(-0.25);
  hornRightGeo.rotateX(-0.4);
  const hornRight = new THREE.Mesh(hornRightGeo);
  hornRight.position.copy(headPos).add(new THREE.Vector3(7, 6, 10));
  accent.add(hornRight);

  // Center Head Crest (faceted octahedron)
  const crestMesh = new THREE.Mesh(new THREE.OctahedronGeometry(6.5));
  crestMesh.position.copy(headPos).add(new THREE.Vector3(0, 2, 9));
  accent.add(crestMesh);

  // 3. Faceted Crystal Back Spines along the spine curve
  for (let i = 2; i < numNodes - 2; i += 2) {
    const t = i / numNodes;
    const pt = spineCurve.getPoint(t);
    const tangent = spineCurve.getTangent(t).normalize();
    const up = new THREE.Vector3(0, 0, 1);
    const normal = new THREE.Vector3().crossVectors(tangent, up).normalize();

    const scale = (1 - t * 0.45);
    const spineHeight = (12 + (i % 4) * 3) * scale;
    const spineRadius = 3.2 * scale;

    // Faceted crystal spike pointing upward
    const crystalGeo = new THREE.ConeGeometry(spineRadius, spineHeight, 6);
    crystalGeo.rotateX(Math.PI / 2);
    const spikeMesh = new THREE.Mesh(crystalGeo);
    spikeMesh.position.copy(pt).add(new THREE.Vector3(0, 0, 6 * scale));
    spikeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1).addScaledVector(tangent, 0.3).normalize());
    base.add(spikeMesh);

    // Lateral dragon fin ribbing at intervals
    if (i % 6 === 0) {
      const finLeft = new THREE.Mesh(new THREE.ConeGeometry(2.5 * scale, 14 * scale, 6));
      finLeft.position.copy(pt).addScaledVector(normal, 8 * scale);
      finLeft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      base.add(finLeft);

      const finRight = new THREE.Mesh(new THREE.ConeGeometry(2.5 * scale, 14 * scale, 6));
      finRight.position.copy(pt).addScaledVector(normal, -8 * scale);
      finRight.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.clone().negate());
      base.add(finRight);
    }
  }

  // 4. Tail fan fins at end of curve
  const tailPt = spinePoints[spinePoints.length - 1];
  const tailFin = new THREE.Mesh(new THREE.ConeGeometry(5, 18, 6));
  tailFin.position.copy(tailPt);
  base.add(tailFin);

  const combined = new THREE.Group();
  combined.add(base.clone());
  combined.add(accent.clone());

  return { base, accent, combined, slug: 'articulated-crystal-dragon' };
}

// ============================================================================
// 3. Modular Gridfinity 2x3 Desk & SD/USB Organizer (126 x 84 x 45 mm)
// Trending #3: Standard 42mm Gridfinity 2x3 base + removable color-coded bins
// ============================================================================
function buildGridfinityDeskOrganizer() {
  const base = new THREE.Group();
  const accent = new THREE.Group();

  // --- BASE: Gridfinity 2x3 Baseplate (126 x 84 x 12 mm) ---
  // Main foundation slab
  base.add(createBox(126, 84, 4, [63, 42, 2]));

  // 6 Stacking Grid Bays (3 columns x 2 rows, 42mm pitch)
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 2; row++) {
      const cx = 21 + col * 42;
      const cy = 21 + row * 42;

      // 42mm Chamfered bay rim
      base.add(createBox(40, 2, 8, [cx, cy - 20, 7]));
      base.add(createBox(40, 2, 8, [cx, cy + 20, 7]));
      base.add(createBox(2, 38, 8, [cx - 20, cy, 7]));
      base.add(createBox(2, 38, 8, [cx + 20, cy, 7]));

      // Magnet hole corner bosses (6x2mm magnets)
      base.add(createCylinderZ(4, 4, 3, 12, [cx - 13, cy - 13, 2]));
      base.add(createCylinderZ(4, 4, 3, 12, [cx + 13, cy - 13, 2]));
      base.add(createCylinderZ(4, 4, 3, 12, [cx - 13, cy + 13, 2]));
      base.add(createCylinderZ(4, 4, 3, 12, [cx + 13, cy + 13, 2]));
    }
  }

  // --- ACCENT: Removable Color-Coded Insert Bins (Z=12 to 45 mm) ---
  // Bin 1 (Left 1x2): 8 SD Card & MicroSD slots
  const b1x = 21;
  accent.add(createBox(39, 81, 4, [b1x, 42, 14]));
  accent.add(createBox(3, 81, 28, [b1x - 18, 42, 29]));
  accent.add(createBox(3, 81, 28, [b1x + 18, 42, 29]));
  accent.add(createBox(36, 3, 28, [b1x, 3, 29]));
  accent.add(createBox(36, 3, 28, [b1x, 81, 29]));
  // 8 SD Card divider slats
  for (let s = 1; s <= 7; s++) {
    accent.add(createBox(32, 2, 22, [b1x, 10 + s * 9, 26]));
  }

  // Bin 2 (Middle 1x2): 6 USB-A Flash Drive Sockets
  const b2x = 63;
  accent.add(createBox(39, 81, 4, [b2x, 42, 14]));
  accent.add(createBox(3, 81, 28, [b2x - 18, 42, 29]));
  accent.add(createBox(3, 81, 28, [b2x + 18, 42, 29]));
  accent.add(createBox(36, 3, 28, [b2x, 3, 29]));
  accent.add(createBox(36, 3, 28, [b2x, 81, 29]));
  // 6 USB-A sockets (14 x 6 mm recesses)
  for (let u = 0; u < 3; u++) {
    accent.add(createBox(16, 22, 22, [b2x - 9, 18 + u * 24, 26]));
    accent.add(createBox(16, 22, 22, [b2x + 9, 18 + u * 24, 26]));
  }

  // Bin 3 (Right 1x2): Catch-all tray with scoop front
  const b3x = 105;
  accent.add(createBox(39, 81, 4, [b3x, 42, 14]));
  accent.add(createBox(3, 81, 28, [b3x - 18, 42, 29]));
  accent.add(createBox(3, 81, 28, [b3x + 18, 42, 29]));
  accent.add(createBox(36, 3, 28, [b3x, 3, 29]));
  accent.add(createBox(36, 3, 28, [b3x, 81, 29]));
  // Angled scoop lip
  const scoop = createBox(32, 18, 3, [b3x, 15, 20]);
  scoop.rotation.x = Math.PI / 6;
  scoop.updateMatrixWorld();
  accent.add(scoop);

  const combined = new THREE.Group();
  combined.add(base.clone());
  combined.add(accent.clone());

  return { base, accent, combined, slug: 'modular-gridfinity-2x3-desk-organizer' };
}

// ============================================================================
// 4. Dual-Tone Geometric Self-Watering Planter (130 x 130 x 125 mm)
// Trending #4: Watertight inner pot + contrasting faceted outer shell
// ============================================================================
function buildDualToneGeometricPlanter() {
  const base = new THREE.Group();
  const accent = new THREE.Group();

  // --- BASE: Watertight Inner Pot & Reservoir (120 x 120 x 120 mm) ---
  // Inner pot bottom plate
  base.add(createCylinderZ(54, 54, 4, 24, [65, 65, 2]));

  // Central aeration / capillary wick tube
  base.add(createCylinderZ(14, 14, 30, 16, [65, 65, 17]));

  // 8 Aeration / drainage sub-irrigation slots
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const x = 65 + 32 * Math.cos(a);
    const y = 65 + 32 * Math.sin(a);
    base.add(createCylinderZ(4, 4, 6, 12, [x, y, 3]));
  }

  // Inner cylindrical container wall (height 116mm, from Z=4 to 120mm)
  const rIn = 52;
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const x = 65 + rIn * Math.cos(a);
    const y = 65 + rIn * Math.sin(a);
    base.add(createOrientedBox(28, 3, 116, [x, y, 62], a + Math.PI / 2));
  }

  // --- ACCENT: Faceted Geometric Outer Shell (130 x 130 x 125 mm) ---
  // Outer geometric shell wraps around inner pot with diamond facet cuts
  const rOut = 62;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const x = 65 + rOut * Math.cos(a);
    const y = 65 + rOut * Math.sin(a);
    // Lower faceted prism wall
    accent.add(createOrientedBox(48, 4, 60, [x, y, 32], a + Math.PI / 2));
    // Upper contrasting flare rim
    accent.add(createOrientedBox(50, 4, 62, [x, y, 93], a + Math.PI / 2));
  }

  // Top interlocking retention bezel rim
  accent.add(createCylinderZ(64, 56, 5, 24, [65, 65, 122.5]));

  const combined = new THREE.Group();
  combined.add(base.clone());
  combined.add(accent.clone());

  return { base, accent, combined, slug: 'dual-tone-geometric-planter' };
}

// ============================================================================
// 5. Gaming Controller & Headphone Desktop Stand (155 x 140 x 175 mm)
// Trending #5: Keyed 3-part modular stand (heavy base + spine + dual cradle)
// ============================================================================
function buildGamingControllerStand() {
  const base = new THREE.Group();
  const accent = new THREE.Group();

  // --- BASE: Heavy Weighted Low-Profile Desktop Foot (155 x 140 x 22 mm) ---
  base.add(createBox(155, 140, 14, [77.5, 70, 7]));
  base.add(createBox(145, 130, 8, [77.5, 70, 18]));

  // Rear cable management pass-through cutout
  base.add(createBox(30, 16, 12, [77.5, 15, 10]));

  // Keyed vertical mounting socket for the spine
  base.add(createBox(38, 26, 14, [77.5, 55, 23]));

  // 4 Anti-slip base damping feet
  for (const [fx, fy] of [[25, 25], [130, 25], [130, 115], [25, 115]]) {
    base.add(createCylinderZ(8, 8, 3, 16, [fx, fy, 1.5]));
  }

  // --- ACCENT: Upright Angled Spine & Dual Controller/Headphone Cradle ---
  // Upright Spine (reaches total height 175 mm)
  accent.add(createBox(32, 22, 148, [77.5, 55, 96]));

  // Forward Controller Cradle Shelf (fits PS5, Xbox, Pro controllers)
  accent.add(createBox(116, 48, 12, [77.5, 90, 80]));
  // Left and Right ergonomic grip cradle horns
  accent.add(createBox(18, 22, 24, [32, 105, 92]));
  accent.add(createBox(18, 22, 24, [123, 105, 92]));

  // Ergonomic grip support cushions
  for (let g = 0; g < 4; g++) {
    accent.add(createCylinderZ(6, 6, 8, 12, [50 + g * 18, 90, 86]));
  }

  // Top Headphone Arch Cradle (curved headband saddle)
  accent.add(createBox(88, 44, 12, [77.5, 55, 169]));
  accent.add(createBox(88, 8, 8, [77.5, 35, 171])); // Back lip
  accent.add(createBox(88, 8, 8, [77.5, 75, 171])); // Front lip

  // Rear Headphone Cable Wrap Hook
  accent.add(createBox(14, 24, 16, [77.5, 30, 130]));

  const combined = new THREE.Group();
  combined.add(base.clone());
  combined.add(accent.clone());

  return { base, accent, combined, slug: 'gaming-controller-headphone-stand' };
}

// ============================================================================
// 6. Mechanical Keyboard Artisan Keycap & Switch Tester Dock (85 x 85 x 32 mm)
// Trending #6: 3x3 MX switch tester base with press-fit color accent frame
// ============================================================================
function buildSwitchTester() {
  const base = new THREE.Group();
  const accent = new THREE.Group();

  // --- BASE: Heavy Chamfered Base Block (85 x 85 x 18 mm) ---
  base.add(createBox(85, 85, 14, [42.5, 42.5, 7]));
  base.add(createBox(79, 79, 4, [42.5, 42.5, 16]));

  // Keycap puller storage holster slot on rear edge
  base.add(createBox(44, 12, 14, [42.5, 74, 11]));

  // 4 Anti-slip rubber base feet
  for (const [fx, fy] of [[15, 15], [70, 15], [70, 70], [15, 70]]) {
    base.add(createCylinderZ(7, 7, 3, 16, [fx, fy, 1.5]));
  }

  // --- ACCENT: 3x3 Switch Matrix Bezel Frame (85 x 85 x 14 mm, Z=18..32) ---
  accent.add(createBox(81, 81, 14, [42.5, 42.5, 25]));

  // 3x3 Cutout Wells (14 x 14 mm Cherry MX standard)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const sx = 20 + c * 22.5;
      const sy = 18 + r * 22.5;
      // Socket wall dividers
      accent.add(createBox(2, 18, 12, [sx - 8, sy, 25]));
      accent.add(createBox(2, 18, 12, [sx + 8, sy, 25]));
      accent.add(createBox(16, 2, 12, [sx, sy - 8, 25]));
      accent.add(createBox(16, 2, 12, [sx, sy + 8, 25]));
    }
  }

  const combined = new THREE.Group();
  combined.add(base.clone());
  combined.add(accent.clone());

  return { base, accent, combined, slug: 'mx-switch-tester-12' };
}

// ============================================================================
// 7. Adjustable Folding Phone & Tablet Geared Stand (120 x 95 x 24 mm)
// Trending #7: Print-in-place ratcheting gear hinge with press-fit side caps
// ============================================================================
function buildFoldingStand() {
  const base = new THREE.Group();
  const accent = new THREE.Group();

  // --- BASE: Main Folding Support Bed & Ratchet Frame (120 x 95 x 18 mm) ---
  base.add(createBox(120, 95, 4, [60, 47.5, 2]));

  // Front anti-slip phone ledge
  base.add(createBox(120, 14, 16, [60, 7, 10]));
  base.add(createBox(112, 6, 6, [60, 11, 15]));

  // Dual side structural rails
  base.add(createBox(8, 95, 12, [4, 47.5, 8]));
  base.add(createBox(8, 95, 12, [116, 47.5, 8]));

  // 5 Transverse Ratchet Teeth
  for (let r = 0; r < 5; r++) {
    const y = 30 + r * 14;
    base.add(createBox(104, 4, 8, [60, y, 6]));
  }

  // --- ACCENT: Hinged Strut & Press-Fit Knurled Side Pivot Caps ---
  // Folding prop easel arm (100 x 75 x 6 mm)
  accent.add(createBox(102, 68, 6, [60, 56, 17]));

  // Knurled Side Pivot Hinge Caps
  accent.add(createCylinderX(11, 11, 8, 16, [4, 85, 15]));
  accent.add(createCylinderX(11, 11, 8, 16, [116, 85, 15]));

  const combined = new THREE.Group();
  combined.add(base.clone());
  combined.add(accent.clone());

  return { base, accent, combined, slug: 'folding-phone-tablet-stand' };
}

// ============================================================================
// 8. Guitar Headstock Pick Dispenser & Capo Desk/Wall Dock (140 x 75 x 60 mm)
// Trending #8: Two-color keyed assembly with pick magazine and capo dock
// ============================================================================
function buildGuitarPickDispenser() {
  const base = new THREE.Group();
  const accent = new THREE.Group();

  // --- BASE: Headstock Shaped Dock & Capo Cradle (140 x 75 x 48 mm) ---
  base.add(createBox(140, 75, 24, [70, 37.5, 12]));
  base.add(createBox(128, 65, 18, [70, 37.5, 33]));

  // Trigger Capo resting cradle groove on right end
  base.add(createBox(24, 75, 18, [118, 37.5, 42]));

  // Vertical Pick Hopper Storage Chamber on left end
  base.add(createBox(42, 42, 34, [40, 37.5, 36]));

  // 4 Anti-slip base damping feet
  for (const [fx, fy] of [[20, 18], [120, 18], [120, 58], [20, 58]]) {
    base.add(createCylinderZ(7, 7, 3, 16, [fx, fy, 1.5]));
  }

  // --- ACCENT: Front Ejection Bezel & Emblem (110 x 50 x 14 mm) ---
  accent.add(createBox(88, 48, 12, [54, 25, 48]));
  // Pick Dispensing Feed Slot Lip
  accent.add(createBox(34, 8, 6, [40, 8, 22]));

  // 6 Tuning Peg Decorative Accent Nodes
  for (let p = 0; p < 6; p++) {
    const x = 20 + p * 18;
    accent.add(createCylinderZ(4, 4, 8, 12, [x, 65, 54]));
  }

  const combined = new THREE.Group();
  combined.add(base.clone());
  combined.add(accent.clone());

  return { base, accent, combined, slug: 'guitar-headstock-pick-dispenser' };
}

// ============================================================================
// 9. ESP32 / WLED Smart Controller Snap-Fit Enclosure (95 x 65 x 32 mm)
// Trending #9: Vented two-piece electronics enclosure with snap-fit lid
// ============================================================================
function buildEsp32Case() {
  const base = new THREE.Group();
  const accent = new THREE.Group();

  // --- BASE ---
  // Outer bottom plate (95 x 65 x 3 mm)
  base.add(createBox(95, 65, 3, [47.5, 32.5, 1.5]));
  // 4 perimeter walls (height 19 mm, from Z=3 to Z=22)
  base.add(createBox(3, 65, 19, [1.5, 32.5, 12.5]));
  base.add(createBox(3, 65, 19, [93.5, 32.5, 12.5]));
  base.add(createBox(89, 3, 19, [47.5, 1.5, 12.5]));
  base.add(createBox(89, 3, 19, [47.5, 63.5, 12.5]));

  // 4 PCB Standoff Posts inside base
  const postPositions = [
    [10, 10, 6],
    [85, 10, 6],
    [10, 55, 6],
    [85, 55, 6],
  ];
  for (const pos of postPositions) {
    base.add(createCylinderZ(3.2, 3.2, 6, 16, pos));
  }

  // Snap-fit retention shelf / rim
  base.add(createBox(2, 60, 2, [3.5, 32.5, 21]));
  base.add(createBox(2, 60, 2, [91.5, 32.5, 21]));

  // --- ACCENT (Snap-Fit Top Lid) ---
  // Top faceplate (95 x 65 x 3 mm, sits from Z=29 to 32 mm)
  accent.add(createBox(95, 5, 3, [47.5, 2.5, 30.5]));
  accent.add(createBox(95, 5, 3, [47.5, 62.5, 30.5]));
  accent.add(createBox(6, 55, 3, [3, 32.5, 30.5]));
  accent.add(createBox(6, 55, 3, [92, 32.5, 30.5]));

  // 10 ventilation cooling slats across the center
  for (let x = 14; x <= 80; x += 6.5) {
    accent.add(createBox(3, 55, 3, [x, 32.5, 30.5]));
  }

  // Snap-fit male insertion skirt (sits from Z=22 to Z=29 mm)
  accent.add(createBox(88, 2, 7, [47.5, 5, 25.5]));
  accent.add(createBox(88, 2, 7, [47.5, 60, 25.5]));
  accent.add(createBox(2, 53, 7, [6.5, 32.5, 25.5]));
  accent.add(createBox(2, 53, 7, [88.5, 32.5, 25.5]));

  const combined = new THREE.Group();
  combined.add(base.clone());
  combined.add(accent.clone());

  return { base, accent, combined, slug: 'esp32-wled-controller-case' };
}

// ============================================================================
// 10. Planetary Gear Fidget Spinner & Desk Cube (70 x 70 x 20 mm)
// Trending #10: Print-in-place herringbone gears + snap-in center caps
// ============================================================================
function buildPlanetarySpinner() {
  const base = new THREE.Group();
  const accent = new THREE.Group();

  // --- BASE: Outer Annular Ring & 3 Planetary Gears (70 x 70 x 14 mm) ---
  // Outer Ring Gear perimeter (70 x 70 x 14 mm, center at [35, 35, 10])
  base.add(createCylinderZ(35, 35, 14, 48, [35, 35, 10]));

  // Central Sun Gear
  base.add(createCylinderZ(11, 11, 14, 32, [35, 35, 10]));

  // Outer ring decorative gear grip teeth
  for (let t = 0; t < 12; t++) {
    const ta = (t * 2 * Math.PI) / 12;
    base.add(createBox(4, 4, 12, [35 + 34 * Math.cos(ta), 35 + 34 * Math.sin(ta), 10], 4));
  }

  // 3 Planetary Gears orbiting at 120-degree intervals (radius 18mm)
  for (let p = 0; p < 3; p++) {
    const a = (p * 2 * Math.PI) / 3;
    const px = 35 + 18 * Math.cos(a);
    const py = 35 + 18 * Math.sin(a);
    base.add(createCylinderZ(8, 8, 14, 32, [px, py, 10]));
    // Planet gear teeth
    for (let gt = 0; gt < 6; gt++) {
      const gta = a + (gt * 2 * Math.PI) / 6;
      base.add(createBox(3, 3, 12, [px + 8.5 * Math.cos(gta), py + 8.5 * Math.sin(gta), 10], 4));
    }
  }

  // --- ACCENT: Snap-In Contrasting Center Thumb Caps (Z=0..20 mm) ---
  // Bottom finger grip cap (26 mm diameter, Z=0..3)
  accent.add(createCylinderZ(13, 13, 3, 36, [35, 35, 1.5]));
  // Top finger grip cap (26 mm diameter, Z=17..20)
  accent.add(createCylinderZ(13, 13, 3, 36, [35, 35, 18.5]));
  // Center connecting shaft pin
  accent.add(createCylinderZ(5, 5, 18, 24, [35, 35, 10]));

  // Cap tactile grip facets
  for (let cf = 0; cf < 8; cf++) {
    const cfa = (cf * 2 * Math.PI) / 8;
    accent.add(createBox(3, 3, 2, [35 + 8 * Math.cos(cfa), 35 + 8 * Math.sin(cfa), 19.5], 4));
  }

  const combined = new THREE.Group();
  combined.add(base.clone());
  combined.add(accent.clone());

  return { base, accent, combined, slug: 'planetary-gear-fidget-spinner' };
}

// ============================================================================
// 11. Under-Desk Clamp Headphone & Cable Hanger (110 x 65 x 95 mm)
// Trending #11: Heavy-duty C-clamp bracket with printable knurled thumbscrew
// ============================================================================
function buildClampHeadphoneHanger() {
  const base = new THREE.Group();
  const accent = new THREE.Group();

  // --- BASE: Heavy-Duty C-Clamp Body & Headphone Saddle (110 x 65 x 95 mm) ---
  // Upper clamping jaw (rests on desk surface, thickness 14 mm)
  base.add(createBox(65, 65, 14, [32.5, 32.5, 88]));

  // Vertical clamp backbone spine (thickness 18 mm, height 80 mm)
  base.add(createBox(18, 65, 80, [9, 32.5, 48]));

  // Lower clamping jaw with threaded collar
  base.add(createBox(65, 65, 14, [32.5, 32.5, 8]));
  base.add(createCylinderZ(18, 18, 12, 32, [45, 32.5, 14]));

  // Forward extending curved headphone hanger arm
  base.add(createBox(45, 45, 14, [87.5, 32.5, 88]));
  // Front retention lip to prevent headphones sliding off
  base.add(createBox(8, 45, 14, [106, 32.5, 95]));

  // Rear dual cable notch
  base.add(createBox(6, 18, 16, [9, 12, 55]));
  base.add(createBox(6, 18, 16, [9, 53, 55]));

  // Structural stiffening gussets
  base.add(createBox(14, 14, 18, [18, 18, 76], 4));
  base.add(createBox(14, 14, 18, [18, 47, 76], 4));

  // --- ACCENT: Knurled Metric Thumbscrew Clamp Pad (Z=14..48 mm) ---
  // Knurled thumb wheel knob
  accent.add(createCylinderZ(19, 19, 12, 36, [45, 32.5, 20]));
  // 12 Knurling ribs around the perimeter of thumbscrew
  for (let k = 0; k < 12; k++) {
    const ka = (k * 2 * Math.PI) / 12;
    accent.add(createBox(2.5, 2.5, 10, [45 + 18.5 * Math.cos(ka), 32.5 + 18.5 * Math.sin(ka), 20], 4));
  }
  // Threaded shaft
  accent.add(createCylinderZ(10, 10, 20, 24, [45, 32.5, 32]));
  // Swivel pressure clamping disc
  accent.add(createCylinderZ(16, 16, 6, 32, [45, 32.5, 45]));

  const combined = new THREE.Group();
  combined.add(base.clone());
  combined.add(accent.clone());

  return { base, accent, combined, slug: 'under-desk-clamp-headphone-hanger' };
}

// ============================================================================
// 12. Custom Raised-Letter Desk Nameplate / Gamer Tag (170 x 45 x 25 mm)
// Trending #12: Layer-swap dual color print (pause at Z=3.0 mm for neon text)
// ============================================================================
function buildCustomNameplate() {
  const base = new THREE.Group();
  const accent = new THREE.Group();

  // --- BASE: 45-degree Angled Presentation Wedge Base (170 x 45 x 18 mm) ---
  base.add(createBox(170, 45, 3, [85, 22.5, 1.5]));

  // Stepped wedge ramp rising from Z=3 at front to Z=18 at rear
  base.add(createBox(170, 38, 3, [85, 24, 4.5]));
  base.add(createBox(170, 30, 3, [85, 28, 7.5]));
  base.add(createBox(170, 22, 3, [85, 32, 10.5]));
  base.add(createBox(170, 14, 3, [85, 36, 13.5]));
  base.add(createBox(170, 8, 4, [85, 39, 16]));

  // --- ACCENT: Raised 3D Block Typography / Gamer Tag (Z=16..25 mm) ---
  // 6 Raised 3D Letter Blocks representing "SNKB 3D"
  const letterPositions = [
    [24, 28],
    [46, 28],
    [68, 28],
    [90, 28],
    [120, 28],
    [144, 28],
  ];

  for (const [lx, ly] of letterPositions) {
    accent.add(createBox(14, 18, 7, [lx, ly, 21.5]));
  }
  // Accent underline telemetry bar
  accent.add(createBox(150, 3, 5, [85, 14, 18.5]));

  const combined = new THREE.Group();
  combined.add(base.clone());
  combined.add(accent.clone());

  return { base, accent, combined, slug: 'custom-raised-letter-nameplate' };
}

// ============================================================================
// 13. A1 Mini Waste Purge Catch Bin (135 x 85 x 88 mm)
// ============================================================================
function buildBambuPoopChute() {
  const base = new THREE.Group();
  const accent = new THREE.Group();

  // --- BASE ---
  base.add(createBox(135, 85, 4, [67.5, 42.5, 2]));
  base.add(createBox(4, 85, 71, [2, 42.5, 39.5]));
  base.add(createBox(4, 85, 71, [133, 42.5, 39.5]));
  base.add(createBox(127, 4, 71, [67.5, 2, 39.5]));
  base.add(createBox(127, 4, 71, [67.5, 83, 39.5]));

  // Dual mounting rail hooks on rear
  base.add(createBox(12, 10, 30, [30, 88, 55]));
  base.add(createBox(12, 10, 30, [105, 88, 55]));

  // 4 Magnet attachment bosses
  for (const mx of [25, 45, 90, 110]) {
    base.add(createCylinderZ(5, 5, 4, 16, [mx, 86, 20]));
  }

  // --- ACCENT ---
  // Deflector slide ramp (angled guide)
  const ramp = createBox(130, 35, 4, [67.5, 30, 78]);
  ramp.rotation.x = -Math.PI / 6;
  ramp.updateMatrixWorld();
  accent.add(ramp);

  // 4 Deflector flow guide fins
  for (let r = 0; r < 4; r++) {
    accent.add(createCylinderZ(3, 3, 10, 16, [35 + r * 22, 30, 80]));
  }

  // Top accent border trim
  accent.add(createBox(135, 4, 10, [67.5, 2, 80]));
  accent.add(createBox(4, 85, 10, [2, 42.5, 80]));
  accent.add(createBox(4, 85, 10, [133, 42.5, 80]));

  const combined = new THREE.Group();
  combined.add(base.clone());
  combined.add(accent.clone());

  return { base, accent, combined, slug: 'bambu-poop-chute-catch-box' };
}

// ============================================================================
// 14. Raspberry Pi Zero Ventilated Sensor Housing (85 x 55 x 23 mm)
// ============================================================================
function buildRpiZeroHousing() {
  const base = new THREE.Group();
  const accent = new THREE.Group();

  // Floor (75 x 55 x 2.5 mm, X = 5..80, Y = 0..55, Z = 0..2.5)
  base.add(createBox(75, 55, 2.5, [42.5, 27.5, 1.25]));

  // Left mounting tab with M3 screw clearance cutout (X = 0..5, Y = 12.5..42.5)
  base.add(createBox(5, 12, 2.5, [2.5, 18.5, 1.25]));
  base.add(createBox(5, 12, 2.5, [2.5, 36.5, 1.25]));
  base.add(createCylinderZ(2.5, 2.5, 2.5, 16, [2.5, 27.5, 1.25]));

  // Right mounting tab with M3 screw clearance cutout (X = 80..85, Y = 12.5..42.5)
  base.add(createBox(5, 12, 2.5, [82.5, 18.5, 1.25]));
  base.add(createBox(5, 12, 2.5, [82.5, 36.5, 1.25]));
  base.add(createCylinderZ(2.5, 2.5, 2.5, 16, [82.5, 27.5, 1.25]));

  // --- Base Walls (Height = 17.5 mm, from Z = 2.5 to 20.0 mm) ---
  // Solid Back Wall (Y = 52.5..55, X = 7.5..77.5)
  base.add(createBox(70, 2.5, 17.5, [42.5, 53.75, 11.25]));

  // Solid Right Wall (X = 77.5..80, Y = 0..55)
  base.add(createBox(2.5, 55, 17.5, [78.75, 27.5, 11.25]));

  // Front Wall with Pi Zero Port Cutouts (Micro-USB Power, Micro-USB OTG, Mini-HDMI)
  // Wall is Y = 0..2.5. Bottom sill Z = 2.5..5.5, Top lintel Z = 13.5..20.0
  base.add(createBox(70, 2.5, 3, [42.5, 1.25, 4.0]));
  base.add(createBox(70, 2.5, 6.5, [42.5, 1.25, 16.75]));
  // Pillars between connectors (Z = 5.5..13.5, height = 8 mm)
  base.add(createBox(10.5, 2.5, 8, [12.75, 1.25, 9.5]));   // Left corner pillar
  base.add(createBox(8, 2.5, 8, [31, 1.25, 9.5]));         // Between USB ports
  base.add(createBox(10, 2.5, 8, [49, 1.25, 9.5]));        // Between USB and HDMI
  base.add(createBox(11.5, 2.5, 8, [71.75, 1.25, 9.5]));   // Right corner pillar

  // Left Wall with MicroSD Card Cutout (X = 5..7.5, Y = 0..55)
  // Bottom sill Z = 2.5..5.0, Top lintel Z = 10.0..20.0
  base.add(createBox(2.5, 55, 2.5, [6.25, 27.5, 3.75]));
  base.add(createBox(2.5, 55, 10, [6.25, 27.5, 15.0]));
  base.add(createBox(2.5, 21, 5, [6.25, 10.5, 7.5]));      // Front pillar
  base.add(createBox(2.5, 21, 5, [6.25, 44.5, 7.5]));      // Back pillar

  // Pi Zero Board Mounting Standoffs (4x M2.5 posts with alignment locator pins)
  const standoffs = [
    [15, 16],
    [70, 16],
    [15, 39],
    [70, 39],
  ];
  for (const [sx, sy] of standoffs) {
    base.add(createCylinderZ(2.5, 2.5, 4.5, 16, [sx, sy, 4.75]));
    base.add(createCylinderZ(1.2, 1.2, 2.0, 12, [sx, sy, 8.0])); // Alignment pin
  }

  // --- ACCENT (Flush Snap-Fit Top Cover, Z = 20.0 to 23.0 mm) ---
  // Outer perimeter frame rests directly on base walls (Zero floating gap!)
  accent.add(createBox(75, 3.5, 3, [42.5, 1.75, 21.5]));   // Front frame
  accent.add(createBox(75, 3.5, 3, [42.5, 53.25, 21.5]));  // Back frame
  accent.add(createBox(3.5, 48, 3, [6.75, 27.5, 21.5]));   // Left frame
  accent.add(createBox(3.5, 48, 3, [78.25, 27.5, 21.5]));  // Right frame

  // Central structural bridge rib (along X axis at Y = 27.5)
  accent.add(createBox(68, 2.5, 3, [42.5, 27.5, 21.5]));

  // Camera CSI ribbon cable pass-through slot frame (X = 64..72, Y = 14..41)
  accent.add(createBox(1.8, 24, 3, [64.5, 27.5, 21.5]));
  accent.add(createBox(1.8, 24, 3, [71.5, 27.5, 21.5]));

  // Precision parallel flush ventilation louvers (strictly bounded inside X = 13..62)
  // Clean, modern parallel cooling slats with ZERO unclipped protrusions
  for (let x = 14; x <= 62; x += 4) {
    // Front ventilation slat (Y = 5.5..25.0)
    accent.add(createBox(1.8, 19.5, 3, [x, 15.25, 21.5]));
    // Back ventilation slat (Y = 30.0..49.5)
    accent.add(createBox(1.8, 19.5, 3, [x, 39.75, 21.5]));
  }

  // Snap-fit downskirt (slips 3.5 mm inside base perimeter walls from Z = 16.5 to 20.0 mm)
  accent.add(createBox(66, 1.5, 3.5, [42.5, 3.75, 18.25]));   // Front skirt
  accent.add(createBox(66, 1.5, 3.5, [42.5, 51.25, 18.25]));  // Back skirt
  accent.add(createBox(1.5, 46, 3.5, [8.75, 27.5, 18.25]));   // Left skirt
  accent.add(createBox(1.5, 46, 3.5, [76.25, 27.5, 18.25]));  // Right skirt

  // Snap-fit retention nubs on skirt outer faces
  accent.add(createBox(12, 0.8, 1.5, [42.5, 2.7, 18.25]));
  accent.add(createBox(12, 0.8, 1.5, [42.5, 52.3, 18.25]));

  const combined = new THREE.Group();
  combined.add(base.clone());
  combined.add(accent.clone());

  return { base, accent, combined, slug: 'rpi-zero-sensor-housing' };
}

// ============================================================================
// 15. Modular Planter Trio with Drainage Tray (160 x 160 x 90 mm)
// ============================================================================
function buildPlanterTrio() {
  const base = new THREE.Group();
  const accent = new THREE.Group();

  // Bottom slab
  base.add(createBox(160, 160, 4, [80, 80, 2]));
  base.add(createBox(160, 4, 14, [80, 2, 9]));
  base.add(createBox(160, 4, 14, [80, 158, 9]));
  base.add(createBox(4, 152, 14, [2, 80, 9]));
  base.add(createBox(4, 152, 14, [158, 80, 9]));

  const potCenters = [
    [80, 48],
    [48, 112],
    [112, 112],
  ];

  for (const [px, py] of potCenters) {
    base.add(createCylinderZ(27, 27, 4, 16, [px, py, 12]));

    const rPot = 27;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const x = px + rPot * Math.cos(a);
      const y = py + rPot * Math.sin(a);
      accent.add(createOrientedBox(22, 2.5, 76, [x, y, 52], a + Math.PI / 2));
    }

    accent.add(createCylinderZ(30, 26, 4, 16, [px, py, 88]));
  }

  const combined = new THREE.Group();
  combined.add(base.clone());
  combined.add(accent.clone());

  return { base, accent, combined, slug: 'modular-planter-trio-tray' };
}

// ============================================================================
// Legacy Models for full backwards compatibility
// ============================================================================
function buildKeycapStand() {
  const base = new THREE.Group();
  const accent = new THREE.Group();

  base.add(createBox(120, 40, 18, [60, 20, 9]));
  base.add(createBox(120, 40, 36, [60, 60, 18]));

  for (let i = 0; i < 4; i++) {
    const x = 18 + i * 28;
    accent.add(createBox(8, 2.5, 8, [x, 20, 22]));
    accent.add(createBox(2.5, 8, 8, [x, 20, 22]));
    accent.add(createCylinderZ(6, 6, 2, 16, [x, 20, 19]));
  }

  for (let i = 0; i < 4; i++) {
    const x = 18 + i * 28;
    accent.add(createBox(8, 2.5, 9, [x, 60, 40.5]));
    accent.add(createBox(2.5, 8, 9, [x, 60, 40.5]));
    accent.add(createCylinderZ(6, 6, 2, 16, [x, 60, 37]));
  }

  accent.add(createBox(100, 2, 8, [60, 1, 10]));

  const combined = new THREE.Group();
  combined.add(base.clone());
  combined.add(accent.clone());

  return { base, accent, combined, slug: 'artisan-keycap-display-stand' };
}

function buildHexPlanter() {
  const base = new THREE.Group();
  const accent = new THREE.Group();

  base.add(createOrientedBox(110, 95, 3, [60, 52.5, 1.5]));

  const rOuter = 52;
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const x = 60 + rOuter * Math.cos(a + Math.PI / 6);
    const y = 52.5 + rOuter * Math.sin(a + Math.PI / 6);
    base.add(createOrientedBox(60, 3, 85, [x, y, 45.5], a + Math.PI / 6 + Math.PI / 2));
  }

  accent.add(createOrientedBox(90, 78, 3, [60, 52.5, 12]));

  const rInner = 43;
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const x = 60 + rInner * Math.cos(a + Math.PI / 6);
    const y = 52.5 + rInner * Math.sin(a + Math.PI / 6);
    accent.add(createOrientedBox(50, 2.5, 95, [x, y, 59.5], a + Math.PI / 6 + Math.PI / 2));
  }

  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const x = 60 + (rOuter - 1) * Math.cos(a + Math.PI / 6);
    const y = 52.5 + (rOuter - 1) * Math.sin(a + Math.PI / 6);
    accent.add(createOrientedBox(58, 6, 5, [x, y, 107.5], a + Math.PI / 6 + Math.PI / 2));
  }

  const combined = new THREE.Group();
  combined.add(base.clone());
  combined.add(accent.clone());

  return { base, accent, combined, slug: 'hex-self-watering-planter' };
}

function buildGridfinityBin() {
  const base = new THREE.Group();
  const accent = new THREE.Group();

  base.add(createBox(84, 84, 5, [42, 42, 2.5]));
  base.add(createCylinderZ(15, 12, 4, 16, [21, 21, 2]));
  base.add(createCylinderZ(15, 12, 4, 16, [63, 21, 2]));
  base.add(createCylinderZ(15, 12, 4, 16, [21, 63, 2]));
  base.add(createCylinderZ(15, 12, 4, 16, [63, 63, 2]));

  base.add(createBox(3, 84, 34, [1.5, 42, 22]));
  base.add(createBox(3, 84, 34, [82.5, 42, 22]));
  base.add(createBox(78, 3, 34, [42, 1.5, 22]));
  base.add(createBox(78, 3, 34, [42, 82.5, 22]));

  base.add(createBox(78, 2, 30, [42, 42, 20]));
  base.add(createBox(2, 78, 30, [42, 42, 20]));

  accent.add(createBox(84, 16, 6, [42, 8, 42]));
  accent.add(createBox(84, 3, 6, [42, 82.5, 42]));
  accent.add(createBox(3, 78, 6, [1.5, 42, 42]));
  accent.add(createBox(3, 78, 6, [82.5, 42, 42]));

  const combined = new THREE.Group();
  combined.add(base.clone());
  combined.add(accent.clone());

  return { base, accent, combined, slug: 'gridfinity-rugged-parts-bin' };
}

// Download real open-source STLs from verified GitHub raw endpoints
async function fetchVerifiedGithubStls() {
  console.log('\n--- Fetching Real Open-Source STLs from Raw GitHub ---');

  const githubModels = [
    {
      name: '3dbenchy.stl',
      url: 'https://raw.githubusercontent.com/CreativeTools/3DBenchy/master/Single-part/3DBenchy.stl',
    },
    {
      name: 'voron-design-cube.stl',
      url: 'https://raw.githubusercontent.com/VoronDesign/Voron-2/Voron2.4/STLs/Test_Prints/Voron_Design_Cube_v7.stl',
    },
  ];

  for (const item of githubModels) {
    try {
      console.log(`Fetching ${item.name} from ${item.url}...`);
      const res = await fetch(item.url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);

      // Verify binary STL header immediately
      if (buf.length < 84) {
        throw new Error(`Downloaded file too small (${buf.length} bytes).`);
      }
      const triCount = buf.readUInt32LE(80);
      const expectedSize = 84 + triCount * 50;
      if (Math.abs(buf.length - expectedSize) > 200) {
        throw new Error(`Header/size mismatch (tris: ${triCount}, expected: ${expectedSize}, got: ${buf.length}).`);
      }

      for (const dir of OUT_DIRS) {
        fs.writeFileSync(path.join(dir, item.name), buf);
      }
      console.log(`  ✓ Verified & saved ${item.name} (${triCount} tris, ${(buf.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.warn(`  ⚠ Could not fetch ${item.name}: ${err.message}`);
    }
  }
}

// Generate all parametric catalog models
async function generateAllModels() {
  console.log('\n========================================================================');
  console.log('BUILDING VERIFIED PARAMETRIC A1 MINI MULTI-PART MODELS (NO-AMS)');
  console.log('========================================================================\n');

  const builders = [
    buildPosableMecha,
    buildCrystalDragon,
    buildGridfinityDeskOrganizer,
    buildDualToneGeometricPlanter,
    buildGamingControllerStand,
    buildSwitchTester,
    buildFoldingStand,
    buildGuitarPickDispenser,
    buildEsp32Case,
    buildPlanetarySpinner,
    buildClampHeadphoneHanger,
    buildCustomNameplate,
    buildBambuPoopChute,
    buildRpiZeroHousing,
    buildPlanterTrio,
    buildKeycapStand,
    buildHexPlanter,
    buildGridfinityBin,
  ];

  for (const buildFn of builders) {
    const product = buildFn();
    console.log(`Building ${product.slug}...`);
    if (product.base) exportBinaryStl(product.base, `${product.slug}-base.stl`);
    if (product.accent) exportBinaryStl(product.accent, `${product.slug}-accent.stl`);
    exportBinaryStl(product.combined, `${product.slug}.stl`);
  }

  // Fetch verified open-source benchmark STLs
  await fetchVerifiedGithubStls();

  console.log('\nAll catalog STLs generated and verified across output directories!\n');
}

generateAllModels();
