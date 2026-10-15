/**
 * src/components/materialStressLab.js
 *
 * Interactive Material Stress-Test & Spool Lab.
 *
 * Simulates real mechanical cantilever beam deflection under 0–100 N load
 * across Tough PLA+, PETG / Industrial, and Flexible TPU 95A.
 */

export const MATERIALS_DATA = {
  pla: {
    id: 'pla',
    name: 'Tough PLA+',
    badge: 'Production Default',
    density: '1.24 g/cm³',
    tolerance: '±0.1mm',
    baseRate: '₹2.00 /g',
    accentColor: '#FF6500',
    metrics: {
      rigidity: { label: 'Rigidity / Stiffness', value: 98, display: '98% (Ultra-Rigid)' },
      impact: { label: 'Impact Toughness', value: 68, display: '68% (Impact Modified)' },
      heat: { label: 'Heat Deflection', value: 60, display: '55°C – 60°C' },
      adhesion: { label: 'Layer Adhesion', value: 92, display: '92% (High Fusion)' },
      flexibility: { label: 'Flexibility / Elasticity', value: 12, display: '12% (Low Flex)' },
    },
    beamParams: {
      maxDeflectionMm: 2.2,
      maxAngleDeg: 2.5,
      modulusGpa: 3.5,
      yieldLoadN: 92,
      stressDescription: 'High tensile modulus (3,500 MPa). Deflects minimally under load, then reaches brittle yield.',
      behaviorType: 'ULTRA-RIGID BEAM',
    },
    spools: [
      { name: 'Bambu Orange', hex: '#FF6500' },
      { name: 'Cyber Neon Green', hex: '#00FF66' },
      { name: 'Matte Charcoal', hex: '#1E2229' },
      { name: 'Glacier Cyan', hex: '#00E5FF' },
      { name: 'Arctic White', hex: '#F3F4F6' },
      { name: 'Signal Red', hex: '#EF4444' },
    ],
    recommendedFor: 'ESP32 cases, mechanical keyboard frames, indoor decor, functional prototypes.',
  },
  petg: {
    id: 'petg',
    name: 'PETG / Industrial',
    badge: 'Thermal Stability',
    density: '1.27 g/cm³',
    tolerance: '±0.12mm',
    baseRate: '₹2.50 /g',
    accentColor: '#38bdf8',
    metrics: {
      rigidity: { label: 'Rigidity / Stiffness', value: 80, display: '80% (Structural)' },
      impact: { label: 'Impact Toughness', value: 88, display: '88% (Ductile Shock)' },
      heat: { label: 'Heat Deflection', value: 80, display: '75°C – 80°C' },
      adhesion: { label: 'Layer Adhesion', value: 96, display: '96% (Superior Fusion)' },
      flexibility: { label: 'Flexibility / Elasticity', value: 36, display: '36% (Ductile Flex)' },
    },
    beamParams: {
      maxDeflectionMm: 16.4,
      maxAngleDeg: 18.0,
      modulusGpa: 2.1,
      yieldLoadN: 110,
      stressDescription: 'Ductile high-impact polymer (2,100 MPa). Flexes smoothly without shattering under impact.',
      behaviorType: 'DUCTILE TOUGHNESS',
    },
    spools: [
      { name: 'Signal Orange', hex: '#F97316' },
      { name: 'Stealth Black', hex: '#18181B' },
      { name: 'Translucent Clear', hex: '#E2E8F0' },
      { name: 'Galaxy Blue', hex: '#2563EB' },
    ],
    recommendedFor: 'Outdoor brackets, automotive mounts, self-watering planters, chemical/water containers.',
  },
  tpu: {
    id: 'tpu',
    name: 'Flexible TPU (95A)',
    badge: 'Shock Absorption',
    density: '1.21 g/cm³',
    tolerance: '±0.15mm',
    baseRate: '₹3.50 /g',
    accentColor: '#00FF66',
    metrics: {
      rigidity: { label: 'Rigidity / Stiffness', value: 20, display: '20% (Elastomer)' },
      impact: { label: 'Impact Toughness', value: 100, display: '100% (Indestructible)' },
      heat: { label: 'Heat Deflection', value: 65, display: '60°C – 65°C' },
      adhesion: { label: 'Layer Adhesion', value: 99, display: '99% (Inter-layer Melt)' },
      flexibility: { label: 'Flexibility / Elasticity', value: 98, display: '98% (Shore 95A Rubber)' },
    },
    beamParams: {
      maxDeflectionMm: 74.0,
      maxAngleDeg: 86.0,
      modulusGpa: 0.026,
      yieldLoadN: 999,
      stressDescription: 'Shore 95A thermoplastic polyurethane. Bends 90° like a coil spring with 100% elastic recovery.',
      behaviorType: 'ELASTIC SPRING',
    },
    spools: [
      { name: 'Jet Black', hex: '#111827' },
      { name: 'Safety Yellow', hex: '#EAB308' },
      { name: 'Cyber Red', hex: '#DC2626' },
      { name: 'Translucent Cyan', hex: '#06B6D4' },
    ],
    recommendedFor: 'Keyboard dampening pads, protective bumpers, drone skids, vibration isolators.',
  },
};

