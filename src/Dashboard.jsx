// Dashboard.jsx
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
const MAX_RENDER_PTS = 1200;
const MAX_EVENTS = 15;

/* ========== Y-AXIS LIMITS ========== */
const Y_LIMITS = {
  voltage: { min: 210, max: 260 },
  current: { min: 0, max: 10 },
  power: { min: 0, max: 3000 },
  reactive: { min: 0, max: 2500 },
  pf3phase: { min: 0, max: 1 },
  derV: { min: 210, max: 260 },
  derI: { min: 0, max: 10 },
  derP: { min: 0, max: 3000 },
  derPF: { min: 0, max: 1 },
  derFreq: { min: 49, max: 51 },
  derPFreq: { min: 0, max: 3000 },
  derQPF: { min: 0, max: 2500 },
};

/* =====================================================================
   LTTB downsampling
===================================================================== */
function lttbDownsample(data, threshold) {
  const len = data.length;
  if (len <= threshold || threshold <= 2) return data;
  const sampled = [];
  let a = 0;
  sampled.push(data[a]);
  const bucketSize = (len - 2) / (threshold - 2);
  for (let i = 0; i < threshold - 2; i++) {
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, len);
    let avgX = 0;
    const avgRangeLen = avgRangeEnd - avgRangeStart;
    for (let j = avgRangeStart; j < avgRangeEnd; j++) avgX += data[j].t;
    avgX /= avgRangeLen;
    const rangeStart = Math.floor(i * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, len);
    const pointAX = data[a].t;
    const pointAY = 0;
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
  sampled.push(data[len - 1]);
  return sampled;
}

/* ========== HELPERS ========== */
const smallNumber = (v, dec = 2) => {
  if (v === null || v === undefined) return (0).toFixed(dec);
  return Number(v).toFixed(dec);
};

/* =====================================================================
   X-AXIS TICK LOGIC
===================================================================== */
const THIRTY_MIN_MS = 30 * 60 * 1000;

function buildDynamicTicks(data) {
  if (!data.length) return new Set();
  const start = data[0].t;
  const end = data[data.length - 1].t;
  const elapsed = end - start;
  const tickSet = new Set();
  let lastSlot = null;
  data.forEach(({ t }) => {
    if (elapsed < THIRTY_MIN_MS) {
      const fiveMinSlot = Math.floor(t / (5 * 60 * 1000));
      if (fiveMinSlot !== lastSlot) { tickSet.add(t); lastSlot = fiveMinSlot; }
    } else {
      const slot = Math.floor(t / THIRTY_MIN_MS);
      if (slot !== lastSlot) { tickSet.add(t); lastSlot = slot; }
    }
  });
  return tickSet;
}

function formatTickTime(t) {
  return new Date(t).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: true
  });
}

function filterDataByTime(data, startHHMM, endHHMM) {
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return data.filter(d => {
    const dt = new Date(d.t);
    const mins = dt.getHours() * 60 + dt.getMinutes();
    return mins >= start && mins <= end;
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
    "React. Power R": "🔄", "React. Power Y": "🔄", "React. Power B": "🔄",
    "Power Factor R": "🎯", "Power Factor Y": "🎯", "Power Factor B": "🎯",
    "Street Voltage": "🏙️", "Street Current": "🔋",
    "Street Power": "⚙️", "Street PF": "🎛️", "Street Freq": "📡",
    "DER React. Power": "🔁",
  };
  const gradients = {
    blue: "from-blue-600 via-indigo-600 to-purple-600",
    green: "from-emerald-500 via-teal-500 to-cyan-500",
    orange: "from-orange-500 via-amber-500 to-yellow-500",
    pink: "from-pink-500 via-rose-500 to-red-500",
    violet: "from-violet-500 via-purple-500 to-fuchsia-500",
    cyan: "from-cyan-500 via-sky-500 to-blue-500",
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
   TOP-RIGHT LEGEND
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
          <span style={{ display: "inline-block", width: 16, height: 2.5, background: k.color, borderRadius: 2, flexShrink: 0 }} />
          <span style={{ color: text, fontWeight: 600, whiteSpace: "nowrap" }}>{k.name}</span>
        </div>
      ))}
    </div>
  );
};

/* =====================================================================
   GENERIC SINGLE-AXIS CHART
===================================================================== */
const Charts = React.memo(function Charts({
  keys, data, yLabel, yUnit, refVal, filter = "all", yMin = 0, yMax = 300, isDark
}) {
  const [zoomDomain, setZoomDomain] = useState(null);
  const zoomRef = useRef(null);

  const clampDomain = useCallback((lo, hi) => {
    const range = hi - lo;
    const fullRange = yMax - yMin;
    if (range >= fullRange) return null;
    let clo = lo, chi = hi;
    if (clo < yMin) { clo = yMin; chi = yMin + range; }
    if (chi > yMax) { chi = yMax; clo = yMax - range; }
    clo = Math.max(yMin, +clo.toFixed(4));
    chi = Math.min(yMax, +chi.toFixed(4));
    return [clo, chi];
  }, [yMin, yMax]);

  useEffect(() => { zoomRef.current = zoomDomain; }, [zoomDomain]);
  useEffect(() => { setZoomDomain(null); zoomRef.current = null; }, [yMin, yMax]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const current = zoomRef.current ?? [yMin, yMax];
    const [lo, hi] = current;
    const range = hi - lo;
    const center = (lo + hi) / 2;
    const factor = e.deltaY < 0 ? 0.85 : 1.18;
    const newRange = range * factor;
    const minRange = (yMax - yMin) * 0.02;
    if (newRange < minRange) return;
    const clamped = clampDomain(center - newRange / 2, center + newRange / 2);
    setZoomDomain(clamped);
  }, [yMin, yMax, clampDomain]);

  const dragRef = useRef({ active: false, startY: 0, startDomain: null });
  const handleMouseDown = useCallback((e) => {
    if (!e.shiftKey) return;
    e.preventDefault();
    dragRef.current = { active: true, startY: e.clientY, startDomain: zoomRef.current ?? [yMin, yMax] };
  }, [yMin, yMax]);
  const handleMouseMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const [lo, hi] = drag.startDomain;
    const range = hi - lo;
    const valueDelta = ((drag.startY - e.clientY) / 250) * range;
    const clamped = clampDomain(lo + valueDelta, hi + valueDelta);
    if (clamped) setZoomDomain(clamped);
  }, [clampDomain]);
  const handleMouseUp = useCallback(() => { dragRef.current.active = false; }, []);

  const { chartData, tickTimestamps } = useMemo(() => {
    const cd = data.map(d => {
      const point = {
        _ts: d.t,
        time: new Date(d.t).toLocaleTimeString("en-IN", {
          hour: "2-digit", minute: "2-digit", second: "2-digit"
        }),
      };
      keys.forEach(k => {
        const raw = d[k.dataKey];
        point[k.dataKey] = (raw !== null && raw !== undefined && !isNaN(raw) && raw >= yMin && raw <= yMax)
          ? raw : null;
      });
      return point;
    });
    const tts = buildDynamicTicks(data);
    return { chartData: cd, tickTimestamps: tts };
  }, [data, keys, yMin, yMax]);

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

    // ❌ skip first 1–2 labels to avoid overlap
    if (index < 2) return "";

    if (tickTimestamps.has(point._ts)) {
      return formatTickTime(point._ts);
    }
    return "";
  }, [chartData, tickTimestamps]);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: hintColor }}>🖱 Scroll to zoom Y · Shift+drag to pan</span>
        {isZoomed && (
          <>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#6366f1", background: "rgba(99,102,241,0.12)", borderRadius: 6, padding: "2px 8px" }}>
              Y: {zoomDomain[0].toFixed(2)}{yUnit} – {zoomDomain[1].toFixed(2)}{yUnit}
            </span>
            <button onClick={() => setZoomDomain(null)} style={{ fontSize: 10, cursor: "pointer", background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>Reset Zoom</button>
          </>
        )}
      </div>
      <div onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
        style={{ cursor: isZoomed ? "zoom-in" : "crosshair", userSelect: "none" }}>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData} margin={{ top: 6, right: 18, bottom: 4, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} opacity={0.22} />
            <XAxis dataKey="time" stroke={axisColor} tick={{ fontSize: 10, fill: tickColor }}
              tickFormatter={xTickFormatter} minTickGap={1} interval={0} tickLine={false} />
            <YAxis stroke={axisColor} domain={yDomain} allowDataOverflow={false}
              tickFormatter={yTickFmt} tick={{ fontSize: 10, fill: tickColor }}
              tickCount={6} tickLine={false} width={68}
              label={{ value: yLabel, angle: -90, position: "insideLeft", fill: axisColor, fontSize: 10, dy: 50 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ display: "none" }} />
            {refVal !== null && refVal !== undefined && (
              <ReferenceLine y={refVal} stroke="#22c55e" strokeDasharray="6 3" strokeWidth={1.5}
                label={{ value: `${refVal}${yUnit} nominal`, position: "insideTopRight", fontSize: 9, fill: "#22c55e" }} />
            )}
            {keys.map(k => (
              <Line key={k.dataKey} type="monotone" dataKey={k.dataKey}
                stroke={k.color} strokeWidth={2.5} dot={false} name={k.name}
                strokeOpacity={opacityFor(k.dataKey)} connectNulls={false} isAnimationActive={false} />
            ))}
            <Brush dataKey="time" height={20} stroke="#6366f1" fill="rgba(99,102,241,0.08)" travellerWidth={8} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ textAlign: "right", paddingRight: 18, marginTop: 2, fontSize: 10, color: axisColor, userSelect: "none", pointerEvents: "none" }}>Time →</div>
    </div>
  );
});

