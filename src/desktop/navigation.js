export function appRouteUrl(path, location = globalThis.location) {
  const route = String(path || "/").startsWith("/") ? String(path || "/") : `/${path}`;
  if (!location?.href) return `#${route}`;
  const url = new URL(location.href);
  url.hash = route;
  return url.toString();
}
