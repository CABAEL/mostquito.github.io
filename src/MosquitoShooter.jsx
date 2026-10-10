import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ─── Assets ──────────────────────────────────────────────────────────────────
import mosquitoImg from './assets/mosquito.png';
import lightImg from './assets/light.png';
import wallImg from './assets/wall.png';
import buzzSound from './assets/freesound_community-flying-mosquito-105770.mp3';

// ─── Tuning ──────────────────────────────────────────────────────────────────
const MOSQUITO_SIZE = 28;      // px, rendered size of each mosquito
const MOSQUITO_SPEED = 1.2;    // flight speed multiplier: 1 = lazy circling, 2 = fast. Paths stay smooth either way
const HIT_RADIUS = 22;         // px, crosshair centre must land this close to a mosquito centre
const HIT_RADIUS_TOUCH = 36;   // px, more forgiving for fingers
const LIGHT_WIDTH = 260;       // px
const LIGHT_TOP = -50;         // px, the lamp hangs partly off the top edge
const BULB_X = 0.5;            // where the bulb sits inside the lamp image (fraction of width)...
const BULB_Y = 0.75;           // ...and height. Mosquitoes orbit it and the halo is centred on it
const HALO_SIZE = 640;         // px, diameter of the glow around the bulb
const MAX_VOLUME = 0.8;        // loudest the buzz gets (0 to 1), reached when the swarm is at its biggest
const MAX_MOSQUITOES = 1000;    // this many alive at once and the "browser" crashes
const STRAIN_AT = 70;          // wall starts to shake from here
const START_SPAWN_MS = 3200;   // gap between new mosquitoes at the start...
const MIN_SPAWN_MS = 800;      // ...shrinking down to this
const SPAWN_RAMP = 40;         // ms shaved off the gap per second played

// Gray palette
const G_BG = 'rgba(28,28,28,0.86)';
const G_LINE = 'rgba(255,255,255,0.14)';
const G_TEXT = '#e6e6e6';
const G_MUTED = '#9b9b9b';
const G_CARD = '#e4e4e4';
const G_INK = '#1f1f1f';
const G_BTN = '#3a3a3a';

// Crosshair cursor styling
const CROSSHAIR_SIZE = 40;
const CROSSHAIR_CURSOR = (() => {
  const s = CROSSHAIR_SIZE;
  const c = s / 2;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}' viewBox='0 0 ${s} ${s}'>` +
    `<path d='M${c} 2V${s - 2}M2 ${c}H${s - 2}' stroke='rgba(0,0,0,0.55)' stroke-width='5' fill='none'/>` +
    `<path d='M${c} 3V${s - 3}M3 ${c}H${s - 3}' stroke='white' stroke-width='2.5' fill='none'/>` +
    `</svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${c} ${c}, crosshair`;
})();

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtMs = (ms) =>
  ms == null ? '–' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
const fmtTime = (ms) => `${(ms / 1000).toFixed(1)} s`;

const styles = `
.ms-root { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; touch-action: none; overscroll-behavior: none; }
.ms-root [data-ui] { cursor: default; }
.ms-root button { cursor: pointer; font-family: inherit; }
.ms-root button:focus-visible { outline: 2px solid #ffffff; outline-offset: 2px; }

@keyframes ms-swing  { 0% { transform: rotate(-2.5deg); } 50% { transform: rotate(2.5deg); } 100% { transform: rotate(-2.5deg); } }
@keyframes ms-buzz   { 0% { transform: translate(0,0); } 25% { transform: translate(1px,-1px); } 50% { transform: translate(-1px,1px); } 75% { transform: translate(1px,1px); } 100% { transform: translate(0,0); } }
@keyframes ms-flash  { from { transform: translate(-50%,-50%) scale(.3); opacity: 1; } to { transform: translate(-50%,-50%) scale(1.8); opacity: 0; } }
@keyframes ms-pop    { from { transform: translate(-50%,-50%); opacity: 1; } to { transform: translate(-50%,-190%); opacity: 0; } }
@keyframes ms-rise   { from { transform: translateY(14px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes ms-glow   { 0% { transform: scale(1); opacity: .92; } 50% { transform: scale(1.05); opacity: 1; } 100% { transform: scale(1); opacity: .92; } }
@keyframes ms-strain { 0% { transform: translate(0,0); } 25% { transform: translate(-2px,1px); } 50% { transform: translate(2px,-1px); } 75% { transform: translate(-1px,-2px); } 100% { transform: translate(0,0); } }

.ms-swing  { animation: ms-swing 4s ease-in-out infinite; transform-origin: top center; }
.ms-buzz   { animation: ms-buzz .09s linear infinite; }
.ms-modal  { animation: ms-rise .25s ease-out; }
.ms-strain { animation: ms-strain .14s linear infinite; }
.ms-btn:hover { filter: brightness(1.2); }
.ms-halo   { animation: ms-glow 5s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .ms-swing, .ms-buzz, .ms-modal, .ms-strain, .ms-halo { animation: none; }
}
`;