export class MaterialStressLab {
  constructor(containerEl) {
    this.container = containerEl;
    this.activeMaterialId = 'pla';
    this.currentLoadN = 45; // default 45N

    // Elements
    this.tabButtons = containerEl.querySelectorAll('.mat-tab-btn');
    this.forceSlider = containerEl.querySelector('.force-load-slider');
    this.forceValDisplay = containerEl.querySelector('.force-val-display');
    this.beamPath = containerEl.querySelector('.beam-svg-path');
    this.beamTipGroup = containerEl.querySelector('.beam-tip-group');
    this.deflectionVal = containerEl.querySelector('.deflection-val');
    this.stressVal = containerEl.querySelector('.stress-val');
    this.behaviorBadge = containerEl.querySelector('.behavior-badge');
    this.matNameDisplay = containerEl.querySelector('.mat-name-display');
    this.matBadgeDisplay = containerEl.querySelector('.mat-badge-display');
    this.matDensityDisplay = containerEl.querySelector('.mat-density-display');
    this.matRateDisplay = containerEl.querySelector('.mat-rate-display');
    this.matRecommendDisplay = containerEl.querySelector('.mat-recommend-display');
    this.selectQuoterBtn = containerEl.querySelector('.select-quoter-btn');
    this.spoolChipsContainer = containerEl.querySelector('.spool-chips-container');

    // Radar / matrix bars
    this.radarBars = {
      rigidity: containerEl.querySelector('.bar-rigidity'),
      impact: containerEl.querySelector('.bar-impact'),
      heat: containerEl.querySelector('.bar-heat'),
      adhesion: containerEl.querySelector('.bar-adhesion'),
      flexibility: containerEl.querySelector('.bar-flexibility'),
    };
    this.radarVals = {
      rigidity: containerEl.querySelector('.val-rigidity'),
      impact: containerEl.querySelector('.val-impact'),
      heat: containerEl.querySelector('.val-heat'),
      adhesion: containerEl.querySelector('.val-adhesion'),
      flexibility: containerEl.querySelector('.val-flexibility'),
    };

    this.bindEvents();
    this.updateMaterial(this.activeMaterialId);
  }

