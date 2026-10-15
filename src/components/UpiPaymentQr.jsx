import React, { useState, useEffect, useMemo, useCallback } from 'react';
import QRCode from 'qrcode';

const DEFAULT_UPI_ID = 'snkbstudio@ybl';
const DEFAULT_MERCHANT_NAME = 'SHUBHAM BUNDELE';

/**
 * Builds a compliant NPCI UPI payment intent URI.
 */
export function buildUpiUri({ upiId, merchantName, amount, orderId, note }) {
  const pa = (upiId || DEFAULT_UPI_ID).trim();
  const pn = (merchantName || DEFAULT_MERCHANT_NAME).trim();
  const am = Number(amount || 0).toFixed(2);
  const cleanId = orderId ? String(orderId).replace(/[^a-zA-Z0-9_-]/g, '_') : 'NEW';
  const tn = (note || `Order_${cleanId}`).trim();

  return `upi://pay?pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent(pn)}&am=${encodeURIComponent(am)}&cu=INR&tn=${encodeURIComponent(tn)}`;
}

/**
 * Validates whether a string matches standard Indian 12-digit UTR format.
 */
export function isValidUtr(utr) {
  if (!utr || typeof utr !== 'string') return false;
  const clean = utr.trim();
  return /^[0-9]{12}$/.test(clean) || /^[a-zA-Z0-9]{10,22}$/.test(clean);
}

/**
 * Builds a 1-click WhatsApp share link with preformatted order confirmation telemetry.
 */