// ─── Component ───────────────────────────────────────────────────────────────
const MosquitoShooter = ({ fullscreen = true }) => {
  const boxRef = useRef(null);
  const lightRef = useRef(null);

  const mosqs = useRef(new Map());
  const mosqEls = useRef(new Map());
  const nextId = useRef(0);

  const startRef = useRef(null);
  const hitsRef = useRef(0);
  const phaseRef = useRef('idle');
  const audioRef = useRef(null);

  const [phase, setPhase] = useState('idle');
  const [endReason, setEndReason] = useState('stopped');
  const [ids, setIds] = useState([]);
  const [aliveCount, setAliveCount] = useState(0);
  const [stats, setStats] = useState({ shots: 0, hits: 0, reactions: [] });
  const [elapsed, setElapsed] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [flashes, setFlashes] = useState([]);
  const [popups, setPopups] = useState([]);
  const [muted, setMuted] = useState(false);
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  );
  const [coarse, setCoarse] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  );

  useEffect(() => {
    const mqNarrow = window.matchMedia('(max-width: 640px)');
    const mqCoarse = window.matchMedia('(pointer: coarse)');
    const onNarrow = (e) => setNarrow(e.matches);
    const onCoarse = (e) => setCoarse(e.matches);
    mqNarrow.addEventListener('change', onNarrow);
    mqCoarse.addEventListener('change', onCoarse);
    return () => {
      mqNarrow.removeEventListener('change', onNarrow);
      mqCoarse.removeEventListener('change', onCoarse);
    };
  }, []);

  phaseRef.current = phase;

  // ── Buzz sound ─────────────────────────────────────────────────────────────
  const startBuzz = () => {
    let a = audioRef.current;
    if (!a) {
      const el = new Audio(buzzSound);
      el.loop = true;
      el.preload = 'auto';
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination);
        a = { el, ctx, gain };
      } else {
        a = { el, ctx: null, gain: null };
      }
      audioRef.current = a;
    }
    if (a.ctx && a.ctx.state === 'suspended') a.ctx.resume();
    a.el.play().catch(() => {});
  };

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const active = phase === 'playing' && !muted;
    const vol = active
      ? MAX_VOLUME * Math.min(1, 0.1 + 0.9 * Math.sqrt(aliveCount / MAX_MOSQUITOES))
      : 0;
    if (a.gain) a.gain.gain.setTargetAtTime(vol, a.ctx.currentTime, 0.2);
    else a.el.volume = vol;
    if (!active) a.el.pause();
    else if (a.el.paused) a.el.play().catch(() => {});
  }, [aliveCount, phase, muted]);

  useEffect(() => {
    const onVisibility = () => {
      const a = audioRef.current;
      if (!a) return;
      if (document.hidden) a.el.pause();
      else if (phaseRef.current === 'playing' && !muted) a.el.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [muted]);

  useEffect(
    () => () => {
      const a = audioRef.current;
      if (!a) return;
      a.el.pause();
      if (a.ctx) a.ctx.close();
      audioRef.current = null;
    },
    []
  );

  // ── Swarm bookkeeping ──────────────────────────────────────────────────────
  const syncSwarm = useCallback(() => {
    const all = Array.from(mosqs.current.values());
    setIds(all.map((m) => m.id));
    setAliveCount(all.filter((m) => m.alive).length);
  }, []);

  const getAnchor = useCallback((w) => {
    const el = lightRef.current;
    const lh = el ? el.offsetHeight : 0;
    return { x: w / 2 + (BULB_X - 0.5) * LIGHT_WIDTH, y: lh > 40 ? el.offsetTop + lh * BULB_Y : 210 };
  }, []);

  const spawnMosquito = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const w = box.clientWidth;
    const h = box.clientHeight;
    const id = ++nextId.current;
    const fromLeft = Math.random() < 0.5;
    mosqs.current.set(id, {
      id,
      x: fromLeft ? -40 : w + 40,
      y: h * (0.25 + Math.random() * 0.55),
      vx: 0, vy: 0,
      alive: true,
      spawnedAt: performance.now(),
      deadAt: 0, fallV: 0, rot: 0, opacity: 1,
      ang: Math.random() * Math.PI * 2,
      omega: (0.8 + Math.random() * 0.7) * (Math.random() < 0.5 ? -1 : 1),
      rScale: 0.35 + Math.random() * 0.65,
      sy: 0.6 + Math.random() * 0.25,
      lob: Math.random() < 0.35 ? 2 : 1,
      rf: 0.4 + Math.random() * 0.5,
      seed: Math.random() * 100,
    });
    syncSwarm();
  }, [syncSwarm]);

  // ── Flight loop ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mosqs.current.size === 0) spawnMosquito();

    let raf;
    let last = performance.now();

    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const box = boxRef.current;
      if (!box) return;
      if (phaseRef.current !== 'idle' && phaseRef.current !== 'playing') return;

      const w = box.clientWidth;
      const h = box.clientHeight;
      const anchor = getAnchor(w);
      const speedMul = 1 + Math.min(hitsRef.current, 15) * 0.04;
      let removed = false;

      mosqs.current.forEach((m, id) => {
        if (m.alive) {
          const t = now / 1000;
          m.ang += m.omega * MOSQUITO_SPEED * speedMul * dt;
          const base = Math.min(w * 0.32, 270);
          const breathe = 1 + 0.3 * Math.sin(t * m.rf + m.seed);
          const lap = 1 + 0.9 * Math.pow(Math.max(0, Math.sin(t * 0.2 + m.seed * 1.7)), 3);
          const r = base * m.rScale * breathe * lap;
          let px = anchor.x + r * Math.cos(m.ang) + 12 * Math.sin(t * 6.5 + m.seed);
          let py = anchor.y + r * m.sy * Math.sin(m.ang * m.lob) + 12 * Math.cos(t * 7.7 + m.seed * 2);
          px = Math.max(24, Math.min(w - 24, px));
          py = Math.max(30, Math.min(h - 110, py));

          const offscreen = m.x < 0 || m.x > w;
          const dx = px - m.x;
          const dy = py - m.y;
          const dist = Math.hypot(dx, dy) || 1;
          const maxSp = (offscreen ? 520 : 380) * MOSQUITO_SPEED;
          const sp = Math.min(dist * 4, maxSp);
          const k = Math.min(1, dt * 6);
          m.vx += ((dx / dist) * sp - m.vx) * k;
          m.vy += ((dy / dist) * sp - m.vy) * k;
          m.x += m.vx * dt;
          m.y += m.vy * dt;

          const lean = Math.max(-20, Math.min(20, m.vx * 0.05));
          m.rot += (lean - m.rot) * Math.min(1, dt * 8);
        } else {
          m.fallV += 1400 * dt;
          m.y += m.fallV * dt;
          m.rot += 400 * dt;
          m.opacity = Math.max(0, 1 - (now - m.deadAt) / 700);
          if (now - m.deadAt > 750) {
            mosqs.current.delete(id);
            removed = true;
            return;
          }
        }

        const el = mosqEls.current.get(id);
        if (el) {
          el.style.transform = `translate3d(${m.x - MOSQUITO_SIZE / 2}px, ${m.y - MOSQUITO_SIZE / 2}px, 0) rotate(${m.rot}deg)`;
          el.style.opacity = m.opacity;
        }
      });

      if (removed) syncSwarm();
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getAnchor, spawnMosquito, syncSwarm]);

  // ── Spawner ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing') return undefined;
    let timer;
    const schedule = () => {
      const t = (performance.now() - startRef.current) / 1000;
      const gap = Math.max(MIN_SPAWN_MS, START_SPAWN_MS - t * SPAWN_RAMP);
      timer = setTimeout(() => {
        spawnMosquito();
        schedule();
      }, gap * (0.7 + Math.random() * 0.6));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [phase, spawnMosquito]);

  // ── Too many alive (browser crash) ─────────────────────────────────────────
  useEffect(() => {
    if (phase === 'playing' && aliveCount >= MAX_MOSQUITOES) {
      setDurationMs(performance.now() - startRef.current);
      setEndReason('crashed');
      setPhase('crashed');
    }
  }, [aliveCount, phase]);

  // ── HUD timer ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing') return undefined;
    const id = setInterval(() => setElapsed(performance.now() - startRef.current), 100);
    return () => clearInterval(id);
  }, [phase]);

  const roundOver = phase === 'crashed' || phase === 'finished';

  // ── Shooting ───────────────────────────────────────────────────────────────
  const handlePointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (roundOver || e.target.closest('[data-ui]')) return;

    const rect = boxRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const now = performance.now();
    const isFirstClick = phase === 'idle';
    if (isFirstClick) {
      startRef.current = now;
      startBuzz();
      setElapsed(0);
      setPhase('playing');
    }

    const radius = e.pointerType === 'touch' ? HIT_RADIUS_TOUCH : HIT_RADIUS;
    let target = null;
    let best = Infinity;
    mosqs.current.forEach((m) => {
      if (!m.alive) return;
      const d = Math.hypot(x - m.x, y - m.y);
      if (d <= radius && d < best) {
        best = d;
        target = m;
      }
    });

    const hit = !!target;
    let reaction = null;

    if (hit) {
      reaction = now - (isFirstClick ? target.spawnedAt : Math.max(target.spawnedAt, startRef.current));
      target.alive = false;
      target.deadAt = now;
      target.fallV = -140;
      hitsRef.current += 1;
      syncSwarm();

      const anyLeft = Array.from(mosqs.current.values()).some((m) => m.alive);
      if (!anyLeft) {
        setTimeout(() => {
          if (phaseRef.current === 'playing') spawnMosquito();
        }, 600);
      }
    }

    setStats((s) => ({
      shots: s.shots + 1,
      hits: s.hits + (hit ? 1 : 0),
      reactions: hit ? [...s.reactions, reaction] : s.reactions,
    }));

    const id = `${now}-${Math.random()}`;
    setFlashes((f) => [...f, { id, x, y }]);
    setTimeout(() => setFlashes((f) => f.filter((s) => s.id !== id)), 260);

    setPopups((p) => [...p, { id, x, y, hit, text: hit ? `Hit  ${fmtMs(reaction)}` : 'Miss' }]);
    setTimeout(() => setPopups((p) => p.filter((s) => s.id !== id)), 850);
  };

  const stopGame = () => {
    setDurationMs(performance.now() - startRef.current);
    setEndReason('stopped');
    setPhase('finished');
  };

  const playAgain = () => {
    startRef.current = null;
    hitsRef.current = 0;
    mosqs.current.clear();
    setStats({ shots: 0, hits: 0, reactions: [] });
    setElapsed(0);
    setDurationMs(0);
    setEndReason('stopped');
    setPhase('idle');
    spawnMosquito();
  };

  const summary = useMemo(() => {
    const { shots, hits, reactions } = stats;
    return {
      shots,
      hits,
      misses: shots - hits,
      accuracy: shots ? Math.round((hits / shots) * 100) : 0,
      avg: reactions.length ? reactions.reduce((a, b) => a + b, 0) / reactions.length : null,
      best: reactions.length ? Math.min(...reactions) : null,
    };
  }, [stats]);

  // ── Download Stats as Image ───────────────────────────────────────────────
  const downloadStatsImage = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 500;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background card fill
    ctx.fillStyle = '#e4e4e4';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Title
    ctx.fillStyle = '#1f1f1f';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(
      endReason === 'crashed'
        ? 'Browser Crashed'
        : summary.hits === 0
          ? 'The Mosquitoes Won'
          : `${summary.hits} Mosquito${summary.hits === 1 ? '' : 'es'} Down`,
      40,
      60
    );

    // Subtitle
    ctx.fillStyle = '#666666';
    ctx.font = '16px sans-serif';
    ctx.fillText(
      endReason === 'crashed'
        ? `Lasted ${fmtTime(durationMs)} against the swarm.`
        : `${fmtTime(durationMs)} played, ${summary.shots} shots fired.`,
      40,
      90
    );

    // Stats Grid Cells
    const cells = [
      { label: 'Hits', value: summary.hits },
      { label: 'Misses', value: summary.misses },
      { label: 'Accuracy', value: `${summary.accuracy}%` },
      { label: 'Time played', value: fmtTime(durationMs) },
      { label: 'Average reaction', value: fmtMs(summary.avg) },
      { label: 'Best reaction', value: fmtMs(summary.best) },
    ];

    const startX = 40;
    const startY = 130;
    const cellW = 245;
    const cellH = 75;
    const gapX = 30;
    const gapY = 15;

    cells.forEach((cell, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = startX + col * (cellW + gapX);
      const y = startY + row * (cellH + gapY);

      ctx.fillStyle = 'rgba(0,0,0,0.07)';
      ctx.beginPath();
      ctx.roundRect(x, y, cellW, cellH, 10);
      ctx.fill();

      ctx.fillStyle = '#1f1f1f';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText(String(cell.value), x + 18, y + 35);

      ctx.fillStyle = '#666666';
      ctx.font = '13px sans-serif';
      ctx.fillText(cell.label, x + 18, y + 58);
    });

    // Watermark / Branding
    ctx.fillStyle = '#9b9b9b';
    ctx.font = '12px sans-serif';
    ctx.fillText('Most-quito Shooter Game', 40, 460);

    // Trigger Download
    const link = document.createElement('a');
    link.download = 'mosquito-shooter-stats.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const playing = phase === 'playing';
  const liveAcc = stats.shots ? Math.round((stats.hits / stats.shots) * 100) : 0;
  const liveAvg = stats.reactions.length
    ? stats.reactions.reduce((a, b) => a + b, 0) / stats.reactions.length
    : null;
  const strained = playing && aliveCount >= STRAIN_AT;

  return (
    <div
      ref={boxRef}
      className="ms-root"
      onPointerDown={handlePointerDown}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      style={{
        ...(fullscreen
          ? { position: 'fixed', inset: 0, width: '100%', height: '100dvh', zIndex: 1000 }
          : { position: 'relative', width: '100%', height: '100vh', minHeight: 520 }),
        overflow: 'hidden',
        fontFamily: 'inherit',
        color: G_TEXT,
        cursor: roundOver ? 'default' : CROSSHAIR_CURSOR,
      }}
    >
      <style>{styles}</style>

      {/* Wall Background */}
      <div
        className={strained ? 'ms-strain' : undefined}
        style={{
          position: 'absolute',
          inset: -6,
          backgroundImage: `url(${wallImg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* Hanging Lamp */}
      <div
        ref={lightRef}
        className="ms-swing"
        style={{
          position: 'absolute',
          top: LIGHT_TOP,
          left: '50%',
          marginLeft: -LIGHT_WIDTH / 2,
          width: LIGHT_WIDTH,
          pointerEvents: 'none',
          zIndex: 2,
        }}
      >
        <div
          className="ms-halo"
          style={{
            position: 'absolute',
            left: `${BULB_X * 100}%`,
            top: `${BULB_Y * 100}%`,
            width: HALO_SIZE,
            height: HALO_SIZE,
            marginLeft: -HALO_SIZE / 2,
            marginTop: -HALO_SIZE / 2,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(255,251,232,0.9) 0%, rgba(255,238,176,0.6) 10%, rgba(255,224,135,0.32) 28%, rgba(255,210,110,0.12) 50%, rgba(255,210,110,0) 70%)',
            pointerEvents: 'none',
          }}
        />
        <img
          src={lightImg}
          alt="Hanging lamp"
          draggable={false}
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'block',
            width: '100%',
            borderTop: '5px solid #333333',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Swarm */}
      {ids.map((id) => (
        <div
          key={id}
          ref={(el) => {
            if (el) mosqEls.current.set(id, el);
            else mosqEls.current.delete(id);
          }}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: MOSQUITO_SIZE,
            height: MOSQUITO_SIZE,
            transform: 'translate3d(-200px, -200px, 0)',
            zIndex: 3,
            pointerEvents: 'none',
            willChange: 'transform, opacity',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
          }}
        >
          <img
            className="ms-buzz"
            src={mosquitoImg}
            alt="Mosquito"
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
          />
        </div>
      ))}

      {/* Muzzle Flashes */}
      {flashes.map((f) => (
        <div
          key={f.id}
          style={{
            position: 'absolute',
            left: f.x,
            top: f.y,
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'radial-gradient(circle, #ffffff 15%, #c4c4c4 45%, #6e6e6e 70%, rgba(110,110,110,0) 100%)',
            boxShadow: '0 0 22px rgba(255,255,255,0.8), 0 0 8px #ffffff',
            animation: 'ms-flash .22s ease-out forwards',
            pointerEvents: 'none',
            zIndex: 8,
          }}
        />
      ))}

      {/* Hit / Miss Popups */}
      {popups.map((p) => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            fontSize: p.hit ? 18 : 14,
            fontWeight: 700,
            color: p.hit ? '#ffffff' : G_MUTED,
            textShadow: '0 1px 6px rgba(0,0,0,0.85)',
            whiteSpace: 'pre',
            animation: 'ms-pop .85s ease-out forwards',
            pointerEvents: 'none',
            zIndex: 9,
          }}
        >
          {p.text}
        </div>
      ))}

      {/* Mute Button */}
      {!roundOver && (
        <button
          data-ui
          type="button"
          className="ms-btn"
          aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
          aria-pressed={muted}
          onClick={() => setMuted((m) => !m)}
          style={{
            position: 'absolute',
            top: 'calc(12px + env(safe-area-inset-top, 0px))',
            right: 12,
            width: 40,
            height: 40,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 10,
            border: `1px solid ${G_LINE}`,
            background: G_BG,
            color: G_TEXT,
            zIndex: 30,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 5 6 9H2v6h4l5 4V5z" fill="currentColor" />
            {muted ? (
              <>
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </>
            ) : (
              <>
                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                <path d="M19 5a10 10 0 0 1 0 14" />
              </>
            )}
          </svg>
        </button>
      )}

      {/* Start Hint */}
      {phase === 'idle' && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 'calc(28px + env(safe-area-inset-bottom, 0px))',
            textAlign: 'center',
            padding: '0 16px',
            fontSize: '0.8rem',
            letterSpacing: '0.05em',
            color: 'rgba(255,255,255,0.7)',
            textShadow: '0 1px 6px rgba(0,0,0,0.8)',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          {coarse ? 'Tap' : 'Click'} anywhere to start. Shoot the mosquitoes before they crash your browser.
        </div>
      )}

      {/* Live HUD */}
      {playing && (
        <div
          data-ui
          style={{
            position: 'absolute',
            left: '50%',
            bottom: `calc(${narrow ? 10 : 20}px + env(safe-area-inset-bottom, 0px))`,
            transform: 'translateX(-50%)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: narrow ? '8px 14px' : '10px 22px',
            width: 'max-content',
            maxWidth: 'calc(100% - 16px)',
            padding: narrow ? '10px 12px' : '12px 20px',
            borderRadius: 12,
            background: G_BG,
            border: `1px solid ${G_LINE}`,
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            zIndex: 30,
          }}
        >
          <Stat label="Time" value={fmtTime(elapsed)} />
          <Stat label="Shots" value={stats.shots} />
          <Stat label="Hits" value={stats.hits} />
          <Stat label="Accuracy" value={`${liveAcc}%`} />
          {!narrow && <Stat label="Avg reaction" value={fmtMs(liveAvg)} />}
          <Meter label="Browser load" value={aliveCount} max={MAX_MOSQUITOES} />
          <button
            type="button"
            className="ms-btn"
            onClick={stopGame}
            style={{
              padding: '10px 18px',
              borderRadius: 10,
              border: 'none',
              background: G_TEXT,
              color: G_INK,
              fontWeight: 700,
              fontSize: '0.9rem',
            }}
          >
            Stop
          </button>
        </div>
      )}

      {/* Crashed State */}
      {phase === 'crashed' && (
        <div
          data-ui
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: 24,
            textAlign: 'center',
            background: '#d9d9d9',
            color: '#3b3b3b',
            zIndex: 50,
          }}
        >
          <div style={{ fontSize: 'clamp(4rem, 14vw, 7rem)', fontWeight: 300, lineHeight: 1 }}>:(</div>
          <h2 style={{ margin: '8px 0 0', fontSize: '1.6rem' }}>This page crashed</h2>
          <p style={{ margin: 0, maxWidth: 420, color: '#666666', fontSize: '0.95rem' }}>
            Too many mosquitoes. Your browser gave up after {fmtTime(durationMs)}.
          </p>
          <button
            type="button"
            className="ms-btn"
            onClick={() => setPhase('finished')}
            style={{
              marginTop: 14,
              padding: '11px 22px',
              border: 'none',
              borderRadius: 10,
              background: G_BTN,
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.95rem',
            }}
          >
            See your results
          </button>
        </div>
      )}

      {/* Results Modal */}
      {phase === 'finished' && (
        <div
          data-ui
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            padding: 16,
            overflowY: 'auto',
            background: 'rgba(20,20,20,0.7)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            zIndex: 60,
          }}
        >
          <div
            className="ms-modal"
            role="dialog"
            aria-label="Your results"
            style={{
              width: '100%',
              maxWidth: 460,
              margin: 'auto',
              padding: narrow ? 20 : 26,
              borderRadius: 16,
              background: G_CARD,
              color: G_INK,
              boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: '1.6rem', lineHeight: 1.15, color: G_INK }}>
              {endReason === 'crashed'
                ? 'Browser crashed'
                : summary.hits === 0
                  ? 'The mosquitoes won this round'
                  : `${summary.hits} mostquito${summary.hits === 1 ? '' : 'es'}`}
            </h2>
            <p style={{ margin: '6px 0 18px', color: '#666666', fontSize: '0.95rem' }}>
              {endReason === 'crashed'
                ? `You lasted ${fmtTime(durationMs)} against the swarm.`
                : `${fmtTime(durationMs)} on the clock, ${summary.shots} shot${summary.shots === 1 ? '' : 's'} fired.`}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              <ResultCell label="Hits" value={summary.hits} />
              <ResultCell label="Misses" value={summary.misses} />
              <ResultCell label="Accuracy" value={`${summary.accuracy}%`} />
              <ResultCell label="Time played" value={fmtTime(durationMs)} />
              <ResultCell label="Average reaction" value={fmtMs(summary.avg)} />
              <ResultCell label="Best reaction" value={fmtMs(summary.best)} />
            </div>

            {/* Screenshot & Download Section */}
            <div
              style={{
                marginTop: 18,
                padding: '12px 14px',
                borderRadius: 10,
                background: 'rgba(0,0,0,0.05)',
                fontSize: '0.88rem',
                color: '#444444',
                lineHeight: 1.4,
              }}
            >
              📸 <strong>Take a screenshot</strong> of your stats to share on your socials, or download your scorecard image below!
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button
                type="button"
                className="ms-btn"
                onClick={downloadStatsImage}
                style={{
                  flex: 1,
                  padding: '11px 16px',
                  border: '1px solid #c4c4c4',
                  borderRadius: 10,
                  background: '#ffffff',
                  color: G_INK,
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download Stats Image
              </button>
            </div>

            <button
              type="button"
              className="ms-btn"
              onClick={playAgain}
              style={{
                marginTop: 18,
                width: '100%',
                padding: '13px 18px',
                border: 'none',
                borderRadius: 12,
                background: G_INK,
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '1rem',
              }}
            >
              Play again
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Small presentational pieces ─────────────────────────────────────────────
const Stat = ({ label, value }) => (
  <div style={{ textAlign: 'center', minWidth: 46 }}>
    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#ffffff', fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </div>
    <div style={{ fontSize: '0.75rem', color: G_MUTED }}>{label}</div>
  </div>
);

const Meter = ({ label, value, max }) => {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ flex: '1 1 120px', minWidth: 120 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: G_MUTED }}>
        <span>{label}</span>
        <span style={{ color: '#ffffff', fontVariantNumeric: 'tabular-nums' }}>{value}/{max}</span>
      </div>
      <div style={{ marginTop: 5, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.16)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: pct >= 70 ? '#ffffff' : '#a8a8a8', transition: 'width .2s ease-out' }} />
      </div>
    </div>
  );
};

const ResultCell = ({ label, value }) => (
  <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(0,0,0,0.07)' }}>
    <div style={{ fontSize: '1.4rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    <div style={{ fontSize: '0.8rem', color: '#666666' }}>{label}</div>
  </div>
);

export default MosquitoShooter;