/* =====================================================================
   DUAL-AXIS CHART  ← TOP-LEVEL component (fix: was wrongly nested inside Charts)
===================================================================== */
const DualAxisChart = React.memo(function DualAxisChart({
  leftKeys, rightKeys, data,
  leftLabel, rightLabel,
  leftMin, leftMax, leftUnit,
  rightMin, rightMax, rightUnit,
  isDark
}) {
  const { chartData, tickTimestamps } = useMemo(() => {
    const cd = data.map(d => {
      const point = {
        _ts: d.t,
        time: new Date(d.t).toLocaleTimeString("en-IN", {
          hour: "2-digit", minute: "2-digit", second: "2-digit"
        }),
      };
      leftKeys.forEach(k => {
        const raw = d[k.dataKey];
        point[k.dataKey] = (raw !== null && raw !== undefined && !isNaN(raw) && raw >= leftMin && raw <= leftMax) ? raw : null;
      });
      rightKeys.forEach(k => {
        const raw = d[k.dataKey];
        point[k.dataKey] = (raw !== null && raw !== undefined && !isNaN(raw) && raw >= rightMin && raw <= rightMax) ? raw : null;
      });
      return point;
    });
    const tts = buildDynamicTicks(data);
    return { chartData: cd, tickTimestamps: tts };
  }, [data, leftKeys, rightKeys, leftMin, leftMax, rightMin, rightMax]);

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
      <div style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: hintColor }}>🖱 Scroll to zoom Y · Shift+drag to pan</span>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 6, right: 68, bottom: 4, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} opacity={0.22} />
          <XAxis
            dataKey="time"
            stroke={axisColor}
            tick={{ fontSize: 10, fill: tickColor }}
            tickFormatter={xTickFormatter}
            minTickGap={40}
            interval="preserveStartEnd"
            tickLine={false}
          />

          {/* LEFT Y-AXIS */}
          <YAxis yAxisId="left" orientation="left" stroke={axisColor}
            domain={[leftMin, leftMax]}
            tickFormatter={v => `${Number(v).toFixed(2)}${leftUnit}`}
            tick={{ fontSize: 10, fill: tickColor }} tickCount={6} tickLine={false} width={68}
            label={{ value: leftLabel, angle: -90, position: "insideLeft", fill: axisColor, fontSize: 10, dy: 50 }} />

          {/* RIGHT Y-AXIS */}
          <YAxis yAxisId="right" orientation="right" stroke={axisColor}
            domain={[rightMin, rightMax]}
            tickFormatter={v => `${Number(v).toFixed(3)}${rightUnit}`}
            tick={{ fontSize: 10, fill: tickColor }} tickCount={6} tickLine={false} width={68}
            label={{ value: rightLabel, angle: 90, position: "insideRight", fill: axisColor, fontSize: 10, dy: -40 }} />

          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ display: "none" }} />

          {leftKeys.map(k => (
            <Line key={k.dataKey} yAxisId="left" type="monotone" dataKey={k.dataKey}
              stroke={k.color} strokeWidth={2.5} dot={false} name={k.name}
              connectNulls={false} isAnimationActive={false} />
          ))}
          {rightKeys.map(k => (
            <Line key={k.dataKey} yAxisId="right" type="monotone" dataKey={k.dataKey}
              stroke={k.color} strokeWidth={2.5} dot={false} name={k.name}
              connectNulls={false} isAnimationActive={false} />
          ))}
          <Brush dataKey="time" height={20} stroke="#6366f1" fill="rgba(99,102,241,0.08)" travellerWidth={8} />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ textAlign: "right", paddingRight: 18, marginTop: 2, fontSize: 10, color: axisColor, userSelect: "none", pointerEvents: "none" }}>Time →</div>
    </div>
  );
});

