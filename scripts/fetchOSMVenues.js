import fs from 'fs';
import path from 'path';

const minLat = 57.680;
const minLng = 11.900;
const maxLat = 57.720;
const maxLng = 11.995;

const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter'
];

async function fetchWithFallback(query) {
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
      } else {
        // Explicitly throw so the catch block stores the status code
        throw new Error(`Server ${server} returned status: ${response.status}`);
      }
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`All Overpass mirror servers failed. Last error: ${lastError?.message}`);
}

async function fetchVenuesFromOSM() {
  const query = `
    [out:json][timeout:90];
    (
      node["amenity"~"bar|pub|restaurant|cafe"]["outdoor_seating"~"yes|sidewalk|terrace|surface"](${minLat}, ${minLng}, ${maxLat}, ${maxLng});
      way["amenity"~"bar|pub|restaurant|cafe"]["outdoor_seating"~"yes|sidewalk|terrace|surface"](${minLat}, ${minLng}, ${maxLat}, ${maxLng});
    );
    out center;
  `;
  
  console.log("Querying OpenStreetMap mirrors for verified outdoor seating in Gothenburg...");
  return await fetchWithFallback(query);
}

function processOSMData(osmData) {
  const venues = [];
  const seenNames = new Set();

  osmData.elements.forEach(el => {
    if (!el.tags || !el.tags.name) return;

    const rawName = el.tags.name;
    const normalizedName = rawName.toLowerCase().trim();
    if (seenNames.has(normalizedName)) return;

    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!lat || !lng) return;

    const street = el.tags['addr:street'] || '';
    const num = el.tags['addr:housenumber'] || '';
    const postcode = el.tags['addr:postcode'] || '';
    const address = street 
      ? `${street} ${num}, ${postcode} Göteborg`.replace(/\s+/g, ' ').trim() 
      : 'Göteborg, Sweden';

    const amenity = el.tags.amenity || 'bar';
    const tags = [amenity.charAt(0).toUpperCase() + amenity.slice(1)];
    if (el.tags.cuisine) {
      tags.push(el.tags.cuisine.charAt(0).toUpperCase() + el.tags.cuisine.slice(1));
    }

    venues.push({
      id: `${amenity}-${el.id}`,
      name: rawName,
      address: address,
      lat: parseFloat(lat.toFixed(6)),
      lng: parseFloat(lng.toFixed(6)),
      hasOutdoor: true,
      tags: tags
    });

    seenNames.add(normalizedName);
  });

  return venues;
}

async function run() {
  const outputPath = path.resolve('scripts/input_venues.json');

  try {
    const rawData = await fetchVenuesFromOSM();
    const cleanVenues = processOSMData(rawData);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(cleanVenues, null, 2), 'utf8');

    console.log(`\nSuccess! Narrowed down to ${cleanVenues.length} highly verified outdoor seating venues in Gothenburg.`);
    console.log(`Saved clean database to: ${outputPath}`);
  } catch (err) {
    console.error("OSM Import failed:", err.message);
  }
}

run();