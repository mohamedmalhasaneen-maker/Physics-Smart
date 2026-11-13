import React, { useMemo, useRef, useState } from 'react';
import { Language, SavedGraph, UserProfile } from '../types/physics';
import { Download, Plus, Save, Trash2 } from 'lucide-react';

interface GraphingToolViewProps {
  lang: Language;
  profile: UserProfile;
  savedGraphs: SavedGraph[];
  onSaveGraph: (graph: SavedGraph) => Promise<void>;
  onDeleteGraph: (id: string) => Promise<void>;
}

const PRESETS: Record<
  string,
  {
    labelAr: string;
    labelEn: string;
    xLabel: string;
    yLabel: string;
    points: Array<{ x: number; y: number }>;
    slopeMeaningAr: string;
    slopeMeaningEn: string;
    areaMeaningAr: string;
    areaMeaningEn: string;
  }
> = {
  v_t: {
    labelAr: 'السرعة والزمن (v-t)',
    labelEn: 'Velocity vs Time (v-t)',
    xLabel: 't (s)',
    yLabel: 'v (m/s)',
    points: [
      { x: 0, y: 0 },
      { x: 2, y: 6 },
      { x: 4, y: 12 },
      { x: 6, y: 18 },
      { x: 8, y: 24 },
    ],
    slopeMeaningAr: 'الميل يساوي العجلة المنتظمة a (م/ث²).',
    slopeMeaningEn: 'Slope equals Acceleration a (m/s²).',
    areaMeaningAr: 'المساحة تحت المنحنى تساوي الإزاحة المقطوعة d (متر).',
    areaMeaningEn: 'Area under the curve equals Displacement d (m).',
  },
  d_t: {
    labelAr: 'المسافة / الإزاحة والزمن (d-t)',
    labelEn: 'Displacement vs Time (d-t)',
    xLabel: 't (s)',
    yLabel: 'd (m)',
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 5 },
      { x: 2, y: 10 },
      { x: 3, y: 15 },
      { x: 4, y: 20 },
    ],
    slopeMeaningAr: 'الميل يساوي السرعة المتجهة v (م/ث).',
    slopeMeaningEn: 'Slope equals Velocity v (m/s).',
    areaMeaningAr: 'المساحة تحت منحنى (d-t) ليس لها مدلول فيزيائي مباشر.',
    areaMeaningEn: 'Area under a d-t graph has no direct standard physical meaning.',
  },
  a_t: {
    labelAr: 'العجلة والزمن (a-t)',
    labelEn: 'Acceleration vs Time (a-t)',
    xLabel: 't (s)',
    yLabel: 'a (m/s²)',
    points: [
      { x: 0, y: 4 },
      { x: 2, y: 4 },
      { x: 4, y: 4 },
      { x: 6, y: 4 },
    ],
    slopeMeaningAr: 'الميل يساوي معدل تغير العجلة (Jerk).',
    slopeMeaningEn: 'Slope equals Jerk (da/dt).',
    areaMeaningAr: 'المساحة تحت المنحنى تساوي التغير في السرعة Δv (م/ث).',
    areaMeaningEn: 'Area under the curve equals Change in Velocity Δv (m/s).',
  },
  i_v: {
    labelAr: 'شدة التيار وفرق الجهد (I-V)',
    labelEn: 'Current vs Voltage (I-V)',
    xLabel: 'V (V)',
    yLabel: 'I (A)',
    points: [
      { x: 0, y: 0 },
      { x: 3, y: 0.6 },
      { x: 6, y: 1.2 },
      { x: 9, y: 1.8 },
      { x: 12, y: 2.4 },
    ],
    slopeMeaningAr: 'الميل = I / V = مقلوب المقاومة (1/R)، إذن المقاومة R = 1 / الميل.',
    slopeMeaningEn: 'Slope = I / V = 1 / R, so Resistance R = 1 / slope.',
    areaMeaningAr: 'المساحة تحت منحنى I-V الخطي لا تمثل القدرة الكلية مباشرة (القدرة = V × I).',
    areaMeaningEn: 'Total electrical power is P = V · I (product at point, not area).',
  },
  wave: {
    labelAr: 'الموجات والاهتزازات (y-t)',
    labelEn: 'Waves & Oscillations (y-t)',
    xLabel: 't (s)',
    yLabel: 'y (cm)',
    points: [
      { x: 0, y: 0 },
      { x: 0.25, y: 4 },
      { x: 0.5, y: 0 },
      { x: 0.75, y: -4 },
      { x: 1.0, y: 0 },
    ],
    slopeMeaningAr: 'الميل اللحظي يمثل السرعة الاهتزازية لجزيئات الوسط.',
    slopeMeaningEn: 'Tangent slope equals oscillatory velocity of medium particles.',
    areaMeaningAr: 'في الاهتزازات الدورية المتماثلة تتعادل المساحة الموجبة والسالبة خلال دورة كاملة.',
    areaMeaningEn: 'Positive and negative areas cancel over one complete cycle.',
  },
};

