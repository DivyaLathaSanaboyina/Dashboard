import React, { useEffect, useRef } from 'react';
import {
  Chart, LineController, LineElement, PointElement,
  CategoryScale, LinearScale, TimeScale, Tooltip, Legend, Filler
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import 'chartjs-adapter-luxon';

Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, TimeScale, Tooltip, Legend, Filler, zoomPlugin);

function makeOptions(yLabel, threshold, dark) {
  const gridColor = dark ? 'rgba(255,255,255,0.03)' : 'rgba(16,24,40,0.06)';
  const tickColor = dark ? '#9fb9d6' : '#334155';
  
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 750,
      easing: 'easeInOutQuart'
    },
    plugins: {
      legend: { 
        labels: { color: tickColor, font: { size: 12 } }, 
        position: 'top' 
      },
      tooltip: { 
        mode: 'index', 
        intersect: false, 
        backgroundColor: dark ? '#0b172b' : '#ffffff', 
        titleColor: dark ? '#e6f7ff' : '#0f172a', 
        bodyColor: dark ? '#cfeffd' : '#0f172a',
        borderColor: dark ? 'rgba(0,194,255,0.3)' : 'rgba(51,65,85,0.3)',
        borderWidth: 1
      },
      zoom: {
        pan: { enabled: true, mode: 'x', modifierKey: 'ctrl' },
        zoom: {
          wheel: { enabled: true, speed: 0.1 },
          pinch: { enabled: true },
          mode: 'x'
        }
      }
    },
    scales: {
      x: {
        type: 'time',
        time: {
          tooltipFormat: 'HH:mm:ss',
          displayFormats: {
            second: 'HH:mm:ss',
            minute: 'HH:mm',
            hour: 'HH:mm',
            day: 'MMM dd'
          },
          unit: 'minute',
          stepSize: 60
        },
        ticks: {
          color: tickColor,
          maxRotation: 0,
          autoSkipPadding: 20,
          font: { size: 11 }
        },
        grid: { color: gridColor }
      },
      y: {
        beginAtZero: false,
        grid: { color: gridColor },
        ticks: { 
          color: tickColor,
          font: { size: 11 }
        },
        title: { 
          display: true, 
          text: yLabel, 
          color: tickColor,
          font: { size: 12, weight: 'bold' }
        }
      }
    }
  };
}

// Smoothing function: averages data points in time windows
function smoothOldData(data, cutoffTime) {
  const SMOOTH_WINDOW_MS = 5 * 60 * 1000; // 5-minute windows for smoothing
  
  const recent = [];
  const old = [];
  
  data.forEach(point => {
    if (point.t >= cutoffTime) {
      recent.push(point);
    } else {
      old.push(point);
    }
  });
  
  if (old.length === 0) return recent;
  
  // Group old data into windows and average
  const smoothed = [];
  old.sort((a, b) => a.t - b.t);
  
  let windowStart = old[0].t;
  let windowPoints = [];
  
  old.forEach(point => {
    if (point.t - windowStart < SMOOTH_WINDOW_MS) {
      windowPoints.push(point);
    } else {
      // Average the window
      if (windowPoints.length > 0) {
        const avg = {
          t: windowPoints[Math.floor(windowPoints.length / 2)].t,
          Va: windowPoints.reduce((sum, p) => sum + (p.Va || 0), 0) / windowPoints.length,
          Vb: windowPoints.reduce((sum, p) => sum + (p.Vb || 0), 0) / windowPoints.length,
          Vc: windowPoints.reduce((sum, p) => sum + (p.Vc || 0), 0) / windowPoints.length,
          Ia: windowPoints.reduce((sum, p) => sum + (p.Ia || 0), 0) / windowPoints.length,
          Ib: windowPoints.reduce((sum, p) => sum + (p.Ib || 0), 0) / windowPoints.length,
          Ic: windowPoints.reduce((sum, p) => sum + (p.Ic || 0), 0) / windowPoints.length
        };
        smoothed.push(avg);
      }
      windowStart = point.t;
      windowPoints = [point];
    }
  });
  
  // Add last window
  if (windowPoints.length > 0) {
    const avg = {
      t: windowPoints[Math.floor(windowPoints.length / 2)].t,
      Va: windowPoints.reduce((sum, p) => sum + (p.Va || 0), 0) / windowPoints.length,
      Vb: windowPoints.reduce((sum, p) => sum + (p.Vb || 0), 0) / windowPoints.length,
      Vc: windowPoints.reduce((sum, p) => sum + (p.Vc || 0), 0) / windowPoints.length,
      Ia: windowPoints.reduce((sum, p) => sum + (p.Ia || 0), 0) / windowPoints.length,
      Ib: windowPoints.reduce((sum, p) => sum + (p.Ib || 0), 0) / windowPoints.length,
      Ic: windowPoints.reduce((sum, p) => sum + (p.Ic || 0), 0) / windowPoints.length
    };
    smoothed.push(avg);
  }
  
  return [...smoothed, ...recent];
}