  bindEvents() {
    // 1. Material Tab switching
    this.tabButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const matId = btn.getAttribute('data-mat');
        if (!matId || !MATERIALS_DATA[matId]) return;

        this.tabButtons.forEach((b) => {
          b.classList.remove('active', 'border-[#FF6500]', 'border-sky-400', 'border-[#00FF66]', 'bg-black', 'text-white');
          b.classList.add('border-zinc-800', 'text-zinc-400');
        });

        const activeBorder = matId === 'pla' ? 'border-[#FF6500]' : matId === 'petg' ? 'border-sky-400' : 'border-[#00FF66]';
        btn.classList.add('active', activeBorder, 'bg-black', 'text-white');
        btn.classList.remove('border-zinc-800', 'text-zinc-400');

        this.updateMaterial(matId);
      });
    });

    // 2. Force Load Slider
    if (this.forceSlider) {
      this.forceSlider.addEventListener('input', (e) => {
        this.currentLoadN = parseFloat(e.target.value);
        if (this.forceValDisplay) {
          this.forceValDisplay.textContent = `${Math.round(this.currentLoadN)} N`;
        }
        this.updateBeamSimulation();
      });
    }

    // 3. Select Material in Quoter CTA
    if (this.selectQuoterBtn) {
      this.selectQuoterBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const matData = MATERIALS_DATA[this.activeMaterialId];
        window.dispatchEvent(
          new CustomEvent('snkb:select-material', {
            detail: {
              materialId: this.activeMaterialId,
              name: matData.name,
              density: matData.density,
              rate: matData.baseRate,
            },
          })
        );
        const quoteSection = document.getElementById('instant-quote');
        if (quoteSection) {
          quoteSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }
  }

  updateMaterial(matId) {
    this.activeMaterialId = matId;
    const data = MATERIALS_DATA[matId];
    if (!data) return;

    // Header info
    if (this.matNameDisplay) this.matNameDisplay.textContent = data.name;
    if (this.matBadgeDisplay) {
      this.matBadgeDisplay.textContent = data.badge;
      this.matBadgeDisplay.style.color = data.accentColor;
    }
    if (this.matDensityDisplay) this.matDensityDisplay.textContent = `Density: ${data.density} • ${data.tolerance} Tolerance`;
    if (this.matRateDisplay) this.matRateDisplay.textContent = `From ${data.baseRate}`;
    if (this.matRecommendDisplay) this.matRecommendDisplay.textContent = `Recommended: ${data.recommendedFor}`;

    // Update Progress Matrix Bars
    Object.keys(this.radarBars).forEach((key) => {
      const bar = this.radarBars[key];
      const valEl = this.radarVals[key];
      const metric = data.metrics[key];
      if (bar && metric) {
        bar.style.width = `${metric.value}%`;
        bar.style.backgroundColor = data.accentColor;
      }
      if (valEl && metric) {
        valEl.textContent = metric.display;
      }
    });

    // Update Spool Chips
    if (this.spoolChipsContainer) {
      this.spoolChipsContainer.innerHTML = '';
      data.spools.forEach((spool, idx) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `spool-chip flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all text-[10px] font-mono cursor-pointer ${
          idx === 0 ? 'border-white ring-1 ring-white/50 text-white bg-black/70' : 'border-zinc-800 text-zinc-400 hover:text-white bg-zinc-950/60'
        }`;
        chip.title = `${spool.name} (${data.name})`;
        chip.innerHTML = `
          <span class="w-3 h-3 rounded-full border border-white/20 shrink-0" style="background-color: ${spool.hex};"></span>
          <span>${spool.name}</span>
        `;
        chip.addEventListener('click', (e) => {
          e.preventDefault();
          this.spoolChipsContainer.querySelectorAll('.spool-chip').forEach((c) => {
            c.classList.remove('border-white', 'ring-1', 'ring-white/50', 'text-white', 'bg-black/70');
            c.classList.add('border-zinc-800', 'text-zinc-400');
          });
          chip.classList.add('border-white', 'ring-1', 'ring-white/50', 'text-white', 'bg-black/70');
          chip.classList.remove('border-zinc-800', 'text-zinc-400');
        });
        this.spoolChipsContainer.appendChild(chip);
      });
    }

    // Refresh beam simulation
    this.updateBeamSimulation();
  }

  updateBeamSimulation() {
    const data = MATERIALS_DATA[this.activeMaterialId];
    if (!data) return;

    const loadRatio = Math.max(0, Math.min(this.currentLoadN / 100, 1));
    const maxDefl = data.beamParams.maxDeflectionMm;
    const maxAngle = data.beamParams.maxAngleDeg;

    // Deflection & angle
    const deflectionMm = loadRatio * maxDefl;
    const angleDeg = loadRatio * maxAngle;

    // Calculate Stress (MPa)
    const baseStress = Math.round(loadRatio * (this.activeMaterialId === 'pla' ? 76 : this.activeMaterialId === 'petg' ? 48 : 18));

    if (this.deflectionVal) {
      this.deflectionVal.textContent = `${deflectionMm.toFixed(1)} mm (${angleDeg.toFixed(1)}°)`;
    }
    if (this.stressVal) {
      this.stressVal.textContent = `${baseStress} MPa`;
    }
    if (this.behaviorBadge) {
      this.behaviorBadge.textContent = data.beamParams.behaviorType;
      this.behaviorBadge.style.color = data.accentColor;
    }

    // Compute SVG Cantilever Beam Geometry
    // Beam starts at (X=30, Y=70), total length L=220 px
    const startX = 35;
    const startY = 70;
    const beamLength = 230;

    // Vertical deflection in SVG pixels (scale deflection for high visual clarity)
    // Scale: 1mm deflection in PLA -> ~3px, TPU 74mm -> 85px max
    const visualDeflectionPx = this.activeMaterialId === 'pla'
      ? deflectionMm * 3.5
      : this.activeMaterialId === 'petg'
      ? deflectionMm * 2.8
      : Math.min(deflectionMm * 1.15, 88);

    // Tip coordinates
    const tipX = startX + beamLength - (visualDeflectionPx * 0.25);
    const tipY = startY + visualDeflectionPx;

    // Control point 1 and 2 for realistic cantilever bending curve
    const cp1X = startX + (beamLength * 0.45);
    const cp1Y = startY;
    const cp2X = startX + (beamLength * 0.8);
    const cp2Y = startY + (visualDeflectionPx * 0.65);

    // Beam top curve & bottom curve for realistic thickness
    const beamThickness = 12;
    const pathD = `
      M ${startX} ${startY - beamThickness / 2}
      C ${cp1X} ${cp1Y - beamThickness / 2}, ${cp2X} ${cp2Y - beamThickness / 2}, ${tipX} ${tipY - beamThickness / 2}
      L ${tipX} ${tipY + beamThickness / 2}
      C ${cp2X} ${cp2Y + beamThickness / 2}, ${cp1X} ${cp1Y + beamThickness / 2}, ${startX} ${startY + beamThickness / 2}
      Z
    `;

    if (this.beamPath) {
      this.beamPath.setAttribute('d', pathD);
      this.beamPath.setAttribute('fill', data.accentColor);
      this.beamPath.setAttribute('fill-opacity', '0.85');
      this.beamPath.setAttribute('stroke', data.accentColor);
    }

    if (this.beamTipGroup) {
      this.beamTipGroup.setAttribute('transform', `translate(${tipX}, ${tipY})`);
    }
  }
}

export function initMaterialStressLab() {
  const container = document.querySelector('.material-stress-lab');
  if (container && !container.__stressLabInstance) {
    container.__stressLabInstance = new MaterialStressLab(container);
  }
}
