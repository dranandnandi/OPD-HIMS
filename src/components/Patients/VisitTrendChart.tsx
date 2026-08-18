import React, { useMemo, useState } from 'react';
import { TrendingUp, Table as TableIcon, LineChart as LineChartIcon } from 'lucide-react';
import { format } from 'date-fns';
import { Visit } from '../../types';

interface VisitTrendChartProps {
  visits: Visit[];
}

interface TrendPoint {
  date: Date;
  value: number;
  /** What the tooltip shows instead of the raw number (e.g. "Moderate"). */
  display: string;
}

interface Metric {
  key: string;
  label: string;
  unit: string;
  group: 'Vitals' | 'Symptoms';
  /** Fixed axis domain and tick labels, used by ordinal metrics like severity. */
  ordinal?: { domain: [number, number]; ticks: Array<{ value: number; label: string }> };
  extract: (visit: Visit) => TrendPoint | null;
}

const SEVERITY_SCALE: Record<string, number> = { mild: 1, moderate: 2, severe: 3 };
const SEVERITY_TICKS = [
  { value: 1, label: 'Mild' },
  { value: 2, label: 'Moderate' },
  { value: 3, label: 'Severe' }
];

// Chart geometry. The SVG scales to its container through the viewBox.
const VIEW_W = 760;
const VIEW_H = 260;
const PAD = { top: 18, right: 64, bottom: 34, left: 52 };
const PLOT_W = VIEW_W - PAD.left - PAD.right;
const PLOT_H = VIEW_H - PAD.top - PAD.bottom;

const SERIES_COLOR = '#2563eb'; // blue-600, matching the app chrome
const GRID_COLOR = '#e5e7eb';
const SURFACE = '#ffffff';

const numericPoint = (visit: Visit, raw: unknown, decimals = 1): TrendPoint | null => {
  const value = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
  if (!isFinite(value)) return null;
  return {
    date: new Date(visit.date),
    value,
    display: String(Number(value.toFixed(decimals)))
  };
};

/** "120/80" -> [120, 80]; anything unparseable -> null. */
const parseBloodPressure = (raw?: string): [number, number] | null => {
  const match = String(raw ?? '').match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  if (!match) return null;
  return [parseInt(match[1], 10), parseInt(match[2], 10)];
};

const VITAL_METRICS: Metric[] = [
  { key: 'temperature', label: 'Temperature', unit: '°F', group: 'Vitals', extract: v => numericPoint(v, v.vitals?.temperature) },
  {
    key: 'bp_systolic', label: 'Blood Pressure (Systolic)', unit: 'mmHg', group: 'Vitals',
    extract: v => {
      const bp = parseBloodPressure(v.vitals?.bloodPressure);
      return bp ? { date: new Date(v.date), value: bp[0], display: String(bp[0]) } : null;
    }
  },
  {
    key: 'bp_diastolic', label: 'Blood Pressure (Diastolic)', unit: 'mmHg', group: 'Vitals',
    extract: v => {
      const bp = parseBloodPressure(v.vitals?.bloodPressure);
      return bp ? { date: new Date(v.date), value: bp[1], display: String(bp[1]) } : null;
    }
  },
  { key: 'pulse', label: 'Pulse', unit: 'BPM', group: 'Vitals', extract: v => numericPoint(v, v.vitals?.pulse, 0) },
  { key: 'weight', label: 'Weight', unit: 'kg', group: 'Vitals', extract: v => numericPoint(v, v.vitals?.weight) },
  { key: 'height', label: 'Height', unit: 'cm', group: 'Vitals', extract: v => numericPoint(v, v.vitals?.height) },
  { key: 'respiratoryRate', label: 'Respiratory Rate', unit: '/min', group: 'Vitals', extract: v => numericPoint(v, v.vitals?.respiratoryRate, 0) },
  { key: 'oxygenSaturation', label: 'Oxygen Saturation', unit: '%', group: 'Vitals', extract: v => numericPoint(v, v.vitals?.oxygenSaturation, 0) }
];

/** Build one severity metric per distinct symptom the patient has ever reported. */
const buildSymptomMetrics = (visits: Visit[]): Metric[] => {
  const names = new Map<string, string>(); // lowercase key -> display name as first seen
  visits.forEach(visit => {
    (visit.symptoms || []).forEach(symptom => {
      const name = (symptom.name || '').trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (!names.has(key)) names.set(key, name);
    });
  });

  return Array.from(names.entries()).map(([key, displayName]) => ({
    key: `symptom:${key}`,
    label: displayName,
    unit: 'severity',
    group: 'Symptoms' as const,
    ordinal: { domain: [1, 3] as [number, number], ticks: SEVERITY_TICKS },
    extract: (visit: Visit) => {
      const match = (visit.symptoms || []).find(s => (s.name || '').trim().toLowerCase() === key);
      if (!match?.severity) return null; // recorded without a severity: nothing to plot
      const value = SEVERITY_SCALE[match.severity];
      if (!value) return null;
      return {
        date: new Date(visit.date),
        value,
        display: match.severity.charAt(0).toUpperCase() + match.severity.slice(1)
      };
    }
  }));
};

