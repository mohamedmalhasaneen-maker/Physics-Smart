import React from 'react';

const PARTICLES = [
  { top: '14%', left: '12%', size: 3, delay: '0s', color: 'bg-cyan-400/50' },
  { top: '26%', left: '78%', size: 4, delay: '2.2s', color: 'bg-blue-400/45' },
  { top: '42%', left: '24%', size: 2.5, delay: '4.1s', color: 'bg-violet-400/45' },
  { top: '58%', left: '88%', size: 3.5, delay: '1.4s', color: 'bg-cyan-300/45' },
  { top: '74%', left: '16%', size: 3, delay: '3.6s', color: 'bg-blue-300/45' },
  { top: '82%', left: '64%', size: 2.5, delay: '5.2s', color: 'bg-indigo-400/45' },
  { top: '18%', left: '52%', size: 2, delay: '2.9s', color: 'bg-sky-300/45' },
  { top: '64%', left: '42%', size: 3, delay: '0.8s', color: 'bg-cyan-400/40' },
];

export const PhysicsAmbientBg = React.memo(function PhysicsAmbientBg() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none overflow-hidden z-0 select-none"
    >
      {/* Subtle Blurred Nebulae (Strictly behind UI glass layers) */}
      <div className="absolute -top-32 -start-24 w-[28rem] h-[28rem] rounded-full bg-blue-500/12 dark:bg-blue-600/20 blur-3xl animate-physics-drift" />
      <div
        className="absolute top-1/4 -end-28 w-[26rem] h-[26rem] rounded-full bg-violet-500/10 dark:bg-violet-600/16 blur-3xl animate-physics-drift"
        style={{ animationDelay: '4s' }}
      />
      <div
        className="absolute -bottom-36 start-1/3 w-[30rem] h-[30rem] rounded-full bg-cyan-500/10 dark:bg-cyan-500/14 blur-3xl animate-physics-drift"
        style={{ animationDelay: '8s' }}
      />

      {/* Orbital / Atomic Geometric Rings */}
      <div className="absolute -top-24 end-[8%] w-[34rem] h-[34rem] opacity-25 dark:opacity-20">
        <svg viewBox="0 0 400 400" className="w-full h-full">
          <g className="origin-center animate-physics-orbit">
            <ellipse
              cx="200"
              cy="200"
              rx="168"
              ry="72"
              fill="none"
              stroke="rgba(56, 189, 248, 0.35)"
              strokeWidth="1"
              strokeDasharray="6 8"
              transform="rotate(-24 200 200)"
            />
            <circle cx="342" cy="145" r="3.5" fill="rgba(34, 211, 238, 0.7)" />
          </g>
          <g className="origin-center animate-physics-orbit-rev">
            <ellipse
              cx="200"
              cy="200"
              rx="148"
              ry="62"
              fill="none"
              stroke="rgba(139, 92, 246, 0.32)"
              strokeWidth="1"
              transform="rotate(34 200 200)"
            />
            <circle cx="88" cy="122" r="3" fill="rgba(167, 139, 250, 0.65)" />
          </g>
          <circle
            cx="200"
            cy="200"
            r="96"
            fill="none"
            stroke="rgba(59, 130, 246, 0.16)"
            strokeWidth="0.9"
          />
        </svg>
      </div>

      {/* Soft Physics Wave Curves Along Lower Horizon */}
      <svg
        viewBox="0 0 1440 240"
        preserveAspectRatio="none"
        className="absolute bottom-0 inset-x-0 w-full h-44 opacity-30 dark:opacity-25"
      >
        <defs>
          <linearGradient id="physicsWaveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(59, 130, 246, 0)" />
            <stop offset="35%" stopColor="rgba(34, 211, 238, 0.38)" />
            <stop offset="68%" stopColor="rgba(139, 92, 246, 0.34)" />
            <stop offset="100%" stopColor="rgba(59, 130, 246, 0)" />
          </linearGradient>
        </defs>
        <path
          d="M0,150 Q240,80 480,145 T960,140 T1440,120"
          fill="none"
          stroke="url(#physicsWaveGrad)"
          strokeWidth="1.5"
        />
        <path
          d="M0,185 Q300,125 600,175 T1200,165 T1440,155"
          fill="none"
          stroke="url(#physicsWaveGrad)"
          strokeWidth="1"
          strokeDasharray="5 7"
        />
      </svg>

      {/* Gently Drifting Luminous Particles */}
      {PARTICLES.map((p, idx) => (
        <span
          key={idx}
          className={`absolute rounded-full ${p.color} animate-particle-float`}
          style={{
            top: p.top,
            left: p.left,
            width: `${p.size}px`,
            height: `${p.size}px`,
            animationDelay: p.delay,
          }}
        />
      ))}
    </div>
  );
});
