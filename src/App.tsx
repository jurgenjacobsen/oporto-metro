import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, useMap, Marker, Circle, useMapEvents } from 'react-leaflet';
import { useMetroSystem, useVehicleTracking, useArrivals } from './Metro';
import L from 'leaflet';

import 'leaflet/dist/leaflet.css';
import './App.css';
import { GithubIcon } from './Metro/components/GithubIcon';

// Custom User Location Icon
const userLocationIcon = L.divIcon({
  className: 'user-location-marker',
  html: '<div class="user-location-dot"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function LocationManager({ active, onDeactivate }: { active: boolean, onDeactivate: () => void }) {
  const [position, setPosition] = useState<L.LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number>(0);
  const map = useMapEvents({
    locationfound(e) {
      setPosition(e.latlng);
      setAccuracy(e.accuracy);
      if (active) {
        map.flyTo(e.latlng, map.getZoom());
      }
    },
    locationerror(e) {
      console.error("Location error:", e.message);
      onDeactivate();
    }
  });

  useEffect(() => {
    if (active) {
      map.locate({ setView: false, watch: true });
    } else {
      map.stopLocate();
      setPosition(null);
    }
  }, [active, map]);

  if (!active || !position) return null;

  return (
    <>
      <Circle
        center={position}
        radius={accuracy}
        pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.1, weight: 1 }}
      />
      <Marker position={position} icon={userLocationIcon} />
    </>
  );
}

function MetroLayer({ onStopClick, onDataLoaded, onVehicleClick, onMapClick, followingVehicleId }: { 
  onStopClick: (stop: any) => void, 
  onDataLoaded: (data: any) => void,
  onVehicleClick: (vehicle: any) => void,
  onMapClick: () => void,
  followingVehicleId: string | null
}) {
  const map = useMap();
  const data = useMetroSystem(map);
  
  useEffect(() => {
    if (data) onDataLoaded(data);
  }, [data, onDataLoaded]);

  useVehicleTracking(map, data, followingVehicleId);

  useEffect(() => {
    const handleStopClick = (e: any) => onStopClick(e.stop);
    const handleVehicleClick = (e: any) => onVehicleClick(e.vehicle);
    const handleMapClick = () => onMapClick();
    const handleManualMove = () => onMapClick(); // Same as map click: stop following

    map.on('stopClick', handleStopClick);
    map.on('vehicleClick', handleVehicleClick);
    map.on('click', handleMapClick);
    map.on('dragstart', handleManualMove);
    
    return () => {
      map.off('stopClick', handleStopClick);
      map.off('vehicleClick', handleVehicleClick);
      map.off('click', handleMapClick);
      map.off('dragstart', handleManualMove);
    };
  }, [map, onStopClick, onVehicleClick, onMapClick]);

  return null;
}

