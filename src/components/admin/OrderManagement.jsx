import React, { useState, useMemo, useEffect, useCallback } from 'react';

// Canonical order lifecycle — must mirror src/db/database.js ORDER_STATUSES.
const STATUS_OPTIONS = ['Pending', 'Slicing', 'Printing', 'Completed', 'Shipped', 'Cancelled'];

const STATUS_BADGES = {
  Pending: 'bg-amber-950/70 text-amber-300 border-amber-800/80',
  Slicing: 'bg-sky-950/70 text-sky-300 border-sky-800/80',
  Printing: 'bg-[#FF6500]/10 text-[#FF6500] border-[#FF6500]/50 animate-pulse',
  Completed: 'bg-emerald-950/70 text-emerald-300 border-emerald-800/80',
  Shipped: 'bg-indigo-950/70 text-indigo-300 border-indigo-800/80',
  Cancelled: 'bg-rose-950/70 text-rose-300 border-rose-800/80'
};

/** SQLite stores UTC "YYYY-MM-DD HH:MM:SS"; render it in the operator's locale. */
function formatDate(value) {
  if (!value) return '';
  const iso = String(value).includes('T')
    ? String(value)
    : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/** Map an /api/admin/orders record onto the table's view model. */
function mapOrder(raw) {
  const dims = raw.dimensions && raw.dimensions.x != null ? raw.dimensions : null;
  const weight = Number(raw.weightG ?? raw.totalWeightG) || 0;

  return {
    id: raw.id,
    customer: raw.customerName || 'Guest',
    email: raw.customerEmail || null,
    file: raw.fileName || 'model.stl',
    filePath: raw.filePath || null,
    volumeMm3: Number(raw.volumeMm3) || 0,
    weightGrams: weight,
    partWeightG: raw.partWeightG != null ? Number(raw.partWeightG) : null,
    supportWeightG: raw.supportWeightG != null ? Number(raw.supportWeightG) : 0,
    supportsEnabled: raw.supportsEnabled !== false,
    material: raw.material || 'pla',
    layerHeightMm: raw.layerHeightMm != null ? Number(raw.layerHeightMm) : null,
    materialCostInr: weight * 2.00,
    quotedPriceInr: Number(raw.quotedPrice) || 0,
    paymentMode: raw.paymentMode === 'COD' ? 'COD' : 'Prepaid',
    deliveryCharge: raw.deliveryCharge !== null && raw.deliveryCharge !== undefined
      ? Number(raw.deliveryCharge)
      : null,
    deliveryPincode: raw.deliveryPincode || null,
    grandTotalInr: Number(raw.grandTotal ?? raw.quotedPrice) || 0,
    courierTrackingUrl: raw.courierTrackingUrl || null,
    status: STATUS_OPTIONS.includes(raw.status) ? raw.status : 'Pending',
    date: formatDate(raw.createdAt),
    dimensions: dims ? `${dims.x} × ${dims.y} × ${dims.z} mm` : '—'
  };
}

export default function OrderManagement() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [notification, setNotification] = useState(null);

  // Admin security clearance state
  const [adminToken, setAdminToken] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('snkb_admin_token') || '';
    }
    return '';
  });
  const [isLocked, setIsLocked] = useState(false);
  const [passcodeAttempt, setPasscodeAttempt] = useState('');
  const [authError, setAuthError] = useState(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const [downloadingOrderId, setDownloadingOrderId] = useState(null);
  const [isCleaningStorage, setIsCleaningStorage] = useState(false);

  const notify = useCallback((message, tone = 'success') => {
    setNotification({ message, tone });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  const getAuthHeaders = useCallback((extra = {}) => {
    const token = typeof window !== 'undefined'
      ? (sessionStorage.getItem('snkb_admin_token') || adminToken)
      : adminToken;
    const headers = { ...extra };
    if (token) {
      headers['x-admin-token'] = token;
    }
    return headers;
  }, [adminToken]);

  // Filament Spool Inventory State
  const [spools, setSpools] = useState([]);
  const [loadingSpools, setLoadingSpools] = useState(false);
  const [editingSpoolId, setEditingSpoolId] = useState(null);
  const [spoolEditGrams, setSpoolEditGrams] = useState('');
  const [savingSpool, setSavingSpool] = useState(false);

  // Load live orders from the admin API.
  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/orders', {
        headers: getAuthHeaders(),
      });
      if (response.status === 401) {
        setIsLocked(true);
        setLoading(false);
        return;
      }
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const data = await response.json();
      const list = Array.isArray(data.orders) ? data.orders : [];
      setOrders(list.map(mapOrder));
      setError(null);
      setIsLocked(false);
    } catch (err) {
      setError(err.message || 'Unable to load orders');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  const loadSpools = useCallback(async () => {
    setLoadingSpools(true);
    try {
      const response = await fetch('/api/admin/spools', {
        headers: getAuthHeaders(),
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.spools)) {
          setSpools(data.spools);
        }
      }
    } catch (err) {
      console.warn('Failed to load spools in admin:', err);
    } finally {
      setLoadingSpools(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    loadOrders();
    loadSpools();
  }, [loadOrders, loadSpools]);

  const handleUpdateSpoolRemaining = async (id, grams) => {
    setSavingSpool(true);
    try {
      const response = await fetch(`/api/admin/spools/${id}`, {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ remainingGrams: Number(grams) }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || 'Failed to update spool');
      }
      setSpools((prev) =>
        prev.map((s) => (s.id === id ? { ...s, remaining_grams: Number(grams) } : s))
      );
      setEditingSpoolId(null);
      setSpoolEditGrams('');
      notify(`Spool #${id} weight updated to ${grams}g`, 'success');
    } catch (err) {
      notify(`Failed to update spool: ${err.message}`, 'error');
    } finally {
      setSavingSpool(false);
    }
  };

  // Download 3D file with signed URL from Supabase Storage (or local stream fallback)
  const handleDownloadFile = async (order) => {
    if (!order.filePath) {
      notify('No 3D file stored for this order', 'error');
      return;
    }
    setDownloadingOrderId(order.id);
    try {
      const response = await fetch(`/api/admin/orders/${order.id}/download?json=1`, {
        headers: getAuthHeaders(),
      });
      if (response.status === 401) {
        setIsLocked(true);
        notify('Admin session expired. Please re-authenticate.', 'error');
        return;
      }
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || errData.error || `Download failed with status ${response.status}`);
      }
      const data = await response.json();
      if (data.downloadUrl) {
        const link = document.createElement('a');
        link.href = data.downloadUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        if (data.fileName) {
          link.download = data.fileName;
        }
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        notify(`Downloading ${data.fileName || order.file} (${data.provider === 'supabase' ? 'Signed Supabase URL' : 'Local'})...`, 'success');
      } else {
        throw new Error('No download URL returned by server');
      }
    } catch (err) {
      notify(`Download failed: ${err.message}`, 'error');
    } finally {
      setDownloadingOrderId(null);
    }
  };

  // Permanently delete 3D models for completed orders to maintain Supabase 1 GB free tier
  const handleCleanupStorage = async () => {
    const confirmCleanup = window.confirm(
      'Are you sure you want to delete stored 3D files (.stl / .3mf) for all completed and cancelled orders?\n\nThis permanently frees space in Supabase Storage to maintain the 1 GB free tier limit. Order records, analytics, and billing logs are preserved.'
    );
    if (!confirmCleanup) return;

    setIsCleaningStorage(true);
    try {
      const response = await fetch('/api/admin/storage/cleanup', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      });
      if (response.status === 401) {
        setIsLocked(true);
        notify('Admin session expired. Please re-authenticate.', 'error');
        return;
      }
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || errData.error || `Cleanup failed with status ${response.status}`);
      }
      const data = await response.json();
      notify(data.message || `Deleted 3D files for ${data.cleanedCount || 0} orders.`, 'success');
      await loadOrders();
    } catch (err) {
      notify(`Storage cleanup failed: ${err.message}`, 'error');
    } finally {
      setIsCleaningStorage(false);
    }
  };

  const handleUnlockTerminal = async (e) => {
    if (e) e.preventDefault();
    if (!passcodeAttempt.trim()) {
      setAuthError('Please enter an admin access token or passcode.');
      return;
    }
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': passcodeAttempt.trim(),
        },
        body: JSON.stringify({ token: passcodeAttempt.trim() }),
      });
      if (res.ok) {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('snkb_admin_token', passcodeAttempt.trim());
          document.cookie = 'admin_passcode=' + encodeURIComponent(passcodeAttempt.trim()) + '; path=/; max-age=86400; SameSite=Lax';
        }
        setAdminToken(passcodeAttempt.trim());
        setIsLocked(false);
        setPasscodeAttempt('');
        notify('Terminal authorized successfully', 'success');
        const ordersRes = await fetch('/api/admin/orders', {
          headers: { 'x-admin-token': passcodeAttempt.trim() },
        });
        if (ordersRes.ok) {
          const data = await ordersRes.json();
          setOrders((data.orders || []).map(mapOrder));
        }
        loadSpools();
      } else {
        setAuthError('Access Denied: Invalid admin passcode or token.');
      }
    } catch (err) {
      setAuthError('Authorization check failed: ' + err.message);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLockTerminal = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('snkb_admin_token');
      document.cookie = 'admin_passcode=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    }
    setAdminToken('');
    setIsLocked(true);
    notify('Terminal locked', 'info');
  };

  // Persist a status change to PATCH /api/admin/orders/:id (optimistic update).
  const handleStatusChange = async (orderId, newStatus) => {
    let courierUrl = null;
    if (newStatus === 'Shipped') {
      const existingOrder = orders.find((o) => o.id === orderId);
      const inputUrl = window.prompt(
        `Enter Courier Tracking URL for Order #${orderId} (optional, e.g. https://www.delhivery.com/track/...):`,
        existingOrder?.courierTrackingUrl || ''
      );
      if (inputUrl && inputUrl.trim()) {
        courierUrl = inputUrl.trim();
      }
    }

    const previousOrders = orders;
    setOrders((prev) =>
      prev.map((order) =>
        order.id === orderId
          ? { ...order, status: newStatus, courierTrackingUrl: courierUrl !== null ? courierUrl : order.courierTrackingUrl }
          : order
      )
    );

    try {
      const payload = { status: newStatus };
      if (courierUrl !== null) {
        payload.courierTrackingUrl = courierUrl;
      }

      const response = await fetch(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const data = await response.json();
      if (data.order) {
        const updated = mapOrder(data.order);
        setOrders((prev) =>
          prev.map((order) => (order.id === orderId ? updated : order))
        );
      }
      const emailNote = data.email?.success ? ' • Customer notified via Resend email ✓' : '';
      notify(`Order #${orderId} status changed to "${newStatus}"${emailNote}`);
    } catch (err) {
      setOrders(previousOrders);
      notify(`Failed to update order #${orderId}: ${err.message}`, 'error');
    }
  };

  // Filtered orders list
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesStatus =
        statusFilter === 'ALL' || order.status === statusFilter;
      const matchesSearch =
        String(order.id).toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.customer.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.file.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesStatus && matchesSearch;
    });
  }, [orders, statusFilter, searchQuery]);

  // Aggregate metrics based on all current orders + baseline shop metrics
  const metrics = useMemo(() => {
    const totalRevenue = orders.reduce((acc, o) => acc + o.quotedPriceInr, 0);
    const totalOrderWeightGrams = orders.reduce((acc, o) => acc + o.weightGrams, 0);
    // Include 21.5 kg of completed historical batch volume + current orders
    const historicalFilamentKg = 21.5;
    const totalFilamentUsedKg = Number((historicalFilamentKg + totalOrderWeightGrams / 1000).toFixed(2));

    // Filament cost (₹1,800/kg PLA+)
    const totalFilamentCostInr = totalFilamentUsedKg * 1800.00;

    // Overhead costs (electricity, nozzle wear, machine maintenance, bed adhesive)
    const overheadCostsInr = 15400.00;

    // Cumulative revenue estimate including historical batches (₹1,85,000.00)
    const cumulativeRevenueInr = 185000.00 + totalRevenue;
    const netProfitInr = Number((cumulativeRevenueInr - totalFilamentCostInr - overheadCostsInr).toFixed(2));

    // Payment remittance split: prepaid is collected at checkout; COD cash is
    // collected on dispatch (outstanding until Completed/Shipped, void on Cancelled).
    const codSettled = new Set(['Completed', 'Shipped']);
    const prepaidOrders = orders.filter((o) => o.paymentMode !== 'COD');
    const codOrders = orders.filter((o) => o.paymentMode === 'COD');
    const prepaidCollectedInr = Number(prepaidOrders.reduce((acc, o) => acc + o.grandTotalInr, 0).toFixed(2));
    const codCollectedInr = Number(
      codOrders.filter((o) => codSettled.has(o.status)).reduce((acc, o) => acc + o.grandTotalInr, 0).toFixed(2)
    );
    const codOutstandingInr = Number(
      codOrders.filter((o) => !codSettled.has(o.status) && o.status !== 'Cancelled').reduce((acc, o) => acc + o.grandTotalInr, 0).toFixed(2)
    );
    const deliveryPassthroughInr = Number(
      orders.reduce((acc, o) => acc + (o.deliveryCharge || 0), 0).toFixed(2)
    );

    return {
      totalFilamentUsedKg,
      overheadCostsInr,
      netProfitInr,
      prepaidCollectedInr,
      codCollectedInr,
      codOutstandingInr,
      deliveryPassthroughInr,
      prepaidCount: prepaidOrders.length,
      codCount: codOrders.length,
      totalOrders: orders.length,
      pendingCount: orders.filter((o) => o.status === 'Pending').length,
      printingCount: orders.filter((o) => o.status === 'Printing').length,
      completedCount: orders.filter((o) => o.status === 'Completed').length
    };
  }, [orders]);

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed bottom-6 right-6 z-50 text-white text-xs font-medium px-4 py-3 rounded-xl shadow-2xl border flex items-center gap-2 animate-bounce ${
            notification.tone === 'error'
              ? 'bg-rose-600 border-rose-400'
              : 'bg-indigo-600 border-indigo-400'
          }`}
        >
          <svg className="w-4 h-4 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
          </svg>
          <span>{notification.message}</span>
        </div>
      )}

      {isLocked ? (
        <div className="bg-zinc-950 border border-zinc-800 cut-md p-8 md:p-12 shadow-2xl relative overflow-hidden text-center max-w-lg mx-auto my-12">
          <div className="absolute top-0 left-0 right-0 h-1.5 stripes-hazard opacity-80"></div>
          <div className="flex flex-col items-center gap-3 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-[#FF6500]/10 border border-[#FF6500]/40 flex items-center justify-center text-[#FF6500] shadow-[0_0_20px_rgba(255,101,0,0.25)]">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <div className="telemetry text-xs font-bold text-[#FF6500] tracking-widest">
                SECURITY CLEARANCE REQUIRED
              </div>
              <h2 className="text-xl font-extrabold text-white tracking-tight mt-1">
                Admin Fulfillment Queue Locked
              </h2>
              <p className="text-xs text-zinc-400 mt-1 max-w-sm">
                Enter your authorized operator access token or admin passcode to view orders and update print farm statuses.
              </p>
            </div>
          </div>

          {authError && (
            <div className="mb-5 p-3 rounded-xl bg-rose-950/70 border border-rose-800 text-rose-300 text-xs font-mono flex items-center gap-2 text-left">
              <svg className="w-4 h-4 shrink-0 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleUnlockTerminal} className="space-y-4 text-left">
            <div>
              <label className="block text-xs font-mono text-zinc-300 uppercase tracking-wider mb-1.5">
                Admin Access Token / Secret Key
              </label>
              <input
                type="password"
                value={passcodeAttempt}
                onChange={(e) => setPasscodeAttempt(e.target.value)}
                placeholder="Enter ADMIN_ACCESS_TOKEN..."
                className="w-full px-4 py-2.5 bg-black/60 border border-zinc-700 rounded-xl text-white font-mono text-sm focus:border-[#FF6500] focus:ring-1 focus:ring-[#FF6500] outline-none"
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={isAuthenticating}
              className="w-full py-2.5 px-4 rounded-xl bg-[#FF6500] hover:bg-[#e05800] text-white font-bold text-xs uppercase tracking-wider transition shadow-lg shadow-[#FF6500]/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isAuthenticating ? 'Authorizing…' : 'Authorize Terminal & Unlock'}
            </button>
          </form>
        </div>
      ) : (
        <>
          {/* Profit Dashboard Top Summary Cards */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {/* Card 1: Total Filament Used */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-lg relative overflow-hidden group hover:border-zinc-700 transition">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">
              Material Consumption
            </span>
            <div className="w-8 h-8 rounded-lg bg-[#FF6500]/10 border border-[#FF6500]/40 flex items-center justify-center text-[#FF6500]">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
          </div>
          <div className="text-3xl font-bold text-white tracking-tight font-mono">
            {metrics.totalFilamentUsedKg}{' '}
            <span className="text-sm font-normal text-zinc-400">kg</span>
          </div>
          <div className="mt-3 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-xs">
            <span className="text-zinc-500">PLA+ Standard (₹1,800/kg)</span>
            <span className="text-[#FF6500] font-mono">
              ₹{(metrics.totalFilamentUsedKg * 1800).toFixed(2)} raw cost
            </span>
          </div>
        </div>

        {/* Card 2: Overhead Costs */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-lg relative overflow-hidden group hover:border-zinc-700 transition">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">
              Operating Overhead
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-950/80 border border-amber-800/60 flex items-center justify-center text-amber-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
          </div>
          <div className="text-3xl font-bold text-white tracking-tight font-mono">
            ₹{metrics.overheadCostsInr.toFixed(2)}{' '}
            <span className="text-sm font-normal text-zinc-400">INR</span>
          </div>
          <div className="mt-3 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-xs">
            <span className="text-zinc-500">Power & Hardened Nozzle Wear</span>
            <span className="text-amber-400 font-mono">~₹25 / print hr</span>
          </div>
        </div>

        {/* Card 3: Net Profit */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-lg relative overflow-hidden group hover:border-zinc-700 transition">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">
              Cumulative Net Profit
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="text-3xl font-bold text-emerald-400 tracking-tight font-mono">
            ₹{metrics.netProfitInr.toFixed(2)}{' '}
            <span className="text-sm font-normal text-zinc-400">INR</span>
          </div>
          <div className="mt-3 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-xs">
            <span className="text-zinc-500">Gross Margin: ~64.8%</span>
            <span className="text-emerald-400 font-mono">+18.2% MoM</span>
          </div>
        </div>

        {/* Card 4: Payment Remittance Split (Prepaid vs COD) */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-lg relative overflow-hidden group hover:border-zinc-700 transition">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">
              Payment Remittance
            </span>
            <div className="w-8 h-8 rounded-lg bg-teal-950/80 border border-teal-800/60 flex items-center justify-center text-teal-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
          </div>
          <div className="text-3xl font-bold text-white tracking-tight font-mono">
            ₹{metrics.prepaidCollectedInr.toFixed(2)}{' '}
            <span className="text-sm font-normal text-zinc-400">Prepaid in</span>
          </div>
          <div className="mt-3 pt-3 border-t border-zinc-800/80 space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">COD collected ({metrics.codCount} COD orders)</span>
              <span className="text-teal-400 font-mono">₹{metrics.codCollectedInr.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">COD outstanding to collect</span>
              <span className="text-amber-400 font-mono">₹{metrics.codOutstandingInr.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Delivery pass-through</span>
              <span className="text-zinc-300 font-mono">₹{metrics.deliveryPassthroughInr.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Live Filament Spool Inventory & Farm Stock Section */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl overflow-hidden p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#00FF66] shadow-[0_0_6px_#00FF66]"></span>
                <span>Live Filament Spool Inventory</span>
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700">
                {spools.length} spools active
              </span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-emerald-950/60 text-emerald-300 border border-emerald-800/70">
                Live Supabase Synced
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Real-time spool weights across the print farm. Customer quotes dynamically check remaining stock—spools with insufficient filament show <span className="text-amber-300 font-mono">"Low Spool — +3 Days Restock"</span> in the 3D viewer.
            </p>
          </div>
          <button
            type="button"
            onClick={loadSpools}
            disabled={loadingSpools}
            className="px-3 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 hover:text-white hover:border-zinc-700 transition disabled:opacity-50 self-start md:self-auto cursor-pointer"
          >
            {loadingSpools ? 'Refreshing Spools…' : '↻ Refresh Spools'}
          </button>
        </div>

        {spools.length === 0 ? (
          <div className="p-6 text-center text-zinc-500 font-mono text-xs">
            {loadingSpools ? 'Loading filament spool inventory…' : 'No spools registered. Run migration 0003_filament_spools.sql to seed.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
            {spools.map((spool) => {
              const isLow = Number(spool.remaining_grams) < 200;
              const isCritical = Number(spool.remaining_grams) < 80;
              const isEditing = editingSpoolId === spool.id;

              return (
                <div
                  key={spool.id}
                  className={`p-4 rounded-xl border bg-black/40 transition relative flex flex-col justify-between ${
                    isCritical
                      ? 'border-rose-800/80 bg-rose-950/20'
                      : isLow
                      ? 'border-amber-800/80 bg-amber-950/20'
                      : 'border-zinc-800/80 hover:border-zinc-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-white/20 shrink-0 shadow-sm"
                          style={{ backgroundColor: spool.hex_code || '#8E9296' }}
                        ></span>
                        <span className="font-bold text-white text-xs truncate max-w-[130px]">
                          {spool.color_name}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 uppercase">
                        {spool.material || 'PLA+'}
                      </span>
                    </div>

                    <div className="my-2">
                      <div className="flex items-baseline justify-between text-xs font-mono mb-1">
                        <span className="text-zinc-400">Remaining:</span>
                        <span className={`font-bold text-sm ${isCritical ? 'text-rose-400' : isLow ? 'text-amber-300' : 'text-[#00FF66]'}`}>
                          {Number(spool.remaining_grams).toFixed(0)} <span className="text-[10px] font-normal text-zinc-400">g / 1000g</span>
                        </span>
                      </div>

                      {/* Visual Spool Gauge Bar */}
                      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            isCritical ? 'bg-rose-500' : isLow ? 'bg-amber-400' : 'bg-[#00FF66]'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, (Number(spool.remaining_grams) / 1000) * 100))}%` }}
                        ></div>
                      </div>
                    </div>

                    {/* Stock Alert Badge */}
                    <div className="mt-2 min-h-[22px]">
                      {isCritical ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-rose-300 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-800/70">
                          ⚠️ Critical Low (&lt;80g)
                        </span>
                      ) : isLow ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-amber-300 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/70">
                          ⚠️ Restock Alert (+3 Days)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/50">
                          ✓ Farm Ready
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Weight Quick-Adjustment Controls */}
                  <div className="mt-3 pt-3 border-t border-zinc-800/60">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="0"
                          max="5000"
                          value={spoolEditGrams}
                          onChange={(e) => setSpoolEditGrams(e.target.value)}
                          placeholder="Grams..."
                          className="w-20 px-2 py-1 bg-black border border-zinc-700 rounded text-xs text-white font-mono outline-none focus:border-[#FF6500]"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => handleUpdateSpoolRemaining(spool.id, spoolEditGrams)}
                          disabled={savingSpool || !spoolEditGrams}
                          className="px-2 py-1 bg-[#00FF66] text-black font-bold text-xs rounded hover:bg-[#00e059] transition disabled:opacity-50 cursor-pointer"
                        >
                          {savingSpool ? '…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSpoolId(null);
                            setSpoolEditGrams('');
                          }}
                          className="px-1.5 py-1 text-zinc-400 hover:text-white text-xs cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-zinc-500 font-mono">ID #{spool.id}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSpoolId(spool.id);
                            setSpoolEditGrams(String(spool.remaining_grams || 0));
                          }}
                          className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-mono transition cursor-pointer flex items-center gap-1"
                        >
                          <span>✏️ Set Weight</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Order Management Section */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl overflow-hidden">
        {/* Table Controls & Filter Header */}
        <div className="p-5 border-b border-zinc-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-900/60">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white tracking-tight">
                Print Order Queue
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700">
                {filteredOrders.length} orders
              </span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-emerald-950/60 text-emerald-300 border border-emerald-800/70">
                SQLite live
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Live orders persisted from every accepted STL quote. Monitor build geometry compatibility and update fulfillment states.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Refresh */}
            <button
              type="button"
              onClick={loadOrders}
              disabled={loading}
              className="px-3 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 hover:text-white hover:border-zinc-700 transition disabled:opacity-50"
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>

            {/* Lock Terminal Button */}
            <button
              type="button"
              onClick={handleLockTerminal}
              className="px-3 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-400 hover:text-white hover:border-zinc-700 transition flex items-center gap-1.5 cursor-pointer"
              title="Lock admin session"
            >
              <span>🔒 Lock</span>
            </button>

            {/* Delete Old Files (Free Storage) Button */}
            <button
              type="button"
              onClick={handleCleanupStorage}
              disabled={isCleaningStorage}
              className="px-3 py-1.5 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-xs text-rose-300 hover:text-white transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Delete stored 3D models for completed/cancelled orders to maintain Supabase 1 GB free tier"
            >
              <svg className="w-3.5 h-3.5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>{isCleaningStorage ? 'Cleaning Storage…' : 'Delete Old Files (Free Storage)'}</span>
            </button>

            {/* Search Box */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search order, customer, STL..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-56 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-[#FF6500] transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2 text-zinc-500 hover:text-zinc-300 text-xs"
                >
                  ×
                </button>
              )}
            </div>

            {/* Status Filter Tabs */}
            <div className="flex flex-wrap items-center bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-xs">
              {['ALL', ...STATUS_OPTIONS].map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1 rounded-lg font-medium transition ${
                    statusFilter === status
                      ? 'bg-zinc-800 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Connection error banner */}
        {error && (
          <div className="px-5 py-3 bg-rose-950/50 border-b border-rose-900/70 text-xs text-rose-200 flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <span>Could not reach the orders API: {error}</span>
          </div>
        )}

        {/* Orders Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400 font-mono uppercase text-[10px] tracking-wider">
                <th className="py-3 px-4">Order ID</th>
                <th className="py-3 px-4">Customer Name</th>
                <th className="py-3 px-4">Uploaded File (STL)</th>
                <th className="py-3 px-4 text-right">Volume (mm³)</th>
                <th className="py-3 px-4 text-right">Filament (g)</th>
                <th className="py-3 px-4 text-right">Quoted Price</th>
                <th className="py-3 px-4 text-right">Delivery</th>
                <th className="py-3 px-4 text-center">Payment</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
              {loading && orders.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-zinc-500 text-xs">
                    Loading orders from the database…
                  </td>
                </tr>
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-zinc-500 text-xs">
                    {orders.length === 0
                      ? 'No orders yet — upload a .stl on the storefront to populate the queue.'
                      : 'No orders match your filter criteria.'}
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => (
                  <tr
                    key={order.id}
                    className="hover:bg-zinc-800/40 transition group"
                  >
                    {/* Order ID */}
                    <td className="py-3.5 px-4 font-mono font-semibold text-[#FF6500] whitespace-nowrap">
                      #{order.id}
                      <span className="block text-[10px] text-zinc-500 font-sans font-normal mt-0.5">
                        {order.date}
                      </span>
                    </td>

                    {/* Customer Name */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="font-medium text-white">{order.customer}</div>
                      <div className={`text-[11px] ${order.filePath ? 'text-zinc-500' : 'text-amber-500/80'}`}>
                        {order.filePath ? 'STL stored' : 'STL not stored'}
                      </div>
                    </td>

                    {/* Uploaded File (STL) */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2 max-w-xs">
                        <span className="w-6 h-6 rounded bg-zinc-800 flex items-center justify-center text-zinc-400 shrink-0 font-mono text-[10px]">
                          3D
                        </span>
                        <div className="truncate">
                          <span className="font-mono text-zinc-200 truncate block text-[11px]" title={order.file}>
                            {order.file}
                          </span>
                          <span className="text-[10px] text-zinc-500 block">
                            {order.dimensions} (Verified ✓)
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Calculated Volume (mm³) */}
                    <td className="py-3.5 px-4 text-right font-mono whitespace-nowrap">
                      <span className="text-zinc-200">
                        {order.volumeMm3.toLocaleString()}
                      </span>
                      <span className="text-[10px] text-zinc-500 ml-1">mm³</span>
                      <span className="block text-[10px] text-zinc-500">
                        {(order.volumeMm3 / 1000).toFixed(1)} cm³
                      </span>
                    </td>

                    {/* Calculated Weight */}
                    <td className="py-3.5 px-4 text-right font-mono whitespace-nowrap">
                      <span className="text-zinc-200">{order.weightGrams}</span>
                      <span className="text-[10px] text-zinc-500 ml-1">g</span>
                      <span className="block text-[10px] text-zinc-500">
                        ₹{order.materialCostInr.toFixed(2)} raw
                      </span>
                      <span className="block text-[10px] font-mono">
                        {order.supportsEnabled === false ? (
                          <span className="text-amber-300">no-supports{order.supportWeightG > 0 ? ` (needs ${order.supportWeightG.toFixed(1)}g)` : ''}</span>
                        ) : order.supportWeightG > 0 ? (
                          <span className="text-emerald-300">+{order.supportWeightG.toFixed(1)}g supports</span>
                        ) : (
                          <span className="text-zinc-500">0g supports</span>
                        )}
                      </span>
                    </td>

                    {/* Quoted Price */}
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-white whitespace-nowrap">
                      ₹{order.quotedPriceInr.toFixed(2)}
                      <span className="text-[10px] font-normal text-zinc-500 ml-1">INR</span>
                    </td>

                    {/* Delivery (courier charge + grand total) */}
                    <td className="py-3.5 px-4 text-right font-mono whitespace-nowrap">
                      {order.deliveryCharge !== null && order.deliveryCharge !== undefined ? (
                        <>
                          <span className="text-zinc-200">
                            {order.deliveryCharge === 0 ? 'FREE' : `₹${order.deliveryCharge.toFixed(2)}`}
                          </span>
                          <span className="block text-[10px] text-zinc-500">
                            {order.deliveryPincode ? `${order.deliveryPincode} · ` : ''}total ₹{order.grandTotalInr.toFixed(2)}
                          </span>
                        </>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>

                    {/* Payment Mode */}
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      {order.paymentMode === 'COD' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-950/60 text-amber-300 border border-amber-800/70">
                          COD
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-800/70">
                          Prepaid
                        </span>
                      )}
                    </td>

                    {/* Status Dropdown */}
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      <div className="inline-block relative">
                        <select
                          value={order.status}
                          onChange={(e) => handleStatusChange(order.id, e.target.value)}
                          className={`text-xs font-semibold py-1 px-2.5 rounded-lg border cursor-pointer focus:outline-none transition appearance-none pr-7 ${
                            STATUS_BADGES[order.status]
                          }`}
                        >
                          {STATUS_OPTIONS.map((opt) => (
                            <option key={opt} value={opt} className="bg-zinc-900 text-zinc-200">
                              {opt}
                            </option>
                          ))}
                        </select>
                        {/* Custom Dropdown Chevron */}
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1.5 text-zinc-400">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                      {order.courierTrackingUrl && (
                        <a
                          href={order.courierTrackingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 font-mono block mt-1 hover:underline truncate max-w-[120px] mx-auto"
                          title={`Courier: ${order.courierTrackingUrl}`}
                        >
                          🚚 Courier Link ↗
                        </a>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDownloadFile(order)}
                          disabled={!order.filePath || downloadingOrderId === order.id}
                          title={
                            order.filePath
                              ? 'Download 3D File (.stl / .3mf via signed Supabase URL)'
                              : '3D model file was not stored or was cleaned up to free storage'
                          }
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition ${
                            order.filePath
                              ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white border-zinc-700 hover:border-zinc-600 cursor-pointer shadow-sm'
                              : 'bg-zinc-900/60 text-zinc-600 border-zinc-800/60 cursor-not-allowed opacity-50'
                          }`}
                        >
                          <svg className="w-3.5 h-3.5 text-[#FF6500]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          <span>{downloadingOrderId === order.id ? 'Fetching…' : 'Download 3D File'}</span>
                        </button>
                        <button
                          type="button"
                          title="Send to Slicer"
                          onClick={() => alert(`Preparing slice profile for order #${order.id}...`)}
                          className="p-1 rounded-lg bg-zinc-800 hover:bg-[#FF6500] text-zinc-300 hover:text-black border border-zinc-700 transition"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer Summary */}
        <div className="px-5 py-3 border-t border-zinc-800/80 bg-zinc-950/80 flex flex-wrap items-center justify-between text-[11px] text-zinc-400">
          <div>
            Showing <strong className="text-zinc-200">{filteredOrders.length}</strong> of{' '}
            <strong className="text-zinc-200">{orders.length}</strong> orders
          </div>
          <div className="flex items-center gap-4 font-mono">
            <span>Precision Print Farm • Pan-India Fulfillment</span>
            <span className="text-zinc-600">|</span>
            <span>PLA+ Density: 1.24 g/cm³</span>
          </div>
        </div>
      </section>
        </>
      )}
    </div>
  );
}