/* =====================================================================
   CHART PANEL (single axis)
===================================================================== */
function ChartPanel({ id, title, titleClass, keys, filterOptions, data, yLabel, yUnit, refVal, yMin = 0, yMax, isDark }) {
  const [filter, setFilter] = useState("all");
  const selectCls = isDark
    ? "px-2 py-1 text-xs rounded-lg bg-slate-800 text-gray-100 border border-slate-600 shadow-sm"
    : "px-2 py-1 text-xs rounded-lg bg-white text-gray-800 border border-slate-300 shadow-sm";
  return (
    <div id={id} className={`rounded-2xl p-4 border border-white/20 shadow-xl backdrop-blur-xl ${isDark ? "bg-white/10" : "bg-white/70"}`}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
        <h3 className={`text-lg font-bold bg-clip-text text-transparent ${titleClass}`} style={{ flexShrink: 0 }}>{title}</h3>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexShrink: 0 }}>
          {filterOptions && (
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className={selectCls}>
              {filterOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          <TopRightLegend keys={keys} isDark={isDark} />
        </div>
      </div>
      <Charts keys={keys} data={data} yLabel={yLabel} yUnit={yUnit}
        refVal={refVal} filter={filter} yMin={yMin} yMax={yMax} isDark={isDark} />
    </div>
  );
}

/* =====================================================================
   DUAL-AXIS CHART PANEL
===================================================================== */
function DualAxisChartPanel({ id, title, titleClass, leftKeys, rightKeys, data,
  leftLabel, rightLabel, leftMin, leftMax, leftUnit, rightMin, rightMax, rightUnit, isDark }) {
  const allKeys = [...leftKeys, ...rightKeys];
  return (
    <div id={id} className={`rounded-2xl p-4 border border-white/20 shadow-xl backdrop-blur-xl ${isDark ? "bg-white/10" : "bg-white/70"}`}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
        <h3 className={`text-lg font-bold bg-clip-text text-transparent ${titleClass}`} style={{ flexShrink: 0 }}>{title}</h3>
        <TopRightLegend keys={allKeys} isDark={isDark} />
      </div>
      <DualAxisChart
        leftKeys={leftKeys} rightKeys={rightKeys} data={data}
        leftLabel={leftLabel} rightLabel={rightLabel}
        leftMin={leftMin} leftMax={leftMax} leftUnit={leftUnit}
        rightMin={rightMin} rightMax={rightMax} rightUnit={rightUnit}
        isDark={isDark} />
    </div>
  );
}

/* =====================================================================
   TIME-RANGE EXPORT MODAL
===================================================================== */
function TimeRangeExportModal({ isOpen, onClose, onExport, isDark, rawRef }) {
  const sessionRange = useMemo(() => {
    const arr = rawRef?.current ?? [];
    if (!arr.length) return null;
    const first = arr[0].t;
    const last = arr[arr.length - 1].t;
    const fmt = (ms) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
    const fmtFull = (ms) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    return { startHHMM: fmt(first), endHHMM: fmt(last), startLabel: fmtFull(first), endLabel: fmtFull(last), totalPts: arr.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, rawRef]);

  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [chartType, setChartType] = useState("voltage");
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    if (isOpen && sessionRange) { setStartTime(sessionRange.startHHMM); setEndTime(sessionRange.endHHMM); setExportError(""); }
    else if (isOpen && !sessionRange) { setStartTime(""); setEndTime(""); setExportError("No data recorded yet."); }
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
    { value: "reactive", label: "Three Phase Reactive Powers" },
    { value: "pf3phase", label: "Three Phase Power Factors" },
    { value: "derV", label: "DER Voltage" },
    { value: "derI", label: "DER Current" },
    { value: "derPFreq", label: "DER Power + Frequency" },
    { value: "derQPF", label: "DER React. Power + Power Factor" },
  ];

  const handleExport = () => {
    if (!sessionRange) { setExportError("No data recorded yet."); return; }
    if (!startTime || !endTime) { setExportError("Please select both times."); return; }
    if (startTime >= endTime) { setExportError("End time must be after start time."); return; }
    setExportError("");
    const err = onExport(chartType, startTime, endTime);
    if (err) setExportError(err);
    else onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: overlayBg, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: modalBg, border, borderRadius: 16, padding: 28, width: 380, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, background: "linear-gradient(to right,#3b82f6,#8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          📥 Export Time Range
        </h3>
        {sessionRange ? (
          <div style={{ marginBottom: 16, padding: "8px 10px", borderRadius: 8, background: isDark ? "rgba(16,185,129,0.10)" : "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", fontSize: 11, color: "#10b981" }}>
            ✅ Session: <strong>{sessionRange.startLabel}</strong> → <strong>{sessionRange.endLabel}</strong>
            <span style={{ color: hintClr, marginLeft: 6 }}>({sessionRange.totalPts} pts)</span>
          </div>
        ) : (
          <div style={{ marginBottom: 16, padding: "8px 10px", borderRadius: 8, background: isDark ? "rgba(239,68,68,0.10)" : "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", fontSize: 11, color: "#f87171" }}>
            ⚠️ No data recorded yet.
          </div>
        )}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: labelClr, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>Chart</label>
          <select value={chartType} onChange={e => setChartType(e.target.value)} style={inputCls}>
            {charts.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: labelClr, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>Start Time (HH:MM — 24hr)</label>
          <input type="time" value={startTime} onChange={e => { setStartTime(e.target.value); setExportError(""); }} style={inputCls} />
          {sessionRange && <p style={{ margin: "3px 0 0", fontSize: 10, color: hintClr }}>Session starts: {sessionRange.startLabel}</p>}
        </div>
        <div style={{ marginBottom: exportError ? 10 : 22 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: labelClr, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>End Time (HH:MM — 24hr)</label>
          <input type="time" value={endTime} onChange={e => { setEndTime(e.target.value); setExportError(""); }} style={inputCls} />
          {sessionRange && <p style={{ margin: "3px 0 0", fontSize: 10, color: hintClr }}>Session ends: {sessionRange.endLabel}</p>}
        </div>
        {exportError && (
          <div style={{ marginBottom: 14, padding: "7px 10px", borderRadius: 8, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", fontSize: 11, color: "#f87171", fontWeight: 500 }}>
            ⚠️ {exportError}
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "9px 0", borderRadius: 10, fontSize: 13, fontWeight: 600, background: "transparent", border: isDark ? "1px solid #334155" : "1px solid #cbd5e1", color: isDark ? "#94a3b8" : "#64748b", cursor: "pointer" }}>Cancel</button>
          <button onClick={handleExport} style={{ flex: 1, padding: "9px 0", borderRadius: 10, fontSize: 13, fontWeight: 600, background: sessionRange ? "linear-gradient(to right,#3b82f6,#8b5cf6)" : "#334155", border: "none", color: "#fff", cursor: sessionRange ? "pointer" : "not-allowed", boxShadow: "0 4px 14px rgba(99,102,241,0.4)" }}>Export PNG</button>
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
   PNG EXPORT
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
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);

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
  ctx.moveTo(bx + R, by); ctx.lineTo(bx + boxW - R, by); ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + R);
  ctx.lineTo(bx + boxW, by + boxH - R); ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - R, by + boxH);
  ctx.lineTo(bx + R, by + boxH); ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - R);
  ctx.lineTo(bx, by + R); ctx.quadraticCurveTo(bx, by, bx + R, by);
  ctx.closePath(); ctx.fill();
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.stroke();
  keys.forEach((k, idx) => {
    const rowY = by + LEGEND_PAD_Y + idx * LEGEND_ROW_H;
    const lineY = rowY + 7;
    ctx.strokeStyle = k.color; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(bx + LEGEND_PAD_X, lineY); ctx.lineTo(bx + LEGEND_PAD_X + SWATCH_W, lineY); ctx.stroke();
    ctx.font = `600 ${LEGEND_FONT}px system-ui, sans-serif`; ctx.fillStyle = "#1e293b"; ctx.textAlign = "left";
    ctx.fillText(k.name, bx + LEGEND_PAD_X + SWATCH_W + SWATCH_GAP, lineY + 3);
  });
  ctx.setLineDash([]); ctx.lineCap = "butt";
  ctx.font = "bold 15px system-ui, sans-serif"; ctx.fillStyle = accentColor; ctx.textAlign = "left";
  ctx.fillText(title, margin.left, 32);
  ctx.save(); ctx.translate(16, margin.top + plotH / 2); ctx.rotate(-Math.PI / 2);
  ctx.font = "11px system-ui, sans-serif"; ctx.fillStyle = "#64748b"; ctx.textAlign = "center";
  ctx.fillText(yLabel, 0, 0); ctx.restore();
  ctx.font = "11px system-ui, sans-serif"; ctx.fillStyle = "#64748b"; ctx.textAlign = "right";
  ctx.fillText("Time →", margin.left + plotW, H - 10);
  const [yMin, yMax2] = Array.isArray(yDomain) ? yDomain : [0, 100];
  const yRange = (yMax2 - yMin) || 1;
  const toY = v => margin.top + plotH - ((v - yMin) / yRange) * plotH;
  for (let i = 0; i <= 5; i++) {
    const val = yMin + (yRange * i) / 5;
    const y = toY(val);
    ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(margin.left + plotW, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "10px system-ui, sans-serif"; ctx.fillStyle = "#94a3b8"; ctx.textAlign = "right";
    ctx.fillText(`${val.toFixed(2)}${yUnit}`, margin.left - 6, y + 4);
  }
  if (chartData.length > 1) {
    const step = Math.max(1, Math.floor(chartData.length / 10));
    ctx.font = "10px system-ui, sans-serif"; ctx.fillStyle = "#94a3b8"; ctx.textAlign = "center";
    for (let i = 0; i < chartData.length; i += step) {
      const x = margin.left + (i / (chartData.length - 1)) * plotW;
      ctx.fillText(new Date(chartData[i]._ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }), x, margin.top + plotH + 18);
    }
  }
  ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 1.5; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(margin.left, margin.top); ctx.lineTo(margin.left, margin.top + plotH); ctx.lineTo(margin.left + plotW, margin.top + plotH); ctx.stroke();
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

function exportChartPNGByRange(hist, keys, yDomain, yUnit, yLabel, title, filename, accentColor, startTime, endTime) {
  if (!hist || hist.length === 0) return "No data recorded yet.";
  if (!startTime || !endTime) return "Please select both times.";
  const sliced = filterDataByTime(hist, startTime, endTime);
  if (sliced.length < 2) {
    const fmtAvail = (ms) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    return `No data between ${startTime} and ${endTime}. Available: ${fmtAvail(hist[0].t)} → ${fmtAvail(hist[hist.length - 1].t)}.`;
  }
  const chartData = sliced.map(d => {
    const point = { _ts: d.t, time: new Date(d.t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) };
    keys.forEach(k => { point[k.dataKey] = d[k.dataKey] ?? null; });
    return point;
  });
  exportChartPNG(chartData, keys, yDomain, yUnit, yLabel, title, filename, accentColor);
  return null;
}

const exportCSV = (csvText) => {
  if (!csvText || csvText.length < 5) { alert("CSV not ready yet!"); return; }
  saveAs(new Blob([csvText], { type: "text/csv;charset=utf-8" }), `smartgrid_data_${Date.now()}.csv`);
};


/* =====================================================================
   DUAL-AXIS PNG EXPORT
===================================================================== */
const exportDualAxisChartPNG = (chartData, leftKeys, rightKeys, leftDomain, rightDomain, leftUnit, rightUnit, leftLabel, rightLabel, title, filename, accentColor) => {
  const W = 1000, H = 460;
  const margin = { top: 56, right: 84, bottom: 60, left: 84 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;
  const canvas = document.createElement("canvas");
  canvas.width = W * 2; canvas.height = H * 2;
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);

  const allKeys = [...leftKeys, ...rightKeys];

  // ── Legend box (top-right) ──
  const LEGEND_ROW_H = 18, LEGEND_PAD_X = 10, LEGEND_PAD_Y = 7;
  const SWATCH_W = 20, SWATCH_GAP = 6, LEGEND_FONT = 10, LEGEND_MARGIN = 12;
  ctx.font = `600 ${LEGEND_FONT}px system-ui, sans-serif`;
  const maxTextW = Math.max(...allKeys.map(k => ctx.measureText(k.name).width));
  const boxW = LEGEND_PAD_X * 2 + SWATCH_W + SWATCH_GAP + maxTextW + 2;
  const boxH = LEGEND_PAD_Y * 2 + allKeys.length * LEGEND_ROW_H - (LEGEND_ROW_H - 14);
  const bx = W - LEGEND_MARGIN - boxW - 10, by = LEGEND_MARGIN;
  ctx.shadowColor = "rgba(0,0,0,0.10)"; ctx.shadowBlur = 6;
  ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 1;
  const R = 5;
  ctx.beginPath();
  ctx.moveTo(bx + R, by); ctx.lineTo(bx + boxW - R, by); ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + R);
  ctx.lineTo(bx + boxW, by + boxH - R); ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - R, by + boxH);
  ctx.lineTo(bx + R, by + boxH); ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - R);
  ctx.lineTo(bx, by + R); ctx.quadraticCurveTo(bx, by, bx + R, by);
  ctx.closePath(); ctx.fill();
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.stroke();
  allKeys.forEach((k, idx) => {
    const rowY = by + LEGEND_PAD_Y + idx * LEGEND_ROW_H;
    const lineY = rowY + 7;
    ctx.strokeStyle = k.color; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(bx + LEGEND_PAD_X, lineY); ctx.lineTo(bx + LEGEND_PAD_X + SWATCH_W, lineY); ctx.stroke();
    ctx.font = `600 ${LEGEND_FONT}px system-ui, sans-serif`; ctx.fillStyle = "#1e293b"; ctx.textAlign = "left";
    ctx.fillText(k.name, bx + LEGEND_PAD_X + SWATCH_W + SWATCH_GAP, lineY + 3);
  });

  ctx.setLineDash([]); ctx.lineCap = "butt";

  // ── Title ──
  ctx.font = "bold 15px system-ui, sans-serif"; ctx.fillStyle = accentColor; ctx.textAlign = "left";
  ctx.fillText(title, margin.left, 32);

  // ── Left Y-axis label ──
  ctx.save(); ctx.translate(16, margin.top + plotH / 2); ctx.rotate(-Math.PI / 2);
  ctx.font = "11px system-ui, sans-serif"; ctx.fillStyle = "#64748b"; ctx.textAlign = "center";
  ctx.fillText(leftLabel, 0, 0); ctx.restore();

  // ── Right Y-axis label ──
  ctx.save(); ctx.translate(W - 16, margin.top + plotH / 2); ctx.rotate(Math.PI / 2);
  ctx.font = "11px system-ui, sans-serif"; ctx.fillStyle = "#64748b"; ctx.textAlign = "center";
  ctx.fillText(rightLabel, 0, 0); ctx.restore();

  // ── X-axis label ──
  ctx.font = "11px system-ui, sans-serif"; ctx.fillStyle = "#64748b"; ctx.textAlign = "right";
  ctx.fillText("Time →", margin.left + plotW, H - 10);

  // ── Grid + Left Y ticks ──
  const [lyMin, lyMax] = leftDomain;
  const lyRange = (lyMax - lyMin) || 1;
  const toYLeft = v => margin.top + plotH - ((v - lyMin) / lyRange) * plotH;

  for (let i = 0; i <= 5; i++) {
    const val = lyMin + (lyRange * i) / 5;
    const y = toYLeft(val);
    ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(margin.left + plotW, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "10px system-ui, sans-serif"; ctx.fillStyle = "#94a3b8"; ctx.textAlign = "right";
    ctx.fillText(`${val.toFixed(2)}${leftUnit}`, margin.left - 6, y + 4);
  }

  // ── Right Y ticks ──
  const [ryMin, ryMax] = rightDomain;
  const ryRange = (ryMax - ryMin) || 1;
  const toYRight = v => margin.top + plotH - ((v - ryMin) / ryRange) * plotH;

  for (let i = 0; i <= 5; i++) {
    const val = ryMin + (ryRange * i) / 5;
    const y = toYRight(val);
    ctx.font = "10px system-ui, sans-serif"; ctx.fillStyle = "#94a3b8"; ctx.textAlign = "left";
    ctx.fillText(`${val.toFixed(3)}${rightUnit}`, margin.left + plotW + 6, y + 4);
  }

  // ── X ticks ──
  if (chartData.length > 1) {
    const step = Math.max(1, Math.floor(chartData.length / 10));
    ctx.font = "10px system-ui, sans-serif"; ctx.fillStyle = "#94a3b8"; ctx.textAlign = "center";
    for (let i = 0; i < chartData.length; i += step) {
      const x = margin.left + (i / (chartData.length - 1)) * plotW;
      ctx.fillText(new Date(chartData[i]._ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }), x, margin.top + plotH + 18);
    }
  }

  // ── Axes border ──
  ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 1.5; ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top); ctx.lineTo(margin.left, margin.top + plotH);
  ctx.lineTo(margin.left + plotW, margin.top + plotH);
  ctx.lineTo(margin.left + plotW, margin.top);
  ctx.stroke();

  // ── Draw LEFT key lines ──
  if (chartData.length > 1) {
    leftKeys.forEach(k => {
      ctx.strokeStyle = k.color; ctx.lineWidth = 2.2; ctx.setLineDash([]);
      ctx.beginPath();
      let started = false;
      chartData.forEach((d, i) => {
        const v = d[k.dataKey];
        if (v === null || v === undefined || isNaN(v)) { started = false; return; }
        const x = margin.left + (i / (chartData.length - 1)) * plotW;
        const y = toYLeft(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    // ── Draw RIGHT key lines ──
    rightKeys.forEach(k => {
      ctx.strokeStyle = k.color; ctx.lineWidth = 2.2; ctx.setLineDash([]);
      ctx.beginPath();
      let started = false;
      chartData.forEach((d, i) => {
        const v = d[k.dataKey];
        if (v === null || v === undefined || isNaN(v)) { started = false; return; }
        const x = margin.left + (i / (chartData.length - 1)) * plotW;
        const y = toYRight(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  }

  ctx.setLineDash([]); ctx.lineCap = "butt";
  canvas.toBlob(blob => saveAs(blob, `${filename}_${Date.now()}.png`));
};

function exportDualAxisChartPNGByRange(hist, leftKeys, rightKeys, leftDomain, rightDomain, leftUnit, rightUnit, leftLabel, rightLabel, title, filename, accentColor, startTime, endTime) {
  if (!hist || hist.length === 0) return "No data recorded yet.";
  if (!startTime || !endTime) return "Please select both times.";
  const sliced = filterDataByTime(hist, startTime, endTime);
  if (sliced.length < 2) {
    const fmtAvail = (ms) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    return `No data between ${startTime} and ${endTime}. Available: ${fmtAvail(hist[0].t)} → ${fmtAvail(hist[hist.length - 1].t)}.`;
  }
  const allKeys = [...leftKeys, ...rightKeys];
  const chartData = sliced.map(d => {
    const point = { _ts: d.t, time: new Date(d.t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) };
    allKeys.forEach(k => { point[k.dataKey] = d[k.dataKey] ?? null; });
    return point;
  });
  exportDualAxisChartPNG(chartData, leftKeys, rightKeys, leftDomain, rightDomain, leftUnit, rightUnit, leftLabel, rightLabel, title, filename, accentColor);
  return null;
}


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
    Va: 0, Vb: 0, Vc: 0,
    Ia: 0, Ib: 0, Ic: 0,
    Pa: 0, Pb: 0, Pc: 0,
    Qa: 0, Qb: 0, Qc: 0,
    PFa: 0, PFb: 0, PFc: 0,
    St_V: 0, St_I: 0, St_P: 0, St_Q: 0, St_PF: 0, St_F: 0,
    Timestamp: ""
  };
  const [data, setData] = useState(emptyData);

  const voltageRaw = useRef([]);
  const currentRaw = useRef([]);
  const powerRaw = useRef([]);
  const reactiveRaw = useRef([]);
  const pf3Raw = useRef([]);
  const streetRaw = useRef([]);

  const [voltageHist, setVoltageHist] = useState([]);
  const [currentHist, setCurrentHist] = useState([]);
  const [powerHist, setPowerHist] = useState([]);
  const [reactiveHist, setReactiveHist] = useState([]);
  const [pf3Hist, setPf3Hist] = useState([]);
  const [streetHist, setStreetHist] = useState([]);

  const prevRawRef = useRef(null);
  const prevDataRef = useRef(emptyData);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    localStorage.setItem("theme", theme);
  }, [theme, isDark]);

  const gate = (v, lo, hi) => { const n = Number(v); return (!isNaN(n) && n >= lo && n <= hi) ? n : null; };

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
        Qa: gate(row["Q_R"], Y_LIMITS.reactive.min, Y_LIMITS.reactive.max),
        Qb: gate(row["Q_Y"], Y_LIMITS.reactive.min, Y_LIMITS.reactive.max),
        Qc: gate(row["Q_B"], Y_LIMITS.reactive.min, Y_LIMITS.reactive.max),
        PFa: gate(row["PF_R"], Y_LIMITS.pf3phase.min, Y_LIMITS.pf3phase.max),
        PFb: gate(row["PF_Y"], Y_LIMITS.pf3phase.min, Y_LIMITS.pf3phase.max),
        PFc: gate(row["PF_B"], Y_LIMITS.pf3phase.min, Y_LIMITS.pf3phase.max),
        St_V: gate(row["Street_V"], Y_LIMITS.derV.min, Y_LIMITS.derV.max),
        St_I: gate(row["Street_I"], Y_LIMITS.derI.min, Y_LIMITS.derI.max),
        St_P: gate(row["Street_P"], Y_LIMITS.derP.min, Y_LIMITS.derP.max),
        St_Q: gate(row["Q_S"], Y_LIMITS.reactive.min, Y_LIMITS.reactive.max),
        St_PF: gate(row["Street_PF"], Y_LIMITS.derPF.min, Y_LIMITS.derPF.max),
        St_F: gate(row["Street_F"], Y_LIMITS.derFreq.min, Y_LIMITS.derFreq.max),
        Timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19)
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

      voltageRaw.current.push({ t: now, Va: newData.Va, Vb: newData.Vb, Vc: newData.Vc });
      currentRaw.current.push({ t: now, Ia: newData.Ia, Ib: newData.Ib, Ic: newData.Ic });
      powerRaw.current.push({ t: now, Pa: newData.Pa, Pb: newData.Pb, Pc: newData.Pc });
      reactiveRaw.current.push({ t: now, Qa: newData.Qa, Qb: newData.Qb, Qc: newData.Qc });
      pf3Raw.current.push({ t: now, PFa: newData.PFa, PFb: newData.PFb, PFc: newData.PFc });
      streetRaw.current.push({ t: now, St_V: newData.St_V, St_I: newData.St_I, St_P: newData.St_P, St_Q: newData.St_Q, St_PF: newData.St_PF, St_F: newData.St_F });

      setVoltageHist(lttbDownsample(voltageRaw.current, MAX_RENDER_PTS));
      setCurrentHist(lttbDownsample(currentRaw.current, MAX_RENDER_PTS));
      setPowerHist(lttbDownsample(powerRaw.current, MAX_RENDER_PTS));
      setReactiveHist(lttbDownsample(reactiveRaw.current, MAX_RENDER_PTS));
      setPf3Hist(lttbDownsample(pf3Raw.current, MAX_RENDER_PTS));
      setStreetHist(lttbDownsample(streetRaw.current, MAX_RENDER_PTS));

      if (text && text.length > 10) window.__SMARTGRID_CSV__ = text;
      setLoading(false);
    } catch { setStatus("Disconnected"); setLoading(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const backfilledRef = useRef(false);
  const backfillHistory = useCallback(async () => {
    if (backfilledRef.current) return;
    backfilledRef.current = true;
    try {
      const res = await fetch(CSV_URL);
      if (!res.ok) return;
      const text = await res.text();
      const parsed = Papa.parse(text, { header: true, dynamicTyping: true });
      if (!parsed.data.length) return;

      const g = (v, lo, hi) => { const n = Number(v); return (!isNaN(n) && n >= lo && n <= hi) ? n : null; };
      const todayMidnight = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
      const tomorrowMidnight = todayMidnight + 86400000;

      const parseSheetTs = (raw) => {
        if (!raw) return null;
        const s = String(raw).trim();
        const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[, ]+(\d{1,2}):(\d{2}):(\d{2})/);
        if (m1) { const [, d, mo, y, h, mi, sec] = m1.map(Number); return new Date(y, mo - 1, d, h, mi, sec).getTime(); }
        const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ]+(\d{2}):(\d{2}):(\d{2})/);
        if (m2) { const [, y, mo, d, h, mi, sec] = m2.map(Number); return new Date(y, mo - 1, d, h, mi, sec).getTime(); }
        const fb = Date.parse(s); return isNaN(fb) ? null : fb;
      };

      const validRows = parsed.data.filter(r => r["Timestamp"]);
      const vArr = [], iArr = [], pArr = [], qArr = [], pfArr = [], sArr = [];
      const seenTs = new Set();

      validRows.forEach(row => {
        const t = parseSheetTs(row["Timestamp"]);
        if (!t || t < todayMidnight || t >= tomorrowMidnight) return;
        if (seenTs.has(t)) return;
        seenTs.add(t);
        vArr.push({ t, Va: g(row["V_R"], Y_LIMITS.voltage.min, Y_LIMITS.voltage.max), Vb: g(row["V_Y"], Y_LIMITS.voltage.min, Y_LIMITS.voltage.max), Vc: g(row["V_B"], Y_LIMITS.voltage.min, Y_LIMITS.voltage.max) });
        iArr.push({ t, Ia: g(row["I_R"], Y_LIMITS.current.min, Y_LIMITS.current.max), Ib: g(row["I_Y"], Y_LIMITS.current.min, Y_LIMITS.current.max), Ic: g(row["I_B"], Y_LIMITS.current.min, Y_LIMITS.current.max) });
        pArr.push({ t, Pa: g(row["P_R"], Y_LIMITS.power.min, Y_LIMITS.power.max), Pb: g(row["P_Y"], Y_LIMITS.power.min, Y_LIMITS.power.max), Pc: g(row["P_B"], Y_LIMITS.power.min, Y_LIMITS.power.max) });
        qArr.push({ t, Qa: g(row["Q_R"], Y_LIMITS.reactive.min, Y_LIMITS.reactive.max), Qb: g(row["Q_Y"], Y_LIMITS.reactive.min, Y_LIMITS.reactive.max), Qc: g(row["Q_B"], Y_LIMITS.reactive.min, Y_LIMITS.reactive.max) });
        pfArr.push({ t, PFa: g(row["PF_R"], Y_LIMITS.pf3phase.min, Y_LIMITS.pf3phase.max), PFb: g(row["PF_Y"], Y_LIMITS.pf3phase.min, Y_LIMITS.pf3phase.max), PFc: g(row["PF_B"], Y_LIMITS.pf3phase.min, Y_LIMITS.pf3phase.max) });
        sArr.push({
          t,
          St_V: g(row["Street_V"], Y_LIMITS.derV.min, Y_LIMITS.derV.max),
          St_I: g(row["Street_I"], Y_LIMITS.derI.min, Y_LIMITS.derI.max),
          St_P: g(row["Street_P"], Y_LIMITS.derP.min, Y_LIMITS.derP.max),
          St_Q: g(row["Q_S"], Y_LIMITS.reactive.min, Y_LIMITS.reactive.max),
          St_PF: g(row["Street_PF"], Y_LIMITS.derPF.min, Y_LIMITS.derPF.max),
          St_F: g(row["Street_F"], Y_LIMITS.derFreq.min, Y_LIMITS.derFreq.max),
        });
      });

      const byT = (a, b) => a.t - b.t;
      vArr.sort(byT); iArr.sort(byT); pArr.sort(byT); qArr.sort(byT); pfArr.sort(byT); sArr.sort(byT);
      if (!vArr.length) return;

      voltageRaw.current = vArr; currentRaw.current = iArr; powerRaw.current = pArr;
      reactiveRaw.current = qArr; pf3Raw.current = pfArr; streetRaw.current = sArr;
      prevRawRef.current = JSON.stringify(validRows[validRows.length - 1]);

      setVoltageHist(lttbDownsample(vArr, MAX_RENDER_PTS));
      setCurrentHist(lttbDownsample(iArr, MAX_RENDER_PTS));
      setPowerHist(lttbDownsample(pArr, MAX_RENDER_PTS));
      setReactiveHist(lttbDownsample(qArr, MAX_RENDER_PTS));
      setPf3Hist(lttbDownsample(pfArr, MAX_RENDER_PTS));
      setStreetHist(lttbDownsample(sArr, MAX_RENDER_PTS));

      const last = vArr[vArr.length - 1], lastI = iArr[iArr.length - 1], lastP = pArr[pArr.length - 1];
      const lastQ = qArr[qArr.length - 1], lastPF = pfArr[pfArr.length - 1], lastS = sArr[sArr.length - 1];
      setData({ Va: last.Va, Vb: last.Vb, Vc: last.Vc, Ia: lastI.Ia, Ib: lastI.Ib, Ic: lastI.Ic, Pa: lastP.Pa, Pb: lastP.Pb, Pc: lastP.Pc, Qa: lastQ.Qa, Qb: lastQ.Qb, Qc: lastQ.Qc, PFa: lastPF.PFa, PFb: lastPF.PFb, PFc: lastPF.PFc, St_V: lastS.St_V, St_I: lastS.St_I, St_P: lastS.St_P, St_Q: lastS.St_Q, St_PF: lastS.St_PF, St_F: lastS.St_F, Timestamp: new Date(last.t).toISOString().replace('T', ' ').slice(0, 19) });
      setStatus("Connected");
      setEvents(p => [{ msg: `Backfilled ${vArr.length} rows from today`, time: Date.now(), level: "success" }, ...p].slice(0, MAX_EVENTS));
      setLoading(false);
    } catch (e) { console.warn("Backfill failed:", e); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    backfillHistory();
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
  const reactiveCards = [
    { label: "React. Power R", value: smallNumber(data.Qa, 1), unit: "VAR", accent: "violet" },
    { label: "React. Power Y", value: smallNumber(data.Qb, 1), unit: "VAR", accent: "violet" },
    { label: "React. Power B", value: smallNumber(data.Qc, 1), unit: "VAR", accent: "violet" },
  ];
  const pf3Cards = [
    { label: "Power Factor R", value: smallNumber(data.PFa, 3), unit: "PF", accent: "cyan" },
    { label: "Power Factor Y", value: smallNumber(data.PFb, 3), unit: "PF", accent: "cyan" },
    { label: "Power Factor B", value: smallNumber(data.PFc, 3), unit: "PF", accent: "cyan" },
  ];
  const streetCards = [
    { label: "Voltage", value: smallNumber(data.St_V, 1), unit: "V", accent: "green" },
    { label: "Current", value: smallNumber(data.St_I, 3), unit: "A", accent: "green" },
    { label: "Power", value: smallNumber(data.St_P, 1), unit: "W", accent: "green" },
    { label: "Reactive Power", value: smallNumber(data.St_Q, 1), unit: "VAR", accent: "violet" },
    { label: "Power factor", value: smallNumber(data.St_PF, 2), unit: "PF", accent: "blue" },
    { label: "Frequency", value: smallNumber(data.St_F, 2), unit: "Hz", accent: "orange" },
  ];

  /* ── Chart keys ── */
  const vKeys = [{ dataKey: "Va", name: "V_R", color: "#3b82f6" }, { dataKey: "Vb", name: "V_Y", color: "#06b6d4" }, { dataKey: "Vc", name: "V_B", color: "#f59e0b" }];
  const iKeys = [{ dataKey: "Ia", name: "I_R", color: "#3b82f6" }, { dataKey: "Ib", name: "I_Y", color: "#06b6d4" }, { dataKey: "Ic", name: "I_B", color: "#f59e0b" }];
  const pKeys = [{ dataKey: "Pa", name: "P_R", color: "#ec4899" }, { dataKey: "Pb", name: "P_Y", color: "#8b5cf6" }, { dataKey: "Pc", name: "P_B", color: "#f59e0b" }];
  const qKeys = [{ dataKey: "Qa", name: "Q_R", color: "#a855f7" }, { dataKey: "Qb", name: "Q_Y", color: "#d946ef" }, { dataKey: "Qc", name: "Q_B", color: "#f59e0b" }];
  const pf3Keys = [{ dataKey: "PFa", name: "PF_R", color: "#06b6d4" }, { dataKey: "PFb", name: "PF_Y", color: "#10b981" }, { dataKey: "PFc", name: "PF_B", color: "#f59e0b" }];
  const derVKeys = [{ dataKey: "St_V", name: "V", color: "#10b981" }];
  const derIKeys = [{ dataKey: "St_I", name: "I", color: "#06b6d4" }];
  const derPFrKeys = [{ dataKey: "St_P", name: "Power(W)", color: "#10b981" }, { dataKey: "St_F", name: "Freq(Hz)", color: "#f59e0b" }];
  const derQPFKeys = [{ dataKey: "St_Q", name: "React.Pwr", color: "#a855f7" }, { dataKey: "St_PF", name: "PF", color: "#ec4899" }];

  const vFilterOpts = [{ value: "all", label: "All Phases" }, { value: "Va", label: "Phase R" }, { value: "Vb", label: "Phase Y" }, { value: "Vc", label: "Phase B" }];
  const iFilterOpts = [{ value: "all", label: "All Phases" }, { value: "Ia", label: "Phase R" }, { value: "Ib", label: "Phase Y" }, { value: "Ic", label: "Phase B" }];
  const pFilterOpts = [{ value: "all", label: "All Phases" }, { value: "Pa", label: "Phase R" }, { value: "Pb", label: "Phase Y" }, { value: "Pc", label: "Phase B" }];
  const qFilterOpts = [{ value: "all", label: "All Phases" }, { value: "Qa", label: "Phase R" }, { value: "Qb", label: "Phase Y" }, { value: "Qc", label: "Phase B" }];
  const pf3FilterOpts = [{ value: "all", label: "All Phases" }, { value: "PFa", label: "Phase R" }, { value: "PFb", label: "Phase Y" }, { value: "PFc", label: "Phase B" }];

  const handleRangeExport = useCallback((chartType, startTime, endTime) => {
    const configs = {
      voltage: { hist: voltageRaw.current, keys: vKeys, yDomain: [Y_LIMITS.voltage.min, Y_LIMITS.voltage.max], yUnit: "V", yLabel: "Voltage (V)", title: "Three Phase Voltages", filename: "three_phase_voltage", accent: "#2563eb" },
      current: { hist: currentRaw.current, keys: iKeys, yDomain: [Y_LIMITS.current.min, Y_LIMITS.current.max], yUnit: "A", yLabel: "Current (A)", title: "Three Phase Currents", filename: "three_phase_current", accent: "#9333ea" },
      power: { hist: powerRaw.current, keys: pKeys, yDomain: [Y_LIMITS.power.min, Y_LIMITS.power.max], yUnit: "W", yLabel: "Power (W)", title: "Three Phase Powers", filename: "three_phase_power", accent: "#db2777" },
      reactive: { hist: reactiveRaw.current, keys: qKeys, yDomain: [Y_LIMITS.reactive.min, Y_LIMITS.reactive.max], yUnit: " VAR", yLabel: "Reactive Power (VAR)", title: "Three Phase Reactive Powers", filename: "three_phase_reactive", accent: "#7c3aed" },
      pf3phase: { hist: pf3Raw.current, keys: pf3Keys, yDomain: [Y_LIMITS.pf3phase.min, Y_LIMITS.pf3phase.max], yUnit: "", yLabel: "Power Factor", title: "Three Phase Power Factors", filename: "three_phase_pf", accent: "#0891b2" },
      derV: { hist: streetRaw.current, keys: derVKeys, yDomain: [Y_LIMITS.derV.min, Y_LIMITS.derV.max], yUnit: "V", yLabel: "DER Voltage (V)", title: "DER Voltage", filename: "der_voltage", accent: "#059669" },
      derI: { hist: streetRaw.current, keys: derIKeys, yDomain: [Y_LIMITS.derI.min, Y_LIMITS.derI.max], yUnit: "A", yLabel: "DER Current (A)", title: "DER Current", filename: "der_current", accent: "#0284c7" },
      derPFreq: {
        isDual: true,
        hist: streetRaw.current,
        leftKeys: [{ dataKey: "St_P", name: "Power(W)", color: "#10b981" }],
        rightKeys: [{ dataKey: "St_F", name: "Freq(Hz)", color: "#f59e0b" }],
        leftDomain: [Y_LIMITS.derP.min, Y_LIMITS.derP.max],
        rightDomain: [Y_LIMITS.derFreq.min, Y_LIMITS.derFreq.max],
        leftUnit: "W", rightUnit: "Hz",
        leftLabel: "Power (W)", rightLabel: "Freq (Hz)",
        title: "DER Power + Frequency", filename: "der_power_freq", accent: "#059669"
      },
      derQPF: {
        isDual: true,
        hist: streetRaw.current,
        leftKeys: [{ dataKey: "St_Q", name: "React.Pwr", color: "#a855f7" }],
        rightKeys: [{ dataKey: "St_PF", name: "PF", color: "#ec4899" }],
        leftDomain: [Y_LIMITS.derQPF.min, Y_LIMITS.derQPF.max],
        rightDomain: [Y_LIMITS.derPF.min, Y_LIMITS.derPF.max],
        leftUnit: " VAR", rightUnit: "",
        leftLabel: "Reactive Power (VAR)", rightLabel: "Power Factor",
        title: "DER Reactive Power + PF", filename: "der_reactive_pf", accent: "#7c3aed"
      },
    };
    const cfg = configs[chartType];
    if (!cfg) return null;

    if (cfg.isDual) {
      return exportDualAxisChartPNGByRange(
        cfg.hist, cfg.leftKeys, cfg.rightKeys,
        cfg.leftDomain, cfg.rightDomain,
        cfg.leftUnit, cfg.rightUnit,
        cfg.leftLabel, cfg.rightLabel,
        cfg.title, cfg.filename, cfg.accent,
        startTime, endTime
      );
    }
    return exportChartPNGByRange(cfg.hist, cfg.keys, cfg.yDomain, cfg.yUnit, cfg.yLabel, cfg.title, cfg.filename, cfg.accent, startTime, endTime);
  }, []);

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

      <TimeRangeExportModal isOpen={showExportModal} onClose={() => setShowExportModal(false)}
        onExport={handleRangeExport} isDark={isDark} rawRef={voltageRaw} />

      {/* ══ HEADER ══ */}
      <header className={`rounded-2xl px-6 py-4 mb-6 shadow-xl backdrop-blur-xl border border-white/20 ${isDark ? "bg-white/10" : "bg-white/70"}`}>
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${isDark ? "text-indigo-400" : "text-indigo-500"}`}>
              Real-time Energy Monitoring
            </p>
            <h1 className="font-black text-transparent bg-clip-text leading-tight truncate"
              style={{ fontSize: "clamp(14px,2vw,20px)", background: "linear-gradient(90deg,#3b82f6 0%,#6366f1 45%,#a855f7 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "-0.01em" }}>
              Dynamic Phase Reconfiguration in DER-Integrated Distribution Feeders
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs hidden sm:block ${isDark ? "opacity-70" : "opacity-55"}`}>
              {loading ? "Loading…" : data.Timestamp}
            </span>
            <span className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border ${status === "Connected" ? "bg-emerald-100 text-emerald-800 border-emerald-400" : "bg-rose-100 text-rose-800 border-rose-400"}`}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse ${status === "Connected" ? "bg-emerald-500" : "bg-rose-500"}`} />
              {status}
            </span>
            <button onClick={() => setTheme(isDark ? "light" : "dark")}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium border hover:scale-105 transition-all ${isDark ? "bg-slate-700 text-slate-200 border-slate-600" : "bg-slate-200 text-slate-700 border-slate-300"}`}>
              {isDark ? "☀️ Light" : "🌙 Dark"}
            </button>
          </div>
        </div>

        <div className={`border-t mb-3 ${isDark ? "border-white/20" : "border-slate-200"}`} />

        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-semibold uppercase tracking-wider mr-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>Export:</span>
          {[
            { label: "⬇ Voltage PNG", bg: "bg-blue-600 hover:bg-blue-700", fn: () => exportChartPNG(buildChartDataFull(voltageRaw, vKeys), vKeys, [Y_LIMITS.voltage.min, Y_LIMITS.voltage.max], "V", "Voltage (V)", "Three Phase Voltages", "three_phase_voltage", "#2563eb") },
            { label: "⬇ Current PNG", bg: "bg-purple-600 hover:bg-purple-700", fn: () => exportChartPNG(buildChartDataFull(currentRaw, iKeys), iKeys, [Y_LIMITS.current.min, Y_LIMITS.current.max], "A", "Current (A)", "Three Phase Currents", "three_phase_current", "#9333ea") },
            { label: "⬇ Power PNG", bg: "bg-pink-600 hover:bg-pink-700", fn: () => exportChartPNG(buildChartDataFull(powerRaw, pKeys), pKeys, [Y_LIMITS.power.min, Y_LIMITS.power.max], "W", "Power (W)", "Three Phase Powers", "three_phase_power", "#db2777") },
            { label: "⬇ React. PNG", bg: "bg-violet-600 hover:bg-violet-700", fn: () => exportChartPNG(buildChartDataFull(reactiveRaw, qKeys), qKeys, [Y_LIMITS.reactive.min, Y_LIMITS.reactive.max], " VAR", "Reactive Power (VAR)", "Three Phase Reactive Powers", "three_phase_reactive", "#7c3aed") },
            { label: "⬇ PF PNG", bg: "bg-cyan-600 hover:bg-cyan-700", fn: () => exportChartPNG(buildChartDataFull(pf3Raw, pf3Keys), pf3Keys, [Y_LIMITS.pf3phase.min, Y_LIMITS.pf3phase.max], "", "Power Factor", "Three Phase Power Factors", "three_phase_pf", "#0891b2") },
            { label: "⬇ V PNG", bg: "bg-emerald-600 hover:bg-emerald-700", fn: () => exportChartPNG(buildChartDataFull(streetRaw, derVKeys), derVKeys, [Y_LIMITS.derV.min, Y_LIMITS.derV.max], "V", "DER Voltage (V)", "DER Voltage", "der_voltage", "#059669") },
            { label: "⬇ I PNG", bg: "bg-sky-600 hover:bg-sky-700", fn: () => exportChartPNG(buildChartDataFull(streetRaw, derIKeys), derIKeys, [Y_LIMITS.derI.min, Y_LIMITS.derI.max], "A", "DER Current (A)", "DER Current", "der_current", "#0284c7") },
            // Replace ⬇ P+F PNG button fn:
            {
              label: "⬇ P+F PNG", bg: "bg-teal-600 hover:bg-teal-700",
              fn: () => {
                const allKeys = [...derPFrKeys];
                const cd = buildChartDataFull(streetRaw, allKeys);
                exportDualAxisChartPNG(
                  cd,
                  [{ dataKey: "St_P", name: "Power(W)", color: "#10b981" }],
                  [{ dataKey: "St_F", name: "Freq(Hz)", color: "#f59e0b" }],
                  [Y_LIMITS.derP.min, Y_LIMITS.derP.max],
                  [Y_LIMITS.derFreq.min, Y_LIMITS.derFreq.max],
                  "W", "Hz",
                  "Power (W)", "Freq (Hz)",
                  "DER Power + Frequency", "der_power_freq", "#0d9488"
                );
              }
            },

            // Replace ⬇ Q+PF PNG button fn:
            {
              label: "⬇ Q+PF PNG", bg: "bg-fuchsia-600 hover:bg-fuchsia-700",
              fn: () => {
                const allKeys = [...derQPFKeys];
                const cd = buildChartDataFull(streetRaw, allKeys);
                exportDualAxisChartPNG(
                  cd,
                  [{ dataKey: "St_Q", name: "React.Pwr", color: "#a855f7" }],
                  [{ dataKey: "St_PF", name: "PF", color: "#ec4899" }],
                  [Y_LIMITS.derQPF.min, Y_LIMITS.derQPF.max],
                  [Y_LIMITS.derPF.min, Y_LIMITS.derPF.max],
                  " VAR", "",
                  "Reactive Power (VAR)", "Power Factor",
                  "DER Reactive Power + PF", "der_reactive_pf", "#7c3aed"
                );
              }
            },].map(btn => (
              <button key={btn.label} onClick={btn.fn}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm hover:scale-105 transition-all ${btn.bg}`}>
                {btn.label}
              </button>
            ))}
          <div className={`w-px h-6 mx-1 hidden sm:block ${isDark ? "bg-white/20" : "bg-slate-300"}`} />
          <button onClick={() => setShowExportModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white shadow-sm hover:scale-105 transition-all">
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

          {/* 3-Phase KPI */}
          <div className={`rounded-2xl p-4 ${sectionBg} border border-white/20 space-y-3`}>
            <h2 className={`text-l font-bold uppercase tracking-widest ${h2Color}`}>⚡ 3-Phase Metrics</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{voltageCards.map((c, i) => <SmallCard key={i} {...c} />)}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{currentCards.map((c, i) => <SmallCard key={i} {...c} />)}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{powerCards.map((c, i) => <SmallCard key={i} {...c} />)}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{reactiveCards.map((c, i) => <SmallCard key={i} {...c} />)}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{pf3Cards.map((c, i) => <SmallCard key={i} {...c} />)}</div>
          </div>

          {/* DER KPI */}
          <div className={`rounded-2xl p-4 ${sectionBg} border border-white/20 space-y-3`}>
            <h2 className={`text-l font-bold uppercase tracking-widest ${h2Color}`}>🌿 DER-Integrated Dynamic Phase Reconfiguration Feeder</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">{streetCards.map((c, i) => <SmallCard key={i} {...c} />)}</div>
          </div>

          {/* 3-Phase charts */}
          <ChartPanel id="chartVoltage" title="Three Phase Voltages"
            titleClass="bg-gradient-to-r from-blue-500 to-purple-500"
            keys={vKeys} filterOptions={vFilterOpts} data={voltageHist}
            yLabel="Voltage (V)" yUnit="V" refVal={230}
            yMin={Y_LIMITS.voltage.min} yMax={Y_LIMITS.voltage.max} isDark={isDark} />

          <ChartPanel id="chartCurrent" title="Three Phase Currents"
            titleClass="bg-gradient-to-r from-purple-500 to-pink-500"
            keys={iKeys} filterOptions={iFilterOpts} data={currentHist}
            yLabel="Current (A)" yUnit="A" refVal={null}
            yMin={Y_LIMITS.current.min} yMax={Y_LIMITS.current.max} isDark={isDark} />

          <ChartPanel id="chartPower" title="Three Phase Powers"
            titleClass="bg-gradient-to-r from-pink-500 to-orange-500"
            keys={pKeys} filterOptions={pFilterOpts} data={powerHist}
            yLabel="Power (W)" yUnit="W" refVal={null}
            yMin={Y_LIMITS.power.min} yMax={Y_LIMITS.power.max} isDark={isDark} />

          <ChartPanel id="chartReactive" title="Three Phase Reactive Powers"
            titleClass="bg-gradient-to-r from-violet-500 to-fuchsia-500"
            keys={qKeys} filterOptions={qFilterOpts} data={reactiveHist}
            yLabel="Reactive Power (VAR)" yUnit=" VAR" refVal={null}
            yMin={Y_LIMITS.reactive.min} yMax={Y_LIMITS.reactive.max} isDark={isDark} />

          <ChartPanel id="chartPF3" title="Three Phase Power Factors"
            titleClass="bg-gradient-to-r from-cyan-500 to-sky-500"
            keys={pf3Keys} filterOptions={pf3FilterOpts} data={pf3Hist}
            yLabel="Power Factor" yUnit="" refVal={1}
            yMin={Y_LIMITS.pf3phase.min} yMax={Y_LIMITS.pf3phase.max} isDark={isDark} />

          {/* DER charts */}
          <ChartPanel id="chartDerV" title="DER-Integrated Dynamic Phase Reconfiguration Feeder Voltage"
            titleClass="bg-gradient-to-r from-emerald-500 to-teal-500"
            keys={derVKeys} filterOptions={null} data={streetHist}
            yLabel="Voltage (V)" yUnit="V" refVal={null}
            yMin={Y_LIMITS.derV.min} yMax={Y_LIMITS.derV.max} isDark={isDark} />

          <ChartPanel id="chartDerI" title="DER-Integrated Dynamic Phase Reconfiguration Feeder Current"
            titleClass="bg-gradient-to-r from-teal-500 to-cyan-500"
            keys={derIKeys} filterOptions={null} data={streetHist}
            yLabel="Current (A)" yUnit="A" refVal={null}
            yMin={Y_LIMITS.derI.min} yMax={Y_LIMITS.derI.max} isDark={isDark} />

          {/* DUAL-AXIS: Power (left) + Frequency (right) */}
          <DualAxisChartPanel
            id="chartDerPFreq"
            title="DER-Integrated Dynamic Phase Reconfiguration Feeder Power · Frequency"
            titleClass="bg-gradient-to-r from-green-500 to-emerald-500"
            leftKeys={[{ dataKey: "St_P", name: "Power(W)", color: "#10b981" }]}
            rightKeys={[{ dataKey: "St_F", name: "Freq(Hz)", color: "#f59e0b" }]}
            data={streetHist}
            leftLabel="Power (W)" leftMin={Y_LIMITS.derP.min} leftMax={Y_LIMITS.derP.max} leftUnit="W"
            rightLabel="Freq (Hz)" rightMin={Y_LIMITS.derFreq.min} rightMax={Y_LIMITS.derFreq.max} rightUnit="Hz"
            isDark={isDark} />

          {/* DUAL-AXIS: Reactive Power (left) + Power Factor (right) */}
          <DualAxisChartPanel
            id="chartDerQPF"
            title="DER-Integrated Dynamic Phase Reconfiguration Feeder Reactive Power · Power Factor"
            titleClass="bg-gradient-to-r from-fuchsia-500 to-purple-500"
            leftKeys={[{ dataKey: "St_Q", name: "React.Pwr", color: "#a855f7" }]}
            rightKeys={[{ dataKey: "St_PF", name: "PF", color: "#ec4899" }]}
            data={streetHist}
            leftLabel="VAR" leftMin={Y_LIMITS.derQPF.min} leftMax={Y_LIMITS.derQPF.max} leftUnit=" VAR"
            rightLabel="PF" rightMin={Y_LIMITS.derPF.min} rightMax={Y_LIMITS.derPF.max} rightUnit=""
            isDark={isDark} />

        </section>
        <aside className="lg:col-span-1 flex flex-col"><EventLog events={events} /></aside>
      </main>
    </div>
  );
}