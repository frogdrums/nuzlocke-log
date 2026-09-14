var CACHE_NAME = "nuzlocke-log-v17";
var PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  // Renegade Platinum damage calculator engine (vendored from
  // hzla/Dynamic-Calc-Decomps, see CLAUDE.md) + its rebalanced species/
  // move data + adapter. Precached explicitly (not just left to the
  // fetch handler's runtime caching below) so the Calculator tab works
  // offline right after the very first install, matching this app's
  // offline-first design — rp-data.js alone is ~4.6MB, the bulk of why
  // this list is bigger than it used to be.
  "./calc/util.js",
  "./calc/stats.js",
  "./calc/data/types.js",
  "./calc/data/natures.js",
  "./calc/data/abilities.js",
  "./calc/data/moves.js",
  "./calc/data/items.js",
  "./calc/move.js",
  "./calc/pokemon.js",
  "./calc/field.js",
  "./calc/items.js",
  "./calc/mechanics/util.js",
  "./calc/mechanics/boostModifiers.js",
  "./calc/mechanics/romhacks/helpers.js",
  "./calc/mechanics/romhacks/profiles/cascade-white.js",
  "./calc/mechanics/romhacks/profiles/little-emerald.js",
  "./calc/mechanics/romhacks/profiles/platinum-kaizo.js",
  "./calc/mechanics/romhacks/profiles/platinum-redux.js",
  "./calc/mechanics/romhacks/index.js",
  "./calc/mechanics/gen789.js",
  "./calc/mechanics/vanilla/gen789.js",
  "./calc/mechanics/gen56.js",
  "./calc/mechanics/gen4.js",
  "./calc/mechanics/gen3.js",
  "./calc/mechanics/gen12.js",
  "./calc/calc.js",
  "./calc/desc.js",
  "./calc/result.js",
  "./calc/rp-data.js",
  "./calc/rp-adapter.js",
  // Gen 4 save-file parser + its lookup tables (ours, not vendored; see
  // CLAUDE.md's Phase 3 section). Loaded on demand by loadSaveParser(),
  // separately from the engine bundle above — but precached alongside it so
  // importing a save works offline, same as everything else here.
  "./calc/gen4-save-data.js",
  "./calc/gen4-save.js"
];

self.addEventListener("install", function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(PRECACHE);
    }).then(function(){
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE_NAME; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){
      return self.clients.claim();
    })
  );
});

// 2026-09-09: the vendored calc/ engine files (see PRECACHE above) get
// their own cache-first handling, split out from the app-shell handling
// below. They're third-party and effectively immutable between deploys —
// any real change to them bumps CACHE_NAME (see "Deploy" in CLAUDE.md),
// which forces a full fresh precache on activate regardless of this
// runtime path. Network-first for them bought nothing but ~30 extra
// round trips per launch (one of them for a ~4.9MB file), which is what
// made "switching back to the installed PWA" feel slow — the app-shell
// files (index.html, manifest.json, navigations) still need to be
// network-first exactly as before, so don't fold this into that handler.
function isCalcAsset(url){
  return url.pathname.indexOf("/calc/") !== -1;
}

self.addEventListener("fetch", function(event){
  if(event.request.method !== "GET") return;
  var url = new URL(event.request.url);

  if(isCalcAsset(url)){
    // Cache-first, with a background revalidate as a hedge (e.g. a
    // precache that didn't fully complete) rather than a strict
    // cache-only — this is "stale-while-revalidate" in spirit: a cache
    // hit resolves immediately with no network wait at all, and the
    // network response (if any) still updates the cache for next time.
    event.respondWith(
      caches.match(event.request).then(function(cached){
        // A cache hit is served as-is and NOTHING is re-fetched. These
        // files only ever change alongside a CACHE_NAME bump, which
        // re-precaches all of them on activate, so a background
        // revalidate could never find anything new — it only re-downloaded
        // the whole bundle (~4.9MB of it in rp-data.js alone) on every
        // launch, which is the opposite of what this branch is for.
        if(cached) return cached;
        return fetch(event.request).then(function(response){
          if(response && response.status === 200){
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, copy); });
          }
          return response;
        });
        // Deliberately no .catch() returning null here: respondWith(null)
        // makes the request fail as a network error, which the page sees
        // as a script that failed to load. Letting the rejection through
        // produces the same failure but with a real error, and the page's
        // own retry path handles it.
      })
    );
    return;
  }

  // Network-first: always try to fetch the latest version. Only fall back
  // to the cached copy if the network is unavailable (offline). This means
  // GitHub updates show up the next time you open the app with a connection,
  // instead of getting stuck on whatever was cached the first time.
  event.respondWith(
    fetch(event.request).then(function(response){
      if(response && response.status === 200){
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, copy); });
      }
      return response;
    }).catch(function(){
      return caches.match(event.request).then(function(cached){
        if(cached) return cached;
        if(event.request.mode === "navigate"){
          return caches.match("./index.html");
        }
      });
    })
  );
});
