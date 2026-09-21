/**
 * makeStoryVideo — client-side video generation
 * Supports two formats:
 *   'landscape' — 1280×720 (16:9)  standard horizontal video
 *   'reels'     — 1080×1920 (9:16) vertical short-form reel
 *
 * Uses Canvas API + MediaRecorder + Web Audio API.
 * Output: WebM or MP4 Blob.
 */

// ── Format configs ─────────────────────────────────────────────────────────────
const FORMATS = {
  landscape: { W: 1280, H: 720,  FPS: 30, TRANSITION_S: 0.6, INTRO_S: 2.5, OUTRO_S: 2.0, bitrate: 5_000_000 },
  reels:     { W: 1080, H: 1920, FPS: 30, TRANSITION_S: 0.4, INTRO_S: 1.5, OUTRO_S: 1.5, bitrate: 8_000_000 },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function loadImg(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl) { resolve(null); return; }
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.crossOrigin = 'anonymous';
    img.src = dataUrl;
  });
}

/** Narration as an AudioBuffer: accepts a file URL (what the API returns today) or a legacy base64 data URL. */
async function decodeAudio(src, ctx) {
  if (!src) return null;
  try {
    let buffer;
    if (src.startsWith('data:')) {
      const binary = atob(src.split(',')[1] || '');
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      buffer = bytes.buffer;
    } else {
      const res = await fetch(src, { credentials: 'same-origin' });
      if (!res.ok) return null;
      buffer = await res.arrayBuffer();
    }
    return await ctx.decodeAudioData(buffer);
  } catch { return null; }
}

function wrapText(ctx2d, text, x, y, maxW, lineH, maxLines = 6) {
  const words = String(text || '').split(' ');
  let line = '';
  let cy = y;
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx2d.measureText(test).width > maxW && line) {
      ctx2d.fillText(line, x, cy);
      line = word; cy += lineH; lines++;
      if (lines >= maxLines) break;
    } else { line = test; }
  }
  if (line && lines < maxLines) ctx2d.fillText(line, x, cy);
}

// ── Easing ────────────────────────────────────────────────────────────────────
const easeOut  = (t) => 1 - (1 - t) ** 2;
const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const clamp    = (v, a, b) => Math.max(a, Math.min(b, v));

// ── Draw "cover" image (fill canvas, centred crop) ────────────────────────────
function drawImageCover(ctx2d, img, W, H, scale = 1) {
  if (!img) return;
  const imgAspect    = img.naturalWidth / img.naturalHeight;
  const canvasAspect = W / H;
  let sw, sh, sx, sy;
  if (imgAspect > canvasAspect) {
    sh = img.naturalHeight * scale;
    sw = sh * canvasAspect;
    sx = (img.naturalWidth - sw / scale) / 2;
    sy = (img.naturalHeight * (1 - scale)) / 2;
  } else {
    sw = img.naturalWidth * scale;
    sh = sw / canvasAspect;
    sx = (img.naturalWidth * (1 - scale)) / 2;
    sy = (img.naturalHeight - sh / scale) / 2;
  }
  ctx2d.drawImage(img, sx, sy, img.naturalWidth - sx * 2, img.naturalHeight - sy * 2, 0, 0, W, H);
}

// ── Small cross icon (SVG-like path on canvas) ─────────────────────────────────
function drawCrossIcon(ctx2d, cx, cy, size, alpha) {
  ctx2d.save();
  ctx2d.globalAlpha = alpha;
  ctx2d.fillStyle = '#c9a84c';
  const arm = size * 0.22;
  const stem = size * 0.65;
  // vertical
  ctx2d.fillRect(cx - arm / 2, cy - stem / 2, arm, stem);
  // horizontal
  ctx2d.fillRect(cx - stem * 0.55, cy - stem * 0.05, stem * 1.1, arm);
  ctx2d.restore();
}

