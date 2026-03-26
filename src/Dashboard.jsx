// Dashboard.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush, ReferenceLine
} from "recharts";
import Papa from "papaparse";
import { saveAs } from "file-saver";
import html2canvas from "html2canvas";
import EventLog from "./EventLog";

/* ========== CONFIG ========== */
const SHEET_ID = "1C2BWZbJ1HJzzqkIuHrvH8OnrT9PbFKVCdaD-40jj9bw";

const CSV_URL =
"https://docs.google.com/spreadsheets/d/1C2BWZbJ1HJzzqkIuHrvH8OnrT9PbFKVCdaD-40jj9bw/gviz/tq?tqx=out:csv&gid=0";
const POLL_INTERVAL = 5000;
const MAX_HISTORY = 500;
const MAX_EVENTS = 15;
 
/* ========== HELPERS ========== */
const formatTS = (raw) => {
  if (!raw) return "";
  try {
    if (String(raw).length > 11) return new Date(raw).toLocaleString();
    return new Date(raw * 1000).toLocaleString();
  } catch { return ""; }
};

const smallNumber = (v, dec = 2) => {
  if (v === null || v === undefined) return (0).toFixed(dec);
  return Number(v).toFixed(dec);
};

/* =====================================================================
   SMALL KPI CARD
===================================================================== */
const SmallCard = React.memo(function SmallCard({ label, value, unit, big }) {
  const emojiMap = {
    "Voltage R": "⚡", "Voltage Y": "⚡", "Voltage B": "⚡",
    "Current R": "🔌", "Current Y": "🔌", "Current B": "🔌",
    "Power R": "💡", "Power Y": "💡", "Power B": "💡",
    "Frequency R": "📡", "Frequency Y": "📡", "Frequency B": "📡",
    "PF R": "🎛️", "PF Y": "🎛️", "PF B": "🎛️",
  };
  const emoji = emojiMap[label] || "📊";

  return (
    <div
      role="article"
      aria-label={label}
      className="
        relative overflow-hidden rounded-2xl p-6
        bg-white/10 dark:bg-white/5 
        backdrop-blur-xl border border-white/20
        shadow-lg hover:shadow-neon
        transition-all hover:-translate-y-2
      "
    >
      <p className="flex items-center gap-3 text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 uppercase">
        <span className="text-xl">{emoji}</span>
        {label}
      </p>

      <div className="flex items-baseline gap-3">
        <p
          className={`
            font-black text-transparent bg-clip-text
            bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600
            ${big ? "text-4xl" : "text-3xl"}
          `}
        >
          {value}
        </p>
        <span className="text-slate-500 dark:text-slate-400 text-lg font-medium">{unit}</span>
      </div>
    </div>
  );
});

/* =====================================================================
   CHART SECTION
   Now accepts `filter` prop to fade non-selected series.
===================================================================== */
 
/** IQR-based outlier removal. Returns [lo, hi] clean bounds. */
function cleanBounds(values, margin = 0.05) {
  const sorted = [...values].filter(v => v !== null && v !== undefined && !isNaN(v) && v > 0).sort((a, b) => a - b);
  if (sorted.length < 4) return [0, "auto"];
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const clean = sorted.filter(v => v >= lo && v <= hi);
  if (!clean.length) return [0, "auto"];
  const min = clean[0];
  const max = clean[clean.length - 1];
  const pad = (max - min) * margin || 1;
  return [+(min - pad).toFixed(2), +(max + pad).toFixed(2)];
}
 
/* Custom tooltip ------------------------------------------------- */
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "rgba(15,23,42,0.92)",
      border: "1px solid rgba(99,102,241,0.4)",
      borderRadius: 10,
      padding: "10px 14px",
      fontSize: 12,
      color: "#e2e8f0",
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
 
