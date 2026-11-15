'use strict';

const SITE_PRESETS = {
  Site01: 'Site 01', Site04: 'Site 04', Site06: 'Site 06',
  Site07: 'Site 07', Site11: 'Site 11', Site20: 'Site 20',
  Site20v2: 'Site 20 v2', Site23: 'Site 23', Site42: 'Site 42'
};
const $ = id => document.getElementById(id);
const state = {
  seriesA: [], seriesB: [], index: 0, siteA: null, siteB: null,
  start: null, durationHours: 168, stepMinutes: 30, requestId: 0
};
const siteCache = {};
const COLORS = { sun:'#d9ad67', earth:'#83b5d2', grid:'rgba(160,170,180,.18)', text:'#aab3bd', terrain:'#89939e', cursor:'rgba(180,190,200,.55)', markerOutline:'#292f36' };

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function wrap360(v) { return ((v % 360) + 360) % 360; }
function formatHours(v) { return `${v.toFixed(1)} h`; }
function formatDuration(hours) {
  const mins = Math.round(hours * 60), days = Math.floor(mins / 1440);
  const rem = mins % 1440;
  return days ? `${days}d ${Math.floor(rem / 60)}h ${String(rem % 60).padStart(2,'0')}m` : `${Math.floor(rem / 60)}h ${String(rem % 60).padStart(2,'0')}m`;
}
function formatDateTime(date) {
  return new Intl.DateTimeFormat('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'UTC' }).format(date).toUpperCase() + ' UTC';
}
function signedCoord(v, positive, negative) { return `${Math.abs(v).toFixed(3)}° ${v < 0 ? negative : positive}`; }
function getStartDate() {
  return new Date(`${$('startDate').value || '2026-11-15'}T${$('startTime').value || '00:00'}:00Z`);
}
function setStatus(title, detail, error = false) {
  $('statusTitle').textContent = title;
  $('statusDetail').textContent = detail;
  $('dataStatus').classList.toggle('is-error', error);
}
function syncChartColors() {
  const s = getComputedStyle(document.documentElement);
  COLORS.sun = s.getPropertyValue('--sun').trim() || COLORS.sun;
  COLORS.earth = s.getPropertyValue('--earth').trim() || COLORS.earth;
  COLORS.text = s.getPropertyValue('--muted').trim() || COLORS.text;
  COLORS.terrain = s.getPropertyValue('--dim').trim() || COLORS.terrain;
  COLORS.grid = document.documentElement.dataset.theme === 'light' ? 'rgba(80,95,110,.16)' : 'rgba(160,170,180,.18)';
  COLORS.cursor = document.documentElement.dataset.theme === 'light' ? 'rgba(50,60,70,.55)' : 'rgba(210,220,230,.48)';
  COLORS.markerOutline = s.getPropertyValue('--surface').trim() || '#292f36';
}
function applyTheme(theme) {
  const selected = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = selected;
  const light = selected === 'light';
  $('themeToggle').textContent = light ? 'Dark mode' : 'Light mode';
  $('themeToggle').setAttribute('aria-pressed', String(light));
  $('themeToggle').setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
  document.querySelector('meta[name="theme-color"]').content = light ? '#f6f7f8' : '#20252a';
  try { localStorage.setItem('lunarwindow-theme', selected); } catch (_) {}
  syncChartColors();
  if (state.seriesA.length) drawAll();
}
function initializeTheme() {
  let saved = 'light';
  try { saved = localStorage.getItem('lunarwindow-theme') || 'light'; } catch (_) {}
  applyTheme(saved);
  $('themeToggle').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
}
async function loadSiteData(id) {
  if (!siteCache[id]) {
    const response = await fetch(`./data/${id}.json`);
    if (!response.ok) throw new Error(`Missing ./data/${id}.json. Generate the site JSON files and place them in the data folder.`);
    const data = await response.json();
    if (!Array.isArray(data.horizonDeg) || data.horizonDeg.length !== 720) throw new Error(`${id}.json must contain 720 horizonDeg values (one every 0.5°).`);
    if (!Array.isArray(data.samples) || data.samples.length < 2) throw new Error(`${id}.json has no usable ephemeris samples.`);
    siteCache[id] = data;
  }
  return siteCache[id];
}
function interpolateAngle(a, b, t) {
  const d = ((b - a + 540) % 360) - 180;
  return wrap360(a + d * t);
}
function terrainHorizonAtAzimuth(azimuth, site) {
  const values = site.horizonDeg;
  const position = wrap360(azimuth) / 0.5;
  const base = Math.floor(position);
  const lo = base % values.length, hi = (lo + 1) % values.length;
  const t = position - base;
  return Number(values[lo]) + (Number(values[hi]) - Number(values[lo])) * t;
}
function interpolateSample(samples, date) {
  const target = date.getTime();
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (Date.parse(samples[mid].timestamp_utc) < target) lo = mid + 1;
    else hi = mid;
  }
  const upper = lo, lower = Math.max(0, upper - 1);
  const a = samples[lower], b = samples[upper];
  const ta = Date.parse(a.timestamp_utc), tb = Date.parse(b.timestamp_utc);
  const t = tb === ta ? 0 : clamp((target - ta) / (tb - ta), 0, 1);
  return {
    sunAz: interpolateAngle(Number(a.sun_azimuth_deg), Number(b.sun_azimuth_deg), t),
    sunEl: Number(a.sun_elevation_deg) + (Number(b.sun_elevation_deg) - Number(a.sun_elevation_deg)) * t,
    earthAz: interpolateAngle(Number(a.earth_azimuth_deg), Number(b.earth_azimuth_deg), t),
    earthEl: Number(a.earth_elevation_deg) + (Number(b.earth_elevation_deg) - Number(a.earth_elevation_deg)) * t
  };
}
function generateSeries(site, start, durationHours, stepMinutes) {
  const samples = site.samples;
  const first = Date.parse(samples[0].timestamp_utc), last = Date.parse(samples[samples.length - 1].timestamp_utc);
  const end = start.getTime() + durationHours * 3600000;
  if (start.getTime() < first || end > last) {
    throw new Error(`${site.name}: selected time range is outside the available ephemeris (${new Date(first).toISOString()} to ${new Date(last).toISOString()}).`);
  }
  const stepMs = stepMinutes * 60000, totalMs = durationHours * 3600000;
  const count = Math.floor(totalMs / stepMs) + 1;
  const points = [];
  for (let i = 0; i < count; i++) {
    const elapsedMs = Math.min(i * stepMs, totalMs);
    const date = new Date(start.getTime() + elapsedMs);
    const p = interpolateSample(samples, date);
    const sunHorizon = terrainHorizonAtAzimuth(p.sunAz, site);
    const earthHorizon = terrainHorizonAtAzimuth(p.earthAz, site);
    points.push({
      date, elapsedHours: elapsedMs / 3600000,
      sunAz:p.sunAz, sunEl:p.sunEl, earthAz:p.earthAz, earthEl:p.earthEl,
      sunHorizon, earthHorizon,
      sunVisible:p.sunEl > sunHorizon, earthVisible:p.earthEl > earthHorizon
    });
  }
  if (points[points.length - 1].date.getTime() < end) {
    const date = new Date(end), p = interpolateSample(samples, date);
    const sunHorizon = terrainHorizonAtAzimuth(p.sunAz, site);
    const earthHorizon = terrainHorizonAtAzimuth(p.earthAz, site);
    points.push({ date, elapsedHours:durationHours, sunAz:p.sunAz, sunEl:p.sunEl, earthAz:p.earthAz, earthEl:p.earthEl, sunHorizon, earthHorizon, sunVisible:p.sunEl > sunHorizon, earthVisible:p.earthEl > earthHorizon });
  }
  return points;
}
function summarize(points, key) {
  let visibleHours = 0, longest = 0, current = 0, peak = -90;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], sun = key === 'sun';
    const visible = sun ? p.sunVisible : p.earthVisible;
    peak = Math.max(peak, sun ? p.sunEl : p.earthEl);
    if (visible && i < points.length - 1) {
      const delta = (points[i + 1].date - p.date) / 3600000;
      visibleHours += delta; current += delta;
    } else if (!visible) {
      longest = Math.max(longest, current); current = 0;
    }
  }
  return { visibleHours, longest:Math.max(longest, current), peak };
}
function updateCoordinateFields() {
  for (const [which, site] of [['A',state.siteA],['B',state.siteB]]) {
    $(`lat${which}`).value = Number(site.lat).toFixed(3);
    $(`lon${which}`).value = Number(site.lon).toFixed(3);
  }
}
let activeRequest = 0;
async function updateAll() {
  const request = ++activeRequest;
  const start = getStartDate();
  if (Number.isNaN(start.getTime())) { setStatus('INVALID DATE','Check the selected UTC date and time.',true); return; }
  state.start = start;
  state.durationHours = Number($('duration').value);
  state.stepMinutes = Number($('stepMinutes').value);
  setStatus('LOADING DATA','Loading DEM horizon and Horizons ephemeris…');
  try {
    const idA = $('siteA').value, idB = $('siteB').value;
    const [a,b] = await Promise.all([loadSiteData(idA),loadSiteData(idB)]);
    if (request !== activeRequest) return;
    state.siteA = a; state.siteB = b;
    state.siteA.name = SITE_PRESETS[idA]; state.siteB.name = SITE_PRESETS[idB];
    state.seriesA = generateSeries(a,start,state.durationHours,state.stepMinutes);
    state.seriesB = generateSeries(b,start,state.durationHours,state.stepMinutes);
    state.index = 0;
    $('timeSlider').max = String(state.seriesA.length - 1);
    $('timeSlider').value = '0';
    updateCoordinateFields();
    updateLabelsAndMetrics();
    drawAll();
    setStatus('DATA LOADED','JPL Horizons ephemeris + DEM-derived horizon · preliminary');
  } catch (error) {
    console.error(error);
    if (request === activeRequest) setStatus('DATA UNAVAILABLE',error.message,true);
  }
}
function updateLabelsAndMetrics() {
  if (!state.seriesA.length || !state.seriesB.length) return;
  const a = state.seriesA, b = state.seriesB, p = a[state.index];
  const sunA = summarize(a,'sun'), earthA = summarize(a,'earth');
  const sunB = summarize(b,'sun'), earthB = summarize(b,'earth');
  $('selectedTimestamp').textContent = formatDateTime(p.date);
  $('elapsedLabel').textContent = `${formatDuration(p.elapsedHours)} / ${formatDuration(state.durationHours)}`;
  const startLabel = formatDateTime(state.start).replace(' UTC','');
  const endLabel = formatDateTime(a[a.length-1].date).replace(' UTC','');
  $('rangeStart').textContent = $('timelineStart').textContent = startLabel;
  $('rangeEnd').textContent = $('timelineEnd').textContent = endLabel;
  $('sunReadout').textContent = `${p.sunEl.toFixed(1)}° · ${Math.round(p.sunAz)}° AZ`;
  $('earthReadout').textContent = `${p.earthEl.toFixed(1)}° · ${Math.round(p.earthAz)}° AZ`;
  $('sunVisibility').textContent = p.sunVisible ? `VISIBLE · terrain horizon ${p.sunHorizon.toFixed(1)}°` : `OBSTRUCTED · terrain horizon ${p.sunHorizon.toFixed(1)}°`;
  $('earthVisibility').textContent = p.earthVisible ? `GEOMETRIC LOS · terrain horizon ${p.earthHorizon.toFixed(1)}°` : `NO GEOMETRIC LOS · terrain horizon ${p.earthHorizon.toFixed(1)}°`;
  $('sunHours').textContent = sunA.visibleHours.toFixed(1);
  $('earthHours').textContent = earthA.visibleHours.toFixed(1);
  $('sunLongest').textContent = formatDuration(sunA.longest);
  $('earthLongest').textContent = formatDuration(earthA.longest);
  $('metricSiteName').textContent = state.siteA.name;
  $('currentLat').textContent = signedCoord(state.siteA.lat,'N','S');
  $('currentLon').textContent = signedCoord(state.siteA.lon,'E','W');
  for (const [suffix,site,sun,earth] of [['A',state.siteA,sunA,earthA],['B',state.siteB,sunB,earthB]]) {
    $(`compareName${suffix}`).textContent = site.name;
    $(`compareCoords${suffix}`).textContent = `${signedCoord(site.lat,'N','S')} · ${signedCoord(site.lon,'E','W')}`;
    $(`compareSun${suffix}`).textContent = formatHours(sun.visibleHours);
    $(`compareEarth${suffix}`).textContent = formatHours(earth.visibleHours);
    $(`comparePeak${suffix}`).textContent = `${sun.peak.toFixed(1)}°`;
  }
}
function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1,2);
  canvas.width = Math.max(1,Math.round(rect.width*dpr)); canvas.height = Math.max(1,Math.round(rect.height*dpr));
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
  return {ctx,width:rect.width,height:rect.height};
}
function drawHorizon() {
  const {ctx,w,h} = (()=>{const v=setupCanvas($('horizonCanvas'));return {ctx:v.ctx,w:v.width,h:v.height};})();
  if (!w || !h || !state.seriesA.length) return;
  ctx.clearRect(0,0,w,h);
  const m={left:38,right:16,top:17,bottom:27}, pw=w-m.left-m.right, ph=h-m.top-m.bottom;
  const ymin=-20,ymax=65, x=az=>m.left+az/360*pw, y=el=>m.top+(ymax-el)/(ymax-ymin)*ph;
  ctx.font='9px DM Mono, monospace'; ctx.textAlign='right'; ctx.textBaseline='middle';
  for(let el=-20;el<=60;el+=20){ctx.strokeStyle=COLORS.grid;ctx.beginPath();ctx.moveTo(m.left,y(el));ctx.lineTo(w-m.right,y(el));ctx.stroke();ctx.fillStyle=COLORS.text;ctx.fillText(`${el}°`,m.left-8,y(el));}
  ctx.textAlign='center';ctx.textBaseline='top';
  for(let az=0;az<=360;az+=60){ctx.strokeStyle=COLORS.grid;ctx.beginPath();ctx.moveTo(x(az),m.top);ctx.lineTo(x(az),h-m.bottom);ctx.stroke();if(az<360){ctx.fillStyle=COLORS.text;ctx.fillText(`${az}°`,x(az),h-m.bottom+7);}}
  ctx.beginPath();ctx.moveTo(x(0),y(terrainHorizonAtAzimuth(0,state.siteA)));
  for(let az=1;az<=360;az++)ctx.lineTo(x(az),y(terrainHorizonAtAzimuth(az,state.siteA)));
  ctx.lineTo(x(360),y(ymin));ctx.lineTo(x(0),y(ymin));ctx.closePath();
  ctx.fillStyle=document.documentElement.dataset.theme==='light'?'rgba(95,115,135,.12)':'rgba(145,160,175,.13)';ctx.fill();
  ctx.beginPath();for(let az=0;az<=360;az++){const px=x(az),py=y(terrainHorizonAtAzimuth(az,state.siteA));if(!az)ctx.moveTo(px,py);else ctx.lineTo(px,py);}
  ctx.strokeStyle=COLORS.terrain;ctx.lineWidth=2;ctx.stroke();
  const p=state.seriesA[state.index];
  marker(ctx,x(p.sunAz),y(p.sunEl),'SUN',COLORS.sun,p.sunVisible,w,m);
  marker(ctx,x(p.earthAz),y(p.earthEl),'EARTH',COLORS.earth,p.earthVisible,w,m);
}
function marker(ctx,px,py,label,color,visible,width,m) {
  const cx=clamp(px,m.left+5,width-m.right-5);
  ctx.save();ctx.globalAlpha=visible?1:.48;ctx.strokeStyle=color;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(cx,m.top);ctx.lineTo(cx,py);ctx.stroke();ctx.setLineDash([]);
  ctx.beginPath();ctx.arc(cx,py,5.5,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
  ctx.globalAlpha=1;ctx.fillStyle=color;ctx.font='bold 9px DM Mono,monospace';ctx.textAlign=cx>width-95?'right':'left';ctx.fillText(label,cx>width-95?cx-11:cx+11,clamp(py-12,m.top+12,m.top+28));ctx.restore();
}
function drawTimeline() {
  const v=setupCanvas($('timelineCanvas')),ctx=v.ctx,w=v.width,h=v.height;
  if(!w||!h||!state.seriesA.length)return;
  ctx.clearRect(0,0,w,h);
  const m={left:39,right:15,top:13,bottom:23},pw=w-m.left-m.right;
  const min=-20,max=25,x=i=>m.left+i/(state.seriesA.length-1||1)*pw,y=a=>m.top+(max-a)/(max-min)*(h-m.top-m.bottom);
  ctx.font='9px DM Mono,monospace';ctx.textAlign='right';ctx.textBaseline='middle';
  for(let a=-20;a<=20;a+=10){ctx.strokeStyle=a===0?COLORS.text:COLORS.grid;ctx.setLineDash(a===0?[5,4]:[]);ctx.beginPath();ctx.moveTo(m.left,y(a));ctx.lineTo(w-m.right,y(a));ctx.stroke();ctx.fillStyle=COLORS.text;ctx.fillText(`${a}°`,m.left-8,y(a));}
  ctx.setLineDash([]);
  for(const [key,color] of [['sunEl',COLORS.sun],['earthEl',COLORS.earth]]){ctx.beginPath();state.seriesA.forEach((p,i)=>i?ctx.lineTo(x(i),y(p[key])):ctx.moveTo(x(i),y(p[key])));ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();}
  const cx=x(state.index);ctx.strokeStyle=COLORS.cursor;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(cx,m.top);ctx.lineTo(cx,h-m.bottom);ctx.stroke();ctx.setLineDash([]);
  for(const [val,color] of [[state.seriesA[state.index].sunEl,COLORS.sun],[state.seriesA[state.index].earthEl,COLORS.earth]]){ctx.beginPath();ctx.arc(cx,y(val),4,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}
  ctx.fillStyle=COLORS.text;ctx.textAlign='center';ctx.textBaseline='top';ctx.font='8px DM Mono,monospace';
  for(let t=0;t<=4;t++){const i=Math.round((state.seriesA.length-1)*t/4);ctx.fillText(`${(state.seriesA[i].elapsedHours/24).toFixed(1)}d`,x(i),h-m.bottom+7);}
}
function drawAll(){syncChartColors();drawHorizon();drawTimeline();}
function exportCSV() {
  if(!state.seriesA.length)return;
  const rows=[['timestamp_utc','elapsed_hours','sun_azimuth_deg','sun_elevation_deg','sun_terrain_horizon_deg','sun_visible','earth_azimuth_deg','earth_elevation_deg','earth_terrain_horizon_deg','earth_geometric_los']];
  state.seriesA.forEach(p=>rows.push([p.date.toISOString(),p.elapsedHours.toFixed(3),p.sunAz.toFixed(3),p.sunEl.toFixed(3),p.sunHorizon.toFixed(3),p.sunVisible,p.earthAz.toFixed(3),p.earthEl.toFixed(3),p.earthHorizon.toFixed(3),p.earthVisible]));
  const csv=rows.map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`lunarwindow-${state.siteA.id}-scenario-a.csv`;link.click();URL.revokeObjectURL(url);
}
function reset() {
  $('siteA').value='Site01';$('siteB').value='Site04';
  $('startDate').value='2026-11-15';$('startTime').value='00:00';
  $('duration').value='168';$('stepMinutes').value='30';updateAll();
}

initializeTheme();
$('siteA').addEventListener('change',updateAll);
$('siteB').addEventListener('change',updateAll);
$('applyButton').addEventListener('click',updateAll);
['startDate','startTime','duration','stepMinutes'].forEach(id=>$(id).addEventListener('change',updateAll));
$('timeSlider').addEventListener('input',e=>{if(!state.seriesA.length)return;state.index=clamp(Number(e.target.value),0,state.seriesA.length-1);updateLabelsAndMetrics();drawAll();});
$('exportButton').addEventListener('click',exportCSV);
$('resetButton').addEventListener('click',reset);
window.addEventListener('resize',drawAll);
updateAll();
