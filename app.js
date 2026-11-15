const SITE_PRESETS = {
  shackleton: {
    name: 'Shackleton Crater',
    lat: -89.67,
    lon: 129.78,
    horizon: null
  },
  cabeus: {
    name: 'Cabeus Crater',
    lat: -85.3303,
    lon: 317.8673,
    horizon: null
  },
  mouton: {
    name: 'Mons Mouton',
    lat: -84.6,
    lon: 31.0,
    horizon: null
  },
  customA: {
    name: 'Custom site A',
    lat: -89.0,
    lon: 0.0,
    horizon: null
  },
  customB: {
    name: 'Custom site B',
    lat: -85.0,
    lon: 20.0,
    horizon: null
  }
};

const $ = (id) => document.getElementById(id);
const state = { seriesA: [], seriesB: [], index: 0, siteA: null, siteB: null, start: null, durationHours: 168, stepMinutes: 30 };
const COLORS = { sun: '#d9ad67', earth: '#83b5d2', grid: 'rgba(160,170,180,.18)', text: '#aab3bd', terrain: '#89939e', cursor: 'rgba(180,190,200,.55)', markerOutline: '#292f36' };

function syncChartColors() {
  const styles = getComputedStyle(document.documentElement);
  COLORS.sun = styles.getPropertyValue('--sun').trim();
  COLORS.earth = styles.getPropertyValue('--earth').trim();
  COLORS.grid = document.documentElement.dataset.theme === 'light' ? 'rgba(80,95,110,.16)' : 'rgba(160,170,180,.18)';
  COLORS.text = styles.getPropertyValue('--muted').trim();
  COLORS.terrain = styles.getPropertyValue('--dim').trim();
  COLORS.cursor = document.documentElement.dataset.theme === 'light' ? 'rgba(50,60,70,.55)' : 'rgba(210,220,230,.48)';
  COLORS.markerOutline = styles.getPropertyValue('--surface').trim();
}

function applyTheme(theme) {
  const selected = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = selected;
  const lightMode = selected === 'light';
  const toggle = $('themeToggle');
  toggle.setAttribute('aria-pressed', String(lightMode));
  toggle.setAttribute('aria-label', lightMode ? 'Switch to dark mode' : 'Switch to light mode');
  toggle.textContent = lightMode ? 'Dark mode' : 'Light mode';
  document.querySelector('meta[name="theme-color"]').setAttribute('content', lightMode ? '#f6f7f8' : '#20252a');
  try { localStorage.setItem('lunarwindow-theme', selected); } catch (_) {}
  syncChartColors();
  if (state.seriesA.length) drawAll();
}