export function GraphingToolView({
  lang,
  profile,
  savedGraphs,
  onSaveGraph,
  onDeleteGraph,
}: GraphingToolViewProps) {
  const [graphType, setGraphType] = useState<string>('v_t');
  const [title, setTitle] = useState('Velocity vs Time Experiment');
  const [xLabel, setXLabel] = useState(PRESETS.v_t.xLabel);
  const [yLabel, setYLabel] = useState(PRESETS.v_t.yLabel);
  const [points, setPoints] = useState<Array<{ x: number; y: number }>>(PRESETS.v_t.points);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const selectPreset = (key: string) => {
    const p = PRESETS[key];
    if (!p) return;
    setGraphType(key);
    setXLabel(p.xLabel);
    setYLabel(p.yLabel);
    setPoints(p.points);
    setTitle(lang === 'ar' ? p.labelAr : p.labelEn);
  };

  // Mathematical computations: linear regression slope, R^2, trapezoidal area under curve
  const analysis = useMemo(() => {
    const sorted = [...points].sort((a, b) => a.x - b.x);
    if (sorted.length < 2) {
      return { slope: 0, intercept: 0, r2: 0, area: 0, sorted };
    }

    const n = sorted.length;
    const sumX = sorted.reduce((acc, p) => acc + p.x, 0);
    const sumY = sorted.reduce((acc, p) => acc + p.y, 0);
    const sumXY = sorted.reduce((acc, p) => acc + p.x * p.y, 0);
    const sumXX = sorted.reduce((acc, p) => acc + p.x * p.x, 0);

    const denom = n * sumXX - sumX * sumX;
    const slope = Math.abs(denom) > 1e-9 ? (n * sumXY - sumX * sumY) / denom : 0;
    const intercept = (sumY - slope * sumX) / n;

    const meanY = sumY / n;
    const ssTot = sorted.reduce((acc, p) => acc + (p.y - meanY) ** 2, 0);
    const ssRes = sorted.reduce((acc, p) => acc + (p.y - (slope * p.x + intercept)) ** 2, 0);
    const r2 = ssTot > 1e-9 ? 1 - ssRes / ssTot : 1;

    // Trapezoidal area under curve
    let area = 0;
    for (let i = 1; i < sorted.length; i++) {
      const dx = sorted[i].x - sorted[i - 1].x;
      area += 0.5 * (sorted[i].y + sorted[i - 1].y) * dx;
    }

    return { slope, intercept, r2, area, sorted };
  }, [points]);

  const handleSave = async () => {
    await onSaveGraph({
      id: `graph-${Date.now()}`,
      userId: profile.uid,
      title: title || 'Physics Graph',
      graphType,
      xLabel,
      yLabel,
      pointsJson: JSON.stringify(points),
    });
  };

  const handleExportSVG = () => {
    if (!svgRef.current) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgRef.current);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '_')}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // SVG plot geometry
  const W = 620;
  const H = 320;
  const pad = 48;
  const xs = analysis.sorted.map((p) => p.x);
  const ys = analysis.sorted.map((p) => p.y);
  const minX = Math.min(0, ...(xs.length ? xs : [0]));
  const maxX = Math.max(1, ...(xs.length ? xs : [1]));
  const minY = Math.min(0, ...(ys.length ? ys : [0]));
  const maxY = Math.max(1, ...(ys.length ? ys : [1]));

  const mapX = (x: number) => pad + ((x - minX) / (maxX - minX || 1)) * (W - pad * 2);
  const mapY = (y: number) => H - pad - ((y - minY) / (maxY - minY || 1)) * (H - pad * 2);

  const polylinePts = analysis.sorted.map((p) => `${mapX(p.x)},${mapY(p.y)}`).join(' ');
  const areaPts =
    analysis.sorted.length >= 2
      ? `${mapX(analysis.sorted[0].x)},${mapY(0)} ${polylinePts} ${mapX(
          analysis.sorted[analysis.sorted.length - 1].x
        )},${mapY(0)}`
      : '';

  const presetInfo = PRESETS[graphType] || PRESETS.v_t;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl glass-card p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              {lang === 'ar' ? 'الرسم البياني والتحليل الرياضي' : 'Physics Graphing & Mathematical Analysis'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {lang === 'ar'
                ? 'أدخل بياناتك وارسم المنحنيات واحسب الميل والمساحة تحت المنحنى والتفسير الفيزيائي مباشرة.'
                : 'Plot physics datasets, fit lines, calculate exact slope and area under the curve, and export SVG.'}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="px-3.5 py-2 rounded-xl glass-btn-primary text-xs font-semibold flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              {lang === 'ar' ? 'حفظ الرسم' : 'Save Graph'}
            </button>
            <button
              onClick={handleExportSVG}
              className="px-3.5 py-2 rounded-xl glass-btn-secondary text-xs font-semibold flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              {lang === 'ar' ? 'تصدير SVG' : 'Export SVG'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {Object.entries(PRESETS).map(([key, p]) => (
            <button
              key={key}
              onClick={() => selectPreset(key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                graphType === key
                  ? 'glass-btn-primary text-white'
                  : 'glass-btn-secondary text-slate-600 dark:text-slate-300'
              }`}
            >
              {lang === 'ar' ? p.labelAr : p.labelEn}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* SVG Plot & Results */}
        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-2xl glass-card p-3 sm:p-4">
            <div className="rounded-xl border border-slate-800/90 bg-[#070E1E] p-3">
              <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
              <rect width={W} height={H} fill="#070E1E" />
              {/* Axes */}
              <line x1={pad} y1={mapY(0)} x2={W - pad} y2={mapY(0)} stroke="#475569" strokeWidth="1.5" />
              <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="#475569" strokeWidth="1.5" />
              {/* Area fill */}
              {areaPts && <polygon points={areaPts} fill="rgba(56, 189, 248, 0.16)" />}
              {/* Best fit line */}
              {analysis.sorted.length >= 2 && (
                <line
                  x1={mapX(minX)}
                  y1={mapY(analysis.slope * minX + analysis.intercept)}
                  x2={mapX(maxX)}
                  y2={mapY(analysis.slope * maxX + analysis.intercept)}
                  stroke="#A78BFA"
                  strokeDasharray="5 4"
                  strokeWidth="1.5"
                />
              )}
              {/* Data curve */}
              {polylinePts && (
                <polyline fill="none" stroke="#22D3EE" strokeWidth="3" points={polylinePts} />
              )}
              {/* Points */}
              {analysis.sorted.map((p, idx) => (
                <circle key={idx} cx={mapX(p.x)} cy={mapY(p.y)} r="5" fill="#38BDF8" stroke="#0F172A" strokeWidth="1.5" />
              ))}
              {/* Axis Labels */}
              <text x={W - pad} y={mapY(0) - 8} fill="#94A3B8" fontSize="12" textAnchor="end">
                {xLabel}
              </text>
              <text x={pad + 8} y={pad + 10} fill="#94A3B8" fontSize="12">
                {yLabel}
              </text>
            </svg>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-2xl glass-card p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">{lang === 'ar' ? 'الميل (Slope)' : 'Linear Slope'}</p>
              <p className="text-xl font-bold font-mono-num mt-1">{analysis.slope.toFixed(3)}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">R² = {analysis.r2.toFixed(4)}</p>
            </div>
            <div className="rounded-2xl glass-card p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">{lang === 'ar' ? 'المساحة تحت المنحنى' : 'Area Under Curve'}</p>
              <p className="text-xl font-bold font-mono-num mt-1">{analysis.area.toFixed(3)}</p>
            </div>
            <div className="rounded-2xl glass-card p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">{lang === 'ar' ? 'الجزء المقطوع (Intercept)' : 'Y-Intercept'}</p>
              <p className="text-xl font-bold font-mono-num mt-1">{analysis.intercept.toFixed(3)}</p>
            </div>
          </div>

          <div className="rounded-2xl glass-card p-5 text-xs space-y-1.5">
            <p className="font-bold text-blue-600 dark:text-cyan-400">
              {lang === 'ar' ? 'التفسير الفيزيائي للنموذج:' : 'Physical Interpretation:'}
            </p>
            <p>{lang === 'ar' ? presetInfo.slopeMeaningAr : presetInfo.slopeMeaningEn}</p>
            <p>{lang === 'ar' ? presetInfo.areaMeaningAr : presetInfo.areaMeaningEn}</p>
          </div>
        </div>

        {/* Data Editor & Saved Graphs */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-2xl glass-card p-5 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                className="col-span-3 px-3 py-1.5 rounded-xl glass-input text-xs"
              />
              <input
                value={xLabel}
                onChange={(e) => setXLabel(e.target.value)}
                placeholder="X axis"
                dir="ltr"
                className="col-span-1 px-2.5 py-1.5 rounded-xl glass-input text-xs font-mono-num"
              />
              <input
                value={yLabel}
                onChange={(e) => setYLabel(e.target.value)}
                placeholder="Y axis"
                dir="ltr"
                className="col-span-2 px-2.5 py-1.5 rounded-xl glass-input text-xs font-mono-num"
              />
            </div>

            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {points.map((pt, idx) => (
                <div key={idx} className="grid grid-cols-11 gap-2 items-center">
                  <input
                    type="number"
                    step="any"
                    dir="ltr"
                    value={pt.x}
                    onChange={(e) =>
                      setPoints((prev) => prev.map((p, i) => (i === idx ? { ...p, x: parseFloat(e.target.value) || 0 } : p)))
                    }
                    className="col-span-5 px-2.5 py-1.5 rounded-xl glass-input text-xs font-mono-num"
                  />
                  <input
                    type="number"
                    step="any"
                    dir="ltr"
                    value={pt.y}
                    onChange={(e) =>
                      setPoints((prev) => prev.map((p, i) => (i === idx ? { ...p, y: parseFloat(e.target.value) || 0 } : p)))
                    }
                    className="col-span-5 px-2.5 py-1.5 rounded-xl glass-input text-xs font-mono-num"
                  />
                  <button
                    onClick={() => setPoints((prev) => prev.filter((_, i) => i !== idx))}
                    className="col-span-1 text-slate-400 hover:text-rose-500 flex justify-center"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={() => setPoints((prev) => [...prev, { x: (prev[prev.length - 1]?.x || 0) + 1, y: 0 }])}
              className="px-3 py-1.5 rounded-xl glass-btn-secondary text-xs font-medium flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              {lang === 'ar' ? 'إضافة نقطة' : 'Add Data Point'}
            </button>
          </div>

          <div className="rounded-2xl glass-card p-5 space-y-2.5">
            <h3 className="text-sm font-bold">{lang === 'ar' ? 'الرسومات المحفوظة' : 'Saved Graphs'}</h3>
            {savedGraphs.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">{lang === 'ar' ? 'لا توجد رسومات محفوظة بعد.' : 'No saved graphs yet.'}</p>
            ) : (
              savedGraphs.map((g) => (
                <div key={g.id} className="flex items-center justify-between text-xs p-2.5 rounded-xl glass-subcard">
                  <button
                    onClick={() => {
                      setTitle(g.title);
                      setGraphType(g.graphType);
                      setXLabel(g.xLabel || 'x');
                      setYLabel(g.yLabel || 'y');
                      try {
                        setPoints(JSON.parse(g.pointsJson));
                      } catch {
                        // ignore
                      }
                    }}
                    className="font-medium hover:underline truncate text-start flex-1"
                  >
                    {g.title}
                  </button>
                  <button onClick={() => onDeleteGraph(g.id)} className="text-slate-400 hover:text-rose-500 ms-2">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
