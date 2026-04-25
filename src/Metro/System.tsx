import L from 'leaflet';
import { useEffect, useState, useRef, useCallback } from 'react';
import Papa from 'papaparse';
import { subscribeToRealtime } from './Realtime';

export interface GTFSData {
  stops: any[];
  shapes: any[];
  trips: any[];
  routes: any[];
  stopTimes: any[];
  calendar: any[];
}

async function loadGTFSFile(fileName: string): Promise<any[]> {
  try {
    const response = await fetch(`/gtfs/${fileName}.txt`);
    if (!response.ok) {
      console.warn(`File /gtfs/${fileName}.txt not found.`);
      return [];
    }
    const csvString = await response.text();
    return new Promise((resolve) => {
      Papa.parse(csvString, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => resolve(results.data),
      });
    });
  } catch (e) {
    console.error(`Error loading ${fileName}.txt`, e);
    return [];
  }
}

export function useMetroSystem(map: L.Map) {
  const [data, setData] = useState<GTFSData | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const [stops, shapes, trips, routes, stopTimes, calendar] = await Promise.all([
          loadGTFSFile('stops'),
          loadGTFSFile('shapes'),
          loadGTFSFile('trips'),
          loadGTFSFile('routes'),
          loadGTFSFile('stop_times'),
          loadGTFSFile('calendar'),
        ]);
        
        setData({ stops, shapes, trips, routes, stopTimes, calendar });
      } catch (e) {
        console.error('Failed to load GTFS files:', e);
      }
    }
    init();
  }, []);

  useEffect(() => {
    if (!data || !map) return;

    const shapeMap: Record<string, { lat: number; lon: number; seq: number }[]> = {};
    data.shapes.forEach((s: any) => {
      if (!shapeMap[s.shape_id]) shapeMap[s.shape_id] = [];
      shapeMap[s.shape_id].push({
        lat: parseFloat(s.shape_pt_lat),
        lon: parseFloat(s.shape_pt_lon),
        seq: parseInt(s.shape_pt_sequence)
      });
    });

    Object.values(shapeMap).forEach(points => points.sort((a, b) => a.seq - b.seq));

    const routeShapes: Record<string, string> = {};
    data.trips.forEach((trip: any) => {
      if (!routeShapes[trip.route_id]) routeShapes[trip.route_id] = trip.shape_id;
    });

    const layers = L.layerGroup().addTo(map);

    Object.entries(routeShapes).forEach(([routeId, shapeId]) => {
      const shape = shapeMap[shapeId];
      if (!shape) return;
      const route = data.routes.find((r: any) => r.route_id === routeId);
      const color = route?.route_color ? `#${route.route_color}` : 'blue';
      const latlngs = shape.map(p => [p.lat, p.lon]) as [number, number][];
      L.polyline(latlngs, { color, weight: 4, opacity: 0.8 }).addTo(layers);
    });

    data.stops.forEach((stop: any) => {
      const lat = parseFloat(stop.stop_lat);
      const lon = parseFloat(stop.stop_lon);
      L.circleMarker([lat, lon], {
        radius: 5,
        fillColor: 'white',
        color: 'black',
        weight: 2,
        fillOpacity: 1
      })
        .bindTooltip(stop.stop_name)
        .on('click', () => {
          map.fire('stopClick', { stop });
        })
        .addTo(layers);
    });

    return () => {
      layers.remove();
    };
  }, [data, map]);

  return data;
}

export function useArrivals(data: GTFSData | null, stopId: string | null) {
  const [arrivals, setArrivals] = useState<any[]>([]);

  useEffect(() => {
    if (!data || !stopId || !data.stopTimes.length) {
      setArrivals([]);
      return;
    }

    const calculateArrivals = () => {
      const now = new Date();
      const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const today = days[now.getDay()];

      const activeServices = new Set(
        data.calendar
          .filter(c => c[today] === '1')
          .map(c => c.service_id)
      );

      const stopTimesAtStop = data.stopTimes.filter(st => String(st.stop_id) === String(stopId));

      const upcoming = stopTimesAtStop
        .map(st => {
          const trip = data.trips.find(t => t.trip_id === st.trip_id);
          if (!trip || (activeServices.size > 0 && !activeServices.has(trip.service_id))) return null;

          const route = data.routes.find(r => r.route_id === trip.route_id);
          const parts = st.departure_time.split(':').map(Number);
          const arrivalSeconds = parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0);

          if (arrivalSeconds < currentSeconds || arrivalSeconds > currentSeconds + 10800) return null;

          const diffMinutes = Math.floor((arrivalSeconds - currentSeconds) / 60);

          return {
            tripId: st.trip_id,
            time: st.departure_time.substring(0, 5),
            minutes: diffMinutes,
            route: route?.route_short_name || trip.route_id,
            headsign: trip.trip_headsign || route?.route_long_name || 'Metro',
            color: route?.route_color ? `#${route.route_color}` : '#3b82f6'
          };
        })
        .filter((x): x is any => x !== null)
        .sort((a, b) => a.minutes - b.minutes)
        .slice(0, 10);

      setArrivals(upcoming);
    };

    calculateArrivals();
    const interval = setInterval(calculateArrivals, 30000);
    return () => clearInterval(interval);
  }, [data, stopId]);

  return arrivals;
}

