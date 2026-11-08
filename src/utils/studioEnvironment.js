/**
 * src/utils/studioEnvironment.js
 *
 * Real HDRI studio lighting for every WebGL viewport (slicer arena, hero
 * print stage, catalog turntables + snapshot renderer).
 *
 * The bundled equirectangular HDRI (`public/hdr/studio_small_08_1k.hdr`,
 * Poly Haven CC0 "Studio Small 08" neutral studio softbox scene, 1k) is
 * preprocessed once per renderer with PMREMGenerator and applied as
 * `scene.environment` so PLA+ prints receive believable image-based
 * reflections, sheen highlights and soft ambient bounce. The procedural
 * RoomEnvironment remains the automatic fallback whenever HDR loading or
 * PMREM compilation fails (offline, WebGL2 loss, tests, SSR).
 */

'use strict';

import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const STUDIO_HDRI_URL = '/hdr/studio_small_08_1k.hdr';

/** Subtle image-based-lighting influence (0 = off, 1 = full). */
export const STUDIO_ENV_INTENSITY = 0.55;

// The raw HDR buffer is fetched once and shared by every viewer session.
let hdrBufferPromise = null;

function loadHdrArrayBuffer() {
  if (hdrBufferPromise) return hdrBufferPromise;
  hdrBufferPromise = new Promise((resolve, reject) => {
    const loader = new RGBELoader();
    loader.load(
      STUDIO_HDRI_URL,
      (texture) => resolve(texture),
      undefined,
      (err) => reject(err)
    );
  }).catch((err) => {
    console.warn('[StudioEnv] HDRI fetch failed, falling back to procedural environment:', err);
    // Allow a later retry (e.g. after a context restore) instead of caching the failure.
    hdrBufferPromise = null;
    return null;
  });
  return hdrBufferPromise;
}

function applyEnvironment(renderer, scene, envTexture, fallbackIntensity = null) {
  if (!renderer || !scene) return null;
  if (envTexture) {
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      const envRT = pmrem.fromEquirectangular(envTexture);
      pmrem.dispose();
      if (envRT && envRT.texture) {
        scene.environment = envRT.texture;
        if ('environmentIntensity' in scene && scene.environmentIntensity !== undefined) {
          scene.environmentIntensity = fallbackIntensity ?? STUDIO_ENV_INTENSITY;
        }
        return scene.environment;
      }
    } catch (err) {
      console.warn('[StudioEnv] PMREM preprocessing failed, falling back to procedural environment:', err);
    }
  }

  // Procedural fallback (also used as the instant baseline while HDR streams in)
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envScene = new RoomEnvironment();
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    envScene.dispose();
    pmrem.dispose();
    if ('environmentIntensity' in scene && scene.environmentIntensity !== undefined) {
      scene.environmentIntensity = STUDIO_ENV_INTENSITY;
    }
  } catch (err) {
    console.warn('[StudioEnv] Could not initialize procedural environment:', err);
  }
  return scene.environment;
}

/**
 * Install the real HDRI environment onto `scene`.
 * RoomEnvironment is applied immediately as the guaranteed baseline, then the
 * HDR texture streams in asynchronously and upgrades the reflections in-place.
 */
export function loadStudioEnvironment(renderer, scene, options = {}) {
  if (!renderer || !scene) return;

  // Instant procedural baseline so the viewport is never unlit.
  applyEnvironment(renderer, scene, null);

  loadHdrArrayBuffer()
    .then((hdrTexture) => {
      if (!hdrTexture) return;
      if (
        !renderer.domElement ||
        !renderer.domElement.isConnected ||
        typeof renderer.getContext !== 'function' ||
        renderer.getContext() === null
      ) {
        // Renderer was disposed while the HDR was streaming — skip.
        return;
      }
      applyEnvironment(renderer, scene, hdrTexture, options.intensity ?? null);
    })
    .catch((err) => console.warn('[StudioEnv] Unexpected HDRI pipeline error:', err));
}

export default loadStudioEnvironment;
