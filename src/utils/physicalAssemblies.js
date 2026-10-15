/**
 * src/utils/physicalAssemblies.js
 *
 * Real, recognizable multi-component physical objects for explode view.
 * Every assembly is a THREE.Group of discrete NAMED meshes (no flat plane
 * cuts — each part is modeled as genuine physical geometry), rendered with
 * photorealistic PBR materials (MeshPhysicalMaterial, satin roughness 0.28,
 * clearcoat 0.2) plus a procedural FDM layer-line bump texture.
 *
 * All builders construct in PRINT SPACE (+Z up, millimeters) so assemblies
 * drop straight into the slicer pipeline (print-to-scene quaternion,
 * seating, support pillars, cross-section) with zero conversion.
 *
 * Each builder returns:
 *   { group, parts: string[], dims: {x,y,z}, volumeMm3, surfaceAreaMm2 }
 * where group.userData is an explode controller compatible with
 * updateExplodableGroup-style animation ({ update(t), setColors(), childMeshes }).
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Studio material lab
// ---------------------------------------------------------------------------

let cachedBumpTexture = null;
let cachedPeiTexture = null;

/**
 * Photorealistic procedural FDM layer-line bump texture:
 * Combines 0.20mm horizontal layer ridges with subtle polymer micro-grain noise.
 * Bakes on an offscreen 2D canvas and repeats across the mesh surface so glancing
 * studio light catches genuine 3D printed layer texture.
 * Returns null outside a DOM environment (SSR / unit tests).
 */
export function createFDMLayerBumpTexture() {
  if (cachedBumpTexture) return cachedBumpTexture;
  if (typeof document === 'undefined') return null;
  try {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;

    for (let y = 0; y < size; y++) {
      // 0.20mm layer line wave profile (sinusoidal ridge curve with bead peak)
      const layerCycle = (y % 4) / 4;
      const ridgeVal = Math.sin(layerCycle * Math.PI) * 28;

      for (let x = 0; x < size; x++) {
        // Micro-polymer surface grain (subtle pseudo-random noise)
        const noise = (Math.random() - 0.5) * 14;
        const base = 128 + ridgeVal + noise;
        const clamped = Math.max(0, Math.min(255, Math.round(base)));

        const idx = (y * size + x) * 4;
        data[idx] = clamped;
        data[idx + 1] = clamped;
        data[idx + 2] = clamped;
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(28, 28);
    cachedBumpTexture = tex;
    return tex;
  } catch (_) {
    return null;
  }
}

/**
 * Textured PEI powder-coated spring steel plate bump texture:
 * Fine golden-bronze/black micro-grain stipple texture.
 */
export function createPEIBumpTexture() {
  if (cachedPeiTexture) return cachedPeiTexture;
  if (typeof document === 'undefined') return null;
  try {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;

    for (let i = 0; i < size * size; i++) {
      const grain = 128 + Math.round((Math.random() - 0.5) * 55);
      const idx = i * 4;
      data[idx] = grain;
      data[idx + 1] = grain;
      data[idx + 2] = grain;
      data[idx + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(12, 12);
    cachedPeiTexture = tex;
    return tex;
  } catch (_) {
    return null;
  }
}

/**
 * Photorealistic satin filament material shared by every physical part.
 */
export function physicalFilamentMaterial(hex, opts = {}) {
  const bump = createFDMLayerBumpTexture();
  const params = {
    color: new THREE.Color(hex),
    roughness: opts.roughness ?? 0.28,
    metalness: opts.metalness ?? 0.06,
    clearcoat: opts.clearcoat ?? 0.10,
    clearcoatRoughness: opts.clearcoatRoughness ?? 0.38,
    bumpScale: opts.bumpScale ?? 0.02,
    emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? (opts.emissive ? 1.2 : 0),
  };
  if (bump) params.bumpMap = bump;
  return new THREE.MeshPhysicalMaterial(params);
}

// ---------------------------------------------------------------------------
// Geometry helpers (all pieces baked in print space, +Z up, millimeters)
// ---------------------------------------------------------------------------

function xform(geo, { p = [0, 0, 0], r = [0, 0, 0] } = {}) {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r[0], r[1], r[2]));
  m.setPosition(p[0], p[1], p[2]);
  geo.applyMatrix4(m);
  return geo;
}

function box(w, h, d, x = 0, y = 0, z = 0, round = 0.8) {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(round, Math.min(w, h, d) / 2.01));
  return xform(g, { p: [x, y, z] });
}

function cylZ(rTop, rBottom, h, x = 0, y = 0, z = 0, seg = 24) {
  // Cylinder axis is +Y by default; rotate to print-space +Z.
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg);
  return xform(g, { p: [x, y, z], r: [Math.PI / 2, 0, 0] });
}

