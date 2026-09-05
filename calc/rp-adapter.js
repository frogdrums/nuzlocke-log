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
  // ---- Species weights (Grass Knot / Low Kick base-power brackets) ----
  // rp.js carries no weight field for any of its 507 species (Renegade
  // Platinum's own trainer/dex data has never included one). Table below
  // is sourced from the UPSTREAM hzla/Dynamic-Calc-Decomps repo (`decomp`
  // branch) — the actual engine this project vendored — specifically
  // `calc/data/species.js`'s `exports.SPECIES[4]` (index 4 = Gen 4/DPP),
  // a file this vendoring deliberately dropped (see the <script> comment
  // in index.html). 554 entries, keyed by a normalized name (lowercased,
  // non-alphanumeric characters stripped) so things like the apostrophe
  // in "Farfetch\u2019d" (curly quote in the source data) and "UNOWN"'s
  // casing still match RP's own species names.
  //
  // Standing assumption, NOT independently verified: Renegade Platinum
  // did not rebalance species *weights* the way it rebalanced base stats
  // and movesets — rp.js has no weight data at all, so there is nothing
  // in this project's own data to confirm or contradict that. Treat
  // vanilla Gen 4 weights as the best available answer, not a certainty.
  // Only Grass Knot and Low Kick actually read weightkg in this engine's
  // gen-4 damage path (mechanics/gen4.js) — Heavy Slam/Heat Crash are
  // NOT wired to it here (they were incorrectly listed as affected in
  // an earlier version of this project's notes).
