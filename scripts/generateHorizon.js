import fs from 'fs';
import path from 'path';

function estimateBuildingHeight(tags) {
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

function getDistanceAndAzimuth(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const latMean = ((lat1 + lat2) / 2) * rad;
  const dy = (lat2 - lat1) * 111139;
  const dx = (lon2 - lon1) * 111139 * Math.cos(latMean);
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  let azimuth = Math.atan2(dx, dy) * (180 / Math.PI);
  if (azimuth < 0) azimuth += 360;
  
  return { distance, azimuth };
}

const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter'
];

async function fetchSurroundingBuildings(lat, lng, radius = 150) {
  // Relation query removed to prevent missing/corrupt polygons
  const query = `
    [out:json];
    (
      way["building"](around:${radius}, ${lat}, ${lng});
    );
    out body;
    >;
    out skel qt;
  `;

  let lastError = null;
  for (const server of OVERPASS_SERVERS) {
    try {
      const url = `${server}?data=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'HabbaSeatingFinderGbg/1.0 (contact: jowe62 on github)'
        }
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`All Overpass mirror servers failed. Last error: ${lastError?.message}`);
}

function computeHorizonMask(venueLat, venueLng, osmData) {
  const mask = new Array(72).fill(0); // Stable 72 bins (5-degree increments)
  const nodes = {};

  osmData.elements.forEach(el => {
    if (el.type === 'node') {
      nodes[el.id] = { lat: el.lat, lon: el.lon };
    }
  });

  osmData.elements.forEach(el => {
    if (el.type === 'way' && el.nodes && el.tags) {
      const height = estimateBuildingHeight(el.tags);

      // Loop through nodes
      for (let i = 0; i < el.nodes.length - 1; i++) {
        const nodeA = nodes[el.nodes[i]];
        const nodeB = nodes[el.nodes[i + 1]];
        if (!nodeA || !nodeB) continue;

        const { distance: segmentLen } = getDistanceAndAzimuth(nodeA.lat, nodeA.lon, nodeB.lat, nodeB.lon);
        const steps = Math.max(1, Math.floor(segmentLen / 2));
        
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const pointLat = nodeA.lat + (nodeB.lat - nodeA.lat) * t;
          const pointLon = nodeA.lon + (nodeB.lon - nodeA.lon) * t;

          const { distance, azimuth } = getDistanceAndAzimuth(venueLat, venueLng, pointLat, pointLon);
          if (distance < 3) continue;

          const elevation = Math.atan2(height, distance) * (180 / Math.PI);
          const binIndex = Math.floor(azimuth / 5) % 72; // Stable 5-degree binning
          
          if (elevation > mask[binIndex]) {
            mask[binIndex] = Math.round(elevation);
          }
        }
      }

      // Close polygon: Connect final node back to first node if they are not identical
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

            const { distance, azimuth } = getDistanceAndAzimuth(venueLat, venueLng, pointLat, pointLon);
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

async function run() {
  const inputPath = path.resolve('scripts/input_venues.json');
  const outputPath = path.resolve('src/data/processed_venues.json');

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Create scripts/input_venues.json first.`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  const venues = JSON.parse(raw);

  const cachedMap = {};
  if (fs.existsSync(outputPath)) {
    try {
      const cachedRaw = fs.readFileSync(outputPath, 'utf8');
      const cachedList = JSON.parse(cachedRaw);
      cachedList.forEach((v) => {
        cachedMap[v.id] = v;
      });
      console.log(`Loaded cache: ${cachedList.length} pre-calculated profiles found.`);
    } catch (e) {
      console.log("No valid cache file found. Commencing clean compilation.");
    }
  }

  console.log(`Starting shadow calculations for ${venues.length} venues...`);
  const processed = [];

  for (const venue of venues) {
    const cached = cachedMap[venue.id];
    
    // Check if we can reuse the cached horizonMask
    // Coordinate matching will force recalculation if coordinate changed, or if existing mask is not the new 72-bin standard
    const hasUnchangedLocation = cached && 
      cached.lat === venue.lat && 
      cached.lng === venue.lng &&
      JSON.stringify(cached.outdoorPoint) === JSON.stringify(venue.outdoorPoint);

    if (hasUnchangedLocation && cached.horizonMask && cached.horizonMask.length === 72) {
      processed.push({
        ...venue,
        horizonMask: cached.horizonMask
      });
      continue;
    }

    console.log(`+ Analyzing: ${venue.name} (Location modified or upgraded to 72-bin, querying Overpass...)`);
    try {
      const lat = venue.outdoorPoint?.lat ?? venue.lat;
      const lng = venue.outdoorPoint?.lng ?? venue.lng;

      const osmData = await fetchSurroundingBuildings(lat, lng);
      const horizonMask = computeHorizonMask(lat, lng, osmData);

      processed.push({
        ...venue,
        horizonMask
      });

      await new Promise(resolve => setTimeout(resolve, 1500));
    } catch (e) {
      console.error(`Failed to process ${venue.name}:`, e.message);
      processed.push({ ...venue, horizonMask: new Array(72).fill(0) });
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(processed, null, 2), 'utf8');
  console.log(`Success! Output written to src/data/processed_venues.json`);
}

run();