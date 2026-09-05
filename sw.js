var CACHE_NAME = "nuzlocke-log-v7";
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
  "./calc/rp-adapter.js"
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

// Network-first: always try to fetch the latest version. Only fall back
// to the cached copy if the network is unavailable (offline). This means
// GitHub updates show up the next time you open the app with a connection,
// instead of getting stuck on whatever was cached the first time.
self.addEventListener("fetch", function(event){
  if(event.request.method !== "GET") return;
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
