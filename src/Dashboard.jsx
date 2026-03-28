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
   IQR-BASED OUTLIER REMOVAL
===================================================================== */
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
   THEME-AWARE TOP-RIGHT LEGEND — compact, perfectly anchored
===================================================================== */
const TopRightLegend = ({ keys, isDark }) => {
  const bg = isDark ? "rgba(15,23,42,0.75)" : "rgba(255,255,255,0.88)";
  const border = isDark ? "rgba(148,163,184,0.20)" : "rgba(100,116,139,0.25)";
  const text = isDark ? "#cbd5e1" : "#334155";
  const shadow = isDark ? "0 2px 10px rgba(0,0,0,0.50)" : "0 2px 8px rgba(0,0,0,0.10)";
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 3,
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 6,
      padding: "4px 8px",
      fontSize: 10,
      lineHeight: 1.5,
      boxShadow: shadow,
      backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
      minWidth: 68,
    }}>
      {keys.map(k => (
        <div key={k.dataKey} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{
            display: "inline-block",
            width: 16,
            height: 2.5,
            background: k.color,
            borderRadius: 2,
            flexShrink: 0,
          }} />
          <span style={{ color: text, fontWeight: 600, whiteSpace: "nowrap" }}>{k.name}</span>
        </div>
      ))}
    </div>
  );
};

