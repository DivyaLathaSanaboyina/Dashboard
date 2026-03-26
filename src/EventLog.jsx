import React, { useRef, useEffect } from 'react';

function Badge({ level }) {
  const styles = {
    success: { background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', color: '#059669' },
    warning: { background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', color: '#d97706' },
    critical: { background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#dc2626' },
    info:     { background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.35)', color: '#6366f1' },
  };
  const label = level === 'success' ? 'OK' : level === 'warning' ? 'WARN' : level === 'critical' ? 'ALERT' : 'INFO';
  const s = styles[level] || styles.info;
  return (
    <span style={{
      ...s,
      borderRadius: 6,
      padding: '2px 10px',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.06em',
    }}>
      {label}
    </span>
  );
}

export default function EventLog({ events = [] }) {
  const ref = useRef();
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; }, [events]);

  return (
    <div
      className="rounded-2xl bg-white/40 dark:bg-white/10 backdrop-blur-xl border border-white/20 shadow-xl"
      style={{
        padding: 24,
        minHeight: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        {/* Title — solid color so it's always visible, no webkit clip */}
        <h3 className="text-slate-800 dark:text-slate-100" style={{
          fontSize: 18,
          fontWeight: 900,
          margin: 0,
        }}>
          <span style={{
            background: 'linear-gradient(90deg, #2563eb, #9333ea)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            /* Fallback for light mode where gradient may wash out */
            display: 'inline-block',
          }}>
            Event Log
          </span>
        </h3>
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.1em',
          color: '#6366f1',
          background: 'rgba(99,102,241,0.1)',
          border: '1px solid rgba(99,102,241,0.3)',
          borderRadius: 6,
          padding: '2px 8px',
        }}>
          LIVE
        </span>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(99,102,241,0.2)', marginBottom: 14 }} />

      {/* Events list — fills remaining height */}
      <div ref={ref} style={{ overflowY: 'auto', flex: 1, paddingRight: 2 }}>
        {events.length === 0 && (
          <p className="text-slate-400 dark:text-slate-500"
            style={{ fontSize: 13, textAlign: 'center', marginTop: 40 }}>
            No events yet.
          </p>
        )}
        {events.map((e, i) => (
          <div
            key={i}
            className="bg-emerald-50/70 dark:bg-emerald-300/10 border-l-4 border-emerald-400 dark:border-emerald-500"
            style={{
              borderRadius: 10,
              padding: '10px 12px',
              marginBottom: 10,
              transition: 'transform 0.15s, box-shadow 0.15s',
              cursor: 'default',
            }}
            onMouseEnter={el => {
              el.currentTarget.style.transform = 'translateY(-2px)';
              el.currentTarget.style.boxShadow = '0 4px 16px rgba(99,102,241,0.12)';
            }}
            onMouseLeave={el => {
              el.currentTarget.style.transform = 'translateY(0)';
              el.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <Badge level={e.level || 'success'} />
              <span className="text-slate-400 dark:text-slate-500" style={{ fontSize: 10, fontWeight: 500 }}>
                {e.time
                  ? new Date(e.time).toLocaleTimeString()
                  : e.timestamp || ''}
              </span>
            </div>
            <div className="text-slate-700 dark:text-slate-200" style={{ fontSize: 13, fontWeight: 600 }}>
              {e.msg}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}