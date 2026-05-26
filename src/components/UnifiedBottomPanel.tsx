import React, { useState } from 'react';
import { Venue } from '../types';
import { calculateSunDetails } from '../utils/sunUtils';

interface UnifiedBottomPanelProps {
  // Time Control State
  currentHour: number;
  currentMin: number;
  onTimeChange: (hour: number, minute: number) => void;
  isLiveNow: boolean;
  onSetLiveNow: () => void;
  
  // Venue State
  venuesInView: Venue[];
  evaluatedTime: Date;
  onSelectVenue: (venue: Venue) => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export const UnifiedBottomPanel: React.FC<UnifiedBottomPanelProps> = ({
  currentHour,
  currentMin,
  onTimeChange,
  isLiveNow,
  onSetLiveNow,
  venuesInView,
  evaluatedTime,
  onSelectVenue,
  hasActiveFilters,
  onClearFilters,
}) => {
  const [isListOpen, setIsListOpen] = useState(false);

  // Time calculations
  const sliderVal = currentHour * 60 + currentMin;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const totalMinutes = parseInt(e.target.value, 10);
    const h = Math.floor(totalMinutes / 60);
    const m = Math.floor((totalMinutes % 60) / 10) * 10;
    onTimeChange(h, m);
  };

  const formatDisplayTime = (h: number, m: number) => {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const presets = [
    { label: 'Lunch', h: 12, m: 0 },
    { label: 'AW (17)', h: 17, m: 0 },
    { label: 'Evening', h: 20, m: 0 },
  ];

  // Process and sort list
  const processedList = venuesInView
    .map((v) => {
      const activeLat = v.outdoorPoint?.lat ?? v.lat;
      const activeLng = v.outdoorPoint?.lng ?? v.lng;
      const sun = calculateSunDetails(activeLat, activeLng, evaluatedTime, v.horizonMask);
      return { venue: v, sun };
    })
    .sort((a, b) => {
      if (a.sun.inSunNow && !b.sun.inSunNow) return -1;
      if (!a.sun.inSunNow && b.sun.inSunNow) return 1;
      return b.sun.totalSunMinutes - a.sun.totalSunMinutes;
    })
    .slice(0, 8); // Top 8 nearby bars

  return (
    <div className="bg-white/95 backdrop-blur-md rounded-t-[2.5rem] shadow-[0_-12px_40px_-15px_rgba(0,0,0,0.15)] border-t border-slate-100 flex flex-col max-h-[80vh] w-full transition-all duration-300">
      
      {/* 1. Drag Handle & Sheet Header */}
      <div 
        onClick={() => setIsListOpen(!isListOpen)} 
        className="w-full pt-3 pb-1 flex flex-col items-center justify-center cursor-pointer select-none"
      >
        <div className="w-12 h-1.5 bg-slate-200 rounded-full mb-1"></div>
      </div>

      {/* 2. Embedded Time Controls (Always accessible in the thumb zone) */}
      <div className="px-5 pb-4 space-y-3 border-b border-slate-50">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-400 tracking-wider uppercase">Seating Time</span>
          <div className="flex items-center gap-2">
            {isLiveNow && (
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            )}
            <span className="text-xl font-bold tracking-tight text-slate-800 tabular-nums">
              {formatDisplayTime(currentHour, currentMin)}
            </span>
          </div>
        </div>

        {/* Custom Slider */}
        <div className="relative w-full">
          <input
            type="range"
            min={8 * 60}
            max={22 * 60}
            step={10}
            value={sliderVal}
            onChange={handleSliderChange}
            className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-amber-500 focus:outline-none"
          />
          <div className="flex justify-between text-[9px] font-bold text-slate-400 mt-1 px-1">
            <span>08:00</span>
            <span>12:00</span>
            <span>16:00</span>
            <span>20:00</span>
            <span>22:00</span>
          </div>
        </div>

        {/* Quick Hotkeys */}
        <div className="flex items-center gap-1.5 pt-1">
          <button
            onClick={onSetLiveNow}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${
              isLiveNow
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            📍 Now
          </button>
          {presets.map((preset) => {
            const isActive = !isLiveNow && currentHour === preset.h && currentMin === preset.m;
            return (
              <button
                key={preset.label}
                onClick={() => onTimeChange(preset.h, preset.m)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${
                  isActive
                    ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Sliding List Trigger Header */}
      <button
        onClick={() => setIsListOpen(!isListOpen)}
        className="w-full py-3.5 px-5 flex items-center justify-between hover:bg-slate-50/50 transition-colors focus:outline-none text-left"
      >
        <span className="text-sm font-bold text-slate-800">
          {isListOpen ? 'Close Places List' : `Show nearby patios (${venuesInView.length})`}
        </span>
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-400 font-bold">
            {isListOpen ? 'Swipe down' : 'Tap to expand'}
          </span>
          <span className="text-slate-400 text-xs">{isListOpen ? '▼' : '▲'}</span>
        </div>
      </button>

      {/* 4. Sliding Venue List */}
      {isListOpen && (
        <div className="overflow-y-auto px-5 pb-6 flex-1 divide-y divide-slate-100">
          {processedList.length === 0 ? (
            <div className="py-8 text-center flex flex-col items-center justify-center">
              <span className="text-3xl mb-2">🤷‍♂️</span>
              <p className="text-sm font-bold text-slate-700">No matching patios here</p>
              <p className="text-xs text-slate-400 mt-1 max-w-[240px]">
                Try adjusting your selected time or clearing active search filters.
              </p>
              {hasActiveFilters && (
                <button
                  onClick={onClearFilters}
                  className="mt-3 px-4 py-2 bg-slate-950 text-white rounded-full text-xs font-bold"
                >
                  Reset Active Filters
                </button>
              )}
            </div>
          ) : (
            processedList.map(({ venue, sun }) => (
              <div
                key={venue.id}
                onClick={() => {
                  onSelectVenue(venue);
                  setIsListOpen(false);
                }}
                className="py-3.5 flex items-center justify-between cursor-pointer active:bg-slate-50 transition-colors"
              >
                <div className="flex-1 min-w-0 pr-3">
                  <h4 className="font-bold text-slate-900 text-sm truncate">{venue.name}</h4>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    {venue.tags.slice(0, 2).map((t) => (
                      <span key={t} className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="text-right flex-shrink-0 flex flex-col items-end">
                  {sun.inSunNow ? (
                    <span className="text-[10px] font-extrabold text-amber-700 flex items-center gap-0.5 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                      ☀️ Sun now
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">
                      Shadow now
                    </span>
                  )}
                  <span className="text-[11px] font-semibold text-slate-500 mt-1">
                    Total today: {(sun.totalSunMinutes / 60).toFixed(1)}h
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};