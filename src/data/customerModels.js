/**
 * src/data/customerModels.js
 *
 * Real Customer STL Archive — the definitive registry of genuine 3D models
 * shipped on this website (served verbatim from `public/models/customer/`).
 *
 * Every entry points at an actual, physical .stl / .3mf file that the slicer
 * cockpit loads, seats on the A1 Mini bed, analyses and prices in INR.
 * There are NO procedural stand-ins, placeholder blobs or mock files here.
 *
 * Files are served as-is; the .3mf entries load through ThreeMFLoader and
 * the .stl entries through STLLoader — both are already mm-scale as printed.
 */

'use strict';

export const CUSTOMER_MODEL_GALLERY = [
  // ── Functional Utility Prints ────────────────────────────────────────────
  {
    id: 'customer-bag-clip',
    label: 'Bag Clip 6mm',
    emoji: '📎',
    file: '/models/customer/bag-clip-6mm.3mf',
    kind: '3mf',
    category: 'utility',
    fileName: 'BagClip2_6mm.3mf',
    sizeMB: 2.2,
    blurb: 'Spring-loaded 6mm bag seal clip — functional print.',
  },
  {
    id: 'customer-ps4-stand',
    label: 'PS4 Fat-Foot Stand',
    emoji: '🎮',
    file: '/models/customer/ps4-fat-foot-logo-stand.3mf',
    kind: '3mf',
    category: 'gaming',
    fileName: 'PS4_Stand.3mf',
    sizeMB: 0.6,
    blurb: 'PlayStation 4 console riser with fat-foot logo base.',
  },
  {
    id: 'customer-ps5-joystick-stand',
    label: 'Dual Joystick Stand',
    emoji: '🕹️',
    file: '/models/customer/ps5-dual-joystick-stand.3mf',
    kind: '3mf',
    category: 'gaming',
    fileName: 'Stand_Dual_Joystick_Playstation.3mf',
    sizeMB: 1.3,
    blurb: 'Dual PlayStation controller / joystick display stand.',
  },
  {
    id: 'customer-ac-remote-mount',
    label: 'AC Remote Wall Mount',
    emoji: '🌐',
    file: '/models/customer/ac-remote-wall-mount.3mf',
    kind: '3mf',
    category: 'utility',
    fileName: 'Universal_Wall_Mount_Holder_for_air_Conditioner_Remote_V2.3mf',
    sizeMB: 0.5,
    blurb: 'Universal V2 wall holder for air-conditioner remotes.',
  },
  {
    id: 'customer-dust-cover-ptfe',
    label: 'A1 Dust Cover + PTFE',
    emoji: '🖨️',
    file: '/models/customer/a1-dust-cover-ptfe.stl',
    kind: 'stl',
    category: 'utility',
    fileName: 'A1+Dust+cover+1-PTFE.stl',
    sizeMB: 0.9,
    blurb: 'A1 printer dust cover with integrated PTFE feed pass-through.',
  },
  {
    id: 'customer-ams-ptfe-plug',
    label: 'AMS PTFE Plug',
    emoji: '🔌',
    file: '/models/customer/ams-ptfe-plug.stl',
    kind: 'stl',
    category: 'utility',
    fileName: 'AMS_PTFE_Plug.stl',
    sizeMB: 0.25,
    blurb: 'Snap plug that seals AMS PTFE coupler ports.',
  },
  {
    id: 'customer-dust-cover-filla',
    label: 'Dust Cover Filler',
    emoji: '🧱',
    file: '/models/customer/dust-cover-filla.stl',
    kind: 'stl',
    category: 'utility',
    fileName: 'obj_1_dust cover filla (2).stl',
    sizeMB: 2.5,
    blurb: 'Filler segment completing the printer dust-cover set.',
  },
  {
    id: 'customer-portafilter',
    label: 'Portafilter Holder',
    emoji: '☕',
    file: '/models/customer/portafilter-holder.3mf',
    kind: '3mf',
    category: 'kitchen',
    fileName: 'Porta_Filaccini_LARGE.3mf',
    sizeMB: 1.4,
    blurb: 'Large espresso portafilter wall cradle (54–58mm).',
  },
  {
    id: 'customer-usb-a-plug',
    label: 'USB-A Male Plug',
    emoji: '🔗',
    file: '/models/customer/usb-a-male-plug.stl',
    kind: 'stl',
    category: 'utility',
    fileName: 'USB_A_M.stl',
    sizeMB: 0.6,
    blurb: 'USB Type-A male plug housing / enclosure part.',
  },

  // ── Hardware & Machine Parts ─────────────────────────────────────────────
  {
    id: 'customer-hex-bolt',
    label: 'Hex Bolt',
    emoji: '🔩',
    file: '/models/customer/hex-bolt.stl',
    kind: 'stl',
    category: 'hardware',
    fileName: 'bolt.stl',
    sizeMB: 4.9,
    blurb: 'High-tolerance hex-head metric bolt with full threading.',
  },
  {
    id: 'customer-hex-nut',
    label: 'Hex Nut',
    emoji: '⚙️',
    file: '/models/customer/hex-nut.stl',
    kind: 'stl',
    category: 'hardware',
    fileName: 'nut_.stl',
    sizeMB: 0.2,
    blurb: 'Six-sided metric hex nut, chamfered print-in-place threads.',
  },
  {
    id: 'customer-assembly-a',
    label: 'Component Assembly A',
    emoji: '🧩',
    file: '/models/customer/assembly-a.stl',
    kind: 'stl',
    category: 'hardware',
    fileName: 'obj_1_Assembly_A.stl',
    sizeMB: 3.3,
    blurb: 'CAD-verified sub-assembly body (Fusion export).',
  },
  {
    id: 'customer-body-shell',
    label: 'Body Shell 1',
    emoji: '📐',
    file: '/models/customer/body-shell-1.stl',
    kind: 'stl',
    category: 'hardware',
    fileName: 'obj_1_Body1.stl',
    sizeMB: 0.1,
    blurb: 'Thin-wall enclosure shell reference part.',
  },
  {
    id: 'customer-parametric-50',
    label: 'Parametric Model 50',
    emoji: '🧪',
    file: '/models/customer/parametric-model-50.3mf',
    kind: '3mf',
    category: 'hardware',
    fileName: '50.3mf',
    sizeMB: 2.2,
    blurb: 'Parametric Maker-plate part 50 (95k triangles).',
  },

  // ── Art, Décor & Spiritual Sculpture ─────────────────────────────────────
  {
    id: 'customer-nataraja',
    label: 'Nataraja Statue',
    emoji: '🔺',
    file: '/models/customer/nataraja-statue.stl',
    kind: 'stl',
    category: 'art',
    fileName: 'Nataraja.stl',
    sizeMB: 25.5,
    blurb: 'Shiva Nataraja dancer — high-resolution temple sculpture scan.',
    heavy: true,
  },
  {
    id: 'customer-nataraja-brass',
    label: 'Nataraja Brass Bust',
    emoji: '🛕',
    file: '/models/customer/nataraja-brass-square.stl',
    kind: 'stl',
    category: 'art',
    fileName: 'nataraj_brass_white_SQ.stl',
    sizeMB: 42.2,
    blurb: 'Brass-finish Nataraja square-bust — museum-grade 3D scan.',
    heavy: true,
  },
  {
    id: 'customer-sacred-flame',
    label: 'Sacred Flame Om',
    emoji: '🕉️',
    file: '/models/customer/sacred-flame-om.stl',
    kind: 'stl',
    category: 'art',
    fileName: 'obj_1_Meshy_AI_Sacred Flame Om_1790527595_generate.stl',
    sizeMB: 24.7,
    blurb: 'Om symbol embossed in a sacred-flame relief (Meshy AI studio).',
    heavy: true,
  },
  {
    id: 'customer-jellyfish-body',
    label: 'Jellyfish Body',
    emoji: '🪼',
    file: '/models/customer/jellyfish-body.stl',
    kind: 'stl',
    category: 'art',
    fileName: 'obj_1_JellyFish Body @JIMGA.stl',
    sizeMB: 8.2,
    blurb: 'Jellyfish lamp base bell — pairs with the translucent top.',
  },
  {
    id: 'customer-jellyfish-top',
    label: 'Jellyfish Top',
    emoji: '🪼',
    file: '/models/customer/jellyfish-top.stl',
    kind: 'stl',
    category: 'art',
    fileName: 'obj_2_Jellyfish Top @JIMGA.stl',
    sizeMB: 1.7,
    blurb: 'Jellyfish lamp diffuser top (accent part by JIMGA).',
  },

  // ── Signage ──────────────────────────────────────────────────────────────
  {
    id: 'customer-nameplate',
    label: 'Sweeping Nameplate 2-Line',
    emoji: '🪧',
    file: '/models/customer/sweeping-name-plate-2line.3mf',
    kind: '3mf',
    category: 'signage',
    fileName: 'Sweeping_Name_Plate_2line_VH_FontBangers_Whateveritisimagainstit.3mf',
    sizeMB: 2.8,
    blurb: 'Two-line vh_text sweeping-effect raised-letter nameplate.',
  },
];

