"use strict";

/**
 * Public tunnel — exposes the local ForgeEngine server (HTTPS + the /mp
 * multiplayer WebSocket upgrade path) behind a single shareable internet
 * URL, using `localtunnel`. This is what makes "playtest with friends
 * around the world" possible without the host configuring port forwarding
 * or a router.
 *
 * Previously the project only *declared* a dependency on `node-tunnel`
 * (an HTTP CONNECT-proxy client) but never called it anywhere, so no
 * public URL was ever actually generated. `localtunnel` is the package
 * that does what was intended here: it opens an outbound connection to a
 * relay and hands back a public `https://<subdomain>.loca.lt` URL that
 * forwards straight back to this process, WebSocket upgrades included —
 * which is exactly what the multiplayer hub in `multiplayer-hub.js` needs.
 *
 * Only one tunnel runs per server process; starting a new one first stops
 * whatever is currently open.
 */

const localtunnel = require("localtunnel");

let current = null; // { tunnel, url, port, subdomain, slug, startedAt }

function status() {
  if (!current) return { active: false, url: null, subdomain: null, slug: null, startedAt: null };
  return { active: true, url: current.url, subdomain: current.subdomain, slug: current.slug, startedAt: current.startedAt };
}

/**
 * Opens (or replaces) the public tunnel to `port`. `subdomain` is requested
 * as the game's own slug (see core/index.js) so the public link reads as
 * `wss://<game-name>.loca.lt` rather than a random loca.lt phrase — it's
 * still a best-effort request, since loca.lt reassigns it if that subdomain
 * is already taken by someone else, so the actual host always comes back
 * from the returned url. `slug` is stored purely so other parts of the
 * server (game-manager's connect-info writer) know which game this tunnel
 * currently belongs to.
 */
async function start(port, { subdomain, slug } = {}) {
  await stop();
  const tunnel = await localtunnel({ port, subdomain: subdomain || undefined });
  current = { tunnel, url: tunnel.url, port, subdomain: subdomain || null, slug: slug || null, startedAt: new Date().toISOString() };

  tunnel.on("close", () => { if (current && current.tunnel === tunnel) current = null; });
  tunnel.on("error", () => { if (current && current.tunnel === tunnel) current = null; });

  return status();
}

async function stop() {
  if (!current) return { active: false, url: null, subdomain: null, slug: null, startedAt: null };
  try { current.tunnel.close(); } catch { /* already closed */ }
  current = null;
  return status();
}

module.exports = { start, stop, status };
