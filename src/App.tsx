import { useState, useEffect, useMemo } from 'react';
import processedVenues from './data/processed_venues.json';
import { Venue } from './types';
import { calculateSunDetails } from './utils/sunUtils';
import { HubbaMap } from './components/HubbaMap';
import { TimeControls } from './components/TimeControls';
import { BottomList } from './components/BottomList';
import { PlaceSheet } from './components/PlaceSheet';
import { FilterSheet } from './components/FilterSheet';
import L from 'leaflet';

export default function App() {
  const [timeState, setTimeState] = useState({ hour: 14, min: 0 });
  const [isLiveNow, setIsLiveNow] = useState(true);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState({
    tags: [] as string[],
    minHours: 2,
    onlyFavs: false,
  });
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [isAdjustingPoint, setIsAdjustingPoint] = useState(false);
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  const evaluatedTime = useMemo(() => {
    const d = new Date();
    d.setHours(timeState.hour);
    d.setMinutes(timeState.min);
    d.setSeconds(0);
    return d;
  }, [timeState.hour, timeState.min]);

  // Here is the initialization useEffect updated to read from processed_venues.json
  useEffect(() => {
    const savedFavs = localStorage.getItem('habba_favs');
    if (savedFavs) {
      setFavorites(JSON.parse(savedFavs));
    }

    const savedAdjustments = localStorage.getItem('habba_adjustments');
    const adjustments = savedAdjustments ? JSON.parse(savedAdjustments) : {};

    const merged = (processedVenues as Venue[]).map((v) => {
      if (adjustments[v.id]) {
        return { ...v, outdoorPoint: adjustments[v.id] };
      }
      return v;
    });
    setVenues(merged);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
        },
        () => console.log('Location access denied, loading fallback view.')
      );
    }
  }, []);

  useEffect(() => {
    if (!isLiveNow) return;

    const syncToCurrent = () => {
      const now = new Date();
      setTimeState({ hour: now.getHours(), min: now.getMinutes() });
    };

    syncToCurrent();
    const interval = setInterval(syncToCurrent, 60000);
    return () => clearInterval(interval);
  }, [isLiveNow]);

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    venues.forEach((v) => v.tags.forEach((t) => tags.add(t)));
    return Array.from(tags);
  }, [venues]);

  const filteredVenues = useMemo(() => {
    return venues.filter((v) => {
      if (searchQuery.trim().length > 0) {
        const query = searchQuery.toLowerCase();
        const matchesName = v.name.toLowerCase().includes(query);
        const matchesAddress = v.address.toLowerCase().includes(query);
        const matchesTags = v.tags.some((t) => t.toLowerCase().includes(query));
        if (!matchesName && !matchesAddress && !matchesTags) return false;
      }

      if (!v.hasOutdoor) return false;
      if (activeFilters.onlyFavs && !favorites.includes(v.id)) return false;

      if (activeFilters.tags.length > 0) {
        const hasMatchingTag = activeFilters.tags.some((t) => v.tags.includes(t));
        if (!hasMatchingTag) return false;
      }

      const activeLat = v.outdoorPoint?.lat ?? v.lat;
      const activeLng = v.outdoorPoint?.lng ?? v.lng;
      const { totalSunMinutes } = calculateSunDetails(activeLat, activeLng, evaluatedTime, v.horizonMask);
      if (totalSunMinutes < activeFilters.minHours * 60) return false;

      return true;
    });
  }, [venues, searchQuery, activeFilters, favorites, evaluatedTime]);

  const venuesInView = useMemo(() => {
    if (!mapBounds) return filteredVenues;
    return filteredVenues.filter((v) => {
      const activeLat = v.outdoorPoint?.lat ?? v.lat;
      const activeLng = v.outdoorPoint?.lng ?? v.lng;
      return mapBounds.contains([activeLat, activeLng]);
    });
  }, [filteredVenues, mapBounds]);

  const handleToggleFavorite = (id: string) => {
    let next: string[];
    if (favorites.includes(id)) {
      next = favorites.filter((item) => item !== id);
    } else {
      next = [...favorites, id];
    }
    setFavorites(next);
    localStorage.setItem('habba_favs', JSON.stringify(next));
  };

  const handleUpdateOutdoorPoint = (id: string, lat: number, lng: number) => {
    const savedAdjustments = localStorage.getItem('habba_adjustments');
    const adjustments = savedAdjustments ? JSON.parse(savedAdjustments) : {};

    adjustments[id] = { lat, lng };
    localStorage.setItem('habba_adjustments', JSON.stringify(adjustments));

    setVenues((prev) =>
      prev.map((v) => (v.id === id ? { ...v, outdoorPoint: { lat, lng } } : v))
    );

    setSelectedVenue((prev) => (prev && prev.id === id ? { ...prev, outdoorPoint: { lat, lng } } : prev));
  };

  const handleResetOutdoorPoint = (id: string) => {
    const savedAdjustments = localStorage.getItem('habba_adjustments');
    if (savedAdjustments) {
      const adjustments = JSON.parse(savedAdjustments);
      delete adjustments[id];
      localStorage.setItem('habba_adjustments', JSON.stringify(adjustments));
    }

    setVenues((prev) =>
      prev.map((v) => {
        if (v.id === id) {
          const resetVenue = { ...v };
          delete resetVenue.outdoorPoint;
          return resetVenue;
        }
        return v;
      })
    );

    setSelectedVenue((prev) => {
      if (prev && prev.id === id) {
        const copy = { ...prev };
        delete copy.outdoorPoint;
        return copy;
      }
      return prev;
    });
  };

  const handleClearFilters = () => {
    setActiveFilters({
      tags: [],
      minHours: 1,
      onlyFavs: false,
    });
  };

  return (
    <div className="relative w-screen h-[100dvh] flex flex-col overflow-hidden bg-slate-50 font-sans antialiased text-slate-800">
      <div className="absolute top-4 left-4 right-4 z-[1000] flex flex-col gap-2 pointer-events-none">
        <div className="w-full pointer-events-auto bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-slate-100 p-2.5 flex items-center gap-2.5">
          <svg className="w-5 h-5 text-slate-400 flex-shrink-0 ml-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
          <input
            type="text"
            placeholder="Search venues, tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full focus:outline-none bg-transparent text-sm font-semibold placeholder-slate-400"
          />
        </div>

        <div className="flex items-center gap-1.5 pointer-events-auto overflow-x-auto no-scrollbar py-1">
          <button
            onClick={() => setIsLiveNow(true)}
            className={`px-4 py-2 rounded-full text-xs font-bold shadow-md transition-all whitespace-nowrap border ${
              isLiveNow
                ? 'bg-amber-400 border-amber-400 text-slate-900 ring-2 ring-amber-400/20'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            ☀️ Now
          </button>

          <button
            onClick={() => {
              setIsLiveNow(false);
              setActiveFilters((prev) => ({ ...prev, minHours: prev.minHours >= 2 ? 0 : 2 }));
            }}
            className={`px-4 py-2 rounded-full text-xs font-bold shadow-md transition-all whitespace-nowrap border ${
              activeFilters.minHours >= 2
                ? 'bg-slate-900 border-slate-900 text-white'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            ⏱️ ≥ 2h Today
          </button>

          <button
            onClick={() => setShowFilters(true)}
            className={`px-4 py-2 rounded-full text-xs font-bold shadow-md transition-all whitespace-nowrap border ${
              showFilters || activeFilters.tags.length > 0 || activeFilters.onlyFavs
                ? 'bg-indigo-600 border-indigo-600 text-white'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            ⚙️ Filters {(activeFilters.tags.length > 0 || activeFilters.onlyFavs) && '●'}
          </button>
        </div>
      </div>

      <div className="flex-1 w-full h-full relative z-0">
        <HubbaMap
          venues={filteredVenues}
          selectedVenue={selectedVenue}
          onSelectVenue={(v) => {
            setSelectedVenue(v);
            setIsAdjustingPoint(false);
          }}
          evaluatedTime={evaluatedTime}
          isAdjustingPoint={isAdjustingPoint}
          onUpdateOutdoorPoint={handleUpdateOutdoorPoint}
          userLocation={userLocation}
          onBoundsChange={setMapBounds}
        />
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-[1001] flex flex-col gap-3 pointer-events-none p-4 max-w-lg mx-auto w-full">
        <div className="pointer-events-auto">
          <TimeControls
            currentHour={timeState.hour}
            currentMin={timeState.min}
            onTimeChange={(h, m) => {
              setIsLiveNow(false);
              setTimeState({ hour: h, min: m });
            }}
            isLiveNow={isLiveNow}
            onSetLiveNow={() => setIsLiveNow(true)}
          />
        </div>

        <div className="pointer-events-auto">
          {selectedVenue ? (
            <PlaceSheet
              venue={selectedVenue}
              evaluatedTime={evaluatedTime}
              onClose={() => {
                setSelectedVenue(null);
                setIsAdjustingPoint(false);
              }}
              isFavorite={favorites.includes(selectedVenue.id)}
              onToggleFavorite={() => handleToggleFavorite(selectedVenue.id)}
              isAdjustingPoint={isAdjustingPoint}
              onToggleAdjustMode={() => setIsAdjustingPoint(!isAdjustingPoint)}
              onResetOutdoorPoint={() => handleResetOutdoorPoint(selectedVenue.id)}
            />
          ) : (
            <BottomList
              venuesInView={venuesInView}
              totalVenuesCount={filteredVenues.length}
              evaluatedTime={evaluatedTime}
              onSelectVenue={setSelectedVenue}
              onClearFilters={handleClearFilters}
              hasActiveFilters={activeFilters.tags.length > 0 || activeFilters.onlyFavs}
            />
          )}
        </div>
      </div>

      {showFilters && (
        <div className="absolute inset-0 z-[2000] bg-slate-900/40 backdrop-blur-sm flex items-end justify-center">
          <div className="w-full max-w-lg">
            <FilterSheet
              onClose={() => setShowFilters(false)}
              availableTags={availableTags}
              selectedTags={activeFilters.tags}
              onToggleTag={(t) => {
                setActiveFilters((prev) => {
                  const alreadySelected = prev.tags.includes(t);
                  const nextTags = alreadySelected ? prev.tags.filter((item) => item !== t) : [...prev.tags, t];
                  return { ...prev, tags: nextTags };
                });
              }}
              hoursThreshold={activeFilters.minHours}
              onHoursChange={(hr) => {
                setActiveFilters((prev) => ({ ...prev, minHours: hr }));
              }}
              onlyFavorites={activeFilters.onlyFavs}
              onToggleFavorites={() => {
                setActiveFilters((prev) => ({ ...prev, onlyFavs: !prev.onlyFavs }));
              }}
              onClear={handleClearFilters}
            />
          </div>
        </div>
      )}
    </div>
  );
}