/* ─── Charts component ─────────────────────────────────────── */
const Charts = React.memo(function Charts({ type, data, filter = "all" }) {
 
  // ── zoom state: [lo, hi] overrides auto domain when set ──
  const [zoomDomain, setZoomDomain] = useState(null); // null = auto
  const zoomRef = useRef(zoomDomain);
  zoomRef.current = zoomDomain;
 
  // ── chart data ────────────────────────────────────────────
  const chartData = useMemo(() => data.map(d => ({
    time: new Date(d.t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    Va: d.Va > 0 && d.Va < 500 ? d.Va : null,
    Vb: d.Vb > 0 && d.Vb < 500 ? d.Vb : null,
    Vc: d.Vc > 0 && d.Vc < 500 ? d.Vc : null,
    Ia: d.Ia >= 0 && d.Ia < 100 ? d.Ia : null,
    Ib: d.Ib >= 0 && d.Ib < 100 ? d.Ib : null,
    Ic: d.Ic >= 0 && d.Ic < 100 ? d.Ic : null,
  })), [data]);
 
  // ── compute smart Y domain from clean data ────────────────
  const autoDomain = useMemo(() => {
    if (!chartData.length) return [0, "auto"];
    if (type === "voltage") {
      const vals = chartData.flatMap(d => [d.Va, d.Vb, d.Vc]).filter(Boolean);
      return cleanBounds(vals, 0.08);
    } else {
      const vals = chartData.flatMap(d => [d.Ia, d.Ib, d.Ic]).filter(v => v !== null);
      if (!vals.length) return [0, 10];
      return cleanBounds(vals, 0.12);
    }
  }, [chartData, type]);
 
  const yDomain = zoomDomain ?? autoDomain;
 
  // ── mouse wheel zoom on the chart ────────────────────────
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const [lo, hi] = zoomRef.current ?? autoDomain;
    const range = hi - lo;
    const center = (lo + hi) / 2;
    const factor = e.deltaY < 0 ? 0.85 : 1.18; // scroll up = zoom in
    const newRange = range * factor;
    const newLo = +(center - newRange / 2).toFixed(3);
    const newHi = +(center + newRange / 2).toFixed(3);
    setZoomDomain([newLo, newHi]);
  }, [autoDomain]);
 
  // ── shift+drag to pan ────────────────────────────────────
  const dragRef = useRef({ active: false, startY: 0, startDomain: null });
 
  const handleMouseDown = useCallback((e) => {
    if (!e.shiftKey) return;
    e.preventDefault();
    dragRef.current = {
      active: true,
      startY: e.clientY,
      startDomain: zoomRef.current ?? autoDomain
    };
  }, [autoDomain]);
 
  const handleMouseMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const [lo, hi] = drag.startDomain;
    const range = hi - lo;
    const pixelDelta = drag.startY - e.clientY; // up = positive
    const valueDelta = (pixelDelta / 250) * range; // 250px ≈ full range
    setZoomDomain([
      +(lo + valueDelta).toFixed(3),
      +(hi + valueDelta).toFixed(3)
    ]);
  }, []);
 
  const handleMouseUp = useCallback(() => {
    dragRef.current.active = false;
  }, []);
 
  // ── opacity for filter ───────────────────────────────────
  const opacityFor = (key) => {
    if (!filter || filter === "all") return 1;
    return filter === key ? 1 : 0.15;
  };
 
  // ── reference line value ─────────────────────────────────
  const refValue = type === "voltage" ? 230 : null;
 
  // ── Y-axis tick formatter ────────────────────────────────
  const yTickFmt = (v) => {
    if (typeof v !== "number") return v;
    return type === "voltage" ? `${v.toFixed(1)}V` : `${v.toFixed(3)}A`;
  };
 
  // ── colors ───────────────────────────────────────────────
  const colors = type === "voltage"
    ? { a: "#3b82f6", b: "#06b6d4", c: "#f59e0b" }
    : { a: "#3b82f6", b: "#06b6d4", c: "#f59e0b" };
 
  const unit = type === "voltage" ? "V" : "A";
  const [ka, kb, kc] = type === "voltage" ? ["Va", "Vb", "Vc"] : ["Ia", "Ib", "Ic"];
  const [na, nb, nc] = type === "voltage" ? ["V_R", "V_Y", "V_B"] : ["I_R", "I_Y", "I_B"];
 
  return (
    <div style={{ position: "relative" }}>
      {/* Zoom controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>
          🖱 Scroll to zoom Y-axis · Shift+drag to pan
        </span>
        {zoomDomain && (
          <>
            <span style={{
              fontSize: 11, fontWeight: 700, color: "#6366f1",
              background: "rgba(99,102,241,0.12)", borderRadius: 6, padding: "2px 8px"
            }}>
              Y: {zoomDomain[0]}{unit} – {zoomDomain[1]}{unit}
            </span>
            <button
              onClick={() => setZoomDomain(null)}
              style={{
                fontSize: 11, cursor: "pointer",
                background: "rgba(239,68,68,0.15)", color: "#f87171",
                border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6,
                padding: "2px 8px", fontWeight: 600
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
        style={{ cursor: "crosshair", userSelect: "none" }}
      >
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.18} />
 
            <XAxis
              dataKey="time"
              stroke="#64748b"
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              minTickGap={40}
              tickLine={false}
              label={{ value: "Time", position: "insideBottomRight", offset: -4, fill: "#64748b", fontSize: 11 }}
            />
 
            <YAxis
              stroke="#64748b"
              domain={yDomain}
              tickFormatter={yTickFmt}
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              tickCount={7}
              tickLine={false}
              width={62}
              label={{
                value: type === "voltage" ? "Voltage (V)" : "Current (A)",
                angle: -90,
                position: "insideLeft",
                fill: "#64748b",
                fontSize: 11,
                dy: 50
              }}
            />
 
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
              formatter={(value) => <span style={{ color: "#94a3b8" }}>{value}</span>}
            />
 
            {refValue && (
              <ReferenceLine
                y={refValue}
                stroke="#22c55e"
                strokeDasharray="6 3"
                strokeWidth={1.5}
                label={{ value: `${refValue}V nominal`, position: "right", fontSize: 10, fill: "#22c55e" }}
              />
            )}
 
            <Line type="monotone" dataKey={ka} stroke={colors.a} strokeWidth={2.5} dot={false}
              name={na} strokeOpacity={opacityFor(ka)} connectNulls={false} />
            <Line type="monotone" dataKey={kb} stroke={colors.b} strokeWidth={2.5} dot={false}
              name={nb} strokeOpacity={opacityFor(kb)} connectNulls={false} />
            <Line type="monotone" dataKey={kc} stroke={colors.c} strokeWidth={2.5} dot={false}
              name={nc} strokeOpacity={opacityFor(kc)} connectNulls={false} />
 
            <Brush
              dataKey="time"
              height={28}
              stroke="#6366f1"
              fill="rgba(99,102,241,0.08)"
              travellerWidth={8}
              tickFormatter={(v) => v}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});


/* =====================================================================
   🔧 FIXED EXPORT FUNCTIONS (ONLY CODE MODIFIED)
===================================================================== */
const exportPNG = async () => {
  const el = document.getElementById("chartCapture");
  if (!el) return alert("Voltage chart not ready!");

  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,

    onclone: (doc) => {
      const cloned = doc.getElementById("chartCapture");

      // ✅ HIDE DROPDOWN
      const dropdown = cloned.querySelector("select");
      if (dropdown) dropdown.style.display = "none";

      // ✅ FIX TITLE VISIBILITY
      const title = cloned.querySelector("h3");
      if (title) {
        title.style.color = "#2563eb";
        title.style.background = "none";
        title.style.webkitTextFillColor = "#2563eb";
      }
    }
  });

  canvas.toBlob(blob => {
    saveAs(blob, `voltage_chart_${Date.now()}.png`);
  });
};
const exportPNGCurrent = async () => {
  const el = document.getElementById("chartCaptureCurrent");
  if (!el) return alert("Current chart not ready!");

  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,

    onclone: (doc) => {
      const cloned = doc.getElementById("chartCaptureCurrent");

      // ✅ HIDE DROPDOWN (removes "All Phases")
      const dropdown = cloned.querySelector("select");
      if (dropdown) dropdown.style.display = "none";

      // ✅ KEEP TITLE VISIBLE (fix gradient issue)
      const title = cloned.querySelector("h3");
      if (title) {
        title.style.color = "#9333ea";
        title.style.background = "none";
        title.style.webkitTextFillColor = "#9333ea";
      }
    }
  });

  canvas.toBlob(blob => {
    saveAs(blob, `current_chart_${Date.now()}.png`);
  });
};

