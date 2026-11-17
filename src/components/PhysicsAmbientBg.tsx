import React from 'react';

const PARTICLES = [
  { top: '12%', left: '10%', size: 3.5, delay: '0s', color: 'bg-cyan-400/60' },
  { top: '24%', left: '82%', size: 4.5, delay: '1.8s', color: 'bg-blue-400/55' },
  { top: '38%', left: '20%', size: 3, delay: '3.5s', color: 'bg-violet-400/55' },
  { top: '55%', left: '85%', size: 4, delay: '1.2s', color: 'bg-cyan-300/55' },
  { top: '70%', left: '14%', size: 3.5, delay: '3.1s', color: 'bg-blue-300/55' },
  { top: '85%', left: '68%', size: 3, delay: '4.8s', color: 'bg-indigo-400/55' },
  { top: '16%', left: '48%', size: 2.5, delay: '2.4s', color: 'bg-sky-300/55' },
  { top: '62%', left: '38%', size: 3.5, delay: '0.6s', color: 'bg-cyan-400/50' },
];

export const PhysicsAmbientBg = React.memo(function PhysicsAmbientBg() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none overflow-hidden z-0 select-none will-change-transform"
    >
      {/* Enhanced Layered Luminous Nebulae with GPU acceleration */}
      <div className="absolute -top-32 -start-24 w-[32rem] h-[32rem] rounded-full bg-blue-500/16 dark:bg-blue-600/24 blur-3xl animate-physics-drift will-change-transform" />
      <div
        className="absolute top-1/4 -end-28 w-[30rem] h-[30rem] rounded-full bg-violet-500/14 dark:bg-violet-600/20 blur-3xl animate-physics-drift will-change-transform"
        style={{ animationDelay: '3.5s' }}
      />
      <div
        className="absolute -bottom-36 start-1/3 w-[34rem] h-[34rem] rounded-full bg-cyan-500/14 dark:bg-cyan-500/18 blur-3xl animate-physics-drift will-change-transform"
        style={{ animationDelay: '7s' }}
      />

      {/* Dynamic Orbital / Atomic Geometric Rings */}
      <div className="absolute -top-20 end-[6%] w-[38rem] h-[38rem] opacity-30 dark:opacity-25 will-change-transform">
        <svg viewBox="0 0 400 400" className="w-full h-full">
          <g className="origin-center animate-physics-orbit">
            <ellipse
              cx="200"
              cy="200"
              rx="175"
              ry="76"
              fill="none"
              stroke="rgba(56, 189, 248, 0.4)"
              strokeWidth="1.2"
              strokeDasharray="8 10"
              transform="rotate(-24 200 200)"
            />
            <circle cx="350" cy="140" r="4" fill="rgba(34, 211, 238, 0.85)" />
          </g>
          <g className="origin-center animate-physics-orbit-rev">
            <ellipse
              cx="200"
              cy="200"
              rx="155"
              ry="66"
              fill="none"
              stroke="rgba(139, 92, 246, 0.38)"
              strokeWidth="1.2"
              transform="rotate(34 200 200)"
            />
            <circle cx="78" cy="118" r="3.5" fill="rgba(167, 139, 250, 0.8)" />
          </g>
          <circle
            cx="200"
            cy="200"
            r="104"
            fill="none"
            stroke="rgba(59, 130, 246, 0.2)"
            strokeWidth="1"
          />
        </svg>
      </div>

      {/* Fluid Physics Wave Curves Along Lower Horizon */}
      <svg
        viewBox="0 0 1440 240"
        preserveAspectRatio="none"
        className="absolute bottom-0 inset-x-0 w-full h-52 opacity-40 dark:opacity-35 will-change-transform"
      >
        <defs>
          <linearGradient id="physicsWaveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(59, 130, 246, 0)" />
            <stop offset="30%" stopColor="rgba(34, 211, 238, 0.48)" />
            <stop offset="70%" stopColor="rgba(139, 92, 246, 0.44)" />
            <stop offset="100%" stopColor="rgba(59, 130, 246, 0)" />
          </linearGradient>
        </defs>
        <path
          d="M0,145 Q240,70 480,140 T960,135 T1440,115"
          fill="none"
          stroke="url(#physicsWaveGrad)"
          strokeWidth="1.8"
        />
        <path
          d="M0,180 Q300,115 600,165 T1200,155 T1440,145"
          fill="none"
          stroke="url(#physicsWaveGrad)"
          strokeWidth="1.2"
          strokeDasharray="6 8"
        />
      </svg>

      {/* Luminous Drifting Particles */}
      {PARTICLES.map((p, idx) => (
        <span
          key={idx}
          className={`absolute rounded-full ${p.color} animate-particle-float will-change-transform`}
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
