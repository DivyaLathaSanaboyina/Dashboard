// Dashboard.jsx  — Full column mapping from Google Sheet
// Columns: Timestamp, V_R, V_Y, V_B, I_R, I_Y, I_B, P_R, P_Y, P_B,
//          Street_V, Street_I, Street_P, Street_PF, Street_F
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Brush, ReferenceLine
} from "recharts";
import Papa from "papaparse";
import { saveAs } from "file-saver";
import html2canvas from "html2canvas";
import EventLog from "./EventLog";

/* ========== CONFIG ========== */
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/1C2BWZbJ1HJzzqkIuHrvH8OnrT9PbFKVCdaD-40jj9bw/gviz/tq?tqx=out:csv&gid=0";
const POLL_INTERVAL = 5000;
const MAX_HISTORY = 500;
const MAX_EVENTS = 15;

/* ========== HELPERS ========== */
const smallNumber = (v, dec = 2) => {
  if (v === null || v === undefined) return (0).toFixed(dec);
  return Number(v).toFixed(dec);
};

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
    <div
      role="article"
      aria-label={label}
      className="relative overflow-hidden rounded-2xl p-6
        bg-white/10 dark:bg-white/5 backdrop-blur-xl border border-white/20
        shadow-lg hover:shadow-neon transition-all hover:-translate-y-2"
    >
      <p className="flex items-center gap-3 text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 uppercase">
        <span className="text-xl">{emoji}</span>
        {label}
      </p>
      <div className="flex items-baseline gap-3">
        <p className={`font-black text-3xl text-transparent bg-clip-text bg-gradient-to-r ${grad}`}>
          {value}
        </p>
        <span className="text-slate-500 dark:text-slate-400 text-lg font-medium">{unit}</span>
      </div>
    </div>
  );
});

/* =====================================================================
   IQR-BASED OUTLIER REMOVAL
===================================================================== */
// Per-unit hard Y ceilings passed through yMax prop
function cleanBounds(values, margin = 0.05, yMax = Infinity) {
  const sorted = [...values]
    .filter(v => v !== null && v !== undefined && !isNaN(v) && v > 0 && v <= yMax)
    .sort((a, b) => a - b);
  if (sorted.length < 4) return [0, yMax === Infinity ? "auto" : yMax];
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const clean = sorted.filter(v => v >= lo && v <= hi);
  if (!clean.length) return [0, yMax === Infinity ? "auto" : yMax];
  const min = clean[0], max = clean[clean.length - 1];
  const pad = (max - min) * margin || 1;
  return [
    Math.max(0, +(min - pad).toFixed(2)),
    Math.min(yMax, +(max + pad).toFixed(2))
  ];
}

/* =====================================================================
   CUSTOM TOOLTIP
===================================================================== */
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "rgba(15,23,42,0.92)",
      border: "1px solid rgba(99,102,241,0.4)",
      borderRadius: 10, padding: "10px 14px",
      fontSize: 12, color: "#e2e8f0",
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
   GENERIC CHART COMPONENT