const exportCSV = (csvText) => {
  if (!csvText || csvText.length < 5) {
    alert("CSV not ready yet!");
    return;
  }
  saveAs(
    new Blob([csvText], { type: "text/csv;charset=utf-8" }),
    `smartgrid_data_${Date.now()}.csv`
  );
};

/* =====================================================================
   MAIN DASHBOARD
===================================================================== */
export default function Dashboard() {

  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  const [status, setStatus] = useState("Connecting...");
  const [events, setEvents] = useState([]);
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);

  const [data, setData] = useState({
    Va: 0, Vb: 0, Vc: 0,
    Ia: 0, Ib: 0, Ic: 0,
    Pa: 0, Pb: 0, Pc: 0,
    Fr: 0, Fy: 0, Fb: 0,
    PFr: 0, PFy: 0, PFb: 0,
    Timestamp: ""
  });

  const [voltageHistory, setVoltageHistory] = useState([]);
  const [currentHistory, setCurrentHistory] = useState([]);

  const prevRawRef = useRef(null);
  const prevDataRef = useRef(data);

  // NEW: chart filters (same behavior as earlier: fade non-selected)
  const [voltageFilter, setVoltageFilter] = useState("all"); // "all" | "Va" | "Vb" | "Vc"
  const [currentFilter, setCurrentFilter] = useState("all"); // "all" | "Ia" | "Ib" | "Ic"

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  /* FETCH DATA */
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(CSV_URL);
      if (!res.ok) {
        setStatus("Disconnected");
        setLoading(false);
        return;
      }

      const text = await res.text();
      const parsed = Papa.parse(text, { header: true, dynamicTyping: true });
      console.log(parsed.data); 
      if (!parsed.data.length) return;

      const row = parsed.data[parsed.data.length - 1];
      const rawIdentifier = JSON.stringify(row);

      if (prevRawRef.current === rawIdentifier) {
        setLoading(false);
        return;
      }

      prevRawRef.current = rawIdentifier;

     const newData = {
  Va: Number(row["V_R"]) || 0,
  Vb: Number(row["V_Y"]) || 0,
  Vc: Number(row["V_B"]) || 0,

  Ia: Number(row["I_R"]) || 0,
  Ib: Number(row["I_Y"]) || 0,
  Ic: Number(row["I_B"]) || 0,

  Pa: Number(row["P_R"]) || 0,
  Pb: Number(row["P_Y"]) || 0,
  Pc: Number(row["P_B"]) || 0,

  Timestamp: new Date().toLocaleTimeString()
};

      const prev = prevDataRef.current;
      const changed =
        prev.Va !== newData.Va ||
        prev.Ia !== newData.Ia ||
        prev.Pa !== newData.Pa;

      const hasData = newData.Va || newData.Ia || newData.Pa;

      setStatus(hasData ? "Connected" : "Disconnected");

      if (changed && hasData) {
        setEvents(prev => [
  { msg: "Data updated", time: Date.now(), level: "success" },
  ...prev
].slice(0, MAX_EVENTS));
      }

      setData(newData);
      prevDataRef.current = newData;

      const now = Date.now();
      setVoltageHistory(p => [...p.slice(-MAX_HISTORY), { t: now, Va: newData.Va, Vb: newData.Vb, Vc: newData.Vc }]);
      setCurrentHistory(p => [...p.slice(-MAX_HISTORY), { t: now, Ia: newData.Ia, Ib: newData.Ib, Ic: newData.Ic }]);

      /* CSV FIX */
      if (text && text.length > 10) window.__SMARTGRID_CSV__ = text;

      setLoading(false);

    } catch (e) {
      setStatus("Disconnected");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchData]);

  /* UI DATA */
  const voltageCards = [
    { label: "Voltage R", value: smallNumber(data.Va, 1), unit: "V" },
    { label: "Voltage Y", value: smallNumber(data.Vb, 1), unit: "V" },
    { label: "Voltage B", value: smallNumber(data.Vc, 1), unit: "V" },
  ];

  const currentCards = [
    { label: "Current R", value: smallNumber(data.Ia, 2), unit: "A" },
    { label: "Current Y", value: smallNumber(data.Ib, 2), unit: "A" },
    { label: "Current B", value: smallNumber(data.Ic, 2), unit: "A" },
  ];

  const powerCards = [
    { label: "Power R", value: smallNumber(data.Pa, 2), unit: "W" },
    { label: "Power Y", value: smallNumber(data.Pb, 2), unit: "W" },
    { label: "Power B", value: smallNumber(data.Pc, 2), unit: "W" },
  ];

  
  /* ===========================================================
     UI
  =========================================================== */
  return (
    <div className="min-h-screen p-8 bg-slate-200 dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-all">

      {/* Ambient lights */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -left-40 -top-32 w-96 h-96 rounded-full bg-purple-500/20 blur-[120px]" />
        <div className="absolute right-0 top-1/4 w-80 h-80 rounded-full bg-indigo-500/20 blur-[100px]" />
      </div>

      {/* Header */}
      <header className="
        rounded-2xl p-6 mb-8 shadow-xl
        bg-white/40 dark:bg-white/10 
        backdrop-blur-xl border border-white/20
        flex flex-col lg:flex-row justify-between items-center gap-4
      ">

        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 flex items-center justify-center text-3xl font-black shadow-neon">SG</div>

          <div>
            <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600">
              Smart Grid Dashboard
            </h1>
            <p className="text-sm mt-1 opacity-70">Real-time Energy Monitoring</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">

          <p className="text-sm opacity-80">{loading ? "Loading…" : data.Timestamp}</p>

          <span
            className={`
              px-4 py-2 rounded-lg font-bold flex items-center gap-2 border
              ${status === "Connected"
                ? "bg-emerald-100 text-emerald-800 border-emerald-400"
                : "bg-rose-100 text-rose-800 border-rose-400"
              }
            `}
          >
            <span className={`w-2 h-2 rounded-full ${status === "Connected" ? "bg-emerald-500" : "bg-rose-500"} animate-pulse`}></span>
            {status}
          </span>

          {/* Theme toggle */}
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="px-3 py-2 rounded-lg bg-slate-300 dark:bg-slate-800 hover:scale-105 transition-all"
          >
             {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
          </button>

          {/* FIXED EXPORT BUTTONS */}
          <button className="px-4 py-2 rounded-xl bg-blue-600 text-white shadow-md hover:scale-105" onClick={exportPNG}>
            Export Voltage PNG
          </button>

          <button className="px-4 py-2 rounded-xl bg-purple-600 text-white shadow-md hover:scale-105" onClick={exportPNGCurrent}>
            Export Current PNG
          </button>

          <button
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white shadow-md hover:scale-105"
            onClick={() => exportCSV(window.__SMARTGRID_CSV__)}
          >
            Export Data
          </button>

        </div>
      </header>

      {/* Layout */}
      <main className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-stretch">

        <section className="lg:col-span-3 space-y-6">

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {voltageCards.map((c, i) => <SmallCard key={i} {...c} />)}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {currentCards.map((c, i) => <SmallCard key={i} {...c} />)}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {powerCards.map((c, i) => <SmallCard key={i} {...c} />)}
          </div>

          

          {/* Charts */}
          <div
  id="chartCapture"
  className="rounded-2xl p-6 bg-white/40 dark:bg-white/10 backdrop-blur-xl border border-white/20 shadow-xl"
>
  <div className="flex items-center justify-between mb-4">
    
    {/* ✅ ONLY ONE TITLE */}
    <h3 className="chart-title text-3xl font-black bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
  Voltage Trend
</h3>

    {/* Dropdown */}
    <select
      value={voltageFilter}
      onChange={(e) => setVoltageFilter(e.target.value)}
      className="
        px-3 py-2 rounded-lg
        bg-white/20 dark:bg-white/10
        backdrop-blur-md
        text-gray-900 dark:text-gray-100
        border border-white/30 dark:border-white/20
        shadow-sm
      "
    >
      <option value="all">All Phases</option>
      <option value="Va">Phase R (Va)</option>
      <option value="Vb">Phase Y (Vb)</option>
      <option value="Vc">Phase B (Vc)</option>
    </select>
  </div>

  <Charts type="voltage" data={voltageHistory} filter={voltageFilter} />
</div>
<div
  id="chartCaptureCurrent"
  className="rounded-2xl p-6 bg-white/40 dark:bg-white/10 backdrop-blur-xl border border-white/20 shadow-xl"
>
  <div className="flex items-center justify-between mb-4">
    
    {/* ✅ ONLY ONE TITLE */}
    <h3 className="chart-title text-3xl font-black bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">
  Current Trend
</h3>
    {/* Dropdown */}
    <select
      value={currentFilter}
      onChange={(e) => setCurrentFilter(e.target.value)}
      className="
        px-3 py-2 rounded-lg
        bg-white/20 dark:bg-white/10
        backdrop-blur-md
        text-gray-900 dark:text-gray-100
        border border-white/30 dark:border-white/20
        shadow-sm
      "
    >
      <option value="all">All Phases</option>
      <option value="Ia">Phase R (Ia)</option>
      <option value="Ib">Phase Y (Ib)</option>
      <option value="Ic">Phase B (Ic)</option>
    </select>
  </div>

  <Charts type="current" data={currentHistory} filter={currentFilter} />
</div>


        </section>

       <aside className="lg:col-span-1 flex flex-col">
  <EventLog events={events} />
</aside>

      </main>
    </div>
  );
}
