import React, { useEffect, useState } from 'react';

export default function SharedQuoteView({ initialQuote, quoteId }) {
  const currentPathId = typeof window !== 'undefined' ? window.location.pathname.split('/').filter(Boolean).pop() : null;
  const isActualPathId = Boolean(currentPathId && currentPathId !== 'sample');
  const resolvedId = isActualPathId ? currentPathId : (quoteId || null);

  const [quote, setQuote] = useState(initialQuote || null);
  const [loading, setLoading] = useState(isActualPathId && !initialQuote);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (resolvedId && resolvedId !== 'sample') {
      fetchQuote(resolvedId);
    }
  }, [resolvedId]);

  const fetchQuote = async (idToFetch) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/quote/${idToFetch}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || 'Shared 3D quote not found.');
      } else {
        setQuote(data.quote);
      }
    } catch (err) {
      setError('Failed to retrieve quote details: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyShareLink = () => {
    if (typeof window !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const meta = quote?.meta || {};
  const addOns = meta.addOns || {};
  const dimensions = quote?.dimensions || { x: 50, y: 50, z: 50 };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8">
      {/* Header Bar */}
      <div className="glass-panel rounded-2xl p-6 sm:p-8 shadow-2xl border border-zinc-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#00FF66] animate-pulse"></span>
              <span className="text-xs font-mono uppercase tracking-wider text-[#00FF66] font-semibold">
                Verified 3D Additive Manufacturing Quote
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Quote #{quote?.id || resolvedId || '—'}
            </h1>
            <p className="text-xs text-zinc-400 mt-1 font-mono">
              File: <span className="text-zinc-200 font-semibold">{quote?.fileName || '3D_Model.stl'}</span> • Bambu Lab A1 Mini Specification
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copyShareLink}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-700/80 text-xs font-mono text-zinc-200 transition shadow-sm cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 text-[#FF6500]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span>{copied ? '✓ Link Copied!' : 'Copy Quote Link'}</span>
            </button>

            <a
              href={`/?quote=${quote?.id || resolvedId}`}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#FF6500] hover:bg-[#e55a00] text-black font-extrabold text-xs transition shadow-lg shadow-orange-900/30 cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              <span>Load in 3D Arena & Order</span>
            </a>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="py-12 flex items-center justify-center gap-3 text-zinc-400 text-sm">
            <svg className="animate-spin h-5 w-5 text-[#FF6500]" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
            </svg>
            <span>Retrieving shared 3D quotation parameters...</span>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="my-6 p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200 text-xs">
            <p className="font-semibold">{error}</p>
          </div>
        )}

        {!loading && !error && quote && (
          <div className="py-6 space-y-6">
            {/* Telemetry Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-left">
              <div className="p-3 rounded-xl bg-zinc-950/80 border border-zinc-800/80">
                <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider block">Dimensions</span>
                <span className="text-sm font-mono text-zinc-200 font-semibold mt-0.5 block">
                  {dimensions.x?.toFixed(1)} × {dimensions.y?.toFixed(1)} × {dimensions.z?.toFixed(1)} mm
                </span>
              </div>

              <div className="p-3 rounded-xl bg-zinc-950/80 border border-zinc-800/80">
                <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider block">Estimated Weight</span>
                <span className="text-sm font-mono text-[#00FF66] font-semibold mt-0.5 block">
                  {quote.weightG ? `${quote.weightG.toFixed(1)} g` : 'Calculated in Slicer'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-zinc-950/80 border border-zinc-800/80">
                <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider block">Filament Preset</span>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="w-2.5 h-2.5 rounded-full border border-white/20" style={{ backgroundColor: quote.color === 'Concrete Grey' ? '#8E9296' : quote.color === 'Signal Orange' ? '#f97316' : '#22252a' }}></span>
                  <span className="text-xs font-mono text-zinc-200 font-semibold">{quote.color || 'Concrete Grey'}</span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-zinc-950/80 border border-zinc-800/80">
                <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider block">Quantity</span>
                <span className="text-sm font-mono text-zinc-200 font-semibold mt-0.5 block">
                  {meta.quantity || 1} unit(s)
                </span>
              </div>
            </div>

            {/* Slicer & Value-Added Options */}
            <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800">
              <h3 className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-bold mb-3">
                Selected Manufacturing Specifications
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
                <div>
                  <span className="text-zinc-500">Material Profile:</span>{' '}
                  <span className="text-zinc-200">{meta.material === 'tpu' ? 'Flexible TPU 95A' : 'Tough PLA+ (1.24 g/cm³)'}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Slicer Profile:</span>{' '}
                  <span className="text-zinc-200">{meta.profile === 'draft' ? 'Draft 0.24mm' : meta.profile === 'heavy-duty' ? 'Heavy-Duty 0.16mm' : 'Standard 0.20mm (20% Infill)'}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Plate Texture:</span>{' '}
                  <span className="text-zinc-200">{addOns.buildPlateTexture === 'carbon_fiber' ? 'Carbon Fiber (+₹49)' : addOns.buildPlateTexture === 'smooth_pei' ? 'Smooth PEI' : 'Textured PEI'}</span>
                </div>
                {addOns.heatSetInserts > 0 && (
                  <div>
                    <span className="text-zinc-500">Brass Inserts:</span>{' '}
                    <span className="text-[#FF6500]">{addOns.heatSetInserts}× M3 Brass Inserts (+₹{addOns.heatSetInserts * 15})</span>
                  </div>
                )}
                {addOns.supportSanding && (
                  <div>
                    <span className="text-zinc-500">Post-Processing:</span>{' '}
                    <span className="text-[#00FF66]">Support Sanding & Pre-Assembly (+₹49)</span>
                  </div>
                )}
              </div>
            </div>

            {/* Price Banner */}
            <div className="p-5 rounded-2xl bg-gradient-to-r from-zinc-950 to-zinc-900 border border-[#FF6500]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">Total Quoted Manufacturing Price</span>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-3xl font-extrabold text-[#FF6500] font-mono">
                    ₹{quote.quotedPrice ? quote.quotedPrice.toFixed(2) : '149.00'}
                  </span>
                  <span className="text-xs font-mono text-zinc-500">GST Inclusive • Pan-India Courier Calculated at Checkout</span>
                </div>
              </div>

              <a
                href={`/?quote=${quote?.id || resolvedId}`}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#00FF66] hover:bg-[#00dd55] text-black font-extrabold text-sm transition shadow-lg shadow-emerald-950/50 cursor-pointer"
              >
                <span>Proceed to Order</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