// ══════════════════════════════════════════════════════════════════════════════
//  LANDSCAPE renderer  (1280 × 720)
// ══════════════════════════════════════════════════════════════════════════════
function drawFrameLandscape(ctx2d, state, story, images) {
  const { W, H } = FORMATS.landscape;
  const { elapsed, totalDur, segments, TRANSITION_S, INTRO_S, OUTRO_S } = state;

  ctx2d.clearRect(0, 0, W, H);
  ctx2d.fillStyle = '#0b1a14';
  ctx2d.fillRect(0, 0, W, H);

  let seg = null;
  for (const s of segments) {
    if (elapsed >= s.start && elapsed < s.end) { seg = s; break; }
  }
  if (!seg && segments.length) seg = segments[segments.length - 1];
  if (!seg) return;

  const segT = clamp((elapsed - seg.start) / (seg.end - seg.start), 0, 1);

  if (seg.type === 'intro') {
    const alpha = segT < 0.3 ? easeOut(segT / 0.3) : segT > 0.8 ? 1 - easeOut((segT - 0.8) / 0.2) : 1;
    ctx2d.globalAlpha = alpha;
    const barGrad = ctx2d.createLinearGradient(0, 0, W, 0);
    barGrad.addColorStop(0, 'transparent');
    barGrad.addColorStop(0.3, '#c9a84c');
    barGrad.addColorStop(0.7, '#c9a84c');
    barGrad.addColorStop(1, 'transparent');
    ctx2d.fillStyle = barGrad;
    ctx2d.fillRect(0, H / 2 - 110, W, 2);
    ctx2d.textAlign = 'center';
    ctx2d.font = 'bold 62px Georgia, serif';
    ctx2d.fillStyle = '#ffffff';
    ctx2d.shadowColor = 'rgba(0,0,0,0.6)'; ctx2d.shadowBlur = 16;
    wrapText(ctx2d, story.title || '', W / 2, H / 2 - 30, 700, 72, 2);
    ctx2d.font = '26px Arial, sans-serif';
    ctx2d.fillStyle = '#c9a84c';
    ctx2d.shadowBlur = 0;
    ctx2d.fillText(story.reference || story.event?.era || '', W / 2, H / 2 + 70);
    ctx2d.font = '18px Arial, sans-serif';
    ctx2d.fillStyle = 'rgba(255,255,255,0.5)';
    ctx2d.fillText('Interactive Bible App • AI Story Video', W / 2, H / 2 + 110);
    ctx2d.fillStyle = barGrad;
    ctx2d.fillRect(0, H / 2 + 128, W, 2);
    ctx2d.textAlign = 'left';
    ctx2d.globalAlpha = 1;

  } else if (seg.type === 'scene') {
    const img   = images[seg.sceneIdx];
    const scene = story.scenes[seg.sceneIdx];
    const fadeIn  = clamp(segT / (TRANSITION_S / (seg.end - seg.start)), 0, 1);
    const fadeOut = segT > 1 - TRANSITION_S / (seg.end - seg.start)
      ? clamp((1 - segT) / (TRANSITION_S / (seg.end - seg.start)), 0, 1) : 1;
    const imgAlpha = easeOut(fadeIn) * easeOut(fadeOut);

    const kbScale = 1 + easeOut(segT) * 0.08;
    if (img) {
      ctx2d.globalAlpha = imgAlpha;
      drawImageCover(ctx2d, img, W, H, kbScale);
      ctx2d.globalAlpha = 1;
    }

    const grad = ctx2d.createLinearGradient(0, H * 0.35, 0, H);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.88)');
    ctx2d.fillStyle = grad; ctx2d.fillRect(0, 0, W, H);

    const topGrad = ctx2d.createLinearGradient(0, 0, 0, 90);
    topGrad.addColorStop(0, 'rgba(0,0,0,0.55)');
    topGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx2d.fillStyle = topGrad; ctx2d.fillRect(0, 0, W, 90);

    ctx2d.globalAlpha = imgAlpha;
    ctx2d.font = '600 17px Arial, sans-serif';
    ctx2d.fillStyle = '#c9a84c';
    ctx2d.letterSpacing = '2px';
    ctx2d.fillText((story.title || '').toUpperCase().slice(0, 40), 42, 46);
    ctx2d.letterSpacing = '0px';
    ctx2d.textAlign = 'right';
    ctx2d.font = '16px Arial, sans-serif';
    ctx2d.fillStyle = 'rgba(255,255,255,0.65)';
    ctx2d.fillText(`${seg.sceneIdx + 1} / ${story.scenes.length}`, W - 42, 46);
    ctx2d.textAlign = 'left';
    ctx2d.shadowColor = 'rgba(0,0,0,0.9)'; ctx2d.shadowBlur = 12;
    ctx2d.font = 'bold 44px Georgia, serif';
    ctx2d.fillStyle = '#ffffff';
    wrapText(ctx2d, scene.title || '', 50, H - 140, W - 100, 52, 2);
    ctx2d.font = '22px Arial, sans-serif';
    ctx2d.fillStyle = 'rgba(255,255,255,0.88)';
    ctx2d.shadowBlur = 8;
    wrapText(ctx2d, scene.narration || '', 50, H - 72, W - 100, 28, 2);
    ctx2d.shadowBlur = 0;
    ctx2d.globalAlpha = 1;

  } else if (seg.type === 'outro') {
    const alpha = segT < 0.4 ? easeOut(segT / 0.4) : 1 - easeOut((segT - 0.4) / 0.6);
    ctx2d.globalAlpha = Math.max(0, alpha);
    ctx2d.textAlign = 'center';
    ctx2d.font = '28px Georgia, serif';
    ctx2d.fillStyle = '#c9a84c';
    ctx2d.fillText(story.reference || '', W / 2, H / 2 - 20);
    ctx2d.font = '18px Arial, sans-serif';
    ctx2d.fillStyle = 'rgba(255,255,255,0.5)';
    ctx2d.fillText('Interactive Bible App', W / 2, H / 2 + 20);
    ctx2d.textAlign = 'left';
    ctx2d.globalAlpha = 1;
  }

  // Progress bar
  ctx2d.fillStyle = 'rgba(255,255,255,0.15)';
  ctx2d.fillRect(0, H - 4, W, 4);
  const barGrad2 = ctx2d.createLinearGradient(0, 0, W, 0);
  barGrad2.addColorStop(0, '#6ee7b7');
  barGrad2.addColorStop(1, '#c9a84c');
  ctx2d.fillStyle = barGrad2;
  ctx2d.fillRect(0, H - 4, clamp(elapsed / totalDur, 0, 1) * W, 4);
}

