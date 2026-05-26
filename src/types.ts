export interface OutdoorPoint {
  lat: number;
  lng: number;
}

export interface Venue {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  hasOutdoor: boolean;
  tags: string[];
  notes?: string;
  outdoorPoint?: OutdoorPoint;
  horizonMask?: number[];
}

export interface SunWindow {
  start: string;
  end: string;
}

export interface SunDetails {
  inSunNow: boolean;
  sunWindows: SunWindow[];
  totalSunMinutes: number;
}

export interface Report {
  timestamp: number;
  venueId: string;
  deviceId: string;
  value: 'yes' | 'no';
}