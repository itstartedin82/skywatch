import type { Config } from "@netlify/functions"

// Looks up an aircraft photo on Planespotters.net by transponder hex, then registration.
// Planespotters requires the photographer credit and a link back, which the app shows.
export default async (req: Request) => {
  const q = new URL(req.url).searchParams
  const hex = (q.get("hex") || "").replace(/[^0-9a-fA-F]/g, "").slice(0, 6)
  const reg = (q.get("reg") || "").replace(/[^0-9A-Za-z-]/g, "").slice(0, 10)
  if (!hex && !reg) return Response.json({ error: "hex or reg required" }, { status: 400 })

  const urls = [
    hex && `https://api.planespotters.net/pub/photos/hex/${hex}`,
    reg && `https://api.planespotters.net/pub/photos/reg/${reg}`,
  ].filter(Boolean) as string[]

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "skywatch-web/1.0" },
        signal: AbortSignal.timeout(6000),
      })
      if (!res.ok) continue
      const data: any = await res.json()
      const p = Array.isArray(data.photos) ? data.photos[0] : null
      const src = p?.thumbnail_large?.src || p?.thumbnail?.src
      if (src) {
        return Response.json(
          { src, link: p.link || "https://www.planespotters.net", photographer: p.photographer || "Unknown" },
          { headers: { "Cache-Control": "public, max-age=86400" } },
        )
      }
    } catch {
      // try the next lookup
    }
  }
  return Response.json({ src: null }, { headers: { "Cache-Control": "public, max-age=3600" } })
}

export const config: Config = { path: "/api/photo" }