// ══════════════════════════════════════════════════════════════════════════════
//  REELS renderer  (1080 × 1920, 9:16 — Instagram / TikTok / YouTube Shorts)
// ══════════════════════════════════════════════════════════════════════════════
function drawFrameReels(ctx2d, state, story, images) {
  const { W, H } = FORMATS.reels;
  const { elapsed, totalDur, segments, TRANSITION_S } = state;

  ctx2d.clearRect(0, 0, W, H);
  ctx2d.fillStyle = '#050d18';
  ctx2d.fillRect(0, 0, W, H);

  let seg = null;
  for (const s of segments) {
    if (elapsed >= s.start && elapsed < s.end) { seg = s; break; }
  }
  if (!seg && segments.length) seg = segments[segments.length - 1];
  if (!seg) return;

  const segT = clamp((elapsed - seg.start) / (seg.end - seg.start), 0, 1);

  if (seg.type === 'intro') {
    // ── Reels intro: full dark card, big centred title ────────────────────────
    const alpha = segT < 0.35 ? easeOut(segT / 0.35) : segT > 0.75 ? 1 - easeOut((segT - 0.75) / 0.25) : 1;
    ctx2d.globalAlpha = alpha;

    // Ambient glow behind title
    const glow = ctx2d.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 600);
    glow.addColorStop(0, 'rgba(201,168,76,0.18)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx2d.fillStyle = glow;
    ctx2d.fillRect(0, 0, W, H);

    // Gold horizontal rules
    const gr = ctx2d.createLinearGradient(0, 0, W, 0);
    gr.addColorStop(0, 'transparent');
    gr.addColorStop(0.4, '#c9a84c');
    gr.addColorStop(0.6, '#c9a84c');
    gr.addColorStop(1, 'transparent');
    ctx2d.fillStyle = gr;
    ctx2d.fillRect(0, H / 2 - 190, W, 2);
    ctx2d.fillRect(0, H / 2 + 160, W, 2);

    // Cross icon centred top
    drawCrossIcon(ctx2d, W / 2, H / 2 - 240, 60, 0.85);

    // Title
    ctx2d.textAlign = 'center';
    ctx2d.font = 'bold 80px Georgia, serif';
    ctx2d.fillStyle = '#ffffff';
    ctx2d.shadowColor = 'rgba(0,0,0,0.8)'; ctx2d.shadowBlur = 20;
    wrapText(ctx2d, story.title || '', W / 2, H / 2 - 120, W - 120, 92, 3);

    // Reference
    ctx2d.font = '44px Arial, sans-serif';
    ctx2d.fillStyle = '#c9a84c';
    ctx2d.shadowBlur = 0;
    ctx2d.fillText(story.reference || '', W / 2, H / 2 + 100);

    // Sub-brand
    ctx2d.font = '700 28px Arial, sans-serif';
    ctx2d.fillStyle = 'rgba(255,255,255,0.4)';
    ctx2d.letterSpacing = '4px';
    ctx2d.fillText('INTERACTIVE BIBLE APP', W / 2, H / 2 + 170);
    ctx2d.letterSpacing = '0px';

    ctx2d.textAlign = 'left';
    ctx2d.globalAlpha = 1;

  } else if (seg.type === 'scene') {
    // ── Reels scene ──────────────────────────────────────────────────────────
    const img   = images[seg.sceneIdx];
    const scene = story.scenes[seg.sceneIdx];

    const transFrac = TRANSITION_S / (seg.end - seg.start);
    const fadeIn  = clamp(segT / transFrac, 0, 1);
    const fadeOut = segT > 1 - transFrac ? clamp((1 - segT) / transFrac, 0, 1) : 1;
    const imgAlpha = easeOut(fadeIn) * easeOut(fadeOut);
    const kbScale  = 1 + easeInOut(segT) * 0.05;

    // ── Portrait images (generated 9:16): full-bleed cover fill ──────────────
    // ── Landscape images (16:9 fallback): blurred bg + fitted image in upper zone
    const isPortrait = story.imageFormat === 'portrait';

    if (img) {
      ctx2d.globalAlpha = imgAlpha;

      if (isPortrait) {
        // Portrait-generated: fill the full frame
        drawImageCover(ctx2d, img, W, H, kbScale);
      } else {
        // Landscape image: draw blurred + darkened version as full-bleed background
        ctx2d.save();
        ctx2d.filter = 'blur(28px) brightness(0.35) saturate(1.2)';
        drawImageCover(ctx2d, img, W, H, 1.12);
        ctx2d.restore();

        // Dark overlay on top of blurred background
        ctx2d.fillStyle = 'rgba(0,0,0,0.25)';
        ctx2d.fillRect(0, 0, W, H);

        // Draw the clear landscape image fitted (letterboxed) in the upper 52% of the frame
        const imgZoneTop  = Math.round(H * 0.08);   // 8% from top
        const imgZoneH    = Math.round(H * 0.52);   // 52% of height
        const imgZoneW    = W - 80;                  // 40px margin each side
        const imgZoneLeft = 40;

        const imgAspect = img.naturalWidth / img.naturalHeight;
        let fitW = imgZoneW;
        let fitH = fitW / imgAspect;
        if (fitH > imgZoneH) { fitH = imgZoneH; fitW = fitH * imgAspect; }

        const fitX = imgZoneLeft + (imgZoneW - fitW) / 2;
        const fitY = imgZoneTop  + (imgZoneH - fitH) / 2;

        // Subtle rounded shadow behind the image
        ctx2d.save();
        ctx2d.shadowColor = 'rgba(0,0,0,0.7)';
        ctx2d.shadowBlur  = 32;
        ctx2d.drawImage(img, fitX, fitY, fitW, fitH);
        ctx2d.restore();

        // Thin gold border around image
        ctx2d.strokeStyle = 'rgba(201,168,76,0.4)';
        ctx2d.lineWidth   = 2;
        ctx2d.strokeRect(fitX + 1, fitY + 1, fitW - 2, fitH - 2);
      }

      ctx2d.globalAlpha = 1;
    }

    // ── Gradient: strong fade from image zone into text zone ──────────────────
    const gradStartY = isPortrait ? H * 0.38 : H * 0.56;
    const grad = ctx2d.createLinearGradient(0, gradStartY, 0, H);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.4, 'rgba(0,0,0,0.78)');
    grad.addColorStop(1, 'rgba(0,0,0,0.97)');
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, 0, W, H);

    // Top gradient (brand bar area)
    const topGrad = ctx2d.createLinearGradient(0, 0, 0, 200);
    topGrad.addColorStop(0, 'rgba(0,0,0,0.65)');
    topGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx2d.fillStyle = topGrad;
    ctx2d.fillRect(0, 0, W, 200);

    ctx2d.globalAlpha = imgAlpha;

    // ── Top bar: brand + scene counter ──
    ctx2d.font = '700 32px Arial, sans-serif';
    ctx2d.fillStyle = '#c9a84c';
    ctx2d.letterSpacing = '3px';
    ctx2d.fillText('INTERACTIVE BIBLE APP', 60, 88);
    ctx2d.letterSpacing = '0px';

    // Scene counter dots (top right)
    const dotR = 10, dotGap = 28, totalDots = story.scenes.length;
    const dotsW = totalDots * dotGap;
    const dotStartX = W - 60 - dotsW + dotGap / 2;
    for (let i = 0; i < totalDots; i++) {
      ctx2d.beginPath();
      ctx2d.arc(dotStartX + i * dotGap, 82, i === seg.sceneIdx ? dotR : dotR * 0.5, 0, Math.PI * 2);
      ctx2d.fillStyle = i === seg.sceneIdx ? '#c9a84c' : 'rgba(255,255,255,0.4)';
      ctx2d.fill();
    }

    // Cross watermark (top-right corner)
    drawCrossIcon(ctx2d, W - 72, 150, 48, 0.55);

    // ── Bottom text block ──
    const textBottom = H - 80;

    // Era chip
    ctx2d.font = '700 28px Arial, sans-serif';
    ctx2d.letterSpacing = '3px';
    ctx2d.fillStyle = 'rgba(201,168,76,0.9)';
    const eraText = (story.era || story.reference || '').toUpperCase().slice(0, 30);
    ctx2d.fillText(eraText, 60, textBottom - 350);
    ctx2d.letterSpacing = '0px';

    // Scene title — large bold
    ctx2d.shadowColor = 'rgba(0,0,0,1)'; ctx2d.shadowBlur = 24;
    ctx2d.font = 'bold 72px Georgia, serif';
    ctx2d.fillStyle = '#ffffff';
    wrapText(ctx2d, scene.title || '', 60, textBottom - 270, W - 120, 84, 3);

    // Narration caption
    ctx2d.font = '400 38px Arial, sans-serif';
    ctx2d.fillStyle = 'rgba(255,255,255,0.88)';
    ctx2d.shadowBlur = 12;
    wrapText(ctx2d, scene.narration || '', 60, textBottom - 80, W - 120, 46, 3);
    ctx2d.shadowBlur = 0;

    // Scripture reference pill
    ctx2d.font = '700 30px Arial, sans-serif';
    ctx2d.fillStyle = 'rgba(201,168,76,0.8)';
    ctx2d.fillText(story.reference || '', 60, textBottom + 10);

    ctx2d.globalAlpha = 1;

  } else if (seg.type === 'outro') {
    // ── Reels outro ──────────────────────────────────────────────────────────
    const alpha = segT < 0.4 ? easeOut(segT / 0.4) : 1 - easeOut((segT - 0.4) / 0.6);
    ctx2d.globalAlpha = Math.max(0, alpha);

    // Subtle glow
    const outroGlow = ctx2d.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 700);
    outroGlow.addColorStop(0, 'rgba(201,168,76,0.12)');
    outroGlow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx2d.fillStyle = outroGlow;
    ctx2d.fillRect(0, 0, W, H);

    drawCrossIcon(ctx2d, W / 2, H / 2 - 120, 80, 0.9);

    ctx2d.textAlign = 'center';
    ctx2d.font = '700 52px Georgia, serif';
    ctx2d.fillStyle = '#c9a84c';
    ctx2d.fillText(story.reference || '', W / 2, H / 2 + 30);
    ctx2d.font = '700 36px Arial, sans-serif';
    ctx2d.fillStyle = 'rgba(255,255,255,0.45)';
    ctx2d.letterSpacing = '5px';
    ctx2d.fillText('INTERACTIVE BIBLE APP', W / 2, H / 2 + 105);
    ctx2d.letterSpacing = '0px';
    ctx2d.font = '30px Arial, sans-serif';
    ctx2d.fillStyle = 'rgba(255,255,255,0.3)';
    ctx2d.fillText('AI-Powered Bible Exploration', W / 2, H / 2 + 160);
    ctx2d.textAlign = 'left';
    ctx2d.globalAlpha = 1;
  }

  // ── Thin progress bar at very bottom ──────────────────────────────────────
  ctx2d.fillStyle = 'rgba(255,255,255,0.12)';
  ctx2d.fillRect(0, H - 8, W, 8);
  const progressGrad = ctx2d.createLinearGradient(0, 0, W, 0);
  progressGrad.addColorStop(0, '#6ee7b7');
  progressGrad.addColorStop(0.5, '#c9a84c');
  progressGrad.addColorStop(1, '#f59e0b');
  ctx2d.fillStyle = progressGrad;
  const progressW = clamp(elapsed / totalDur, 0, 1) * W;
  // Rounded right edge only if not full
  if (progressW > 0) {
    ctx2d.beginPath();
    ctx2d.roundRect(0, H - 8, progressW, 8, [0, 4, 4, 0]);
    ctx2d.fill();
  }
}

