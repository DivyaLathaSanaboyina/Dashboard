# Smart Grid Dashboard

> **Real-time energy monitoring dashboard for Dynamic Phase Reconfiguration in DER-Integrated Distribution Feeders**

---

## Overview

A live web dashboard built with React + Vite that monitors three-phase electrical parameters and DER-integrated feeder metrics in real time. Data is pulled from a Google Sheet every 5 seconds, rendered as interactive charts, and can be exported as PNG images or CSV files.

---

## Features

| Feature | Description |
|---|---|
| ⚡ Live KPI Cards | Real-time voltage, current, power, reactive power, power factor |
| 📈 Interactive Charts | Scroll to zoom Y-axis · Shift+drag to pan · Brush to select time range |
| 🔀 Dual-Axis Charts | Power + Frequency · Reactive Power + Power Factor on separate Y-axes |
| 🌿 DER Feeder Metrics | Voltage, current, power, reactive power, PF, frequency |
| 📥 PNG Export | Full session or custom time-range export for every chart |
| 📊 CSV Export | Download raw session data as CSV |
| 🌙 Dark / Light Theme | Toggle with persistent localStorage preference |
| 🔁 Auto Backfill | Loads full today's history from Google Sheet on page load |
| ⚡ LTTB Downsampling | Smooth rendering of up to 1200 display points from large datasets |

---

## Tech Stack

- **React 18** + **Vite** — frontend framework and build tool
- **Recharts** — interactive line charts with dual Y-axis support
- **Tailwind CSS** — utility-first styling
- **PapaParse** — CSV parsing from Google Sheets
- **FileSaver.js** — client-side PNG and CSV file downloads
- **Google Sheets** — live data source via public CSV export URL

---

## Project Structure

```
smartgrid/
├── src/
│   ├── App.jsx          # Root component — renders Dashboard
│   ├── Dashboard.jsx    # Main dashboard (all charts, KPIs, export logic)
│   ├── global.css       # Global styles
│   └── main.jsx         # React entry point
├── index.html           # HTML shell
├── .gitignore
├── README.md
├── package.json
├── package-lock.json
├── postcss.config.js    # Required by Tailwind
├── tailwind.config.js   # Tailwind configuration
└── vite.config.mjs      # Vite build configuration
```

---

## Getting Started

### Prerequisites
- Node.js v18 or higher
- npm v9 or higher

### 1. Clone the repository
```bash
git clone https://github.com/DivyaLathaSanaboyina/smartgrid.git
cd smartgrid
```

### 2. Install dependencies
```bash
npm install
```

### 3. Run the development server
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### 4. Build for production
```bash
npm run build
```

---

## Data Source

Live data is fetched every **5 seconds** from a Google Sheet via public CSV export URL.

### Google Sheet Column Format

| Column | Description |
|---|---|
| `Timestamp` | Date and time of reading (`YYYY-MM-DD HH:MM:SS`) |
| `V_R`, `V_Y`, `V_B` | Three-phase voltages (V) |
| `I_R`, `I_Y`, `I_B` | Three-phase currents (A) |
| `P_R`, `P_Y`, `P_B` | Three-phase active powers (W) |
| `PF_R`, `PF_Y`, `PF_B` | Three-phase power factors |
| `Q_R`, `Q_Y`, `Q_B` | Three-phase reactive powers (VAR) |
| `Street_V` | DER feeder voltage (V) |
| `Street_I` | DER feeder current (A) |
| `Street_P` | DER feeder active power (W) |
| `Street_PF` | DER feeder power factor |
| `Street_F` | DER feeder frequency (Hz) |
| `Q_S` | DER feeder reactive power (VAR) |

### To change the data source
In `Dashboard.jsx`, update the `CSV_URL` constant at the top of the file:
```js
const CSV_URL = "https://docs.google.com/spreadsheets/d/1C2BWZbJ1HJzzqkIuHrvH8OnrT9PbFKVCdaD-40jj9bw/edit?gid=0#gid=0";
```

To get the CSV export URL from Google Sheets:
`File → Share → Publish to web → Select sheet → CSV format → Copy link`

---

## Y-Axis Limits

All incoming values are validated against configured limits. Out-of-range values are discarded and shown as gaps in the chart.

| Parameter | Min | Max |
|---|---|---|
| Voltage | 210 V | 260 V |
| Current | 0 A | 10 A |
| Active Power | 0 W | 3000 W |
| Reactive Power | 0 VAR | 2500 VAR |
| Power Factor | 0 | 1 |
| Frequency | 49 Hz | 51 Hz |

---

## Export Options

### PNG Export (Header buttons)
- One button per chart — exports the full session data as a high-resolution PNG (2000×920 px)
- Dual-axis charts (Power+Frequency, Reactive Power+PF) export **both Y-axes** correctly

### PNG Export by Time Range
- Click **🕐 Export by Time Range** in the header
- Select chart type, start time, and end time
- Downloads a PNG for only that time window

### CSV Export
- Click **⬇ CSV Data** to download the raw Google Sheet data as a `.csv` file

---

## Charts Available

| Chart | Type | Parameters |
|---|---|---|
| Three Phase Voltages | Single axis | V_R, V_Y, V_B |
| Three Phase Currents | Single axis | I_R, I_Y, I_B |
| Three Phase Powers | Single axis | P_R, P_Y, P_B |
| Three Phase Reactive Powers | Single axis | Q_R, Q_Y, Q_B |
| Three Phase Power Factors | Single axis | PF_R, PF_Y, PF_B |
| DER Feeder Voltage | Single axis | Street_V |
| DER Feeder Current | Single axis | Street_I |
| DER Power · Frequency | **Dual axis** | Street_P (left) · Street_F (right) |
| DER Reactive Power · PF | **Dual axis** | Q_S (left) · Street_PF (right) |

---

## License

MIT License — free to use, modify, and distribute.

---

## Author
S Teja Venkata Divya Latha
Developed as part of the research project:
**"Dynamic Phase Reconfiguration in DER-Integrated Distribution Feeders"**