var DPP_WEIGHTKG_BY_NORMALIZED_NAME = {
    "abomasnow": 135.5,
    "abra": 19.5,
    "absol": 47,
    "aerodactyl": 59,
    "aggron": 360,
    "aipom": 11.5,
    "alakazam": 48,
    "altaria": 20.6,
    "ambipom": 20.3,
    "ampharos": 61.5,
    "anorith": 12.5,
    "arbok": 65,
    "arcanine": 155,
    "arceus": 320,
    "arceusbug": 320,
    "arceusdark": 320,
    "arceusdragon": 320,
    "arceuselectric": 320,
    "arceusfighting": 320,
    "arceusfire": 320,
    "arceusflying": 320,
    "arceusghost": 320,
    "arceusgrass": 320,
    "arceusground": 320,
    "arceusice": 320,
    "arceuspoison": 320,
    "arceuspsychic": 320,
    "arceusrock": 320,
    "arceussteel": 320,
    "arceuswater": 320,
    "arghonaut": 151,
    "ariados": 33.5,
    "armaldo": 68.2,
    "aron": 60,
    "articuno": 55.4,
    "azelf": 0.3,
    "azumarill": 28.5,
    "azurill": 2,
    "bagon": 42.1,
    "baltoy": 21.5,
    "banette": 12.5,
    "barboach": 1.9,
    "bastiodon": 149.5,
    "bayleef": 15.8,
    "beautifly": 28.4,
    "beedrill": 29.5,
    "beldum": 95.2,
    "bellossom": 5.8,
    "bellsprout": 4,
    "bibarel": 31.5,
    "bidoof": 20,
    "blastoise": 85.5,
    "blaziken": 52,
    "blissey": 46.8,
    "bonsly": 15,
    "breezi": 0.6,
    "breloom": 39.2,
    "bronzong": 187,
    "bronzor": 60.5,
    "budew": 1.2,
    "buizel": 29.5,
    "bulbasaur": 6.9,
    "buneary": 5.5,
    "burmy": 3.4,
    "butterfree": 32,
    "cacnea": 51.3,
    "cacturne": 77.4,
    "camerupt": 220,
    "carnivine": 27,
    "carvanha": 20.8,
    "cascoon": 11.5,
    "castform": 0.8,
    "castformrainy": 0.8,
    "castformsnowy": 0.8,
    "castformsunny": 0.8,
    "caterpie": 2.9,
    "celebi": 5,
    "chansey": 34.6,
    "charizard": 90.5,
    "charmander": 8.5,
    "charmeleon": 19,
    "chatot": 1.9,
    "cherrim": 9.3,
    "cherrimsunshine": 9.3,
    "cherubi": 3.3,
    "chikorita": 6.4,
    "chimchar": 6.2,
    "chimecho": 1,
    "chinchou": 12,
    "chingling": 0.6,
    "clamperl": 52.5,
    "claydol": 108,
    "clefable": 40,
    "clefairy": 7.5,
    "cleffa": 3,
    "cloyster": 132.5,
    "colossoil": 683.6,
    "combee": 5.5,
    "combusken": 19.5,
    "corphish": 11.5,
    "corsola": 5,
    "cradily": 60.4,
    "cranidos": 31.5,
    "crawdaunt": 32.8,
    "cresselia": 85.6,
    "croagunk": 23,
    "crobat": 75,
    "croconaw": 25,
    "cubone": 6.5,
    "cyclohm": 59,
    "cyndaquil": 7.9,
    "darkrai": 50.5,
    "delcatty": 32.6,
    "delibird": 16,
    "deoxys": 60.8,
    "deoxysattack": 60.8,
    "deoxysdefense": 60.8,
    "deoxysspeed": 60.8,
    "dewgong": 120,
    "dialga": 683,
    "dialgaorigin": 650,
    "diglett": 0.8,
    "ditto": 4,
    "dodrio": 85.2,
    "doduo": 39.2,
    "donphan": 120,
    "dorsoil": 145,
    "dragonair": 16.5,
    "dragonite": 210,
    "drapion": 61.5,
    "dratini": 3.3,
    "drifblim": 15,
    "drifloon": 1.2,
    "drowzee": 32.4,
    "dugtrio": 33.3,
    "dunsparce": 14,
    "duohm": 19.2,
    "dusclops": 30.6,
    "dusknoir": 106.6,
    "duskull": 15,
    "dustox": 31.6,
    "eevee": 6.5,
    "ekans": 6.9,
    "electabuzz": 30,
    "electivire": 138.6,
    "electrike": 15.2,
    "electrode": 66.6,
    "elekid": 23.5,
    "embirch": 15,
    "empoleon": 84.5,
    "entei": 198,
    "espeon": 26.5,
    "exeggcute": 2.5,
    "exeggutor": 120,
    "exploud": 84,
    "farfetchd": 15,
    "fearow": 38,
    "feebas": 7.4,
    "feraligatr": 88.8,
    "fidgit": 53,
    "finneon": 7,
    "flaaffy": 13.3,
    "flarelm": 73,
    "flareon": 25,
    "floatzel": 33.5,
    "flygon": 82,
    "forretress": 125.8,
    "froslass": 26.6,
    "furret": 32.5,
    "gabite": 56,
    "gallade": 52,
    "garchomp": 95,
    "gardevoir": 48.4,
    "gastly": 0.1,
    "gastrodon": 29.9,
    "gastrodoneast": 29.9,
    "gengar": 40.5,
    "geodude": 20,
    "gible": 20.5,
    "girafarig": 41.5,
    "giratina": 750,
    "giratinaorigin": 650,
    "glaceon": 25.9,
    "glalie": 256.5,
    "glameow": 3.9,
    "gligar": 64.8,
    "gliscor": 42.5,
    "gloom": 8.6,
    "golbat": 55,
    "goldeen": 15,
    "golduck": 76.6,
    "golem": 300,
    "gorebyss": 22.6,
    "granbull": 48.7,
    "graveler": 105,
    "grimer": 30,
    "grotle": 97,
    "groudon": 950,
    "grovyle": 21.6,
    "growlithe": 19,
    "grumpig": 71.5,
    "gulpin": 10.3,
    "gyarados": 235,
    "happiny": 24.4,
    "hariyama": 253.8,
    "haunter": 0.1,
    "heatran": 430,
    "heracross": 54,
    "hippopotas": 49.5,
    "hippowdon": 300,
    "hitmonchan": 50.2,
    "hitmonlee": 49.8,
    "hitmontop": 48,
    "honchkrow": 27.3,
    "hooh": 199,
    "hoothoot": 21.2,
    "hoppip": 0.5,
    "horsea": 8,
    "houndoom": 35,
    "houndour": 10.8,
    "huntail": 27,
    "hypno": 75.6,
    "igglybuff": 1,
    "illumise": 17.7,
    "infernape": 55,
    "ivysaur": 13,
    "jigglypuff": 5.5,
    "jirachi": 1.1,
    "jolteon": 24.5,
    "jumpluff": 3,
    "jynx": 40.6,
    "kabuto": 11.5,
    "kabutops": 40.5,
    "kadabra": 56.5,
    "kakuna": 10,
    "kangaskhan": 80,
    "kecleon": 22,
    "kingdra": 152,
    "kingler": 60,
    "kirlia": 20.2,
    "kitsunoh": 51,
    "koffing": 1,
    "krabby": 6.5,
    "kricketot": 2.2,
    "kricketune": 25.5,
    "krilowatt": 10.6,
    "kyogre": 352,
    "lairon": 120,
    "lanturn": 22.5,
    "lapras": 220,
    "larvitar": 72,
    "latias": 40,
    "latios": 60,
    "leafeon": 25.5,
    "ledian": 35.6,
    "ledyba": 10.8,
    "lickilicky": 140,
    "lickitung": 65.5,
    "lileep": 23.8,
    "linoone": 32.5,
    "lombre": 32.5,
    "lopunny": 33.3,
    "lotad": 2.6,
    "loudred": 40.5,
    "lucario": 54,
    "ludicolo": 55,
    "lugia": 216,
    "lumineon": 24,
    "lunatone": 168,
    "luvdisc": 8.7,
    "luxio": 30.5,
    "luxray": 42,
    "machamp": 130,
    "machoke": 70.5,
    "machop": 19.5,
    "magby": 21.4,
    "magcargo": 55,
    "magikarp": 10,
    "magmar": 44.5,
    "magmortar": 68,
    "magnemite": 6,
    "magneton": 60,
    "magnezone": 180,
    "makuhita": 86.4,
    "mamoswine": 291,
    "manaphy": 1.4,
    "manectric": 40.2,
    "mankey": 28,
    "mantine": 220,
    "mantyke": 65,
    "mareep": 7.8,
    "marill": 8.5,
    "marowak": 45,
    "marshtomp": 28,
    "masquerain": 3.6,
    "mawile": 11.5,
    "medicham": 31.5,
    "meditite": 11.2,
    "meganium": 100.5,
    "meowth": 4.2,
    "mesprit": 0.3,
    "metagross": 550,
    "metang": 202.5,
    "metapod": 9.9,
    "mew": 4,
    "mewtwo": 122,
    "mightyena": 37,
    "milotic": 162,
    "miltank": 75.5,
    "mimejr": 13,
    "minun": 4.2,
    "misdreavus": 1,
    "mismagius": 4.4,
    "moltres": 60,
    "monferno": 22,
    "monohm": 4.1,
    "mothim": 23.3,
    "mrmime": 54.5,
    "mudkip": 7.6,
    "muk": 30,
    "munchlax": 105,
    "murkrow": 2.1,
    "natu": 2,
    "nidoking": 62,
    "nidoqueen": 60,
    "nidoranf": 7,
    "nidoranm": 9,
    "nidorina": 20,
    "nidorino": 19.5,
    "nincada": 5.5,
    "ninetales": 19.9,
    "ninjask": 12,
    "noctowl": 40.8,
    "nohface": 5.9,
    "nosepass": 97,
    "numel": 24,
    "nuzleaf": 28,
    "octillery": 28.5,
    "oddish": 5.4,
    "omanyte": 7.5,
    "omastar": 35,
    "onix": 210,
    "pachirisu": 3.9,
    "palkia": 336,
    "palkiaorigin": 650,
    "paras": 5.4,
    "parasect": 29.5,
    "pelipper": 28,
    "persian": 32,
    "phanpy": 33.5,
    "phione": 3.1,
    "pichu": 2,
    "pichuspikyeared": 2,
    "pidgeot": 39.5,
    "pidgeotto": 30,
    "pidgey": 1.8,
    "pikachu": 6,
    "piloswine": 55.8,
    "pineco": 7.2,
    "pinsir": 55,
    "piplup": 5.2,
    "plusle": 4.2,
    "politoed": 33.9,
    "poliwag": 12.4,
    "poliwhirl": 20,
    "poliwrath": 54,
    "ponyta": 30,
    "poochyena": 13.6,
    "porygon": 36.5,
    "porygon2": 32.5,
    "porygonz": 34,
    "primeape": 32,
    "prinplup": 23,
    "privatyke": 35,
    "probopass": 340,
    "protowatt": 0.1,
    "psyduck": 19.6,
    "pupitar": 152,
    "purugly": 43.8,
    "pyroak": 168,
    "quagsire": 75,
    "quilava": 19,
    "qwilfish": 3.9,
    "raichu": 30,
    "raikou": 178,
    "ralts": 6.6,
    "rampardos": 102.5,
    "rapidash": 95,
    "raticate": 18.5,
    "rattata": 3.5,
    "rayquaza": 206.5,
    "rebble": 7,
    "regice": 175,
    "regigigas": 420,
    "regirock": 230,
    "registeel": 205,
    "relicanth": 23.4,
    "remoraid": 12,
    "revenankh": 44,
    "rhydon": 120,
    "rhyhorn": 115,
    "rhyperior": 282.8,
    "riolu": 20.2,
    "roselia": 2,
    "roserade": 14.5,
    "rotom": 0.3,
    "rotomfan": 0.3,
    "rotomfrost": 0.3,
    "rotomheat": 0.3,
    "rotommow": 0.3,
    "rotomwash": 0.3,
    "sableye": 11,
    "salamence": 102.6,
    "sandshrew": 12,
    "sandslash": 29.5,
    "sceptile": 52.2,
    "scizor": 118,
    "scyther": 56,
    "seadra": 25,
    "seaking": 39,
    "sealeo": 87.6,
    "seedot": 4,
    "seel": 90,
    "sentret": 6,
    "seviper": 52.5,
    "sharpedo": 88.8,
    "shaymin": 2.1,
    "shayminsky": 5.2,
    "shedinja": 1.2,
    "shelgon": 110.5,
    "shellder": 4,
    "shellos": 6.3,
    "shelloseast": 6.3,
    "shieldon": 57,
    "shiftry": 59.6,
    "shinx": 9.5,
    "shroomish": 4.5,
    "shuckle": 20.5,
    "shuppet": 2.3,
    "silcoon": 10,
    "skarmory": 50.5,
    "skiploom": 1,
    "skitty": 11,
    "skorupi": 12,
    "skuntank": 38,
    "slaking": 130.5,
    "slakoth": 24,
    "slowbro": 78.5,
    "slowking": 79.5,
    "slowpoke": 36,
    "slugma": 35,
    "smeargle": 58,
    "smoochum": 6,
    "sneasel": 28,
    "snorlax": 460,
    "snorunt": 16.8,
    "snover": 50.5,
    "snubbull": 7.8,
    "solrock": 154,
    "spearow": 2,
    "spheal": 39.5,
    "spinarak": 8.5,
    "spinda": 5,
    "spiritomb": 108,
    "spoink": 30.6,
    "squirtle": 9,
    "stantler": 71.2,
    "staraptor": 24.9,
    "staravia": 15.5,
    "starly": 2,
    "starmie": 80,
    "staryu": 34.5,
    "steelix": 400,
    "stratagem": 45,
    "stunky": 19.2,
    "sudowoodo": 38,
    "suicune": 187,
    "sunflora": 8.5,
    "sunkern": 1.8,
    "surskit": 1.7,
    "swablu": 1.2,
    "swalot": 80,
    "swampert": 81.9,
    "swellow": 19.8,
    "swinub": 6.5,
    "syclant": 52,
    "syclar": 4,
    "tactite": 16,
    "taillow": 2.3,
    "tangela": 35,
    "tangrowth": 128.6,
    "tauros": 88.4,
    "teddiursa": 8.8,
    "tentacool": 45.5,
    "tentacruel": 55,
    "togekiss": 38,
    "togepi": 1.5,
    "togetic": 3.2,
    "torchic": 2.5,
    "torkoal": 80.4,
    "torterra": 310,
    "totodile": 9.5,
    "toxicroak": 44.4,
    "trapinch": 15,
    "treecko": 5,
    "tropius": 100,
    "turtwig": 10.2,
    "typhlosion": 79.5,
    "tyranitar": 202,
    "tyrogue": 21,
    "umbreon": 27,
    "unown": 5,
    "ursaring": 125.8,
    "uxie": 0.3,
    "vaporeon": 29,
    "venomoth": 12.5,
    "venonat": 30,
    "venusaur": 100,
    "vespiquen": 38.5,
    "vibrava": 15.3,
    "victreebel": 15.5,
    "vigoroth": 46.5,
    "vileplume": 18.6,
    "volbeat": 17.7,
    "voltorb": 10.4,
    "voodoll": 25,
    "voodoom": 75.5,
    "vulpix": 9.9,
    "wailmer": 130,
    "wailord": 398,
    "walrein": 150.6,
    "wartortle": 22.5,
    "weavile": 34,
    "weedle": 3.2,
    "weepinbell": 6.4,
    "weezing": 9.5,
    "whiscash": 23.6,
    "whismur": 16.3,
    "wigglytuff": 12,
    "wingull": 9.5,
    "wobbuffet": 28.5,
    "wooper": 8.5,
    "wormadam": 6.5,
    "wormadamsandy": 6.5,
    "wormadamtrash": 6.5,
    "wurmple": 3.6,
    "wynaut": 14,
    "xatu": 15,
    "yanma": 38,
    "yanmega": 51.5,
    "zangoose": 40.3,
    "zapdos": 52.6,
    "zigzagoon": 17.5,
    "zubat": 7.5
};

  function normalizeSpeciesName(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  function lookupWeightKg(name) {
    var w = DPP_WEIGHTKG_BY_NORMALIZED_NAME[normalizeSpeciesName(name)];
    return typeof w === 'number' ? w : 50;
  }

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
      // See DPP_WEIGHTKG_BY_NORMALIZED_NAME above — real Gen 4 weight
      // when known, falling back to a neutral 50kg default (Egg/Bad Egg,
      // and any genuinely unmatched species) only when it isn't.
      weightkg: lookupWeightKg(name),
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
