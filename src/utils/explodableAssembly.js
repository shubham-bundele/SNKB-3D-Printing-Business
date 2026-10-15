/**
 * src/utils/explodableAssembly.js
 *
 * Honest explode engine for single-extruder (No-AMS) FDM assemblies.
 *
 * - Multi-part catalog assemblies use buildExplodableGroup (5-bucket snap-fit split).
 * - Single-piece / print-in-place meshes must NOT be fake-sliced: use
 *   analyzeMeshShells() first. shellCount === 1 locks the Explode button.
 * - Genuinely disconnected multi-shell uploads use buildShellExplodableGroup(),
 *   which translates each disconnected shell outward along
 *   (shellCentroid - overallCenter).
 */

import * as THREE from 'three';

const EXPLODE_VECTORS = {
  part0: new THREE.Vector3(0, 0, 0),       // Base Chassis
  part1: new THREE.Vector3(0, 18, 0),      // Core Body (upward)
  part2: new THREE.Vector3(-24, 12, 8),    // Left Plate (left, up, forward)
  part3: new THREE.Vector3(24, 12, -8),    // Right Plate (right, up, back)
  part4: new THREE.Vector3(0, 38, 0),      // Top Armor/Lid (upward high)
};

/**
 * Builds an explodable THREE.Group from a normalized THREE.BufferGeometry.
 *
 * @param {THREE.BufferGeometry} sourceGeometry
 * @param {string} primaryHex - Hex color for base chassis and top armor
 * @param {string} accentHex - Hex color for core body and side plates
 * @param {object} [threeInstance] - Optional THREE namespace
 * @returns {THREE.Group} Group containing child meshes and dashed alignment lines
 */
