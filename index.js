const $ = (selector) => document.querySelector(selector);
const map = $('x-leaflet');
const searchForm = $('.search-form');
const searchInput = $('#place-search');
const searchResults = $('.search-results');
const routePlanner = $('.route-planner');
const routeSummary = $('.route-summary');
const startInput = $('#route-start');
const endInput = $('#route-end');
const API_ORIGIN = 'https://api.lsong.org';

const state = { userLocation:null, start:null, end:null, mode:'driving', route:null, searchTarget:'place', watchId:null, debounceId:null };
const maneuverIcons = { left:'↰', right:'↱', straight:'↑', 'slight left':'↖', 'slight right':'↗', 'sharp left':'↶', 'sharp right':'↷', uturn:'↶' };

function showToast(message) {
  const toast = $('.toast');
  toast.textContent = message; toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.classList.remove('show'); setTimeout(() => { toast.hidden = true; }, 220); }, 2600);
}

function formatDistance(meters) { return meters < 1000 ? `${Math.round(meters)} 米` : `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} 公里`; }
function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60 ? `${minutes % 60} 分` : ''}`.trim();
}
function placeName(place) { return place.name || place.display_name?.split(',')[0] || '已选位置'; }

async function searchPlaces(query) {
  const params = new URLSearchParams({ q:query, limit:'6' });
  const data = await fetchJson(`${API_ORIGIN}/maps/search?${params}`);
  return data.results;
}

async function reverseGeocode(lat, lon) {
  try {
    const params = new URLSearchParams({ lat, lon });
    const data = await fetchJson(`${API_ORIGIN}/maps/reverse?${params}`);
    return data.result;
  } catch {
    return { lat:Number(lat), lon:Number(lon), name:'地图选点', display_name:`${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}` };
  }
}

function renderResults(results) {
  searchResults.innerHTML = ''; searchResults.hidden = false;
  if (!results.length) { searchResults.innerHTML = '<p class="empty-result">没有找到相关地点，试试更具体的关键词</p>'; return; }
  results.forEach((place) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'result-item'; button.setAttribute('role', 'option');
    button.innerHTML = '<span class="result-pin">⌖</span><span class="result-copy"><strong></strong><small></small></span>';
    button.querySelector('strong').textContent = placeName(place);
    button.querySelector('small').textContent = place.display_name || '';
    button.addEventListener('click', () => selectPlace(place));
    searchResults.appendChild(button);
  });
}

function selectPlace(rawPlace) {
  const place = { ...rawPlace, lat:Number(rawPlace.lat), lon:Number(rawPlace.lon), name:placeName(rawPlace) };
  if (state.searchTarget === 'start') { state.start = place; startInput.value = place.name; }
  else if (state.searchTarget === 'end') { state.end = place; endInput.value = place.name; }
  else { searchInput.value = place.name; searchForm.classList.add('has-value'); map.showPlace(place); }
  searchResults.hidden = true; searchResults.innerHTML = '';
  if (state.searchTarget !== 'place') {
    routePlanner.hidden = false;
    if (state.searchTarget === 'start') endInput.focus();
    else $('.plan-route').focus();
  }
}

async function runSearch(query) {
  if (query.trim().length < 2) { searchResults.hidden = true; return; }
  searchResults.hidden = false; searchResults.innerHTML = '<p class="empty-result">正在搜索…</p>';
  try { renderResults(await searchPlaces(query.trim())); }
  catch (error) { searchResults.innerHTML = `<p class="empty-result">${error.message}</p>`; }
}

function setSearchTarget(target, value) {
  state.searchTarget = target; searchInput.value = value || '';
  searchInput.placeholder = target === 'start' ? '搜索路线起点' : target === 'end' ? '搜索路线终点' : '搜索地点、地址或地标';
  searchForm.classList.toggle('has-value', Boolean(value)); searchInput.focus();
  if (value?.length >= 2) runSearch(value);
}

function locateUser({ fly = true, silent = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { const error = new Error('当前浏览器不支持定位'); if (!silent) showToast(error.message); reject(error); return; }
    $('.locate-button').classList.add('loading');
    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude } = position.coords;
      state.userLocation = { lat:latitude, lon:longitude, latitude, longitude, name:'我的位置', display_name:'当前定位' };
      map.setUserLocation(position.coords); if (fly) map.flyTo(position.coords, 15);
      $('.locate-button').classList.remove('loading'); resolve(state.userLocation);
    }, (error) => {
      $('.locate-button').classList.remove('loading');
      if (!silent) showToast(error.code === 1 ? '请允许浏览器访问你的位置' : '暂时无法获取当前位置');
      reject(error);
    }, { enableHighAccuracy:true, timeout:9000, maximumAge:30000 });
  });
}

async function ensureRoutePoint(which) {
  const point = state[which]; const input = which === 'start' ? startInput : endInput;
  if (point && (input.value === point.name || input.value === '我的位置')) return point;
  if (which === 'start' && (!input.value.trim() || input.value.trim() === '我的位置')) {
    const located = state.userLocation || await locateUser({ fly:false }); state.start = located; startInput.value = '我的位置'; return located;
  }
  if (!input.value.trim()) throw new Error(which === 'start' ? '请输入起点' : '请输入目的地');
  const results = await searchPlaces(input.value.trim());
  if (!results.length) throw new Error(`找不到“${input.value.trim()}”`);
  const selected = { ...results[0], lat:Number(results[0].lat), lon:Number(results[0].lon), name:placeName(results[0]) };
  state[which] = selected; input.value = selected.name; return selected;
}

function stepText(step) {
  if (step.maneuver.instruction) return step.maneuver.instruction;
  const { type, modifier } = step.maneuver; const road = step.name ? `进入 ${step.name}` : '继续前行';
  if (type === 'depart') return `从起点出发，${road}`;
  if (type === 'arrive') return '到达目的地';
  if (type === 'roundabout' || type === 'rotary') return `进入环岛，${road}`;
  const turns = { left:'左转', right:'右转', straight:'直行', 'slight left':'向左前方行驶', 'slight right':'向右前方行驶', 'sharp left':'向左后方转弯', 'sharp right':'向右后方转弯', uturn:'掉头' };
  return `${turns[modifier] || '继续'}，${road}`;
}

async function planRoute() {
  const button = $('.plan-route'); button.disabled = true; button.textContent = '正在规划…';
  try {
    const [start, end] = await Promise.all([ensureRoutePoint('start'), ensureRoutePoint('end')]);
    const params = new URLSearchParams({ mode:state.mode, start:`${start.lon},${start.lat}`, end:`${end.lon},${end.lat}` });
    const data = await fetchJson(`${API_ORIGIN}/maps/directions?${params}`);
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('未找到可行路线');
    state.route = data.routes[0]; map.setRoute(state.route.geometry.coordinates, start, end); renderRoute(state.route);
  } catch (error) { showToast(error.message || '路线规划失败，请稍后重试'); }
  finally { button.disabled = false; button.textContent = '开始规划'; }
}

function renderRoute(route) {
  $('.route-duration').textContent = formatDuration(route.duration); $('.route-distance').textContent = `约 ${formatDistance(route.distance)}`;
  const list = $('.route-steps'); list.innerHTML = '';
  route.legs.flatMap(leg => leg.steps).forEach((step) => {
    const li = document.createElement('li'); li.textContent = stepText(step);
    const small = document.createElement('small'); small.textContent = formatDistance(step.distance); li.appendChild(small); list.appendChild(li);
  });
  routeSummary.hidden = false; $('.navigation-now').hidden = true; $('.route-steps').hidden = false; $('.start-navigation').hidden = false;
}

function distanceBetween(a, b) {
  const rad = n => n * Math.PI / 180; const dLat = rad(b[1] - a[1]); const dLon = rad(b[0] - a[0]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(x));
}

function updateNavigation(coords) {
  const steps = state.route?.legs.flatMap(leg => leg.steps) || []; if (!steps.length) return;
  const here = [coords.longitude, coords.latitude]; let nearest = steps[0]; let nearestDistance = Infinity;
  steps.forEach((step) => { const distance = distanceBetween(here, step.maneuver.location); if (distance < nearestDistance) { nearestDistance = distance; nearest = step; } });
  const next = steps[Math.min(steps.indexOf(nearest) + 1, steps.length - 1)]; const distance = distanceBetween(here, next.maneuver.location);
  $('.navigation-now strong').textContent = stepText(next);
  $('.navigation-now span').textContent = distance < 30 && next.maneuver.type === 'arrive' ? '即将到达目的地' : `${formatDistance(distance)} 后`;
  $('.maneuver-icon').textContent = maneuverIcons[next.maneuver.modifier] || (next.maneuver.type === 'arrive' ? '●' : '↑'); map.setUserLocation(coords, true);
}

async function startNavigation() {
  try {
    await locateUser({ fly:false }); $('.navigation-now').hidden = false; $('.route-steps').hidden = true; $('.start-navigation').hidden = true;
    updateNavigation({ longitude:state.userLocation.lon, latitude:state.userLocation.lat });
    state.watchId = navigator.geolocation.watchPosition(({ coords }) => updateNavigation(coords), () => showToast('导航定位已暂停'), { enableHighAccuracy:true, maximumAge:2000, timeout:12000 });
    showToast('导航已开始，请注意出行安全');
  } catch { /* locateUser already provides feedback */ }
}
function stopNavigation() {
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId); state.watchId = null;
  $('.navigation-now').hidden = true; $('.route-steps').hidden = false; $('.start-navigation').hidden = false;
}

searchForm.addEventListener('submit', (event) => { event.preventDefault(); runSearch(searchInput.value); });
searchInput.addEventListener('input', () => { searchForm.classList.toggle('has-value', Boolean(searchInput.value)); clearTimeout(state.debounceId); state.debounceId = setTimeout(() => runSearch(searchInput.value), 320); });
$('.clear-search').addEventListener('click', () => { searchInput.value = ''; searchForm.classList.remove('has-value'); searchResults.hidden = true; if (state.searchTarget === 'place') map.clearPlaces(); searchInput.focus(); });
$('.route-toggle').addEventListener('click', () => { routePlanner.hidden = !routePlanner.hidden; if (!routePlanner.hidden) { startInput.value ||= '我的位置'; state.start ||= state.userLocation; endInput.focus(); } });
startInput.addEventListener('focus', () => setSearchTarget('start', startInput.value === '我的位置' ? '' : startInput.value));
endInput.addEventListener('focus', () => setSearchTarget('end', endInput.value));
startInput.addEventListener('input', () => { state.start = null; }); endInput.addEventListener('input', () => { state.end = null; });
$('.use-location').addEventListener('click', async () => { try { state.start = await locateUser({ fly:false }); startInput.value = '我的位置'; } catch { /* feedback handled */ } });
$('.swap-route').addEventListener('click', () => { [state.start, state.end] = [state.end, state.start]; [startInput.value, endInput.value] = [endInput.value, startInput.value]; });
$('.travel-modes').addEventListener('click', (event) => { const button = event.target.closest('[data-mode]'); if (!button) return; state.mode = button.dataset.mode; document.querySelectorAll('[data-mode]').forEach(item => item.classList.toggle('active', item === button)); });
$('.plan-route').addEventListener('click', planRoute);
$('.layers-button').addEventListener('click', () => { $('.layer-menu').hidden = !$('.layer-menu').hidden; });
$('.layer-menu').addEventListener('click', (event) => { const button = event.target.closest('[data-layer]'); if (!button) return; map.setLayer(button.dataset.layer); document.querySelectorAll('[data-layer]').forEach(item => item.classList.toggle('active', item === button)); $('.layer-menu').hidden = true; });
$('.locate-button').addEventListener('click', () => locateUser().catch(() => {}));
$('.close-route').addEventListener('click', () => { stopNavigation(); routeSummary.hidden = true; state.route = null; map.clearRoute(); });
$('.start-navigation').addEventListener('click', startNavigation); $('.stop-navigation').addEventListener('click', stopNavigation);

map.addEventListener('map-click', async ({ detail }) => {
  if (routePlanner.hidden) return;
  const target = state.searchTarget === 'start' ? 'start' : 'end'; const place = await reverseGeocode(detail.lat, detail.lng);
  state[target] = place; (target === 'start' ? startInput : endInput).value = place.name; searchResults.hidden = true; showToast(`${target === 'start' ? '起点' : '终点'}已设为地图选点`);
});
document.addEventListener('click', (event) => { if (!event.target.closest('.search-card')) searchResults.hidden = true; if (!event.target.closest('.map-tools')) $('.layer-menu').hidden = true; });
locateUser({ fly:true, silent:true }).catch(() => {});

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || '地图服务暂时不可用');
  return data;
}
