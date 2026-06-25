const CONFIG = {
  // ArcGIS Hub / ArcGIS Online item for Jefferson County Public Parcels StatePlane.
  countyPortalItemId: 'bac06906630646e08b9f4e7213e16a1e',
  idField: 'PIN_STRING',
  assessorBaseUrl: 'https://trueweb.jeffcowa.us/propertyaccess/Property.aspx?cid=0'
};

const map = L.map('map', { zoomControl: true });

const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors'
});

const esriImagery = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 20, attribution: 'Tiles &copy; Esri' }
);

const usgsTopo = L.tileLayer(
  'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 16, attribution: 'USGS The National Map' }
);

usgsTopo.addTo(map);

const memberStyle = { color: '#1f5fbf', weight: 1.3, opacity: 0.9, fillColor: '#4f9aff', fillOpacity: 0.12 };
const boundaryStyle = { color: '#d7191c', weight: 4, opacity: 0.95, fillOpacity: 0 };
const commonStyle = { color: '#238b45', weight: 1.6, opacity: 0.9, fillColor: '#74c476', fillOpacity: 0.32 };
const highlightStyle = { color: '#ff9900', weight: 4, opacity: 1, fillOpacity: 0.35 };

let memberLotsLayer, boundaryLayer, commonAreasLayer;
let memberFeatures = [];
let highlightedLayer = null;
let layerControl = null;

function setStatus(text, cls='') {
  const el = document.getElementById('status');
  el.className = `status ${cls}`;
  el.textContent = text;
}

function val(props, keys) {
  for (const k of keys) {
    if (props && props[k] !== undefined && props[k] !== null && String(props[k]).trim() !== '') return props[k];
  }
  return '';
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function labelFor(props) {
  const address = val(props, ['Situs_Addr', 'ADDRESS', 'Address']);
  const pin = val(props, ['PIN_STRING', 'PIN']);
  return address || pin || 'Parcel';
}

function assessorUrl(props) {
  const propId = val(props, ['Prop_ID', 'PROP_ID', 'prop_id']);
  if (!propId) return '';
  const year = Number(val(props, ['AV_Year', 'PACSWeb_Year'])) || new Date().getFullYear();
  return `${CONFIG.assessorBaseUrl}&prop_id=${encodeURIComponent(String(propId).replace(/\.0$/, ''))}&year=${encodeURIComponent(year)}`;
}

function assessorSearchUrl(props) {
  const pin = val(props, ['PIN_STRING', 'PIN']);
  return 'https://trueweb.jeffcowa.us/propertyaccess/PropertySearch.aspx?cid=0' + (pin ? `#${encodeURIComponent(pin)}` : '');
}

function popupHtml(props, layerName) {
  const fields = [
    ['Layer', layerName],
    ['Address', val(props, ['Situs_Addr', 'ADDRESS', 'Address'])],
    ['PIN', val(props, ['PIN_STRING', 'PIN'])],
    ['Property ID', val(props, ['Prop_ID'])],
    ['Subdivision', val(props, ['Subdv_Desc', 'SUBDIVISION'])],
    ['Land use', val(props, ['LU_Desc', 'Land_Use'])],
    ['Acres', val(props, ['Ttl_Acres', 'ACRES'])],
    ['Legal', val(props, ['Legal_Desc', 'LEGAL'])]
  ].filter(row => row[1] !== '');

  const detail = assessorUrl(props);
  const links = `<div class="popup-links">${detail ? `<a href="${htmlEscape(detail)}" target="_blank" rel="noopener">Open county assessor record</a>` : ''}<a href="${htmlEscape(assessorSearchUrl(props))}" target="_blank" rel="noopener">County property search</a></div>`;
  return `<strong>${htmlEscape(labelFor(props))}</strong><table class="popup-table">` +
    fields.map(([k,v]) => `<tr><th>${htmlEscape(k)}</th><td>${htmlEscape(v)}</td></tr>`).join('') +
    `</table>${links}`;
}

function featureSearchText(feature) {
  const p = feature.properties || {};
  return [
    p.Situs_Addr, p.PIN_STRING, p.PIN, p.Subdv_Desc,
    p.Legal_Desc, p.LU_Desc, p.Situs_City, p.Prop_ID
  ].filter(Boolean).join(' ').toLowerCase();
}

function clearHighlight() {
  if (highlightedLayer && highlightedLayer.setStyle) highlightedLayer.setStyle(memberStyle);
  highlightedLayer = null;
}

function zoomToLayer(layer) {
  clearHighlight();
  highlightedLayer = layer;
  layer.setStyle(highlightStyle);
  map.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 19 });
  layer.openPopup();
}

function makeResultItem(feature, layer) {
  const p = feature.properties || {};
  const div = document.createElement('div');
  div.className = 'result-item';
  div.innerHTML = `<div class="result-title">${htmlEscape(labelFor(p))}</div>
    <div class="result-sub">PIN ${htmlEscape(val(p, ['PIN_STRING','PIN']) || '—')}<br>${htmlEscape(val(p, ['Subdv_Desc']) || '')}</div>`;
  div.onclick = () => zoomToLayer(layer);
  return div;
}