/** Chips shown in the slicer cockpit's quick-load strip (light, fast loaders first). */
export const CUSTOMER_QUICK_LOAD = [
  'customer-bag-clip',
  'customer-ams-ptfe-plug',
  'customer-hex-nut',
  'customer-hex-bolt',
  'customer-a1-dust-cover-ptfe',
  'customer-dust-cover-filla',
  'customer-usb-a-plug',
  'customer-ac-remote-mount',
  'customer-portafilter',
  'customer-ps4-stand',
  'customer-ps5-joystick-stand',
  'customer-nameplate',
  'customer-jellyfish-top',
  'customer-jellyfish-body',
  'customer-assembly-a',
  'customer-body-shell',
  'customer-parametric-50',
  'customer-sacred-flame',
  'customer-nataraja',
  'customer-nataraja-brass',
];

/**
 * Resolve a gallery entry by id.
 */
export function getCustomerModelById(id) {
  return CUSTOMER_MODEL_GALLERY.find((m) => m.id === id) || null;
}

/**
 * Grouped view for category-filtered UI rails.
 */
export function groupCustomerModelsByCategory() {
  const groups = new Map();
  for (const model of CUSTOMER_MODEL_GALLERY) {
    if (!groups.has(model.category)) groups.set(model.category, []);
    groups.get(model.category).push(model);
  }
  return groups;
}

export default {
  CUSTOMER_MODEL_GALLERY,
  CUSTOMER_QUICK_LOAD,
  getCustomerModelById,
  groupCustomerModelsByCategory,
};
