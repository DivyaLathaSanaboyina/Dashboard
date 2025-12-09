import React from "react"; 
export default function SystemHealth({ pf = 0.98, vuf = 0.5, updateTime }) { 
// Voltage Quality Rating (1–5 stars) 
const voltageQuality = vuf < 1 ? 5 : vuf < 2 ? 4 : vuf < 3 ? 3 : 2; 
// System Health Score (0–100) 
const healthScore = Math.max(0, Math.min(100, 
100 
- (vuf * 12) // VUF penalty 
+ ((pf - 0.85) * 50) // PF reward 
)); 
// Status color 
const getStatus = () => { 
if (healthScore >= 90) return { txt: "Excellent", color: "text-green-600" }; 
if (healthScore >= 70) return { txt: "Good", color: "text-yellow-600" }; 
if (healthScore >= 50) return { txt: "Moderate", color: "text-orange-600" }; 
return { txt: "Poor", color: "text-red-600" }; 
}; 
const status = getStatus(); 
return ( 
<div className="card p-4 rounded-xl shadow-md"> 
<h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">System Health</h3> 
{/* Health Score */} 
<div className="mt-3 text-3xl font-bold value-change"> 
{healthScore.toFixed(0)} 
<span className="text-lg text-slate-600">/100</span> 
</div> 
<div className={`text-sm mt-1 font-medium ${status.color}`}> 
{status.txt} 
</div> 
{/* Power Factor */} 
<div className="mt-4"> 
<div className="text-xs text-slate-500 dark:text-slate-400">Power Factor</div> 
<div className="text-lg font-semibold">{pf.toFixed(2)}</div> 
</div> 
{/* Voltage Quality (Stars) */} 
<div className="mt-3"> 
<div className="text-xs text-slate-500 dark:text-slate-400">Voltage Quality</div> 
<div className="text-yellow-500 text-xl"> 
{"★".repeat(voltageQuality)} 
<span className="text-slate-400">{"★".repeat(5 - voltageQuality)}</span> 
</div> 
</div> 
{/* VUF */} 
<div className="mt-4"> 
<div className="text-xs text-slate-500 dark:text-slate-600">VUF</div> 
<div className="text-lg font-semibold">{vuf.toFixed(2)}%</div> 
</div> 
{/* Last Update */} 
<div className="mt-4 text-xs text-slate-500 dark:text-slate-400"> 
Last Update: {new Date(updateTime).toLocaleString()} 
</div> 
</div> 
); 
} 
