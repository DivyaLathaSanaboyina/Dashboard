// Dashboard.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush
} from "recharts";
import Papa from "papaparse";
import { saveAs } from "file-saver";
import html2canvas from "html2canvas";

/* ========== CONFIG ========== */
const SHEET_ID = "1C2BWZbJ1HJzzqkIuHrvH8OnrT9PbFKVCdaD-40jj9bw";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;
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
const Charts = React.memo(function Charts({ type, data, filter = "all" }) {
  const chartData = useMemo(() => data.map(d => ({
    time: new Date(d.t).toLocaleTimeString(),
    Va: d.Va, Vb: d.Vb, Vc: d.Vc,
    Ia: d.Ia, Ib: d.Ib, Ic: d.Ic
  })), [data]);

  // decide opacity for keys (show selected at 1, others at 0.2)
  const opacityFor = (key) => {
    if (!filter || filter === "all") return 1;
    return filter === key ? 1 : 0.2;
  };

  return (
    <ResponsiveContainer width="100%" height={330}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
        <XAxis dataKey="time" stroke="#64748b" minTickGap={20} />
        <YAxis stroke="#64748b" />
        <Tooltip contentStyle={{ backgroundColor: "rgba(255,255,255,0.8)", borderRadius: 10 }} />
        <Legend />

        {type === "voltage" ? (
          <>
            <Line type="monotone" dataKey="Va" stroke="#3b82f6" strokeWidth={3} dot={false} name="V_R" strokeOpacity={opacityFor("Va")} />
            <Line type="monotone" dataKey="Vb" stroke="#06b6d4" strokeWidth={3} dot={false} name="V_Y" strokeOpacity={opacityFor("Vb")} />
            <Line type="monotone" dataKey="Vc" stroke="#f59e0b" strokeWidth={3} dot={false} name="V_B" strokeOpacity={opacityFor("Vc")} />
          </>
        ) : (
          <>
            <Line type="monotone" dataKey="Ia" stroke="#3b82f6" strokeWidth={3} dot={false} name="I_R" strokeOpacity={opacityFor("Ia")} />
            <Line type="monotone" dataKey="Ib" stroke="#06b6d4" strokeWidth={3} dot={false} name="I_Y" strokeOpacity={opacityFor("Ib")} />
            <Line type="monotone" dataKey="Ic" stroke="#f59e0b" strokeWidth={3} dot={false} name="I_B" strokeOpacity={opacityFor("Ic")} />
          </>
        )}

        <Brush dataKey="time" height={26} stroke="#6366f1" />
      </LineChart>
    </ResponsiveContainer>
  );
});

/* =====================================================================
   EVENT LOG
===================================================================== */
function EventLog({ events, collapsed, setCollapsed }) {
  return (
    <div className="
      rounded-2xl p-6 
      bg-white/10 dark:bg-white/5 
      border border-white/20 backdrop-blur-xl
      shadow-xl flex flex-col h-full
    ">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-purple-600">
          Event Log
        </h3>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="px-3 py-1 text-sm rounded-lg bg-slate-300 dark:bg-slate-800 hover:bg-slate-600 transition"
        >
          {collapsed ? "Show" : "Hide"}
        </button>
      </div>

      <div
        className={`
          transition-all overflow-y-auto 
          ${collapsed ? "max-h-0 opacity-0" : "max-h-[600px] opacity-100"}
        `}
      >
        {events.length === 0 ? (
          <p className="text-slate-300 dark:text-slate-400">No events yet.</p>
        ) : (
          events.map((e, i) => (
            <div
              key={i}
              className="bg-emerald-100/40 dark:bg-emerald-300/10 p-4 rounded-lg border-l-4 border-emerald-500 mb-3"
            >
              <p className="text-emerald-700 dark:text-emerald-300 font-medium">{e.msg}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{e.timestamp}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* =====================================================================
   🔧 FIXED EXPORT FUNCTIONS (ONLY CODE MODIFIED)
===================================================================== */
const exportPNG = async () => {
  const el = document.getElementById("chartCapture");
  if (!el) return alert("Voltage chart not ready!");

  await new Promise(res => setTimeout(res, 200));

  html2canvas(el, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true
  }).then(canvas => {
    canvas.toBlob(blob => saveAs(blob, `voltage_chart_${Date.now()}.png`));
  });
};

const exportPNGCurrent = async () => {
  const el = document.getElementById("chartCaptureCurrent");
  if (!el) return alert("Current chart not ready!");

  await new Promise(res => setTimeout(res, 200));

  html2canvas(el, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true
  }).then(canvas => {
    canvas.toBlob(blob => saveAs(blob, `current_chart_${Date.now()}.png`));
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
      if (!parsed.data.length) return;

      const row = parsed.data[parsed.data.length - 1];
      const rawIdentifier = JSON.stringify(row);

      if (prevRawRef.current === rawIdentifier) {
        setLoading(false);
        return;
      }

      prevRawRef.current = rawIdentifier;

      const newData = {
        Va: row["V_R"] || 0,
        Vb: row["V_Y"] || 0,
        Vc: row["V_B"] || 0,
        Ia: row["I_R"] || 0,
        Ib: row["I_Y"] || 0,
        Ic: row["I_B"] || 0,
        Pa: row["P_R"] || 0,
        Pb: row["P_Y"] || 0,
        Pc: row["P_B"] || 0,
        
        Timestamp: formatTS(row["Timestamp"])
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
          { msg: "Data updated", timestamp: newData.Timestamp },
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
      <main className="grid grid-cols-1 lg:grid-cols-4 gap-6">

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
          <div id="chartCapture" className="rounded-2xl p-6 bg-white/40 dark:bg-white/10 backdrop-blur-xl border border-white/20 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-purple-500">Voltage Trend</h3>

              {/* Voltage filter dropdown (glass style) */}
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

          <div id="chartCaptureCurrent" className="rounded-2xl p-6 bg-white/40 dark:bg-white/10 backdrop-blur-xl border border-white/20 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-500 to-pink-500">Current Trend</h3>

              {/* Current filter dropdown */}
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

        <aside className="lg:col-span-1">
          <EventLog events={events} collapsed={collapsed} setCollapsed={setCollapsed} />
        </aside>

      </main>
    </div>
  );
}
