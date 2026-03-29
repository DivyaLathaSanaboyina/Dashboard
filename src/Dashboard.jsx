// Dashboard.jsx  — Full column mapping from Google Sheet
// Columns: Timestamp, V_R, V_Y, V_B, I_R, I_Y, I_B, P_R, P_Y, P_B,
//          Street_V, Street_I, Street_P, Street_PF, Street_F
//
// MODIFICATIONS (UI unchanged):
//  1. Y-axis strict clamping per graph type
//  2. X-axis shows ticks ONLY at 30-min boundaries; all data points still plotted
//  3. Time-range PNG export (pick start/end time → exports only that slice)
//  4. Continuous live polling from Google Sheets unchanged
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Brush, ReferenceLine
} from "recharts";
import Papa from "papaparse";
import { saveAs } from "file-saver";
import EventLog from "./EventLog";

/* ========== CONFIG ========== */
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/1C2BWZbJ1HJzzqkIuHrvH8OnrT9PbFKVCdaD-40jj9bw/gviz/tq?tqx=out:csv&gid=0";
const POLL_INTERVAL = 5000;
// NO cap on history — all data points are stored forever for the session.
// Storage: refs hold the full arrays (no re-render cost per push).
// Render:  LTTB downsampling reduces to MAX_RENDER_PTS for smooth charts.
const MAX_RENDER_PTS = 1200; // max points rendered per chart at once (LTTB keeps shape)
const MAX_EVENTS = 15;

/* ========== Y-AXIS LIMITS per graph (strict, dashboard-enforced) ========== */
// Voltages  → 0–300 V
// Currents  → 0–20 A
// Powers    → 0–5000 W
// Street V & I → 48–54 (shared axis; I values will compress but axis is correct)
// Street P, PF, Freq → 0–1
const Y_LIMITS = {
  voltage: { min: 0, max: 300 },
  current: { min: 0, max: 20 },
  power: { min: 0, max: 5000 },
  streetVI: { min: 48, max: 54 },
  streetPPF: { min: 0, max: 1 },
};

/* =====================================================================
   LTTB — Largest-Triangle-Three-Buckets downsampling
   Keeps at most `threshold` points while preserving the visual shape
   of the series. The full raw array is NEVER modified — this only
   produces a smaller array for rendering.

   Each element of `data` must have: { t: number (ms), ...values }
   We downsample on `t` as the X axis.
===================================================================== */
function lttbDownsample(data, threshold) {
  const len = data.length;
  if (len <= threshold || threshold <= 2) return data;

  const sampled = [];
  let a = 0; // first point always kept
  sampled.push(data[a]);

  const bucketSize = (len - 2) / (threshold - 2);

  for (let i = 0; i < threshold - 2; i++) {
    // Calculate point average for next bucket (look-ahead)
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, len);
    let avgX = 0;
    const avgRangeLen = avgRangeEnd - avgRangeStart;
    for (let j = avgRangeStart; j < avgRangeEnd; j++) avgX += data[j].t;
    avgX /= avgRangeLen;

    // Current bucket range
    const rangeStart = Math.floor(i * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, len);
    const pointAX = data[a].t;
    const pointAY = 0; // use 0 — we only need relative triangle area on the t axis

    let maxArea = -1, nextA = rangeStart;
    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs(
        (pointAX - avgX) * (0 - pointAY) -
        (pointAX - data[j].t) * (avgX - pointAY)
      ) * 0.5;
      if (area > maxArea) { maxArea = area; nextA = j; }
    }

    sampled.push(data[nextA]);
    a = nextA;
  }
  sampled.push(data[len - 1]); // last point always kept
  return sampled;
}

/* =====================================================================
   UNLIMITED HISTORY — stored in plain mutable refs, NOT in React state.
   This means pushing a new point costs O(1) and never triggers a full
   component re-render just to store data.

   React state (voltageHist etc.) holds only the DOWNSAMPLED snapshot
   that the chart actually renders; it is updated once per poll tick.
===================================================================== */
// Each ref holds: { t: number, ...fieldValues }[]  — grows unbounded
// (browser RAM is the only practical limit; at 5s polling even 40 hrs
//  = 28 800 points × ~200 bytes ≈ 5.5 MB total across all 4 arrays)

/* ========== HELPERS ========== */
const smallNumber = (v, dec = 2) => {
  if (v === null || v === undefined) return (0).toFixed(dec);
  return Number(v).toFixed(dec);
};

/* ─────────────────────────────────────────────────────────────────────────────
   30-MINUTE X-AXIS TICK LOGIC
   ─────────────────────────────────────────────────────────────────────────────
   • All data points are ALWAYS in chartData (dense, continuous).
   • XAxis only renders a label when the data point falls on a 30-min boundary.
   • Between boundaries the axis is blank → gives the "updates continuously,
     but X label appears only every 30 min" behaviour the user requested.
   ─────────────────────────────────────────────────────────────────────────────*/
const THIRTY_MIN_MS = 30 * 60 * 1000;

/**
 * Given a timestamp (ms), return the label if it is the first data point
 * that belongs to a new 30-min slot, otherwise return "".
 * We pass the full array so the formatter can compare slots.
 */
function build30MinTicks(dataWithTs) {
  // Map: time-string → whether it gets a tick label
  const tickSet = new Set();
  let lastSlot = null;
  dataWithTs.forEach(({ t }) => {
    const slot = Math.floor(t / THIRTY_MIN_MS); // integer slot id
    if (slot !== lastSlot) {
      tickSet.add(t);   // first point of this new slot gets the tick
      lastSlot = slot;
    }
  });
  return tickSet; // Set of raw timestamps (ms) that should show a label
}

/**
 * Format a raw-timestamp number into "HH:MM AM/PM" for the X-axis tick.
 */
function formatTickTime(t) {
  return new Date(t).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: true
  });
}

/* =====================================================================
   SMALL KPI CARD
===================================================================== */
const SmallCard = React.memo(function SmallCard({ label, value, unit, accent = "blue" }) {
  const emojiMap = {
    "Voltage R": "⚡", "Voltage Y": "⚡", "Voltage B": "⚡",
    "Current R": "🔌", "Current Y": "🔌", "Current B": "🔌",
    "Power R": "💡", "Power Y": "💡", "Power B": "💡",
    "Street Voltage": "🏙️", "Street Current": "🔋",
    "Street Power": "⚙️", "Street PF": "🎛️", "Street Freq": "📡",
  };
  const gradients = {
    blue: "from-blue-600 via-indigo-600 to-purple-600",
    green: "from-emerald-500 via-teal-500 to-cyan-500",
    orange: "from-orange-500 via-amber-500 to-yellow-500",
    pink: "from-pink-500 via-rose-500 to-red-500",
  };
  const emoji = emojiMap[label] || "📊";
  const grad = gradients[accent] || gradients.blue;
  return (
    <div role="article" aria-label={label}
      className="relative overflow-hidden rounded-2xl p-6
        bg-white/10 dark:bg-white/5 backdrop-blur-xl border border-white/20
        shadow-lg hover:shadow-neon transition-all hover:-translate-y-2">
      <p className="flex items-center gap-3 text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 uppercase">
        <span className="text-xl">{emoji}</span>{label}
      </p>
      <div className="flex items-baseline gap-3">
        <p className={`font-black text-3xl text-transparent bg-clip-text bg-gradient-to-r ${grad}`}>{value}</p>
        <span className="text-slate-500 dark:text-slate-400 text-lg font-medium">{unit}</span>
      </div>
    </div>
  );
});

