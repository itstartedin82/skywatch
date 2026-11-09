import type { Config } from "@netlify/functions"

// Free, no-key ADS-B APIs. The second is a fallback if the first fails.
const SOURCES = [
  (lat: string, lon: string, r: number) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${r}`,
  (lat: string, lon: string, r: number) => `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${r}`,
]

const rad = (d: number) => (d * Math.PI) / 180

function distBearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1)
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  const dist = 2 * 3958.8 * Math.asin(Math.sqrt(a)) // miles
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return { dist, brg: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)

function trim(a: any, lat: number, lon: number) {
  if (num(a.lat) === null || num(a.lon) === null) return null
  const { dist, brg } = distBearing(lat, lon, a.lat, a.lon)
  const ground = a.alt_baro === "ground"
  const hex = String(a.hex || "").toUpperCase()
  const gs = num(a.gs)
  return {
    id: hex,
    call: String(a.flight || "").trim() || a.r || hex,
    reg: a.r || "",
    type: a.t || "",
    desc: a.desc || "",
    owner: a.ownOp || "",
    cat: a.category || "",
    alt: ground ? 0 : num(a.alt_baro),
    ground,
    mph: gs === null ? null : Math.round(gs * 1.15078),
    track: num(a.track),
    vs: num(a.baro_rate),
    squawk: a.squawk || "",
    mil: Boolean((a.dbFlags || 0) & 1),
    dist: Math.round(dist * 10) / 10,
    brg: Math.round(brg),
  }
}

export default async (req: Request) => {
  const q = new URL(req.url).searchParams
  const lat = Number(q.get("lat"))
  const lon = Number(q.get("lon"))
  const r = Math.min(250, Math.max(5, Math.round(Number(q.get("r")) || 40))) // nautical miles

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return Response.json({ error: "Invalid coordinates", ac: [] }, { status: 400 })
  }

  // Only a rounded (~1 km) location is sent to the upstream API.
  const la = lat.toFixed(2), lo = lon.toFixed(2)
  let lastErr = "All flight sources unavailable"

  for (const src of SOURCES) {
    const url = src(la, lo, r)
    const host = new URL(url).host
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "skywatch-web/1.0" },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) { lastErr = `${host} returned ${res.status}`; continue }
      const data: any = await res.json()
      const ac = (Array.isArray(data.ac) ? data.ac : [])
        .map((a: any) => trim(a, lat, lon))
        .filter(Boolean)
        .sort((a: any, b: any) => a.dist - b.dist)
        .slice(0, 150)
      return Response.json(
        { ac, source: host, radius_mi: Math.round(r * 1.15078), time: Date.now() },
        { headers: { "Cache-Control": "no-store" } },
      )
    } catch (e) {
      lastErr = `${host}: ${(e as Error).message}`
    }
  }
  return Response.json({ error: lastErr, ac: [] }, { status: 502 })
}

export const config: Config = { path: "/api/flights" }