export function buildExplodableGroup(sourceGeometry, primaryHex = '#FF6500', accentHex = '#00FF66', threeInstance = THREE) {
  const T = threeInstance || THREE;
  const group = new T.Group();
  group.name = 'ExplodableAssemblyGroup';

  // Ensure non-indexed geometry for reliable triangle splitting
  const geom = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone();
  geom.computeVertexNormals();
  geom.computeBoundingBox();

  const box = geom.boundingBox || new T.Box3().setFromBufferAttribute(geom.attributes.position);
  const W = Math.max(box.max.x - box.min.x, 1);
  const H = Math.max(box.max.y - box.min.y, 1);
  const D = Math.max(box.max.z - box.min.z, 1);
  const minY = box.min.y;

  const posAttr = geom.attributes.position;
  const normAttr = geom.attributes.normal;
  const triCount = posAttr.count / 3;

  // Buckets for vertex data (x, y, z) and normals (nx, ny, nz)
  const buckets = [
    { name: 'part0_base', verts: [], norms: [], isAccent: false, vec: EXPLODE_VECTORS.part0 },
    { name: 'part1_core', verts: [], norms: [], isAccent: true, vec: EXPLODE_VECTORS.part1 },
    { name: 'part2_leftPlate', verts: [], norms: [], isAccent: true, vec: EXPLODE_VECTORS.part2 },
    { name: 'part3_rightPlate', verts: [], norms: [], isAccent: true, vec: EXPLODE_VECTORS.part3 },
    { name: 'part4_topArmor', verts: [], norms: [], isAccent: false, vec: EXPLODE_VECTORS.part4 },
  ];

  for (let i = 0; i < triCount; i++) {
    const i0 = i * 3;
    const i1 = i0 + 1;
    const i2 = i0 + 2;

    const x0 = posAttr.getX(i0); const y0 = posAttr.getY(i0); const z0 = posAttr.getZ(i0);
    const x1 = posAttr.getX(i1); const y1 = posAttr.getY(i1); const z1 = posAttr.getZ(i1);
    const x2 = posAttr.getX(i2); const y2 = posAttr.getY(i2); const z2 = posAttr.getZ(i2);

    const cx = (x0 + x1 + x2) / 3;
    const cy = (y0 + y1 + y2) / 3;
    const cz = (z0 + z1 + z2) / 3;

    const relY = cy - minY;

    let targetBucketIdx = 0;
    if (relY < 0.30 * H) {
      targetBucketIdx = 0; // Base Chassis
    } else if (relY >= 0.65 * H) {
      targetBucketIdx = 4; // Top Armor / Lid
    } else {
      // Mid-section (0.30 * H <= relY < 0.65 * H)
      if (cx < -0.25 * W) {
        targetBucketIdx = 2; // Left Interlocking Side Plate
      } else if (cx > 0.25 * W) {
        targetBucketIdx = 3; // Right Interlocking Side Plate
      } else {
        targetBucketIdx = 1; // Core Lower Body
      }
    }

    const b = buckets[targetBucketIdx];
    b.verts.push(x0, y0, z0, x1, y1, z1, x2, y2, z2);

    if (normAttr) {
      b.norms.push(
        normAttr.getX(i0), normAttr.getY(i0), normAttr.getZ(i0),
        normAttr.getX(i1), normAttr.getY(i1), normAttr.getZ(i1),
        normAttr.getX(i2), normAttr.getY(i2), normAttr.getZ(i2)
      );
    }
  }

  // Create shared physical materials
  const primaryMat = new T.MeshPhysicalMaterial({
    color: new T.Color(primaryHex),
    roughness: 0.32,
    metalness: 0.12,
    clearcoat: 0.30,
    clearcoatRoughness: 0.20,
  });

  const accentMat = new T.MeshPhysicalMaterial({
    color: new T.Color(accentHex),
    roughness: 0.32,
    metalness: 0.12,
    clearcoat: 0.30,
    clearcoatRoughness: 0.20,
  });

  const childMeshes = [];
  const linePoints = [];

  buckets.forEach((bucket, idx) => {
    if (bucket.verts.length === 0) return;

    const subGeom = new T.BufferGeometry();
    subGeom.setAttribute('position', new T.Float32BufferAttribute(bucket.verts, 3));
    if (bucket.norms.length > 0) {
      subGeom.setAttribute('normal', new T.Float32BufferAttribute(bucket.norms, 3));
    } else {
      subGeom.computeVertexNormals();
    }
    subGeom.computeBoundingBox();

    const mesh = new T.Mesh(subGeom, bucket.isAccent ? accentMat : primaryMat);
    mesh.name = bucket.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    mesh.userData = {
      isExplodablePart: true,
      partIndex: idx,
      isAccent: bucket.isAccent,
      homePos: new T.Vector3(0, 0, 0),
      explodeVector: bucket.vec.clone(),
      center: subGeom.boundingBox ? subGeom.boundingBox.getCenter(new T.Vector3()) : new T.Vector3(0, 0, 0),
    };

    group.add(mesh);
    childMeshes.push(mesh);

    // If part explodes, add guide line endpoints from center spine (0, y, 0) to home center
    if (bucket.vec.lengthSq() > 0) {
      const c = mesh.userData.center;
      // Line from center axis to home position
      linePoints.push(0, c.y, 0);
      linePoints.push(c.x, c.y, c.z);
    }
  });

  // Dashed CAD alignment lines connecting parts to central axis
  let dashedLineSegments = null;
  if (linePoints.length > 0) {
    const lineGeom = new T.BufferGeometry();
    lineGeom.setAttribute('position', new T.Float32BufferAttribute(linePoints, 3));
    const lineMat = new T.LineDashedMaterial({
      color: 0xff6500,
      dashSize: 3,
      gapSize: 2,
      transparent: true,
      opacity: 0.75,
      linewidth: 1,
    });
    dashedLineSegments = new T.LineSegments(lineGeom, lineMat);
    dashedLineSegments.computeLineDistances();
    dashedLineSegments.visible = false;
    group.add(dashedLineSegments);
  }

  // Attach controller to group.userData
  group.userData = {
    isExplodableAssembly: true,
    childMeshes,
    dashedLineSegments,
    primaryMaterial: primaryMat,
    accentMaterial: accentMat,
    currentExplode: 0,
    targetExplode: 0,
    setColors(pColor, aColor) {
      if (pColor) primaryMat.color.set(pColor);
      if (aColor) accentMat.color.set(aColor);
    },
    update(explodeTarget, lerpSpeed = 0.12) {
      this.targetExplode = Math.max(0, Math.min(1, explodeTarget));
      this.currentExplode += (this.targetExplode - this.currentExplode) * lerpSpeed;

      childMeshes.forEach((mesh) => {
        if (mesh.userData.explodeVector) {
          const dest = mesh.userData.explodeVector.clone().multiplyScalar(this.currentExplode);
          mesh.position.copy(dest);
        }
      });

      if (dashedLineSegments) {
        dashedLineSegments.visible = this.currentExplode > 0.04;
        if (dashedLineSegments.visible) {
          // Dynamically scale alignment line points to connect spine to moving parts
          const posAttr = dashedLineSegments.geometry.attributes.position;
          let pIdx = 0;
          childMeshes.forEach((mesh) => {
            if (mesh.userData.explodeVector && mesh.userData.explodeVector.lengthSq() > 0) {
              const c = mesh.userData.center;
              const curX = c.x + mesh.position.x;
              const curY = c.y + mesh.position.y;
              const curZ = c.z + mesh.position.z;

              // Origin point on center axis (moves vertically with part)
              posAttr.setXYZ(pIdx * 2, 0, curY, 0);
              // Target point on the exploding sub-assembly
              posAttr.setXYZ(pIdx * 2 + 1, curX, curY, curZ);
              pIdx++;
            }
          });
          posAttr.needsUpdate = true;
          dashedLineSegments.computeLineDistances();
        }
      }
    },
  };

  return group;
}