// ── Best supported MIME ───────────────────────────────────────────────────────
function bestMime() {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return 'video/webm';
}

// ── Capability check ─────────────────────────────────────────────────────────
export function isVideoSupported() {
  try {
    const c = document.createElement('canvas');
    return (
      typeof MediaRecorder !== 'undefined' &&
      typeof c.captureStream === 'function'
    );
  } catch { return false; }
}

// ── Total duration helper ─────────────────────────────────────────────────────
export function estimateVideoDuration(story, format = 'landscape') {
  const fmt = FORMATS[format] || FORMATS.landscape;
  const rawDurs   = (story?.scenes || []).map((s) => Number(s.durationSec) || 7);
  // scenes are stretched to the narration when there is one (see makeStoryVideo)
  const narration = Number(story?.durationSeconds) || 0;
  const sceneSec  = story?.audioUrl && narration > 2 ? narration : rawDurs.reduce((a, b) => a + b, 0);
  return Math.ceil(fmt.INTRO_S + sceneSec + fmt.OUTRO_S);
}

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * @param {object}   story      – story manifest from API
 * @param {function} onProgress – called with 0..1
 * @param {string}   format     – 'landscape' | 'reels'
 * @returns {Promise<Blob>}
 */
export async function makeStoryVideo(story, onProgress, format = 'landscape') {
  if (!isVideoSupported()) {
    throw new Error('Your browser does not support canvas video capture (MediaRecorder / captureStream). Try Chrome or Edge.');
  }

  const fmt = FORMATS[format] || FORMATS.landscape;
  const { W, H, FPS, TRANSITION_S, INTRO_S, OUTRO_S, bitrate } = fmt;

  // Create AudioContext SYNCHRONOUSLY (before any await) — autoplay policy
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioCtx();

  onProgress?.(0.02);
  const images = await Promise.all((story.scenes || []).map((s) => loadImg(s.imageUrl)));
  onProgress?.(0.08);

  if (audioCtx.state === 'suspended') {
    try { await audioCtx.resume(); } catch { /* non-fatal */ }
  }
  const audioBuffer = await decodeAudio(story.audioUrl, audioCtx);
  const audioDur    = audioBuffer?.duration || 0;

  // Build timeline segments
  const rawDurs    = (story.scenes || []).map((s) => Number(s.durationSec) || 7);
  const sceneTotal = rawDurs.reduce((a, b) => a + b, 0);
  const scale      = audioDur > 2 ? (audioDur / sceneTotal) : 1;
  const scaledDurs = rawDurs.map((d) => d * scale);

  const segments = [];
  segments.push({ type: 'intro', start: 0, end: INTRO_S });
  let cursor = INTRO_S;
  scaledDurs.forEach((dur, i) => {
    segments.push({ type: 'scene', sceneIdx: i, start: cursor, end: cursor + dur });
    cursor += dur;
  });
  segments.push({ type: 'outro', start: cursor, end: cursor + OUTRO_S });
  const totalDur = cursor + OUTRO_S;

  // Canvas
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx2d = canvas.getContext('2d', { alpha: false });

  // Shared draw state
  const drawState = { elapsed: 0, totalDur, segments, TRANSITION_S, INTRO_S, OUTRO_S };
  const drawFn = format === 'reels'
    ? (elapsed) => drawFrameReels(ctx2d,   { ...drawState, elapsed }, story, images)
    : (elapsed) => drawFrameLandscape(ctx2d, { ...drawState, elapsed }, story, images);

  // MediaRecorder
  const mimeType  = bestMime();
  const vidStream = canvas.captureStream(FPS);
  let   recStream = vidStream;

  if (audioBuffer) {
    const srcNode  = audioCtx.createBufferSource();
    srcNode.buffer = audioBuffer;
    const destNode = audioCtx.createMediaStreamDestination();
    srcNode.connect(destNode);
    srcNode.start(audioCtx.currentTime + INTRO_S);
    recStream = new MediaStream([
      ...vidStream.getVideoTracks(),
      ...destNode.stream.getAudioTracks(),
    ]);
  }

  const recorder = new MediaRecorder(recStream, { mimeType, videoBitsPerSecond: bitrate });
  const chunks   = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  return new Promise((resolve, reject) => {
    let settled = false;
    let bgInterval = null;
    let safetyTimer = null;

    const settle = (fn) => {
      if (settled) return;
      settled = true;
      clearInterval(bgInterval);
      clearTimeout(safetyTimer);
      audioCtx.close().catch(() => {});
      fn();
    };

    recorder.onstop = () => {
      settle(() => {
        const ext  = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: mimeType });
        blob._ext    = ext;
        blob._format = format;
        resolve(blob);
      });
    };
    recorder.onerror = (e) => settle(() => reject(new Error(e?.error?.message || 'MediaRecorder error')));

    safetyTimer = setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, (totalDur + 10) * 1000);

    recorder.start(500);

    const startWall  = performance.now();
    let lastTickTime = -1;

    function tick() {
      const elapsed = (performance.now() - startWall) / 1000;
      if (elapsed === lastTickTime) return;
      lastTickTime = elapsed;
      drawFn(elapsed);
      onProgress?.(0.1 + 0.88 * clamp(elapsed / totalDur, 0, 1));
      if (elapsed >= totalDur + 0.3) {
        if (recorder.state !== 'inactive') recorder.stop();
      } else {
        requestAnimationFrame(tick);
      }
    }

    bgInterval = setInterval(() => {
      const elapsed = (performance.now() - startWall) / 1000;
      drawFn(elapsed);
      onProgress?.(0.1 + 0.88 * clamp(elapsed / totalDur, 0, 1));
      if (elapsed >= totalDur + 0.3 && recorder.state !== 'inactive') recorder.stop();
    }, 1000);

    requestAnimationFrame(tick);
  });
}

