import React, { useCallback, useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import Papa from "papaparse";
import { saveAs } from "file-saver";
import html2canvas from "html2canvas";


const SHEET_ID = "1CWpoTgej0Av9q4PFzJeLRzkA78ia_TOxGnn0gWS4Ctc";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;
const POLL_INTERVAL = 5000;

// Small Card
function SmallCard({ label, value, unit, big }) {
  return (
    <div className={`bg-white rounded-xl p-6 shadow-md border border-gray-200 hover:shadow-xl hover:scale-105 hover:-translate-y-1 transition-all duration-300 cursor-pointer group ${big ? 'ring-2 ring-blue-500 ring-offset-2' : ''}`}>
      <p className="text-gray-600 text-sm font-semibold mb-2 uppercase tracking-wide group-hover:text-blue-600 transition-colors">
        {label}
      </p>
      <div className="flex items-baseline gap-2">
        <p className={`font-black bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent ${big ? 'text-4xl' : 'text-3xl'}`}>
          {value}
        </p>
        <span className="text-gray-500 text-lg font-semibold">{unit}</span>
      </div>
      <div className="mt-3 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 rounded-full transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 shadow-lg"></div>
    </div>
  );
}

// Charts
function Charts({ type, data }) {
  const chartData = data.map(d => ({
    time: new Date(d.t).toLocaleTimeString(),
    ...(type === "voltage" ? { Va: d.Va, Vb: d.Vb, Vc: d.Vc } : { Ia: d.Ia, Ib: d.Ib, Ic: d.Ic })
  }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.5} />
        <XAxis dataKey="time" stroke="#6b7280" style={{ fontSize: '11px', fontWeight: '600' }} />
        <YAxis stroke="#6b7280" style={{ fontSize: '11px', fontWeight: '600' }} />
        <Tooltip contentStyle={{ backgroundColor: 'rgba(255,255,255,0.98)', borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }} />
        <Legend wrapperStyle={{ paddingTop: '20px' }} />
        {type === "voltage" ? (
          <>
            <Line type="monotone" dataKey="Va" stroke="#3b82f6" strokeWidth={3} dot={false} name="Phase A (V)" />
            <Line type="monotone" dataKey="Vb" stroke="#10b981" strokeWidth={3} dot={false} name="Phase B (V)" />
            <Line type="monotone" dataKey="Vc" stroke="#f59e0b" strokeWidth={3} dot={false} name="Phase C (V)" />
          </>
        ) : (
          <>
            <Line type="monotone" dataKey="Ia" stroke="#3b82f6" strokeWidth={3} dot={false} name="Current A (A)" />
            <Line type="monotone" dataKey="Ib" stroke="#10b981" strokeWidth={3} dot={false} name="Current B (A)" />
            <Line type="monotone" dataKey="Ic" stroke="#f59e0b" strokeWidth={3} dot={false} name="Current C (A)" />
          </>
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

// Event Log
function EventLog({ events }) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-md border border-gray-200 h-full">
      <div className="flex items-center gap-2 mb-5">
        <div className="w-2 h-8 bg-gradient-to-b from-blue-500 to-purple-500 rounded-full"></div>
        <h3 className="text-xl font-black bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent">Event Log</h3>
      </div>
      <div className="space-y-3 max-h-full overflow-y-auto">
        {events.length === 0 ? (
          <p className="text-gray-500 text-center py-10">No events yet...</p>
        ) : (
          events.map((e, i) => (
            <div key={i} className="bg-gradient-to-r from-emerald-50 to-teal-50 border-l-4 border-green-500 p-4 rounded-lg hover:shadow-md transition-all">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <p className="text-green-700 font-bold text-sm">{e.msg}</p>
              </div>
              <p className="text-gray-500 text-xs ml-4">{new Date(e.time).toLocaleString()}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState({
    Va: 0, Vb: 0, Vc: 0,
    Ia: 0, Ib: 0, Ic: 0,
    Pa: 0, Pb: 0, Pc: 0, totalP: 0,
    Qa: 0, Qb: 0, Qc: 0, totalQ: 0,
    PVa: 0, PVb: 0, PVc: 0, totalPV: 0,
    Energy: 0, VUF: 0, Frequency: 50
  });

  const [voltageHistory, setVoltageHistory] = useState([]);
  const [currentHistory, setCurrentHistory] = useState([]);
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("Connecting...");

// EXPORT PNG ---------------------------------------
  const exportPNGCurrent = async () => {
  const chartBlock = document.getElementById("chartCaptureCurrent");

  if (!chartBlock) {
    alert("No chart available to export");
    return;
  }

  const canvas = await html2canvas(chartBlock, {
    scale: 3,
    backgroundColor: "#ffffff"
  });

  canvas.toBlob((blob) => {
    saveAs(blob, "current_chart.png");
  });
};
// EXPORT PNG (Voltage)
const exportPNG = async () => {
  const chartBlock = document.getElementById("chartCapture");

  if (!chartBlock) {
    alert("No chart available to export");
    return;
  }

  try {
    const canvas = await html2canvas(chartBlock, {
      scale: 3,
      backgroundColor: "#ffffff"
    });

    canvas.toBlob((blob) => {
      if (!blob) return alert("Export failed");
      saveAs(blob, "voltage_chart.png");
    });
  } catch (err) {
    console.error("exportPNG error:", err);
    alert("Failed to export chart as PNG");
  }
};


  // EXPORT CSV ---------------------------------------
  const exportCSV = (csvText) => {
    saveAs(new Blob([csvText], { type: "text/csv;charset=utf-8" }), "smartgrid_data.csv");
  };



  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(CSV_URL);
      if (!res.ok) throw new Error("Failed");
      const text = await res.text();

      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: true });
      if (parsed.data.length === 0) return;

       // ⭐ STORE FOR EXPORT DATA BUTTON
      const originalCSV = text;



      const row = parsed.data[parsed.data.length - 1];

      const newData = {
        Va: row["SecLine1_V_A"] || 0,
        Vb: row["SecLine1_V_B"] || 0,
        Vc: row["SecLine1_V_C"] || 0,
        Ia: row["SecLine1_I_A"] || 0,
        Ib: row["SecLine1_I_B"] || 0,
        Ic: row["SecLine1_I_C"] || 0,
        Pa: row["SecLine1_P_A"] || 0,
        Pb: row["SecLine1_P_B"] || 0,
        Pc: row["SecLine1_P_C"] || 0,
        totalP: (row["SecLine1_P_A"] || 0) + (row["SecLine1_P_B"] || 0) + (row["SecLine1_P_C"] || 0),
        Qa: row["SecLine1_Q_A"] || 0,
        Qb: row["SecLine1_Q_B"] || 0,
        Qc: row["SecLine1_Q_C"] || 0,
        totalQ: (row["SecLine1_Q_A"] || 0) + (row["SecLine1_Q_B"] || 0) + (row["SecLine1_Q_C"] || 0),
        PVa: row["PV1_Injected_kW"] || 0,
        PVb: row["PV2_Injected_kW"] || 0,
        PVc: row["PV3_Injected_kW"] || 0,
        totalPV: (row["PV1_Injected_kW"] || 0) + (row["PV2_Injected_kW"] || 0) + (row["PV3_Injected_kW"] || 0),
        Energy: row["Set_kW"] || 0,
        VUF: row["SecLine1_VUF"] || 0,
        Frequency: row["Frequency_Hz"] || 50
      };

      setData(newData);
      setStatus("Connected");
      setEvents(prev => [{ msg: "Data updated", time: new Date().toISOString() }, ...prev].slice(0, 20));

      const now = Date.now();
      setVoltageHistory(prev => [...prev.slice(-500), { t: now, Va: newData.Va, Vb: newData.Vb, Vc: newData.Vc }]);
      setCurrentHistory(prev => [...prev.slice(-500), { t: now, Ia: newData.Ia, Ib: newData.Ib, Ic: newData.Ic }]);
    
    // ⭐ Save CSV for Export Button
      window.__SMARTGRID_CSV__ = originalCSV;


    
    } catch (err) {
      setStatus("Failed to load");
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);


  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50 p-6">
      {/* Header */}
      <div className="bg-white rounded-2xl shadow-xl p-6 mb-6 border border-gray-200">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center text-3xl font-black text-white shadow-lg">
              SG
            </div>
            <div>
              <h1 className="text-3xl font-black bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Smart Grid Dashboard</h1>
              <p className="text-indigo-600 text-sm font-bold uppercase tracking-wide">Real-time Energy Monitoring</p>
                          
            </div>
          </div>
          <div className="flex items-center gap-4">
            <p className="text-lg font-bold text-gray-700">{new Date().toLocaleString()}</p>
            <span className="px-4 py-2 bg-green-100 text-green-700 rounded-lg font-bold flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              {status}
            </span>

          {/* ⭐ ADDED EXPORT BUTTONS */}
            <button
  className="px-4 py-2 rounded-xl bg-blue-600 text-white font-bold shadow-md hover:bg-blue-700 transition"
  onClick={exportPNG}
>
  Export Voltage PNG
</button>

<button
  className="px-4 py-2 rounded-xl bg-purple-600 text-white font-bold shadow-md hover:bg-purple-700 transition"
  onClick={exportPNGCurrent}
>
  Export Current PNG
</button>
            <button
              className="px-4 py-2 rounded-xl bg-purple-600 text-white font-bold shadow-md hover:bg-purple-700 transition"
              onClick={() => exportCSV(window.__SMARTGRID_CSV__ || "")}
            >
              Export Data
            </button>
            {/* ⭐ END EXPORT BUTTONS */}
          </div>
        </div>
      </div>

      {/* MAIN GRID - Event Log on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* LEFT: All Content */}
        <div className="lg:col-span-3 space-y-6">
          {/* Cards */}
          <div className="grid grid-cols-3 gap-4">
            <SmallCard label="Phase A Voltage" value={data.Va.toFixed(1)} unit="V" />
            <SmallCard label="Phase B Voltage" value={data.Vb.toFixed(1)} unit="V" />
            <SmallCard label="Phase C Voltage" value={data.Vc.toFixed(1)} unit="V" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <SmallCard label="Phase A Current" value={data.Ia.toFixed(2)} unit="A" />
            <SmallCard label="Phase B Current" value={data.Ib.toFixed(2)} unit="A" />
            <SmallCard label="Phase C Current" value={data.Ic.toFixed(2)} unit="A" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <SmallCard label="Active Power A" value={data.Pa.toFixed(3)} unit="kW" />
            <SmallCard label="Active Power B" value={data.Pb.toFixed(3)} unit="kW" />
            <SmallCard label="Active Power C" value={data.Pc.toFixed(3)} unit="kW" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <SmallCard label="Reactive Power A" value={data.Qa.toFixed(3)} unit="kVAr" />
            <SmallCard label="Reactive Power B" value={data.Qb.toFixed(3)} unit="kVAr" />
            <SmallCard label="Reactive Power C" value={data.Qc.toFixed(3)} unit="kVAr" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <SmallCard label="PV Generation A" value={data.PVa.toFixed(3)} unit="kW" />
            <SmallCard label="PV Generation B" value={data.PVb.toFixed(3)} unit="kW" />
            <SmallCard label="PV Generation C" value={data.PVc.toFixed(3)} unit="kW" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <SmallCard label="Total Active Power" value={data.totalP.toFixed(3)} unit="kW" big />
            <SmallCard label="Total Reactive Power" value={data.totalQ.toFixed(3)} unit="kVAr" big />
            <SmallCard label="Total PV Generation" value={data.totalPV.toFixed(3)} unit="kW" big />
          </div>

          {/* Charts */}
          <div id="chartCapture" className="bg-white rounded-2xl p-6 shadow-xl border border-gray-200">
            <h3 className="text-2xl font-black mb-4 text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600">Voltage Trend</h3>
            <Charts type="voltage" data={voltageHistory} />
          </div>
          <div id="chartCaptureCurrent" className="bg-white rounded-2xl p-6 shadow-xl border border-gray-200">
            <h3 className="text-2xl font-black mb-4 text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-600">Current Trend</h3>
            <Charts type="current" data={currentHistory} />
          </div>

          {/* Bottom Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl p-6 text-center shadow-xl">
              <p className="text-white text-lg font-bold">Total Energy</p>
              <p className="text-white text-5xl font-black">{data.Energy.toFixed(2)} kWh</p>
            </div>
            <div className="bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl p-6 text-center shadow-xl">
              <p className="text-white text-lg font-bold">Frequency</p>
              <p className="text-white text-5xl font-black">{data.Frequency.toFixed(2)} Hz</p>
            </div>
            <div className="bg-gradient-to-br from-amber-500 to-red-600 rounded-xl p-6 text-center shadow-xl">
              <p className="text-white text-lg font-bold">VUF</p>
              <p className="text-white text-5xl font-black">{data.VUF.toFixed(2)} %</p>
            </div>
          </div>
        </div>

        {/* RIGHT: Event Log - Full Height */}
        <div className="lg:col-span-1">
          <EventLog events={events} />
        </div>
      </div>
    </div>
  );
}