function doSearch() {
  const q = document.getElementById('searchBox').value.trim().toLowerCase();
  const resultList = document.getElementById('resultList');
  resultList.innerHTML = '';
  clearHighlight();
  if (!q) {
    resultList.textContent = 'Enter an address, parcel number, legal description, or subdivision.';
    return;
  }
  const matches = memberFeatures.filter(x => x.searchText.includes(q)).slice(0, 50);
  if (!matches.length) {
    resultList.textContent = 'No matching member lots found.';
    return;
  }
  matches.forEach(x => resultList.appendChild(makeResultItem(x.feature, x.layer)));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} loading ${url}`);
  return await response.json();
}

async function addGeoJson(url, options) {
  const data = await fetchJson(url);
  return L.geoJSON(data, options);
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

async function discoverCountyParcelLayerUrl(itemId) {
  const portalUrl = `https://www.arcgis.com/sharing/rest/content/items/${encodeURIComponent(itemId)}?f=json`;
  const item = await fetchJson(portalUrl);
  if (!item.url) throw new Error('ArcGIS item did not expose a service URL.');
  let url = item.url.replace(/\/$/, '');
  // The item URL may be the service root or may already be a layer URL.
  if (!/\/(FeatureServer|MapServer)\/\d+$/i.test(url)) {
    url = `${url}/0`;
  }
  return url;
}

function whereIn(field, ids) {
  return `${field} IN (${ids.map(id => `'${String(id).replace(/'/g, "''")}'`).join(',')})`;
}

async function queryCountyParcels(layerUrl, parcelIds, idField) {
  const features = [];
  // Keep batches small enough for URL length and service limits.
  for (const ids of chunk(parcelIds, 80)) {
    const params = new URLSearchParams({
      f: 'geojson',
      where: whereIn(idField, ids),
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326'
    });
    const data = await fetchJson(`${layerUrl}/query?${params.toString()}`);
    if (data.features) features.push(...data.features);
  }
  return { type: 'FeatureCollection', features };
}

function addMemberLayer(geojson, sourceLabel) {
  memberFeatures = [];
  if (memberLotsLayer) map.removeLayer(memberLotsLayer);
  memberLotsLayer = L.geoJSON(geojson, {
    style: memberStyle,
    onEachFeature: (feature, layer) => {
      layer.bindPopup(popupHtml(feature.properties || {}, 'HOA Member Lots'));
      memberFeatures.push({ feature, layer, searchText: featureSearchText(feature) });
    }
  }).addTo(map);
  document.getElementById('resultList').textContent = `${memberFeatures.length} member lots loaded from ${sourceLabel}. Search by address, PIN, legal description, or subdivision.`;
}

async function loadMemberLotsLive() {
  const idList = await fetchJson('data/hoa_parcel_ids.json');
  const parcelIds = idList.parcelIds || [];
  const idField = idList.idField || CONFIG.idField;
  const layerUrl = await discoverCountyParcelLayerUrl(idList.sourceItemId || CONFIG.countyPortalItemId);
  const geojson = await queryCountyParcels(layerUrl, parcelIds, idField);
  if (!geojson.features.length) throw new Error('Live county query returned zero parcels.');
  addMemberLayer(geojson, 'live Jefferson County parcel service');
  setStatus(`Live county parcels loaded: ${geojson.features.length} of ${parcelIds.length} HOA parcel IDs.`, 'ok');
}

async function loadMemberLotsStaticFallback() {
  const data = await fetchJson('data/HOA_Member_Lots.geojson');
  addMemberLayer(data, 'static fallback GeoJSON');
  setStatus(`Using static fallback parcel layer: ${data.features.length} lots.`, 'warn');
}

async function initializeMap() {
  try {
    await loadMemberLotsLive();
  } catch (err) {
    console.warn('Live county parcel load failed; falling back to static GeoJSON.', err);
    await loadMemberLotsStaticFallback();
    setStatus(`Live county service unavailable; using static fallback. ${err.message}`, 'warn');
  }

  boundaryLayer = await addGeoJson('data/HOA_District_Boundary.geojson', {
    style: boundaryStyle,
    onEachFeature: (feature, layer) => layer.bindPopup(popupHtml(feature.properties || {}, 'HOA District Boundary'))
  });
  commonAreasLayer = await addGeoJson('data/HOA_Common_Areas.geojson', {
    style: commonStyle,
    onEachFeature: (feature, layer) => layer.bindPopup(popupHtml(feature.properties || {}, 'HOA Common Areas'))
  });

//  boundaryLayer.addTo(map);
  commonAreasLayer.addTo(map);

  const bounds = L.featureGroup([memberLotsLayer, boundaryLayer, commonAreasLayer]).getBounds();
  map.fitBounds(bounds, { padding: [20, 20] });

  layerControl = L.control.layers(
    { 'Esri World Imagery': esriImagery, 'OpenStreetMap': osm, 'USGS Topo': usgsTopo },
    { 'HOA Member Lots': memberLotsLayer, 'District Boundary Candidate': boundaryLayer, 'Common Areas / Context': commonAreasLayer },
    { collapsed: false }
  ).addTo(map);
}

initializeMap().catch(err => {
  document.getElementById('resultList').textContent = err.message;
  setStatus(err.message, 'error');
  console.error(err);
});

document.getElementById('searchButton').addEventListener('click', doSearch);
document.getElementById('searchBox').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
document.getElementById('clearButton').addEventListener('click', () => {
  document.getElementById('searchBox').value = '';
  doSearch();
  if (memberLotsLayer) map.fitBounds(memberLotsLayer.getBounds(), { padding: [20,20] });
});
