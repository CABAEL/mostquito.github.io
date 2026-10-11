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
const MAX_MOSQUITOES = 1000;   // this many alive at once and the "browser" crashes
const STRAIN_AT = 70;          // wall starts to shake from here
const START_SPAWN_MS = 3200;   // gap between new mosquitoes at the start...
const MIN_SPAWN_MS = 800;      // ...shrinking down to this
const SPAWN_RAMP = 40;         // ms shaved off the gap per second played

// Camera "steps back" from the lamp before the game and steps forward when it starts.
const IDLE_ZOOM = 0.5;         // lamp + swarm scale before the game starts and on the results screen
const PLAY_ZOOM = 1;           // lamp + swarm scale while playing
const WALL_ZOOM_IDLE = 1;      // wall scale while stepped back (keep >= 1 so it always covers the screen)
const WALL_ZOOM_PLAY = 1.12;   // wall scale while playing: a slight push-in so the wall feels closer too (1 = off)
const ZOOM_ORIGIN_X = 0.5;     // the lamp hangs from the top centre, so the camera pulls back from there
const ZOOM_ORIGIN_Y = 0;
const ZOOM_MS = 1100;          // how long the step back / step forward takes
const ZOOM_EASE = 'cubic-bezier(0.22, 0.8, 0.2, 1)';

// Total average rating (weights add up to 100)
const W_ACCURACY = 30;         // hits / shots
const W_SPEED = 25;            // average reaction time
const W_QUICK = 10;            // best single reaction
const W_KILLS = 20;            // number of mosquitoes shot
const W_ENDURANCE = 15;        // how long you lasted
const AVG_RT_FULL = 600;       // ms, average reaction that earns full speed points...
const AVG_RT_ZERO = 4000;      // ...and the one that earns none
const BEST_RT_FULL = 300;      // ms, best reaction that earns full quick-draw points...
const BEST_RT_ZERO = 2000;    // ...and the one that earns none
const KILLS_FOR_FULL = 50;     // hits needed for full kill points
const SECONDS_FOR_FULL = 90;   // seconds played for full endurance points
const SAMPLE_SHOTS = 8;        // below this many shots the rating is scaled down (too little data)

const RANKS = [
  { min: 90, grade: 'S', title: 'Apex swatter' },
  { min: 80, grade: 'A', title: 'Sharpshooter' },
  { min: 65, grade: 'B', title: 'Steady hand' },
  { min: 50, grade: 'C', title: 'Warming up' },
  { min: 30, grade: 'D', title: 'Itchy skin' },
  { min: 0, grade: 'E', title: 'Free buffet' },
];

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

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lowerIsBetter = (v, full, zero) => (v == null ? 0 : clamp01((zero - v) / (zero - full)));

const computeRating = ({ shots, hits, avg, best, durationMs }) => {
  const parts = [
    { key: 'accuracy', label: 'Accuracy', weight: W_ACCURACY, score: shots ? hits / shots : 0 },
    { key: 'speed', label: 'Average reaction', weight: W_SPEED, score: lowerIsBetter(avg, AVG_RT_FULL, AVG_RT_ZERO) },
    { key: 'quick', label: 'Best reaction', weight: W_QUICK, score: lowerIsBetter(best, BEST_RT_FULL, BEST_RT_ZERO) },
    { key: 'kills', label: 'Mosquitoes shot', weight: W_KILLS, score: clamp01(hits / KILLS_FOR_FULL) },
    { key: 'endurance', label: 'Time survived', weight: W_ENDURANCE, score: clamp01(durationMs / 1000 / SECONDS_FOR_FULL) },
  ];
  const confidence = clamp01(shots / SAMPLE_SHOTS);
  const raw = parts.reduce((sum, p) => sum + p.score * p.weight, 0);
  const total = Math.round(raw * confidence);
  const rank = RANKS.find((r) => total >= r.min);
  return {
    total,
    confidence,
    grade: rank.grade,
    title: rank.title,
    parts: parts.map((p) => ({ ...p, pct: Math.round(p.score * 100) })),
  };
};

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
@keyframes ms-grow   { from { transform: scaleX(0); } to { transform: scaleX(1); } }

