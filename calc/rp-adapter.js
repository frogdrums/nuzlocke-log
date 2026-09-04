/*
 * Renegade Platinum adapter for the vendored @smogon/calc-derived engine
 * (./calc/*.js, ./data/*.js, ./mechanics/*.js — copied from
 * hzla/Dynamic-Calc-Decomps, MIT licensed, see ./LICENSE).
 *
 * Loads the rebalanced species/move data from rp-data.js
 * (window.RP_BACKUP_DATA, vendored from that repo's backups/rp.js) and
 * exposes it to the engine in the shape it expects (gen.species.get(id),
 * gen.moves.get(id) returning objects with baseStats.hp/atk/def/spa/spd/spe
 * etc.), plus a small calculate() convenience wrapper for index.html's
 * Calculator tab.
 *
 * Must load AFTER all ./calc/*.js engine files and rp-data.js, since it
 * reads off the shared `calc`/`exports` global those files populate (see
 * the require()/exports shim in index.html, right before the first
 * <script src="./calc/..."> tag).
 *
 * Mechanics settings below are Renegade Platinum's exact combination as
 * verified from the source repo's js/initialize.js setGameSettings() —
 * see CLAUDE.md's "Damage calculator & trainer data" section. These are
 * three independent axes (damage formula gen, crit-chance gen, type
 * chart gen), not a uniform "gen 4" setting — do not simplify this.
 */