export function buildWhatsAppShareUrl({
  orderId,
  fileName,
  grandTotal,
  deliveryPincode,
  paymentMode,
  utr,
  trackingUrl,
}) {
  const formattedTotal = Number(grandTotal || 0).toFixed(2);
  const lines = [
    `*SNKB 3D Studio - Order #${orderId || 'NEW'}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `*Model:* ${fileName || 'Custom 3D Model'}`,
    `*Grand Total:* ₹${formattedTotal} INR`,
    deliveryPincode ? `*Delivery PIN:* ${deliveryPincode}` : `*Delivery:* Standard Pan-India`,
    `*Payment Mode:* ${paymentMode === 'COD' ? 'Cash on Delivery (COD)' : 'Prepaid · UPI'}`,
  ];

  if (utr && String(utr).trim()) {
    lines.push(`*UPI UTR / Txn ID:* ${String(utr).trim()}`);
  }

  if (trackingUrl) {
    lines.push(``);
    lines.push(`*Track Live Manufacturing:*`);
    lines.push(trackingUrl);
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`_Precision FDM 3D Printing & Fast Pan-India Dispatch_`);

  const text = lines.join('\n');
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export default function UpiPaymentQr({
  orderId,
  amount,
  fileName,
  deliveryPincode,
  paymentMode = 'Prepaid',
  initialUtr = '',
  onUtrSaved,
  compact = false,
  showWhatsApp = true,
  trackingUrl,
}) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrLoading, setQrLoading] = useState(true);
  const [copiedVpa, setCopiedVpa] = useState(false);
  const [utrInput, setUtrInput] = useState(initialUtr || '');
  const [savedUtr, setSavedUtr] = useState(initialUtr || '');
  const [isEditingUtr, setIsEditingUtr] = useState(!initialUtr);
  const [isSubmittingUtr, setIsSubmittingUtr] = useState(false);
  const [utrMessage, setUtrMessage] = useState(null);
  // Phones collapse the QR behind a toggle so the deep-link + copy buttons are
  // the primary path; desktop keeps the centered 180×180 QR always visible.
  const [showQr, setShowQr] = useState(false);
  const [qrViewMode, setQrViewMode] = useState('phonepe');

  const numericAmount = Number(amount || 0);
  const formattedAmount = numericAmount.toFixed(2);

  // Derive active tracking URL
  const activeTrackingUrl = useMemo(() => {
    if (trackingUrl) return trackingUrl;
    if (typeof window !== 'undefined' && orderId) {
      return `${window.location.origin}/track/${orderId}`;
    }
    return '';
  }, [trackingUrl, orderId]);

  // Construct NPCI standard UPI payment intent string
  const upiUri = useMemo(() => {
    return buildUpiUri({
      amount: numericAmount,
      orderId,
      upiId: DEFAULT_UPI_ID,
      merchantName: DEFAULT_MERCHANT_NAME,
      note: `Order_${orderId || 'PENDING'}`,
    });
  }, [numericAmount, orderId]);

  // Generate dynamic QR code data URL
  useEffect(() => {
    let isCancelled = false;
    setQrLoading(true);

    QRCode.toDataURL(upiUri, {
      width: 180,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (!isCancelled) {
          setQrDataUrl(url);
          setQrLoading(false);
        }
      })
      .catch((err) => {
        console.error('Failed to generate UPI QR:', err);
        if (!isCancelled) setQrLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [upiUri, compact]);

  // Copy UPI VPA to clipboard
  const handleCopyVpa = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(DEFAULT_UPI_ID);
      setCopiedVpa(true);
      setTimeout(() => setCopiedVpa(false), 2200);
    }
  }, []);

  // Submit 12-digit UTR to the backend
  const handleSaveUtr = async (e) => {
    if (e) e.preventDefault();
    const cleanUtr = utrInput.trim();
    if (!cleanUtr) return;

    if (!orderId || String(orderId) === 'PENDING') {
      setSavedUtr(cleanUtr);
      setIsEditingUtr(false);
      setUtrMessage({ tone: 'success', text: 'UTR recorded for order checkout!' });
      if (onUtrSaved) onUtrSaved(cleanUtr);
      return;
    }

    setIsSubmittingUtr(true);
    setUtrMessage(null);

    try {
      const res = await fetch(`/api/orders/${orderId}/utr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ utr: cleanUtr }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to submit UTR');
      }

      setSavedUtr(cleanUtr);
      setIsEditingUtr(false);
      setUtrMessage({ tone: 'success', text: '12-digit UTR verified and linked to order!' });
      if (onUtrSaved) onUtrSaved(cleanUtr);
    } catch (err) {
      setUtrMessage({ tone: 'error', text: err.message || 'Error saving UTR' });
    } finally {
      setIsSubmittingUtr(false);
    }
  };

  const whatsappUrl = useMemo(() => {
    return buildWhatsAppShareUrl({
      orderId,
      fileName,
      grandTotal: numericAmount,
      deliveryPincode,
      paymentMode,
      utr: savedUtr || utrInput,
      trackingUrl: activeTrackingUrl,
    });
  }, [orderId, fileName, numericAmount, deliveryPincode, paymentMode, savedUtr, utrInput, activeTrackingUrl]);

  const isTwelveDigits = /^[0-9]{12}$/.test(utrInput.trim());

  return (
    <div className="w-full bg-zinc-950/80 border border-zinc-800 cut-sm p-4 sm:p-5 shadow-2xl relative">
      {/* Top Header Badge */}
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full bg-[#FF6500] animate-pulse shrink-0"></div>
          <div className="min-w-0">
            <h4 className="text-xs sm:text-sm font-bold text-white tracking-wide uppercase font-mono flex items-center gap-1.5 flex-wrap">
              <span>Dynamic UPI Payment QR</span>
              <span className="text-[10px] text-[#00FF66] bg-[#00FF66]/10 px-1.5 py-0.2 border border-[#00FF66]/30 rounded">
                NPCI Instant
              </span>
            </h4>
            <p className="text-[10px] text-zinc-400 mt-0.5">
              Scan with GPay, PhonePe, Paytm, or BHIM to pay instantly in ₹ INR
            </p>
          </div>
        </div>

        <div className="text-right shrink-0">
          <span className="telemetry text-[9px] text-zinc-400 block">TOTAL PAYABLE</span>
          <span className="font-mono text-sm sm:text-base font-extrabold text-[#00FF66]">
            ₹{formattedAmount} <span className="text-[10px] font-normal text-zinc-400">INR</span>
          </span>
        </div>
      </div>

      {/* Stacked vertical layout: QR → VPA → UTR (never side-by-side) */}
      <div className="flex flex-col items-center text-center gap-4 w-full pt-4">
        {/* Mobile-only QR toggle (< md) */}
        <button
          type="button"
          onClick={() => setShowQr((v) => !v)}
          aria-expanded={showQr}
          className="md:hidden w-full min-h-[44px] px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 font-mono text-[11px] font-semibold transition flex items-center justify-center gap-2 cursor-pointer"
        >
          <span>📷 {showQr ? 'Hide Payment QR' : 'Tap to Show Payment QR'}</span>
        </button>

        {/* Top: crisp centered QR card (collapsed on phones, always on desktop) */}
        <div className={`${showQr ? 'flex' : 'hidden'} md:flex flex-col items-center justify-center p-4 bg-black/60 border border-zinc-800 rounded-xl relative`}>
          {/* QR View Mode Tabs */}
          <div className="flex items-center gap-1 p-1 bg-zinc-900/90 border border-zinc-700/80 rounded-lg text-[10px] font-mono mb-3">
            <button
              type="button"
              onClick={() => setQrViewMode('phonepe')}
              className={`px-2.5 py-1 rounded transition flex items-center gap-1.5 cursor-pointer ${
                qrViewMode === 'phonepe'
                  ? 'bg-[#5f259f] text-white font-bold shadow'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <span>🟣 PhonePe QR Card</span>
            </button>
            <button
              type="button"
              onClick={() => setQrViewMode('dynamic')}
              className={`px-2.5 py-1 rounded transition flex items-center gap-1.5 cursor-pointer ${
                qrViewMode === 'dynamic'
                  ? 'bg-[#FF6500] text-black font-bold shadow'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <span>⚡ Dynamic QR (₹{formattedAmount})</span>
            </button>
          </div>

          {/* Subtle Reticle Corners */}
          <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t-2 border-l-2 border-[#FF6500]/70 pointer-events-none"></div>
          <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t-2 border-r-2 border-[#FF6500]/70 pointer-events-none"></div>
          <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b-2 border-l-2 border-[#FF6500]/70 pointer-events-none"></div>
          <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b-2 border-r-2 border-[#FF6500]/70 pointer-events-none"></div>

          {qrViewMode === 'phonepe' ? (
            <div className="flex flex-col items-center">
              <a
                href="/images/phonepe-qr.png"
                target="_blank"
                rel="noreferrer"
                title="Click to view full PhonePe QR in high resolution"
                className="relative p-1.5 bg-black rounded-lg border border-[#5f259f]/60 shadow-lg hover:border-[#a855f7] transition group inline-block"
              >
                <img
                  src="/images/phonepe-qr-card.png"
                  alt="Official PhonePe QR Code - Shubham Bundele (snkbstudio@ybl)"
                  className="w-[180px] h-[220px] object-contain rounded"
                  width={180}
                  height={220}
                />
                <span className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/85 backdrop-blur-sm text-[9px] font-mono text-zinc-300 px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap">
                  🔍 Click to Enlarge
                </span>
              </a>
              <div className="mt-2 text-center">
                <span className="text-[10px] font-bold font-mono bg-[#5f259f]/20 text-[#c084fc] px-2.5 py-1 rounded-full border border-[#5f259f]/40">
                  SHUBHAM BUNDELE · PhonePe
                </span>
                <span className="text-[10px] text-zinc-400 font-mono block mt-1.5">
                  UPI ID: <strong className="text-zinc-200">snkbstudio@ybl</strong>
                </span>
              </div>
            </div>
          ) : qrLoading ? (
            <div className="w-[180px] h-[180px] flex flex-col items-center justify-center gap-2 text-zinc-400 text-xs font-mono">
              <svg className="animate-spin h-5 w-5 text-[#FF6500]" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
              </svg>
              <span>Generating QR…</span>
            </div>
          ) : qrDataUrl ? (
            <div className="relative p-2 bg-white rounded-lg shadow-lg">
              <img
                src={qrDataUrl}
                alt={`UPI Payment QR Code for ₹${formattedAmount}`}
                className="w-[180px] h-[180px] object-contain rounded"
                width={180}
                height={180}
              />
            </div>
          ) : (
            <div className="w-[180px] h-[180px] flex items-center justify-center text-zinc-500 text-xs">
              QR unavailable
            </div>
          )}

          {qrViewMode === 'dynamic' && (
            <div className="mt-3 text-center">
              <span className="text-[10px] font-bold font-mono bg-black text-[#FF6500] px-2.5 py-1 rounded-full border border-zinc-700 shadow">
                SCAN TO PAY ₹{formattedAmount}
              </span>
              <span className="text-[10px] text-zinc-400 font-mono block mt-2">
                Auto-filled Note: <strong className="text-zinc-200">Order_{orderId || 'PENDING'}</strong>
              </span>
            </div>
          )}
        </div>

        {/* Middle: full-width VPA pill + full-width UPI app button */}
        <div className="w-full space-y-3 text-xs">
          {/* Payee Info */}
          <div className="w-full bg-black/40 border border-zinc-800/80 p-3 rounded-xl space-y-2 font-mono text-center">
            <div className="text-[11px]">
              <span className="text-zinc-400 block">Payee Name</span>
              <span className="text-white font-semibold">{DEFAULT_MERCHANT_NAME}</span>
              <span className="text-[10px] text-zinc-500 block font-sans">SNKB 3D Studio</span>
            </div>
            <button
              type="button"
              onClick={handleCopyVpa}
              className="relative w-full flex flex-col items-center justify-center gap-1 min-h-[46px] transition group cursor-pointer bg-black/60 hover:bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5"
              title="Click to copy UPI ID"
            >
              <span className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-[#FF6500] group-hover:text-white">
                <span>📋</span>
                <span>{copiedVpa ? 'Copied!' : 'One-Tap Copy UPI ID'}</span>
              </span>
              <span className="text-[10px] text-zinc-400 underline decoration-dotted break-all">{DEFAULT_UPI_ID}</span>
              {copiedVpa && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#00FF66] text-black shadow-lg">
                  ✓ Copied to clipboard
                </span>
              )}
            </button>
            <div className="text-[11px] pt-2 border-t border-zinc-800/60">
              <span className="text-zinc-400 block">Supported Apps</span>
              <span className="text-zinc-300 font-sans text-[10px]">GPay • PhonePe • Paytm • BHIM • CRED</span>
            </div>
          </div>

          {/* Mobile Direct Pay Trigger — primary full-width action on phones */}
          <a
            href={upiUri}
            className="w-full min-h-[48px] py-3 px-3 rounded-xl bg-[#FF6500] hover:bg-[#e05800] border border-[#ff8c3a] text-black font-mono text-xs font-bold transition flex items-center justify-center gap-2 text-center shadow-lg shadow-orange-950/30"
          >
            <span>⚡ Pay ₹{formattedAmount} Instantly via GPay / PhonePe / Paytm</span>
          </a>

          {/* Bottom: full-width 12-digit UTR input */}
          <div className="w-full bg-black/50 border border-zinc-800 p-3 rounded-xl space-y-2">
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <label className="telemetry text-[11px] font-semibold text-zinc-200 flex items-center gap-1.5">
                <span>12-Digit UTR / Transaction ID</span>
                <span className="text-[10px] text-zinc-500 font-normal font-sans">(Optional)</span>
              </label>
              {isTwelveDigits && (
                <span className="text-[10px] text-[#00FF66] font-mono flex items-center gap-1">
                  <span>✓</span> 12-digit UTR format
                </span>
              )}
            </div>

            {savedUtr && !isEditingUtr ? (
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/80 text-xs">
                <div className="font-mono text-left min-w-0">
                  <span className="text-zinc-400 block text-[10px]">RECORDED UTR:</span>
                  <span className="text-emerald-300 font-bold tracking-wider break-all">{savedUtr}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditingUtr(true)}
                  className="px-2 py-1 text-[10px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono transition shrink-0"
                >
                  Edit UTR
                </button>
              </div>
            ) : (
              <form onSubmit={handleSaveUtr} className="flex flex-col gap-2 w-full">
                <input
                  type="text"
                  maxLength={22}
                  placeholder="e.g. 428812345678 (from UPI app receipt)"
                  value={utrInput}
                  onChange={(e) => setUtrInput(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
                  className="field-mech w-full px-3 py-2 text-zinc-100 text-base sm:text-xs font-mono transition"
                />
                <button
                  type="submit"
                  disabled={isSubmittingUtr || !utrInput.trim()}
                  className="w-full px-3 py-2 rounded-lg bg-[#FF6500] hover:bg-[#e05800] text-white text-xs font-bold font-mono transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isSubmittingUtr ? 'Saving…' : 'Submit UTR'}
                </button>
              </form>
            )}

            {utrMessage && (
              <div
                className={`text-[10px] font-mono p-1.5 rounded border ${
                  utrMessage.tone === 'success'
                    ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                    : 'bg-rose-950/60 border-rose-800 text-rose-300'
                }`}
              >
                {utrMessage.text}
              </div>
            )}
            <p className="text-[10px] text-zinc-500 leading-tight">
              Tip: After payment, find the 12-digit UPI Ref/UTR No. on your GPay/PhonePe screen and paste it here for instant operator verification.
            </p>
          </div>
        </div>
      </div>

      {/* 1-Click Share Order on WhatsApp Button */}
      {showWhatsApp && (
        <div className="pt-3 mt-1 border-t border-zinc-800/80 flex flex-col items-stretch gap-3">
          <div className="text-[11px] text-zinc-400 font-sans text-center">
            Need payment help or want to send your receipt to customer support?
          </div>

          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] text-black font-bold text-xs uppercase tracking-wider transition shadow-lg shadow-[#25D366]/20 cursor-pointer"
            title="Share order summary and tracking link directly on WhatsApp"
          >
            {/* WhatsApp SVG Icon */}
            <svg className="w-4 h-4 fill-current shrink-0" viewBox="0 0 24 24">
              <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86s.275.072.376-.044c.101-.116.433-.506.549-.68.116-.173.231-.145.39-.087s1.011.477 1.184.564.289.13.332.202c.043.073.043.419-.101.824z" />
              <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.98-1.309A9.957 9.957 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18.167c-1.636 0-3.15-.49-4.417-1.332l-.317-.208-2.962.777.791-2.89-.228-.363C3.967 15.008 3.5 13.553 3.5 12c0-4.687 3.813-8.5 8.5-8.5s8.5 3.813 8.5 8.5-3.813 8.5-8.5 8.5z" />
            </svg>
            <span>Share Order on WhatsApp</span>
          </a>
        </div>
      )}
    </div>
  );
}
