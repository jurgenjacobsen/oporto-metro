import L from 'leaflet';

import stops from '../../gtfs/stops.json';
import shapes from '../../gtfs/shapes.json';
import trips from '../../gtfs/trips.json';
import routes from '../../gtfs/routes.json';


export function drawMetroSystem(map: L.Map) {
  // Group shapes by shape_id
  const shapeMap: Record<string, { lat: number; lon: number; seq: number }[]> = {};
  shapes.forEach((s: any) => {
    if (!shapeMap[s.shape_id]) shapeMap[s.shape_id] = [];
    shapeMap[s.shape_id].push({
      lat: parseFloat(s.shape_pt_lat),
      lon: parseFloat(s.shape_pt_lon),
      seq: parseInt(s.shape_pt_sequence)
    });
  });

  // Sort points by sequence
  Object.values(shapeMap).forEach(points => {
    points.sort((a, b) => a.seq - b.seq);
  });

  // Choose one shape per route
  const routeShapes: Record<string, string> = {};
  trips.forEach((trip: any) => {
    if (!routeShapes[trip.route_id]) {
      routeShapes[trip.route_id] = trip.shape_id;
    }
  });

  // Draw polylines
  Object.entries(routeShapes).forEach(([routeId, shapeId]) => {
    const shape = shapeMap[shapeId];
    const route = routes.find((r: any) => r.route_id === routeId);
    const color = route?.route_color ? `#${route.route_color}` : 'blue';

    const latlngs = shape.map(p => [p.lat, p.lon]) as [number, number][];
    L.polyline(latlngs, { color, weight: 3 }).addTo(map);
  });

  // Draw stops
  stops.forEach((stop: any) => {
    const lat = parseFloat(stop.stop_lat);
    const lon = parseFloat(stop.stop_lon);
    L.circleMarker([lat, lon], {
      radius: 3,
      fillColor: 'white',
      color: 'black',
      weight: 1,
      fillOpacity: 1
    })
      .bindTooltip(stop.stop_name)
      .addTo(map);
  });
}