/* =====================================================================
   GENERIC CHART COMPONENT
===================================================================== */
const Charts = React.memo(function Charts({
  keys, data, yLabel, yUnit, refVal, filter = "all", yMin = 0, yMax = Infinity, isDark
}) {
  const [zoomDomain, setZoomDomain] = useState(null);
  const zoomRef = useRef(zoomDomain);
  zoomRef.current = zoomDomain;

  const chartData = useMemo(() => data.map(d => {
    const point = { time: new Date(d.t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) };
    keys.forEach(k => { point[k.dataKey] = d[k.dataKey] ?? null; });
    return point;
  }), [data, keys]);

  /* Fixed domain: always [yMin, yMax] — strict, no auto-scaling */
  const fixedDomain = useMemo(() => [yMin, yMax === Infinity ? "auto" : yMax], [yMin, yMax]);
  const yDomain = zoomDomain ?? fixedDomain;

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const [lo, hi] = zoomRef.current ?? fixedDomain;
    const hiNum = hi === "auto" ? lo + 100 : hi;
    const range = hiNum - lo, center = (lo + hiNum) / 2;
    const factor = e.deltaY < 0 ? 0.85 : 1.18;
    const newRange = range * factor;
    setZoomDomain([+(center - newRange / 2).toFixed(3), +(center + newRange / 2).toFixed(3)]);
  }, [fixedDomain]);

  const dragRef = useRef({ active: false, startY: 0, startDomain: null });
  const handleMouseDown = useCallback((e) => {
    if (!e.shiftKey) return;
    e.preventDefault();
    dragRef.current = { active: true, startY: e.clientY, startDomain: zoomRef.current ?? fixedDomain };
  }, [fixedDomain]);
  const handleMouseMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const [lo, hi] = drag.startDomain;
    const hiNum = hi === "auto" ? lo + 100 : hi;
    const range = hiNum - lo;
    const valueDelta = ((drag.startY - e.clientY) / 250) * range;
    setZoomDomain([+(lo + valueDelta).toFixed(3), +(hiNum + valueDelta).toFixed(3)]);
  }, []);
  const handleMouseUp = useCallback(() => { dragRef.current.active = false; }, []);

  const opacityFor = (key) => (!filter || filter === "all") ? 1 : filter === key ? 1 : 0.15;
  const yTickFmt = (v) => typeof v === "number" ? `${v.toFixed(2)}${yUnit}` : v;

  const axisColor = isDark ? "#64748b" : "#94a3b8";
  const tickColor = isDark ? "#94a3b8" : "#64748b";
  const gridColor = isDark ? "#94a3b8" : "#cbd5e1";
  const hintColor = isDark ? "#94a3b8" : "#64748b";

  return (
    <div style={{ position: "relative" }}>
      {/* Zoom hint + reset bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: hintColor }}>🖱 Scroll to zoom Y · Shift+drag to pan</span>
        {zoomDomain && (
          <>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#6366f1", background: "rgba(99,102,241,0.12)", borderRadius: 6, padding: "2px 8px" }}>
              Y: {zoomDomain[0]}{yUnit} – {zoomDomain[1]}{yUnit}
            </span>
            <button onClick={() => setZoomDomain(null)} style={{
              fontSize: 10, cursor: "pointer", background: "rgba(239,68,68,0.15)", color: "#f87171",
              border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "2px 8px", fontWeight: 600
            }}>Reset Zoom</button>
          </>
        )}
      </div>

      {/* TOP-RIGHT LEGEND OVERLAY — sits inside top-right of chart area */}
      <div style={{ position: "absolute", top: 28, right: 20, zIndex: 10, pointerEvents: "none" }}>
        <TopRightLegend keys={keys} isDark={isDark} />
      </div>

      <div
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: "crosshair", userSelect: "none" }}
      >
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData} margin={{ top: 6, right: 18, bottom: 4, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} opacity={0.22} />
            <XAxis
              dataKey="time"
              stroke={axisColor}
              tick={{ fontSize: 10, fill: tickColor }}
              minTickGap={40}
              tickLine={false}
            />
            <YAxis
              stroke={axisColor}
              domain={yDomain}
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
              />
            ))}
            <Brush dataKey="time" height={20} stroke="#6366f1" fill="rgba(99,102,241,0.08)" travellerWidth={8} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* "Time →" label sits flush-right below the Brush bar, never overlapping it */}
      <div style={{
        textAlign: "right",
        paddingRight: 18,
        marginTop: 2,
        fontSize: 10,
        color: axisColor,
        userSelect: "none",
        pointerEvents: "none",
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
      <div className="flex items-center justify-between mb-2">
        <h3 className={`text-lg font-bold bg-clip-text text-transparent ${titleClass}`}>{title}</h3>
        {filterOptions && (
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className={selectCls}>
            {filterOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </div>
      <Charts
        keys={keys} data={data} yLabel={yLabel} yUnit={yUnit}
        refVal={refVal} filter={filter} yMin={yMin} yMax={yMax} isDark={isDark}
      />
    </div>
  );
}

/* =====================================================================
   PNG EXPORT — canvas drawn, legend INSIDE top-right of plot area
===================================================================== */
const exportChartPNG = (chartData, keys, yDomain, yUnit, yLabel, title, filename, accentColor) => {
  const W = 1000, H = 460;
  /*
   * margin.top = 56  → enough room for title (drawn at y=30) + legend card below it
   * margin.right = 16 → tight; legend lives in the TOP-RIGHT of the canvas header,
   *                     NOT inside the plot area, so right margin can stay small
   */
  const margin = { top: 56, right: 16, bottom: 60, left: 84 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;

  const canvas = document.createElement("canvas");
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);

  /* ── white background ── */
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  /* ══════════════════════════════════════════════════════════════
     LEGEND — top-right corner of the canvas, in the header zone,
     completely ABOVE the plot area and flush with the right edge.
     Drawn FIRST so title renders on top if they ever overlap.
  ══════════════════════════════════════════════════════════════ */
  const LEGEND_ROW_H = 18;   // height per legend row
  const LEGEND_PAD_X = 10;   // horizontal inner padding
  const LEGEND_PAD_Y = 7;    // vertical inner padding
  const SWATCH_W = 20;   // coloured line swatch width
  const SWATCH_GAP = 6;    // gap between swatch and label text
  const LEGEND_FONT = 10;   // font size (px)
  const LEGEND_MARGIN = 12;   // gap from canvas right & top edges

  ctx.font = `600 ${LEGEND_FONT}px system-ui, sans-serif`;
  const maxTextW = Math.max(...keys.map(k => ctx.measureText(k.name).width));
  const boxW = LEGEND_PAD_X * 2 + SWATCH_W + SWATCH_GAP + maxTextW + 2;
  const boxH = LEGEND_PAD_Y * 2 + keys.length * LEGEND_ROW_H - (LEGEND_ROW_H - 14);

  /* anchor: top-right of canvas with a small margin */
  const bx = W - LEGEND_MARGIN - boxW;   // flush to canvas right edge
  const by = LEGEND_MARGIN;              // flush to canvas top edge

  /* card shadow */
  ctx.shadowColor = "rgba(0,0,0,0.10)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;

  /* card background + border */
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  const R = 5;
  ctx.beginPath();
  ctx.moveTo(bx + R, by);
  ctx.lineTo(bx + boxW - R, by);
  ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + R);
  ctx.lineTo(bx + boxW, by + boxH - R);
  ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - R, by + boxH);
  ctx.lineTo(bx + R, by + boxH);
  ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - R);
  ctx.lineTo(bx, by + R);
  ctx.quadraticCurveTo(bx, by, bx + R, by);
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
  ctx.stroke();

  /* legend rows */
  keys.forEach((k, idx) => {
    const rowY = by + LEGEND_PAD_Y + idx * LEGEND_ROW_H;
    const lineY = rowY + 7;

    /* coloured swatch line */
    ctx.strokeStyle = k.color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(bx + LEGEND_PAD_X, lineY);
    ctx.lineTo(bx + LEGEND_PAD_X + SWATCH_W, lineY);
    ctx.stroke();

    /* label */
    ctx.font = `600 ${LEGEND_FONT}px system-ui, sans-serif`;
    ctx.fillStyle = "#1e293b";
    ctx.textAlign = "left";
    ctx.fillText(k.name, bx + LEGEND_PAD_X + SWATCH_W + SWATCH_GAP, lineY + 3);
  });

  ctx.setLineDash([]); ctx.lineCap = "butt";

  /* ── title (top-left, drawn after legend so it's always visible) ── */
  ctx.font = "bold 15px system-ui, sans-serif";
  ctx.fillStyle = accentColor;
  ctx.textAlign = "left";
  ctx.fillText(title, margin.left, 32);

  /* ── y-axis rotated label ── */
  ctx.save();
  ctx.translate(16, margin.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = "#64748b";
  ctx.textAlign = "center";
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  /* ── x-axis label (bottom-right of plot) ── */
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = "#64748b";
  ctx.textAlign = "right";
  ctx.fillText("Time →", margin.left + plotW, H - 10);

  /* ── y scale ── */
  const [yMin, yMax2] = Array.isArray(yDomain) ? yDomain : [0, 100];
  const yRange = (yMax2 - yMin) || 1;
  const toY = v => margin.top + plotH - ((v - yMin) / yRange) * plotH;

  /* ── grid lines + y-tick labels ── */
  const TICK_COUNT = 5;
  for (let i = 0; i <= TICK_COUNT; i++) {
    const val = yMin + (yRange * i) / TICK_COUNT;
    const y = toY(val);
    ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(margin.left + plotW, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "right";
    ctx.fillText(`${val.toFixed(2)}${yUnit}`, margin.left - 6, y + 4);
  }

  /* ── x-tick labels ── */
  if (chartData.length > 1) {
    const step = Math.max(1, Math.floor(chartData.length / 8));
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "center";
    for (let i = 0; i < chartData.length; i += step) {
      const x = margin.left + (i / (chartData.length - 1)) * plotW;
      ctx.fillText(chartData[i].time, x, margin.top + plotH + 18);
    }
  }

  /* ── axis lines ── */
  ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 1.5; ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotH);
  ctx.lineTo(margin.left + plotW, margin.top + plotH);
  ctx.stroke();

  /* ── data lines ── */
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

  const emptyData = {
    Va: 0, Vb: 0, Vc: 0, Ia: 0, Ib: 0, Ic: 0,
    Pa: 0, Pb: 0, Pc: 0, St_V: 0, St_I: 0, St_P: 0, St_PF: 0, St_F: 0,
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
    document.documentElement.classList.toggle("dark", isDark);
    localStorage.setItem("theme", theme);
  }, [theme, isDark]);

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

      const V_MAX = 300, I_MAX = 20, P_MAX = 5000, PF_MAX = 1, F_MAX = 70;
      const gate = (v, lo, hi) => { const n = Number(v) || 0; return (n >= lo && n <= hi) ? n : null; };

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
      if (changed && hasData)
        setEvents(p => [{ msg: "Data updated", time: Date.now(), level: "success" }, ...p].slice(0, MAX_EVENTS));

      setData(newData);
      prevDataRef.current = newData;
      const now = Date.now();
      setVoltageHist(p => [...p.slice(-MAX_HISTORY), { t: now, Va: newData.Va, Vb: newData.Vb, Vc: newData.Vc }]);
      setCurrentHist(p => [...p.slice(-MAX_HISTORY), { t: now, Ia: newData.Ia, Ib: newData.Ib, Ic: newData.Ic }]);
      setPowerHist(p => [...p.slice(-MAX_HISTORY), { t: now, Pa: newData.Pa, Pb: newData.Pb, Pc: newData.Pc }]);
      setStreetHist(p => [...p.slice(-MAX_HISTORY), { t: now, St_V: newData.St_V, St_I: newData.St_I, St_P: newData.St_P, St_PF: newData.St_PF, St_F: newData.St_F }]);

      if (text && text.length > 10) window.__SMARTGRID_CSV__ = text;
      setLoading(false);
    } catch { setStatus("Disconnected"); setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchData]);

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

  /* ── chart keys ── */
  const vKeys = [{ dataKey: "Va", name: "V_R", color: "#3b82f6" }, { dataKey: "Vb", name: "V_Y", color: "#06b6d4" }, { dataKey: "Vc", name: "V_B", color: "#f59e0b" }];
  const iKeys = [{ dataKey: "Ia", name: "I_R", color: "#3b82f6" }, { dataKey: "Ib", name: "I_Y", color: "#06b6d4" }, { dataKey: "Ic", name: "I_B", color: "#f59e0b" }];
  const pKeys = [{ dataKey: "Pa", name: "P_R", color: "#ec4899" }, { dataKey: "Pb", name: "P_Y", color: "#8b5cf6" }, { dataKey: "Pc", name: "P_B", color: "#f59e0b" }];
  const stVIKeys = [{ dataKey: "St_V", name: "DER V", color: "#10b981" }, { dataKey: "St_I", name: "DER I", color: "#06b6d4" }];
  const stPFKeys = [{ dataKey: "St_P", name: "DER Power", color: "#10b981" }, { dataKey: "St_PF", name: "DER PF", color: "#f59e0b" }, { dataKey: "St_F", name: "DER Freq", color: "#ec4899" }];

  const vFilterOpts = [{ value: "all", label: "All Phases" }, { value: "Va", label: "Phase R (Va)" }, { value: "Vb", label: "Phase Y (Vb)" }, { value: "Vc", label: "Phase B (Vc)" }];
  const iFilterOpts = [{ value: "all", label: "All Phases" }, { value: "Ia", label: "Phase R (Ia)" }, { value: "Ib", label: "Phase Y (Ib)" }, { value: "Ic", label: "Phase B (Ic)" }];
  const pFilterOpts = [{ value: "all", label: "All Phases" }, { value: "Pa", label: "Phase R (Pa)" }, { value: "Pb", label: "Phase Y (Pb)" }, { value: "Pc", label: "Phase B (Pc)" }];

  /* ── export helpers ── */
  const buildChartData = (hist, keys) => hist.map(d => {
    const p = { time: new Date(d.t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) };
    keys.forEach(k => { p[k.dataKey] = d[k.dataKey] ?? null; });
    return p;
  });
  const getAutoDomain = (hist, keys, yMax) => {
    const vals = hist.flatMap(d => keys.map(k => d[k.dataKey])).filter(v => v !== null && !isNaN(v) && v > 0);
    return cleanBounds(vals, 0.08, yMax);
  };

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

      {/* ══ HEADER ══ */}
      <header className={`rounded-2xl px-6 py-4 mb-6 shadow-xl backdrop-blur-xl border border-white/20
        ${isDark ? "bg-white/10" : "bg-white/70"}`}>

        {/* Row 1 */}
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600
              flex items-center justify-center text-xl font-black text-white shadow-md flex-shrink-0">SG</div>
            <div>
              <h1 className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600 leading-tight">
                Smart Grid Dashboard
              </h1>
              <p className={`text-xs ${isDark ? "opacity-60" : "opacity-50"}`}>Real-time Energy Monitoring</p>
            </div>
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
          {[
            {
              label: "⬇ Voltage PNG", bg: "bg-blue-600 hover:bg-blue-700",
              fn: () => exportChartPNG(buildChartData(voltageHist, vKeys), vKeys, getAutoDomain(voltageHist, vKeys, 300), "V", "Voltage (V)", "Three Phase Voltage", "three_phase_voltage", "#2563eb")
            },
            {
              label: "⬇ Current PNG", bg: "bg-purple-600 hover:bg-purple-700",
              fn: () => exportChartPNG(buildChartData(currentHist, iKeys), iKeys, getAutoDomain(currentHist, iKeys, 20), "A", "Current (A)", "Three Phase Current", "three_phase_current", "#9333ea")
            },
            {
              label: "⬇ Power PNG", bg: "bg-pink-600 hover:bg-pink-700",
              fn: () => exportChartPNG(buildChartData(powerHist, pKeys), pKeys, getAutoDomain(powerHist, pKeys, 5000), "W", "Power (W)", "Three Phase Power", "three_phase_power", "#db2777")
            },
            {
              label: "⬇ DER V&I PNG", bg: "bg-emerald-600 hover:bg-emerald-700",
              fn: () => exportChartPNG(buildChartData(streetHist, stVIKeys), stVIKeys, getAutoDomain(streetHist, stVIKeys, 300), "", "V / A", "DER (Rooftop) Voltage & Current", "der_voltage_current", "#059669")
            },
            {
              label: "⬇ DER PF PNG", bg: "bg-teal-600 hover:bg-teal-700",
              fn: () => exportChartPNG(buildChartData(streetHist, stPFKeys), stPFKeys, getAutoDomain(streetHist, stPFKeys, 5000), "", "W / PF / Hz", "DER (Rooftop) Power · PF · Frequency", "der_power_pf_freq", "#0d9488")
            },
          ].map(btn => (
            <button key={btn.label} onClick={btn.fn}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm hover:scale-105 transition-all ${btn.bg}`}>
              {btn.label}
            </button>
          ))}
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

          <ChartPanel id="chartVoltage" title="Three Phase Voltages"
            titleClass="bg-gradient-to-r from-blue-500 to-purple-500"
            keys={vKeys} filterOptions={vFilterOpts} data={voltageHist}
            yLabel="Voltage (V)" yUnit="V" refVal={230} yMin={0} yMax={300} isDark={isDark} />

          <ChartPanel id="chartCurrent" title="Three Phase Currents"
            titleClass="bg-gradient-to-r from-purple-500 to-pink-500"
            keys={iKeys} filterOptions={iFilterOpts} data={currentHist}
            yLabel="Current (A)" yUnit="A" refVal={null} yMin={0} yMax={20} isDark={isDark} />

          <ChartPanel id="chartPower" title="Three Phase Powers"
            titleClass="bg-gradient-to-r from-pink-500 to-orange-500"
            keys={pKeys} filterOptions={pFilterOpts} data={powerHist}
            yLabel="Power (W)" yUnit="W" refVal={null} yMin={0} yMax={5000} isDark={isDark} />

          {/* DER V&I: Street_V is ~48–53V, Street_I is 0–20A.
              Show 0–60 so both series are readable on the same axis. */}
          <ChartPanel id="chartStreet" title="DER (Rooftop) Voltage & Current"
            titleClass="bg-gradient-to-r from-emerald-500 to-teal-500"
            keys={stVIKeys} filterOptions={null} data={streetHist}
            yLabel="V / A" yUnit="" refVal={null} yMin={0} yMax={60} isDark={isDark} />

          {/* DER PF/Power/Freq: Street_PF 0–1, Street_F ~50Hz, Street_P 0–5000W.
              Strict 0–1 range as requested — only PF is visible at this scale.
              Power & Freq values outside 0–1 will be clipped (expected). */}
          <ChartPanel id="chartStreetPF" title="DER (Rooftop) Power · PF · Frequency"
            titleClass="bg-gradient-to-r from-teal-500 to-cyan-500"
            keys={stPFKeys} filterOptions={null} data={streetHist}
            yLabel="PF" yUnit="" refVal={null} yMin={0} yMax={1} isDark={isDark} />

        </section>
        <aside className="lg:col-span-1 flex flex-col"><EventLog events={events} /></aside>
      </main>
    </div>
  );
}