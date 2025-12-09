import React from 'react';

function formatNumber(v, format){
  if (format) return format(v);
  if (typeof v === 'number') return v.toFixed(2);
  return v;
}

export function SmallCard({ label, value, unit = '', format }) {
  return (
    <div className="card neon-card hover:-translate-y-1 transform transition-shadow duration-300">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-extrabold text-white">{formatNumber(value, format)} <span className="text-slate-300 text-sm font-medium">{unit}</span></div>
    </div>
  );
}

export function VufCard({ vuf = 0 }) {
  const status = vuf < 1 ? 'Good' : vuf < 2 ? 'Moderate' : 'Bad';
  const color = vuf < 1 ? 'text-emerald-400' : vuf < 2 ? 'text-amber-400' : 'text-rose-400';
  return (
    <div className="card neon-card hover:-translate-y-1 transform transition-shadow duration-300 bg-gradient-to-br from-[#062431]/70 to-[#021423]/30 border border-[#00c2ff22]">
      <div className="text-xs text-slate-300">Voltage Unbalance Factor</div>
      <div className={`mt-2 text-3xl font-extrabold ${color}`}>{vuf.toFixed(2)}%</div>
      <div className="text-xs text-slate-400 mt-1">Status: <span className="font-semibold text-slate-200">{status}</span></div>
    </div>
  );
}