.ms-swing  { animation: ms-swing 4s ease-in-out infinite; transform-origin: top center; }
.ms-buzz   { animation: ms-buzz .09s linear infinite; }
.ms-modal  { animation: ms-rise .25s ease-out; }
.ms-strain { animation: ms-strain .14s linear infinite; }
.ms-btn:hover { filter: brightness(1.2); }
.ms-halo   { animation: ms-glow 5s ease-in-out infinite; }
.ms-grow   { animation: ms-grow .7s cubic-bezier(.16,1,.3,1) both; transform-origin: left center; }

@media (prefers-reduced-motion: reduce) {
  .ms-swing, .ms-buzz, .ms-modal, .ms-strain, .ms-halo, .ms-grow { animation: none; }
  .ms-camera, .ms-wall { transition: none !important; }
}
`;

// ─── Component ───────────────────────────────────────────────────────────────
const MosquitoShooter = ({ fullscreen = true }) => {
  const boxRef = useRef(null);
  const camRef = useRef(null);
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

  const getCamScale = useCallback(() => {
    const cam = camRef.current;
    const laidOut = cam ? cam.offsetWidth : 0;
    if (!laidOut) return 1;
    const s = cam.getBoundingClientRect().width / laidOut;
    return s > 0.01 ? s : 1;
  }, []);

  const spawnMosquito = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const w = box.clientWidth;
    const h = box.clientHeight;
    const id = ++nextId.current;
    const fromLeft = Math.random() < 0.5;
    const s = getCamScale();
    const ox = w * ZOOM_ORIGIN_X;
    const leftX = ox - (ox + 40) / s;
    const rightX = ox + (w - ox + 40) / s;
    mosqs.current.set(id, {
      id,
      x: fromLeft ? leftX : rightX,
      y: h * (0.25 + Math.random() * 0.55),
      vx: 0, vy: 0,
      alive: true,
      spawnedAt: performance.now(),
      deadAt: 0, opacity: 1,
      ang: Math.random() * Math.PI * 2,
      omega: (0.8 + Math.random() * 0.7) * (Math.random() < 0.5 ? -1 : 1),
      rScale: 0.35 + Math.random() * 0.65,
      sy: 0.6 + Math.random() * 0.25,
      lob: Math.random() < 0.35 ? 2 : 1,
      rf: 0.4 + Math.random() * 0.5,
      seed: Math.random() * 100,
    });
    syncSwarm();
  }, [syncSwarm, getCamScale]);

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
      const flying = phaseRef.current === 'idle' || phaseRef.current === 'playing';

      const w = box.clientWidth;
      const h = box.clientHeight;
      const anchor = getAnchor(w);
      const speedMul = 1 + Math.min(hitsRef.current, 15) * 0.04;
      let removed = false;

      mosqs.current.forEach((m, id) => {
        if (m.alive) {
          if (!flying) return;
          const t = now / 1000;
          m.ang += m.omega * MOSQUITO_SPEED * speedMul * dt;
          const base = Math.min(w * 0.32, 270);
          const breathe = 1 + 0.3 * Math.sin(t * m.rf + m.seed);
          const lap = 1 + 0.9 * Math.pow(Math.max(0, Math.sin(t * 0.2 + m.seed * 1.7)), 3);
          const r = base * m.rScale * breathe * lap;
          let px = anchor.x + r * Math.cos(m.ang) + 12 * Math.sin(t * 6.5 + m.seed);
          let py = anchor.y + r * m.sy * Math.sin(m.ang * m.lob) + 12 * Math.cos(t * 7.7 + m.seed * 2);
          px = Math.max(24, Math.min(w - 24, px));
          py = Math.max(30, Math.min(h - 30, py));

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
          // Slowly fade out in place upon hit over 2 seconds
          const fadeDuration = 2000;
          const age = now - m.deadAt;
          const progress = Math.min(1, age / fadeDuration);
          m.opacity = 1 - progress;
          m.rot += 50 * dt;

          if (progress >= 1) {
            mosqs.current.delete(id);
            removed = true;
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
  }, [getAnchor, getCamScale, spawnMosquito, syncSwarm]);

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

  const zoomedIn = phase === 'playing' || phase === 'crashed';
  const zoom = zoomedIn ? PLAY_ZOOM : IDLE_ZOOM;
  const wallZoom = zoomedIn ? WALL_ZOOM_PLAY : WALL_ZOOM_IDLE;

  const toScenePoint = (clientX, clientY) => {
    const rect = boxRef.current.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const scale = getCamScale();
    const ox = rect.width * ZOOM_ORIGIN_X;
    const oy = rect.height * ZOOM_ORIGIN_Y;
    return { x: ox + (px - ox) / scale, y: oy + (py - oy) / scale };
  };

  // ── Shooting ───────────────────────────────────────────────────────────────
  const handlePointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (roundOver || e.target.closest('[data-ui]')) return;

    const now = performance.now();

    if (phase === 'idle') {
      startRef.current = now;
      startBuzz();
      setElapsed(0);
      setPhase('playing');
      return;
    }

    const { x, y } = toScenePoint(e.clientX, e.clientY);

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
      reaction = now - Math.max(target.spawnedAt, startRef.current);
      target.alive = false;
      target.deadAt = now;
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

  const rating = useMemo(
    () =>
      computeRating({
        shots: summary.shots,
        hits: summary.hits,
        avg: summary.avg,
        best: summary.best,
        durationMs,
      }),
    [summary, durationMs]
  );

  const downloadStatsImage = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 740;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#e4e4e4';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

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

    ctx.fillStyle = '#666666';
    ctx.font = '16px sans-serif';
    ctx.fillText(
      endReason === 'crashed'
        ? `Lasted ${fmtTime(durationMs)} against the swarm.`
        : `${fmtTime(durationMs)} played, ${summary.shots} shots fired.`,
      40,
      90
    );

    ctx.fillStyle = '#1f1f1f';
    ctx.beginPath();
    ctx.roundRect(40, 115, 520, 110, 14);
    ctx.fill();

    ctx.fillStyle = '#9b9b9b';
    ctx.font = '14px sans-serif';
    ctx.fillText('Total average', 64, 147);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 60px sans-serif';
    ctx.fillText(String(rating.total), 64, 205);
    const scoreW = ctx.measureText(String(rating.total)).width;
    ctx.fillStyle = '#9b9b9b';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('/ 100', 64 + scoreW + 10, 205);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px sans-serif';
    ctx.fillText(rating.grade, 536, 175);
    ctx.fillStyle = '#d0d0d0';
    ctx.font = '15px sans-serif';
    ctx.fillText(rating.title, 536, 203);
    ctx.textAlign = 'left';

    const cells = [
      { label: 'Hits', value: summary.hits },
      { label: 'Misses', value: summary.misses },
      { label: 'Accuracy', value: `${summary.accuracy}%` },
      { label: 'Time played', value: fmtTime(durationMs) },
      { label: 'Average reaction', value: fmtMs(summary.avg) },
      { label: 'Best reaction', value: fmtMs(summary.best) },
    ];

    const startX = 40;
    const startY = 250;
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

    rating.parts.forEach((p, i) => {
      const y = 535 + i * 30;
      ctx.fillStyle = '#444444';
      ctx.font = '13px sans-serif';
      ctx.fillText(`${p.label} (${p.weight}% of total)`, 40, y);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#1f1f1f';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(String(p.pct), 560, y);
      ctx.textAlign = 'left';

      ctx.fillStyle = 'rgba(0,0,0,0.1)';
      ctx.beginPath();
      ctx.roundRect(40, y + 8, 520, 8, 4);
      ctx.fill();

      if (p.pct > 0) {
        ctx.fillStyle = '#1f1f1f';
        ctx.beginPath();
        ctx.roundRect(40, y + 8, Math.max(8, 520 * p.score), 8, 4);
        ctx.fill();
      }
    });

    ctx.fillStyle = '#9b9b9b';
    ctx.font = '12px sans-serif';
    ctx.fillText('Most-quito Shooter Game', 40, 715);

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
  const liveBest = stats.reactions.length ? Math.min(...stats.reactions) : null;
  const liveRating = playing
    ? computeRating({ shots: stats.shots, hits: stats.hits, avg: liveAvg, best: liveBest, durationMs: elapsed })
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
        background: '#101010',
        cursor: roundOver ? 'default' : CROSSHAIR_CURSOR,
      }}
    >
      <style>{styles}</style>

      {/* Wall Background */}
      <div
        className="ms-wall"
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${wallZoom})`,
          transformOrigin: `${ZOOM_ORIGIN_X * 100}% ${ZOOM_ORIGIN_Y * 100}%`,
          transition: `transform ${ZOOM_MS}ms ${ZOOM_EASE}`,
          willChange: 'transform',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      >
        <div
          className={strained ? 'ms-strain' : undefined}
          style={{
            position: 'absolute',
            inset: -6,
            backgroundImage: `url(${wallImg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      </div>

      {/* Camera Layer */}
      <div
        ref={camRef}
        className="ms-camera"
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${zoom})`,
          transformOrigin: `${ZOOM_ORIGIN_X * 100}% ${ZOOM_ORIGIN_Y * 100}%`,
          transition: `transform ${ZOOM_MS}ms ${ZOOM_EASE}`,
          willChange: 'transform',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      >
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
      </div>

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
          {!narrow && liveRating && <Stat label="Rating" value={`${liveRating.total} ${liveRating.grade}`} />}
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
            padding: narrow ? 10 : 16,
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
              maxWidth: narrow ? 460 : 880,
              margin: 'auto',
              padding: narrow ? 16 : 24,
              borderRadius: 16,
              background: G_CARD,
              color: G_INK,
              boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: narrow ? '1.3rem' : '1.6rem', lineHeight: 1.15, color: G_INK }}>
              {endReason === 'crashed'
                ? 'Browser crashed'
                : summary.hits === 0
                  ? 'The mosquitoes won this round'
                  : `${summary.hits} mosquito${summary.hits === 1 ? '' : 'es'}`}
            </h2>
            <p style={{ margin: narrow ? '4px 0 12px' : '6px 0 16px', color: '#666666', fontSize: narrow ? '0.88rem' : '0.95rem' }}>
              {endReason === 'crashed'
                ? `You lasted ${fmtTime(durationMs)} against the swarm.`
                : `${fmtTime(durationMs)} on the clock, ${summary.shots} shot${summary.shots === 1 ? '' : 's'} fired.`}
            </p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: narrow ? '1fr' : '1fr 1fr',
                gap: narrow ? 12 : 24,
                alignItems: 'stretch',
              }}
            >
              <div>
                <RatingHero rating={rating} compact={narrow} />
                <Breakdown rating={rating} compact={narrow} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: narrow ? 8 : 10 }}>
                  <ResultCell compact={narrow} label="Hits" value={summary.hits} />
                  <ResultCell compact={narrow} label="Misses" value={summary.misses} />
                  <ResultCell compact={narrow} label="Accuracy" value={`${summary.accuracy}%`} />
                  <ResultCell compact={narrow} label="Time played" value={fmtTime(durationMs)} />
                  <ResultCell compact={narrow} label="Avg reaction" value={fmtMs(summary.avg)} />
                  <ResultCell compact={narrow} label="Best reaction" value={fmtMs(summary.best)} />
                </div>

                <div
                  style={{
                    marginTop: narrow ? 10 : 12,
                    padding: narrow ? '8px 10px' : '10px 14px',
                    borderRadius: 10,
                    background: 'rgba(0,0,0,0.05)',
                    fontSize: narrow ? '0.78rem' : '0.85rem',
                    color: '#444444',
                    lineHeight: 1.4,
                  }}
                >
                  📸 <strong>Screenshot your results</strong> to share them, or download the scorecard image.
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: narrow ? 10 : 'auto', paddingTop: narrow ? 0 : 12 }}>
                  <button
                    type="button"
                    className="ms-btn"
                    onClick={downloadStatsImage}
                    style={{
                      flex: 1,
                      padding: narrow ? '11px 10px' : '12px 16px',
                      border: '1px solid #c4c4c4',
                      borderRadius: 12,
                      background: '#ffffff',
                      color: G_INK,
                      fontWeight: 700,
                      fontSize: narrow ? '0.85rem' : '0.95rem',
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
                    Download image
                  </button>
                  <button
                    type="button"
                    className="ms-btn"
                    onClick={playAgain}
                    style={{
                      flex: 1,
                      padding: narrow ? '11px 10px' : '12px 16px',
                      border: 'none',
                      borderRadius: 12,
                      background: G_INK,
                      color: '#ffffff',
                      fontWeight: 700,
                      fontSize: narrow ? '0.9rem' : '1rem',
                    }}
                  >
                    Play again
                  </button>
                </div>
              </div>
            </div>
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

const ResultCell = ({ label, value, compact }) => (
  <div style={{ padding: compact ? '8px 10px' : '10px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.07)' }}>
    <div style={{ fontSize: compact ? '1.1rem' : '1.3rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    <div style={{ fontSize: compact ? '0.72rem' : '0.78rem', color: '#666666' }}>{label}</div>
  </div>
);

const RatingHero = ({ rating, compact }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: compact ? '12px 14px' : '14px 18px',
      borderRadius: 12,
      background: G_INK,
      color: '#ffffff',
    }}
  >
    <div>
      <div style={{ fontSize: compact ? '0.78rem' : '0.85rem', color: G_MUTED }}>Total average</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
        <span style={{ fontSize: compact ? '2.3rem' : '2.8rem', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {rating.total}
        </span>
        <span style={{ color: G_MUTED, fontWeight: 700 }}>/ 100</span>
      </div>
    </div>
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: compact ? '2rem' : '2.4rem', fontWeight: 800, lineHeight: 1 }}>{rating.grade}</div>
      <div style={{ marginTop: 2, fontSize: compact ? '0.8rem' : '0.9rem', color: '#d0d0d0' }}>{rating.title}</div>
    </div>
  </div>
);

const Breakdown = ({ rating, compact }) => (
  <div
    style={{
      marginTop: compact ? 10 : 14,
      display: 'grid',
      gridTemplateColumns: compact ? '1fr 1fr' : '1fr',
      gap: compact ? '8px 14px' : 9,
    }}
  >
    {rating.parts.map((p) => (
      <div key={p.key}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: compact ? '0.72rem' : '0.8rem', color: '#555555' }}>
          <span>
            {p.label}
            {!compact && <span style={{ color: '#888888' }}> ({p.weight}% of total)</span>}
          </span>
          <span style={{ fontWeight: 700, color: G_INK, fontVariantNumeric: 'tabular-nums' }}>{p.pct}</span>
        </div>
        <div style={{ marginTop: 4, height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          <div className="ms-grow" style={{ width: `${p.pct}%`, height: '100%', background: G_INK }} />
        </div>
      </div>
    ))}
    {rating.confidence < 1 && (
      <div style={{ gridColumn: '1 / -1', fontSize: compact ? '0.72rem' : '0.78rem', color: '#777777' }}>
        Fire at least {SAMPLE_SHOTS} shots for a full rating. Short rounds are scaled down.
      </div>
    )}
  </div>
);

export default MosquitoShooter;