(function () {
  'use strict';

  if (typeof calc === 'undefined' || !calc.calculate || !calc.Pokemon) {
    console.error('rp-adapter.js: calc engine not loaded before this script.');
    return;
  }
  if (typeof window.RP_BACKUP_DATA === 'undefined') {
    console.error('rp-adapter.js: rp-data.js not loaded before this script.');
    return;
  }

  var RP = window.RP_BACKUP_DATA;
  var toID = calc.toID;

  // ---- Ambient globals the vendored mechanics code reads directly ----
  // (confirmed via calc/test/*.test.js in the source repo, which is the
  // only place this harness contract is written down explicitly).
  function applyGameGlobals() {
    window.TITLE = 'Renegade Platinum';
    window.gameGen = 4;
    window.settings = window.settings || {};
    window.settings.damageGen = 4;
    window.settings.critGen = 5;
    window.settings.typeChart = 6;
    window.settings.type_chart = 6;
    window.settings.gameSwitchIn = 4;
    window.settings.switchIn = 4;
    window.settings.sourceType = 'full';
    window.settings.physSpecSplit = true;
    window.settings.challengeMode = false;
    window.typeChart = calc.TYPE_CHART[6];
    window.pokedex = window.pokedex || {};
    window.FIELD_EFFECTS = window.FIELD_EFFECTS || {};
    window.get_current_in = window.get_current_in || function () { return null; };
    window.calcingForSwitchIns = false;
    window.backup_moves = window.backup_moves || {};
    window.p1Name = window.p1Name || '';
    window.p2Name = window.p2Name || '';
  }
  applyGameGlobals();

  // Vanilla gen-8 dex, used only as a source of move flags/secondaries/
  // target/drain/recoil/etc (mechanical fields rp.js's slim movedex
  // doesn't carry) and for abilities/items/natures, which don't vary
  // between vanilla Platinum and this romhack's rebalance. Built directly
  // from the data/*.js classes (not calc.Generations, which also drags in
  // data/species.js's ~350KB of vanilla species tables this adapter never
  // reads — RP species always come from rp-data.js instead). gen 8 (not
  // 9) to stay inside stats.js's validated 1-8 range in case anything
  // ever passes this object into calcStat.
  var vanillaGen = {
    num: 8,
    moves: new calc.Moves(8),
    abilities: new calc.Abilities(8),
    items: new calc.Items(8),
    natures: new calc.Natures()
  };

  // ---- Species ----
  var speciesById = {};
  var speciesNames = [];
  Object.keys(RP.poks).forEach(function (name) {
    var raw = RP.poks[name];
    var bs = raw.bs || {};
    var abilities = Object.keys(raw.abilities || {})
      .sort()
      .map(function (k) { return raw.abilities[k]; });
    var id = toID(name);
    speciesById[id] = {
      kind: 'Species',
      id: id,
      name: name,
      types: raw.types && raw.types.length ? raw.types : ['Normal'],
      baseStats: {
        hp: bs.hp || 0,
        atk: bs.at || 0,
        def: bs.df || 0,
        spa: bs.sa || 0,
        spd: bs.sd || 0,
        spe: bs.sp || 0
      },
      abilities: abilities.length ? abilities : ['No Ability'],
      // rp.js does not carry weight data; used only by a handful of moves
      // (Low Kick, Grass Knot, Heavy Slam, Heat Crash) — a neutral default
      // is an acknowledged inaccuracy for exactly those moves.
      weightkg: 50,
      learnset: raw.learnset_info || null
    };
    speciesNames.push(name);
  });
  speciesNames.sort(function (a, b) { return a.localeCompare(b); });

  var speciesLookup = {
    gen: 4,
    get: function (id) { return speciesById[id]; }
  };

  // ---- Moves ----
  // rp.js's own movedex only has basePower/pp/acc/type/category/priority
  // (the numbers the rebalance actually changes) — no flags, secondaries,
  // target, drain, recoil, or multihit data. Those mechanical fields are
  // merged in from the vanilla gen-8 movedex (unaffected by the
  // rebalance) so things like recoil/drain/contact-triggered abilities
  // still work correctly.
  var movesById = {};
  var moveNames = [];
  Object.keys(RP.moves).forEach(function (name) {
    var raw = RP.moves[name];
    var id = toID(name);
    var base = vanillaGen.moves.get(id);
    var m = {
      kind: 'Move',
      id: id,
      name: name,
      type: raw.type || (base && base.type) || 'Normal',
      category: raw.category || (base && base.category) || 'Status',
      basePower: typeof raw.basePower === 'number' ? raw.basePower : (base ? base.basePower : 0),
      // rp.js uses 0 to mean "never misses", matching the engine's own
      // `accuracy: true` convention.
      accuracy: raw.acc ? raw.acc : true,
      priority: typeof raw.priority === 'number' ? raw.priority : (base ? base.priority : 0),
      pp: raw.pp,
      flags: base ? Object.assign({}, base.flags) : {},
      secondaries: base ? base.secondaries : undefined,
      secondary: base ? base.secondary : undefined,
      self: base ? base.self : undefined,
      target: (base && base.target) || 'normal',
      drain: base ? base.drain : undefined,
      recoil: base ? base.recoil : undefined,
      multihit: base ? base.multihit : undefined,
      willCrit: base ? base.willCrit : undefined,
      breaksProtect: base ? base.breaksProtect : undefined,
      ignoreImmunity: base ? base.ignoreImmunity : undefined,
      ignoreDefensive: base ? base.ignoreDefensive : undefined,
      overrideOffensiveStat: base ? base.overrideOffensiveStat : undefined,
      overrideDefensiveStat: base ? base.overrideDefensiveStat : undefined
    };
    movesById[id] = m;
    moveNames.push(name);
  });
  moveNames.sort(function (a, b) { return a.localeCompare(b); });

  var movesLookup = {
    gen: 4,
    get: function (id) { return movesById[id]; }
  };

  // ---- Items ----
  // rp.js carries no item data of its own (this romhack doesn't redefine
  // items) — sourced from the same vanilla gen-8 item dex
  // (calc/data/items.js's Items class) abilities/move-flags/natures above
  // already come from. Items is iterable (see its Symbol.iterator), each
  // yielding an Item with .name — the exact string buildPokemon()/
  // Pokemon.hasItem() need (item matching is a plain string check, no
  // toID normalization on the engine's side).
  var itemNames = Array.from(vanillaGen.items)
    .map(function (i) { return i.name; })
    .sort(function (a, b) { return a.localeCompare(b); });

  // ---- The custom "Generation" object passed to calc.calculate() ----
  var RPGen = {
    num: 4,
    species: speciesLookup,
    moves: movesLookup,
    abilities: vanillaGen.abilities,
    items: vanillaGen.items,
    natures: vanillaGen.natures,
    types: new calc.Types(6)
  };

  function getLearnsetMoveNames(speciesName) {
    var sp = speciesById[toID(speciesName)];
    if (!sp || !sp.learnset) return moveNames;
    var set = {};
    (sp.learnset.learnset || []).forEach(function (pair) { set[pair[1]] = true; });
    (sp.learnset.tms || []).forEach(function (n) { set[n] = true; });
    var names = Object.keys(set).filter(function (n) { return movesById[toID(n)]; });
    names.sort(function (a, b) { return a.localeCompare(b); });
    return names.length ? names : moveNames;
  }

  function buildPokemon(opts) {
    opts = opts || {};
    var options = {
      level: opts.level || 50,
      nature: opts.nature || 'Serious',
      ivs: opts.ivs || { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      evs: opts.evs || { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      // In-battle stat stages (-6..+6 per stat), NOT part of the base
      // stat calculation below — Pokemon.withDefault(gen, options.boosts,
      // 0, false) (calc/pokemon.js) fills in 0 for any stat left out, so
      // passing undefined here (the common case, no UI boosts set) is
      // equivalent to all-zero. The mechanics code
      // (calc/mechanics/gen4.js) reads attacker.boosts/defender.boosts
      // directly off the built Pokemon at calculate()-time, layered on
      // top of rawStats — independent of the statsOverride path below.
      boosts: opts.boosts,
      ability: opts.ability,
      item: opts.item || '',
      gender: opts.gender
    };
    var pokemon = new calc.Pokemon(RPGen, opts.species, options);
    // A trainer mon Simulated in from the Bosses/Trainers tab carries its
    // own already-known-exact stats (real computed HP/Atk/Def/SpA/SpD/Spe
    // at that trainer's level, from Phase 1's data pull) rather than a
    // nature/IV/EV spread — use those directly instead of what the
    // constructor just computed from the (default/placeholder) options
    // above.
    if (opts.statsOverride && opts.statsOverride.length === 6) {
      var keys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
      keys.forEach(function (key, i) {
        pokemon.rawStats[key] = opts.statsOverride[i];
        pokemon.stats[key] = opts.statsOverride[i];
      });
      pokemon.originalCurHP = pokemon.rawStats.hp;
      // calc.calculate() clones attacker/defender before running the
      // mechanics (calc/calc.js), and Pokemon.prototype.clone() normally
      // *recomputes* rawStats/stats from level/ivs/evs/nature — silently
      // discarding the override above unless this flag is set, in which
      // case clone() copies rawStats/stats verbatim instead (see
      // pokemon.js's own clone(), written for Transform's use of the same
      // problem: preserving already-known stats across a clone).
      pokemon.preserveTransformedStatsOnClone = true;
    }
    return pokemon;
  }

  function buildMove(name, opts) {
    return new calc.Move(RPGen, name, opts || {});
  }

  // Runs one calculation. attackerOpts/defenderOpts: {species, level,
  // nature, ivs, evs, boosts, ability, item, statsOverride}. boosts
  // (optional) is {atk,def,spa,spd,spe} stat stages, -6..+6, default 0.
  // statsOverride (optional) is [hp,atk,def,spa,spd,spe] of already-known-
  // exact stats, used as-is instead of computing from level/nature/ivs/evs
  // (see buildPokemon). moveName: string. fieldOpts (all optional):
  // {weather, terrain, isReflect, isLightScreen}.
  function runCalculation(attackerOpts, defenderOpts, moveName, fieldOpts) {
    applyGameGlobals();
    fieldOpts = fieldOpts || {};
    try {
      var attacker = buildPokemon(attackerOpts);
      var defender = buildPokemon(defenderOpts);
      var move = buildMove(moveName, {});
      attacker.moves = [move];
      var field = new calc.Field({
        weather: fieldOpts.weather || undefined,
        terrain: fieldOpts.terrain || undefined,
        defenderSide: {
          isReflect: !!fieldOpts.isReflect,
          isLightScreen: !!fieldOpts.isLightScreen
        }
      });
      var result = calc.calculate(RPGen, attacker, defender, move, field);
      var range = null;
      try { range = result.range(); } catch (e) { /* status moves etc. */ }
      var percent = null;
      if (range) {
        // result.defender is the clone calc.calculate() actually computed
        // against (see calc/calc.js) — read maxHP() off that, not the
        // pre-clone `defender` above, so this always matches what
        // result.fullDesc()/kochance() themselves used.
        var maxHP = result.defender.maxHP();
        percent = [
          Math.round((range[0] / maxHP) * 1000) / 10,
          Math.round((range[1] / maxHP) * 1000) / 10
        ];
      }
      var text = '';
      try { text = result.fullDesc(); } catch (e) { text = String(e.message || e); }
      var ko = null;
      try { ko = result.kochance(false); } catch (e) { /* not applicable */ }
      return {
        ok: true,
        text: text,
        range: range,
        percent: percent,
        ko: ko,
        attacker: attacker,
        defender: defender,
        move: move
      };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  // Builds a Pokemon from the same opts shape runCalculation()'s
  // attackerOpts/defenderOpts take and returns its computed rawStats
  // (post level/nature/IV/EV — NOT stat-stage-boosted; see buildPokemon,
  // boosts never touch rawStats, only the mechanics code's read of it at
  // calculate()-time). Exists so index.html can show "what are this
  // mon's actual stats right now" without re-deriving the stat formula
  // itself — same numbers runCalculation()'s own attacker/defender used.
  function computeStats(opts) {
    applyGameGlobals();
    try {
      var pokemon = buildPokemon(opts);
      return {
        ok: true,
        hp: pokemon.rawStats.hp,
        atk: pokemon.rawStats.atk,
        def: pokemon.rawStats.def,
        spa: pokemon.rawStats.spa,
        spd: pokemon.rawStats.spd,
        spe: pokemon.rawStats.spe
      };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  window.RPCalc = {
    gen: RPGen,
    speciesNames: speciesNames,
    moveNames: moveNames,
    itemNames: itemNames,
    getSpecies: function (name) { return speciesById[toID(name)]; },
    getMove: function (name) { return movesById[toID(name)]; },
    getItem: function (name) { return vanillaGen.items.get(toID(name)); },
    getLearnsetMoveNames: getLearnsetMoveNames,
    calculate: runCalculation,
    computeStats: computeStats
  };
})();
