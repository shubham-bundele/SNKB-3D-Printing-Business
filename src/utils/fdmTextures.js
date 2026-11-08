/**
 * src/utils/fdmTextures.js
 *
 * Procedural micro-texture helpers shared by every 3D viewport:
 *
 * - createFDMLayerBumpTexture(): horizontal 0.20 mm FDM layer-ridge bump map
 *   that gives PLA+/PETG prints their authentic satin, printed-surface look.
 * - createPEIBumpTexture(): gold/textured PEI powder-coat speckle bump used on
 *   the Bambu Lab A1 Mini build-plate sheet.
 * - physicalFilamentMaterial(): drop-in MeshPhysicalMaterial preset with the
 *   studio PBR finish (satin roughness, subtle metallic flakes, clearcoat).
 *
 * All helpers are DOM-guarded: without `document` (SSR / unit tests / Node)
 * they return null so materials silently fall back to plain PBR values.
 */

'use strict';

import * as THREE from 'three';

/** Physically-plausible polymer surface (no DOM required → bumpMap stays null). */
export function physicalFilamentMaterial(hex, opts = {}) {
  let bump = null;
  try {
    bump = createFDMLayerBumpTexture();
  } catch (_) {
    bump = null;
  }
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(hex),
    roughness: opts.roughness ?? 0.28,
    metalness: opts.metalness ?? 0.0,
    clearcoat: opts.clearcoat ?? 0.18,
    clearcoatRoughness: opts.clearcoatRoughness ?? 0.25,
    ...(bump ? { bumpMap: bump, bumpScale: 0.02 } : {}),
    ...(opts.emissive ? { emissive: new THREE.Color(opts.emissive), emissiveIntensity: opts.emissiveIntensity ?? 1.0 } : {}),
  });
}

/**
 * Subtle horizontal FDM 0.2mm layer ridge bump texture.
 * Returns null when no DOM canvas is available (Node/tests/SSR).
 * Memoized: every material in every viewport shares ONE CanvasTexture so
 * switching STL files never leaks uploadable GPU textures.
 */
let fdmLayerBumpCache = null;
export function createFDMLayerBumpTexture() {
  if (typeof document === 'undefined') return null;
  if (fdmLayerBumpCache) return fdmLayerBumpCache;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Micro polymer grain base
    const grain = ctx.createImageData(128, 128);
    for (let i = 0; i < grain.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 24;
      grain.data[i] = v;
      grain.data[i + 1] = v;
      grain.data[i + 2] = v;
      grain.data[i + 3] = 255;
    }
    ctx.putImageData(grain, 0, 0);

    // Horizontal 0.20 mm layer-line ridges (soft sinusoidal bands)
    for (let y = 0; y < 128; y++) {
      const phase = Math.sin((y / 128) * Math.PI * 32) * 0.5 + 0.5;
      const shade = 140 + phase * 50;
      ctx.fillStyle = `rgba(${shade | 0}, ${shade | 0}, ${shade | 0}, ${0.25 + phase * 0.3})`;
      ctx.fillRect(0, y, 128, 1);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(6, 6);
    fdmLayerBumpCache = texture;
    return texture;
  } catch (_) {
    return null;
  }
}

/**
 * Dispose the cached FDM bump texture (e.g. viewer unmount). Safe to skip:
 * the cache simply regenerates on the next call.
 */
export function disposeFDMLayerBumpTexture() {
  if (fdmLayerBumpCache) {
    fdmLayerBumpCache.dispose();
    fdmLayerBumpCache = null;
  }
}

/**
 * Gold/textured PEI powder-coat speckle bump texture for build plates.
 * Returns null when no DOM canvas is available.
 * Memoized for the same anti-leak reason as the FDM layer texture.
 */
let peiBumpCache = null;
export function createPEIBumpTexture() {
  if (typeof document === 'undefined') return null;
  if (peiBumpCache) return peiBumpCache;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#2a2c31';
    ctx.fillRect(0, 0, 256, 256);
    // Dense powder-coat speckle dots
    for (let i = 0; i < 4200; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const r = 0.6 + Math.random() * 1.4;
      const v = 70 + Math.random() * 90;
      ctx.fillStyle = `rgba(${v}, ${v * 0.95}, ${v * 0.8}, 0.8)`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 3);
    peiBumpCache = texture;
    return texture;
  } catch (_) {
    return null;
  }
}

/** Dispose the cached PEI bump texture. */
export function disposePEIBumpTexture() {
  if (peiBumpCache) {
    peiBumpCache.dispose();
    peiBumpCache = null;
  }
}
