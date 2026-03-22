export type Flight = {
  id: string  // icao24 or generated id
  callsign: string
  longitude: number
  latitude: number
  heading?: number
  altitude?: number
  velocity?: number
}
