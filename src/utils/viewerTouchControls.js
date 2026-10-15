/**
 * src/utils/viewerTouchControls.js
 *
 * Shared mobile-hardening helpers for every Three.js viewport in the studio:
 *   - resolvePixelRatio(): caps devicePixelRatio so phones never melt their GPU.
 *   - isCoarsePointer(): true on touch-first devices (phones/tablets).
 *   - attachTouchScrollLock(): injects a floating pill that lets a phone user
 *     lock/unlock one-finger orbiting so the page can be scrolled without the
 *     canvas swallowing the gesture (the classic 3D scroll-trap bug).
 *
 * All helpers are SSR-safe: they no-op when `document`/`window` are undefined so
 * Astro's Node build and the unit tests can import this module freely.
 */

/** Cap the renderer pixel ratio: 1.5 on phones, 2 on tablet/desktop. */
export function resolvePixelRatio() {
  if (typeof window === 'undefined') return 1;
  const dpr = window.devicePixelRatio || 1;
  const cap = window.innerWidth < 768 ? 1.5 : 2;
  return Math.min(dpr, cap);
}

/** True when the primary input is a finger rather than a mouse. */
export function isCoarsePointer() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export const TOUCH_LOCK_LABEL = '🖐️ 3D Touch: Locked for Scroll — Tap to Orbit';
export const TOUCH_ORBIT_LABEL = '🔄 3D Orbit Active — Tap to Lock';

/**
 * Adds a floating scroll-lock pill to a 3D viewport container on touch devices.
 *
 * @param {object}  opts
 * @param {HTMLElement} opts.container  The positioned wrapper holding the canvas.
 * @param {object}  [opts.controls]     An OrbitControls instance (optional).
 * @param {boolean} [opts.defaultLocked=true] Whether to start locked (page-scroll first).
 * @returns {{pill: HTMLButtonElement, setLocked: (v: boolean) => void, isLocked: () => boolean}|null}
 */
export function attachTouchScrollLock({ container, controls, defaultLocked = true } = {}) {
  if (!container || typeof document === 'undefined' || !isCoarsePointer()) return null;

  const canvas = container.querySelector('canvas');
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'viewer-touch-lock';
  pill.setAttribute('aria-pressed', String(defaultLocked));

  let locked = defaultLocked;

  const apply = () => {
    // Disabling OrbitControls stops it stealing the gesture; touch-action on the
    // canvas re-enables native vertical scrolling while locked.
    if (controls) controls.enabled = !locked;
    if (canvas) canvas.style.touchAction = locked ? 'pan-y' : 'none';
    container.classList.toggle('touch-locked', locked);
    pill.classList.toggle('is-orbiting', !locked);
    pill.textContent = locked ? TOUCH_LOCK_LABEL : TOUCH_ORBIT_LABEL;
    pill.setAttribute('aria-pressed', String(locked));
  };

  pill.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    locked = !locked;
    apply();
  });
  // Keep a tap on the pill from reaching the canvas gesture handlers.
  pill.addEventListener('pointerdown', (e) => e.stopPropagation());

  container.appendChild(pill);
  apply();

  return {
    pill,
    setLocked: (v) => {
      locked = Boolean(v);
      apply();
    },
    isLocked: () => locked,
  };
}
