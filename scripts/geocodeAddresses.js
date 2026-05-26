import fs from 'fs';
import path from 'path';

// Queries Nominatim (OSM Geocoding engine) - Free & high-precision for Sweden
async function geocodeQuery(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'HabbaGeocodingCalibrator/1.0 (contact: jowe62 on github)'
      }
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        displayName: data[0].display_name
      };
    }
  } catch (e) {
    // Fail silently to allow fallback logic
  }
  return null;
}

async function run() {
  const filePath = path.resolve('scripts/input_venues.json');
  if (!fs.existsSync(filePath)) {
    console.error("Error: input_venues.json not found.");
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const venues = JSON.parse(raw);

  console.log(`Starting address geocoding calibration for ${venues.length} venues...`);
  const updated = [];

  for (const venue of venues) {
    console.log(`Calibrating: ${venue.name}...`);
    
    // Two-Pass Strategy: 1) Try Name, 2) Try Address
    let coords = await geocodeQuery(`${venue.name}, Göteborg, Sweden`);
    if (!coords) {
      coords = await geocodeQuery(venue.address);
    }

    if (coords) {
      // Check if coordinate adjustment is significant (> ~10 meters)
      const latDiff = Math.abs(venue.lat - coords.lat);
      const lngDiff = Math.abs(venue.lng - coords.lng);
      
      if (latDiff > 0.0001 || lngDiff > 0.0001) {
        console.log(`  -> Coordinates corrected for ${venue.name}:`);
        console.log(`     Old: [${venue.lat}, ${venue.lng}]`);
        console.log(`     New: [${coords.lat}, ${coords.lng}]`);
        
        updated.push({
          ...venue,
          lat: parseFloat(coords.lat.toFixed(6)),
          lng: parseFloat(coords.lng.toFixed(6))
        });
      } else {
        console.log(`  - Location is already accurate.`);
        updated.push(venue);
      }
    } else {
      console.warn(`  ! Could not geocode address details for: ${venue.name}`);
      updated.push(venue);
    }

    // Throttle queries to 1 second to respect Nominatim free server guidelines
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf8');
  console.log(`\nSuccess! input_venues.json has been updated with calibrated coordinates.`);
  console.log(`Now run 'node --dns-result-order=ipv4first scripts/generateHorizon.js' to automatically re-compile shadows for any corrected locations.`);
}

run();