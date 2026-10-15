import React, { useState, useEffect } from 'react';
import UpiPaymentQr, { buildWhatsAppShareUrl } from './UpiPaymentQr';

const STEPS = [
  { key: 'Submitted', label: 'Submitted', description: 'Quote confirmed & queued' },
  { key: 'Slicing', label: 'Slicing', description: 'Toolpath & G-code generated' },
  { key: 'Printing', label: 'Printing', description: 'Precision FDM extrusion in progress' },
  { key: 'Completed', label: 'Completed / Shipped', description: 'QA verified & dispatched' },
];

function getActiveStepIndex(status) {
  switch (status) {
    case 'Pending':
      return 0; // Submitted
    case 'Slicing':
      return 1; // Slicing
    case 'Printing':
      return 2; // Printing
    case 'Completed':
    case 'Shipped':
      return 3; // Completed / Shipped
    default:
      return 0;
  }
}

export default function TrackingView({ initialOrder, orderId }) {
  // If running in browser and URL has a specific ID (not 'sample'), prioritize that over static prerendered prop
  const currentPathId = typeof window !== 'undefined' ? window.location.pathname.split('/').filter(Boolean).pop() : null;
  const isActualPathId = Boolean(currentPathId && currentPathId !== 'sample');

  const resolvedId = isActualPathId ? currentPathId : (orderId || null);
  const [order, setOrder] = useState(isActualPathId && initialOrder?.id === 'SAMPLE' ? null : (initialOrder || null));
  const [loading, setLoading] = useState(isActualPathId && initialOrder?.id === 'SAMPLE');
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const fetchOrder = async (idToFetch) => {
    if (!idToFetch || idToFetch === 'sample') return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/orders/${idToFetch}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || 'Order not found.');
      } else {
        setOrder(data.order);
      }
    } catch (err) {
      setError('Could not connect to tracking server: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Always revalidate numeric order IDs against live telemetry on mount:
    // a statically prerendered page may predate the latest DB state (or come
    // from a different database entirely), so static props are only ever a
    // placeholder until the fetch below resolves. Failures keep the static
    // snapshot (fetchOrder only overwrites on success).
    if (resolvedId && resolvedId !== 'sample') {
      fetchOrder(resolvedId);
    }
  }, [resolvedId]);

  const copyReferenceId = () => {
    const ref = order ? `SNKB-ORD-${order.id}` : `SNKB-ORD-${resolvedId}`;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(ref);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const activeIndex = getActiveStepIndex(order?.status);
  const isCancelled = order?.status === 'Cancelled';

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8">
      {/* Top Header Card */}
      <div className="glass-panel rounded-2xl p-4 sm:p-8 shadow-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-xs font-mono uppercase tracking-wider text-emerald-400 font-semibold">
                Live Order Tracking
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Order #{order?.id || resolvedId || '—'}
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              SNKB 3D Studio Production Line • Dedicated PLA+ Print Run
            </p>
          </div>

          <div className="flex flex-col sm:items-end gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={copyReferenceId}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-700/80 text-xs font-mono text-zinc-200 transition shadow-sm cursor-pointer"
                title="Click to copy Order Reference ID"
              >
                <svg className="w-3.5 h-3.5 text-[#FF6500]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>Ref: SNKB-ORD-{order?.id || resolvedId}</span>
                {copied ? (
                  <span className="text-[10px] text-emerald-400 font-semibold">✓ Copied!</span>
                ) : (
                  <span className="text-[10px] text-zinc-500">Copy</span>
                )}
              </button>

              <a
                href={buildWhatsAppShareUrl({
                  orderId: order?.id || resolvedId,
                  fileName: order?.fileName,
                  grandTotal: order?.grandTotal ?? order?.quotedPrice,
                  deliveryPincode: order?.deliveryPincode,
                  paymentMode: order?.paymentMode,
                  utr: order?.paymentUtr,
                  trackingUrl: typeof window !== 'undefined' ? window.location.href : '',
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] text-black font-bold text-xs transition shadow-sm cursor-pointer no-print"
                title="Share order summary & live tracking link on WhatsApp"
              >
                <svg className="w-3.5 h-3.5 fill-current shrink-0" viewBox="0 0 24 24">
                  <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86s.275.072.376-.044c.101-.116.433-.506.549-.68.116-.173.231-.145.39-.087s1.011.477 1.184.564.289.13.332.202c.043.073.043.419-.101.824z" />
                  <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.98-1.309A9.957 9.957 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18.167c-1.636 0-3.15-.49-4.417-1.332l-.317-.208-2.962.777.791-2.89-.228-.363C3.967 15.008 3.5 13.553 3.5 12c0-4.687 3.813-8.5 8.5-8.5s8.5 3.813 8.5 8.5-3.813 8.5-8.5 8.5z" />
                </svg>
                <span>Share Order on WhatsApp</span>
              </a>

              <button
                type="button"
                onClick={() => typeof window !== 'undefined' && window.print()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-emerald-500/40 text-emerald-300 font-mono text-xs transition shadow-sm cursor-pointer no-print"
                title="Download or Print Official B2B Estimate / Tax Receipt"
              >
                <svg className="w-3.5 h-3.5 text-[#00FF66] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                <span>Download Official Estimate / Receipt (PDF)</span>
              </button>
            </div>
            {order?.createdAt && (
              <span className="text-[11px] text-zinc-500 font-mono">
                Placed: {new Date(order.createdAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {/* Loading Spinner */}
        {loading && (
          <div className="py-12 flex items-center justify-center gap-3 text-zinc-400 text-sm">
            <svg className="animate-spin h-5 w-5 text-[#FF6500]" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
            </svg>
            <span>Retrieving live manufacturing telemetry...</span>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="my-6 p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200 text-xs flex items-center gap-3">
            <svg className="w-5 h-5 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="font-semibold">{error}</p>
              <p className="text-zinc-400 mt-0.5">Please check your Order ID and try again.</p>
            </div>
          </div>
        )}

        {/* Stepper / Progress Workflow */}
        {!loading && !error && (
          <div className="py-8">
            <h2 className="text-sm font-semibold text-zinc-200 mb-6 uppercase tracking-wider font-mono">
              Manufacturing Pipeline Status
            </h2>

            {isCancelled ? (
              <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200 text-sm">
                <span className="font-bold">Order Cancelled:</span> This print job was marked cancelled by shop administration.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 relative">
                {STEPS.map((step, idx) => {
                  const isPast = idx < activeIndex;
                  const isCurrent = idx === activeIndex;

                  return (
                    <div
                      key={step.key}
                      className={`relative p-4 rounded-xl border transition ${
                        isCurrent
                          ? 'bg-[#FF6500]/10 border-[#FF6500] shadow-lg shadow-orange-900/20'
                          : isPast
                          ? 'bg-zinc-950/60 border-zinc-800 text-zinc-300'
                          : 'bg-zinc-950/20 border-zinc-800/40 text-zinc-500'
                      }`}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center font-mono text-xs font-bold shrink-0 ${
                            isCurrent
                              ? 'bg-[#FF6500] text-black animate-pulse'
                              : isPast
                              ? 'bg-emerald-600 text-white'
                              : 'bg-zinc-800 text-zinc-500'
                          }`}
                        >
                          {isPast ? '✓' : idx + 1}
                        </div>
                        <span
                          className={`text-sm font-bold tracking-tight ${
                            isCurrent ? 'text-white' : isPast ? 'text-zinc-200' : 'text-zinc-500'
                          }`}
                        >
                          {step.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 pl-10 leading-relaxed">
                        {step.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Summary Metrics & Specifications Grid */}
      {order && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 lg:gap-6">
          {/* Card A: 3D Part Metrics */}
          <div className="glass-panel rounded-2xl p-4 sm:p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#FF6500]"></span>
                <span>Geometry & Material Metrics</span>
              </h3>
              <span className="text-[10px] font-mono text-zinc-500 uppercase">Production Farm</span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Uploaded File (STL)</span>
                <span className="font-mono text-zinc-200 font-semibold truncate max-w-xs" title={order.fileName}>
                  {order.fileName || 'model.stl'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Bounding Box Dimensions</span>
                <span className="font-mono text-zinc-200">
                  {order.dimensions
                    ? `${Number(order.dimensions.x).toFixed(1)} × ${Number(order.dimensions.y).toFixed(1)} × ${Number(order.dimensions.z).toFixed(1)} mm`
                    : '142 × 142 × 110 mm'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Calculated Volume</span>
                <span className="font-mono text-zinc-200">
                  {order.volumeMm3 ? order.volumeMm3.toLocaleString() : '62,500'} mm³
                  <span className="text-zinc-500 ml-1">
                    ({order.volumeMm3 ? (order.volumeMm3 / 1000).toFixed(1) : '62.5'} cm³)
                  </span>
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Calculated Weight</span>
                <span className="font-mono text-zinc-200 font-semibold">
                  {order.weightG ? Number(order.weightG).toFixed(2) : '77.5'} g
                  <span className="text-zinc-500 font-normal ml-1">(PLA+ @ 1.24 g/cm³)</span>
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Model Filament</span>
                <span className="font-mono text-zinc-200">
                  {order.partWeightG != null ? `${Number(order.partWeightG).toFixed(1)} g` : '—'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Support Material</span>
                <span className="font-mono text-zinc-200">
                  {(order.supportsEnabled === false) ? (
                    <span className="text-amber-300">Without supports{(order.supportWeightG > 0) ? ` (needs ${Number(order.supportWeightG).toFixed(1)} g)` : ''}</span>
                  ) : (order.supportWeightG > 0) ? (
                    <span className="text-emerald-300">{Number(order.supportWeightG).toFixed(1)} g · with supports</span>
                  ) : (
                    <span className="text-zinc-400">0 g · print-in-place</span>
                  )}
                </span>
              </div>

              {(order.material || order.layerHeightMm) && (
                <div className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                  <span className="text-zinc-400">Slicer Spec</span>
                  <span className="font-mono text-zinc-200">
                    {order.material ? String(order.material).toUpperCase() : 'PLA'}{order.layerHeightMm ? ` · ${Number(order.layerHeightMm).toFixed(2)}mm` : ''}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Selected Color</span>
                <span className="font-mono text-[#FF6500] font-semibold">
                  {order.color || 'Concrete Grey'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 pt-2">
                <span className="text-sm font-semibold text-white">Quoted Price</span>
                <span className="font-mono text-lg font-bold text-emerald-400">
                  ₹{order.quotedPrice ? Number(order.quotedPrice).toFixed(2) : '149.00'}{' '}
                  <span className="text-xs font-normal text-zinc-400">INR</span>
                </span>
              </div>

              {order.deliveryCharge !== null && order.deliveryCharge !== undefined && (
                <>
                  <div className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                    <span className="text-zinc-400">
                      Delivery{order.deliveryPincode ? ` to ${order.deliveryPincode}` : ''}
                      {order.deliveryZone
                        ? ` (${order.deliveryZone === 'metro' ? 'Metro' : 'Standard'})`
                        : ''}
                    </span>
                    <span className="font-mono text-zinc-200">
                      {Number(order.deliveryCharge) === 0 ? (
                        <span className="text-emerald-400 font-semibold">FREE</span>
                      ) : (
                        <>₹{Number(order.deliveryCharge).toFixed(2)}</>
                      )}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-1 pt-2">
                    <span className="text-sm font-semibold text-white">Grand Total</span>
                    <span className="font-mono text-lg font-bold text-white">
                      ₹{order.grandTotal !== null && order.grandTotal !== undefined ? Number(order.grandTotal).toFixed(2) : Number(order.quotedPrice || 0).toFixed(2)}{' '}
                      <span className="text-xs font-normal text-zinc-400">INR</span>
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Card B: Customer & Production Notes */}
          <div className="glass-panel rounded-2xl p-4 sm:p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span>Fulfillment & Customer Details</span>
              </h3>
              <span className="text-[10px] font-mono text-zinc-500 uppercase">Confidential</span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Customer Name</span>
                <span className="text-zinc-200 font-medium">{order.customerName || 'Guest'}</span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Contact Email</span>
                <span className="font-mono text-zinc-300">{order.customerEmail || '—'}</span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Payment Mode</span>
                {order.paymentMode === 'COD' ? (
                  <span className="inline-flex items-center gap-1 font-mono text-amber-300 font-semibold text-[11px]">
                    <span>₹</span> Cash on Delivery
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-mono text-emerald-300 font-semibold text-[11px]">
                    <span>✓</span> Prepaid · UPI
                  </span>
                )}
              </div>

              {order.paymentUtr && (
                <div className="flex items-center justify-between py-1 border-b border-zinc-800/60 font-mono">
                  <span className="text-zinc-400">Payment UTR / Txn ID</span>
                  <span className="text-[#00FF66] font-semibold text-[11px] flex items-center gap-1">
                    <span>✓</span> {order.paymentUtr}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Quality & Fit Verification</span>
                <span className="inline-flex items-center gap-1 text-emerald-400 font-medium font-mono text-[11px]">
                  <span>✓</span> Precision Sliced & Verified
                </span>
              </div>

              <div className="py-1">
                <span className="text-zinc-400 block mb-1">Customer / Slicing Notes</span>
                <p className="text-zinc-300 italic bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 text-[11px] leading-relaxed">
                  {order.notes || 'Standard 0.20mm layer height, 15% gyroid infill requested.'}
                </p>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => fetchOrder(order.id)}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold border border-zinc-700 transition flex items-center gap-1.5 cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Refresh Telemetry</span>
                </button>

                <a
                  href="/#instant-quote"
                  className="text-xs text-[#FF6500] hover:text-[#FF6500] transition font-medium"
                >
                  Upload Another Model →
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic UPI Payment QR & Verification Module (shown for Prepaid orders) */}
      {/* Dynamic UPI Payment QR & Verification Module (shown for Prepaid orders) */}
      {order && order.paymentMode !== 'COD' && (
        <div className="pt-2 no-print">
          <UpiPaymentQr
            orderId={order.id}
            amount={
              order.grandTotal !== null && order.grandTotal !== undefined
                ? order.grandTotal
                : order.quotedPrice
            }
            fileName={order.fileName}
            deliveryPincode={order.deliveryPincode}
            paymentMode={order.paymentMode}
            initialUtr={order.paymentUtr}
            onUtrSaved={(newUtr) => setOrder((prev) => ({ ...prev, paymentUtr: newUtr }))}
          />
        </div>
      )}

      {/* Official B2B Estimate / Tax Receipt (Rendered on Print) */}
      {order && (
        <div id="printable-invoice" className="hidden print:block bg-white text-black p-8 font-sans max-w-4xl mx-auto border-2 border-black">
          {/* Studio Header */}
          <div className="flex justify-between items-start border-b-2 border-black pb-4 mb-6">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-black uppercase">SNKB 3D Studio</h1>
              <p className="text-xs text-neutral-700 font-mono">Additive Manufacturing & Precision Rapid Prototyping</p>
              <p className="text-xs text-neutral-600 mt-1 font-mono">New Delhi Production Hub • Pan-India Fulfillment • GSTIN: 07AAAAA0000A1Z5</p>
            </div>
            <div className="text-right">
              <span className="inline-block bg-black text-white text-xs font-bold px-3 py-1 uppercase tracking-wider mb-1">
                Official Estimate / Tax Invoice
              </span>
              <p className="text-xs font-mono font-bold text-black mt-1">Invoice Ref: INV-SNKB-{order.id}</p>
              <p className="text-xs text-neutral-600 font-mono">Date: {order.createdAt ? new Date(order.createdAt).toLocaleDateString() : new Date().toLocaleDateString()}</p>
            </div>
          </div>

          {/* Client & Dispatch Information */}
          <div className="grid grid-cols-2 gap-6 pb-6 mb-6 border-b border-neutral-300 text-xs">
            <div>
              <h3 className="font-bold uppercase tracking-wider text-neutral-800 font-mono mb-2">Billed & Shipped To:</h3>
              <p className="font-bold text-sm text-black">{order.customerName || 'Guest Customer'}</p>
              <p className="text-neutral-700">{order.customerEmail || 'support@snkb3d.in'}</p>
              <p className="text-neutral-700 mt-1">
                Destination PIN: <span className="font-mono font-bold">{order.deliveryPincode || 'National Delivery'}</span> ({order.deliveryZone === 'metro' ? 'Metro Air Express' : 'Regional Express Surface'})
              </p>
            </div>
            <div>
              <h3 className="font-bold uppercase tracking-wider text-neutral-800 font-mono mb-2">Manufacturing Fleet Parameters:</h3>
              <p className="text-neutral-800"><span className="font-semibold">Production Fleet:</span> Scalable High-Precision FDM Farm</p>
              <p className="text-neutral-800"><span className="font-semibold">Material Spec:</span> Tough PLA+ / Technical PETG (1.24 g/cm³)</p>
              <p className="text-neutral-800"><span className="font-semibold">Dimensional Tolerance:</span> ±0.1 mm (0.08mm - 0.28mm layers)</p>
            </div>
          </div>

          {/* Itemized Manufacturing Line Items */}
          <table className="w-full text-left text-xs mb-6 border-collapse">
            <thead>
              <tr className="border-b-2 border-black bg-neutral-100 font-mono font-bold">
                <th className="py-2.5 px-3">Item #</th>
                <th className="py-2.5 px-3">Part Description & Specifications</th>
                <th className="py-2.5 px-3 text-center">Part Dimensions</th>
                <th className="py-2.5 px-3 text-center">Weight</th>
                <th className="py-2.5 px-3 text-right">Amount (₹ INR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              <tr>
                <td className="py-3 px-3 font-mono font-bold align-top">01</td>
                <td className="py-3 px-3 align-top">
                  <p className="font-bold text-black text-sm">{order.fileName || 'Custom 3D Engineered Prototype'}</p>
                  <p className="text-neutral-600 text-[11px] mt-0.5 font-mono">
                    Color: {order.color || 'Concrete Grey'} • Slicer Infill: 20% Standard Gyroid • Solid Shells: 3 Walls
                  </p>
                  {order.notes && (
                    <p className="text-neutral-500 text-[10px] mt-1 italic">
                      Specifications: {order.notes}
                    </p>
                  )}
                </td>
                <td className="py-3 px-3 text-center font-mono align-top">
                  {order.dimensions?.x?.toFixed(1) || '—'} × {order.dimensions?.y?.toFixed(1) || '—'} × {order.dimensions?.z?.toFixed(1) || '—'} mm
                </td>
                <td className="py-3 px-3 text-center font-mono align-top">
                  {order.weightG ? `${order.weightG.toFixed(1)} g` : '—'}
                </td>
                <td className="py-3 px-3 text-right font-mono font-bold text-black align-top">
                  ₹{Number(order.quotedPrice || 0).toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Totals & Freight Block */}
          <div className="flex justify-end mb-8">
            <div className="w-64 space-y-2 text-xs border-t-2 border-black pt-3">
              <div className="flex justify-between">
                <span className="text-neutral-600 font-mono">Print Manufacturing:</span>
                <span className="font-mono font-bold text-black">₹{Number(order.quotedPrice || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-600 font-mono">Pan-India Freight (Delhivery/Blue Dart):</span>
                <span className="font-mono font-bold text-black">
                  {order.deliveryCharge && order.deliveryCharge > 0 ? `₹${Number(order.deliveryCharge).toFixed(2)}` : 'FREE (₹0.00)'}
                </span>
              </div>
              <div className="flex justify-between border-t border-black pt-2 text-sm font-bold">
                <span className="font-mono uppercase">Net Payable (GST Incl.):</span>
                <span className="font-mono text-base">₹{Number(order.grandTotal ?? order.quotedPrice ?? 0).toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Payment & Settlement Summary */}
          <div className="p-3 bg-neutral-50 border border-neutral-300 rounded mb-6 text-xs flex justify-between items-center">
            <div>
              <span className="font-mono font-bold text-neutral-800 uppercase block">Settlement Status:</span>
              <span className="font-mono text-neutral-600">Mode: {order.paymentMode || 'Prepaid · UPI / NetBanking'}</span>
            </div>
            <div className="text-right">
              <span className="font-mono font-bold text-neutral-800 uppercase block">Transaction Reference / UTR:</span>
              <span className="font-mono text-neutral-700 font-bold">{order.paymentUtr || 'PREPAID VERIFIED'}</span>
            </div>
          </div>

          {/* Authorized Seal & Legal Footnote */}
          <div className="border-t-2 border-black pt-4 flex justify-between items-end text-[10px] text-neutral-600">
            <div className="max-w-md">
              <p className="font-semibold uppercase text-black">B2B Compliance & Verification Notice:</p>
              <p className="mt-0.5">
                This document serves as an authentic commercial proforma receipt / additive manufacturing estimate
                for institutional expense reimbursement, college robotics lab funding, and enterprise hardware accounting.
              </p>
            </div>
            <div className="text-center border border-black p-3 bg-neutral-50 rounded">
              <div className="w-32 h-6 border-b border-dashed border-neutral-400 mb-1"></div>
              <p className="font-mono font-bold uppercase text-[9px] text-black">Authorized Signatory</p>
              <p className="font-mono text-[8px] text-neutral-500">SNKB 3D Studio QA Fleet</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

