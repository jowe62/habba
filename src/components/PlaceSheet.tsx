import React, { useMemo } from 'react';
import { Venue } from '../types';
import { getSolarCoordinates, isPointInSun, calculateSunDetails } from '../utils/sunUtils';

interface PlaceSheetProps {
  venue: Venue;
  evaluatedTime: Date;
  onClose: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  isAdjustingPoint: boolean;
  onToggleAdjustMode: () => void;
  onResetOutdoorPoint: () => void;
}

export const PlaceSheet: React.FC<PlaceSheetProps> = ({
  venue,
  evaluatedTime,
  onClose,
  isFavorite,
  onToggleFavorite,
  isAdjustingPoint,
  onToggleAdjustMode,
  onResetOutdoorPoint,
}) => {
  const activeLat = venue.outdoorPoint?.lat ?? venue.lat;
  const activeLng = venue.outdoorPoint?.lng ?? venue.lng;

  const sun = calculateSunDetails(activeLat, activeLng, evaluatedTime, venue.horizonMask);

  const timelineSegments = useMemo(() => {
    const segments = [];
    const baseDate = new Date(evaluatedTime);
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const day = baseDate.getDate();

    for (let i = 0; i < 28; i++) {
      const totalMinutes = 8 * 60 + i * 30;
      const hour = Math.floor(totalMinutes / 60);
      const min = totalMinutes % 60;

      const sampleTime = new Date(year, month, day, hour, min, 0);
      const { altitude, azimuth } = getSolarCoordinates(activeLat, activeLng, sampleTime);
      const inSun = isPointInSun(altitude, azimuth, venue.horizonMask);

      segments.push({
        timeStr: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
        inSun,
      });
    }
    return segments;
  }, [activeLat, activeLng, evaluatedTime, venue.horizonMask]);

  const pointerPercent = useMemo(() => {
    const currentMins = evaluatedTime.getHours() * 60 + evaluatedTime.getMinutes();
    const startMins = 8 * 60;
    const totalMins = 14 * 60;
    
    const percentage = ((currentMins - startMins) / totalMins) * 100;
    return Math.max(0, Math.min(100, percentage));
  }, [evaluatedTime]);

  const getDirectionsUrl = () => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    return isIOS
      ? `maps://?q=${encodeURIComponent(venue.name)}&ll=${activeLat},${activeLng}`
      : `https://www.google.com/maps/search/?api=1&query=${activeLat},${activeLng}`;
  };

  const formatDisplayTime = (d: Date) => {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="bg-white rounded-t-3xl shadow-2xl border-t border-slate-100 flex flex-col max-h-[85vh] overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-50">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-[#350505] truncate">{venue.name}</h3>
          <p className="text-xs text-slate-500 truncate mt-0.5">{venue.address}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleFavorite}
            className={`p-2 rounded-full border transition-colors ${
              isFavorite
                ? 'bg-rose-50 border-rose-200 text-rose-500'
                : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600'
            }`}
          >
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5cc0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          </button>
          <button onClick={onClose} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-600">
            ✕
          </button>
        </div>
      </div>

      <div className="overflow-y-auto px-5 py-4 space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-[#eab88d]/10 border border-[#eab88d]/20 rounded-2xl">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Currently</span>
            <span className={`text-sm font-extrabold block mt-0.5 ${sun.inSunNow ? 'text-[#cf5a47]' : 'text-slate-500'}`}>
              {sun.inSunNow ? '☀️ Sunny Patio' : '🌥️ In Shade'}
            </span>
          </div>
          <div className="p-3 bg-[#eab88d]/10 border border-[#eab88d]/20 rounded-2xl">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Sun today</span>
            <span className="text-sm font-extrabold text-[#350505] block mt-0.5">{(sun.totalSunMinutes / 60).toFixed(1)} hours</span>
          </div>
        </div>

        {/* --- TIMELINE SECTION (Legend and Alerts completely hidden) --- */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Day Sun-Profile (08:00 - 22:00)</span>
          </div>

          <div className="relative pt-1.5 pb-2">
            <div className="flex h-3 w-full gap-[2px] rounded-md overflow-hidden bg-slate-100">
              {timelineSegments.map((seg, idx) => (
                <div
                  key={idx}
                  title={`${seg.timeStr}: ${seg.inSun ? 'Sunny' : 'Shaded'}`}
                  className={`flex-1 h-full transition-colors ${
                    seg.inSun ? 'bg-[#cf5a47] shadow-sm shadow-[#cf5a47]/20' : 'bg-[#eab88d]/20'
                  }`}
                />
              ))}
            </div>

            {/* Selected timeline pointer styled back to Main (#cf5a47) */}
            <div 
              className="absolute top-0 bottom-1 flex flex-col items-center transition-all duration-300 pointer-events-none"
              style={{ left: `${pointerPercent}%` }}
            >
              <div className="bg-[#cf5a47] text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded shadow-md -translate-y-5 whitespace-nowrap border border-white">
                {formatDisplayTime(evaluatedTime)}
              </div>
              <div className="w-[2px] h-[100%] bg-[#cf5a47] z-10 shadow-sm"></div>
            </div>
          </div>

          <div className="flex justify-between text-[10px] font-bold text-slate-400 px-1 pt-1">
            <span>08:00</span>
            <span>11:30</span>
            <span>15:00</span>
            <span>18:30</span>
            <span>22:00</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {venue.tags.map((t) => (
            <span key={t} className="px-2.5 py-1 bg-slate-100 text-slate-600 text-xs font-bold rounded-full">
              {t}
            </span>
          ))}
        </div>

        <div className="pt-2 space-y-2">
          {/* Primary Action Button styled back in Main/Terracotta (#cf5a47) with white text */}
          <a
            href={getDirectionsUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-3 bg-[#cf5a47] hover:bg-[#cf5a47]/90 text-white rounded-xl text-center text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-md"
          >
            🗺️ Open in Map Navigation
          </a>

          <div className="flex items-center gap-2">
            <button
              onClick={onToggleAdjustMode}
              className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-colors ${
                isAdjustingPoint
                  ? 'bg-[#cf5a47] border-[#cf5a47] text-white shadow-sm'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {isAdjustingPoint ? '💾 Save Position' : '📐 Adjust Seating Point'}
            </button>
            {venue.outdoorPoint && (
              <button
                onClick={onResetOutdoorPoint}
                className="px-3 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold border border-red-200 rounded-xl transition-colors"
                title="Reset seating adjustments"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};