function sphere(r, x = 0, y = 0, z = 0, wSeg = 20, hSeg = 14) {
  const g = new THREE.SphereGeometry(r, wSeg, hSeg);
  return xform(g, { p: [x, y, z] });
}

/** Flat spur-gear blank in the XY plane, extruded along +Z, with bore hole. */
function gearGeometry(teeth, outerR, rootR, thickness, boreR = 0, boreSides = 6) {
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [
      [a, rootR],
      [a + step * 0.28, rootR],
      [a + step * 0.38, outerR],
      [a + step * 0.62, outerR],
      [a + step * 0.72, rootR],
    ];
    pts.forEach(([ang, r], j) => {
      const px = Math.cos(ang) * r;
      const py = Math.sin(ang) * r;
      if (i === 0 && j === 0) shape.moveTo(px, py);
      else shape.lineTo(px, py);
    });
  }
  shape.closePath();
  if (boreR > 0) {
    const hole = new THREE.Path();
    for (let i = 0; i < boreSides; i++) {
      const a = (i / boreSides) * Math.PI * 2;
      const px = Math.cos(a) * boreR;
      const py = Math.sin(a) * boreR;
      if (i === 0) hole.moveTo(px, py);
      else hole.lineTo(px, py);
    }
    hole.closePath();
    shape.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.6,
    bevelSize: 0.6,
    bevelSegments: 1,
    curveSegments: 5,
  });
  g.translate(0, 0, -thickness / 2);
  return g;
}

/** Annulus (flat ring) extruded along +Z. */
function ringGeometry(outerR, innerR, thickness) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.8,
    bevelSize: 0.8,
    bevelSegments: 1,
    curveSegments: 48,
  });
  g.translate(0, 0, -thickness / 2);
  return g;
}

