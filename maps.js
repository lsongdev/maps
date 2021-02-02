import * as L from 'https://unpkg.com/leaflet@1.9.4/dist/leaflet-src.esm.js';

const mapboxToken = 'pk.eyJ1Ijoic29uZzk0MCIsImEiOiJjbXQyZ2NoNG0wcmJnMzFza2hyN24wYXZnIn0.sbtEqrEqZVf3C9DmMSYmIg';
const mapboxLayer = (style) => ({
  url: `https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`,
  options: {
    maxZoom: 20,
    tileSize: 512,
    zoomOffset: -1,
    attribution: '&copy; Mapbox &copy; OpenStreetMap',
  },
});
const TILE_LAYERS = {
  streets: mapboxLayer('streets-v12'),
  light: mapboxLayer('light-v11'),
  satellite: mapboxLayer('satellite-streets-v12'),
};

const markerIcon = (type = 'place') => L.divIcon({
  className: `map-pin map-pin--${type}`,
  html: '<span></span>',
  iconSize: type === 'user' ? [24, 24] : [32, 38],
  iconAnchor: type === 'user' ? [12, 12] : [16, 36],
});

class LeafletMap extends HTMLElement {
  connectedCallback() {
    const shadowRoot = this.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `
      <style>
        @import url("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
        :host { display: block; background: #dce4df; }
        .leaflet-container { width: 100%; height: 100%; font-family: inherit; }
        .leaflet-control-zoom { border: 0 !important; box-shadow: 0 8px 24px rgba(31,49,39,.15) !important; margin: 0 0 22px 20px !important; }
        .leaflet-control-zoom a { border: 0 !important; color: #17211b; }
        .leaflet-control-attribution { background: rgba(255,255,255,.72) !important; }
        .map-pin { background: transparent; border: 0; }
        .map-pin--place span, .map-pin--start span, .map-pin--end span { display: block; width: 28px; height: 28px; border: 4px solid white; border-radius: 50% 50% 50% 4px; background: #146c43; box-shadow: 0 4px 13px rgba(0,0,0,.25); transform: rotate(-45deg); }
        .map-pin--end span { background: #e2513d; }
        .map-pin--user span { display: block; width: 18px; height: 18px; margin: 3px; border: 4px solid white; border-radius: 50%; background: #1877d2; box-shadow: 0 0 0 7px rgba(24,119,210,.18), 0 3px 10px rgba(0,0,0,.24); }
        @media (max-width: 620px) { .leaflet-control-zoom { display: none; } }
      </style><div></div>`;

    this.map = L.map(shadowRoot.querySelector('div'), { center: [31.2304, 121.4737], zoom: 12, zoomControl: false });
    L.control.zoom({ position: 'bottomleft' }).addTo(this.map);
    this.layers = Object.fromEntries(Object.entries(TILE_LAYERS).map(([id, layer]) => [id, L.tileLayer(layer.url, layer.options)]));
    this.activeLayer = this.layers.streets.addTo(this.map);
    this.map.attributionControl.setPrefix(false);
    this.markers = [];
    this.routeLayer = null;
    this.userMarker = null;
    this.map.on('click', ({ latlng }) => this.dispatchEvent(new CustomEvent('map-click', { detail: latlng })));
  }

  flyTo(coords, zoom = 15) {
    const latitude = coords.latitude ?? coords.lat;
    const longitude = coords.longitude ?? coords.lng ?? coords.lon;
    this.map.flyTo([Number(latitude), Number(longitude)], zoom, { duration: .8 });
  }

  setLayer(id) {
    if (!this.layers[id] || this.activeLayer === this.layers[id]) return;
    this.map.removeLayer(this.activeLayer);
    this.activeLayer = this.layers[id].addTo(this.map);
  }

  showPlace(place) {
    this.clearPlaces();
    const marker = L.marker([place.lat, place.lon], { icon: markerIcon('place') }).addTo(this.map);
    if (place.name) marker.bindTooltip(place.name, { direction: 'top', offset: [0, -30] }).openTooltip();
    this.markers.push(marker);
    this.flyTo(place, 16);
  }

  clearPlaces() { this.markers.forEach(marker => marker.remove()); this.markers = []; }

  setUserLocation(coords, follow = false) {
    const point = [coords.latitude, coords.longitude];
    if (!this.userMarker) this.userMarker = L.marker(point, { icon: markerIcon('user'), zIndexOffset: 1000 }).addTo(this.map);
    else this.userMarker.setLatLng(point);
    if (follow) this.map.panTo(point);
  }

  setRoute(coordinates, start, end) {
    this.clearRoute(); this.clearPlaces();
    const latLngs = coordinates.map(([lon, lat]) => [lat, lon]);
    this.routeLayer = L.featureGroup([
      L.polyline(latLngs, { color: 'white', weight: 10, opacity: .88, lineJoin: 'round' }),
      L.polyline(latLngs, { color: '#146c43', weight: 6, opacity: .96, lineJoin: 'round' }),
      L.marker([start.lat, start.lon], { icon: markerIcon('start') }),
      L.marker([end.lat, end.lon], { icon: markerIcon('end') }),
    ]).addTo(this.map);
    const mobile = matchMedia('(max-width: 620px)').matches;
    this.map.fitBounds(this.routeLayer.getBounds(), mobile
      ? { paddingTopLeft: [35, 220], paddingBottomRight: [35, 190], maxZoom: 16 }
      : { paddingTopLeft: [420, 80], paddingBottomRight: [80, 170], maxZoom: 16 });
  }

  clearRoute() { if (this.routeLayer) this.routeLayer.remove(); this.routeLayer = null; }
}

customElements.define('x-leaflet', LeafletMap);