/* =====================================================================
   CUSTOM TOOLTIP
===================================================================== */
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "rgba(15,23,42,0.92)", border: "1px solid rgba(99,102,241,0.4)",
      borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#e2e8f0",
      boxShadow: "0 4px 24px rgba(0,0,0,0.4)"
    }}>
      <p style={{ color: "#94a3b8", marginBottom: 6, fontWeight: 600 }}>{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: p.color, display: "inline-block" }} />
          <span style={{ color: "#cbd5e1" }}>{p.name}:</span>
          <span style={{ fontWeight: 700, color: "#f1f5f9" }}>
            {p.value !== null && p.value !== undefined ? Number(p.value).toFixed(3) : "—"}
          </span>
        </div>
      ))}
    </div>
  );
};

/* =====================================================================
   THEME-AWARE TOP-RIGHT LEGEND
===================================================================== */
const TopRightLegend = ({ keys, isDark }) => {
  const bg = isDark ? "rgba(15,23,42,0.75)" : "rgba(255,255,255,0.88)";
  const border = isDark ? "rgba(148,163,184,0.20)" : "rgba(100,116,139,0.25)";
  const text = isDark ? "#cbd5e1" : "#334155";
  const shadow = isDark ? "0 2px 10px rgba(0,0,0,0.50)" : "0 2px 8px rgba(0,0,0,0.10)";
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 3,
      background: bg, border: `1px solid ${border}`, borderRadius: 6,
      padding: "4px 8px", fontSize: 10, lineHeight: 1.5,
      boxShadow: shadow, backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)", minWidth: 68,
    }}>
      {keys.map(k => (
        <div key={k.dataKey} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{
            display: "inline-block", width: 16, height: 2.5,
            background: k.color, borderRadius: 2, flexShrink: 0,
          }} />
          <span style={{ color: text, fontWeight: 600, whiteSpace: "nowrap" }}>{k.name}</span>
        </div>
      ))}
    </div>
  );
};

/* =====================================================================
   GENERIC CHART COMPONENT
   — All data points plotted continuously
   — X-axis labels only at 30-min boundaries
   — Y-axis zoom: scroll wheel zooms IN/OUT, always clamped to [yMin,yMax]
   — Shift+drag to pan the zoomed Y window (also clamped)
   — Reset Zoom restores exactly to [yMin, yMax]
   — Brush slider at bottom for X-axis time navigation
===================================================================== */
const Charts = React.memo(function Charts({
  keys, data, yLabel, yUnit, refVal, filter = "all", yMin = 0, yMax = 300, isDark
}) {
  /* ── zoomed Y domain — null means "show full range [yMin,yMax]" ── */
  const [zoomDomain, setZoomDomain] = useState(null);
  const zoomRef = useRef(null);

  /* Clamp a [lo,hi] pair so it never escapes [yMin,yMax] */
  const clampDomain = useCallback((lo, hi) => {
    const range = hi - lo;
    const fullRange = yMax - yMin;
    // If zoomed range is wider than full range, just reset
    if (range >= fullRange) return null;
    // Shift window so it stays inside [yMin, yMax]
    let clo = lo, chi = hi;
    if (clo < yMin) { clo = yMin; chi = yMin + range; }
    if (chi > yMax) { chi = yMax; clo = yMax - range; }
    clo = Math.max(yMin, +clo.toFixed(4));
    chi = Math.min(yMax, +chi.toFixed(4));
    return [clo, chi];
  }, [yMin, yMax]);

  /* Keep ref in sync so wheel/drag handlers read latest without stale closure */
  useEffect(() => { zoomRef.current = zoomDomain; }, [zoomDomain]);

  /* Reset zoom whenever the axis limits change (different graph) */
  useEffect(() => { setZoomDomain(null); zoomRef.current = null; }, [yMin, yMax]);

  /* ── Scroll wheel: zoom in/out centered on the middle of current window ── */
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const current = zoomRef.current ?? [yMin, yMax];
    const [lo, hi] = current;
    const range = hi - lo;
    const center = (lo + hi) / 2;
    /* zoom in = shrink range 15%, zoom out = grow range 18% */
    const factor = e.deltaY < 0 ? 0.85 : 1.18;
    const newRange = range * factor;
    /* Don't zoom in too much (min 2% of full range), don't zoom out past full */
    const minRange = (yMax - yMin) * 0.02;
    if (newRange < minRange) return; // too zoomed in — stop
    const newLo = center - newRange / 2;
    const newHi = center + newRange / 2;
    const clamped = clampDomain(newLo, newHi);
    setZoomDomain(clamped); // null if wider than full → reset
  }, [yMin, yMax, clampDomain]);

  /* ── Shift+drag to pan the zoomed window ── */
  const dragRef = useRef({ active: false, startY: 0, startDomain: null });

  const handleMouseDown = useCallback((e) => {
    if (!e.shiftKey) return;
    e.preventDefault();
    dragRef.current = {
      active: true,
      startY: e.clientY,
      startDomain: zoomRef.current ?? [yMin, yMax],
    };
  }, [yMin, yMax]);

  const handleMouseMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const [lo, hi] = drag.startDomain;
    const range = hi - lo;
    /* map pixel movement to value shift: 250px = 1 full range */
    const valueDelta = ((drag.startY - e.clientY) / 250) * range;
    const clamped = clampDomain(lo + valueDelta, hi + valueDelta);
    if (clamped) setZoomDomain(clamped);
  }, [clampDomain]);

  const handleMouseUp = useCallback(() => { dragRef.current.active = false; }, []);

  /* ── Chart data ── */
  const { chartData, tickTimestamps } = useMemo(() => {
    const cd = data.map(d => {
      const point = {
        _ts: d.t,
        time: new Date(d.t).toLocaleTimeString("en-IN", {
          hour: "2-digit", minute: "2-digit", second: "2-digit"
        }),
      };
      keys.forEach(k => { point[k.dataKey] = d[k.dataKey] ?? null; });
      return point;
    });
    const tts = build30MinTicks(data);
    return { chartData: cd, tickTimestamps: tts };
  }, [data, keys]);

  /* ── Active Y domain: zoomed window OR full range ── */
  const yDomain = zoomDomain ?? [yMin, yMax];
  const isZoomed = zoomDomain !== null;

  const opacityFor = (key) => (!filter || filter === "all") ? 1 : filter === key ? 1 : 0.15;
  const yTickFmt = (v) => typeof v === "number" ? `${v.toFixed(2)}${yUnit}` : v;

  const axisColor = isDark ? "#64748b" : "#94a3b8";
  const tickColor = isDark ? "#94a3b8" : "#64748b";
  const gridColor = isDark ? "#94a3b8" : "#cbd5e1";
  const hintColor = isDark ? "#64748b" : "#94a3b8";

  const xTickFormatter = useCallback((value, index) => {
    const point = chartData[index];
    if (!point) return "";
    if (tickTimestamps.has(point._ts)) return formatTickTime(point._ts);
    return "";
  }, [chartData, tickTimestamps]);

  return (
    <div style={{ position: "relative" }}>

      {/* ── Zoom hint + live range badge + Reset button ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: hintColor }}>
          🖱 Scroll to zoom Y · Shift+drag to pan
        </span>
        {isZoomed && (
          <>
            <span style={{
              fontSize: 10, fontWeight: 700, color: "#6366f1",
              background: "rgba(99,102,241,0.12)", borderRadius: 6, padding: "2px 8px"
            }}>
              Y: {zoomDomain[0].toFixed(2)}{yUnit} – {zoomDomain[1].toFixed(2)}{yUnit}
            </span>
            <button
              onClick={() => setZoomDomain(null)}
              style={{
                fontSize: 10, cursor: "pointer",
                background: "rgba(239,68,68,0.15)", color: "#f87171",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 6, padding: "2px 8px", fontWeight: 600
              }}
            >
              Reset Zoom
            </button>
          </>
        )}
      </div>

      <div
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: isZoomed ? "zoom-in" : "crosshair", userSelect: "none" }}
      >
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData} margin={{ top: 6, right: 18, bottom: 4, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} opacity={0.22} />

            {/* X-axis: tick label only at 30-min boundaries */}
            <XAxis
              dataKey="time"
              stroke={axisColor}
              tick={{ fontSize: 10, fill: tickColor }}
              tickFormatter={xTickFormatter}
              minTickGap={1}
              interval={0}
              tickLine={false}
            />

            {/* Y-axis: zoomed domain (clamped within [yMin,yMax]) or full range */}
            <YAxis
              stroke={axisColor}
              domain={yDomain}
              allowDataOverflow={false}
              tickFormatter={yTickFmt}
              tick={{ fontSize: 10, fill: tickColor }}
              tickCount={6}
              tickLine={false}
              width={64}
              label={{ value: yLabel, angle: -90, position: "insideLeft", fill: axisColor, fontSize: 10, dy: 50 }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ display: "none" }} />
            {refVal !== null && refVal !== undefined && (
              <ReferenceLine
                y={refVal}
                stroke="#22c55e"
                strokeDasharray="6 3"
                strokeWidth={1.5}
                label={{ value: `${refVal}${yUnit} nominal`, position: "insideTopRight", fontSize: 9, fill: "#22c55e" }}
              />
            )}
            {keys.map(k => (
              <Line
                key={k.dataKey}
                type="monotone"
                dataKey={k.dataKey}
                stroke={k.color}
                strokeWidth={2.5}
                dot={false}
                name={k.name}
                strokeOpacity={opacityFor(k.dataKey)}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
            <Brush
              dataKey="time"
              height={20}
              stroke="#6366f1"
              fill="rgba(99,102,241,0.08)"
              travellerWidth={8}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* "Time →" label */}
      <div style={{
        textAlign: "right", paddingRight: 18, marginTop: 2,
        fontSize: 10, color: axisColor, userSelect: "none", pointerEvents: "none",
      }}>
        Time →
      </div>
    </div>
  );
});