/** Merge part pieces into one non-indexed geometry (mixed primitive soup). */
function mergeParts(pieces) {
  const list = pieces.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(list, false);
  list.forEach((g) => {
    if (g.dispose) { /* keep source geos alive for caller reuse */ }
  });
  if (!merged) throw new Error('mergeGeometries failed: incompatible attributes');
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** Signed-tetrahedron volume + surface area over a positions array. */
function geometryMetrics(geometry) {
  const arr = geometry.getAttribute('position').array;
  let signedVol = 0;
  let area = 0;
  const abx = [0, 0, 0];
  for (let i = 0; i < arr.length; i += 9) {
    const ax = arr[i]; const ay = arr[i + 1]; const az = arr[i + 2];
    const bx = arr[i + 3]; const by = arr[i + 4]; const bz = arr[i + 5];
    const cx = arr[i + 6]; const cy = arr[i + 7]; const cz = arr[i + 8];
    signedVol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    const ux = bx - ax; const uy = by - ay; const uz = bz - az;
    const vx = cx - ax; const vy = cy - ay; const vz = cz - az;
    abx[0] = uy * vz - uz * vy;
    abx[1] = uz * vx - ux * vz;
    abx[2] = ux * vy - uy * vx;
    area += Math.sqrt(abx[0] * abx[0] + abx[1] * abx[1] + abx[2] * abx[2]) / 2;
  }
  return { volumeMm3: Math.abs(signedVol) / 6, surfaceAreaMm2: area };
}

// ---------------------------------------------------------------------------
// Assembly controller (drop-in explode animation, guides included)
// ---------------------------------------------------------------------------

function makeAssemblyController(group, partEntries, designKey) {
  const childMeshes = [];
  const linePoints = [];
  const center = new THREE.Vector3();
  partEntries.forEach((p) => {
    const c = new THREE.Box3().setFromObject(p.mesh).getCenter(new THREE.Vector3());
    p.center = c;
    center.add(c);
  });
  if (partEntries.length > 0) center.multiplyScalar(1 / partEntries.length);

  partEntries.forEach((p, idx) => {
    p.mesh.userData.isExplodablePart = true;
    p.mesh.userData.partIndex = idx;
    p.mesh.userData.partName = p.name;
    p.mesh.userData.homePos = new THREE.Vector3(0, 0, 0);
    p.mesh.userData.explodeVector = p.explode.clone();
    p.mesh.userData.center = p.center.clone();
    p.mesh.userData.spin = p.spin || 0;
    childMeshes.push(p.mesh);
    if (p.explode.lengthSq() > 0.001) {
      linePoints.push(center.x, center.y, center.z);
      linePoints.push(p.center.x, p.center.y, p.center.z);
    }
  });

  let dashed = null;
  if (linePoints.length > 0) {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));
    dashed = new THREE.LineSegments(
      lg,
      new THREE.LineDashedMaterial({ color: 0xff6500, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.85, depthWrite: false })
    );
    dashed.computeLineDistances();
    dashed.visible = false;
    group.add(dashed);
  }

  group.userData.isExplodableAssembly = true;
  group.userData.isProceduralAssembly = true;
  group.userData.designKey = designKey;
  group.userData.partNames = partEntries.map((p) => p.name);
  group.userData.childMeshes = childMeshes;
  group.userData.dashedLineSegments = dashed;
  group.userData.currentExplode = 0;
  group.userData.targetExplode = 0;
  group.userData.setColors = () => {
    // Physical filaments keep their factory colors; spool preview re-tints
    // only through the quote form, never by repainting real parts.
  };
  group.userData.update = function (explodeTarget, lerpSpeed = 0.12) {
    this.targetExplode = Math.max(0, Math.min(1, explodeTarget));
    this.currentExplode += (this.targetExplode - this.currentExplode) * lerpSpeed;
    const t = this.currentExplode;
    childMeshes.forEach((mesh) => {
      mesh.position.copy(mesh.userData.explodeVector).multiplyScalar(t);
      if (mesh.userData.spin) mesh.rotation.z = t * mesh.userData.spin;
    });
    if (dashed) {
      dashed.visible = t > 0.04;
      if (dashed.visible) {
        const attr = dashed.geometry.attributes.position;
        let pi = 0;
        childMeshes.forEach((mesh) => {
          if (mesh.userData.explodeVector.lengthSq() > 0.001) {
            const c = mesh.userData.center;
            attr.setXYZ(pi * 2, center.x, center.y, center.z);
            attr.setXYZ(pi * 2 + 1, c.x + mesh.position.x, c.y + mesh.position.y, c.z + mesh.position.z);
            pi++;
          }
        });
        attr.needsUpdate = true;
        dashed.computeLineDistances();
      }
    }
  };
  return group;
}