export function useVehicleTracking(map: L.Map, data: GTFSData | null, followingVehicleId: string | null) {
  const markersRef = useRef<Record<string, { marker: L.Marker; lastUpdate: number }>>({});
  const isDeadReckoning = import.meta.env.VITE_DEAD_RECKONING === 'true';

  const updateMarkers = useCallback((positions: any[]) => {
    const now = Date.now();
    const seenIds = new Set<string>();

    positions.forEach(pos => {
      seenIds.add(pos.id);
      const isBeingFollowed = pos.id === followingVehicleId;
      const color = isBeingFollowed ? '#ec4899' : (isDeadReckoning ? '#f59e0b' : '#3b82f6');
      const zIndex = isBeingFollowed ? 1000 : 500;

      // Find route/direction info
      let tooltipContent = `${isDeadReckoning ? '[SIM] ' : ''}Vehicle: ${pos.id}`;
      if (data) {
        const simTripId = pos.id.startsWith('sim-') ? pos.id.replace('sim-', '') : null;
        const trip = data.trips.find(t => t.trip_id === pos.tripId || t.trip_id === simTripId);
        const route = data.routes.find(r => r.route_id === (pos.routeId || trip?.route_id));
        if (route || trip) {
          const line = route?.route_short_name || route?.route_id || '';
          const dir = trip?.trip_headsign || '';
          tooltipContent = `Line ${line} ${dir ? `to ${dir}` : ''} (${pos.id})`;
        }
      }

      if (markersRef.current[pos.id]) {
        const marker = markersRef.current[pos.id].marker;
        marker.setLatLng([pos.latitude, pos.longitude]);
        marker.setZIndexOffset(zIndex);
        marker.setTooltipContent(tooltipContent);
        
        const el = marker.getElement()?.querySelector('.vehicle-marker-dot') as HTMLElement;
        if (el) el.style.backgroundColor = color;
        
        if (isBeingFollowed && !marker.isTooltipOpen()) {
          marker.openTooltip();
        }
        
        markersRef.current[pos.id].lastUpdate = now;
      } else {
        const marker = L.marker([pos.latitude, pos.longitude], { 
          icon: L.divIcon({
            className: 'vehicle-marker-container',
            html: `<div class="vehicle-marker-dot" style="background-color: ${color};"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7]
          }),
          zIndexOffset: zIndex
        })
          .bindTooltip(tooltipContent, { permanent: false, direction: 'top', offset: [0, -10] })
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            map.fire('vehicleClick', { vehicle: pos });
          })
          .addTo(map);

        if (isBeingFollowed) {
          marker.openTooltip();
        }

        markersRef.current[pos.id] = { marker, lastUpdate: now };
      }
    });

    Object.keys(markersRef.current).forEach(id => {
      const record = markersRef.current[id];
      const isStale = !isDeadReckoning && (now - record.lastUpdate > 120000);
      const isMissingInSim = isDeadReckoning && !seenIds.has(id);

      if (isStale || isMissingInSim) {
        record.marker.remove();
        delete markersRef.current[id];
      }
    });
  }, [map, isDeadReckoning, followingVehicleId, data]);

  useEffect(() => {
    if (isDeadReckoning) return;
    const unsubscribe = subscribeToRealtime(updateMarkers);
    return () => {
      unsubscribe();
      Object.values(markersRef.current).forEach(r => r.marker.remove());
      markersRef.current = {};
    };
  }, [isDeadReckoning, updateMarkers]);

  useEffect(() => {
    if (!isDeadReckoning || !data) return;

    const runSim = () => {
      const now = new Date();
      const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const today = days[now.getDay()];

      const activeServices = new Set(
        data.calendar.filter(c => c[today] === '1').map(c => c.service_id)
      );

      const positions: any[] = [];
      const timeToSeconds = (timeStr: string) => {
        const [h, m, s] = timeStr.split(':').map(Number);
        return h * 3600 + m * 60 + (s || 0);
      };

      data.trips.forEach(trip => {
        if (!activeServices.has(trip.service_id)) return;

        const stopTimes = data.stopTimes
          .filter(st => st.trip_id === trip.trip_id)
          .sort((a, b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence));

        if (stopTimes.length < 2) return;

        const firstTime = timeToSeconds(stopTimes[0].departure_time);
        const lastTime = timeToSeconds(stopTimes[stopTimes.length - 1].arrival_time);

        if (currentSeconds >= firstTime && currentSeconds <= lastTime) {
          for (let i = 0; i < stopTimes.length - 1; i++) {
            const s1 = stopTimes[i];
            const s2 = stopTimes[i + 1];
            const t1 = timeToSeconds(s1.departure_time);
            const t2 = timeToSeconds(s2.arrival_time);

            if (currentSeconds >= t1 && currentSeconds <= t2) {
              const stop1 = data.stops.find(s => String(s.stop_id) === String(s1.stop_id));
              const stop2 = data.stops.find(s => String(s.stop_id) === String(s2.stop_id));

              if (stop1 && stop2) {
                const ratio = (currentSeconds - t1) / (t2 - t1 || 1);
                const lat = parseFloat(stop1.stop_lat) + (parseFloat(stop2.stop_lat) - parseFloat(stop1.stop_lat)) * ratio;
                const lon = parseFloat(stop1.stop_lon) + (parseFloat(stop2.stop_lon) - parseFloat(stop1.stop_lon)) * ratio;
                positions.push({ id: `sim-${trip.trip_id}`, latitude: lat, longitude: lon });
              }
              break;
            }
          }
        }
      });
      updateMarkers(positions);
    };

    runSim();
    const interval = setInterval(runSim, 2000);
    return () => {
      clearInterval(interval);
      Object.values(markersRef.current).forEach(r => r.marker.remove());
      markersRef.current = {};
    };
  }, [isDeadReckoning, data, updateMarkers]);
}
