/**
 * Encode a caller-supplied value as exactly one URL path segment.
 *
 * Tool arguments come from the model, and so from whatever text it has read.
 * Interpolated as-is, "../" climbs out of the intended route and "?" or "#"
 * cut it short, so a tool could send its method and token to another
 * endpoint. encodeURIComponent keeps "/", "?", "#" and "%" inside the segment,
 * but leaves "." and ".." unchanged, and URL parsing still treats those as
 * dot segments, so they are refused.
 */
export function pathSegment(value: string | number): string {
  const text = String(value);
  if (text === '' || text === '.' || text === '..') {
    throw new Error(`Invalid path segment: ${JSON.stringify(text)}`);
  }
  return encodeURIComponent(text);
}
