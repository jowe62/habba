import { useState, useEffect, useMemo } from 'react';
import processedVenues from './data/processed_venues.json';
import { Venue } from './types';
import { calculateSunDetails } from './utils/sunUtils';
import { HubbaMap } from './components/HubbaMap';
import { UnifiedBottomPanel } from './components/UnifiedBottomPanel';
import { PlaceSheet } from './components/PlaceSheet';
import { FilterSheet } from './components/FilterSheet';
import L from 'leaflet';

interface WeatherState {
  temp: number;
  icon: string;
  description: string;
  isBad: boolean;
}

const DISTRICTS = [
  { name: "Majorna", lat: 57.6920, lng: 11.9180 },
  { name: "Linné", lat: 57.6980, lng: 11.9510 },
  { name: "Haga", lat: 57.6970, lng: 11.9560 },
  { name: "Järntorget", lat: 57.7000, lng: 11.9530 },
  { name: "Innerstaden", lat: 57.7040, lng: 11.9650 },
  { name: "Lindholmen", lat: 57.7060, lng: 11.9370 }
];

const CLEAN_AMENITIES = ['Bar', 'Pub', 'Restaurant', 'Café'];

function parseWMOCode(code: number): { desc: string; isBad: boolean; icon: string } {
  if (code === 0) return { desc: "Clear sky", isBad: false, icon: "☀️" };
  if (code === 1) return { desc: "Mainly clear", isBad: false, icon: "🌤️" };
  if (code === 2) return { desc: "Partly cloudy", isBad: false, icon: "⛅" };
  if (code === 3) return { desc: "Overcast", isBad: true, icon: "☁️" };
  if (code >= 45 && code <= 48) return { desc: "Foggy", isBad: true, icon: "🌫️" };
  if (code >= 51 && code <= 67) return { desc: "Raining", isBad: true, icon: "🌧️" };
  if (code >= 80 && code <= 82) return { desc: "Showers", isBad: true, icon: "🌦️" };
  return { desc: "Unsettled", isBad: true, icon: "☁️" };
}

export default function App() {
  const [timeState, setTimeState] = useState({ hour: 14, min: 0 });
  const [isLiveNow, setIsLiveNow] = useState(true);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState({
    tags: [] as string[],
    minHours: 1.0,
    onlyFavs: false,
  });
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [isAdjustingPoint, setIsAdjustingPoint] = useState(false);
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [weather, setWeather] = useState<WeatherState | null>(null);
  const [targetCenter, setTargetCenter] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const [activeDistrict, setActiveDistrict] = useState<string | null>(null);

  const evaluatedTime = useMemo(() => {
    const d = new Date();
    d.setHours(timeState.hour);
    d.setMinutes(timeState.min);
    d.setSeconds(0);
    return d;
  }, [timeState.hour, timeState.min]);

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

    fetch("https://api.open-meteo.com/v1/forecast?latitude=57.7089&longitude=11.9746&current=weather_code,temperature_2m")
      .then((res) => res.json())
      .then((data) => {
        if (data && data.current) {
          const temp = Math.round(data.current.temperature_2m);
          const code = data.current.weather_code;
          const { desc, isBad, icon } = parseWMOCode(code);
          setWeather({ temp, icon, description: desc, isBad });
        }
      })
      .catch((err) => console.error("Weather service currently unavailable:", err));

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
      minHours: 1.0,
      onlyFavs: false,
    });
    setActiveDistrict(null);
  };

  return (
    <div className="relative w-screen h-[100dvh] flex flex-col overflow-hidden bg-slate-50 font-sans antialiased text-slate-800">
      
      {/* --- RECONSTITUTED SINGLE-ROW HEADER BAR (Maximum Map Visibility) --- */}
      <div className="absolute top-4 left-4 right-4 z-[1000] flex flex-col gap-2 pointer-events-none">
        <div className="w-full pointer-events-auto bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-[#eab88d]/30 p-2.5 flex items-center justify-between gap-2">
          
          {/* Input field */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <svg className="w-5 h-5 text-slate-400 flex-shrink-0 ml-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full focus:outline-none bg-transparent text-sm font-bold placeholder-slate-400 text-[#350505]"
            />
          </div>

          {/* Combined Filters Button & Weather HUD */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => setShowFilters(true)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                activeFilters.tags.length > 0 || activeFilters.onlyFavs || activeFilters.minHours > 1 || activeDistrict
                  ? 'bg-[#cf5a47] border-[#cf5a47] text-white shadow-sm'
                  : 'bg-white border-[#eab88d]/30 text-[#350505] hover:bg-[#eab88d]/10'
              }`}
            >
              Filters {(activeFilters.tags.length > 0 || activeFilters.onlyFavs || activeFilters.minHours > 1 || activeDistrict) && '●'}
            </button>

            {weather && (
              <div className="text-xs font-bold text-[#350505] bg-[#eab88d]/10 border border-[#eab88d]/20 px-2 py-1.5 rounded-xl flex items-center gap-1 shadow-sm" title={weather.description}>
                <span>{weather.icon}</span>
                <span>{weather.temp}°C</span>
              </div>
            )}
          </div>
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
          targetCenter={targetCenter}
        />
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-[1001] flex flex-col gap-3 pointer-events-none p-4 max-w-lg mx-auto w-full">
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
            <UnifiedBottomPanel
              currentHour={timeState.hour}
              currentMin={timeState.min}
              onTimeChange={(h, m) => {
                setIsLiveNow(false);
                setTimeState({ hour: h, min: m });
              }}
              isLiveNow={isLiveNow}
              onSetLiveNow={() => setIsLiveNow(true)}
              venuesInView={venuesInView}
              evaluatedTime={evaluatedTime}
              onSelectVenue={setSelectedVenue}
              hasActiveFilters={activeFilters.tags.length > 0 || activeFilters.onlyFavs || activeDistrict !== null}
              onClearFilters={handleClearFilters}
            />
          )}
        </div>
      </div>

      {showFilters && (
        <div className="absolute inset-0 z-[2000] bg-slate-900/40 backdrop-blur-sm flex items-end justify-center">
          <div className="w-full max-w-lg">
            <FilterSheet
              onClose={() => setShowFilters(false)}
              availableTags={CLEAN_AMENITIES}
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
              
              // Connecting the quick-jump districts array and handlers into the modal
              districts={DISTRICTS}
              activeDistrict={activeDistrict}
              onSelectDistrict={(name, lat, lng) => {
                setActiveDistrict(name);
                setTargetCenter({ lat, lng, zoom: 15 });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}