function initializeTheme() {
  let saved = 'light';
  try { saved = localStorage.getItem('lunarwindow-theme') || 'light'; } catch (_) {}
  applyTheme(saved);
  $('themeToggle').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function radians(deg) { return deg * Math.PI / 180; }
function degrees(rad) { return rad * 180 / Math.PI; }
function wrap360(value) { return ((value % 360) + 360) % 360; }
function formatHours(hours) { return `${hours.toFixed(1)} h`; }
function formatDuration(hours) {
  const totalMinutes = Math.round(hours * 60);
  const days = Math.floor(totalMinutes / 1440);
  const remaining = totalMinutes % 1440;
  const h = Math.floor(remaining / 60);
  const m = remaining % 60;
  return days ? `${days}d ${h}h ${String(m).padStart(2, '0')}m` : `${h}h ${String(m).padStart(2, '0')}m`;
}
function formatDateTime(date) {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(date).toUpperCase() + ' UTC';
}
function signedCoord(value, positive, negative) {
  return `${Math.abs(value).toFixed(3)}° ${value < 0 ? negative : positive}`;
}

function getStartDate() {
  const date = $('startDate').value || '2026-11-14';
  const time = $('startTime').value || '00:00';
  return new Date(`${date}T${time}:00Z`);
}

function getSite(which) {
  const key = $(`site${which}`).value;
  const preset = SITE_PRESETS[key] || SITE_PRESETS[which === 'A' ? 'customA' : 'customB'];
  return {
    ...preset,
    name: preset.name,
    lat: Number($(`lat${which}`).value),
    lon: Number($(`lon${which}`).value),
    which
  };
}

function generateDemoSeries(site, start, durationHours, stepMinutes) {
  const stepHours = stepMinutes / 60;
  const count = Math.ceil(durationHours / stepHours) + 1;
  const points = [];
  const latitudeFactor = clamp((Math.abs(site.lat) - 80) / 10, 0, 1);
  for (let i = 0; i < count; i++) {
    const elapsedHours = Math.min(i * stepHours, durationHours);
    const date = new Date(start.getTime() + elapsedHours * 3600000);
    const dayPhase = (elapsedHours / 708.7) * Math.PI * 2 + site.phase + site.lon * 0.003;
    const shortPhase = (elapsedHours / 24) * Math.PI * 2;
    const sunAz = wrap360(95 + degrees(dayPhase) * 0.22 + Math.sin(shortPhase * 0.31 + site.phase) * 27 + site.lon * 0.25);
    const sunEl = -1.5 + (8 + latitudeFactor * 6) * Math.sin(dayPhase) + 1.6 * Math.sin(shortPhase * 0.22 + site.phase);
    const earthAz = wrap360(180 + site.lon * 0.15 + 18 * Math.sin(dayPhase * 0.7 + site.phase));
    const earthEl = 4.5 * Math.sin(dayPhase * 0.92 + site.phase + 0.8) + 1.2 * Math.cos(shortPhase * 0.18);
    const sunHorizon = terrainHorizonAtAzimuth(sunAz, site);
    const earthHorizon = terrainHorizonAtAzimuth(earthAz, site);
    points.push({
      date, elapsedHours, sunAz, sunEl, earthAz, earthEl,
      sunHorizon, earthHorizon,
      sunVisible: sunEl > sunHorizon,
      earthVisible: earthEl > earthHorizon
    });
  }
  return points;
}

function terrainHorizonAtAzimuth(azimuth, site) {
  const distance = Math.abs(((azimuth - site.ridgeAz + 540) % 360) - 180);
  const ridgeShape = Math.exp(-Math.pow(distance / 29, 2));
  const broadVariation = 1.2 + 0.8 * Math.sin(radians(azimuth * 2 + site.lon));
  return -1.5 + broadVariation + site.ridge * ridgeShape;
}

function summarize(points, key) {
  let visibleHours = 0;
  let longest = 0;
  let current = 0;
  let peak = -90;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const visible = p[key === 'sun' ? 'sunVisible' : 'earthVisible'];
    const angle = p[key === 'sun' ? 'sunEl' : 'earthEl'];
    if (angle > peak) peak = angle;
    if (visible) {
      if (i < points.length - 1) {
        const delta = (points[i + 1].date - p.date) / 3600000;
        visibleHours += Math.max(0, delta);
        current += Math.max(0, delta);
      }
    } else {
      longest = Math.max(longest, current);
      current = 0;
    }
  }
  longest = Math.max(longest, current);
  return { visibleHours, longest, peak };
}

function updateAll() {
  const start = getStartDate();
  if (Number.isNaN(start.getTime())) return;
  state.start = start;
  state.durationHours = Number($('duration').value);
  state.stepMinutes = Number($('stepMinutes').value);
  state.siteA = getSite('A');
  state.siteB = getSite('B');
  state.seriesA = generateDemoSeries(state.siteA, start, state.durationHours, state.stepMinutes);
  state.seriesB = generateDemoSeries(state.siteB, start, state.durationHours, state.stepMinutes);
  state.index = 0;
  $('timeSlider').max = String(Math.max(0, state.seriesA.length - 1));
  $('timeSlider').value = '0';
  updateLabelsAndMetrics();
  drawAll();
}

