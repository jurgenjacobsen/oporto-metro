import mqtt from 'mqtt';
import { transit_realtime } from 'gtfs-realtime-bindings';

const BROKER_URL = 'wss://mmt.portodigital.pt/websocket/';
const TOPIC = '/gtfsrt/vp/#';

export interface VehiclePosition {
  id: string;
  latitude: number;
  longitude: number;
  bearing?: number;
  speed?: number;
  tripId?: string;
  routeId?: string;
}

export type RealtimeCallback = (positions: VehiclePosition[]) => void;

export function subscribeToRealtime(onUpdate: RealtimeCallback) {
  if (import.meta.env.VITE_DEAD_RECKONING === 'true') {
    return () => {}; // No-op for WebSocket in dead reckoning mode
  }
  const client = mqtt.connect(BROKER_URL);

  client.on('connect', () => {
    console.log('Connected to Porto Metro Realtime Feed');
    client.subscribe(TOPIC);
  });

  client.on('message', (_topic, message) => {
    try {
      const feed = transit_realtime.FeedMessage.decode(new Uint8Array(message));
      const positions: VehiclePosition[] = (feed.entity || [])
        .filter(entity => entity.vehicle)
        .map(entity => {
          const v = entity.vehicle;
          const id = v?.vehicle?.id || v?.trip?.tripId || entity.id || 'unknown';
          console.log(v)
          return {
            id,
            latitude: v?.position?.latitude ?? 0,
            longitude: v?.position?.longitude ?? 0,
            bearing: v?.position?.bearing ?? undefined,
            speed: v?.position?.speed ?? undefined,
            tripId: v?.trip?.tripId ?? undefined,
            routeId: v?.trip?.routeId ?? undefined,
          };
        })
        .filter(pos => pos.latitude !== 0 && pos.longitude !== 0)
        .filter(pos => {
          // Porto Metro routes are typically single letters A, B, C, D, E, F
          // STCP buses usually have numeric or multi-character IDs
          const isMetro = pos.routeId && /^[A-F]$/.test(pos.routeId);
          return isMetro;
        });

      if (positions.length > 0) {
        onUpdate(positions);
      }
    } catch (error) {
      console.error('Error decoding GTFS-RT message:', error);
    }
  });

  return () => {
    client.end();
  };
}