/**
 * Updates an explodable group during the render loop.
 *
 * @param {THREE.Group} group
 * @param {number} explodeTarget - Target between 0 (assembled) and 1 (fully separated)
 * @param {number} [lerpSpeed] - Interpolation speed (default 0.12)
 */
export function updateExplodableGroup(group, explodeTarget, lerpSpeed = 0.12) {
  if (group && group.userData && typeof group.userData.update === 'function') {
    group.userData.update(explodeTarget, lerpSpeed);
  }
}

/**
 * Fast spatial-hash vertex welding + BFS triangle adjacency analyzer.
 * Counts physically disconnected shells/parts inside an STL buffer geometry.
 *
 * @param {THREE.BufferGeometry} geometry - non-indexed or indexed geometry
 * @param {number} toleranceMm - vertex weld tolerance (default 0.01mm)
 * @returns {{ shellCount:number, shells:Array<{triangleIndices:number[],centroid:THREE.Vector3,triangleCount:number}>, triangleShellIds:Int32Array }}
 */
export function analyzeMeshShells(geometry, toleranceMm = 0.01) {
  const posAttr = geometry && geometry.attributes && geometry.attributes.position;
  if (!posAttr || posAttr.count < 3) {
    return { shellCount: 0, shells: [], triangleShellIds: new Int32Array(0) };
  }
  const triCount = Math.floor(posAttr.count / 3);
  const tol = Math.max(1e-6, toleranceMm);
  const q = (v) => Math.round(v / tol);

  // Weld vertices via spatial hash -> weld id per corner
  const vertWeldIds = new Int32Array(posAttr.count);
  const weldMap = new Map();
  let nextWeldId = 0;
  for (let i = 0; i < posAttr.count; i++) {
    const key = `${q(posAttr.getX(i))},${q(posAttr.getY(i))},${q(posAttr.getZ(i))}`;
    let id = weldMap.get(key);
    if (id === undefined) {
      id = nextWeldId++;
      weldMap.set(key, id);
    }
    vertWeldIds[i] = id;
  }

  // Weld id -> triangle list
  const weldToTris = new Map();
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const wid = vertWeldIds[t * 3 + k];
      let arr = weldToTris.get(wid);
      if (!arr) {
        arr = [];
        weldToTris.set(wid, arr);
      }
      arr.push(t);
    }
  }

  // BFS over triangle adjacency
  const shellIds = new Int32Array(triCount).fill(-1);
  let shellCount = 0;
  const queue = [];
  for (let seed = 0; seed < triCount; seed++) {
    if (shellIds[seed] !== -1) continue;
    shellIds[seed] = shellCount;
    queue.length = 0;
    queue.push(seed);
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      for (let k = 0; k < 3; k++) {
        const wid = vertWeldIds[cur * 3 + k];
        const neighbours = weldToTris.get(wid);
        if (!neighbours) continue;
        for (let n = 0; n < neighbours.length; n++) {
          const nt = neighbours[n];
          if (shellIds[nt] === -1) {
            shellIds[nt] = shellCount;
            queue.push(nt);
          }
        }
      }
    }
    shellCount++;
  }

  // Per-shell centroids + triangle lists
  const shells = [];
  for (let s = 0; s < shellCount; s++) {
    shells.push({ triangleIndices: [], centroid: new THREE.Vector3(0, 0, 0), triangleCount: 0 });
  }
  const tmp = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const s = shellIds[t];
    const shell = shells[s];
    shell.triangleIndices.push(t);
    shell.triangleCount++;
    tmp.set(0, 0, 0);
    for (let k = 0; k < 3; k++) {
      tmp.x += posAttr.getX(t * 3 + k);
      tmp.y += posAttr.getY(t * 3 + k);
      tmp.z += posAttr.getZ(t * 3 + k);
    }
    tmp.multiplyScalar(1 / 3);
    shell.centroid.add(tmp);
  }
  shells.forEach((shell) => {
    if (shell.triangleCount > 0) shell.centroid.multiplyScalar(1 / shell.triangleCount);
  });

  return { shellCount, shells, triangleShellIds: shellIds };
}

