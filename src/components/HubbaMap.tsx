import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Venue } from '../types';
import { calculateSunDetails, getSolarCoordinates, isPointInSun } from '../utils/sunUtils';

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
  const markersRef = useRef<{ [key: string]: L.Marker | L.Layer }>({});
  const adjustmentMarkerRef = useRef<L.Marker | null>(null);
  const userLocMarkerRef = useRef<L.Marker | null>(null);

  // Active zoom state tracker to drive progressive visual disclosure
  const [zoomState, setZoomState] = useState(14);

  // Initialize Map
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

    map.on('zoomend', () => {
      setZoomState(map.getZoom());
    });

    setTimeout(() => {
      onBoundsChange(map.getBounds());
      setZoomState(map.getZoom());
    }, 100);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fly-to listener for district chips jumping
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !targetCenter) return;
    map.setView([targetCenter.lat, targetCenter.lng], targetCenter.zoom ?? 15, { animate: true });
  }, [targetCenter]);

  // Update/Draw Venue Markers and Custom Clustering
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear previous markers and layers
    Object.values(markersRef.current).forEach((layer) => layer.remove());
    markersRef.current = {};

    // A. Lightweight, reactive grid-clustering system (Zoom <= 13)
    if (zoomState <= 13) {
      const clusters: { [key: string]: Venue[] } = {};
      // Set grid boundary scale based on zoom density
      const gridSize = zoomState === 13 ? 0.007 : zoomState === 12 ? 0.014 : 0.028;

      venues.forEach((venue) => {
        const lat = venue.outdoorPoint?.lat ?? venue.lat;
        const lng = venue.outdoorPoint?.lng ?? venue.lng;
        const cellX = Math.floor(lng / gridSize);
        const cellY = Math.floor(lat / gridSize);
        const key = `${cellX}_${cellY}`;
        
        if (!clusters[key]) {
          clusters[key] = [];
        }
        clusters[key].push(venue);
      });

      Object.entries(clusters).forEach(([key, list]) => {
        if (list.length === 1) {
          // Render individual marker with no progressive badge
          renderIndividualMarker(map, list[0], false);
        } else {
          // Calculate centroid center
          let sumLat = 0;
          let sumLng = 0;
          list.forEach(v => {
            sumLat += v.outdoorPoint?.lat ?? v.lat;
            sumLng += v.outdoorPoint?.lng ?? v.lng;
          });
          const avgLat = sumLat / list.length;
          const avgLng = sumLng / list.length;

          // Check if any patio inside is currently in the sun
          const anyInSun = list.some(v => {
            const activeLat = v.outdoorPoint?.lat ?? v.lat;
            const activeLng = v.outdoorPoint?.lng ?? v.lng;
            const { inSunNow } = calculateSunDetails(activeLat, activeLng, evaluatedTime, v.horizonMask);
            return inSunNow;
          });

          const html = `
            <div class="flex items-center justify-center w-11 h-11 relative">
              <div class="absolute inset-0"></div> <!-- 44px tap target -->
              <div class="w-8 h-8 bg-[#350505] text-[#eab88d] rounded-full flex items-center justify-center text-xs font-bold shadow-md border-2 border-white relative transition-transform ${
                anyInSun ? 'ring-4 ring-[#cf5a47]/30' : ''
              }">
                ${list.length}
                ${anyInSun ? `<div class="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#cf5a47] rounded-full border border-white shadow-sm"></div>` : ''}
              </div>
            </div>
          `;

          const customIcon = L.divIcon({
            html,
            className: 'custom-cluster-icon',
            iconSize: [44, 44],
            iconAnchor: [22, 22],
          });

          const clusterMarker = L.marker([avgLat, avgLng], { icon: customIcon, zIndexOffset: 2000 })
            .addTo(map)
            .on('click', () => {
              map.setView([avgLat, avgLng], zoomState + 2, { animate: true });
            });

          markersRef.current[`cluster-${key}`] = clusterMarker;
        }
      });
    } else {
      // B. Individual rendering mode (Zoom >= 14)
      venues.forEach((venue) => {
        renderIndividualMarker(map, venue, zoomState >= 15);
      });
    }
  }, [venues, evaluatedTime, zoomState]);

  // Helper function to render a clean, high-contrast, dual-dimension marker
  const renderIndividualMarker = (map: L.Map, venue: Venue, showBadge: boolean) => {
    const activeLat = venue.outdoorPoint?.lat ?? venue.lat;
    const activeLng = venue.outdoorPoint?.lng ?? venue.lng;
    const { inSunNow, totalSunMinutes } = calculateSunDetails(activeLat, activeLng, evaluatedTime, venue.horizonMask);

    // Compute sun-hours badge text (Capped at 6h+)
    const roundedHours = Math.round(totalSunMinutes / 60);
    const badgeText = roundedHours >= 6 ? '6h+' : `${roundedHours}h`;

    // Visual Hierarchy: Sun = high-contrast terracotta (#cf5a47); Shade = neutral gray (#94a3b8)
    const html = `
      <div class="flex items-center justify-center w-11 h-11 relative">
        <div class="absolute inset-0"></div> <!-- Guaranteed 44px transparent tap target -->
        
        <div class="rounded-full border-2 border-white shadow-md transition-all duration-300 ${
          inSunNow 
            ? 'w-5 h-5 bg-[#cf5a47] ring-4 ring-[#cf5a47]/20 scale-110' 
            : 'w-3.5 h-3.5 bg-[#94a3b8] opacity-70'
        }"></div>

        <!-- Progressive disclosure hours badge (Visible at Zoom >= 15) -->
        ${showBadge ? `
          <div class="absolute left-7 bg-white/95 px-1.5 py-0.5 rounded-md border border-slate-100 shadow-sm text-[9px] font-extrabold whitespace-nowrap text-[#350505] tracking-tight">
            ${badgeText}
          </div>
        ` : ''}
      </div>
    `;

    const customIcon = L.divIcon({
      html,
      className: 'custom-venue-dot',
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });

    const marker = L.marker([activeLat, activeLng], { 
      icon: customIcon,
      zIndexOffset: inSunNow ? 1000 : 0 // Sun markers drawn on top of shade markers
    })
      .addTo(map)
      .on('click', () => {
        onSelectVenue(venue);
      });

    markersRef.current[venue.id] = marker;
  };

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
            <div class="bg-[#cf5a47] text-white rounded-lg px-2.5 py-1 text-[10px] font-bold shadow-md whitespace-nowrap mb-1">
              Drag to outdoor seating
            </div>
            <div class="w-7 h-7 rounded-full border-2 border-white bg-[#cf5a47] shadow-xl flex items-center justify-center text-white">
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

  // Geolocation dot
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
            <div class="w-3.5 h-3.5 bg-[#7cbcc7] rounded-full border-2 border-white shadow-md"></div>
            <div class="absolute w-7 h-7 bg-[#7cbcc7] rounded-full opacity-35 animate-ping"></div>
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