function finishAssembly(group, partEntries, designKey) {
  partEntries.forEach((p) => group.add(p.mesh));
  makeAssemblyController(group, partEntries, designKey);
  // Merged analysis geometry (volume / surface / overhang math).
  const merged = mergeParts(partEntries.flatMap((p) => p.geos));
  const { volumeMm3, surfaceAreaMm2 } = geometryMetrics(merged);
  merged.computeBoundingBox();
  const bb = merged.boundingBox;
  return {
    group,
    parts: partEntries.map((p) => p.name),
    dims: {
      x: Number((bb.max.x - bb.min.x).toFixed(2)),
      y: Number((bb.max.y - bb.min.y).toFixed(2)),
      z: Number((bb.max.z - bb.min.z).toFixed(2)),
    },
    volumeMm3: Math.round(volumeMm3),
    surfaceAreaMm2: Math.round(surfaceAreaMm2),
    mergedGeometry: merged,
  };
}

function makePart(name, geos, material, explode) {
  const merged = mergeParts(geos);
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = `part:${name}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { name, mesh, geos: [merged], explode: explode.clone(), material };
}

// ---------------------------------------------------------------------------
// 1. Posable Snap-Fit Mecha (5 physical parts)
// ---------------------------------------------------------------------------

const CHARCOAL = '#23262c';
const BAMBU_ORANGE = '#FF6500';
const TITANIUM = '#9aa3b2';
const VISOR_GREEN = '#00FF66';

export function buildMechaAssembly() {
  const group = new THREE.Group();
  group.name = 'ProceduralMechaAssembly';
  const parts = [];

  // Part 1 — Inner skeleton frame (matte charcoal)
  const skelMat = physicalFilamentMaterial(CHARCOAL, { roughness: 0.5, metalness: 0.25 });
  const skel = [
    box(30, 18, 12, 0, 0, 30),            // pelvis block
    cylZ(7, 7, 34, 0, 0, 55),             // torso spine core
    box(26, 16, 10, 0, 0, 74),            // neck deck
    sphere(9, -24, 0, 64),                // L shoulder ball joint
    sphere(9, 24, 0, 64),                 // R shoulder ball joint
    sphere(8, -11, 0, 28),                // L hip joint
    sphere(8, 11, 0, 28),                 // R hip joint
    cylZ(4.5, 4.5, 26, -28, 0, 44),       // L arm core
    cylZ(4.5, 4.5, 26, 28, 0, 44),        // R arm core
    cylZ(5.5, 5.5, 26, -11, 0, 12),       // L leg core
    cylZ(5.5, 5.5, 26, 11, 0, 12),        // R leg core
  ];
  parts.push({ ...makePart('Inner Ball-Joint Skeleton', skel, skelMat, new THREE.Vector3(0, 0, 0)) });

  // Part 2 — Chest & back armor shell (Bambu orange), slides forward/up
  const armorMat = physicalFilamentMaterial(BAMBU_ORANGE);
  const chest = [
    box(38, 12, 26, 0, 9, 58, 2.5),       // faceted chest plate
    box(28, 14, 22, 0, -13, 56, 2.5),     // dorsal thruster pack
    cylZ(5, 6.5, 10, -8, -14, 42),        // thruster nozzle L
    cylZ(5, 6.5, 10, 8, -14, 42),         // thruster nozzle R
  ];
  parts.push({ ...makePart('Chest & Back Armor Shell', chest, armorMat, new THREE.Vector3(0, 26, 14)) });

  // Parts 3 & 4 — Pauldrons + gauntlets, explode along ±X
  const pauldronL = [
    box(22, 20, 9, -30, 0, 66, 3),        // L shoulder shield
    cylZ(7, 7, 20, -28, 0, 44),           // L forearm guard
  ];
  parts.push({ ...makePart('Left Pauldron + Gauntlet', pauldronL, armorMat, new THREE.Vector3(-32, 0, 10)) });
  const pauldronR = [
    box(22, 20, 9, 30, 0, 66, 3),         // R shoulder shield
    cylZ(7, 7, 20, 28, 0, 44),            // R forearm guard
  ];
  parts.push({ ...makePart('Right Pauldron + Gauntlet', pauldronR, armorMat, new THREE.Vector3(32, 0, 10)) });

  // Part 5 — Head + visor unit, lifts along +Y(print +Z)
  const headMat = physicalFilamentMaterial(TITANIUM, { roughness: 0.3, metalness: 0.65 });
  const visorMat = physicalFilamentMaterial(VISOR_GREEN, { roughness: 0.2, metalness: 0.1, emissive: VISOR_GREEN, emissiveIntensity: 1.4 });
  const headGeos = [box(17, 17, 17, 0, 0, 90, 2), cylZ(2, 2, 10, 8, -4, 100)];
  const headPart = makePart('Mecha Head Unit', headGeos, headMat, new THREE.Vector3(0, 0, 50));
  const visor = new THREE.Mesh(box(14, 3, 5, 0, 9, 91, 1), visorMat);
  visor.castShadow = true;
  // Visor rides with the head: parent it so one part entry moves both.
  const headGroup = new THREE.Group();
  headGroup.add(headPart.mesh, visor);
  const headEntry = { name: headPart.name, mesh: headGroup, geos: [...headPart.geos, visor.geometry], explode: headPart.explode, material: headMat };
  parts.push(headEntry);

  return finishAssembly(group, parts, 'mecha');
}

// ---------------------------------------------------------------------------
// 2. ESP32 snap enclosure (tub + PCB + vented lid)
// ---------------------------------------------------------------------------

const MATTE_BLACK = '#22252a';
const PCB_GREEN = '#0e6b3c';
const SILVER = '#c7ccd6';
const GOLD = '#d9a441';

export function buildEnclosureAssembly() {
  const group = new THREE.Group();
  group.name = 'ProceduralEnclosureAssembly';
  const parts = [];
  const W = 92, D = 62, WALL = 4, FLOOR = 4, H = 30;

  // Part 1 — Bottom tub: floor + 4 walls + standoffs + USB-C slot illusion
  const tubMat = physicalFilamentMaterial(MATTE_BLACK, { roughness: 0.45, metalness: 0.2 });
  const tub = [
    box(W, D, FLOOR, 0, 0, FLOOR / 2, 1),                                   // floor
    box(W, WALL, H, 0, D / 2 - WALL / 2, FLOOR + H / 2, 1),                 // front wall
    box(W, WALL, H, 0, -D / 2 + WALL / 2, FLOOR + H / 2, 1),                // back wall
    box(WALL, D - 2 * WALL, H, -W / 2 + WALL / 2, 0, FLOOR + H / 2, 1),     // left wall
    box(WALL, D - 2 * WALL, H, W / 2 - WALL / 2, 0, FLOOR + H / 2, 1),      // right wall
  ];
  [-1, 1].forEach((sx) => [-1, 1].forEach((sy) => {
    tub.push(cylZ(2.6, 2.6, 12, sx * 36, sy * 22, FLOOR + 6));             // M3 standoffs
  }));
  const tubPart = makePart('Bottom Enclosure Tub', tub, tubMat, new THREE.Vector3(0, 0, 0));
  // USB-C port slot: dark inset plate on the front wall (reads as a cutout)
  const slotMat = physicalFilamentMaterial('#0a0b0d', { roughness: 0.7, metalness: 0.1 });
  const slot = new THREE.Mesh(box(14, 2, 6, 20, D / 2 - 1, 12, 0.5), slotMat);
  const tubGroup = new THREE.Group();
  tubGroup.add(tubPart.mesh, slot);
  parts.push({ name: tubPart.name, mesh: tubGroup, geos: tubPart.geos, explode: tubPart.explode, material: tubMat });

  // Part 2 — ESP32 dev board: emerald PCB + silver shield + gold pins + chip
  const pcbMat = physicalFilamentMaterial(PCB_GREEN, { roughness: 0.5, metalness: 0.15 });
  const pcb = [box(76, 48, 2, 0, 0, 17, 0.5)];
  const pcbPart = makePart('ESP32 Dev Board', pcb, pcbMat, new THREE.Vector3(0, 0, 28));
  const shield = new THREE.Mesh(box(22, 22, 4, -18, -8, 20, 0.5), physicalFilamentMaterial(SILVER, { roughness: 0.25, metalness: 0.85 }));
  shield.castShadow = true;
  const chip = new THREE.Mesh(box(12, 12, 2.5, 14, 6, 19.2, 0.5), physicalFilamentMaterial('#101216', { roughness: 0.4, metalness: 0.3 }));
  chip.castShadow = true;
  const pinMat = physicalFilamentMaterial(GOLD, { roughness: 0.3, metalness: 0.9 });
  const pins = [];
  for (let i = 0; i < 6; i++) {
    pins.push(cylZ(1.1, 1.1, 5, -30 + i * 6, 21, 19.5, 8));
  }
  const pinMesh = new THREE.Mesh(mergeParts(pins), pinMat);
  pinMesh.castShadow = true;
  const pcbGroup = new THREE.Group();
  pcbGroup.add(pcbPart.mesh, shield, chip, pinMesh);
  parts.push({ name: pcbPart.name, mesh: pcbGroup, geos: [...pcbPart.geos, shield.geometry, chip.geometry, pinMesh.geometry], explode: pcbPart.explode, material: pcbMat });

  // Part 3 — Vented snap lid: plate + rim + slots + corner bosses
  const lidMat = physicalFilamentMaterial(BAMBU_ORANGE);
  const lid = [
    box(W, D, 4, 0, 0, 34, 1),                                            // lid plate
    box(W - 8, D - 8, 3, 0, 0, 31, 1),                                     // chamfered inner rim
  ];
  [-1, 1].forEach((sx) => [-1, 1].forEach((sy) => {
    lid.push(cylZ(4, 4, 3, sx * 38, sy * 24, 35.5));                       // counter-bored bosses
  }));
  const lidPart = makePart('Snap-Fit Vented Top Cover', lid, lidMat, new THREE.Vector3(0, 0, 58));
  const ventMat = physicalFilamentMaterial('#0a0b0d', { roughness: 0.7, metalness: 0.1 });
  const vents = [];
  for (let i = 0; i < 5; i++) {
    vents.push(box(56, 3, 1.5, 0, -16 + i * 8, 36.2, 0.4));                // vent slots
  }
  const ventMesh = new THREE.Mesh(mergeParts(vents), ventMat);
  const lidGroup = new THREE.Group();
  lidGroup.add(lidPart.mesh, ventMesh);
  parts.push({ name: lidPart.name, mesh: lidGroup, geos: [...lidPart.geos, ventMesh.geometry], explode: lidPart.explode, material: lidMat });

  return finishAssembly(group, parts, 'esp32');
}

// ---------------------------------------------------------------------------
// 3. Planetary gear actuator (ring + sun + 3 planets + carrier)
// ---------------------------------------------------------------------------

export function buildPlanetaryAssembly() {
  const group = new THREE.Group();
  group.name = 'ProceduralPlanetaryAssembly';
  const parts = [];
  const steelMat = physicalFilamentMaterial('#3a3f47', { roughness: 0.35, metalness: 0.7 });
  const brassMat = physicalFilamentMaterial('#c98f2e', { roughness: 0.3, metalness: 0.85 });

  // Part 1 — Outer ring gear housing (annulus + internal teeth)
  const ringPieces = [ringGeometry(35, 26, 14)];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ringPieces.push(box(4, 4, 12, Math.cos(a) * 24, Math.sin(a) * 24, 0, 0.5));
  }
  const ringGeo = mergeParts(ringPieces.map((g) => xform(g, { p: [0, 0, 7] })));
  const ringMesh = new THREE.Mesh(ringGeo, steelMat);
  ringMesh.name = 'part:Outer Ring Gear Housing';
  ringMesh.castShadow = true;
  ringMesh.receiveShadow = true;
  parts.push({ name: 'Outer Ring Gear Housing', mesh: ringMesh, geos: [ringGeo], explode: new THREE.Vector3(0, 0, 0), material: steelMat });

  // Part 2 — Central sun gear with hex bore, lifts along +Z
  const sunGeo = mergeParts([xform(gearGeometry(12, 12, 9.5, 11, 4, 6), { p: [0, 0, 7.5] })]);
  const sunMesh = new THREE.Mesh(sunGeo, brassMat);
  sunMesh.name = 'part:Central Sun Gear';
  sunMesh.castShadow = true;
  sunMesh.receiveShadow = true;
  parts.push({ name: 'Central Sun Gear (Hex Bore)', mesh: sunMesh, geos: [sunGeo], explode: new THREE.Vector3(0, 0, 34), material: brassMat });

  // Parts 3–5 — Orbiting planet gears: radial burst at 120° + spin
  const orbitR = 19;
  [90, 210, 330].forEach((deg, i) => {
    const a = (deg * Math.PI) / 180;
    const px = Math.cos(a) * orbitR;
    const py = Math.sin(a) * orbitR;
    const pg = mergeParts([xform(gearGeometry(9, 7.5, 5.8, 9, 2.2, 6), { p: [px, py, 6.5] })]);
    const pm = new THREE.Mesh(pg, steelMat);
    pm.name = `part:Planet Gear ${i + 1}`;
    pm.castShadow = true;
    pm.receiveShadow = true;
    const dir = new THREE.Vector3(px, py, 0).normalize();
    parts.push({
      name: `Planet Gear ${i + 1}`,
      mesh: pm,
      geos: [pg],
      explode: new THREE.Vector3(dir.x * 26, dir.y * 26, 8),
      material: steelMat,
      spin: (i % 2 === 0 ? 1 : -1) * 2.2,
    });
  });

  // Part 6 — Top carrier retainer plate with pins, highest lift
  const carrierPieces = [xform(ringGeometry(17, 3, 3), { p: [0, 0, 19.5] })];
  [90, 210, 330].forEach((deg) => {
    const a = (deg * Math.PI) / 180;
    carrierPieces.push(cylZ(2.4, 2.4, 8, Math.cos(a) * orbitR, Math.sin(a) * orbitR, 14));
  });
  const carrierGeo = mergeParts(carrierPieces);
  const carrierMesh = new THREE.Mesh(carrierGeo, brassMat);
  carrierMesh.name = 'part:Top Carrier Retainer Plate';
  carrierMesh.castShadow = true;
  carrierMesh.receiveShadow = true;
  parts.push({ name: 'Top Carrier Retainer Plate', mesh: carrierMesh, geos: [carrierGeo], explode: new THREE.Vector3(0, 0, 60), material: brassMat });

  return finishAssembly(group, parts, 'planetary');
}

// ---------------------------------------------------------------------------
// 4. Keycap switch tester dock (base + switches + keycaps)
// ---------------------------------------------------------------------------

const KEYCAP_COLORS = ['#FF6500', '#00FF66', '#00E5FF', '#F3F4F6'];

export function buildKeycapTesterAssembly() {
  const group = new THREE.Group();
  group.name = 'ProceduralKeycapTesterAssembly';
  const parts = [];
  const frameMat = physicalFilamentMaterial('#2b2f36', { roughness: 0.4, metalness: 0.35 });

  // Part 1 — Angled CNC-style base frame with 4 switch wells
  const base = [
    box(96, 64, 12, 0, 0, 6, 1.5),                                        // deck
    box(96, 10, 8, 0, -32, 12, 1),                                        // raised rear lip (angled read)
    box(96, 6, 4, 0, 32, 8, 1),                                           // front chamfer strip
  ];
  const wellMat = physicalFilamentMaterial('#0a0b0d', { roughness: 0.7, metalness: 0.1 });
  const wells = [];
  const slots = [[-14, -10], [14, -10], [-14, 14], [14, 14]];
  slots.forEach(([sx, sy]) => {
    wells.push(box(22, 22, 3, sx, sy, 12.5, 0.5));                        // dark wells
  });
  const basePart = makePart('Angled CNC-Style Base Frame', base, frameMat, new THREE.Vector3(0, 0, 0));
  const wellMesh = new THREE.Mesh(mergeParts(wells), wellMat);
  const baseGroup = new THREE.Group();
  baseGroup.add(basePart.mesh, wellMesh);
  parts.push({ name: basePart.name, mesh: baseGroup, geos: [...basePart.geos, wellMesh.geometry], explode: basePart.explode, material: frameMat });

  // Part 2 — 4 switch housings + cross-stems (lifts halfway)
  const housingMat = physicalFilamentMaterial('#d7dbe2', { roughness: 0.35, metalness: 0.1 });
  const housings = [];
  slots.forEach(([sx, sy]) => {
    housings.push(box(18, 18, 10, sx, sy, 18, 1));                        // housing
    housings.push(box(9, 3, 7, sx, sy, 24, 0.4));                         // cross-stem X
    housings.push(box(3, 9, 7, sx, sy, 24, 0.4));                         // cross-stem +
  });
  parts.push({ ...makePart('Mechanical Switch Housings + Cross-Stems', housings, housingMat, new THREE.Vector3(0, 0, 24)) });

  // Part 3 — 4 sculpted keycaps in accent colors (lifts high)
  const capMeshes = [];
  const capGeos = [];
  slots.forEach(([sx, sy], i) => {
    const capMat = physicalFilamentMaterial(KEYCAP_COLORS[i % KEYCAP_COLORS.length], { roughness: 0.3, metalness: 0.1 });
    const cap = new THREE.Mesh(
      mergeParts([box(21, 21, 8, sx, sy, 31, 1.5), box(16, 16, 4, sx, sy, 36.5, 1.5)]),
      capMat
    );
    cap.castShadow = true;
    cap.receiveShadow = true;
    capMeshes.push(cap);
    capGeos.push(cap.geometry);
  });
  const capGroup = new THREE.Group();
  capMeshes.forEach((m) => capGroup.add(m));
  parts.push({ name: 'Sculpted Keycap Set (4 Colors)', mesh: capGroup, geos: capGeos, explode: new THREE.Vector3(0, 0, 50), material: housingMat });

  return finishAssembly(group, parts, 'keycap');
}

// ---------------------------------------------------------------------------
// Registry for slicer quick samples
// ---------------------------------------------------------------------------

export const PROCEDURAL_DESIGNS = {
  esp32: {
    key: 'esp32',
    title: 'Snap-Fit ESP32 Case',
    fileName: 'snap-fit-esp32-case.stl',
    partCount: 3,
    build: buildEnclosureAssembly,
  },
  planetary: {
    key: 'planetary',
    title: 'Planetary Gear Box',
    fileName: 'planetary-gear-box.stl',
    partCount: 6,
    build: buildPlanetaryAssembly,
  },
  mecha: {
    key: 'mecha',
    title: 'Posable Snap-Fit Mecha',
    fileName: 'posable-snap-fit-mecha.stl',
    partCount: 5,
    build: buildMechaAssembly,
  },
  keycap: {
    key: 'keycap',
    title: 'Keycap Switch Tester',
    fileName: 'mx-switch-tester-12.stl',
    partCount: 3,
    build: buildKeycapTesterAssembly,
  },
};

export default {
  createFDMLayerBumpTexture,
  physicalFilamentMaterial,
  buildMechaAssembly,
  buildEnclosureAssembly,
  buildPlanetaryAssembly,
  buildKeycapTesterAssembly,
  getProceduralDesign,
  PROCEDURAL_DESIGNS,
};

export function getProceduralDesign(key) {
  return PROCEDURAL_DESIGNS[key] || null;
}