/* =====================================================================
   CHART PANEL
===================================================================== */
function ChartPanel({ id, title, titleClass, keys, filterOptions, data, yLabel, yUnit, refVal, yMin = 0, yMax, isDark }) {
  const [filter, setFilter] = useState("all");
  const selectCls = isDark
    ? "px-2 py-1 text-xs rounded-lg bg-slate-800 text-gray-100 border border-slate-600 shadow-sm"
    : "px-2 py-1 text-xs rounded-lg bg-white text-gray-800 border border-slate-300 shadow-sm";

  return (
    <div id={id} className={`rounded-2xl p-4 border border-white/20 shadow-xl backdrop-blur-xl ${isDark ? "bg-white/10" : "bg-white/70"}`}>

      {/* ── Header row: title | [filter dropdown] | legend ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>

        {/* Title — left */}
        <h3 className={`text-lg font-bold bg-clip-text text-transparent ${titleClass}`}
          style={{ flexShrink: 0 }}>
          {title}
        </h3>

        {/* Right cluster: filter dropdown (optional) + legend — always flush to top-right */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexShrink: 0 }}>
          {filterOptions && (
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className={selectCls}>
              {filterOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {/* Legend sits here — completely outside the chart canvas, never overlapping plots */}
          <TopRightLegend keys={keys} isDark={isDark} />
        </div>
      </div>

      <Charts
        keys={keys} data={data} yLabel={yLabel} yUnit={yUnit}
        refVal={refVal} filter={filter} yMin={yMin} yMax={yMax} isDark={isDark}
      />
    </div>
  );
}

/* =====================================================================
   TIME-RANGE EXPORT MODAL
   — Lets user pick startTime and endTime (HH:MM), then exports only
     data points in that window from the full history array.
===================================================================== */
function TimeRangeExportModal({ isOpen, onClose, onExport, isDark, rawRef }) {
  // ── Derive actual recorded session range from whichever rawRef has data ──
  const sessionRange = useMemo(() => {
    const arr = rawRef?.current ?? [];
    if (!arr.length) return null;
    const first = arr[0].t;
    const last = arr[arr.length - 1].t;
    const fmt = (ms) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
    const fmtFull = (ms) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    return {
      startHHMM: fmt(first),   // "HH:MM" for time input default
      endHHMM: fmt(last),
      startLabel: fmtFull(first),
      endLabel: fmtFull(last),
      totalPts: arr.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, rawRef]);  // re-derive each time modal opens

  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [chartType, setChartType] = useState("voltage");
  const [exportError, setExportError] = useState("");

  // When modal opens, auto-fill pickers with actual session bounds
  useEffect(() => {
    if (isOpen && sessionRange) {
      setStartTime(sessionRange.startHHMM);
      setEndTime(sessionRange.endHHMM);
      setExportError("");
    } else if (isOpen && !sessionRange) {
      setStartTime("");
      setEndTime("");
      setExportError("No data recorded yet. Keep the dashboard running and try again.");
    }
  }, [isOpen, sessionRange]);

  if (!isOpen) return null;

  const overlayBg = "rgba(0,0,0,0.6)";
  const modalBg = isDark ? "#0f172a" : "#ffffff";
  const border = isDark ? "1px solid rgba(148,163,184,0.25)" : "1px solid rgba(100,116,139,0.2)";
  const labelClr = isDark ? "#94a3b8" : "#475569";
  const hintClr = isDark ? "#64748b" : "#94a3b8";
  const inputCls = isDark
    ? { background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 8, padding: "6px 10px", fontSize: 13, width: "100%", boxSizing: "border-box" }
    : { background: "#f1f5f9", color: "#1e293b", border: "1px solid #cbd5e1", borderRadius: 8, padding: "6px 10px", fontSize: 13, width: "100%", boxSizing: "border-box" };

  const charts = [
    { value: "voltage", label: "Three Phase Voltages" },
    { value: "current", label: "Three Phase Currents" },
    { value: "power", label: "Three Phase Powers" },
    { value: "streetVI", label: "DER Voltage & Current" },
    { value: "streetPPF", label: "DER Power · PF · Freq" },
  ];

  const handleExport = () => {
    if (!sessionRange) {
      setExportError("No data recorded yet. Keep the dashboard running and try again.");
      return;
    }
    if (!startTime || !endTime) {
      setExportError("Please select both a start and end time.");
      return;
    }
    if (startTime >= endTime) {
      setExportError("End time must be after start time.");
      return;
    }
    setExportError("");
    const err = onExport(chartType, startTime, endTime);
    if (err) {
      // exportChartPNGByRange returned an error string — show it inline, do NOT close modal
      setExportError(err);
    } else {
      onClose();
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: overlayBg, display: "flex", alignItems: "center", justifyContent: "center"
    }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: modalBg, border, borderRadius: 16, padding: 28,
        width: 380, boxShadow: "0 20px 60px rgba(0,0,0,0.5)"
      }}>
        <h3 style={{
          margin: "0 0 4px", fontSize: 16, fontWeight: 700,
          background: "linear-gradient(to right,#3b82f6,#8b5cf6)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
        }}>
          📥 Export Time Range
        </h3>

        {/* Session availability info */}
        {sessionRange ? (
          <div style={{
            marginBottom: 16, padding: "8px 10px", borderRadius: 8,
            background: isDark ? "rgba(16,185,129,0.10)" : "rgba(16,185,129,0.08)",
            border: "1px solid rgba(16,185,129,0.25)", fontSize: 11, color: "#10b981"
          }}>
            ✅ Session data available: <strong>{sessionRange.startLabel}</strong> → <strong>{sessionRange.endLabel}</strong>
            <span style={{ color: hintClr, marginLeft: 6 }}>({sessionRange.totalPts} data points)</span>
          </div>
        ) : (
          <div style={{
            marginBottom: 16, padding: "8px 10px", borderRadius: 8,
            background: isDark ? "rgba(239,68,68,0.10)" : "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)", fontSize: 11, color: "#f87171"
          }}>
            ⚠️ No data recorded yet. Keep the dashboard running to accumulate data, then export.
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: labelClr, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Chart
          </label>
          <select value={chartType} onChange={e => setChartType(e.target.value)} style={inputCls}>
            {charts.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: labelClr, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Start Time (HH:MM — 24hr)
          </label>
          <input type="time" value={startTime} onChange={e => { setStartTime(e.target.value); setExportError(""); }} style={inputCls} />
          {sessionRange && <p style={{ margin: "3px 0 0", fontSize: 10, color: hintClr }}>Session starts: {sessionRange.startLabel}</p>}
        </div>

        <div style={{ marginBottom: exportError ? 10 : 22 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: labelClr, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            End Time (HH:MM — 24hr)
          </label>
          <input type="time" value={endTime} onChange={e => { setEndTime(e.target.value); setExportError(""); }} style={inputCls} />
          {sessionRange && <p style={{ margin: "3px 0 0", fontSize: 10, color: hintClr }}>Session ends: {sessionRange.endLabel}</p>}
        </div>

        {/* Inline error — replaces the horrible browser alert */}
        {exportError && (
          <div style={{
            marginBottom: 14, padding: "7px 10px", borderRadius: 8,
            background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)",
            fontSize: 11, color: "#f87171", fontWeight: 500
          }}>
            ⚠️ {exportError}
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "9px 0", borderRadius: 10, fontSize: 13, fontWeight: 600,
            background: "transparent",
            border: isDark ? "1px solid #334155" : "1px solid #cbd5e1",
            color: isDark ? "#94a3b8" : "#64748b", cursor: "pointer"
          }}>Cancel</button>
          <button onClick={handleExport} style={{
            flex: 1, padding: "9px 0", borderRadius: 10, fontSize: 13, fontWeight: 600,
            background: sessionRange ? "linear-gradient(to right,#3b82f6,#8b5cf6)" : "#334155",
            border: "none", color: "#fff", cursor: sessionRange ? "pointer" : "not-allowed",
            boxShadow: "0 4px 14px rgba(99,102,241,0.4)"
          }}>Export PNG</button>
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
   PNG EXPORT — canvas drawn, legend INSIDE top-right
===================================================================== */
const exportChartPNG = (chartData, keys, yDomain, yUnit, yLabel, title, filename, accentColor) => {
  const W = 1000, H = 460;
  const margin = { top: 56, right: 16, bottom: 60, left: 84 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;

  const canvas = document.createElement("canvas");
  canvas.width = W * 2; canvas.height = H * 2;
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  /* ── Legend ── */
  const LEGEND_ROW_H = 18, LEGEND_PAD_X = 10, LEGEND_PAD_Y = 7;
  const SWATCH_W = 20, SWATCH_GAP = 6, LEGEND_FONT = 10, LEGEND_MARGIN = 12;
  ctx.font = `600 ${LEGEND_FONT}px system-ui, sans-serif`;
  const maxTextW = Math.max(...keys.map(k => ctx.measureText(k.name).width));
  const boxW = LEGEND_PAD_X * 2 + SWATCH_W + SWATCH_GAP + maxTextW + 2;
  const boxH = LEGEND_PAD_Y * 2 + keys.length * LEGEND_ROW_H - (LEGEND_ROW_H - 14);
  const bx = W - LEGEND_MARGIN - boxW, by = LEGEND_MARGIN;

  ctx.shadowColor = "rgba(0,0,0,0.10)"; ctx.shadowBlur = 6;
  ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 1;
  const R = 5;
  ctx.beginPath();
  ctx.moveTo(bx + R, by); ctx.lineTo(bx + boxW - R, by);
  ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + R);
  ctx.lineTo(bx + boxW, by + boxH - R);
  ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - R, by + boxH);
  ctx.lineTo(bx + R, by + boxH); ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - R);
  ctx.lineTo(bx, by + R); ctx.quadraticCurveTo(bx, by, bx + R, by);
  ctx.closePath(); ctx.fill();
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.stroke();

  keys.forEach((k, idx) => {
    const rowY = by + LEGEND_PAD_Y + idx * LEGEND_ROW_H;
    const lineY = rowY + 7;
    ctx.strokeStyle = k.color; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(bx + LEGEND_PAD_X, lineY); ctx.lineTo(bx + LEGEND_PAD_X + SWATCH_W, lineY); ctx.stroke();
    ctx.font = `600 ${LEGEND_FONT}px system-ui, sans-serif`;
    ctx.fillStyle = "#1e293b"; ctx.textAlign = "left";
    ctx.fillText(k.name, bx + LEGEND_PAD_X + SWATCH_W + SWATCH_GAP, lineY + 3);
  });
  ctx.setLineDash([]); ctx.lineCap = "butt";

  /* ── Title ── */
  ctx.font = "bold 15px system-ui, sans-serif";
  ctx.fillStyle = accentColor; ctx.textAlign = "left";
  ctx.fillText(title, margin.left, 32);

  /* ── Y-axis label ── */
  ctx.save();
  ctx.translate(16, margin.top + plotH / 2); ctx.rotate(-Math.PI / 2);
  ctx.font = "11px system-ui, sans-serif"; ctx.fillStyle = "#64748b"; ctx.textAlign = "center";
  ctx.fillText(yLabel, 0, 0); ctx.restore();

  /* ── X-axis label ── */
  ctx.font = "11px system-ui, sans-serif"; ctx.fillStyle = "#64748b"; ctx.textAlign = "right";
  ctx.fillText("Time →", margin.left + plotW, H - 10);

  /* ── Y scale ── */
  const [yMin, yMax2] = Array.isArray(yDomain) ? yDomain : [0, 100];
  const yRange = (yMax2 - yMin) || 1;
  const toY = v => margin.top + plotH - ((v - yMin) / yRange) * plotH;

  const TICK_COUNT = 5;
  for (let i = 0; i <= TICK_COUNT; i++) {
    const val = yMin + (yRange * i) / TICK_COUNT;
    const y = toY(val);
    ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(margin.left + plotW, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "10px system-ui, sans-serif"; ctx.fillStyle = "#94a3b8"; ctx.textAlign = "right";
    ctx.fillText(`${val.toFixed(2)}${yUnit}`, margin.left - 6, y + 4);
  }

  /* ── X-tick labels: 30-min boundaries only ── */
  if (chartData.length > 1) {
    // Build tick set from the exported data
    const exportTickTs = build30MinTicks(chartData.map(d => ({ t: d._ts })));
    ctx.font = "10px system-ui, sans-serif"; ctx.fillStyle = "#94a3b8"; ctx.textAlign = "center";
    chartData.forEach((d, i) => {
      if (!exportTickTs.has(d._ts)) return;
      const x = margin.left + (i / (chartData.length - 1)) * plotW;
      ctx.fillText(formatTickTime(d._ts), x, margin.top + plotH + 18);
    });
  }

  /* ── Axis lines ── */
  ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 1.5; ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top); ctx.lineTo(margin.left, margin.top + plotH);
  ctx.lineTo(margin.left + plotW, margin.top + plotH); ctx.stroke();

  /* ── Data lines ── */
  if (chartData.length > 1) {
    keys.forEach(k => {
      ctx.strokeStyle = k.color; ctx.lineWidth = 2.2; ctx.setLineDash([]);
      ctx.beginPath();
      let started = false;
      chartData.forEach((d, i) => {
        const v = d[k.dataKey];
        if (v === null || v === undefined || isNaN(v)) { started = false; return; }
        const x = margin.left + (i / (chartData.length - 1)) * plotW;
        const y = toY(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  }

  ctx.setLineDash([]); ctx.lineCap = "butt";
  canvas.toBlob(blob => saveAs(blob, `${filename}_${Date.now()}.png`));
};

/* ─────────────────────────────────────────────────────────────────────────────
   TIME-RANGE AWARE PNG EXPORT
   • Filters the history array by startTime/endTime (HH:MM strings, today)
   • Builds chartData with _ts preserved for 30-min tick logic in the canvas
   ─────────────────────────────────────────────────────────────────────────────*/
function exportChartPNGByRange(hist, keys, yDomain, yUnit, yLabel, title, filename, accentColor, startTime, endTime) {
  if (!hist || hist.length === 0) {
    return "No data has been recorded yet. Keep the dashboard running to accumulate data.";
  }
  if (!startTime || !endTime) {
    return "Please select both a start and end time.";
  }

  // Match against the actual dates present in the data (not hardcoded "today")
  // Each data point has d.t as a ms timestamp. We match HH:MM against that.
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);

  const sliced = hist.filter(d => {
    const dt = new Date(d.t);
    const h = dt.getHours(), m = dt.getMinutes();
    const pointMins = h * 60 + m;
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    return pointMins >= startMins && pointMins <= endMins;
  });

  if (sliced.length < 2) {
    // Tell the user what range IS available
    const firstTs = hist[0].t, lastTs = hist[hist.length - 1].t;
    const fmtAvail = (ms) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    return `No data found between ${startTime} and ${endTime}. Available range: ${fmtAvail(firstTs)} → ${fmtAvail(lastTs)} (${hist.length} points).`;
  }

  // Build chartData WITH _ts field preserved (needed for 30-min tick logic in canvas)
  const chartData = sliced.map(d => {
    const point = {
      _ts: d.t,
      time: new Date(d.t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    };
    keys.forEach(k => { point[k.dataKey] = d[k.dataKey] ?? null; });
    return point;
  });

  exportChartPNG(chartData, keys, yDomain, yUnit, yLabel, title, filename, accentColor);
  return null; // null = success
}

const exportCSV = (csvText) => {
  if (!csvText || csvText.length < 5) { alert("CSV not ready yet!"); return; }
  saveAs(new Blob([csvText], { type: "text/csv;charset=utf-8" }), `smartgrid_data_${Date.now()}.csv`);
};

/* =====================================================================
   MAIN DASHBOARD
===================================================================== */
export default function Dashboard() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  const isDark = theme === "dark";
  const [status, setStatus] = useState("Connecting...");
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showExportModal, setShowExportModal] = useState(false);

  const emptyData = {
    Va: 0, Vb: 0, Vc: 0, Ia: 0, Ib: 0, Ic: 0,
    Pa: 0, Pb: 0, Pc: 0, St_V: 0, St_I: 0, St_P: 0, St_PF: 0, St_F: 0,
    Timestamp: ""
  };
  const [data, setData] = useState(emptyData);

  // ── FULL history refs (never capped, never cause re-renders on push) ──
  // These grow for the entire session — 40 hrs at 5 s polling ≈ 28 800 rows ≈ 6 MB
  const voltageRaw = useRef([]); // { t, Va, Vb, Vc }[]
  const currentRaw = useRef([]); // { t, Ia, Ib, Ic }[]
  const powerRaw = useRef([]); // { t, Pa, Pb, Pc }[]
  const streetRaw = useRef([]); // { t, St_V, St_I, St_P, St_PF, St_F }[]

  // ── DOWNSAMPLED snapshots (React state) — only what charts render ──
  // Updated once per poll tick via LTTB so charts stay smooth.
  const [voltageHist, setVoltageHist] = useState([]);
  const [currentHist, setCurrentHist] = useState([]);
  const [powerHist, setPowerHist] = useState([]);
  const [streetHist, setStreetHist] = useState([]);

  const prevRawRef = useRef(null);
  const prevDataRef = useRef(emptyData);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    localStorage.setItem("theme", theme);
  }, [theme, isDark]);

  /* ── Gate values into allowed Y ranges before storing ── */
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(CSV_URL);
      if (!res.ok) { setStatus("Disconnected"); setLoading(false); return; }
      const text = await res.text();
      const parsed = Papa.parse(text, { header: true, dynamicTyping: true });
      if (!parsed.data.length) return;
      const validRows = parsed.data.filter(r => r["Timestamp"]);
      if (!validRows.length) return;
      const row = validRows[validRows.length - 1];
      const rawId = JSON.stringify(row);
      if (prevRawRef.current === rawId) { setLoading(false); return; }
      prevRawRef.current = rawId;

      /* gate(v, lo, hi) → null if out of range (so it won't plot) */
      const gate = (v, lo, hi) => { const n = Number(v) || 0; return (n >= lo && n <= hi) ? n : null; };

      const newData = {
        Va: gate(row["V_R"], Y_LIMITS.voltage.min, Y_LIMITS.voltage.max),
        Vb: gate(row["V_Y"], Y_LIMITS.voltage.min, Y_LIMITS.voltage.max),
        Vc: gate(row["V_B"], Y_LIMITS.voltage.min, Y_LIMITS.voltage.max),
        Ia: gate(row["I_R"], Y_LIMITS.current.min, Y_LIMITS.current.max),
        Ib: gate(row["I_Y"], Y_LIMITS.current.min, Y_LIMITS.current.max),
        Ic: gate(row["I_B"], Y_LIMITS.current.min, Y_LIMITS.current.max),
        Pa: gate(row["P_R"], Y_LIMITS.power.min, Y_LIMITS.power.max),
        Pb: gate(row["P_Y"], Y_LIMITS.power.min, Y_LIMITS.power.max),
        Pc: gate(row["P_B"], Y_LIMITS.power.min, Y_LIMITS.power.max),
        St_V: gate(row["Street_V"], Y_LIMITS.streetVI.min, Y_LIMITS.streetVI.max),
        St_I: gate(row["Street_I"], Y_LIMITS.streetVI.min, Y_LIMITS.streetVI.max),
        St_P: gate(row["Street_P"], Y_LIMITS.streetPPF.min, Y_LIMITS.streetPPF.max),
        St_PF: gate(row["Street_PF"], Y_LIMITS.streetPPF.min, Y_LIMITS.streetPPF.max),
        St_F: gate(row["Street_F"], Y_LIMITS.streetPPF.min, Y_LIMITS.streetPPF.max),
        Timestamp: new Date().toLocaleTimeString()
      };

      const prev = prevDataRef.current;
      const changed = prev.Va !== newData.Va || prev.Ia !== newData.Ia || prev.Pa !== newData.Pa || prev.St_V !== newData.St_V;
      const hasData = newData.Va || newData.Ia || newData.Pa || newData.St_V;

      setStatus(hasData ? "Connected" : "Disconnected");
      if (changed && hasData)
        setEvents(p => [{ msg: "Data updated", time: Date.now(), level: "success" }, ...p].slice(0, MAX_EVENTS));

      setData(newData);
      prevDataRef.current = newData;
      const now = Date.now();

      // ── Push into unlimited raw refs (no React state cost) ──
      voltageRaw.current.push({ t: now, Va: newData.Va, Vb: newData.Vb, Vc: newData.Vc });
      currentRaw.current.push({ t: now, Ia: newData.Ia, Ib: newData.Ib, Ic: newData.Ic });
      powerRaw.current.push({ t: now, Pa: newData.Pa, Pb: newData.Pb, Pc: newData.Pc });
      streetRaw.current.push({ t: now, St_V: newData.St_V, St_I: newData.St_I, St_P: newData.St_P, St_PF: newData.St_PF, St_F: newData.St_F });

      // ── Push LTTB-downsampled snapshots to React state for chart rendering ──
      // lttbDownsample keeps MAX_RENDER_PTS representative points from the full array,
      // so the chart stays fast even after 40 hrs of data.
      setVoltageHist(lttbDownsample(voltageRaw.current, MAX_RENDER_PTS));
      setCurrentHist(lttbDownsample(currentRaw.current, MAX_RENDER_PTS));
      setPowerHist(lttbDownsample(powerRaw.current, MAX_RENDER_PTS));
      setStreetHist(lttbDownsample(streetRaw.current, MAX_RENDER_PTS));

      if (text && text.length > 10) window.__SMARTGRID_CSV__ = text;
      setLoading(false);
    } catch { setStatus("Disconnected"); setLoading(false); }
  }, []);

  /* ══════════════════════════════════════════════════════════════════
     HISTORICAL BACKFILL — runs ONCE on mount.
     Reads every row in the Sheet, filters to TODAY only, parses
     timestamps, and pre-fills the raw refs so that:
       • Charts immediately show all of today's data from row 1
       • Time-range export works for any window that already passed
       • Live polling continues seamlessly on top of backfill data
  ══════════════════════════════════════════════════════════════════ */
  const backfilledRef = useRef(false); // prevent running twice in StrictMode

  const backfillHistory = useCallback(async () => {
    if (backfilledRef.current) return;
    backfilledRef.current = true;

    try {
      const res = await fetch(CSV_URL);
      if (!res.ok) return;
      const text = await res.text();
      const parsed = Papa.parse(text, { header: true, dynamicTyping: true });
      if (!parsed.data.length) return;

      const gate = (v, lo, hi) => { const n = Number(v) || 0; return (n >= lo && n <= hi) ? n : null; };

      // Today's midnight in ms — used to filter rows to today only
      const todayMidnight = (() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
      })();
      const tomorrowMidnight = todayMidnight + 86400000;

      // Attempt to parse timestamp string from Sheet into a real ms value.
      // Sheet timestamps are typically "DD/MM/YYYY HH:MM:SS" or "M/D/YYYY H:MM:SS"
      // We try multiple formats and fall back to Date.parse.
      const parseSheetTs = (raw) => {
        if (!raw) return null;
        const s = String(raw).trim();

        // Format 1: "DD/MM/YYYY HH:MM:SS" or "D/M/YYYY H:MM:SS"
        const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[, ]+(\d{1,2}):(\d{2}):(\d{2})/);
        if (m1) {
          const [, d, mo, y, h, mi, sec] = m1.map(Number);
          return new Date(y, mo - 1, d, h, mi, sec).getTime();
        }
        // Format 2: "YYYY-MM-DD HH:MM:SS"
        const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ]+(\d{2}):(\d{2}):(\d{2})/);
        if (m2) {
          const [, y, mo, d, h, mi, sec] = m2.map(Number);
          return new Date(y, mo - 1, d, h, mi, sec).getTime();
        }
        // Format 3: "MM/DD/YYYY HH:MM:SS" (US style)
        const m3 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[, ]+(\d{1,2}):(\d{2}):(\d{2})/);
        if (m3) {
          const [, mo, d, y, h, mi, sec] = m3.map(Number);
          const ts = new Date(y, mo - 1, d, h, mi, sec).getTime();
          if (!isNaN(ts)) return ts;
        }
        // Fallback: native parse
        const fb = Date.parse(s);
        return isNaN(fb) ? null : fb;
      };

      const validRows = parsed.data.filter(r => r["Timestamp"]);

      // Process all rows, filter to today, build history arrays
      const vArr = [], iArr = [], pArr = [], sArr = [];
      const seenTs = new Set(); // deduplicate by ms timestamp

      validRows.forEach(row => {
        const t = parseSheetTs(row["Timestamp"]);
        if (!t || t < todayMidnight || t >= tomorrowMidnight) return; // not today
        if (seenTs.has(t)) return; // duplicate row
        seenTs.add(t);

        const pt = {
          Va: gate(row["V_R"], Y_LIMITS.voltage.min, Y_LIMITS.voltage.max),
          Vb: gate(row["V_Y"], Y_LIMITS.voltage.min, Y_LIMITS.voltage.max),
          Vc: gate(row["V_B"], Y_LIMITS.voltage.min, Y_LIMITS.voltage.max),
          Ia: gate(row["I_R"], Y_LIMITS.current.min, Y_LIMITS.current.max),
          Ib: gate(row["I_Y"], Y_LIMITS.current.min, Y_LIMITS.current.max),
          Ic: gate(row["I_B"], Y_LIMITS.current.min, Y_LIMITS.current.max),
          Pa: gate(row["P_R"], Y_LIMITS.power.min, Y_LIMITS.power.max),
          Pb: gate(row["P_Y"], Y_LIMITS.power.min, Y_LIMITS.power.max),
          Pc: gate(row["P_B"], Y_LIMITS.power.min, Y_LIMITS.power.max),
          St_V: gate(row["Street_V"], Y_LIMITS.streetVI.min, Y_LIMITS.streetVI.max),
          St_I: gate(row["Street_I"], Y_LIMITS.streetVI.min, Y_LIMITS.streetVI.max),
          St_P: gate(row["Street_P"], Y_LIMITS.streetPPF.min, Y_LIMITS.streetPPF.max),
          St_PF: gate(row["Street_PF"], Y_LIMITS.streetPPF.min, Y_LIMITS.streetPPF.max),
          St_F: gate(row["Street_F"], Y_LIMITS.streetPPF.min, Y_LIMITS.streetPPF.max),
        };

        vArr.push({ t, Va: pt.Va, Vb: pt.Vb, Vc: pt.Vc });
        iArr.push({ t, Ia: pt.Ia, Ib: pt.Ib, Ic: pt.Ic });
        pArr.push({ t, Pa: pt.Pa, Pb: pt.Pb, Pc: pt.Pc });
        sArr.push({ t, St_V: pt.St_V, St_I: pt.St_I, St_P: pt.St_P, St_PF: pt.St_PF, St_F: pt.St_F });
      });

      // Sort by time (Sheet rows should already be sorted, but be defensive)
      const byT = (a, b) => a.t - b.t;
      vArr.sort(byT); iArr.sort(byT); pArr.sort(byT); sArr.sort(byT);

      if (!vArr.length) return; // no today rows found — skip

      // Write into refs atomically, then update chart state once
      voltageRaw.current = vArr;
      currentRaw.current = iArr;
      powerRaw.current = pArr;
      streetRaw.current = sArr;

      // Track the last backfilled row so live polling doesn't re-add it
      prevRawRef.current = JSON.stringify(validRows[validRows.length - 1]);

      // Update chart state with LTTB-downsampled backfill data
      setVoltageHist(lttbDownsample(vArr, MAX_RENDER_PTS));
      setCurrentHist(lttbDownsample(iArr, MAX_RENDER_PTS));
      setPowerHist(lttbDownsample(pArr, MAX_RENDER_PTS));
      setStreetHist(lttbDownsample(sArr, MAX_RENDER_PTS));

      // Set KPI cards to the latest backfilled value
      const last = vArr[vArr.length - 1];
      const lastI = iArr[iArr.length - 1];
      const lastP = pArr[pArr.length - 1];
      const lastS = sArr[sArr.length - 1];
      setData({
        Va: last.Va, Vb: last.Vb, Vc: last.Vc,
        Ia: lastI.Ia, Ib: lastI.Ib, Ic: lastI.Ic,
        Pa: lastP.Pa, Pb: lastP.Pb, Pc: lastP.Pc,
        St_V: lastS.St_V, St_I: lastS.St_I, St_P: lastS.St_P, St_PF: lastS.St_PF, St_F: lastS.St_F,
        Timestamp: new Date(last.t).toLocaleTimeString()
      });
      setStatus("Connected");
      setEvents(p => [{
        msg: `Backfilled ${vArr.length} historical rows from today`,
        time: Date.now(), level: "success"
      }, ...p].slice(0, MAX_EVENTS));
      setLoading(false);

    } catch (e) {
      console.warn("Backfill failed:", e);
      // Non-fatal — live polling will still work
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // 1. Backfill all of today's rows immediately on mount
    backfillHistory();
    // 2. Start live polling — fetchData skips rows already seen via prevRawRef
    const id = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [backfillHistory, fetchData]);

  /* ── KPI cards ── */
  const voltageCards = [
    { label: "Voltage R", value: smallNumber(data.Va, 1), unit: "V", accent: "blue" },
    { label: "Voltage Y", value: smallNumber(data.Vb, 1), unit: "V", accent: "blue" },
    { label: "Voltage B", value: smallNumber(data.Vc, 1), unit: "V", accent: "blue" },
  ];
  const currentCards = [
    { label: "Current R", value: smallNumber(data.Ia, 3), unit: "A", accent: "orange" },
    { label: "Current Y", value: smallNumber(data.Ib, 3), unit: "A", accent: "orange" },
    { label: "Current B", value: smallNumber(data.Ic, 3), unit: "A", accent: "orange" },
  ];
  const powerCards = [
    { label: "Power R", value: smallNumber(data.Pa, 1), unit: "W", accent: "pink" },
    { label: "Power Y", value: smallNumber(data.Pb, 1), unit: "W", accent: "pink" },
    { label: "Power B", value: smallNumber(data.Pc, 1), unit: "W", accent: "pink" },
  ];
  const streetCards = [
    { label: "Street Voltage", value: smallNumber(data.St_V, 1), unit: "V", accent: "green" },
    { label: "Street Current", value: smallNumber(data.St_I, 3), unit: "A", accent: "green" },
    { label: "Street Power", value: smallNumber(data.St_P, 1), unit: "W", accent: "green" },
    { label: "Street PF", value: smallNumber(data.St_PF, 2), unit: "PF", accent: "blue" },
    { label: "Street Freq", value: smallNumber(data.St_F, 1), unit: "Hz", accent: "orange" },
  ];

  /* ── Chart keys ── */
  const vKeys = [{ dataKey: "Va", name: "V_R", color: "#3b82f6" }, { dataKey: "Vb", name: "V_Y", color: "#06b6d4" }, { dataKey: "Vc", name: "V_B", color: "#f59e0b" }];
  const iKeys = [{ dataKey: "Ia", name: "I_R", color: "#3b82f6" }, { dataKey: "Ib", name: "I_Y", color: "#06b6d4" }, { dataKey: "Ic", name: "I_B", color: "#f59e0b" }];
  const pKeys = [{ dataKey: "Pa", name: "P_R", color: "#ec4899" }, { dataKey: "Pb", name: "P_Y", color: "#8b5cf6" }, { dataKey: "Pc", name: "P_B", color: "#f59e0b" }];
  const stVIKeys = [{ dataKey: "St_V", name: "DER V", color: "#10b981" }, { dataKey: "St_I", name: "DER I", color: "#06b6d4" }];
  const stPFKeys = [{ dataKey: "St_P", name: "DER Power", color: "#10b981" }, { dataKey: "St_PF", name: "DER PF", color: "#f59e0b" }, { dataKey: "St_F", name: "DER Freq", color: "#ec4899" }];

  const vFilterOpts = [{ value: "all", label: "All Phases" }, { value: "Va", label: "Phase R (Va)" }, { value: "Vb", label: "Phase Y (Vb)" }, { value: "Vc", label: "Phase B (Vc)" }];
  const iFilterOpts = [{ value: "all", label: "All Phases" }, { value: "Ia", label: "Phase R (Ia)" }, { value: "Ib", label: "Phase Y (Ib)" }, { value: "Ic", label: "Phase B (Ic)" }];
  const pFilterOpts = [{ value: "all", label: "All Phases" }, { value: "Pa", label: "Phase R (Pa)" }, { value: "Pb", label: "Phase Y (Pb)" }, { value: "Pc", label: "Phase B (Pc)" }];

  /* ─────────────────────────────────────────────────────────────────────
     TIME-RANGE EXPORT HANDLER
     Resolves which hist + keys to use based on chartType selection,
     then slices by time range and exports.
  ──────────────────────────────────────────────────────────────────── */
  const handleRangeExport = useCallback((chartType, startTime, endTime) => {
    // IMPORTANT: use the *raw* refs (not downsampled state) so every recorded
    // data point in the requested window is included in the export image.
    const configs = {
      voltage: {
        hist: voltageRaw.current, keys: vKeys,
        yDomain: [Y_LIMITS.voltage.min, Y_LIMITS.voltage.max],
        yUnit: "V", yLabel: "Voltage (V)",
        title: "Three Phase Voltages", filename: "three_phase_voltage", accent: "#2563eb"
      },
      current: {
        hist: currentRaw.current, keys: iKeys,
        yDomain: [Y_LIMITS.current.min, Y_LIMITS.current.max],
        yUnit: "A", yLabel: "Current (A)",
        title: "Three Phase Currents", filename: "three_phase_current", accent: "#9333ea"
      },
      power: {
        hist: powerRaw.current, keys: pKeys,
        yDomain: [Y_LIMITS.power.min, Y_LIMITS.power.max],
        yUnit: "W", yLabel: "Power (W)",
        title: "Three Phase Powers", filename: "three_phase_power", accent: "#db2777"
      },
      streetVI: {
        hist: streetRaw.current, keys: stVIKeys,
        yDomain: [Y_LIMITS.streetVI.min, Y_LIMITS.streetVI.max],
        yUnit: "", yLabel: "V / A",
        title: "DER Voltage & Current", filename: "der_voltage_current", accent: "#059669"
      },
      streetPPF: {
        hist: streetRaw.current, keys: stPFKeys,
        yDomain: [Y_LIMITS.streetPPF.min, Y_LIMITS.streetPPF.max],
        yUnit: "", yLabel: "PF",
        title: "DER Power · PF · Frequency", filename: "der_power_pf_freq", accent: "#0d9488"
      },
    };
    const cfg = configs[chartType];
    if (!cfg) return null;
    // Returns null on success, or an error string to show inline in the modal
    return exportChartPNGByRange(
      cfg.hist, cfg.keys, cfg.yDomain, cfg.yUnit, cfg.yLabel,
      cfg.title, cfg.filename, cfg.accent,
      startTime, endTime
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vKeys, iKeys, pKeys, stVIKeys, stPFKeys]);

  /* ── Full-history export: reads raw refs → every single recorded point ── */
  const buildChartDataFull = (rawRef, keys) => rawRef.current.map(d => {
    const p = { _ts: d.t, time: new Date(d.t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) };
    keys.forEach(k => { p[k.dataKey] = d[k.dataKey] ?? null; });
    return p;
  });

  const sectionBg = isDark ? "bg-white/5" : "bg-white/40";
  const h2Color = isDark ? "text-slate-400" : "text-slate-600";

  return (
    <div className={`min-h-screen p-6 transition-all ${isDark ? "bg-slate-900 text-slate-100" : "bg-slate-100 text-slate-900"}`}>

      {/* Ambient lights */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -left-40 -top-32 w-96 h-96 rounded-full bg-purple-500/20 blur-[120px]" />
        <div className="absolute right-0 top-1/4 w-80 h-80 rounded-full bg-indigo-500/20 blur-[100px]" />
        <div className="absolute left-1/2 bottom-0 w-72 h-72 rounded-full bg-emerald-500/10 blur-[100px]" />
      </div>

      {/* ══ TIME-RANGE EXPORT MODAL ══ */}
      <TimeRangeExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        onExport={handleRangeExport}
        isDark={isDark}
        rawRef={voltageRaw}
      />

      {/* ══ HEADER ══ */}
      <header className={`rounded-2xl px-6 py-4 mb-6 shadow-xl backdrop-blur-xl border border-white/20
        ${isDark ? "bg-white/10" : "bg-white/70"}`}>

        {/* Row 1 */}
        <div className="flex items-center justify-between gap-4 mb-3">
          {/* ── Title block — no logo, clean professional layout ── */}
          <div className="flex flex-col gap-0.5 min-w-0">
            {/* Eyebrow label */}
            <p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${isDark ? "text-indigo-400" : "text-indigo-500"}`}>
              Real-time Energy Monitoring
            </p>
            {/* Main title — gradient, truncates gracefully on small screens */}
            <h1
              className="font-black text-transparent bg-clip-text leading-tight truncate"
              style={{
                fontSize: "clamp(14px, 2vw, 20px)",
                background: "linear-gradient(90deg,#3b82f6 0%,#6366f1 45%,#a855f7 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                letterSpacing: "-0.01em",
              }}
            >
              Dynamic Phase Reconfiguration in DER-Integrated Distribution Feeders
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs hidden sm:block ${isDark ? "opacity-70" : "opacity-55"}`}>
              {loading ? "Loading…" : data.Timestamp}
            </span>
            <span className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border
              ${status === "Connected" ? "bg-emerald-100 text-emerald-800 border-emerald-400" : "bg-rose-100 text-rose-800 border-rose-400"}`}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse ${status === "Connected" ? "bg-emerald-500" : "bg-rose-500"}`} />
              {status}
            </span>
            <button onClick={() => setTheme(isDark ? "light" : "dark")}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium border hover:scale-105 transition-all
                ${isDark ? "bg-slate-700 text-slate-200 border-slate-600" : "bg-slate-200 text-slate-700 border-slate-300"}`}>
              {isDark ? "☀️ Light" : "🌙 Dark"}
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className={`border-t mb-3 ${isDark ? "border-white/20" : "border-slate-200"}`} />

        {/* Row 2: export buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-semibold uppercase tracking-wider mr-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>Export:</span>

          {/* ── Full-history PNG exports (original buttons, unchanged) ── */}
          {[
            {
              label: "⬇ Voltage PNG", bg: "bg-blue-600 hover:bg-blue-700",
              fn: () => exportChartPNG(buildChartDataFull(voltageRaw, vKeys), vKeys, [Y_LIMITS.voltage.min, Y_LIMITS.voltage.max], "V", "Voltage (V)", "Three Phase Voltage", "three_phase_voltage", "#2563eb")
            },
            {
              label: "⬇ Current PNG", bg: "bg-purple-600 hover:bg-purple-700",
              fn: () => exportChartPNG(buildChartDataFull(currentRaw, iKeys), iKeys, [Y_LIMITS.current.min, Y_LIMITS.current.max], "A", "Current (A)", "Three Phase Current", "three_phase_current", "#9333ea")
            },
            {
              label: "⬇ Power PNG", bg: "bg-pink-600 hover:bg-pink-700",
              fn: () => exportChartPNG(buildChartDataFull(powerRaw, pKeys), pKeys, [Y_LIMITS.power.min, Y_LIMITS.power.max], "W", "Power (W)", "Three Phase Power", "three_phase_power", "#db2777")
            },
            {
              label: "⬇ DER V&I PNG", bg: "bg-emerald-600 hover:bg-emerald-700",
              fn: () => exportChartPNG(buildChartDataFull(streetRaw, stVIKeys), stVIKeys, [Y_LIMITS.streetVI.min, Y_LIMITS.streetVI.max], "", "V / A", "DER (Rooftop) Voltage & Current", "der_voltage_current", "#059669")
            },
            {
              label: "⬇ DER PF PNG", bg: "bg-teal-600 hover:bg-teal-700",
              fn: () => exportChartPNG(buildChartDataFull(streetRaw, stPFKeys), stPFKeys, [Y_LIMITS.streetPPF.min, Y_LIMITS.streetPPF.max], "", "PF", "DER (Rooftop) Power · PF · Frequency", "der_power_pf_freq", "#0d9488")
            },
          ].map(btn => (
            <button key={btn.label} onClick={btn.fn}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm hover:scale-105 transition-all ${btn.bg}`}>
              {btn.label}
            </button>
          ))}

          <div className={`w-px h-6 mx-1 hidden sm:block ${isDark ? "bg-white/20" : "bg-slate-300"}`} />

          {/* ── NEW: Time-range export button ── */}
          <button
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white shadow-sm hover:scale-105 transition-all"
          >
            🕐 Export by Time Range
          </button>

          <div className={`w-px h-6 mx-1 hidden sm:block ${isDark ? "bg-white/20" : "bg-slate-300"}`} />

          <button onClick={() => exportCSV(window.__SMARTGRID_CSV__)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:scale-105 transition-all">
            ⬇ CSV Data
          </button>
        </div>
      </header>

      {/* ══ MAIN ══ */}
      <main className="grid grid-cols-1 lg:grid-cols-4 gap-5 items-stretch">
        <section className="lg:col-span-3 space-y-5">

          <div className={`rounded-2xl p-4 ${sectionBg} border border-white/20 space-y-3`}>
            <h2 className={`text-xs font-bold uppercase tracking-widest ${h2Color}`}>⚡ 3-Phase Metrics</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{voltageCards.map((c, i) => <SmallCard key={i} {...c} />)}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{currentCards.map((c, i) => <SmallCard key={i} {...c} />)}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{powerCards.map((c, i) => <SmallCard key={i} {...c} />)}</div>
          </div>

          <div className={`rounded-2xl p-4 ${sectionBg} border border-white/20 space-y-3`}>
            <h2 className={`text-xs font-bold uppercase tracking-widest ${h2Color}`}>🌿 DER-Integrated Dynamic Phase Reconfiguration Feeder</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">{streetCards.map((c, i) => <SmallCard key={i} {...c} />)}</div>
          </div>

          {/* ── Voltage: 0–300V ── */}
          <ChartPanel id="chartVoltage" title="Three Phase Voltages"
            titleClass="bg-gradient-to-r from-blue-500 to-purple-500"
            keys={vKeys} filterOptions={vFilterOpts} data={voltageHist}
            yLabel="Voltage (V)" yUnit="V" refVal={230}
            yMin={Y_LIMITS.voltage.min} yMax={Y_LIMITS.voltage.max} isDark={isDark} />

          {/* ── Current: 0–20A ── */}
          <ChartPanel id="chartCurrent" title="Three Phase Currents"
            titleClass="bg-gradient-to-r from-purple-500 to-pink-500"
            keys={iKeys} filterOptions={iFilterOpts} data={currentHist}
            yLabel="Current (A)" yUnit="A" refVal={null}
            yMin={Y_LIMITS.current.min} yMax={Y_LIMITS.current.max} isDark={isDark} />

          {/* ── Power: 0–5000W ── */}
          <ChartPanel id="chartPower" title="Three Phase Powers"
            titleClass="bg-gradient-to-r from-pink-500 to-orange-500"
            keys={pKeys} filterOptions={pFilterOpts} data={powerHist}
            yLabel="Power (W)" yUnit="W" refVal={null}
            yMin={Y_LIMITS.power.min} yMax={Y_LIMITS.power.max} isDark={isDark} />

          {/* ── DER V & I: 48–54 ── */}
          <ChartPanel id="chartStreet" title="DER (Rooftop) Voltage & Current"
            titleClass="bg-gradient-to-r from-emerald-500 to-teal-500"
            keys={stVIKeys} filterOptions={null} data={streetHist}
            yLabel="V / A" yUnit="" refVal={null}
            yMin={Y_LIMITS.streetVI.min} yMax={Y_LIMITS.streetVI.max} isDark={isDark} />

          {/* ── DER Power / PF / Freq: 0–1 ── */}
          <ChartPanel id="chartStreetPF" title="DER (Rooftop) Power · PF · Frequency"
            titleClass="bg-gradient-to-r from-teal-500 to-cyan-500"
            keys={stPFKeys} filterOptions={null} data={streetHist}
            yLabel="PF" yUnit="" refVal={null}
            yMin={Y_LIMITS.streetPPF.min} yMax={Y_LIMITS.streetPPF.max} isDark={isDark} />

        </section>
        <aside className="lg:col-span-1 flex flex-col"><EventLog events={events} /></aside>
      </main>
    </div>
  );
}