/**
 * Honest shell-based explode: one mesh per disconnected shell, each pushed
 * outward along (shellCentroid - overallCenter). Returns same controller
 * shape as buildExplodableGroup ({ userData.update/setColors }).
 */
export function buildShellExplodableGroup(sourceGeometry, primaryHex = '#FF6500', accentHex = '#00FF66', threeInstance = THREE, shellAnalysis = null) {
  const T = threeInstance || THREE;
  const group = new T.Group();
  group.name = 'ShellExplodableGroup';
  const geom = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone();
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  const analysis = shellAnalysis || analyzeMeshShells(geom);
  const overallCenter = geom.boundingBox ? geom.boundingBox.getCenter(new T.Vector3()) : new T.Vector3(0, 0, 0);
  const posAttr = geom.attributes.position;
  const normAttr = geom.attributes.normal;

  const primaryMat = new T.MeshPhysicalMaterial({ color: new T.Color(primaryHex), roughness: 0.32, metalness: 0.12, clearcoat: 0.3, clearcoatRoughness: 0.2 });
  const accentMat = new T.MeshPhysicalMaterial({ color: new T.Color(accentHex), roughness: 0.32, metalness: 0.12, clearcoat: 0.3, clearcoatRoughness: 0.2 });

  const childMeshes = [];
  const linePoints = [];
  analysis.shells.forEach((shell, idx) => {
    const verts = [];
    const norms = [];
    shell.triangleIndices.forEach((t) => {
      for (let k = 0; k < 3; k++) {
        const vi = t * 3 + k;
        verts.push(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi));
        if (normAttr) norms.push(normAttr.getX(vi), normAttr.getY(vi), normAttr.getZ(vi));
      }
    });
    if (verts.length === 0) return;
    const subGeom = new T.BufferGeometry();
    subGeom.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
    if (norms.length > 0) subGeom.setAttribute('normal', new T.Float32BufferAttribute(norms, 3));
    else subGeom.computeVertexNormals();
    subGeom.computeBoundingBox();
    const isAccent = idx % 2 === 1;
    const mesh = new T.Mesh(subGeom, isAccent ? accentMat : primaryMat);
    mesh.name = `shell_${idx}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const dir = shell.centroid.clone().sub(overallCenter);
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
    dir.normalize().multiplyScalar(28);
    mesh.userData = { isExplodablePart: true, partIndex: idx, isAccent, homePos: new T.Vector3(0, 0, 0), explodeVector: dir, center: shell.centroid.clone(), shellTriangleCount: shell.triangleCount };
    group.add(mesh);
    childMeshes.push(mesh);
    linePoints.push(overallCenter.x, overallCenter.y, overallCenter.z);
    linePoints.push(shell.centroid.x, shell.centroid.y, shell.centroid.z);
  });

  let dashedLineSegments = null;
  if (linePoints.length > 0) {
    const lineGeom = new T.BufferGeometry();
    lineGeom.setAttribute('position', new T.Float32BufferAttribute(linePoints, 3));
    const lineMat = new T.LineDashedMaterial({ color: 0xff6500, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.75 });
    dashedLineSegments = new T.LineSegments(lineGeom, lineMat);
    dashedLineSegments.computeLineDistances();
    dashedLineSegments.visible = false;
    group.add(dashedLineSegments);
  }

  group.userData = {
    isExplodableAssembly: true,
    isShellAssembly: true,
    shellCount: analysis.shellCount,
    childMeshes,
    dashedLineSegments,
    primaryMaterial: primaryMat,
    accentMaterial: accentMat,
    currentExplode: 0,
    targetExplode: 0,
    setColors(pColor, aColor) {
      if (pColor) primaryMat.color.set(pColor);
      if (aColor) accentMat.color.set(aColor);
    },
    update(explodeTarget, lerpSpeed = 0.12) {
      this.targetExplode = Math.max(0, Math.min(1, explodeTarget));
      this.currentExplode += (this.targetExplode - this.currentExplode) * lerpSpeed;
      childMeshes.forEach((mesh) => {
        if (mesh.userData.explodeVector) mesh.position.copy(mesh.userData.explodeVector.clone().multiplyScalar(this.currentExplode));
      });
      if (dashedLineSegments) {
        dashedLineSegments.visible = this.currentExplode > 0.04;
        if (dashedLineSegments.visible) {
          const attr = dashedLineSegments.geometry.attributes.position;
          let pIdx = 0;
          childMeshes.forEach((mesh) => {
            const c = mesh.userData.center;
            attr.setXYZ(pIdx * 2, overallCenter.x, overallCenter.y + mesh.position.y * 0, overallCenter.z);
            attr.setXYZ(pIdx * 2 + 1, c.x + mesh.position.x, c.y + mesh.position.y, c.z + mesh.position.z);
            pIdx++;
          });
          attr.needsUpdate = true;
          dashedLineSegments.computeLineDistances();
        }
      }
    },
  };
  return group;
}

/**
 * Single-extruder pause-at-height preview: bottom (y < pauseHeightMm) in
 * primary color, top layers (y >= pauseHeightMm) in accent color.
 * Writes a per-vertex 'color' attribute; caller enables vertexColors.
 */
export function applyLayerSwapVertexColors(geometry, pauseHeightMm, primaryHex = '#FF6500', accentHex = '#00E5FF') {
  const posAttr = geometry && geometry.attributes && geometry.attributes.position;
  if (!posAttr) return false;
  const T = THREE;
  const primary = new T.Color(primaryHex);
  const accent = new T.Color(accentHex);
  const colors = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    const c = posAttr.getY(i) >= pauseHeightMm ? accent : primary;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
  return true;
}

/**
 * Genuine physical sub-assembly names per catalog design (matched against the
 * loaded file name / design id, lowercase substring). These name the REAL
 * separately-printed plates — never invented geometry. Fallback is generic
 * Plate 1 / Plate 2 naming.
 */
export const PHYSICAL_PART_GROUPS = [
  { match: ['mecha', 'dummy', 'action-figure'], base: 'Inner Ball-Joint Skeleton', accent: 'Snap-On Armor Plates' },
  { match: ['esp32', 'wled', 'controller-case'], base: 'Base Tub + PCB Standoffs', accent: 'Vented Top Lid' },
  { match: ['mx-switch', 'mx-tester', 'keycap', 'switch-tester'], base: 'Tester Housing', accent: 'Switch Stems + Keycap Set' },
  { match: ['planetary', 'gear-bearing', 'gear-fidget', 'fidget-spinner'], base: 'Sun + Planet Gears', accent: 'Outer Ring Housing' },
  { match: ['gridfinity', 'organizer', 'desk-organizer'], base: 'Base Grid', accent: 'Removable Sorting Bins' },
  { match: ['clamp', 'hanger', 'headphone-hanger'], base: 'C-Clamp Bracket', accent: 'Thumbscrew + Hook' },
  { match: ['poop', 'purge', 'catch-box', 'catch-bin'], base: 'Catch Bin', accent: 'Deflector Ramp' },
  { match: ['rpi', 'raspberry', 'sensor-housing', 'zero'], base: 'Base Housing + Standoffs', accent: 'Vented Sensor Lid' },
  { match: ['planter-trio', 'trio-tray', 'tray'], base: 'Planter Pots', accent: 'Drainage Tray' },
  { match: ['nameplate', 'gamer-tag', 'raised-letter'], base: 'Nameplate Base', accent: 'Raised Lettering' },
];

/**
 * Resolve physical plate names for a loaded design. Always returns honest
 * labels for the two genuine plates (or a generic fallback) — callers must
 * only display these when actually exploding separate plate meshes.
 */
export function getPartNamesForDesign(fileNameOrId) {
  const key = String(fileNameOrId || '').toLowerCase();
  for (const group of PHYSICAL_PART_GROUPS) {
    if (group.match.some((m) => key.includes(m))) {
      return { base: group.base, accent: group.accent };
    }
  }
  return { base: 'Base Plate Assembly', accent: 'Accent Plate Assembly' };
}

export default {
  buildExplodableGroup,
  buildShellExplodableGroup,
  analyzeMeshShells,
  applyLayerSwapVertexColors,
  updateExplodableGroup,
  getPartNamesForDesign,
  PHYSICAL_PART_GROUPS,
};
