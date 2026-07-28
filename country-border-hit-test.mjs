function unwrapRing(ring) {
  if (!ring.length) return [];
  const unwrapped = [[...ring[0]]];
  for (let index = 1; index < ring.length; index++) {
    let [lon, lat] = ring[index];
    const previousLon = unwrapped.at(-1)[0];
    while (lon - previousLon > 180) lon -= 360;
    while (lon - previousLon < -180) lon += 360;
    unwrapped.push([lon, lat]);
  }
  return unwrapped;
}

export function pointInBorderRing(lon, lat, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x, y] = ring[index];
    const [previousX, previousY] = ring[previous];
    const crosses =
      (y > lat) !== (previousY > lat) &&
      lon < ((previousX - x) * (lat - y)) / (previousY - y) + x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function createCountryBorderHitTester(borders) {
  const polygons = Object.entries(borders).flatMap(([iso3, rings]) =>
    rings
      .filter((ring) => ring.length >= 3)
      .map((sourceRing) => {
        const ring = unwrapRing(sourceRing);
        const longitudes = ring.map(([lon]) => lon);
        const latitudes = ring.map(([, lat]) => lat);
        const minLon = Math.min(...longitudes);
        const maxLon = Math.max(...longitudes);
        const minLat = Math.min(...latitudes);
        const maxLat = Math.max(...latitudes);
        return {
          iso3,
          ring,
          minLon,
          maxLon,
          minLat,
          maxLat,
          area: (maxLon - minLon) * (maxLat - minLat),
        };
      }),
  );

  function countryAt(lon, lat) {
    let best = null;
    for (const polygon of polygons) {
      if (lat < polygon.minLat || lat > polygon.maxLat) continue;
      for (const candidateLon of [lon, lon - 360, lon + 360]) {
        if (
          candidateLon < polygon.minLon ||
          candidateLon > polygon.maxLon ||
          !pointInBorderRing(candidateLon, lat, polygon.ring)
        ) {
          continue;
        }
        // Prefer the smallest containing polygon where borders overlap, so
        // enclaves and small island states are not swallowed by a broad
        // neighboring bounding shape.
        if (!best || polygon.area < best.area) best = polygon;
        break;
      }
    }
    return best?.iso3 ?? null;
  }

  return { countryAt };
}
