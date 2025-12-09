import React, { useRef, useEffect } from 'react';

function Badge({ level }) {
  const classes = {
    success: 'badge-ok',
    warning: 'badge-warn',
    critical: 'badge-critical',
    info: 'badge-info'
  };
  const label = level === 'success' ? 'OK' : level === 'warning' ? 'WARN' : level === 'critical' ? 'ALERT' : 'INFO';
  return <span className={`badge ${classes[level] || 'badge-info'} px-3 py-1 text-xs`}>{label}</span>;
}

export default function EventLog({ events = [] }) {
  const ref = useRef();
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; }, [events]);

  return (
    <div className="card neon-card p-4 h-[720px] overflow-hidden">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-white">Event Log</h3>
        <div className="text-sm text-slate-400">Latest</div>
      </div>

      <div ref={ref} className="mt-4 overflow-auto space-y-3 pr-2" style={{ maxHeight: '620px' }}>
        {events.length === 0 && <div className="text-slate-400">No events yet.</div>}
        {events.map((e, i) => (
          <div key={i} className="event-container hover:shadow-neon transition-all" title={e.msg}>
            <div className="flex items-center justify-between">
              <Badge level={e.level} />
              <div className="text-xs text-slate-400">{new Date(e.time).toLocaleString()}</div>
            </div>
            <div className="mt-2 font-semibold text-white">{e.msg}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
