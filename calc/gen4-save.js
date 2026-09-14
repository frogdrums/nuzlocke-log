// Gen 4 (Diamond/Pearl/Platinum) save-file parser, targeted at Renegade
// Platinum. Reads a .sav/.dsv ArrayBuffer and returns the party and all 18
// boxes with exact IVs, EVs, nature, ability, item and moves.
//
// This is a port of tools/parse_gen4_save.py, which remains the ground-truth
// oracle: tools/fixtures/rp_save_expected.json is that script's output on the
// sample save, and this file is verified by diffing against it. If you change
// anything here, re-run that diff -- save parsing fails SILENTLY (a wrong
// offset yields plausible Pokemon, never an error), so "it looked right" is
// not verification.
//
// NOT part of the CommonJS engine bundle in CALC_BUNDLE_FILES. This file
// touches neither window.exports nor require(); it defines one global and is
// safe to load on its own. Needs window.GEN4_SAVE_ENUMS (gen4-save-data.js)
// loaded first.
(function(){
  "use strict";

  // ---- Platinum layout ----------------------------------------------------
  // Renegade Platinum uses the stock Platinum save layout: hzla's
  // initialize.js routes any title containing "Platinum" to baseGame == "Pt"
  // with save_expansion off, and the 0x20060623 block magic sits at exactly
  // the Pt block sizes in a real RP save.
  var BLOCK_MAGIC = 0x20060623;
  var SAVE_SLOT_SIZE = 0x40000;   // two interleaved save slots per file
  var GENERAL_SIZE = 0xCF2C;
  var STORAGE_SIZE = 0x121E4;
  var STORAGE_START = GENERAL_SIZE;
  var PARTY_COUNT_OFFSET = 0x9C;  // relative to the general block base
  var PARTY_DATA_OFFSET = PARTY_COUNT_OFFSET + 4;
  var BOX_DATA_OFFSET = STORAGE_START + 4;  // relative to the save-slot base
  var PARTY_PKM_SIZE = 236;
  var BOX_PKM_SIZE = 136;
  var NUM_BOXES = 18;
  var SLOTS_PER_BOX = 30;

  // Gen 4 stores stats in HP/Atk/Def/Spe/SpA/SpD order. Everything leaving
  // this file is emitted as a NAMED object ({hp,atk,def,spa,spd,spe}) instead
  // of an array, so no caller can silently mismatch the ordering -- which is
  // the single easiest way to corrupt IVs at an integration boundary.
  var STORAGE_STAT_ORDER = ["hp", "atk", "def", "spe", "spa", "spd"];

  var DESMUME_MAGIC = "|-DESMUME SAVE-|";

  function enums(){
    if(!window.GEN4_SAVE_ENUMS){
      throw new Error("gen4-save-data.js must be loaded before gen4-save.js");
    }
    return window.GEN4_SAVE_ENUMS;
  }

  // ---- container ----------------------------------------------------------
  // A .dsv is USUALLY a raw save plus a 122-byte DeSmuME footer ending in the
  // ASCII magic -- but phone emulators write plain images under the same
  // extension (the sample RP save has no footer at all). So detect the magic,
  // never assume it from the file name.
  function stripContainer(bytes){
    if(bytes.length < 64) throw new Error("File is too small to be a DS save.");
    var tailLen = Math.min(256, bytes.length);
    var tail = "";
    for(var i = bytes.length - tailLen; i < bytes.length; i++){
      tail += String.fromCharCode(bytes[i]);
    }
    var at = tail.lastIndexOf(DESMUME_MAGIC);
    if(at !== -1 && (tail.length - at) === DESMUME_MAGIC.length){
      // Footer is 122 bytes and terminates with the magic.
      var footerLen = 122;
      if(bytes.length > footerLen){
        return {
          bytes: bytes.subarray(0, bytes.length - footerLen),
          note: "stripped " + footerLen + "-byte DeSmuME footer"
        };
      }
    }
    return { bytes: bytes, note: "raw save image (no DeSmuME footer)" };
  }

  // ---- block selection ----------------------------------------------------
  function u16(b, o){ return b[o] | (b[o + 1] << 8); }
  function u32(b, o){
    return ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + (b[o + 3] * 0x1000000));
  }

  function readFooter(bytes, blockEnd){
    if(blockEnd > bytes.length || blockEnd < 0x14) return null;
    var base = blockEnd - 0x14;
    return {
      counter: u32(bytes, base + 0x04),
      size: u32(bytes, base + 0x08),
      magic: u32(bytes, base + 0x0C)
    };
  }

  // The general and storage blocks carry SEPARATE save counters and genuinely
  // can come from different save slots -- in the sample RP save the general
  // block is slot 1 and the storage block slot 0. Picking one slot outright
  // silently reads a stale party or stale boxes. (It is also why a truncated
  // save is unusable: the newer copy may live in the half that got cut.)
  function pickLiveBlocks(bytes){
    var out = {};
    var kinds = [
      { name: "general", relEnd: GENERAL_SIZE, size: GENERAL_SIZE },
      { name: "storage", relEnd: STORAGE_START + STORAGE_SIZE, size: STORAGE_SIZE }
    ];
    for(var k = 0; k < kinds.length; k++){
      var kind = kinds[k];
      var best = null;
      for(var slot = 0; slot < 2; slot++){
        var base = slot * SAVE_SLOT_SIZE;
        var foot = readFooter(bytes, base + kind.relEnd);
        if(!foot || foot.magic !== BLOCK_MAGIC || foot.size !== kind.size) continue;
        if(!best || foot.counter > best.counter){
          best = { slot: slot, base: base, counter: foot.counter };
        }
      }
      if(!best){
        throw new Error(
          "No valid Gen 4 " + kind.name + " block found. This doesn't look " +
          "like a Diamond/Pearl/Platinum save, or the file is truncated."
        );
      }
      out[kind.name] = best;
    }
    return out;
  }

  // ---- PKM decryption -----------------------------------------------------
  function decrypt(bytes, start, length, seed){
    var out = new Uint8Array(length);
    var x = seed >>> 0;
    for(var i = 0; i < length; i += 2){
      // LCRNG: x = 0x41C64E6D * x + 0x6073, take the top 16 bits. Done in
      // two 16-bit halves because JS bitwise ops are 32-bit signed and the
      // full multiply overflows the 53-bit float mantissa.
      var lo = (x & 0xFFFF) * 0x4E6D + 0x6073;
      var hi = ((x >>> 16) * 0x4E6D + (x & 0xFFFF) * 0x41C6 + (lo >>> 16)) & 0xFFFF;
      x = (((hi << 16) >>> 0) + (lo & 0xFFFF)) >>> 0;
      var key = (x >>> 16) & 0xFFFF;
      var word = u16(bytes, start + i) ^ key;
      out[i] = word & 0xFF;
      out[i + 1] = (word >>> 8) & 0xFF;
    }
    return out;
  }

  // Split the decrypted 128-byte region into logical blocks A/B/C/D.
  //
  // TWO TRAPS HERE, both of which pass the checksum and so fail silently. The
  // checksum sums all 128 bytes irrespective of their arrangement, so it
  // validates the bytes and says nothing whatsoever about the ordering.
  //
  //   1. The shift MUST be taken % 24. blockOrders has 32 entries but only
  //      indices 0-23 are correct; 27 and 28 are transposed.
  //   2. The table reads "physical position i holds logical block order[i]",
  //      NOT "logical block i lives at physical position order[i]". Those are
  //      inverse permutations and differ for 14 of the 24 orders. The other
  //      10 are self-inverse and decode identically either way -- which is
  //      exactly what makes this bug so dangerous: a sample can look almost
  //      entirely correct while every non-involution mon reports the wrong
  //      species, nickname, IVs and moves. It mis-identified the sample
  //      save's starter Turtwig as a Skitty.
  function unshuffle(block, pv){
    var order = enums().blockOrders[((pv >>> 13) & 0x1F) % 24];
    var blocks = [];
    for(var i = 0; i < 4; i++){
      blocks[order[i]] = block.subarray(i * 32, (i + 1) * 32);
    }
    return blocks;
  }

  // ---- field decoding -----------------------------------------------------
  function decodeText(raw, maxChars){
    var table = enums().textTable;
    var s = "";
    for(var i = 0; i < maxChars * 2; i += 2){
      if(i + 2 > raw.length) break;
      var ch = u16(raw, i);
      if(ch === 0xFFFF) break;
      var g = table[String(ch)];
      s += (g === undefined ? "�" : g);
    }
    return s;
  }

  function lookup(table, idx){
    return (idx >= 0 && idx < table.length) ? table[idx] : null;
  }

  function namedStats(values){
    var out = {};
    for(var i = 0; i < 6; i++) out[STORAGE_STAT_ORDER[i]] = values[i];
    return out;
  }

  function decodePkm(bytes, offset, isParty){
    var E = enums();
    var size = isParty ? PARTY_PKM_SIZE : BOX_PKM_SIZE;
    if(offset + BOX_PKM_SIZE > bytes.length) return null;

    var anyNonZero = false;
    for(var i = 0; i < BOX_PKM_SIZE; i++){
      if(bytes[offset + i] !== 0){ anyNonZero = true; break; }
    }
    if(!anyNonZero) return null;  // never-written slot

    var pv = u32(bytes, offset);
    var storedChecksum = u16(bytes, offset + 6);

    var block = decrypt(bytes, offset + 8, 0x80, storedChecksum);
    var calcChecksum = 0;
    for(var w = 0; w < 0x80; w += 2) calcChecksum = (calcChecksum + u16(block, w)) & 0xFFFF;

    var b = unshuffle(block, pv);
    var A = b[0], B = b[1], C = b[2], D = b[3];

    var speciesId = u16(A, 0);
    // The canonical Gen 4 empty-slot test is a DECRYPTED species of 0. A raw
    // all-zero byte test is not equivalent: a released slot keeps stale
    // ciphertext, which is far from zero but decrypts to species 0.
    if(speciesId === 0) return null;

    var ivWord = u32(B, 0x10);
    var ivs = [];
    for(var s = 0; s < 6; s++) ivs.push((ivWord / Math.pow(2, 5 * s)) & 0x1F);

    var evs = [];
    for(var e = 0; e < 6; e++) evs.push(A[0x10 + e]);

    var moves = [];
    for(var m = 0; m < 4; m++){
      var id = u16(B, m * 2);
      if(id) moves.push(lookup(E.sav_move_names, id) || ("#" + id));
    }

    var mon = {
      pv: pv,
      speciesId: speciesId,
      species: lookup(E.sav_pok_names, speciesId) || ("#" + speciesId),
      nickname: decodeText(C, 11),
      isNicknamed: !!((ivWord / Math.pow(2, 31)) & 1),
      isEgg: !!((ivWord / Math.pow(2, 30)) & 1),
      nature: E.natures[pv % 25],
      abilityId: A[0x0D],
      ability: lookup(E.sav_abilities, A[0x0D]),
      abilitySlot: pv & 1,
      item: lookup(E.sav_item_names, u16(A, 2)),
      moves: moves,
      ivs: namedStats(ivs),
      evs: namedStats(evs),
      exp: u32(A, 8),
      friendship: A[0x0C],
      otName: decodeText(D, 8),
      otId: u16(A, 4),
      otSid: u16(A, 6),
      metLocation: u16(D, 0x0C),
      eggLocation: u16(D, 0x0A),
      pokeball: D[0x14],
      checksumOk: calcChecksum === storedChecksum
    };

    if(isParty && offset + size <= bytes.length){
      var pstats = decrypt(bytes, offset + 0x88, 0x64, pv);
      var raw = [];
      for(var t = 0; t < 6; t++) raw.push(u16(pstats, 8 + 2 * t));
      mon.level = pstats[4];
      mon.currentHp = u16(pstats, 6);
      mon.stats = namedStats(raw);
    }

    mon.problems = validate(mon);
    return mon;
  }

  // Sanity checks, kept mainly as a tripwire for decoder bugs rather than
  // because real saves are expected to contain junk. If several of these fire
  // at once, suspect THIS FILE before concluding anything about the save --
  // that is the actual history: these same signals were first misread as an
  // in-game "Bad Egg" when the record was simply being decoded with the wrong
  // 32 bytes. Deliberately NOT checked: an OT SID of 0xFFFF, which is a
  // perfectly legal secret ID.
  function validate(mon){
    var p = [];
    if(!mon.checksumOk) p.push("checksum mismatch");
    if(mon.abilityId === 0 || !mon.ability || mon.ability === "None"){
      p.push("invalid ability id " + mon.abilityId);
    }
    if(mon.pokeball > 24) p.push("Poke Ball id " + mon.pokeball + " out of range");
    if(mon.metLocation > 3000) p.push("met location " + mon.metLocation + " implausible");
    if(mon.eggLocation > 3000) p.push("egg location " + mon.eggLocation + " implausible");
    if(mon.isNicknamed && mon.nickname.indexOf("�") !== -1){
      p.push("nickname contains undecodable characters");
    }
    var evTotal = 0, k;
    for(k in mon.evs) evTotal += mon.evs[k];
    if(evTotal > 510) p.push("EV total " + evTotal + " exceeds 510");
    for(k in mon.ivs){ if(mon.ivs[k] > 31){ p.push("IV above 31"); break; } }
    if(mon.level !== undefined && (mon.level < 1 || mon.level > 100)){
      p.push("level " + mon.level + " out of range");
    }
    return p;
  }

  // ---- entry point --------------------------------------------------------
  function parse(arrayBuffer){
    var container = stripContainer(new Uint8Array(arrayBuffer));
    var bytes = container.bytes;
    var blocks = pickLiveBlocks(bytes);

    var general = blocks.general.base;
    var storage = blocks.storage.base;

    var partyCount = u32(bytes, general + PARTY_COUNT_OFFSET);
    var party = [];
    if(partyCount >= 0 && partyCount <= 6){
      for(var i = 0; i < partyCount; i++){
        var pm = decodePkm(bytes, general + PARTY_DATA_OFFSET + i * PARTY_PKM_SIZE, true);
        if(pm){ pm.slot = i; party.push(pm); }
      }
    }

    var boxes = [];
    for(var bx = 0; bx < NUM_BOXES; bx++){
      for(var sl = 0; sl < SLOTS_PER_BOX; sl++){
        var idx = bx * SLOTS_PER_BOX + sl;
        var bm = decodePkm(bytes, storage + BOX_DATA_OFFSET + idx * BOX_PKM_SIZE, false);
        if(bm){ bm.box = bx; bm.boxSlot = sl; boxes.push(bm); }
      }
    }

    return {
      container: container.note,
      fileSize: bytes.length,
      blocks: blocks,
      partyCount: partyCount,
      party: party,
      boxes: boxes
    };
  }

  window.Gen4Save = { parse: parse };
})();