function updateLabelsAndMetrics() {
  const pointsA = state.seriesA;
  const pointsB = state.seriesB;
  if (!pointsA.length || !pointsB.length) return;
  const current = pointsA[state.index];
  const sunA = summarize(pointsA, 'sun');
  const earthA = summarize(pointsA, 'earth');
  const sunB = summarize(pointsB, 'sun');
  const earthB = summarize(pointsB, 'earth');
  $('selectedTimestamp').textContent = formatDateTime(current.date);
  $('elapsedLabel').textContent = `${formatDuration(current.elapsedHours)} / ${formatDuration(state.durationHours)}`;
  $('rangeStart').textContent = formatDateTime(state.start).replace(' UTC', '');
  $('rangeEnd').textContent = formatDateTime(pointsA[pointsA.length - 1].date).replace(' UTC', '');
  $('timelineStart').textContent = formatDateTime(state.start).replace(' UTC', '');
  $('timelineEnd').textContent = formatDateTime(pointsA[pointsA.length - 1].date).replace(' UTC', '');

  $('sunReadout').textContent = `${current.sunEl.toFixed(1)}° · ${Math.round(current.sunAz)}° AZ`;
  $('earthReadout').textContent = `${current.earthEl.toFixed(1)}° · ${Math.round(current.earthAz)}° AZ`;
  $('sunVisibility').textContent = current.sunVisible ? `VISIBLE · terrain horizon ${current.sunHorizon.toFixed(1)}°` : `OBSTRUCTED · terrain horizon ${current.sunHorizon.toFixed(1)}°`;
  $('earthVisibility').textContent = current.earthVisible ? `GEOMETRIC LOS · terrain horizon ${current.earthHorizon.toFixed(1)}°` : `NO GEOMETRIC LOS · terrain horizon ${current.earthHorizon.toFixed(1)}°`;

  $('sunHours').textContent = sunA.visibleHours.toFixed(1);
  $('earthHours').textContent = earthA.visibleHours.toFixed(1);
  $('sunLongest').textContent = formatDuration(sunA.longest);
  $('earthLongest').textContent = formatDuration(earthA.longest);
  $('metricSiteName').textContent = state.siteA.name;
  $('currentLat').textContent = signedCoord(state.siteA.lat, 'N', 'S');
  $('currentLon').textContent = signedCoord(state.siteA.lon, 'E', 'W');

  $('compareNameA').textContent = state.siteA.name;
  $('compareNameB').textContent = state.siteB.name;
  $('compareCoordsA').textContent = `${signedCoord(state.siteA.lat, 'N', 'S')} · ${signedCoord(state.siteA.lon, 'E', 'W')}`;
  $('compareCoordsB').textContent = `${signedCoord(state.siteB.lat, 'N', 'S')} · ${signedCoord(state.siteB.lon, 'E', 'W')}`;
  $('compareSunA').textContent = formatHours(sunA.visibleHours);
  $('compareSunB').textContent = formatHours(sunB.visibleHours);
  $('compareEarthA').textContent = formatHours(earthA.visibleHours);
  $('compareEarthB').textContent = formatHours(earthB.visibleHours);
  $('comparePeakA').textContent = `${sunA.peak.toFixed(1)}°`;
  $('comparePeakB').textContent = `${sunB.peak.toFixed(1)}°`;
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

function drawHorizon() {
  const canvas = $('horizonCanvas');
  const { ctx, width: w, height: h } = setupCanvas(canvas);
  if (!w || !h || !state.seriesA.length) return;
  ctx.clearRect(0, 0, w, h);
  const m = { left: 38, right: 16, top: 17, bottom: 27 };
  const plotW = w - m.left - m.right;
  const plotH = h - m.top - m.bottom;
  const yMin = -20, yMax = 65;
  const x = az => m.left + (az / 360) * plotW;
  const y = el => m.top + ((yMax - el) / (yMax - yMin)) * plotH;

  ctx.font = '9px DM Mono, monospace';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let el = -20; el <= 60; el += 20) {
    ctx.strokeStyle = COLORS.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(m.left, y(el)); ctx.lineTo(w - m.right, y(el)); ctx.stroke();
    ctx.fillStyle = COLORS.text; ctx.fillText(`${el}°`, m.left - 8, y(el));
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let az = 0; az <= 360; az += 60) {
    ctx.strokeStyle = (document.documentElement.dataset.theme === 'light' ? 'rgba(80,95,110,.10)' : 'rgba(160,170,180,.10)'); ctx.beginPath(); ctx.moveTo(x(az), m.top); ctx.lineTo(x(az), h - m.bottom); ctx.stroke();
    if (az < 360) ctx.fillStyle = COLORS.text, ctx.fillText(`${az}°`, x(az), h - m.bottom + 7);
  }
  ctx.beginPath(); ctx.moveTo(x(0), y(terrainHorizonAtAzimuth(0, state.siteA)));
  for (let az = 1; az <= 360; az += 2) ctx.lineTo(x(az), y(terrainHorizonAtAzimuth(az, state.siteA)));
  ctx.lineTo(x(360), y(yMin)); ctx.lineTo(x(0), y(yMin)); ctx.closePath();
  const fill = ctx.createLinearGradient(0, m.top, 0, h - m.bottom);
  fill.addColorStop(0, document.documentElement.dataset.theme === 'light' ? 'rgba(95,115,135,.16)' : 'rgba(145,160,175,.16)'); fill.addColorStop(1, 'rgba(120,135,150,.02)');
  ctx.fillStyle = fill; ctx.fill();
  ctx.beginPath();
  for (let az = 0; az <= 360; az += 2) {
    const px = x(az), py = y(terrainHorizonAtAzimuth(az, state.siteA));
    if (az === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = COLORS.terrain; ctx.lineWidth = 2; ctx.stroke();

  const p = state.seriesA[state.index];
  drawSkyMarker(ctx, x(p.sunAz), y(p.sunEl), 'SUN', COLORS.sun, p.sunVisible, w, m);
  drawSkyMarker(ctx, x(p.earthAz), y(p.earthEl), 'EARTH', COLORS.earth, p.earthVisible, w, m);
  ctx.fillStyle = '#6d8098'; ctx.font = '8px DM Mono, monospace'; ctx.textAlign = 'left'; ctx.fillText('ABOVE LOCAL HORIZONTAL', m.left + 4, m.top + 5);
}

function drawSkyMarker(ctx, px, py, label, color, visible, width, margin) {
  const clampedX = clamp(px, margin.left + 5, width - margin.right - 5);
  ctx.save();
  ctx.strokeStyle = color; ctx.globalAlpha = visible ? 1 : .48; ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(clampedX, margin.top); ctx.lineTo(clampedX, py); ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(clampedX, py, 6, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  ctx.beginPath(); ctx.arc(clampedX, py, 10, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.globalAlpha = .28; ctx.stroke();
  ctx.globalAlpha = 1; ctx.fillStyle = color; ctx.font = 'bold 9px DM Mono, monospace'; ctx.textAlign = clampedX > width - 95 ? 'right' : 'left';
  const tx = clampedX > width - 95 ? clampedX - 12 : clampedX + 12;
  const ty = clamp(py - 12, margin.top + 12, margin.top + 18 + 10);
  ctx.fillText(`${label}${visible ? '' : ' · BLOCKED'}`, tx, ty);
  ctx.restore();
}

function drawTimeline() {
  const canvas = $('timelineCanvas');
  const { ctx, width: w, height: h } = setupCanvas(canvas);
  if (!w || !h || !state.seriesA.length) return;
  ctx.clearRect(0, 0, w, h);
  const m = { left: 39, right: 15, top: 13, bottom: 23 };
  const plotW = w - m.left - m.right, plotH = h - m.top - m.bottom;
  const minY = -20, maxY = 25;
  const x = i => m.left + (i / (state.seriesA.length - 1 || 1)) * plotW;
  const y = el => m.top + ((maxY - el) / (maxY - minY)) * plotH;
  ctx.font = '9px DM Mono, monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let angle = -20; angle <= 20; angle += 10) {
    ctx.strokeStyle = angle === 0 ? (document.documentElement.dataset.theme === 'light' ? 'rgba(55,65,75,.45)' : 'rgba(205,218,232,.42)') : COLORS.grid;
    ctx.setLineDash(angle === 0 ? [5, 4] : []); ctx.beginPath(); ctx.moveTo(m.left, y(angle)); ctx.lineTo(w - m.right, y(angle)); ctx.stroke();
    ctx.fillStyle = COLORS.text; ctx.fillText(`${angle}°`, m.left - 8, y(angle));
  }
  ctx.setLineDash([]);
  const drawLine = (key, color) => {
    ctx.beginPath();
    state.seriesA.forEach((p, i) => { if (i === 0) ctx.moveTo(x(i), y(p[key])); else ctx.lineTo(x(i), y(p[key])); });
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  };
  drawLine('sunEl', COLORS.sun); drawLine('earthEl', COLORS.earth);
  const cursorX = x(state.index);
  ctx.strokeStyle = COLORS.cursor; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(cursorX, m.top); ctx.lineTo(cursorX, h - m.bottom); ctx.stroke(); ctx.setLineDash([]);
  [[state.seriesA[state.index].sunEl, COLORS.sun], [state.seriesA[state.index].earthEl, COLORS.earth]].forEach(([val, color]) => {
    ctx.beginPath(); ctx.arc(cursorX, y(val), 4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = COLORS.markerOutline; ctx.lineWidth = 1.5; ctx.stroke();
  });
  ctx.fillStyle = COLORS.text; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = '8px DM Mono, monospace';
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const i = Math.round((state.seriesA.length - 1) * t / ticks);
    const label = `${(state.seriesA[i].elapsedHours / 24).toFixed(1)}d`;
    ctx.fillText(label, x(i), h - m.bottom + 7);
  }
}

function drawAll() { syncChartColors(); drawHorizon(); drawTimeline(); }

function exportCSV() {
  if (!state.seriesA.length) return;
  const rows = [['timestamp_utc','elapsed_hours','sun_azimuth_deg','sun_elevation_deg','sun_terrain_horizon_deg','sun_visible_demo','earth_azimuth_deg','earth_elevation_deg','earth_terrain_horizon_deg','earth_visible_demo']];
  state.seriesA.forEach(p => rows.push([
    p.date.toISOString(), p.elapsedHours.toFixed(3), p.sunAz.toFixed(3), p.sunEl.toFixed(3), p.sunHorizon.toFixed(3), p.sunVisible,
    p.earthAz.toFixed(3), p.earthEl.toFixed(3), p.earthHorizon.toFixed(3), p.earthVisible
  ]));
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = 'lunarwindow-demo-scenario-a.csv'; link.click();
  URL.revokeObjectURL(url);
}

function setPreset(which) {
  const key = $(`site${which}`).value;
  const preset = SITE_PRESETS[key] || SITE_PRESETS[which === 'A' ? 'customA' : 'customB'];
  $(`lat${which}`).value = preset.lat.toFixed(3);
  $(`lon${which}`).value = preset.lon.toFixed(3);
}

initializeTheme();

$('siteA').addEventListener('change', () => { setPreset('A'); updateAll(); });
$('siteB').addEventListener('change', () => { setPreset('B'); updateAll(); });
$('applyButton').addEventListener('click', updateAll);
['startDate','startTime','duration','stepMinutes'].forEach(id => $(id).addEventListener('change', updateAll));
$('timeSlider').addEventListener('input', event => {
  state.index = clamp(Number(event.target.value), 0, state.seriesA.length - 1);
  updateLabelsAndMetrics(); drawAll();
});
$('exportButton').addEventListener('click', exportCSV);
$('resetButton').addEventListener('click', () => {
  
  $('siteA').value = 'shackleton';
  $('siteB').value = 'cabeus';
  
  $('latA').value = SITE_PRESETS.shackleton.lat;
  $('lonA').value = SITE_PRESETS.shackleton.lon;
  $('latB').value = SITE_PRESETS.cabeus.lat;
  $('lonB').value = SITE_PRESETS.cabeus.lon;
  $('startDate').value = '2026-11-14'; $('startTime').value = '00:00';
  $('duration').value = '168'; $('stepMinutes').value = '30';
  updateAll();
});
window.addEventListener('resize', drawAll);

updateAll();