===================================================================== */
const Charts = React.memo(function Charts({ keys, data, yLabel, yUnit, refVal, filter = "all", yMax = Infinity }) {
  const [zoomDomain, setZoomDomain] = useState(null);
  const zoomRef = useRef(zoomDomain);
  zoomRef.current = zoomDomain;

  const chartData = useMemo(() => data.map(d => {
    const point = { time: new Date(d.t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) };
    keys.forEach(k => { point[k.dataKey] = d[k.dataKey] ?? null; });
    return point;
  }), [data, keys]);

  const autoDomain = useMemo(() => {
    if (!chartData.length) return [0, "auto"];
    const vals = chartData.flatMap(d => keys.map(k => d[k.dataKey])).filter(v => v !== null && !isNaN(v) && v > 0);
    return cleanBounds(vals, 0.08, yMax);
  }, [chartData, keys]);

  const yDomain = zoomDomain ?? autoDomain;

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const [lo, hi] = zoomRef.current ?? autoDomain;
    const range = hi - lo, center = (lo + hi) / 2;
    const factor = e.deltaY < 0 ? 0.85 : 1.18;
    const newRange = range * factor;
    setZoomDomain([+(center - newRange / 2).toFixed(3), +(center + newRange / 2).toFixed(3)]);
  }, [autoDomain]);

  const dragRef = useRef({ active: false, startY: 0, startDomain: null });
  const handleMouseDown = useCallback((e) => {
    if (!e.shiftKey) return;
    e.preventDefault();
    dragRef.current = { active: true, startY: e.clientY, startDomain: zoomRef.current ?? autoDomain };
  }, [autoDomain]);
  const handleMouseMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const [lo, hi] = drag.startDomain;
    const range = hi - lo;
    const valueDelta = ((drag.startY - e.clientY) / 250) * range;
    setZoomDomain([+(lo + valueDelta).toFixed(3), +(hi + valueDelta).toFixed(3)]);
  }, []);
  const handleMouseUp = useCallback(() => { dragRef.current.active = false; }, []);

  const opacityFor = (key) => (!filter || filter === "all") ? 1 : filter === key ? 1 : 0.15;
  const yTickFmt = (v) => typeof v === "number" ? `${v.toFixed(2)}${yUnit}` : v;

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>🖱 Scroll to zoom Y-axis · Shift+drag to pan</span>
        {zoomDomain && (
          <>
            <span style={{
              fontSize: 11, fontWeight: 700, color: "#6366f1",
              background: "rgba(99,102,241,0.12)", borderRadius: 6, padding: "2px 8px"
            }}>
              Y: {zoomDomain[0]}{yUnit} – {zoomDomain[1]}{yUnit}
            </span>
            <button onClick={() => setZoomDomain(null)} style={{
              fontSize: 11, cursor: "pointer",
              background: "rgba(239,68,68,0.15)", color: "#f87171",
              border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6,
              padding: "2px 8px", fontWeight: 600
            }}>Reset Zoom</button>
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
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.18} />
            <XAxis
              dataKey="time" stroke="#64748b"
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              minTickGap={40} tickLine={false}
              label={{ value: "Time", position: "insideBottomRight", offset: -4, fill: "#64748b", fontSize: 11 }}
            />
            <YAxis
              stroke="#64748b" domain={yDomain}
              tickFormatter={yTickFmt}
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              tickCount={7} tickLine={false} width={68}
              label={{ value: yLabel, angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 11, dy: 60 }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
              formatter={(value) => <span style={{ color: "#94a3b8" }}>{value}</span>}
            />
            {refVal !== null && refVal !== undefined && (
              <ReferenceLine
                y={refVal} stroke="#22c55e" strokeDasharray="6 3" strokeWidth={1.5}
                label={{ value: `${refVal}${yUnit} nominal`, position: "right", fontSize: 10, fill: "#22c55e" }}
              />
            )}
            {keys.map(k => (
              <Line
                key={k.dataKey}
                type="monotone" dataKey={k.dataKey} stroke={k.color}
                strokeWidth={2.5} dot={false} name={k.name}
                strokeOpacity={opacityFor(k.dataKey)} connectNulls={false}
              />
            ))}
            <Brush
              dataKey="time" height={28} stroke="#6366f1"
              fill="rgba(99,102,241,0.08)" travellerWidth={8}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

/* =====================================================================
   CHART PANEL
===================================================================== */
function ChartPanel({ id, title, titleClass, keys, filterOptions, data, yLabel, yUnit, refVal, yMax }) {
  const [filter, setFilter] = useState("all");
  return (
    <div id={id} className="rounded-2xl p-6 bg-white/40 dark:bg-white/10 backdrop-blur-xl border border-white/20 shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className={`text-3xl font-black bg-clip-text text-transparent ${titleClass}`}>{title}</h3>
        {filterOptions && (
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-white/20 dark:bg-white/10 backdrop-blur-md
              text-gray-900 dark:text-gray-100 border border-white/30 dark:border-white/20 shadow-sm"
          >
            {filterOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </div>
      <Charts keys={keys} data={data} yLabel={yLabel} yUnit={yUnit} refVal={refVal} filter={filter} yMax={yMax} />
    </div>
  );
}

/* =====================================================================
   EXPORT HELPERS
===================================================================== */
const exportChartPNG = async (id, filename, titleColor) => {
  const el = document.getElementById(id);
  if (!el) return alert(`Chart "${id}" not ready!`);
  const canvas = await html2canvas(el, {
    scale: 2, backgroundColor: "#ffffff", useCORS: true,
    onclone: (doc) => {
      const cloned = doc.getElementById(id);
      const sel = cloned.querySelector("select");
      if (sel) sel.style.display = "none";
      const title = cloned.querySelector("h3");
      if (title) { title.style.color = titleColor; title.style.background = "none"; title.style.webkitTextFillColor = titleColor; }
    }
  });
  canvas.toBlob(blob => saveAs(blob, `${filename}_${Date.now()}.png`));
};

const exportCSV = (csvText) => {
  if (!csvText || csvText.length < 5) { alert("CSV not ready yet!"); return; }
  saveAs(new Blob([csvText], { type: "text/csv;charset=utf-8" }), `smartgrid_data_${Date.now()}.csv`);
};

/* =====================================================================
   MAIN DASHBOARD
===================================================================== */
export default function Dashboard() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  const [status, setStatus] = useState("Connecting...");
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const emptyData = {
    Va: 0, Vb: 0, Vc: 0,
    Ia: 0, Ib: 0, Ic: 0,
    Pa: 0, Pb: 0, Pc: 0,
    St_V: 0, St_I: 0, St_P: 0, St_PF: 0, St_F: 0,
    Timestamp: ""
  };
  const [data, setData] = useState(emptyData);

  const [voltageHist, setVoltageHist] = useState([]);
  const [currentHist, setCurrentHist] = useState([]);
  const [powerHist, setPowerHist] = useState([]);
  const [streetHist, setStreetHist] = useState([]);

  const prevRawRef = useRef(null);
  const prevDataRef = useRef(emptyData);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

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

      const clamp = (v, lo, hi) => (v >= lo && v <= hi ? v : 0);

      // ── Hard limits ──────────────────────────────────────────
      const V_MAX = 300;    // Volts
      const I_MAX = 20;     // Amps
      const P_MAX = 5000;   // Watts  (5 kW)
      const PF_MAX = 1;      // Power Factor
      const F_MAX = 70;     // Hz

      // Returns null if value exceeds limit so chart skips the point
      const gate = (v, lo, hi) => {
        const n = Number(v) || 0;
        return (n >= lo && n <= hi) ? n : null;
      };

      const newData = {
        Va: gate(row["V_R"], 0, V_MAX),
        Vb: gate(row["V_Y"], 0, V_MAX),
        Vc: gate(row["V_B"], 0, V_MAX),
        Ia: gate(row["I_R"], 0, I_MAX),
        Ib: gate(row["I_Y"], 0, I_MAX),
        Ic: gate(row["I_B"], 0, I_MAX),
        Pa: gate(row["P_R"], 0, P_MAX),
        Pb: gate(row["P_Y"], 0, P_MAX),
        Pc: gate(row["P_B"], 0, P_MAX),
        St_V: gate(row["Street_V"], 0, V_MAX),
        St_I: gate(row["Street_I"], 0, I_MAX),
        St_P: gate(row["Street_P"], 0, P_MAX),
        St_PF: gate(row["Street_PF"], -PF_MAX, PF_MAX),
        St_F: gate(row["Street_F"], 0, F_MAX),
        Timestamp: new Date().toLocaleTimeString()
      };

      const prev = prevDataRef.current;
      const changed = prev.Va !== newData.Va || prev.Ia !== newData.Ia || prev.Pa !== newData.Pa || prev.St_V !== newData.St_V;
      const hasData = newData.Va || newData.Ia || newData.Pa || newData.St_V;

      setStatus(hasData ? "Connected" : "Disconnected");

      if (changed && hasData) {
        setEvents(p => [{ msg: "Data updated", time: Date.now(), level: "success" }, ...p].slice(0, MAX_EVENTS));
      }

      setData(newData);
      prevDataRef.current = newData;

      const now = Date.now();
      setVoltageHist(p => [...p.slice(-MAX_HISTORY), { t: now, Va: newData.Va, Vb: newData.Vb, Vc: newData.Vc }]);
      setCurrentHist(p => [...p.slice(-MAX_HISTORY), { t: now, Ia: newData.Ia, Ib: newData.Ib, Ic: newData.Ic }]);
      setPowerHist(p => [...p.slice(-MAX_HISTORY), { t: now, Pa: newData.Pa, Pb: newData.Pb, Pc: newData.Pc }]);
      setStreetHist(p => [...p.slice(-MAX_HISTORY), { t: now, St_V: newData.St_V, St_I: newData.St_I, St_P: newData.St_P, St_PF: newData.St_PF, St_F: newData.St_F }]);

      if (text && text.length > 10) window.__SMARTGRID_CSV__ = text;
      setLoading(false);
    } catch {
      setStatus("Disconnected");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchData]);

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

  const vKeys = [
    { dataKey: "Va", name: "V_R", color: "#3b82f6" },
    { dataKey: "Vb", name: "V_Y", color: "#06b6d4" },
    { dataKey: "Vc", name: "V_B", color: "#f59e0b" },
  ];
  const iKeys = [
    { dataKey: "Ia", name: "I_R", color: "#3b82f6" },
    { dataKey: "Ib", name: "I_Y", color: "#06b6d4" },
    { dataKey: "Ic", name: "I_B", color: "#f59e0b" },
  ];
  const pKeys = [
    { dataKey: "Pa", name: "P_R", color: "#ec4899" },
    { dataKey: "Pb", name: "P_Y", color: "#8b5cf6" },
    { dataKey: "Pc", name: "P_B", color: "#f59e0b" },
  ];
  const stVIKeys = [
    { dataKey: "St_V", name: "Street V", color: "#10b981" },
    { dataKey: "St_I", name: "Street I", color: "#06b6d4" },
  ];
  const stPFKeys = [
    { dataKey: "St_P", name: "Street Power", color: "#10b981" },
    { dataKey: "St_PF", name: "Street PF", color: "#f59e0b" },
    { dataKey: "St_F", name: "Street Freq", color: "#ec4899" },
  ];

  const vFilterOpts = [
    { value: "all", label: "All Phases" },
    { value: "Va", label: "Phase R (Va)" },
    { value: "Vb", label: "Phase Y (Vb)" },
    { value: "Vc", label: "Phase B (Vc)" },
  ];
  const iFilterOpts = [
    { value: "all", label: "All Phases" },
    { value: "Ia", label: "Phase R (Ia)" },
    { value: "Ib", label: "Phase Y (Ib)" },
    { value: "Ic", label: "Phase B (Ic)" },
  ];
  const pFilterOpts = [
    { value: "all", label: "All Phases" },
    { value: "Pa", label: "Phase R (Pa)" },
    { value: "Pb", label: "Phase Y (Pb)" },
    { value: "Pc", label: "Phase B (Pc)" },
  ];

  return (
    <div className="min-h-screen p-8 bg-slate-200 dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-all">

      {/* Ambient lights */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -left-40 -top-32 w-96 h-96 rounded-full bg-purple-500/20 blur-[120px]" />
        <div className="absolute right-0 top-1/4 w-80 h-80 rounded-full bg-indigo-500/20 blur-[100px]" />
        <div className="absolute left-1/2 bottom-0 w-72 h-72 rounded-full bg-emerald-500/10 blur-[100px]" />
      </div>

      {/* Header */}
      <header className="rounded-2xl p-6 mb-8 shadow-xl
        bg-white/40 dark:bg-white/10 backdrop-blur-xl border border-white/20
        flex flex-col lg:flex-row justify-between items-center gap-4">

        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 flex items-center justify-center text-3xl font-black shadow-neon">
            SG
          </div>
          <div>
            <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600">
              Smart Grid Dashboard
            </h1>
            <p className="text-sm mt-1 opacity-70">Real-time Energy Monitoring</p>
          </div>
        </div>

        {/* ── Button bar: Disconnected → Export buttons → Light/Dark ── */}
        {/* ── Button bar: 2-row grid layout ── */}
        <div className="flex flex-col gap-2">
          {/* Row 1: timestamp + status + 4 PNG export buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm opacity-80">{loading ? "Loading…" : data.Timestamp}</p>

            {/* 1. Connection status */}
            <span className={`px-4 py-2 rounded-lg font-bold flex items-center gap-2 border
      ${status === "Connected"
                ? "bg-emerald-100 text-emerald-800 border-emerald-400"
                : "bg-rose-100 text-rose-800 border-rose-400"}`}>
              <span className={`w-2 h-2 rounded-full ${status === "Connected" ? "bg-emerald-500" : "bg-rose-500"} animate-pulse`} />
              {status}
            </span>

            {/* 2. Export Voltage PNG */}
            <button className="px-4 py-2 rounded-xl bg-blue-600 text-white shadow-md hover:scale-105 transition-transform"
              onClick={() => exportChartPNG("chartVoltage", "voltage_chart", "#2563eb")}>
              Export Voltage PNG
            </button>

            {/* 3. Export Current PNG */}
            <button className="px-4 py-2 rounded-xl bg-purple-600 text-white shadow-md hover:scale-105 transition-transform"
              onClick={() => exportChartPNG("chartCurrent", "current_chart", "#9333ea")}>
              Export Current PNG
            </button>

            {/* 4. Export Power PNG */}
            <button className="px-4 py-2 rounded-xl bg-pink-600 text-white shadow-md hover:scale-105 transition-transform"
              onClick={() => exportChartPNG("chartPower", "power_chart", "#db2777")}>
              Export Power PNG
            </button>

            {/* 5. Export Street PNG */}
            <button className="px-4 py-2 rounded-xl bg-emerald-600 text-white shadow-md hover:scale-105 transition-transform"
              onClick={() => exportChartPNG("chartStreet", "street_chart", "#059669")}>
              Export Street PNG
            </button>
          </div>

          {/* Row 2: spacer + CSV below Voltage PNG + Dark below Current PNG */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Spacer to align with timestamp + status (approx width) */}
            <div className="invisible px-4 py-2">placeholder</div>
            <div className="invisible px-4 py-2 border">placeholder</div>

            {/* 6. Export Data CSV — aligns under Export Voltage PNG */}
            <button className="px-4 py-2 rounded-xl bg-indigo-600 text-white shadow-md hover:scale-105 transition-transform"
              onClick={() => exportCSV(window.__SMARTGRID_CSV__)}>
              Export Data CSV
            </button>

            {/* 7. Light / Dark toggle — aligns under Export Current PNG */}
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="px-3 py-2 rounded-lg bg-slate-300 dark:bg-slate-800 hover:scale-105 transition-all"
            >
              {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
            </button>
          </div>
        </div>
      </header>

      {/* Main layout */}
      <main className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-stretch">

        <section className="lg:col-span-3 space-y-6">

          {/* ── 3-Phase KPI cards ── */}
          <div className="rounded-2xl p-4 bg-white/20 dark:bg-white/5 border border-white/20 space-y-4">
            <h2 className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400 tracking-widest">⚡ 3-Phase Metrics</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {voltageCards.map((c, i) => <SmallCard key={i} {...c} />)}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {currentCards.map((c, i) => <SmallCard key={i} {...c} />)}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {powerCards.map((c, i) => <SmallCard key={i} {...c} />)}
            </div>
          </div>

          {/* ── Street / Grid KPI cards ── */}
          <div className="rounded-2xl p-4 bg-white/20 dark:bg-white/5 border border-white/20 space-y-4">
            <h2 className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400 tracking-widest">🏙️ Street / Grid Metrics</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              {streetCards.map((c, i) => <SmallCard key={i} {...c} />)}
            </div>
          </div>

          {/* ── Voltage Chart ── */}
          <ChartPanel
            id="chartVoltage"
            title="Voltage Trend"
            titleClass="bg-gradient-to-r from-blue-500 to-purple-500"
            keys={vKeys}
            filterOptions={vFilterOpts}
            data={voltageHist}
            yLabel="Voltage (V)"
            yUnit="V"
            refVal={230}
            yMax={300}
          />

          {/* ── Current Chart ── */}
          <ChartPanel
            id="chartCurrent"
            title="Current Trend"
            titleClass="bg-gradient-to-r from-purple-500 to-pink-500"
            keys={iKeys}
            filterOptions={iFilterOpts}
            data={currentHist}
            yLabel="Current (A)"
            yUnit="A"
            refVal={null}
            yMax={20}
          />

          {/* ── Power Chart ── */}
          <ChartPanel
            id="chartPower"
            title="Power Trend"
            titleClass="bg-gradient-to-r from-pink-500 to-orange-500"
            keys={pKeys}
            filterOptions={pFilterOpts}
            data={powerHist}
            yLabel="Power (W)"
            yUnit="W"
            refVal={null}
            yMax={5000}
          />

          {/* ── Street Chart (V & I on same axis) ── */}
          <ChartPanel
            id="chartStreet"
            title="Street / Grid Trend"
            titleClass="bg-gradient-to-r from-emerald-500 to-teal-500"
            keys={stVIKeys}
            filterOptions={null}
            data={streetHist}
            yLabel="V / A"
            yUnit=""
            refVal={null}
            yMax={300}
          />

          {/* ── Street PF & Frequency Chart ── */}
          <ChartPanel
            id="chartStreetPF"
            title="Street Power · PF · Frequency"
            titleClass="bg-gradient-to-r from-teal-500 to-cyan-500"
            keys={stPFKeys}
            filterOptions={null}
            data={streetHist}
            yLabel="W / PF / Hz"
            yUnit=""
            refVal={50}
            yMax={5000}
          />

        </section>

        {/* Event log sidebar */}
        <aside className="lg:col-span-1 flex flex-col">
          <EventLog events={events} />
        </aside>

      </main>
    </div>
  );
}