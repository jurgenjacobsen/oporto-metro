import { useEffect } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import { drawMetroSystem } from './Metro';

import 'leaflet/dist/leaflet.css';
import './App.css';



function MetroLayer() {
  const map = useMap();

  useEffect(() => {
    drawMetroSystem(map);
  }, [map]);

  return null;
}

export default function App() {
  return (
    <div className="h-screen w-full">
      <MapContainer
        minZoom={11}
        className="h-full w-full"
        bounds={[[41.37812,-8.758081], [41.09872, -8.588716]]}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        <MetroLayer/>
      </MapContainer>
    </div>
  );
}