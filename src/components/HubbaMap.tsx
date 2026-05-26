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

function getRemainingSunHours(venue: Venue, evaluatedTime: Date): number {
  const activeLat = venue.outdoorPoint?.lat ?? venue.lat;
  const activeLng = venue.outdoorPoint?.lng ?? venue.lng;
  
  const baseDate = new Date(evaluatedTime);
  const { altitude: currAlt, azimuth: currAz } = getSolarCoordinates(activeLat, activeLng, baseDate);
  const inSunNow = isPointInSun(currAlt, currAz, venue.horizonMask);
  
  if (!inSunNow) return 0;
  
  let consecutiveMins = 0;
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const day = baseDate.getDate();
  const currentHour = baseDate.getHours();
  const currentMin = baseDate.getMinutes();
  
  const startMins = currentHour * 60 + currentMin;
  const endMins = 22 * 60;
  
  for (let mins = startMins; mins <= endMins; mins += 10) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const stepTime = new Date(year, month, day, h, m, 0);
    const { altitude, azimuth } = getSolarCoordinates(activeLat, activeLng, stepTime);
    
    if (isPointInSun(altitude, azimuth, venue.horizonMask)) {
      consecutiveMins += 10;
    } else {
      break;
    }
  }
  
  return consecutiveMins / 60;
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
  const lockedVenueMarkerRef = useRef<L.Marker | null>(null);
  const adjustmentMarkerRef = useRef<L.Marker | null>(null);
  const userLocMarkerRef = useRef<L.Marker | null>(null);

  const [zoomState, setZoomState] = useState(14);

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

  // Fixed map locking utilizing (map as any) type casts to bypass .tap TS errors
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (isAdjustingPoint) {
      map.dragging.disable();
      map.touchZoom.disable();
      map.doubleClickZoom.disable();
      map.scrollWheelZoom.disable();
      map.boxZoom.disable();
      map.keyboard.disable();
      if ((map as any).tap) (map as any).tap.disable();
    } else {
      map.dragging.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.enable();
      map.scrollWheelZoom.enable();
      map.boxZoom.enable();
      map.keyboard.enable();
      if ((map as any).tap) (map as any).tap.enable();
    }
  }, [isAdjustingPoint]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !targetCenter) return;
    map.setView([targetCenter.lat, targetCenter.lng], targetCenter.zoom ?? 15, { animate: true });
  }, [targetCenter]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    Object.keys(markersRef.current).forEach((key) => {
      if (key !== 'locked-venue' && key !== 'adjustable-seating') {
        markersRef.current[key].remove();
        delete markersRef.current[key];
      }
    });

    if (zoomState <= 13) {
      const clusters: { [key: string]: Venue[] } = {};
      const gridSize = zoomState === 13 ? 0.007 : zoomState === 12 ? 0.014 : 0.028;

      venues.forEach((venue) => {
        if (isAdjustingPoint && selectedVenue && venue.id === selectedVenue.id) return;

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
          renderIndividualMarker(map, list[0], false);
        } else {
          let sumLat = 0;
          let sumLng = 0;
          list.forEach(v => {
            sumLat += v.outdoorPoint?.lat ?? v.lat;
            sumLng += v.outdoorPoint?.lng ?? v.lng;
          });
          const avgLat = sumLat / list.length;
          const avgLng = sumLng / list.length;

          const anyInSun = list.some(v => {
            const activeLat = v.outdoorPoint?.lat ?? v.lat;
            const activeLng = v.outdoorPoint?.lng ?? v.lng;
            const { inSunNow } = calculateSunDetails(activeLat, activeLng, evaluatedTime, v.horizonMask);
            return inSunNow;
          });

          const isDimmed = isAdjustingPoint;

          const html = `
            <div class="flex items-center justify-center w-11 h-11 relative ${isDimmed ? 'opacity-15 pointer-events-none' : ''}">
              <div class="absolute inset-0"></div>
              <div class="w-8 h-8 bg-[#350505] text-[#eebd8d] rounded-full flex items-center justify-center text-xs font-bold shadow-md border-2 border-white relative transition-transform ${
                anyInSun ? 'ring-4 ring-[#fc5a47]/30' : ''
              }">
                ${list.length}
                ${anyInSun ? `<div class="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#fc5a47] rounded-full border border-white shadow-sm"></div>` : ''}
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
              if (isAdjustingPoint) return;
              map.setView([avgLat, avgLng], zoomState + 2, { animate: true });
            });

          markersRef.current[`cluster-${key}`] = clusterMarker;
        }
      });
    } else {
      venues.forEach((venue) => {
        if (isAdjustingPoint && selectedVenue && venue.id === selectedVenue.id) return;
        renderIndividualMarker(map, venue, zoomState >= 15);
      });
    }
  }, [venues, evaluatedTime, zoomState, isAdjustingPoint]);

  const renderIndividualMarker = (map: L.Map, venue: Venue, showBadge: boolean) => {
    const activeLat = venue.outdoorPoint?.lat ?? venue.lat;
    const activeLng = venue.outdoorPoint?.lng ?? venue.lng;
    const { inSunNow, totalSunMinutes } = calculateSunDetails(activeLat, activeLng, evaluatedTime, venue.horizonMask);

    const remainingHours = getRemainingSunHours(venue, evaluatedTime);
    const fillPercent = Math.min(100, Math.round((remainingHours / 4) * 100));

    const roundedHours = Math.round(totalSunMinutes / 60);
    const badgeText = roundedHours >= 6 ? '6h+' : `${roundedHours}h`;

    const isDimmed = isAdjustingPoint;

    const html = `
      <div class="flex items-center justify-center w-11 h-11 relative ${isDimmed ? 'opacity-15 pointer-events-none' : ''}">
        <div class="absolute inset-0"></div>
        
        <div class="rounded-full border-2 border-white shadow-md transition-all duration-300 ${
          inSunNow 
            ? 'w-5 h-5 bg-[#fc5a47] ring-4 ring-[#fc5a47]/20 scale-110' 
            : 'w-3.5 h-3.5 bg-[#eebd8d] opacity-55'
        }" style="${inSunNow ? `background: linear-gradient(to top, #fc5a47 ${fillPercent}%, rgba(238, 189, 141, 0.3) ${fillPercent}%);` : ''}"></div>

        ${showBadge && !isDimmed ? `
          <div class="absolute left-7 bg-[#faf8f5]/95 px-1.5 py-0.5 rounded-md border border-[#eebd8d]/30 shadow-sm text-[9px] font-extrabold whitespace-nowrap text-[#350505] tracking-tight">
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
      zIndexOffset: inSunNow ? 1000 : 0
    })
      .addTo(map)
      .on('click', () => {
        if (isAdjustingPoint) return;
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

    if (lockedVenueMarkerRef.current) {
      lockedVenueMarkerRef.current.remove();
      lockedVenueMarkerRef.current = null;
    }
    if (adjustmentMarkerRef.current) {
      adjustmentMarkerRef.current.remove();
      adjustmentMarkerRef.current = null;
    }

    if (isAdjustingPoint && selectedVenue) {
      const venueLat = selectedVenue.lat;
      const venueLng = selectedVenue.lng;
      const currentSeatingLat = selectedVenue.outdoorPoint?.lat ?? selectedVenue.lat;
      const currentSeatingLng = selectedVenue.outdoorPoint?.lng ?? selectedVenue.lng;

      const lockedIcon = L.divIcon({
        html: `
          <div class="flex flex-col items-center select-none">
            <div class="bg-[#94a3b8] text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap mb-1">
              Venue Center
            </div>
            <div class="w-3.5 h-3.5 bg-[#94a3b8] rounded-full border-2 border-white shadow-md"></div>
          </div>
        `,
        className: 'locked-venue-marker',
        iconSize: [80, 40],
        iconAnchor: [40, 36],
      });

      lockedVenueMarkerRef.current = L.marker([venueLat, venueLng], { icon: lockedIcon })
        .addTo(map);

      const seatingIcon = L.divIcon({
        html: `
          <div class="flex flex-col items-center select-none">
            <div class="bg-[#7cbec7] text-[#350505] text-[10px] font-extrabold px-2 py-0.5 rounded shadow-md whitespace-nowrap mb-1 ring-2 ring-[#7cbec7]/25">
              Outdoor Seating
            </div>
            <div class="w-6 h-6 rounded-full border-2 border-white bg-[#7cbec7] shadow-xl flex items-center justify-center ring-4 ring-[#7cbec7]/30"></div>
          </div>
        `,
        className: 'draggable-seating-marker',
        iconSize: [120, 50],
        iconAnchor: [60, 46],
      });

      const adjMarker = L.marker([currentSeatingLat, currentSeatingLng], {
        icon: seatingIcon,
        draggable: true,
        autoPan: false,
        zIndexOffset: 3000
      }).addTo(map);

      adjMarker.on('dragend', () => {
        const position = adjMarker.getLatLng();
        onUpdateOutdoorPoint(selectedVenue.id, position.lat, position.lng);
      });

      adjustmentMarkerRef.current = adjMarker;
      markersRef.current['adjustable-seating'] = adjMarker;
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
            <div class="w-3.5 h-3.5 bg-[#7cbec7] rounded-full border-2 border-white shadow-md"></div>
            <div class="absolute w-7 h-7 bg-[#7cbec7] rounded-full opacity-35 animate-ping"></div>
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