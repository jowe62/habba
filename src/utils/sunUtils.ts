import { SunDetails, SunWindow } from '../types';

// Smarter building-type based heights for Gothenburg structures
export function estimateBuildingHeight(tags: any): number {
  if (tags.height) {
    return parseFloat(tags.height);
  }
  if (tags['building:levels']) {
    const levels = parseFloat(tags['building:levels']);
    return levels * 3.1; // 3.1m per level
  }
  const type = tags.building || 'yes';
  if (type === 'garage' || type === 'shed' || type === 'carport') return 3.0;
  if (type === 'house' || type === 'detached' || type === 'semidetached') return 8.0;
  if (type === 'apartments' || type === 'residential') return 16.0;
  if (type === 'commercial' || type === 'office' || type === 'retail') return 18.0;
  if (type === 'industrial' || type === 'warehouse') return 12.0;
  return 14.0; // General urban fallback
}

export function getDistanceAndAzimuth(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180;
  const latMean = ((lat1 + lat2) / 2) * rad;
  const dy = (lat2 - lat1) * 111139;
  const dx = (lon2 - lon1) * 111139 * Math.cos(latMean);
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  let azimuth = Math.atan2(dx, dy) * (180 / Math.PI);
  if (azimuth < 0) azimuth += 360;
  
  return { distance, azimuth };
}

// --- EXACT SUNCALC ASTRONOMICAL POSITION ALGORITHMS ---
const rad = Math.PI / 180;
const J1970 = 2440588;
const J2000 = 2451545;
const dayMs = 1000 * 60 * 60 * 24;

function toJulian(date: Date) { return date.getTime() / dayMs - 0.5 + J1970; }
function toDays(date: Date) { return toJulian(date) - J2000; }

const e = rad * 23.4397; // Earth obliquity

function rightAscension(l: number, b: number) { return Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)); }
function declination(l: number, b: number) { return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)); }

function azimuth(H: number, phi: number, dec: number) { return Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)); }
function altitude(H: number, phi: number, dec: number) { return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)); }

function siderealTime(d: number, lw: number) { return rad * (280.1600 + 360.9856235 * d) - lw; }

function sunCoords(d: number) {
  const M = rad * (357.5291 + 0.98560028 * d); // Mean anomaly
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)); // Equation of center
  const L = M + C + rad * 102.9372 + Math.PI; // Ecliptic longitude
  return {
    dec: declination(L, 0),
    ra: rightAscension(L, 0)
  };
}

/**
 * Calculates high-precision solar coordinates (altitude and azimuth) using exact SunCalc equations.
 */
export function getSolarCoordinates(lat: number, lng: number, date: Date) {
  const lw = rad * -lng;
  const phi = rad * lat;
  const d = toDays(date);
  const c = sunCoords(d);
  const H = siderealTime(d, lw) - c.ra;

  const alt = altitude(H, phi, c.dec) / rad;
  const az = azimuth(H, phi, c.dec) / rad;
  
  // Convert SunCalc azimuth (South is 0) to standard meteorological compass (North is 0)
  const standardAzimuth = (az + 180) % 360;

  return { altitude: alt, azimuth: standardAzimuth };
}

/**
 * Evaluates whether a point is in direct sun, checking against its 72-point horizon mask.
 * Uses Math.floor for stable, non-overlapping 5-degree bin mapping.
 */
export function isPointInSun(altitude: number, azimuth: number, horizonMask?: number[]): boolean {
  if (altitude <= 0) return false;
  if (!horizonMask) return true;
  
  const expectedLength = horizonMask.length;
  if (expectedLength !== 72 && expectedLength !== 36) return true;
  
  if (expectedLength === 72) {
    const binIndex = Math.floor(azimuth / 5) % 72; // Stable 5-degree binning
    return altitude > horizonMask[binIndex];
  } else {
    const binIndex = Math.floor(azimuth / 10) % 36; // Stable 10-degree binning (Backward compatibility)
    return altitude > horizonMask[binIndex];
  }
}

/**
 * Computes direct sun windows and durations using the 72-point shading model.
 */
