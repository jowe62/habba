import fs from 'fs';
import path from 'path';

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

// Mirror server pool to bypass blocks and rate limits
const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter'
];

async function fetchSurroundingBuildings(lat, lng, radius = 150) {
  const query = `
    [out:json];
    (
      way["building"](around:${radius}, ${lat}, ${lng});
      relation["building"](around:${radius}, ${lat}, ${lng});
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
  const mask = new Array(36).fill(0);
  const nodes = {};

  osmData.elements.forEach(el => {
    if (el.type === 'node') {
      nodes[el.id] = { lat: el.lat, lon: el.lon };
    }
  });

  osmData.elements.forEach(el => {
    if (el.type === 'way' && el.nodes && el.tags) {
      let height = 15;
      if (el.tags.height) {
        height = parseFloat(el.tags.height);
      } else if (el.tags['building:levels']) {
        const levels = parseFloat(el.tags['building:levels']);
        height = levels * 3.5;
      }

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
          const binIndex = Math.round(azimuth / 10) % 36;
          
          if (elevation > mask[binIndex]) {
            mask[binIndex] = Math.round(elevation);
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

  console.log(`Starting V2 shadow calculations for ${venues.length} venues...`);
  const processed = [];

  for (const venue of venues) {
    console.log(`Analyzing: ${venue.name}...`);
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
      processed.push({ ...venue, horizonMask: new Array(36).fill(0) });
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(processed, null, 2), 'utf8');
  console.log(`Success! Output written to src/data/processed_venues.json`);
}

run();