export default function Charts({ 
  type = 'voltage', 
  data = [], 
  show = { a: true, b: true, c: true }, 
  threshold = null, 
  yLabel = '', 
  resetButtonId = null, 
  dark = true 
}) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d');
    if (chartRef.current) chartRef.current.destroy();

    const datasets = [];

    if (type === 'voltage') {
      datasets.push({ 
        label: 'Va (V)', 
        borderColor: '#00c2ff', 
        backgroundColor: 'rgba(0,194,255,0.06)', 
        data: [], 
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        hidden: !show.a 
      });
      datasets.push({ 
        label: 'Vb (V)', 
        borderColor: '#1fe6b7', 
        backgroundColor: 'rgba(31,230,183,0.04)', 
        data: [], 
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        hidden: !show.b 
      });
      datasets.push({ 
        label: 'Vc (V)', 
        borderColor: '#ff57a8', 
        backgroundColor: 'rgba(255,87,168,0.04)', 
        data: [], 
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        hidden: !show.c 
      });
      if (threshold) {
        datasets.push({ 
          label: threshold.label, 
          borderColor: threshold.color, 
          borderDash: [8, 6], 
          data: [], 
          pointRadius: 0,
          borderWidth: 2,
          tension: 0 
        });
      }
    } else {
      datasets.push({ 
        label: 'Ia (A)', 
        borderColor: '#00c2ff', 
        backgroundColor: 'rgba(0,194,255,0.06)', 
        data: [], 
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        hidden: !show.a 
      });
      datasets.push({ 
        label: 'Ib (A)', 
        borderColor: '#1fe6b7', 
        backgroundColor: 'rgba(31,230,183,0.04)', 
        data: [], 
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        hidden: !show.b 
      });
      datasets.push({ 
        label: 'Ic (A)', 
        borderColor: '#ff57a8', 
        backgroundColor: 'rgba(255,87,168,0.04)', 
        data: [], 
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        hidden: !show.c 
      });
    }

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: makeOptions(yLabel, threshold, dark)
    });

    return () => chartRef.current && chartRef.current.destroy();
  }, [type, dark, yLabel, threshold]);

  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;

    // Apply progressive smoothing: smooth data older than 1 hour
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    const cutoffTime = now - ONE_HOUR;
    
    const processedData = smoothOldData(data, cutoffTime);

    // Reset data arrays
    c.data.datasets.forEach(ds => { ds.data = []; });

    if (type === 'voltage') {
      processedData.forEach(p => {
        const t = new Date(p.t);
        if (c.data.datasets[0]) c.data.datasets[0].data.push({ x: t, y: p.Va });
        if (c.data.datasets[1]) c.data.datasets[1].data.push({ x: t, y: p.Vb });
        if (c.data.datasets[2]) c.data.datasets[2].data.push({ x: t, y: p.Vc });
        if (threshold && c.data.datasets[3]) {
          c.data.datasets[3].data.push({ x: t, y: threshold.value });
        }
      });
    } else {
      processedData.forEach(p => {
        const t = new Date(p.t);
        if (c.data.datasets[0]) c.data.datasets[0].data.push({ x: t, y: p.Ia });
        if (c.data.datasets[1]) c.data.datasets[1].data.push({ x: t, y: p.Ib });
        if (c.data.datasets[2]) c.data.datasets[2].data.push({ x: t, y: p.Ic });
      });
    }

    // Update visibility based on show prop
    if (c.data.datasets[0]) c.data.datasets[0].hidden = !show.a;
    if (c.data.datasets[1]) c.data.datasets[1].hidden = !show.b;
    if (c.data.datasets[2]) c.data.datasets[2].hidden = !show.c;

    c.update('active');
  }, [data, type, show, threshold]);

  useEffect(() => {
    if (!resetButtonId) return;
    const btn = document.getElementById(resetButtonId);
    if (!btn) return;
    const handler = () => { 
      chartRef.current && chartRef.current.resetZoom(); 
    };
    btn.addEventListener('click', handler);
    return () => btn.removeEventListener('click', handler);
  }, [resetButtonId]);

  return (
    <div style={{ height: '320px', width: '100%' }} className="relative">
      <canvas ref={canvasRef} />
    </div>
  );
}