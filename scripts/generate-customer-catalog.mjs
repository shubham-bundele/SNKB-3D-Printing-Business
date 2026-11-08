/**
 * scripts/generate-customer-catalog.mjs
 *
 * Rebuilds src/data/products.json so the storefront Design Catalog features
 * ONLY the genuine customer design files (public/models/customer/) with
 * honest, engine-derived metadata:
 *
 *   - real mesh dims  : straight from scripts/.customer-model-metrics.json
 *                       (analyze-customer-models.mjs output)
 *   - real mesh volume/area → gram weight + machine-hours + indicative INR
 *     price rounded by the site's own pricing engine (calculateQuote),
 *     guaranteeing the catalog price and the cockpit quote never contradict.
 *   - placeholder poster SVG per product under public/images/products/customer/
 *
 * Run: node scripts/analyze-customer-models.mjs && node scripts/generate-customer-catalog.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { calculateQuote } from '../src/utils/pricingEngine.js';

const METRICS_PATH = path.resolve('scripts/.customer-model-metrics.json');
const POSTER_DIR = path.resolve('public/images/products/customer');
const PRODUCTS_PATH = path.resolve('src/data/products.json');

const metrics = JSON.parse(fs.readFileSync(METRICS_PATH, 'utf8'));
const byFile = new Map(metrics.map((m) => [m.file, m]));

// ---------------------------------------------------------------------------
// Curated storefront copy for every real customer file
// categoryIds map onto the filter pills in src/pages/index.astro
// ---------------------------------------------------------------------------
const META = [
  {
    file: 'bag-clip-6mm.3mf', id: 'bag-clip-6mm',
    name: '6mm Spring Bag Seal Clip',
    category: 'Functional Utility Prints', categoryId: 'utility',
    emoji: '📎', color: '#EA580C',
    features: [
      'Genuine production-ready clasp tensioned for 6mm bags',
      'Printed flat with its spring beam oriented for zero supports',
      'Food-safe PETG upgrade available at checkout',
    ],
    blurb: 'Function-first snap clip that actually seals — printed in tough PLA+ with a live-spring flex beam.',
  },
  {
    file: 'ams-ptfe-plug.stl', id: 'ams-ptfe-plug',
    name: 'AMS PTFE Coupler Snap Plug',
    category: 'Functional Utility Prints', categoryId: 'utility',
    emoji: '🔌', color: '#1E2024',
    features: [
      'Precision snap-fit for Bambu AMS PTFE couplers',
      'Tester-verified ±0.1mm wall tolerance',
      'Runs in under 30 minutes per unit',
    ],
    blurb: 'Tiny-but-precise snap plug that seals AMS PTFE coupler ports against dust and moisture.',
  },
  {
    file: 'a1-dust-cover-ptfe.stl', id: 'a1-dust-cover-ptfe',
    name: 'A1 Mini Dust Cover + PTFE Port',
    category: 'Functional Utility Prints', categoryId: 'utility',
    emoji: '🖨️', color: '#D4D8E0',
    features: [
      'Sized exactly for the A1 Mini filament port',
      'Integrated PTFE pass-through feeding channel',
      'Ships in Charcoal or Concrete Grey PLA+',
    ],
    blurb: 'Dust cover for the A1 printer head with an integrated PTFE feed pass-through.',
  },
  {
    file: 'dust-cover-filla.stl', id: 'dust-cover-filla',
    name: 'Dust Cover Filler Segment',
    category: 'Functional Utility Prints', categoryId: 'utility',
    emoji: '🧱', color: '#2E7D32',
    features: [
      'Completes the modular dust-cover kit geometry',
      'Butt-fits the A1 cover with 0.2mm tolerance',
      'Zero overhang, 0g support material',
    ],
    blurb: 'Filler segment that completes the modular printer dust-cover set flush.',
  },
  {
    file: 'ac-remote-wall-mount.3mf', id: 'ac-remote-wall-mount',
    name: 'Universal AC Remote Wall Mount V2',
    category: 'Functional Utility Prints', categoryId: 'utility',
    emoji: '🌐', color: '#F4F1EA',
    features: [
      'Universal cradle fits most slim AC remotes',
      'V2 reinforcement ribs at the retention lip',
      'Mounts with double-tape or single screw',
    ],
    blurb: 'Updated V2 wall holder sized for air-conditioner remotes, with tuned retention ribs.',
  },
  {
    file: 'usb-a-male-plug.stl', id: 'usb-a-male-plug',
    name: 'USB-A Male Plug Housing',
    category: 'Functional Utility Prints', categoryId: 'utility',
    emoji: '🔗', color: '#0EA5E9',
    features: [
      'Sized for standard USB-A connector shells',
      'Snap-on cap available in accent color',
      'CNC-grade wall finish on exterior surfaces',
    ],
    blurb: 'USB Type-A male plug enclosure shell — ideal for custom cable and gadget builds.',
  },
  {
    file: 'portafilter-holder.3mf', id: 'portafilter-holder',
    name: 'Espresso Portafilter Wall Cradle',
    category: 'Functional Utility Prints', categoryId: 'utility',
    emoji: '☕', color: '#8B5CF6',
    features: [
      'Holds 54–58mm espresso portafilters flush to the wall',
      'Sweep-gradient hook geometry, zero wobble',
      'Kitchen-proof: overhanging drip gutter included',
    ],
    blurb: 'Café-grade wall cradle for espresso portafilters with a drip gutter and clean hook silhouette.',
  },
  {
    file: 'ps4-fat-foot-logo-stand.3mf', id: 'ps4-fat-foot-logo-stand',
    name: 'PS4 Fat-Foot Logo Riser Stand',
    category: 'Gaming Gear Stands', categoryId: 'gaming',
    emoji: '🎮', color: '#2563EB',
    features: [
      'Logo silhouette base doubles as airflow riser',
      'Lifts console bezel for cooler underside intake',
      'Felt-pad ready feet pockets',
    ],
    blurb: 'PlayStation 4 console riser with a fat-foot logo base — better airflow, better shelf look.',
  },
  {
    file: 'ps5-dual-joystick-stand.3mf', id: 'ps5-dual-joystick-stand',
    name: 'PS5 Dual Joystick Display Stand',
    category: 'Gaming Gear Stands', categoryId: 'gaming',
    emoji: '🕹️', color: '#FFFFFF',
    features: [
      'Two controller cradles on one sweeping stem',
      'PS5-logo headstock with dovetail assembly',
      'Anti-slip pads at both bases',
    ],
    blurb: 'Dual PlayStation controller display stand — thick central spine, dovetailed PS5 logo head.',
  },
  {
    file: 'hex-bolt.stl', id: 'hex-bolt',
    name: 'Heavy Hex Head Bolt M-Thread',
    category: 'Maker & Machine Hardware', categoryId: 'hardware',
    emoji: '🔩', color: '#FACC15',
    features: [
      'Golden-ratio thread profile sculpted for functional fit',
      '170mm showcase length for mechanical demos',
      'High-poly 103k-triangle CAD topology',
    ],
    blurb: 'Full-thread hex-head bolt reference part — a precision hardware showpiece.',
  },
  {
    file: 'hex-nut.stl', id: 'hex-nut',
    name: 'Chamfered Hex Nut',
    category: 'Maker & Machine Hardware', categoryId: 'hardware',
    emoji: '⚙️', color: '#FACC15',
    features: [
      'Pairs with the Heavy Hex Bolt set',
      'Chamfered top faces for wrench seating',
      '43g solid brass-look print in Signal Yellow',
    ],
    blurb: 'Six-sided metric hex nut with chamfered wrench seats — matches the hex bolt showpiece.',
  },
  {
    file: 'assembly-a.stl', id: 'assembly-a',
    name: 'Assembly-A Machined Sub-Part',
    category: 'Maker & Machine Hardware', categoryId: 'hardware',
    emoji: '🧩', color: '#94A3B8',
    features: [
      'Fusion-verified 69k-triangle CAD surface',
      '118mm extruded bracket profile',
      'Ideal epoxy-bond structural insert',
    ],
    blurb: 'CAD-verified sub-assembly bracket engineering part for jigs and rigs.',
  },
  {
    file: 'body-shell-1.stl', id: 'body-shell-1',
    name: 'Body Shell-1 Enclosure Skin',
    category: 'Maker & Machine Hardware', categoryId: 'hardware',
    emoji: '📐', color: '#111827',
    features: [
      '56mm thin-wall skin template',
      'Bridging-ready 5mm profile',
      'Sandable for paint finishing',
    ],
    blurb: 'Thin-wall enclosure shell piece for custom enclosure SKUs and surface trials.',
  },
  {
    file: 'parametric-model-50.3mf', id: 'parametric-model-50',
    name: 'Parametric Model-50 Maker Plate',
    category: 'Maker & Machine Hardware', categoryId: 'hardware',
    emoji: '🧪', color: '#22C55E',
    features: [
      '95k-triangle parametric sweep surface',
      '100 × 32 × 24mm stocking size',
      'Single-wall continuous path — low waste',
    ],
    blurb: 'Empirically parametric maker plate from the Parametric Model Maker lab — part #50.',
  },
  {
    file: 'sacred-flame-om.stl', id: 'sacred-flame-om',
    name: 'Sacred Flame Om Wall Relief',
    category: 'Décor, Art & Spiritual', categoryId: 'art',
    emoji: '🕉️', color: '#F97316',
    features: [
      '160mm flame column with embossed Om glyph',
      'Museum-scan topology 518k triangles',
      'Backlight-ready thin flame tips',
    ],
    blurb: 'Om embossed in sculpted sacred-flame relief — living-room statement piece.',
  },
  {
    file: 'nataraja-statue.stl', id: 'nataraja-statue',
    name: 'Shiva Nataraja Heritage Statue',
    category: 'Décor, Art & Spiritual', categoryId: 'art',
    emoji: '🔺', color: '#C08A3E',
    features: [
      '83mm temple-scan statue, brass-tone finish option',
      'Needle-thin ring-of-fire rim printed whole',
      '535k-triangle fine sculpture detail',
    ],
    blurb: 'Shiva Nataraja dancer — a high-resolution temple sculpture scan in weathered brass PLA+.',
  },
  {
    file: 'nataraja-brass-square.stl', id: 'nataraja-brass-square',
    name: 'Nataraja Square-Bust Sculpture',
    category: 'Décor, Art & Spiritual', categoryId: 'art',
    emoji: '🛕', color: '#B08D57',
    features: [
      'Museum-grade 885k-triangle square bust',
      '156mm max dimension flagship print',
      'Metallic-flake brass PLA+ finish in-house',
    ],
    blurb: 'Brass-finish Nataraja square-bust — the flagship heritage sculpture scan of this catalog.',
  },
  {
    file: 'jellyfish-body.stl', id: 'jellyfish-body',
    name: 'Jellyfish Lamp Base Bell',
    category: 'Décor, Art & Spiritual', categoryId: 'art',
    emoji: '🪼', color: '#38BDF8',
    features: [
      '172k-triangle bell for the lamp body',
      'Fits standard puck-LED light inserts',
      'Translucent-tint blue PLA+ option',
    ],
    blurb: 'Jellyfish lamp bell base sculpted by JIMGA — pairs with the translucent diffuser top.',
  },
  {
    file: 'jellyfish-top.stl', id: 'jellyfish-top',
    name: 'Jellyfish Lamp Diffuser Top',
    category: 'Décor, Art & Spiritual', categoryId: 'art',
    emoji: '🪼', color: '#A7F3D0',
    features: [
      'Prints beautifully in translucent filament',
      'Snaps onto the Jellyfish bell body',
      '40mm diameter canopy, 26mm tall',
    ],
    blurb: 'Jellyfish lamp diffuser canopy top (JIMGA accent part).',
  },
  {
    file: 'sweeping-name-plate-2line.3mf', id: 'sweeping-name-plate-2line',
    name: 'Custom Sweeping 2-Line Nameplate',
    category: 'Custom Signage & Nameplates', categoryId: 'signage',
    emoji: '🪧', color: '#EC4899',
    features: [
      'Two-line raised lettering on a sweeping base',
      'Any name/text cut in 8000+ fonts (FontBangers VL)',
      'Standing display, no wall hardware needed',
    ],
    blurb: 'Two-line vh_text sweeping-effect raised-letter nameplate — fully custom on request.',
  },
];

// ---------------------------------------------------------------------------
// Poster placeholder SVGs (shown only until the live WebGL snapshot replaces
// them ~a second after scroll-in). Deliberately honest CAD telemetry styling —
// never a fake illustration of the product.
// ---------------------------------------------------------------------------
function posterSvg(p, m) {
  const b64 = Buffer.from(p.name).toString('base64').slice(0, 26);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" width="400" height="260">
  <defs>
    <pattern id="grid${b64}" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1f2937" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="400" height="260" fill="#0c0e12"/>
  <rect width="400" height="260" fill="url(#grid${b64})"/>
  <text x="200" y="86" text-anchor="middle" font-family="monospace" font-size="64">${p.emoji}</text>
  <text x="200" y="126" text-anchor="middle" font-family="monospace" font-size="15" font-weight="bold" fill="#00FF66">${p.name.toUpperCase()}</text>
  <text x="200" y="152" text-anchor="middle" font-family="monospace" font-size="12" fill="#9ca3af">${m.dimsMm[0].toFixed(0)} × ${m.dimsMm[1].toFixed(0)} × ${m.dimsMm[2].toFixed(0)} mm · ${m.triangles.toLocaleString()} triangles</text>
  <text x="200" y="176" text-anchor="middle" font-family="monospace" font-size="11" fill="#6b7280">REAL ${m.file.endsWith('.3mf') ? '3MF' : 'STL'} MESH · SOLID 3D RENDER ONLINE</text>
  <rect x="16" y="200" width="368" height="1" fill="#374151"/>
  <text x="30" y="222" font-family="monospace" font-size="10" fill="#4b5563">${m.file}</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// Build products
// ---------------------------------------------------------------------------

const NOW_RANKED = ['nataraja-brass-square', 'sweeping-name-plate-2line', 'ps5-dual-joystick-stand', 'sacred-flame-om'];

const products = [];
let rank = 0;
for (const meta of META) {
  const m = byFile.get(meta.file);
  if (!m) throw new Error(`No metrics for ${meta.file} — run analyze-customer-models.mjs first`);
  if (m.notes.some((n) => n.includes('ERROR'))) throw new Error(`Analysis error for ${meta.file}`);

  const [x, y, z] = m.dimsMm;
  const quote = calculateQuote({
    volumeMm3: m.volumeMm3,
    surfaceAreaMm2: m.surfaceAreaMm2,
    dimensions: { x, y, z },
    profile: 'standard',
    material: 'pla',
    supportsEnabled: true,
    supportsTriangles: null,
    overhangAreaMm2: 0,
    hasActiveModel: true,
  });

  const isTrending = NOW_RANKED.includes(meta.id);
  const product = {
    id: meta.id,
    name: meta.name,
    slug: meta.id,
    category: meta.category,
    categoryId: meta.categoryId,
    trendingRank: isTrending ? NOW_RANKED.indexOf(meta.id) + 1 : 50,
    isTrending,
    priceINR: Math.round(quote.totalPriceINR),
    price: Math.round(quote.totalPriceINR),
    currency: 'INR',
    dimensionsMm: { x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2) },
    dimensions: { x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2) },
    dimensionsDisplay: `${(+x.toFixed(2))} × ${(+y.toFixed(2))} × ${(+z.toFixed(2))} mm`,
    weightGrams: +quote.totalWeightGrams.toFixed(1),
    estimatedWeightGrams: +quote.totalWeightGrams.toFixed(1),
    printTimeHours: +quote.totalMachineHours.toFixed(2),
    assemblyType: 'single-piece',
    defaultColors: { primary: meta.color, accent: '#D4D8E0' },
    stlUrl: `/models/customer/${meta.file}`,
    modelUrl: `/models/customer/${meta.file}`,
    material: 'PLA+',
    features: meta.features,
    metaDescription: meta.blurb,
    image: `/images/products/customer/${meta.id}.svg`,
    assemblyLabel: 'Single-Piece Solid Print',
    canExplode: false,
    partCount: 1,
    triangleCount: m.triangles,
    sourceFile: `public/models/customer/${meta.file}`,
  };
  products.push(product);

  fs.mkdirSync(POSTER_DIR, { recursive: true });
  fs.writeFileSync(path.join(POSTER_DIR, `${meta.id}.svg`), posterSvg(meta, m));
}

fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2) + '\n');
console.log(`Wrote ${products.length} products -> ${PRODUCTS_PATH}`);
console.log('Posters -> public/images/products/customer/');

console.log('\nid | ₹ | grams | h | dims');
for (const p of products) {
  console.log(`${p.id} | ₹${p.price} | ${p.weightGrams}g | ${p.printTimeHours}h | ${p.dimensionsDisplay}`);
}