function FollowManager({ vehicleId }: { vehicleId: string }) {
  const map = useMap();

  useEffect(() => {
    // Initial focus: zoom in and center
    map.eachLayer((layer: any) => {
      if (layer instanceof L.Marker) {
        const tooltip = layer.getTooltip();
        const content = tooltip?.getContent();
        if (typeof content === 'string' && content.includes(vehicleId)) {
          map.setView(layer.getLatLng(), 16, { animate: true, duration: 0.5 });
        }
      }
    });

    // Panning frequency optimized for CSS transitions
    const interval = setInterval(() => {
      map.eachLayer((layer: any) => {
        if (layer instanceof L.Marker) {
          const tooltip = layer.getTooltip();
          const content = tooltip?.getContent();
          if (typeof content === 'string' && content.includes(vehicleId)) {
            map.panTo(layer.getLatLng(), { animate: true, duration: 1.0 });
            if (!layer.isTooltipOpen()) {
              layer.openTooltip();
            }
          }
        }
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [map, vehicleId]);

  return null;
}

export default function App() {
  const [selectedStop, setSelectedStop] = useState<any>(null);
  const [gtfsData, setGtfsData] = useState<any>(null);
  const [followingVehicle, setFollowingVehicle] = useState<any>(null);
  const [showLocation, setShowLocation] = useState(false);
  
  const arrivals = useArrivals(gtfsData, selectedStop?.stop_id);

  useEffect(() => {
    // Check if permission was already granted to enable automatically
    if ("permissions" in navigator) {
      navigator.permissions.query({ name: 'geolocation' as PermissionName }).then((result) => {
        if (result.state === 'granted') {
          setShowLocation(true);
        }
      });
    }
  }, []);

  // Bounds covering Porto Metropolitan Area
  const METRO_BOUNDS: L.LatLngBoundsExpression = [
    [41.57, -8.96], // Northwest
    [40.79, -8.25]  // Southeast
  ];

  return (
    <div className="h-screen w-full relative flex flex-col md:flex-row bg-gray-50 overflow-hidden">
      <div className="flex-1 relative">
        <MapContainer
          minZoom={11}
          className="h-full w-full"
          bounds={METRO_BOUNDS}
          maxBounds={METRO_BOUNDS}
          maxBoundsViscosity={1.0}
          preferCanvas={true}
          zoomAnimation={true}
          markerZoomAnimation={true}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
          />
          <MetroLayer 
            onStopClick={(stop) => { setSelectedStop(stop); setFollowingVehicle(null); }} 
            onDataLoaded={setGtfsData}
            onVehicleClick={(v) => { setFollowingVehicle(v); setSelectedStop(null); }}
            onMapClick={() => { setFollowingVehicle(null); }}
            followingVehicleId={followingVehicle?.id || null}
          />
          <LocationManager active={showLocation} onDeactivate={() => setShowLocation(false)} />
          {followingVehicle && <FollowManager vehicleId={followingVehicle.id} />}
        </MapContainer>

        <button
          onClick={() => setShowLocation(!showLocation)}
          className={`absolute bottom-20 right-4 z-[1000] p-3 rounded-full shadow-lg transition-all ${
            showLocation ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
          }`}
          title={showLocation ? "Hide My Location" : "Show My Location"}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
          </svg>
        </button>

        {followingVehicle && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-200"></span>
            </span>
            <span className="font-bold text-sm tracking-tight">Following Vehicle {followingVehicle.id}</span>
            <button 
              onClick={() => setFollowingVehicle(null)}
              className="bg-blue-700 hover:bg-blue-800 rounded-full w-6 h-6 flex items-center justify-center transition-colors cursor-pointer text-sm font-bold leading-none shrink-0"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {selectedStop && (
        <div className="w-full md:w-96 h-1/2 md:h-full bg-white shadow-2xl z-[1000] flex flex-col border-l border-gray-200 animate-in slide-in-from-right duration-300">
          <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-bold text-gray-800 tracking-tight">{selectedStop.stop_name}</h2>
              <p className="text-sm text-gray-500 font-medium">Next Departures</p>
            </div>
            <button 
              onClick={() => setSelectedStop(null)}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-200 transition-colors text-gray-500 hover:text-gray-800 cursor-pointer text-xl font-light leading-none"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            {arrivals.length > 0 ? (
              <div className="space-y-3">
                {arrivals.map((arrival, idx) => (
                  <div key={`${arrival.tripId}-${idx}`} className="flex items-center gap-4 p-4 rounded-xl border border-gray-100 hover:border-blue-200 bg-white shadow-sm transition-all group">
                    <div 
                      className="w-10 h-10 flex items-center justify-center rounded-lg font-bold text-white shadow-inner shrink-0"
                      style={{ backgroundColor: arrival.color }}
                    >
                      {arrival.route}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-800 truncate">{arrival.headsign}</div>
                      <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">{arrival.time}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-2xl font-black text-blue-600 tabular-nums">
                        {arrival.minutes === 0 ? 'Now' : `${arrival.minutes}'`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-2xl">
                  ⏳
                </div>
                {gtfsData?.stopTimes?.length === 0 ? (
                  <>
                    <p className="text-gray-600 font-semibold">Schedule data unavailable</p>
                    <p className="text-sm text-gray-400 mt-2">Make sure stop_times.txt is in public/gtfs/</p>
                  </>
                ) : (
                  <>
                    <p className="text-gray-600 font-semibold">No more metros today</p>
                    <p className="text-sm text-gray-400 mt-2">Check back during service hours</p>
                  </>
                )}
              </div>
            )}
          </div>
          
          <div className="p-4 bg-gray-50 text-[10px] text-gray-400 text-center uppercase tracking-[0.2em] border-t border-gray-100 font-bold">
            Real-time updates enabled
          </div>
        </div>
      )}

      <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 space-x-2 z-[1000] items-center justify-center flex ${selectedStop ? 'hidden md:flex' : 'flex'} w-full`}>
        <div className="text-xs text-gray-400 p-2 rounded-full bg-gray-50 border border-gray-200 shadow-sm">
          Made with ❤️ by <a href="https://github.com/jurgenjacobsen" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">Jürgen Jacobsen</a>
        </div>

        <a 
          href="https://github.com/jurgenjacobsen/oporto-metro" 
          target="_blank" 
          rel="noopener noreferrer"
          className='flex items-center justify-center p-2 rounded-full bg-gray-50 border border-gray-200 shadow-sm hover:bg-gray-100 transition-colors cursor-pointer text-gray-700 hover:text-black'
          title="View Source on GitHub"
        >
          <GithubIcon size={18} />
        </a>
      </div>
    </div>
  );
}
