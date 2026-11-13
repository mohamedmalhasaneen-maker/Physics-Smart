import { Language } from '../types/physics';

export function PhysicsDiagramSVG({
  type,
  lang,
}: {
  type: 'kinematics' | 'circuit' | 'wave' | 'optics' | 'magnetism' | 'freefall' | 'newton';
  lang: Language;
}) {
  return (
    <div className="my-4 rounded-2xl glass-card p-3 sm:p-4">
      <div className="rounded-xl border border-slate-800/80 bg-[#060D20] p-3.5 text-slate-100">
        <div className="mb-2 flex items-center justify-between text-xs text-cyan-300">
          <span>
            {lang === 'ar' ? 'رسم علمي توضيحي' : 'Scientific Illustration'}
          </span>
          <span className="font-mono-num text-slate-400">{type.toUpperCase()}</span>
        </div>

      {type === 'kinematics' && (
        <svg viewBox="0 0 500 180" className="w-full h-auto max-h-48">
          <defs>
            <marker id="arrowCyan" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L7,3 z" fill="#22D3EE" />
            </marker>
          </defs>
          <line x1="45" y1="150" x2="460" y2="150" stroke="#475569" strokeWidth="2" />
          <line x1="45" y1="20" x2="45" y2="150" stroke="#475569" strokeWidth="2" />
          <path d="M 45 150 L 380 40" stroke="#22D3EE" strokeWidth="3" fill="none" markerEnd="url(#arrowCyan)" />
          <polygon points="45,150 320,150 320,60" fill="rgba(59,130,246,0.18)" />
          <line x1="320" y1="60" x2="320" y2="150" stroke="#60A5FA" strokeDasharray="4 4" strokeWidth="1.5" />
          <text x="468" y="154" fill="#94A3B8" fontSize="12">t (s)</text>
          <text x="20" y="25" fill="#94A3B8" fontSize="12">v</text>
          <text x="160" y="75" fill="#22D3EE" fontSize="12">Slope = a = Δv / Δt</text>
          <text x="190" y="132" fill="#93C5FD" fontSize="12">Area = Displacement (d)</text>
        </svg>
      )}

      {type === 'freefall' && (
        <svg viewBox="0 0 500 180" className="w-full h-auto max-h-48">
          <line x1="80" y1="20" x2="80" y2="165" stroke="#334155" strokeDasharray="4 4" strokeWidth="2" />
          <circle cx="80" cy="30" r="10" fill="#38BDF8" />
          <circle cx="80" cy="60" r="10" fill="#3B82F6" />
          <circle cx="80" cy="108" r="10" fill="#6366F1" />
          <circle cx="80" cy="158" r="10" fill="#8B5CF6" />
          <text x="115" y="34" fill="#E2E8F0" fontSize="12">t = 0 s, v = 0, d = 0 m</text>
          <text x="115" y="64" fill="#E2E8F0" fontSize="12">t = 1 s, v = 9.8 m/s, d = 4.9 m</text>
          <text x="115" y="112" fill="#E2E8F0" fontSize="12">t = 2 s, v = 19.6 m/s, d = 19.6 m</text>
          <text x="115" y="160" fill="#E2E8F0" fontSize="12">t = 3 s, v = 29.4 m/s, d = 44.1 m</text>
          <text x="340" y="95" fill="#22D3EE" fontSize="13">g = 9.8 m/s² ↓</text>
        </svg>
      )}

      {type === 'circuit' && (
        <svg viewBox="0 0 500 180" className="w-full h-auto max-h-48">
          <rect x="70" y="35" width="360" height="110" rx="8" fill="none" stroke="#38BDF8" strokeWidth="2.5" />
          <rect x="45" y="70" width="50" height="40" rx="4" fill="#0F172A" stroke="#60A5FA" strokeWidth="2" />
          <text x="53" y="95" fill="#93C5FD" fontSize="12">VB, r</text>
          <rect x="210" y="20" width="90" height="30" rx="4" fill="#1E293B" stroke="#22D3EE" strokeWidth="2" />
          <text x="235" y="40" fill="#22D3EE" fontSize="12">R_ext</text>
          <circle cx="255" cy="145" r="16" fill="#0F172A" stroke="#A78BFA" strokeWidth="2" />
          <text x="250" y="150" fill="#C4B5FD" fontSize="12">A</text>
          <text x="145" y="96" fill="#E2E8F0" fontSize="13">I = VB / (R_ext + r)</text>
        </svg>
      )}

      {type === 'wave' && (
        <svg viewBox="0 0 500 180" className="w-full h-auto max-h-48">
          <line x1="20" y1="90" x2="480" y2="90" stroke="#475569" strokeWidth="1.5" />
          <path
            d="M 30 90 Q 80 20, 130 90 T 230 90 T 330 90 T 430 90"
            fill="none"
            stroke="#22D3EE"
            strokeWidth="3"
          />
          <line x1="80" y1="55" x2="80" y2="90" stroke="#A78BFA" strokeWidth="2" strokeDasharray="3 3" />
          <text x="86" y="76" fill="#C4B5FD" fontSize="11">A</text>
          <line x1="80" y1="30" x2="280" y2="30" stroke="#60A5FA" strokeWidth="1.5" />
          <text x="170" y="24" fill="#93C5FD" fontSize="12">λ (Wavelength)</text>
        </svg>
      )}

      {type === 'optics' && (
        <svg viewBox="0 0 500 180" className="w-full h-auto max-h-48">
          <line x1="20" y1="90" x2="480" y2="90" stroke="#475569" strokeWidth="1.5" strokeDasharray="5 4" />
          <ellipse cx="250" cy="90" rx="14" ry="65" fill="rgba(56,189,248,0.22)" stroke="#38BDF8" strokeWidth="2" />
          <line x1="110" y1="90" x2="110" y2="45" stroke="#FBBF24" strokeWidth="3" />
          <line x1="110" y1="45" x2="250" y2="45" stroke="#22D3EE" strokeWidth="2" />
          <line x1="250" y1="45" x2="410" y2="128" stroke="#22D3EE" strokeWidth="2" />
          <line x1="110" y1="45" x2="410" y2="128" stroke="#A78BFA" strokeWidth="2" />
          <circle cx="330" cy="90" r="3.5" fill="#F43F5E" />
          <text x="326" y="106" fill="#FDA4AF" fontSize="11">F</text>
          <line x1="395" y1="90" x2="395" y2="124" stroke="#34D399" strokeWidth="3" />
          <text x="95" y="110" fill="#FDE68A" fontSize="11">Object</text>
          <text x="380" y="142" fill="#6EE7B7" fontSize="11">Real Image</text>
        </svg>
      )}

      {type === 'magnetism' && (
        <svg viewBox="0 0 500 180" className="w-full h-auto max-h-48">
          <rect x="60" y="65" width="90" height="50" rx="4" fill="#1E293B" stroke="#38BDF8" strokeWidth="2" />
          <text x="95" y="95" fill="#F87171" fontSize="14" fontWeight="bold">N</text>
          <path d="M 150 90 C 200 40, 260 40, 310 90" fill="none" stroke="#22D3EE" strokeDasharray="4 4" strokeWidth="2" />
          <path d="M 150 90 C 200 140, 260 140, 310 90" fill="none" stroke="#22D3EE" strokeDasharray="4 4" strokeWidth="2" />
          <rect x="270" y="50" width="120" height="80" rx="10" fill="none" stroke="#F59E0B" strokeWidth="3" />
          <text x="285" y="38" fill="#FCD34D" fontSize="12">Coil (N turns)</text>
          <text x="200" y="165" fill="#93C5FD" fontSize="12">ℰ = -N ΔΦ_B / Δt</text>
        </svg>
      )}

      {type === 'newton' && (
        <svg viewBox="0 0 500 180" className="w-full h-auto max-h-48">
          <polygon points="80,150 400,150 400,50" fill="rgba(59,130,246,0.15)" stroke="#475569" strokeWidth="2" />
          <g transform="translate(245,86) rotate(-17.4)">
            <rect x="-25" y="-20" width="50" height="36" rx="4" fill="#3B82F6" stroke="#93C5FD" strokeWidth="2" />
            <line x1="0" y1="0" x2="0" y2="-50" stroke="#34D399" strokeWidth="2.5" />
            <text x="6" y="-42" fill="#6EE7B7" fontSize="11">N</text>
            <line x1="0" y1="0" x2="55" y2="0" stroke="#F59E0B" strokeWidth="2.5" />
            <text x="45" y="-8" fill="#FCD34D" fontSize="11">f_k</text>
          </g>
          <line x1="245" y1="86" x2="245" y2="148" stroke="#F87171" strokeWidth="2.5" />
          <text x="252" y="142" fill="#FCA5A5" fontSize="11">mg</text>
          <text x="130" y="142" fill="#94A3B8" fontSize="12">θ</text>
        </svg>
      )}
      </div>
    </div>
  );
}