/** Download a blob as a file */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url, download: filename, rel: 'noopener',
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Save blob to IndexedDB */
export async function saveVideoLocally(eventId, blob, format = 'landscape') {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ibible-story-videos', 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('videos'))    db.createObjectStore('videos');
      if (!db.objectStoreNames.contains('reels'))     db.createObjectStore('reels');
    };
    req.onsuccess = (e) => {
      const db    = e.target.result;
      const store = format === 'reels' ? 'reels' : 'videos';
      const tx    = db.transaction(store, 'readwrite');
      const put   = tx.objectStore(store).put({ blob, ext: blob._ext || 'webm', format, ts: Date.now() }, eventId);
      put.onsuccess = () => resolve();
      put.onerror   = reject;
    };
    req.onerror = reject;
  });
}

/** Load blob from IndexedDB */
export async function loadVideoLocally(eventId, format = 'landscape') {
  return new Promise((resolve) => {
    const req = indexedDB.open('ibible-story-videos', 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos');
      if (!db.objectStoreNames.contains('reels'))  db.createObjectStore('reels');
    };
    req.onsuccess = (e) => {
      const db    = e.target.result;
      const store = format === 'reels' ? 'reels' : 'videos';
      if (!db.objectStoreNames.contains(store)) { resolve(null); return; }
      const tx  = db.transaction(store, 'readonly');
      const get = tx.objectStore(store).get(eventId);
      get.onsuccess = (ev) => {
        const rec = ev.target.result;
        if (!rec) { resolve(null); return; }
        resolve({ url: URL.createObjectURL(rec.blob), ext: rec.ext, format: rec.format, ts: rec.ts });
      };
      get.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}
