import React, { useEffect, useRef, useState } from 'react';
import { LabExperimentConfig, Language } from '../types/physics';
import { LatexBlock } from './MathRenderer';
import { Pause, Play, RotateCcw, StepForward, CheckCircle2 } from 'lucide-react';

interface VirtualLabViewProps {
  lang: Language;
  labs: LabExperimentConfig[];
}

export function VirtualLabView({ lang, labs }: VirtualLabViewProps) {
  const [category, setCategory] = useState<'all' | 'mechanics' | 'electricity' | 'waves' | 'magnetism' | 'optics'>('all');
  const filteredLabs = category === 'all' ? labs : labs.filter((l) => l.category === category);
  const [selectedLabId, setSelectedLabId] = useState<string>(labs[0]?.id || 'lab-projectile');
  const activeLab = labs.find((l) => l.id === selectedLabId) || filteredLabs[0] || labs[0];

  // Simulation playback state
  const [running, setRunning] = useState(true);
  const [simTime, setSimTime] = useState(0);

  // Physics parameters across labs
  const [gravity, setGravity] = useState(9.81);
  const [initHeight, setInitHeight] = useState(40);
  const [initSpeed, setInitSpeed] = useState(22);
  const [angleDeg, setAngleDeg] = useState(45);
  const [frictionMu, setFrictionMu] = useState(0.15);
  const [mass1, setMass1] = useState(3);
  const [mass2, setMass2] = useState(2);
  const [vel1, setVel1] = useState(4);
  const [vel2, setVel2] = useState(-2);
  const [restitution, setRestitution] = useState(1);

  // Electricity
  const [circuitType, setCircuitType] = useState<'series' | 'parallel'>('series');
  const [voltage, setVoltage] = useState(12);
  const [res1, setRes1] = useState(4);
  const [res2, setRes2] = useState(6);

  // Waves
  const [waveMode, setWaveMode] = useState<'transverse' | 'longitudinal' | 'interference'>('transverse');
  const [waveAmp, setWaveAmp] = useState(36);
  const [waveFreq, setWaveFreq] = useState(1.5);
  const [wavePhaseDeg, setWavePhaseDeg] = useState(0);

  // Magnetism
  const [magMode, setMagMode] = useState<'faraday' | 'lorentz'>('faraday');
  const [bField, setBField] = useState(1.2);
  const [coilTurns, setCoilTurns] = useState(100);
  const [chargeVel, setChargeVel] = useState(6);

  // Optics
  const [opticsMode, setOpticsMode] = useState<'converging' | 'diverging' | 'snell'>('converging');
  const [focalLength, setFocalLength] = useState(80);
  const [objDist, setObjDist] = useState(150);
  const [snellAngle, setSnellAngle] = useState(35);
  const [snellN1, setSnellN1] = useState(1.5);
  const [snellN2, setSnellN2] = useState(1.0);

  // Post-lab quiz state
  const [postAnswers, setPostAnswers] = useState<Record<number, number>>({});

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const graphCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const resetSimulation = () => {
    setSimTime(0);
    setRunning(true);
  };

  useEffect(() => {
    setSimTime(0);
    setPostAnswers({});
  }, [activeLab?.id]);

  // Physics animation timer
  useEffect(() => {
    if (!running) return;
    let frameId: number;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      setSimTime((t) => t + dt);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [running]);

  // Draw Main Simulation Canvas + Synchronized Graph Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const gCanvas = graphCanvasRef.current;
    if (!canvas || !activeLab) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Subtle scientific grid
    ctx.fillStyle = '#070E1E';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y < H; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    const gCtx = gCanvas?.getContext('2d');
    if (gCtx && gCanvas) {
      gCtx.fillStyle = '#070E1E';
      gCtx.fillRect(0, 0, gCanvas.width, gCanvas.height);
      gCtx.strokeStyle = '#334155';
      gCtx.lineWidth = 1.5;
      gCtx.beginPath();
      gCtx.moveTo(35, 15);
      gCtx.lineTo(35, gCanvas.height - 25);
      gCtx.lineTo(gCanvas.width - 15, gCanvas.height - 25);
      gCtx.stroke();
    }

    if (activeLab.simKey === 'linear_freefall') {
      const tMax = Math.sqrt((2 * initHeight) / Math.max(gravity, 0.1));
      const t = simTime % (tMax + 1.2);
      const tClamped = Math.min(t, tMax);
      const yFallen = 0.5 * gravity * tClamped * tClamped;
      const curY = Math.max(0, initHeight - yFallen);
      const vNow = gravity * tClamped;

      const groundY = H - 35;
      const topY = 35;
      const scale = (groundY - topY) / Math.max(initHeight, 10);
      const ballY = topY + yFallen * scale;

      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(40, groundY);
      ctx.lineTo(W - 40, groundY);
      ctx.stroke();

      // Tower guide
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(W / 2, topY);
      ctx.lineTo(W / 2, groundY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Ball
      ctx.fillStyle = '#38BDF8';
      ctx.beginPath();
      ctx.arc(W / 2, Math.min(ballY, groundY - 12), 12, 0, Math.PI * 2);
      ctx.fill();

      // Velocity arrow
      const arrowLen = Math.min(vNow * 2.5, 90);
      ctx.strokeStyle = '#22D3EE';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(W / 2 + 24, Math.min(ballY, groundY - 12));
      ctx.lineTo(W / 2 + 24, Math.min(ballY, groundY - 12) + arrowLen);
      ctx.stroke();

      ctx.fillStyle = '#E2E8F0';
      ctx.font = '13px JetBrains Mono, monospace';
      ctx.fillText(`t = ${tClamped.toFixed(2)} s | y = ${curY.toFixed(1)} m | v = ${vNow.toFixed(1)} m/s`, 20, 24);

      if (gCtx && gCanvas) {
        gCtx.strokeStyle = '#22D3EE';
        gCtx.lineWidth = 2.5;
        gCtx.beginPath();
        const plotW = gCanvas.width - 55;
        const plotH = gCanvas.height - 45;
        const vMax = gravity * tMax || 1;
        for (let i = 0; i <= 50; i++) {
          const frac = i / 50;
          const ti = frac * tClamped;
          const vi = gravity * ti;
          const px = 35 + (ti / (tMax || 1)) * plotW;
          const py = gCanvas.height - 25 - (vi / vMax) * plotH;
          if (i === 0) gCtx.moveTo(px, py);
          else gCtx.lineTo(px, py);
        }
        gCtx.stroke();
        gCtx.fillStyle = '#94A3B8';
        gCtx.font = '11px monospace';
        gCtx.fillText('v (m/s) vs t (s)  [Slope = g]', 45, 16);
      }
    } else if (activeLab.simKey === 'projectile') {
      const rad = (angleDeg * Math.PI) / 180;
      const vx = initSpeed * Math.cos(rad);
      const vy0 = initSpeed * Math.sin(rad);
      const tFlight = (2 * vy0) / gravity;
      const maxRange = Math.max((initSpeed * initSpeed) / gravity, 20);
      const maxApex = Math.max((initSpeed * initSpeed) / (2 * gravity), 10);

      const t = simTime % (tFlight + 1.0);
      const tC = Math.min(t, tFlight);
      const x = vx * tC;
      const y = Math.max(0, vy0 * tC - 0.5 * gravity * tC * tC);
      const vy = vy0 - gravity * tC;

      const groundY = H - 35;
      const leftX = 45;
      const scaleX = (W - 90) / maxRange;
      const scaleY = (H - 80) / maxApex;

      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(20, groundY);
      ctx.lineTo(W - 20, groundY);
      ctx.stroke();

      // Draw trajectory path
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) {
        const ti = (i / 60) * tFlight;
        const xi = vx * ti;
        const yi = vy0 * ti - 0.5 * gravity * ti * ti;
        const px = leftX + xi * scaleX;
        const py = groundY - yi * scaleY;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      const bx = leftX + x * scaleX;
      const by = groundY - y * scaleY;

      // Velocity components
      ctx.strokeStyle = '#34D399';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + vx * 2, by);
      ctx.stroke();

      ctx.strokeStyle = '#F59E0B';
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx, by - vy * 2);
      ctx.stroke();

      ctx.fillStyle = '#38BDF8';
      ctx.beginPath();
      ctx.arc(bx, by, 9, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#E2E8F0';
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.fillText(`x = ${x.toFixed(1)}m | y = ${y.toFixed(1)}m | vx = ${vx.toFixed(1)} | vy = ${vy.toFixed(1)}`, 20, 24);

      if (gCtx && gCanvas) {
        const plotW = gCanvas.width - 55;
        const plotH = gCanvas.height - 45;
        gCtx.strokeStyle = '#A78BFA';
        gCtx.lineWidth = 2.5;
        gCtx.beginPath();
        for (let i = 0; i <= 50; i++) {
          const ti = (i / 50) * tC;
          const yi = Math.max(0, vy0 * ti - 0.5 * gravity * ti * ti);
          const px = 35 + (ti / (tFlight || 1)) * plotW;
          const py = gCanvas.height - 25 - (yi / maxApex) * plotH;
          if (i === 0) gCtx.moveTo(px, py);
          else gCtx.lineTo(px, py);
        }
        gCtx.stroke();
        gCtx.fillStyle = '#94A3B8';
        gCtx.font = '11px monospace';
        gCtx.fillText('Height y(t) vs Time t(s)', 45, 16);
      }
    } else if (activeLab.simKey === 'newton_incline') {
      const rad = (angleDeg * Math.PI) / 180;
      const a = Math.max(0, gravity * (Math.sin(rad) - frictionMu * Math.cos(rad)));
      const rampLen = 280;
      const tSlide = a > 0.01 ? Math.sqrt((2 * 10) / a) : 1;
      const tC = a > 0.01 ? (simTime % (tSlide + 1)) : 0;
      const dist = Math.min(0.5 * a * tC * tC, 10);
      const frac = dist / 10;

      const x0 = 110;
      const y0 = H - 40;
      const xTop = x0 + rampLen * Math.cos(rad);
      const yTop = y0 - rampLen * Math.sin(rad);

      ctx.fillStyle = 'rgba(59, 130, 246, 0.16)';
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(xTop, y0);
      ctx.lineTo(xTop, yTop);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const blockX = xTop - frac * (xTop - x0);
      const blockY = yTop + frac * (y0 - yTop);

      ctx.save();
      ctx.translate(blockX, blockY);
      ctx.rotate(-rad);
      ctx.fillStyle = '#3B82F6';
      ctx.fillRect(-18, -26, 36, 26);
      // Friction arrow
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(frictionMu * 110, -13);
      ctx.stroke();
      // Normal arrow
      ctx.strokeStyle = '#34D399';
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(0, -60);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = '#E2E8F0';
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.fillText(
        a > 0.01
          ? `a = ${a.toFixed(2)} m/s² | θ = ${angleDeg}° | μk = ${frictionMu.toFixed(2)}`
          : `STATIC EQUILIBRIUM (tan θ ≤ μk) | a = 0.00 m/s²`,
        20,
        24
      );
    } else if (activeLab.simKey === 'collisions') {
      const t = simTime % 5.0;
      const x1Start = 120;
      const x2Start = 420;
      const relV = vel1 - vel2;
      const tImpact = relV > 0.05 ? (x2Start - x1Start - 48) / (relV * 28) : 99;

      // Post-collision velocities
      const v1After = (mass1 * vel1 + mass2 * vel2 + mass2 * restitution * (vel2 - vel1)) / (mass1 + mass2);
      const v2After = (mass1 * vel1 + mass2 * vel2 + mass1 * restitution * (vel1 - vel2)) / (mass1 + mass2);

      let x1: number;
      let x2: number;
      if (t < tImpact) {
        x1 = x1Start + vel1 * 28 * t;
        x2 = x2Start + vel2 * 28 * t;
      } else {
        const dt = t - tImpact;
        const xImpact1 = x1Start + vel1 * 28 * tImpact;
        const xImpact2 = x2Start + vel2 * 28 * tImpact;
        x1 = xImpact1 + v1After * 28 * dt;
        x2 = xImpact2 + v2After * 28 * dt;
      }

      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(30, H / 2 + 24);
      ctx.lineTo(W - 30, H / 2 + 24);
      ctx.stroke();

      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(x1 - 24, H / 2 - 20, 48, 44);
      ctx.fillStyle = '#0F172A';
      ctx.font = '12px monospace';
      ctx.fillText(`${mass1}kg`, x1 - 14, H / 2 + 6);

      ctx.fillStyle = '#A78BFA';
      ctx.fillRect(x2 - 24, H / 2 - 20, 48, 44);
      ctx.fillStyle = '#0F172A';
      ctx.fillText(`${mass2}kg`, x2 - 14, H / 2 + 6);

      const pTotal = mass1 * vel1 + mass2 * vel2;
      const keBefore = 0.5 * mass1 * vel1 * vel1 + 0.5 * mass2 * vel2 * vel2;
      const keAfter = 0.5 * mass1 * v1After * v1After + 0.5 * mass2 * v2After * v2After;

      ctx.fillStyle = '#E2E8F0';
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.fillText(`p_total = ${pTotal.toFixed(1)} kg·m/s | v1'=${v1After.toFixed(2)} | v2'=${v2After.toFixed(2)}`, 20, 24);
      ctx.fillText(`KE_before = ${keBefore.toFixed(1)} J | KE_after = ${keAfter.toFixed(1)} J`, 20, 44);
    } else if (activeLab.simKey === 'ohms_circuits') {
      const rEq = circuitType === 'series' ? res1 + res2 : (res1 * res2) / (res1 + res2);
      const current = voltage / rEq;
      const power = voltage * current;

      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 3;
      if (circuitType === 'series') {
        ctx.strokeRect(100, 60, W - 200, H - 120);
        // R1 and R2 boxes
        ctx.fillStyle = '#1E293B';
        ctx.fillRect(200, 46, 80, 28);
        ctx.fillRect(340, 46, 80, 28);
        ctx.strokeStyle = '#22D3EE';
        ctx.strokeRect(200, 46, 80, 28);
        ctx.strokeRect(340, 46, 80, 28);
        ctx.fillStyle = '#E2E8F0';
        ctx.font = '12px monospace';
        ctx.fillText(`R1=${res1}Ω`, 212, 65);
        ctx.fillText(`R2=${res2}Ω`, 352, 65);
      } else {
        ctx.strokeRect(100, 50, W - 200, H - 100);
        ctx.beginPath();
        ctx.moveTo(100, H / 2);
        ctx.lineTo(W - 100, H / 2);
        ctx.stroke();
        ctx.fillStyle = '#1E293B';
        ctx.fillRect(260, 36, 90, 28);
        ctx.fillRect(260, H / 2 - 14, 90, 28);
        ctx.strokeStyle = '#22D3EE';
        ctx.strokeRect(260, 36, 90, 28);
        ctx.strokeRect(260, H / 2 - 14, 90, 28);
        ctx.fillStyle = '#E2E8F0';
        ctx.font = '12px monospace';
        ctx.fillText(`R1=${res1}Ω`, 276, 55);
        ctx.fillText(`R2=${res2}Ω`, 276, H / 2 + 5);
      }

      // Animated electron pulses proportional to current
      const speed = Math.min(current * 35, 220);
      for (let i = 0; i < 8; i++) {
        const prog = ((simTime * speed + i * 70) % (W - 200));
        ctx.fillStyle = '#FACC15';
        ctx.beginPath();
        ctx.arc(100 + prog, H - 60, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#E2E8F0';
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.fillText(`R_eq = ${rEq.toFixed(2)} Ω | I = ${current.toFixed(2)} A | P = ${power.toFixed(1)} W`, 20, 24);

      if (gCtx && gCanvas) {
        const plotW = gCanvas.width - 55;
        const plotH = gCanvas.height - 45;
        gCtx.strokeStyle = '#38BDF8';
        gCtx.lineWidth = 2.5;
        gCtx.beginPath();
        gCtx.moveTo(35, gCanvas.height - 25);
        const maxV = 24;
        const maxI = maxV / Math.max(rEq, 0.5);
        const px = 35 + (voltage / maxV) * plotW;
        const py = gCanvas.height - 25 - (current / Math.max(maxI, 1)) * plotH;
        gCtx.lineTo(px, py);
        gCtx.stroke();
        gCtx.fillStyle = '#FACC15';
        gCtx.beginPath();
        gCtx.arc(px, py, 5, 0, Math.PI * 2);
        gCtx.fill();
        gCtx.fillStyle = '#94A3B8';
        gCtx.font = '11px monospace';
        gCtx.fillText(`I-V Curve (Slope = 1/R_eq = ${(1 / rEq).toFixed(2)} S)`, 45, 16);
      }
    } else if (activeLab.simKey === 'waves_interference') {
      const k = 0.045 * waveFreq;
      const w = 2 * Math.PI * waveFreq;
      const phase = (wavePhaseDeg * Math.PI) / 180;

      if (waveMode === 'transverse') {
        ctx.strokeStyle = '#22D3EE';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let x = 20; x < W - 20; x += 3) {
          const y = H / 2 + waveAmp * Math.sin(k * x - w * simTime);
          if (x === 20) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else if (waveMode === 'longitudinal') {
        for (let i = 0; i < 32; i++) {
          const baseX = 30 + i * 16;
          const dx = (waveAmp * 0.35) * Math.sin(k * baseX - w * simTime);
          ctx.fillStyle = '#38BDF8';
          ctx.beginPath();
          ctx.arc(baseX + dx, H / 2, 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Wave 1, Wave 2, and Superposition Result
        ctx.strokeStyle = 'rgba(56,189,248,0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let x = 20; x < W - 20; x += 4) {
          const y1 = (waveAmp * 0.6) * Math.sin(k * x - w * simTime);
          if (x === 20) ctx.moveTo(x, H / 2 + y1);
          else ctx.lineTo(x, H / 2 + y1);
        }
        ctx.stroke();

        ctx.strokeStyle = 'rgba(167,139,250,0.45)';
        ctx.beginPath();
        for (let x = 20; x < W - 20; x += 4) {
          const y2 = (waveAmp * 0.6) * Math.sin(k * x - w * simTime + phase);
          if (x === 20) ctx.moveTo(x, H / 2 + y2);
          else ctx.lineTo(x, H / 2 + y2);
        }
        ctx.stroke();

        ctx.strokeStyle = '#34D399';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let x = 20; x < W - 20; x += 3) {
          const yNet =
            (waveAmp * 0.6) * Math.sin(k * x - w * simTime) +
            (waveAmp * 0.6) * Math.sin(k * x - w * simTime + phase);
          if (x === 20) ctx.moveTo(x, H / 2 + yNet);
          else ctx.lineTo(x, H / 2 + yNet);
        }
        ctx.stroke();
      }
      ctx.fillStyle = '#E2E8F0';
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.fillText(`f = ${waveFreq.toFixed(1)} Hz | A = ${waveAmp} | φ = ${wavePhaseDeg}°`, 20, 24);
    } else if (activeLab.simKey === 'magnetism_induction') {
      if (magMode === 'faraday') {
        const magnetX = W / 2 - 60 + Math.sin(simTime * 2.2) * 110;
        const velocity = Math.cos(simTime * 2.2) * 2.2;
        const emf = (coilTurns / 100) * bField * velocity * 8;

        // Coil
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 4;
        ctx.strokeRect(W / 2 - 40, H / 2 - 45, 90, 90);
        // Magnet
        ctx.fillStyle = '#EF4444';
        ctx.fillRect(magnetX - 40, H / 2 - 18, 40, 36);
        ctx.fillStyle = '#3B82F6';
        ctx.fillRect(magnetX, H / 2 - 18, 40, 36);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '12px monospace';
        ctx.fillText('S', magnetX - 24, H / 2 + 5);
        ctx.fillText('N', magnetX + 16, H / 2 + 5);

        // Galvanometer
        ctx.strokeStyle = '#94A3B8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(W - 90, 90, 38, Math.PI, 0);
        ctx.stroke();
        const needleAngle = -Math.PI / 2 + Math.max(-1.2, Math.min(1.2, emf / 15));
        ctx.strokeStyle = '#22D3EE';
        ctx.beginPath();
        ctx.moveTo(W - 90, 90);
        ctx.lineTo(W - 90 + Math.sin(needleAngle) * 32, 90 - Math.cos(needleAngle) * 32);
        ctx.stroke();

        ctx.fillStyle = '#E2E8F0';
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.fillText(`Induced EMF ℰ = ${emf.toFixed(2)} V | N = ${coilTurns} | B = ${bField.toFixed(1)} T`, 20, 24);
      } else {
        const r = Math.min(95, Math.max(20, (chargeVel * 14) / bField));
        const cx = W / 2;
        const cy = H / 2;
        ctx.strokeStyle = 'rgba(56,189,248,0.4)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        const ang = (chargeVel / (r / 20)) * simTime;
        const px = cx + r * Math.cos(ang);
        const py = cy + r * Math.sin(ang);
        ctx.fillStyle = '#22D3EE';
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#E2E8F0';
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.fillText(`Cyclotron Radius r ∝ mv/(qB) = ${r.toFixed(1)} px | B = ${bField.toFixed(1)} T`, 20, 24);
      }
    } else if (activeLab.simKey === 'optics_bench') {
      if (opticsMode === 'snell') {
        const midY = H / 2;
        const midX = W / 2;
        ctx.fillStyle = 'rgba(56,189,248,0.12)';
        ctx.fillRect(0, midY, W, H - midY);
        ctx.strokeStyle = '#475569';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(midX, 20);
        ctx.lineTo(midX, H - 20);
        ctx.stroke();
        ctx.setLineDash([]);

        const rad1 = (snellAngle * Math.PI) / 180;
        const sin2 = (snellN1 / snellN2) * Math.sin(rad1);
        const len = 120;

        // Incident ray (top-left to center)
        ctx.strokeStyle = '#FACC15';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(midX - len * Math.sin(rad1), midY - len * Math.cos(rad1));
        ctx.lineTo(midX, midY);
        ctx.stroke();

        if (Math.abs(sin2) <= 1) {
          const rad2 = Math.asin(sin2);
          const deg2 = (rad2 * 180) / Math.PI;
          ctx.strokeStyle = '#22D3EE';
          ctx.beginPath();
          ctx.moveTo(midX, midY);
          ctx.lineTo(midX + len * Math.sin(rad2), midY + len * Math.cos(rad2));
          ctx.stroke();
          ctx.fillStyle = '#E2E8F0';
          ctx.font = '12px JetBrains Mono, monospace';
          ctx.fillText(`θ1 = ${snellAngle}° (n1=${snellN1}) -> θ2 = ${deg2.toFixed(1)}° (n2=${snellN2})`, 20, 24);
        } else {
          // Total internal reflection
          ctx.strokeStyle = '#F43F5E';
          ctx.beginPath();
          ctx.moveTo(midX, midY);
          ctx.lineTo(midX + len * Math.sin(rad1), midY - len * Math.cos(rad1));
          ctx.stroke();
          ctx.fillStyle = '#FDA4AF';
          ctx.font = '12px JetBrains Mono, monospace';
          ctx.fillText(`TOTAL INTERNAL REFLECTION! θ1=${snellAngle}° > θc`, 20, 24);
        }
      } else {
        const cx = W / 2;
        const cy = H / 2;
        const f = opticsMode === 'converging' ? focalLength : -focalLength;
        const di = (f * objDist) / (objDist - f);
        const mag = -di / objDist;

        // Optical axis
        ctx.strokeStyle = '#475569';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(20, cy);
        ctx.lineTo(W - 20, cy);
        ctx.stroke();
        ctx.setLineDash([]);

        // Lens
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 10, 80, 0, 0, Math.PI * 2);
        ctx.stroke();

        // Object
        const ox = cx - objDist;
        const oh = 45;
        ctx.strokeStyle = '#FACC15';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ox, cy);
        ctx.lineTo(ox, cy - oh);
        ctx.stroke();

        // Image
        const ix = cx + di;
        const ih = oh * mag;
        ctx.strokeStyle = di > 0 ? '#34D399' : '#A78BFA';
        ctx.beginPath();
        ctx.moveTo(ix, cy);
        ctx.lineTo(ix, cy - ih);
        ctx.stroke();

        // Rays
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ox, cy - oh);
        ctx.lineTo(cx, cy - oh);
        ctx.lineTo(ix, cy - ih);
        ctx.moveTo(ox, cy - oh);
        ctx.lineTo(ix, cy - ih);
        ctx.stroke();

        ctx.fillStyle = '#E2E8F0';
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.fillText(
          `do=${objDist} | f=${f} | di=${Number.isFinite(di) ? di.toFixed(1) : '∞'} | M=${Number.isFinite(mag) ? mag.toFixed(2) : '∞'}`,
          20,
          24
        );
      }
    }
  }, [
    activeLab,
    simTime,
    gravity,
    initHeight,
    initSpeed,
    angleDeg,
    frictionMu,
    mass1,
    mass2,
    vel1,
    vel2,
    restitution,
    circuitType,
    voltage,
    res1,
    res2,
    waveMode,
    waveAmp,
    waveFreq,
    wavePhaseDeg,
    magMode,
    bField,
    coilTurns,
    chargeVel,
    opticsMode,
    focalLength,
    objDist,
    snellAngle,
    snellN1,
    snellN2,
  ]);

  return (
    <div className="space-y-6">
      {/* Lab Selector Header */}
      <div className="rounded-2xl glass-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              {lang === 'ar' ? 'المعمل الافتراضي للفيزياء' : 'Virtual Physics Simulation Lab'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              {lang === 'ar'
                ? 'محاكاة حقيقية مبنية على المعادلات الفيزيائية الدقيقة في 5 فروع رئيسية.'
                : 'Equation-driven interactive simulations across Mechanics, Electricity, Waves, Magnetism, and Optics.'}
            </p>
          </div>

          <div className="flex flex-wrap gap-1 p-1 rounded-xl glass-subcard">
            {[
              { id: 'all', ar: 'الكل', en: 'All' },
              { id: 'mechanics', ar: 'الميكانيكا', en: 'Mechanics' },
              { id: 'electricity', ar: 'الكهرباء', en: 'Electricity' },
              { id: 'waves', ar: 'الموجات', en: 'Waves' },
              { id: 'magnetism', ar: 'المغناطيسية', en: 'Magnetism' },
              { id: 'optics', ar: 'البصريات', en: 'Optics' },
            ].map((c) => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  category === c.id
                    ? 'glass-btn-primary text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-white/50 dark:hover:bg-white/[0.06]'
                }`}
              >
                {lang === 'ar' ? c.ar : c.en}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {filteredLabs.map((l) => (
            <button
              key={l.id}
              onClick={() => setSelectedLabId(l.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeLab?.id === l.id
                  ? 'glass-btn-primary text-white'
                  : 'glass-btn-secondary'
              }`}
            >
              {lang === 'ar' ? l.titleAr : l.titleEn}
            </button>
          ))}
        </div>
      </div>

      {/* Two-Zone Sandbox Layout: Interactive Stage (Left) + Control Deck (Right) */}
      {activeLab && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-4">
            <div className="rounded-2xl glass-card p-3 sm:p-4">
              <div className="rounded-xl border border-slate-800/90 bg-[#060D20] p-4 space-y-3">
                <div className="flex items-center justify-between text-white">
                  <h2 className="text-sm font-bold">{lang === 'ar' ? activeLab.titleAr : activeLab.titleEn}</h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setRunning((r) => !r)}
                      className="px-3 py-1.5 rounded-lg glass-btn-primary text-xs font-semibold flex items-center gap-1"
                    >
                      {running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      <span>{running ? (lang === 'ar' ? 'إيقاف' : 'Pause') : (lang === 'ar' ? 'تشغيل' : 'Play')}</span>
                    </button>
                    <button
                      onClick={() => {
                        setRunning(false);
                        setSimTime((t) => t + 0.05);
                      }}
                      className="p-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs transition-colors"
                      title="Step"
                    >
                      <StepForward className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={resetSimulation}
                      className="p-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs transition-colors"
                      title="Reset"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <canvas ref={canvasRef} width={680} height={310} className="w-full rounded-xl border border-slate-800" />
                <canvas ref={graphCanvasRef} width={680} height={140} className="w-full rounded-xl border border-slate-800" />
              </div>
            </div>

            {/* Scientific Explanation & Equations */}
            <div className="rounded-2xl glass-card p-6 space-y-4">
              <h3 className="text-base font-bold">
                {lang === 'ar' ? 'المعادلات المستخدمة والتفسير العلمي' : 'Governing Equations & Scientific Explanation'}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {activeLab.equationsLatex.map((eq, i) => (
                  <LatexBlock key={i} latex={eq} />
                ))}
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                {lang === 'ar' ? activeLab.scientificExplanationAr : activeLab.scientificExplanationEn}
              </p>
            </div>
          </div>

          {/* Right Control & Procedure Deck */}
          <div className="lg:col-span-4 space-y-4">
            <div className="rounded-2xl glass-card p-5 space-y-4">
              <h3 className="text-sm font-bold">
                {lang === 'ar' ? 'أدوات التحكم في المتغيرات' : 'Parameter Controls'}
              </h3>

              {activeLab.simKey === 'linear_freefall' && (
                <div className="space-y-3 text-xs">
                  <label className="block">
                    <span>{lang === 'ar' ? 'الارتفاع الابتدائي' : 'Initial Height'}: {initHeight} m</span>
                    <input type="range" min={10} max={100} value={initHeight} onChange={(e) => setInitHeight(+e.target.value)} className="w-full accent-blue-600" />
                  </label>
                  <label className="block">
                    <span>{lang === 'ar' ? 'عجلة الجاذبية g' : 'Gravity g'}: {gravity} m/s²</span>
                    <input type="range" min={1.6} max={20} step={0.1} value={gravity} onChange={(e) => setGravity(+e.target.value)} className="w-full accent-blue-600" />
                  </label>
                </div>
              )}

              {activeLab.simKey === 'projectile' && (
                <div className="space-y-3 text-xs">
                  <label className="block">
                    <span>{lang === 'ar' ? 'السرعة الابتدائية v₀' : 'Launch Speed v₀'}: {initSpeed} m/s</span>
                    <input type="range" min={10} max={45} value={initSpeed} onChange={(e) => setInitSpeed(+e.target.value)} className="w-full accent-blue-600" />
                  </label>
                  <label className="block">
                    <span>{lang === 'ar' ? 'زاوية الإطلاق θ' : 'Angle θ'}: {angleDeg}°</span>
                    <input type="range" min={10} max={85} value={angleDeg} onChange={(e) => setAngleDeg(+e.target.value)} className="w-full accent-blue-600" />
                  </label>
                  <label className="block">
                    <span>{lang === 'ar' ? 'الجاذبية g' : 'Gravity g'}: {gravity} m/s²</span>
                    <input type="range" min={1.6} max={20} step={0.1} value={gravity} onChange={(e) => setGravity(+e.target.value)} className="w-full accent-blue-600" />
                  </label>
                </div>
              )}

              {activeLab.simKey === 'newton_incline' && (
                <div className="space-y-3 text-xs">
                  <label className="block">
                    <span>{lang === 'ar' ? 'زاوية الميل θ' : 'Incline Angle θ'}: {angleDeg}°</span>
                    <input type="range" min={5} max={60} value={angleDeg} onChange={(e) => setAngleDeg(+e.target.value)} className="w-full accent-blue-600" />
                  </label>
                  <label className="block">
                    <span>{lang === 'ar' ? 'معامل الاحتكاك μₖ' : 'Kinetic Friction μₖ'}: {frictionMu.toFixed(2)}</span>
                    <input type="range" min={0} max={0.8} step={0.05} value={frictionMu} onChange={(e) => setFrictionMu(+e.target.value)} className="w-full accent-blue-600" />
                  </label>
                </div>
              )}

              {activeLab.simKey === 'collisions' && (
                <div className="space-y-3 text-xs">
                  <label className="block">
                    <span>m₁: {mass1} kg</span>
                    <input type="range" min={1} max={10} value={mass1} onChange={(e) => setMass1(+e.target.value)} className="w-full accent-blue-600" />
                  </label>
                  <label className="block">
                    <span>m₂: {mass2} kg</span>
                    <input type="range" min={1} max={10} value={mass2} onChange={(e) => setMass2(+e.target.value)} className="w-full accent-blue-600" />
                  </label>
                  <label className="block">
                    <span>v₁: {vel1} m/s</span>
                    <input type="range" min={1} max={8} value={vel1} onChange={(e) => setVel1(+e.target.value)} className="w-full accent-blue-600" />
                  </label>
                  <label className="block">
                    <span>v₂: {vel2} m/s</span>
                    <input type="range" min={-6} max={0} value={vel2} onChange={(e) => setVel2(+e.target.value)} className="w-full accent-blue-600" />
                  </label>
                  <label className="block">
                    <span>{lang === 'ar' ? 'معامل الارتداد e' : 'Restitution e'}: {restitution}</span>
                    <input type="range" min={0} max={1} step={0.1} value={restitution} onChange={(e) => setRestitution(+e.target.value)} className="w-full accent-blue-600" />
                  </label>
                </div>
              )}

              {activeLab.simKey === 'ohms_circuits' && (
                <div className="space-y-3 text-xs">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCircuitType('series')}
                      className={`flex-1 py-1.5 rounded-lg border ${circuitType === 'series' ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-700'}`}
                    >
                      {lang === 'ar' ? 'توالي (Series)' : 'Series'}
                    </button>
                    <button
                      onClick={() => setCircuitType('parallel')}
                      className={`flex-1 py-1.5 rounded-lg border ${circuitType === 'parallel' ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-700'}`}
                    >
                      {lang === 'ar' ? 'توازي (Parallel)' : 'Parallel'}
                    </button>
                  </div>
                  <label className="block">
                    <span>{lang === 'ar' ? 'الجهد V' : 'Voltage V'}: {voltage} V</span>
                    <input type="range" min={2} max={24} value={voltage} onChange={(e) => setVoltage(+e.target.value)} className="w-full accent-blue-600" />
                  </label>
                  <label className="block">
                    <span>R₁: {res1} Ω</span>
                    <input type="range" min={1} max={20} value={res1} onChange={(e) => setRes1(+e.target.value)} className="w-full accent-blue-600" />
                  </label>
                  <label className="block">
                    <span>R₂: {res2} Ω</span>
                    <input type="range" min={1} max={20} value={res2} onChange={(e) => setRes2(+e.target.value)} className="w-full accent-blue-600" />
                  </label>
                </div>
              )}

              {activeLab.simKey === 'waves_interference' && (
                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-3 gap-1">
                    {(['transverse', 'longitudinal', 'interference'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setWaveMode(m)}
                        className={`py-1.5 rounded-lg border ${waveMode === m ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-700'}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <label className="block">
                    <span>{lang === 'ar' ? 'السعة A' : 'Amplitude A'}: {waveAmp} px</span>
                    <input type="range" min={10} max={70} value={waveAmp} onChange={(e) => setWaveAmp(+e.target.value)} className="w-full accent-blue-600" />
                  </label>
                  <label className="block">
                    <span>{lang === 'ar' ? 'التردد f' : 'Frequency f'}: {waveFreq} Hz</span>
                    <input type="range" min={0.5} max={4} step={0.1} value={waveFreq} onChange={(e) => setWaveFreq(+e.target.value)} className="w-full accent-blue-600" />
                  </label>
                  {waveMode === 'interference' && (
                    <label className="block">
                      <span>{lang === 'ar' ? 'فرق الطور φ' : 'Phase φ'}: {wavePhaseDeg}°</span>
                      <input type="range" min={0} max={360} step={15} value={wavePhaseDeg} onChange={(e) => setWavePhaseDeg(+e.target.value)} className="w-full accent-blue-600" />
                    </label>
                  )}
                </div>
              )}

              {activeLab.simKey === 'magnetism_induction' && (
                <div className="space-y-3 text-xs">
                  <div className="flex gap-2">
                    <button onClick={() => setMagMode('faraday')} className={`flex-1 py-1.5 rounded-lg border ${magMode === 'faraday' ? 'bg-blue-600 text-white' : 'border-slate-300 dark:border-slate-700'}`}>Faraday Coil</button>
                    <button onClick={() => setMagMode('lorentz')} className={`flex-1 py-1.5 rounded-lg border ${magMode === 'lorentz' ? 'bg-blue-600 text-white' : 'border-slate-300 dark:border-slate-700'}`}>Lorentz Force</button>
                  </div>
                  <label className="block">
                    <span>B-Field: {bField} T</span>
                    <input type="range" min={0.4} max={3} step={0.1} value={bField} onChange={(e) => setBField(+e.target.value)} className="w-full accent-blue-600" />
                  </label>
                  {magMode === 'faraday' ? (
                    <label className="block">
                      <span>Turns N: {coilTurns}</span>
                      <input type="range" min={50} max={400} step={25} value={coilTurns} onChange={(e) => setCoilTurns(+e.target.value)} className="w-full accent-blue-600" />
                    </label>
                  ) : (
                    <label className="block">
                      <span>Charge Speed v: {chargeVel}</span>
                      <input type="range" min={2} max={12} value={chargeVel} onChange={(e) => setChargeVel(+e.target.value)} className="w-full accent-blue-600" />
                    </label>
                  )}
                </div>
              )}

              {activeLab.simKey === 'optics_bench' && (
                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-3 gap-1">
                    {(['converging', 'diverging', 'snell'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setOpticsMode(m)}
                        className={`py-1.5 rounded-lg border ${opticsMode === m ? 'bg-blue-600 text-white' : 'border-slate-300 dark:border-slate-700'}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  {opticsMode === 'snell' ? (
                    <>
                      <label className="block">
                        <span>θ₁: {snellAngle}°</span>
                        <input type="range" min={5} max={80} value={snellAngle} onChange={(e) => setSnellAngle(+e.target.value)} className="w-full accent-blue-600" />
                      </label>
                      <label className="block">
                        <span>n₁: {snellN1}</span>
                        <input type="range" min={1.0} max={2.0} step={0.05} value={snellN1} onChange={(e) => setSnellN1(+e.target.value)} className="w-full accent-blue-600" />
                      </label>
                      <label className="block">
                        <span>n₂: {snellN2}</span>
                        <input type="range" min={1.0} max={2.0} step={0.05} value={snellN2} onChange={(e) => setSnellN2(+e.target.value)} className="w-full accent-blue-600" />
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="block">
                        <span>{lang === 'ar' ? 'البعد البؤري f' : 'Focal Length f'}: {focalLength}</span>
                        <input type="range" min={40} max={130} value={focalLength} onChange={(e) => setFocalLength(+e.target.value)} className="w-full accent-blue-600" />
                      </label>
                      <label className="block">
                        <span>{lang === 'ar' ? 'بعد الجسم d₀' : 'Object Distance d₀'}: {objDist}</span>
                        <input type="range" min={45} max={260} value={objDist} onChange={(e) => setObjDist(+e.target.value)} className="w-full accent-blue-600" />
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Experiment Procedure */}
            <div className="rounded-2xl glass-card p-5 space-y-2.5">
              <h3 className="text-sm font-bold">
                {lang === 'ar' ? 'خطوات تنفيذ التجربة' : 'Lab Procedure'}
              </h3>
              <ol className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 list-decimal list-inside">
                {(lang === 'ar' ? activeLab.procedureAr : activeLab.procedureEn).map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>

            {/* Post-Lab Questions */}
            <div className="rounded-2xl glass-card p-5 space-y-3">
              <h3 className="text-sm font-bold">
                {lang === 'ar' ? 'أسئلة التحقق بعد التجربة' : 'Post-Lab Check'}
              </h3>
              {activeLab.postQuestions.map((pq, qIdx) => (
                <div key={qIdx} className="space-y-2 text-xs">
                  <p className="font-medium">{lang === 'ar' ? pq.qAr : pq.qEn}</p>
                  <div className="space-y-1.5">
                    {(lang === 'ar' ? pq.optionsAr : pq.optionsEn).map((opt, oIdx) => {
                      const picked = postAnswers[qIdx] === oIdx;
                      const correct = pq.correctIndex === oIdx;
                      return (
                        <button
                          key={oIdx}
                          onClick={() => setPostAnswers((p) => ({ ...p, [qIdx]: oIdx }))}
                          className={`w-full text-start p-2.5 rounded-xl border flex items-center justify-between transition-all ${
                            postAnswers[qIdx] === undefined
                              ? 'glass-btn-secondary'
                              : correct
                              ? 'border-emerald-500/70 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : picked
                              ? 'border-rose-500/70 bg-rose-500/15 text-rose-500'
                              : 'border-slate-200/40 dark:border-white/10 opacity-60'
                          }`}
                        >
                          <span>{opt}</span>
                          {postAnswers[qIdx] !== undefined && correct && <CheckCircle2 className="w-3.5 h-3.5" />}
                        </button>
                      );
                    })}
                  </div>
                  {postAnswers[qIdx] !== undefined && (
                    <p className="text-slate-500 dark:text-slate-400">
                      {lang === 'ar' ? pq.reasonAr : pq.reasonEn}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
