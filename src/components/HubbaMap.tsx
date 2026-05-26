import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Venue } from '../types';
import { calculateSunDetails } from '../utils/sunUtils';

interface HubbaMapProps {
  venues: Venue[];
  selectedVenue: Venue | null;
  onSelectVenue: (venue: Venue) => void;
  evaluatedTime: Date;
  isAdjustingPoint: boolean;
  onUpdateOutdoorPoint: (id: string, lat: number, lng: number) => void;
  userLocation: { lat: number; lng: number } | null;
  onBoundsChange: (bounds: L.LatLngBounds) => void;
  targetCenter: { lat: number; lng: number; zoom?: number } | null;
}

export const HubbaMap: React.FC<HubbaMapProps> = ({
  venues,
  selectedVenue,
  onSelectVenue,
  evaluatedTime,
  isAdjustingPoint,
  onUpdateOutdoorPoint,
  userLocation,
  onBoundsChange,
  targetCenter,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ [key: string]: L.Marker }>({});
  const adjustmentMarkerRef = useRef<L.Marker | null>(null);
  const userLocMarkerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [57.708878, 11.974560],
      zoom: 14,
      minZoom: 12,
      maxZoom: 18,
      zoomControl: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors © CARTO',
    }).addTo(map);

    map.on('moveend', () => {
      onBoundsChange(map.getBounds());
    });

    setTimeout(() => {
      onBoundsChange(map.getBounds());
    }, 100);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !targetCenter) return;
    map.setView([targetCenter.lat, targetCenter.lng], targetCenter.zoom ?? 15, { animate: true });
  }, [targetCenter]);

  // Update/Draw Venue Markers with ultra-clean, minimal geometric dots
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    Object.values(markersRef.current).forEach((m) => m.remove());
    markersRef.current = {};

    venues.forEach((venue) => {
      const activeLat = venue.outdoorPoint?.lat ?? venue.lat;
      const activeLng = venue.outdoorPoint?.lng ?? venue.lng;
      const { inSunNow } = calculateSunDetails(activeLat, activeLng, evaluatedTime, venue.horizonMask);

      // Replaced busy SVG icon with a clean, high-contrast, modern solid dot
      const html = `
        <div class="flex items-center justify-center transition-transform duration-300">
          <div class="rounded-full border-2 border-white shadow-md transition-all duration-300 ${
            inSunNow 
              ? 'w-5 h-5 bg-amber-500 ring-4 ring-amber-500/20 scale-110' 
              : 'w-3 h-3 bg-slate-400 opacity-65'
          }"></div>
        </div>
      `;

      const customIcon = L.divIcon({
        html,
        className: 'custom-venue-dot',
        iconSize: inSunNow ? [24, 24] : [16, 16],
        iconAnchor: inSunNow ? [12, 12] : [8, 8],
      });

      const marker = L.marker([activeLat, activeLng], { icon: customIcon })
        .addTo(map)
        .on('click', () => {
          onSelectVenue(venue);
        });

      markersRef.current[venue.id] = marker;
    });
  }, [venues, evaluatedTime]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedVenue) return;
    const targetLat = selectedVenue.outdoorPoint?.lat ?? selectedVenue.lat;
    const targetLng = selectedVenue.outdoorPoint?.lng ?? selectedVenue.lng;
    map.setView([targetLat, targetLng], 16, { animate: true });
  }, [selectedVenue]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (adjustmentMarkerRef.current) {
      adjustmentMarkerRef.current.remove();
      adjustmentMarkerRef.current = null;
    }

    if (isAdjustingPoint && selectedVenue) {
      const currentLat = selectedVenue.outdoorPoint?.lat ?? selectedVenue.lat;
      const currentLng = selectedVenue.outdoorPoint?.lng ?? selectedVenue.lng;

      const adjustIcon = L.divIcon({
        html: `
          <div class="flex flex-col items-center">
            <div class="bg-slate-900 text-white rounded-lg px-2.5 py-1 text-[10px] font-bold shadow-md whitespace-nowrap mb-1">
              Drag to outdoor seating
            </div>
            <div class="w-7 h-7 rounded-full border-2 border-white bg-slate-900 shadow-xl flex items-center justify-center text-white">
              📍
            </div>
          </div>
        `,
        className: 'custom-adjustment-icon',
        iconSize: [120, 60],
        iconAnchor: [60, 56],
      });

      const adjMarker = L.marker([currentLat, currentLng], {
        icon: adjustIcon,
        draggable: true,
      }).addTo(map);

      adjMarker.on('dragend', () => {
        const position = adjMarker.getLatLng();
        onUpdateOutdoorPoint(selectedVenue.id, position.lat, position.lng);
      });

      adjustmentMarkerRef.current = adjMarker;
    }
  }, [isAdjustingPoint, selectedVenue]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (userLocMarkerRef.current) {
      userLocMarkerRef.current.remove();
      userLocMarkerRef.current = null;
    }

    if (userLocation) {
      const userIcon = L.divIcon({
        html: `
          <div class="relative flex items-center justify-center">
            <div class="w-3.5 h-3.5 bg-blue-500 rounded-full border-2 border-white shadow-md"></div>
            <div class="absolute w-7 h-7 bg-blue-400 rounded-full opacity-30 animate-ping"></div>
          </div>
        `,
        className: 'user-location-marker',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      userLocMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], { icon: userIcon }).addTo(map);
    }
  }, [userLocation]);

  return <div ref={mapContainerRef} className="w-full h-full" />;
};