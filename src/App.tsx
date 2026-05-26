import { useState, useEffect, useMemo } from 'react';
import processedVenues from './data/processed_venues.json';
import { Venue, Report, OutdoorPoint } from './types';
import { calculateSunDetails, recomputeClientHorizonMask, getSolarCoordinates } from './utils/sunUtils';
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

  const [originalOutdoorPoint, setOriginalOutdoorPoint] = useState<OutdoorPoint | null>(null);
  const [reports, setReports] = useState<Report[]>([]);

  const [isRecomputingMask, setIsRecomputingMask] = useState(false);
  const [recomputeError, setRecomputeError] = useState<string | null>(null);

  const evaluatedTime = useMemo(() => {
    const d = new Date();
    d.setHours(timeState.hour);
    d.setMinutes(timeState.min);
    d.setSeconds(0);
    return d;
  }, [timeState.hour, timeState.min]);

  // --- AUTOMATED BROWSER F12 CONSOLE DIAGNOSTIC BLOCKS (V4) ---
  useEffect(() => {
    if (!selectedVenue) return;
    const activeLat = selectedVenue.outdoorPoint?.lat ?? selectedVenue.lat;
    const activeLng = selectedVenue.outdoorPoint?.lng ?? selectedVenue.lng;

    console.log(`%c=== DIAGNOSTIC CONSOLE: ${selectedVenue.name} ===`, "color: #cf5a47; font-weight: bold; font-size: 11px;");
    console.log(`Seating coordinates: Lat ${activeLat.toFixed(6)}, Lng ${activeLng.toFixed(6)}`);

    // Target specific 10:30 solar time checks (Bruk calibration validation)
    const t1030 = new Date(evaluatedTime);
    t1030.setHours(10);
    t1030.setMinutes(30);
    const pos1030 = getSolarCoordinates(activeLat, activeLng, t1030);
    const bin1030 = Math.floor(pos1030.azimuth / 5) % 72;
    const mask1030 = selectedVenue.horizonMask ? selectedVenue.horizonMask[bin1030] : 0;

    console.log(`10:30 Sun Vector: Alt ${pos1030.altitude.toFixed(2)}°, Az ${pos1030.azimuth.toFixed(2)}° (Bin ${bin1030}, Obstruction: ${mask1030}°)`);
    console.log(`Is sunny at 10:30? -> ${pos1030.altitude > mask1030 ? "YES ☀️" : "NO 🌥️"}`);

    // Target current slider time checks
    const { altitude: currAlt, azimuth: currAz } = getSolarCoordinates(activeLat, activeLng, evaluatedTime);
    const currBin = Math.floor(currAz / 5) % 72;
    const currMask = selectedVenue.horizonMask ? selectedVenue.horizonMask[currBin] : 0;
    const displayHourStr = `${String(evaluatedTime.getHours()).padStart(2, '0')}:${String(evaluatedTime.getMinutes()).padStart(2, '0')}`;

    console.log(`${displayHourStr} Sun Vector: Alt ${currAlt.toFixed(2)}°, Az ${currAz.toFixed(2)}° (Bin ${currBin}, Obstruction: ${currMask}°)`);
    console.log(`Is sunny now (${displayHourStr})? -> ${currAlt > currMask ? "YES ☀️" : "NO 🌥️"}`);
    console.log("====================================================");
  }, [selectedVenue, evaluatedTime]);

  useEffect(() => {
    const savedFavs = localStorage.getItem('habba_favs');
    if (savedFavs) {
      setFavorites(JSON.parse(savedFavs));
    }

    let deviceId = localStorage.getItem('habba_device_id');
    if (!deviceId) {
      deviceId = 'device_' + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('habba_device_id', deviceId);
    }

    const savedReports = localStorage.getItem('habba_reports');
    if (savedReports) {
      setReports(JSON.parse(savedReports));
    }

    const savedAdjustments = localStorage.getItem('habba_adjustments');
    const adjustments = savedAdjustments ? JSON.parse(savedAdjustments) : {};

    const merged = (processedVenues as Venue[]).map((v) => {
      if (adjustments[v.id]) {
        return { 
          ...v, 
          outdoorPoint: { lat: adjustments[v.id].lat, lng: adjustments[v.id].lng },
          horizonMask: adjustments[v.id].horizonMask || v.horizonMask
        };
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
    setVenues((prev) =>
      prev.map((v) => (v.id === id ? { ...v, outdoorPoint: { lat, lng } } : v))
    );

    setSelectedVenue((prev) => (prev && prev.id === id ? { ...prev, outdoorPoint: { lat, lng } } : prev));
  };

  const handleStartAdjustMode = () => {
    if (selectedVenue) {
      setOriginalOutdoorPoint(selectedVenue.outdoorPoint || null);
    }
    setIsAdjustingPoint(true);
  };

  const handleCancelAdjustMode = () => {
    if (selectedVenue) {
      const restoredPoint = originalOutdoorPoint || undefined;
      setVenues((prev) =>
        prev.map((v) => (v.id === selectedVenue.id ? { ...v, outdoorPoint: restoredPoint } : v))
      );
      setSelectedVenue((prev) => (prev && prev.id === selectedVenue.id ? { ...prev, outdoorPoint: restoredPoint } : prev));
    }
    setIsAdjustingPoint(false);
    setOriginalOutdoorPoint(null);
  };

  const handleSaveAdjustMode = async () => {
    if (!selectedVenue) return;
    const currentPoint = selectedVenue.outdoorPoint;
    if (!currentPoint) {
      setIsAdjustingPoint(false);
      setOriginalOutdoorPoint(null);
      return;
    }

    setIsRecomputingMask(true);
    setRecomputeError(null);

    try {
      const newMask = await recomputeClientHorizonMask(currentPoint.lat, currentPoint.lng);

      const savedAdjustments = localStorage.getItem('habba_adjustments');
      const adjustments = savedAdjustments ? JSON.parse(savedAdjustments) : {};
      adjustments[selectedVenue.id] = {
        lat: currentPoint.lat,
        lng: currentPoint.lng,
        horizonMask: newMask
      };
      localStorage.setItem('habba_adjustments', JSON.stringify(adjustments));

      setVenues((prev) =>
        prev.map((v) => (v.id === selectedVenue.id ? { ...v, outdoorPoint: currentPoint, horizonMask: newMask } : v))
      );
      setSelectedVenue((prev) => (prev && prev.id === selectedVenue.id ? { ...prev, outdoorPoint: currentPoint, horizonMask: newMask } : prev));
    } catch (e) {
      console.error("Client shadow calculations failed:", e);
      setRecomputeError("Could not update shade model. Using default.");

      const savedAdjustments = localStorage.getItem('habba_adjustments');
      const adjustments = savedAdjustments ? JSON.parse(savedAdjustments) : {};
      adjustments[selectedVenue.id] = {
        lat: currentPoint.lat,
        lng: currentPoint.lng
      };
      localStorage.setItem('habba_adjustments', JSON.stringify(adjustments));
    } finally {
      setIsRecomputingMask(false);
      setIsAdjustingPoint(false);
      setOriginalOutdoorPoint(null);
    }
  };

  const handleResetOutdoorPointSelf = () => {
    if (selectedVenue) {
      handleResetOutdoorPoint(selectedVenue.id);
      setIsAdjustingPoint(false);
      setOriginalOutdoorPoint(null);
    }
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
        const originalDbVenue = processedVenues.find(v => v.id === id);
        if (originalDbVenue) {
          copy.horizonMask = originalDbVenue.horizonMask;
        }
        return copy;
      }
      return prev;
    });
  };

  const handleAddReport = (value: 'yes' | 'no'): boolean => {
    if (!selectedVenue) return false;
    const devId = localStorage.getItem('habba_device_id') || 'anon';
    
    const existingIdx = reports.findIndex(r => r.venueId === selectedVenue.id && r.deviceId === devId);

    if (existingIdx > -1) {
      const existing = reports[existingIdx];
      const elapsed = Date.now() - existing.timestamp;

      if (elapsed < 30 * 1000) {
        const remaining = Math.ceil((30 * 1000 - elapsed) / 1000);
        alert(`Please wait ${remaining}s before changing your vote.`);
        return false;
      }

      const updated = [...reports];
      updated[existingIdx] = {
        ...existing,
        timestamp: Date.now(),
        value
      };
      setReports(updated);
      localStorage.setItem('habba_reports', JSON.stringify(updated));
    } else {
      const newReport: Report = {
        timestamp: Date.now(),
        venueId: selectedVenue.id,
        deviceId: devId,
        value
      };
      const updated = [...reports, newReport];
      setReports(updated);
      localStorage.setItem('habba_reports', JSON.stringify(updated));
    }
    return true;
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
    <div className="relative w-screen h-[100dvh] flex flex-col overflow-hidden bg-[#faf8f5] font-sans antialiased text-slate-800">
      
      {/* Search Header Overlay */}
      {!isAdjustingPoint && (
        <div className="absolute top-4 left-4 right-4 z-[1000] flex flex-col gap-2 pointer-events-none">
          <div className="w-full pointer-events-auto bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-[#eebd8d]/30 p-2.5 flex items-center justify-between gap-2">
            
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
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

            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => setShowFilters(true)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                  activeFilters.tags.length > 0 || activeFilters.onlyFavs || activeFilters.minHours > 1 || activeDistrict
                    ? 'bg-[#fc5a47] border-[#fc5a47] text-white shadow-sm'
                    : 'bg-white border-[#eebd8d]/30 text-[#350505] hover:bg-[#eebd8d]/10'
                }`}
              >
                Filters {(activeFilters.tags.length > 0 || activeFilters.onlyFavs || activeFilters.minHours > 1 || activeDistrict) && '●'}
              </button>

              {weather && (
                <div className="text-xs font-bold text-[#350505] bg-[#eebd8d]/10 border border-[#eebd8d]/20 px-2 py-1.5 rounded-xl flex items-center gap-1 shadow-sm" title={weather.description}>
                  <span>{weather.icon}</span>
                  <span>{weather.temp}°C</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- INSTRUCTION EDIT HEADER OVERLAY --- */}
      {isAdjustingPoint && selectedVenue && (
        <div className="absolute top-4 left-4 right-4 z-[1000] pointer-events-auto bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-[#eebd8d]/30 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="text-sm">📐</span>
            <p className="text-xs font-bold text-[#350505]">
              {isRecomputingMask ? "Updating shade model..." : "Drag the blue pin to the outdoor seating area"}
            </p>
          </div>
          <div className="flex items-center gap-2 self-end md:self-auto">
            <button
              disabled={isRecomputingMask}
              onClick={handleResetOutdoorPointSelf}
              className="px-3 py-2 bg-red-50 hover:bg-red-100 border border-red-100 text-red-600 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
            >
              Reset
            </button>
            <button
              disabled={isRecomputingMask}
              onClick={handleCancelAdjustMode}
              className="px-3.5 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-50 transition-all disabled:opacity-50"
            >
              ✕ Cancel
            </button>
            <button
              disabled={isRecomputingMask}
              onClick={handleSaveAdjustMode}
              className="px-4 py-2 bg-[#fc5a47] hover:bg-[#fc5a47]/95 text-white rounded-xl text-xs font-bold transition-all shadow-md disabled:opacity-50"
            >
              {isRecomputingMask ? "Computing..." : "Save Position"}
            </button>
          </div>
        </div>
      )}

      {/* Temporary Recomputation Error Toast */}
      {recomputeError && (
        <div className="absolute top-[135px] left-1/2 -translate-x-1/2 z-[1000] pointer-events-auto bg-amber-500 text-slate-950 px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 border border-amber-400/30">
          <span className="text-xs">⚠️</span>
          <p className="text-[11px] font-bold leading-tight whitespace-nowrap">
            {recomputeError}
          </p>
        </div>
      )}

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

      {/* Floating bottom overlay section */}
      {!isAdjustingPoint && (
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
                onToggleAdjustMode={handleStartAdjustMode}
                onResetOutdoorPoint={() => handleResetOutdoorPoint(selectedVenue.id)}
                
                onCancelAdjustMode={handleCancelAdjustMode}
                onSaveAdjustMode={handleSaveAdjustMode}
                
                reports={reports}
                onAddReport={handleAddReport}
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
      )}

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