export function calculateSunDetails(
  lat: number,
  lng: number,
  evaluatedTime: Date,
  horizonMask?: number[],
  startHour = 8,
  endHour = 22
): SunDetails {
  const testDate = new Date(evaluatedTime);
  const { altitude: currAlt, azimuth: currAz } = getSolarCoordinates(lat, lng, testDate);
  const inSunNow = isPointInSun(currAlt, currAz, horizonMask);
  
  const sunWindows: SunWindow[] = [];
  let totalSunMinutes = 0;
  let windowStart: string | null = null;
  const baseYear = testDate.getFullYear();
  const baseMonth = testDate.getMonth();
  const baseDay = testDate.getDate();

  for (let hour = startHour; hour < endHour; hour++) {
    for (let min = 0; min < 60; min += 10) {
      const sampleTime = new Date(baseYear, baseMonth, baseDay, hour, min, 0);
      const { altitude, azimuth } = getSolarCoordinates(lat, lng, sampleTime);
      const isSun = isPointInSun(altitude, azimuth, horizonMask);
      const timeStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      
      if (isSun) {
        totalSunMinutes += 10;
        if (windowStart === null) {
          windowStart = timeStr;
        }
      } else {
        if (windowStart !== null) {
          sunWindows.push({ start: windowStart, end: timeStr });
          windowStart = null;
        }
      }
    }
  }
  
  if (windowStart !== null) {
    sunWindows.push({ start: windowStart, end: `${endHour}:00` });
  }
  
  return {
    inSunNow,
    sunWindows,
    totalSunMinutes
  };
}

// Mirror server pool to bypass rate limits (Relations removed for cleaner, more reliable data)
const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter'
];

async function fetchOSMWithFallback(query: string): Promise<any> {
  let lastError: any = null;
  for (const server of OVERPASS_SERVERS) {
    try {
      const url = `${server}?data=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'HabbaClientAdjuster/1.0 (contact: jowe62 on github)'
        }
      });
      if (res.ok) {
        return await res.json();
      } else {
        throw new Error(`Status ${res.status}`);
      }
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(lastError ? lastError.message : "All servers failed");
}

/**
 * CLIENT-SIDE 3D SHADING ENGINE (V4)
 * Compiles a 72-bin (5-degree) horizon mask directly inside the client's browser.
 * Closes building polygons and removes relation fetching to prevent missing/incorrect data.
 */
export async function recomputeClientHorizonMask(lat: number, lng: number): Promise<number[]> {
  const query = `
    [out:json];
    (
      way["building"](around:150, ${lat}, ${lng});
    );
    out body;
    >;
    out skel qt;
  `;
  
  const osmData = await fetchOSMWithFallback(query);
  const mask = new Array(72).fill(0);
  const nodes: { [key: string]: { lat: number; lon: number } } = {};

  osmData.elements.forEach((el: any) => {
    if (el.type === 'node') {
      nodes[el.id] = { lat: el.lat, lon: el.lon };
    }
  });

  osmData.elements.forEach((el: any) => {
    if (el.type === 'way' && el.nodes && el.tags) {
      const height = estimateBuildingHeight(el.tags);

      // Loop through all nodes to process segments
      for (let i = 0; i < el.nodes.length - 1; i++) {
        const nodeA = nodes[el.nodes[i]];
        const nodeB = nodes[el.nodes[i + 1]];
        if (!nodeA || !nodeB) continue;

        // Subdivide segment into 2-meter chunks
        const { distance: segmentLen } = getDistanceAndAzimuth(nodeA.lat, nodeA.lon, nodeB.lat, nodeB.lon);
        const steps = Math.max(1, Math.floor(segmentLen / 2));
        
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const pointLat = nodeA.lat + (nodeB.lat - nodeA.lat) * t;
          const pointLon = nodeA.lon + (nodeB.lon - nodeA.lon) * t;

          const { distance, azimuth } = getDistanceAndAzimuth(lat, lng, pointLat, pointLon);
          if (distance < 3) continue;

          const elevation = Math.atan2(height, distance) * (180 / Math.PI);
          const binIndex = Math.floor(azimuth / 5) % 72; // Stable 5-degree binning

          if (elevation > mask[binIndex]) {
            mask[binIndex] = Math.round(elevation);
          }
        }
      }

      // Close polygon: Connect final node back to first node if they are not already identical
      const firstNodeId = el.nodes[0];
      const lastNodeId = el.nodes[el.nodes.length - 1];
      if (firstNodeId !== lastNodeId) {
        const nodeA = nodes[lastNodeId];
        const nodeB = nodes[firstNodeId];
        if (nodeA && nodeB) {
          const { distance: segmentLen } = getDistanceAndAzimuth(nodeA.lat, nodeA.lon, nodeB.lat, nodeB.lon);
          const steps = Math.max(1, Math.floor(segmentLen / 2));
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const pointLat = nodeA.lat + (nodeB.lat - nodeA.lat) * t;
            const pointLon = nodeA.lon + (nodeB.lon - nodeA.lon) * t;

            const { distance, azimuth } = getDistanceAndAzimuth(lat, lng, pointLat, pointLon);
            if (distance < 3) continue;

            const elevation = Math.atan2(height, distance) * (180 / Math.PI);
            const binIndex = Math.floor(azimuth / 5) % 72;

            if (elevation > mask[binIndex]) {
              mask[binIndex] = Math.round(elevation);
            }
          }
        }
      }
    }
  });

  return mask;
}