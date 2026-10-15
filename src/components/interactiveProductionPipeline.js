/**
 * src/components/interactiveProductionPipeline.js
 *
 * Interactive 4-Stage Production Pipeline Controller:
 * - Card 01: Interactive geometry bounding box snap & volume verification
 * - Card 02: Interactive overhang hazard slerp (red -> green auto-orientation)
 * - Card 03: Animated infill toolpath extruder & nozzle temperature telemetry
 * - Card 04: Pan-India express delivery timeline selector with carrier telemetry
 */

export class ProductionPipelineController {
  constructor(containerEl) {
    this.container = containerEl;

    // Card 01 elements
    this.card1 = containerEl.querySelector('.pipeline-card-01');
    this.bboxStatus = containerEl.querySelector('.bbox-status-text');

    // Card 02 elements
    this.card2 = containerEl.querySelector('.pipeline-card-02');
    this.orientToggleBtn = containerEl.querySelector('.pipeline-orient-btn');
    this.overhangSvgPart = containerEl.querySelector('.overhang-svg-part');
    this.overhangBadge = containerEl.querySelector('.overhang-badge');
    this.overhangPrice = containerEl.querySelector('.overhang-price');
    this.isOriented = false;

    // Card 03 elements
    this.card3 = containerEl.querySelector('.pipeline-card-03');
    this.nozzleHead = containerEl.querySelector('.nozzle-svg-head');
    this.infillLines = containerEl.querySelectorAll('.infill-line-svg');
    this.layerCounter = containerEl.querySelector('.pipeline-layer-counter');

    // Card 04 elements
    this.card4 = containerEl.querySelector('.pipeline-card-04');
    this.pincodeChips = containerEl.querySelectorAll('.pin-quick-chip');
    this.etaDisplay = containerEl.querySelector('.pipeline-eta-display');
    this.carrierDisplay = containerEl.querySelector('.pipeline-carrier-display');

    this.bindEvents();
    this.startNozzleAnimation();
  }

  bindEvents() {
    // Card 01: Hover snap effect
    if (this.card1) {
      this.card1.addEventListener('mouseenter', () => {
        if (this.bboxStatus) {
          this.bboxStatus.textContent = 'WATERTIGHT • MESH VALIDATED';
          this.bboxStatus.classList.remove('text-zinc-400');
          this.bboxStatus.classList.add('text-[#00FF66]');
        }
      });
      this.card1.addEventListener('mouseleave', () => {
        if (this.bboxStatus) {
          this.bboxStatus.textContent = 'AUTO-INTEGRATED BBOX';
          this.bboxStatus.classList.remove('text-[#00FF66]');
          this.bboxStatus.classList.add('text-zinc-400');
        }
      });
    }

    // Card 02: Interactive Auto-Orient toggle
    if (this.orientToggleBtn) {
      this.orientToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleOrientation();
      });
    }
    if (this.card2) {
      this.card2.addEventListener('mouseenter', () => {
        if (!this.isOriented) {
          this.toggleOrientation(true);
        }
      });
    }

    // Card 04: Pincode / City Quick Chips
    this.pincodeChips.forEach((chip) => {
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        const city = chip.getAttribute('data-city');
        const eta = chip.getAttribute('data-eta');
        const carrier = chip.getAttribute('data-carrier');

        this.pincodeChips.forEach((c) => {
          c.classList.remove('active', 'border-[#FF6500]', 'text-white', 'bg-black');
          c.classList.add('border-zinc-800', 'text-zinc-400');
        });
        chip.classList.add('active', 'border-[#FF6500]', 'text-white', 'bg-black');
        chip.classList.remove('border-zinc-800', 'text-zinc-400');

        if (this.etaDisplay) {
          this.etaDisplay.textContent = `${city}: ${eta}`;
        }
        if (this.carrierDisplay) {
          this.carrierDisplay.textContent = carrier || 'Blue Dart Air Express';
        }
      });
    });
  }

  toggleOrientation(forceOriented = null) {
    this.isOriented = forceOriented !== null ? forceOriented : !this.isOriented;

    if (this.overhangSvgPart) {
      if (this.isOriented) {
        // Rotated 90 deg: Lay flat on plate
        this.overhangSvgPart.setAttribute('transform', 'rotate(90, 75, 45) translate(-10, -5)');
        this.overhangSvgPart.setAttribute('fill', '#00FF66');
        this.overhangSvgPart.setAttribute('stroke', '#00FF66');
      } else {
        // Standing upright with overhang
        this.overhangSvgPart.setAttribute('transform', 'rotate(0, 75, 45)');
        this.overhangSvgPart.setAttribute('fill', '#FF5147');
        this.overhangSvgPart.setAttribute('stroke', '#FF5147');
      }
    }

    if (this.overhangBadge) {
      if (this.isOriented) {
        this.overhangBadge.textContent = 'SUPPORTS: 0.0% (OPTIMAL)';
        this.overhangBadge.className = 'overhang-badge telemetry text-[9px] text-[#00FF66] bg-[#00FF66]/10 px-1.5 py-0.5 rounded border border-[#00FF66]/30';
      } else {
        this.overhangBadge.textContent = 'OVERHANGS: 28% (REPAIR)';
        this.overhangBadge.className = 'overhang-badge telemetry text-[9px] text-[#FF5147] bg-[#FF5147]/10 px-1.5 py-0.5 rounded border border-[#FF5147]/30';
      }
    }

    if (this.overhangPrice) {
      this.overhangPrice.textContent = this.isOriented ? '₹149' : '₹189';
    }

    if (this.orientToggleBtn) {
      this.orientToggleBtn.textContent = this.isOriented ? 'Reset Tilt' : 'Test Auto-Orient';
    }
  }

  startNozzleAnimation() {
    let step = 0;
    let currentLayer = 142;
    setInterval(() => {
      step = (step + 1) % 4;
      if (step === 0) {
        currentLayer = 100 + Math.floor(Math.random() * 80);
        if (this.layerCounter) {
          this.layerCounter.textContent = `L-${currentLayer} / 280 (0.16mm)`;
        }
      }

      if (this.infillLines && this.infillLines.length > 0) {
        this.infillLines.forEach((line, i) => {
          if (i <= step) {
            line.setAttribute('opacity', '1');
          } else {
            line.setAttribute('opacity', '0.2');
          }
        });
      }

      if (this.nozzleHead) {
        const xOffset = 30 + (step * 24);
        const yOffset = 25 + (step % 2 === 0 ? 0 : 8);
        this.nozzleHead.setAttribute('transform', `translate(${xOffset}, ${yOffset})`);
      }
    }, 600);
  }
}

export function initProductionPipeline() {
  const container = document.querySelector('.interactive-production-pipeline');
  if (container && !container.__pipelineInstance) {
    container.__pipelineInstance = new ProductionPipelineController(container);
  }
}