/** Round a raw domain out to readable tick values. */
const buildTicks = (min: number, max: number): number[] => {
  if (min === max) {
    const pad = Math.abs(min) > 10 ? Math.abs(min) * 0.05 : 1;
    min -= pad;
    max += pad;
  }
  const rawStep = (max - min) / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const niceStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const start = Math.floor(min / niceStep) * niceStep;
  const end = Math.ceil(max / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let value = start; value <= end + niceStep / 2; value += niceStep) {
    ticks.push(Number(value.toFixed(6)));
  }
  return ticks;
};

const VisitTrendChart: React.FC<VisitTrendChartProps> = ({ visits }) => {
  const [metricKey, setMetricKey] = useState<string>('');
  const [showTable, setShowTable] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const chronological = useMemo(
    () => [...visits].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [visits]
  );

  const metrics = useMemo(() => {
    const symptomMetrics = buildSymptomMetrics(chronological);
    // Only offer a metric when at least one visit actually carries a value for it.
    return [...VITAL_METRICS, ...symptomMetrics].filter(
      metric => chronological.filter(visit => metric.extract(visit)).length > 0
    );
  }, [chronological]);

  const activeMetric = metrics.find(m => m.key === metricKey) || metrics[0];

  const points = useMemo(
    () => (activeMetric ? chronological.map(activeMetric.extract).filter((p): p is TrendPoint => !!p) : []),
    [activeMetric, chronological]
  );

  if (metrics.length === 0) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4 text-blue-600" />
          <h3 className="text-base font-semibold text-gray-800">Progress Trends</h3>
        </div>
        <p className="text-sm text-gray-500">
          No numeric vitals or graded symptoms recorded yet. Record vitals (temperature, BP, pulse, weight)
          or symptom severity across visits and trends will appear here.
        </p>
      </div>
    );
  }

  // ── Scales ────────────────────────────────────────────────────────
  const values = points.map(p => p.value);
  const ordinal = activeMetric?.ordinal;
  const yTicks = ordinal
    ? ordinal.ticks.map(t => t.value)
    : buildTicks(Math.min(...values), Math.max(...values));
  const yMin = ordinal ? ordinal.domain[0] : Math.min(...yTicks);
  const yMax = ordinal ? ordinal.domain[1] : Math.max(...yTicks);
  const yLabelFor = (value: number) =>
    ordinal ? (ordinal.ticks.find(t => t.value === value)?.label ?? String(value)) : String(value);

  const times = points.map(p => p.date.getTime());
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const spansTime = tMax > tMin;

  const xFor = (time: number) =>
    spansTime ? PAD.left + ((time - tMin) / (tMax - tMin)) * PLOT_W : PAD.left + PLOT_W / 2;
  const yFor = (value: number) =>
    PAD.top + PLOT_H - ((value - yMin) / (yMax - yMin || 1)) * PLOT_H;

  const coords = points.map(p => ({ ...p, x: xFor(p.date.getTime()), y: yFor(p.value) }));
  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

  // X labels: always the ends, then any point far enough from the previous label.
  const xLabelIndexes: number[] = [];
  let lastLabelX = -Infinity;
  coords.forEach((c, i) => {
    const isEdge = i === 0 || i === coords.length - 1;
    if (isEdge || c.x - lastLabelX > 90) {
      xLabelIndexes.push(i);
      lastLabelX = c.x;
    }
  });
  // Drop a middle label that would collide with the final one.
  const filteredXLabels = xLabelIndexes.filter((idx, i) => {
    const isLast = idx === coords.length - 1;
    const next = xLabelIndexes[i + 1];
    if (isLast || next === undefined) return true;
    return !(next === coords.length - 1 && coords[next].x - coords[idx].x < 90);
  });

  const last = coords[coords.length - 1];
  const hovered = hoverIndex !== null ? coords[hoverIndex] : null;

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    let nearest = 0;
    coords.forEach((c, i) => {
      if (Math.abs(c.x - svgX) < Math.abs(coords[nearest].x - svgX)) nearest = i;
    });
    setHoverIndex(nearest);
  };

  const grouped = ['Vitals', 'Symptoms'].filter(group => metrics.some(m => m.group === group));

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-blue-600" />
          <h3 className="text-base font-semibold text-gray-800">Progress Trends</h3>
        </div>

        <select
          value={activeMetric.key}
          onChange={e => { setMetricKey(e.target.value); setHoverIndex(null); }}
          className="input-field py-2 text-sm w-auto min-w-56"
          aria-label="Choose the field to plot"
        >
          {grouped.map(group => (
            <optgroup key={group} label={group === 'Symptoms' ? 'Symptom severity' : group}>
              {metrics.filter(m => m.group === group).map(m => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <button
          onClick={() => setShowTable(v => !v)}
          className="ml-auto flex items-center gap-1 text-sm text-gray-600 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50"
        >
          {showTable ? <LineChartIcon className="w-4 h-4" /> : <TableIcon className="w-4 h-4" />}
          {showTable ? 'Chart' : 'Table'}
        </button>
      </div>

      <p className="text-sm text-gray-600 mb-3">
        {activeMetric.label}
        {activeMetric.ordinal ? '' : ` (${activeMetric.unit})`} across {points.length} visit{points.length === 1 ? '' : 's'}
      </p>

      {points.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">No values recorded for this field yet.</p>
      ) : showTable ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-4 font-medium">Visit date</th>
                <th className="py-2 font-medium">{activeMetric.label}</th>
              </tr>
            </thead>
            <tbody>
              {[...coords].reverse().map((point, i) => (
                <tr key={`${point.date.getTime()}-${i}`} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-4 text-gray-700">{format(point.date, 'dd MMM yyyy')}</td>
                  <td className="py-2 text-gray-800 font-medium">
                    {point.display}{activeMetric.ordinal ? '' : ` ${activeMetric.unit}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="w-full h-auto"
            role="img"
            aria-label={`${activeMetric.label} trend across visits`}
            onMouseMove={handleMove}
            onMouseLeave={() => setHoverIndex(null)}
          >
            {/* Gridlines + y ticks */}
            {yTicks.map(tick => {
              const y = yFor(tick);
              return (
                <g key={tick}>
                  <line x1={PAD.left} y1={y} x2={PAD.left + PLOT_W} y2={y} stroke={GRID_COLOR} strokeWidth={1} />
                  <text x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize={11} fill="#6b7280">
                    {yLabelFor(tick)}
                  </text>
                </g>
              );
            })}

            {/* Baseline */}
            <line
              x1={PAD.left} y1={PAD.top + PLOT_H} x2={PAD.left + PLOT_W} y2={PAD.top + PLOT_H}
              stroke="#d1d5db" strokeWidth={1}
            />

            {/* X labels */}
            {filteredXLabels.map(i => (
              <text
                key={`x-${i}`}
                x={coords[i].x}
                y={PAD.top + PLOT_H + 20}
                textAnchor={i === 0 ? 'start' : i === coords.length - 1 ? 'end' : 'middle'}
                fontSize={11}
                fill="#6b7280"
              >
                {format(coords[i].date, 'dd MMM')}
              </text>
            ))}

            {/* Hover crosshair */}
            {hovered && (
              <line
                x1={hovered.x} y1={PAD.top} x2={hovered.x} y2={PAD.top + PLOT_H}
                stroke={GRID_COLOR} strokeWidth={1}
              />
            )}

            {/* Series */}
            {coords.length > 1 && (
              <path d={linePath} fill="none" stroke={SERIES_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            )}
            {coords.map((c, i) => (
              <circle
                key={`pt-${i}`}
                cx={c.x}
                cy={c.y}
                r={hoverIndex === i ? 5.5 : 4}
                fill={SERIES_COLOR}
                stroke={SURFACE}
                strokeWidth={2}
              />
            ))}

            {/* Endpoint value - the one direct label */}
            <text
              x={Math.min(last.x + 12, VIEW_W - 4)}
              y={last.y + 4}
              fontSize={12}
              fontWeight={600}
              fill="#374151"
            >
              {last.display}
            </text>
          </svg>

          {hovered && (
            <div
              className="pointer-events-none absolute z-10 bg-gray-900 text-white text-xs rounded-lg px-2 py-1.5 shadow-lg whitespace-nowrap"
              style={{
                left: `${(hovered.x / VIEW_W) * 100}%`,
                top: `${(hovered.y / VIEW_H) * 100}%`,
                transform: 'translate(-50%, -130%)'
              }}
            >
              <div className="font-medium">
                {hovered.display}{activeMetric.ordinal ? '' : ` ${activeMetric.unit}`}
              </div>
              <div className="text-gray-300">{format(hovered.date, 'dd MMM yyyy')}</div>
            </div>
          )}
        </div>
      )}

      {!showTable && points.length === 1 && (
        <p className="text-xs text-gray-400 mt-2">
          Only one reading so far - a trend line appears from the second recorded value.
        </p>
      )}
    </div>
  );
};

export default VisitTrendChart;
