/**
 * Soundcheck · Wharfedale Pro Week Dubai: Live Album backend.
 *
 * - Guests upload their branded (framed) photo straight to Cloudinary from the
 *   landing page (fast, no sign-in), then register it here. Older pages that
 *   upload to Google Drive are still accepted.
 * - New photos are "waiting" until approved on admin.html (PIN protected),
 *   unless the team turns on Auto-approve there. The team can also delete a
 *   photo, which moves it to the Drive bin (restorable for 30 days).
 * - The website album (index.html) and the big screen (live.html) only ever
 *   receive approved photos.
 *
 * The album list is kept in Script Properties (one small entry per photo),
 * which is far faster than rewriting a Drive file on every upload.
 *
 * Drive backup: run startDriveBackup() once. Every 5 minutes, separately from
 * guest uploads, new Cloudinary photos are copied into the Drive "Framed"
 * folder. Deleting a photo on the approval page removes its Drive copy too.
 *
 * Slot booking (register.html): guests book one of the Immersive Audio
 * Experience slots and get a raffle number (SC-001, SC-002, ...) in order.
 * Bookings run one at a time under a lock, so a slot can never go past its
 * capacity, and the same email or phone number can never get a second number.
 * Every booking is also written to the "Soundcheck Registrations" Google Sheet.
 *
 * Setup / update:
 *   1. Paste this file into script.google.com and save.
 *   2. Project Settings > Script Properties: ADMIN_PIN = <your PIN>, and for
 *      Delete: CLOUDINARY_KEY / CLOUDINARY_SECRET (never stored in this file,
 *      because the repository is public).
 *   3. Run setup() once, then Deploy > Manage deployments > Edit (pencil) >
 *      Version: New version > Deploy. The web app URL stays the same.
 */

var FOLDER_NAME = 'Wharfedale Pro Week Dubai - Guest Photos';
var MAX_BYTES = 15 * 1024 * 1024;
var LIST_CACHE_KEY = 'approved-list';
var MAX_PIN_FAILS = 30; // per 10 minutes, then the admin page locks briefly
var ITEM = 'P_';        // Script Property prefix for album entries
var CLOUD = 'xccqslt2'; // Cloudinary cloud name (public)
var CLOUD_ID = /^(soundcheck\/)?[A-Za-z0-9_-]{6,64}$/; // Cloudinary public IDs from the soundcheck preset

var SLOT_COUNT = 4;     // Immersive Audio Experience slots
var SLOT_CAP = 30;      // guests per slot
var RAFFLE_PREFIX = 'SC-';
var RAFFLE_WINNERS = 2; // winners in the on-stage draw
var REG = 'R_';         // Script Property prefix: one entry per booking, by raffle number
var REG_EMAIL = 'RE_';  // email -> raffle number (stops repeat bookings)
var REG_PHONE = 'RP_';  // phone -> raffle number
var SLOTS_CACHE_KEY = 'slots';
var SHEET_NAME = 'Soundcheck Registrations';

function setup() {
  var root = getFolder_();
  getSubFolder_('Framed');
  getSubFolder_('Originals');
  var moved = migrateIndexFile_();
  Logger.log('Photos will be saved to: ' + root.getUrl());
  Logger.log('Album entries: ' + allItems_().length + (moved ? ' (moved ' + moved + ' from album-index.json)' : ''));
  Logger.log('Registrations sheet: ' + getSheet_().getParent().getUrl() + ' (' + allRegs_().length + ' booked)');
  Logger.log(getPin_() ? 'ADMIN_PIN is set.' : 'ADMIN_PIN is NOT set yet: add it under Project Settings > Script Properties.');
}

// ---------------------------------------------------------------- GET

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'list') return json_(publicList_());
    if (p.action === 'slots') return json_(publicSlots_());
    if (p.action === 'regs') {
      checkPin_(p.pin);
      return json_({ ok: true, regs: allRegs_().sort(function (a, b) { return a.n - b.n; }), slots: slotState_(), open: isRegOpen_(), winners: winners_(), skipped: skipped_(), maxWinners: RAFFLE_WINNERS });
    }
    if (p.action === 'admin') {
      checkPin_(p.pin);
      var items = allItems_().sort(function (a, b) { return b.t - a.t; });
      return json_({ ok: true, photos: items, auto: isAuto_() });
    }
    return json_({ ok: true, service: 'wharfedale-photo-upload' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

// ---------------------------------------------------------------- POST

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'register') return json_(register_(body));
    if (body.action === 'upload') return json_(upload_(body));
    if (body.action === 'review') return json_(review_(body));
    if (body.action === 'settings') return json_(settings_(body));
    if (body.action === 'delete') return json_(delete_(body));
    if (body.action === 'book') return json_(book_(body));
    if (body.action === 'regSettings') return json_(regSettings_(body));
    if (body.action === 'regDelete') return json_(regDelete_(body));
    if (body.action === 'winner') return json_(winner_(body));
    return json_(legacyUpload_(body));
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

// A photo the guest's phone has just uploaded to Cloudinary
function register_(body) {
  var id = String(body.id || '');
  if (!CLOUD_ID.test(id)) throw new Error('Bad photo id');
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(ITEM + id)) return { ok: true, approved: JSON.parse(props.getProperty(ITEM + id)).s === 'a' };
  var auto = isAuto_(), now = Date.now();
  saveItem_(id, { s: auto ? 'a' : 'p', w: Number(body.w) || 0, h: Number(body.h) || 0, t: now, at: auto ? now : 0, v: Number(body.v) || 0, c: 1 });
  if (auto) CacheService.getScriptCache().remove(LIST_CACHE_KEY);
  return { ok: true, approved: auto };
}

// Older page versions upload the photo itself, into Google Drive
function upload_(body) {
  var framed = jpeg_(body.framed);
  var stamp = Utilities.formatDate(new Date(), 'Asia/Dubai', 'yyyy-MM-dd HH.mm.ss') + ' ' + Utilities.getUuid().slice(0, 4);
  var file = getSubFolder_('Framed').createFile(Utilities.newBlob(framed, 'image/jpeg', 'Soundcheck ' + stamp + '.jpg'));
  // Unlisted link so the approval page can preview it; it is only ever
  // listed publicly once approved, and hiding a photo makes it private again.
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  if (body.original) {
    getSubFolder_('Originals').createFile(Utilities.newBlob(jpeg_(body.original), 'image/jpeg', 'Original ' + stamp + '.jpg'));
  }
  var auto = isAuto_(), now = Date.now();
  saveItem_(file.getId(), { s: auto ? 'a' : 'p', w: Number(body.w) || 0, h: Number(body.h) || 0, t: now, at: auto ? now : 0 });
  if (auto) CacheService.getScriptCache().remove(LIST_CACHE_KEY);
  return { ok: true, approved: auto };
}

function review_(body) {
  checkPin_(body.pin);
  var status = body.status;
  if (['a', 'h', 'p'].indexOf(status) < 0) throw new Error('Bad status');
  var raw = PropertiesService.getScriptProperties().getProperty(ITEM + body.id);
  if (!raw) throw new Error('Photo not found');
  var it = JSON.parse(raw);
  it.s = status;
  if (status === 'a' && !it.at) it.at = Date.now();
  saveItem_(body.id, it);
  if (!it.c) {
    // Drive-hosted photo from an older page: keep its sharing in step
    var file = DriveApp.getFileById(body.id);
    if (status === 'h') file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    else file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }
  CacheService.getScriptCache().remove(LIST_CACHE_KEY);
  return { ok: true };
}

// Delete from the approval page: drops the album entry and moves the file to
// the Drive bin, where it can still be restored for 30 days.
function delete_(body) {
  checkPin_(body.pin);
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(ITEM + body.id);
  if (!raw) throw new Error('Photo not found');
  var item = JSON.parse(raw);
  if (item.c) {
    cloudinaryDestroy_(body.id);
    if (item.d) { try { DriveApp.getFileById(item.d).setTrashed(true); } catch (e) { /* backup already gone */ } }
  } else {
    try { DriveApp.getFileById(body.id).setTrashed(true); } catch (e) { /* already gone from Drive */ }
  }
  props.deleteProperty(ITEM + body.id);
  CacheService.getScriptCache().remove(LIST_CACHE_KEY);
  return { ok: true };
}

// Permanently removes the image from Cloudinary (signed with the API secret)
function cloudinaryDestroy_(publicId) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('CLOUDINARY_KEY'), secret = props.getProperty('CLOUDINARY_SECRET');
  if (!key || !secret) throw new Error('Add CLOUDINARY_KEY and CLOUDINARY_SECRET in Script Properties to delete');
  var ts = Math.floor(Date.now() / 1000);
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, 'public_id=' + publicId + '&timestamp=' + ts + secret, Utilities.Charset.UTF_8);
  var sig = digest.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  var res = UrlFetchApp.fetch('https://api.cloudinary.com/v1_1/' + CLOUD + '/image/destroy', {
    method: 'post', muteHttpExceptions: true,
    payload: { public_id: publicId, timestamp: String(ts), api_key: key, signature: sig }
  });
  var out = JSON.parse(res.getContentText() || '{}');
  if (out.result !== 'ok' && out.result !== 'not found') throw new Error('Cloudinary: ' + (out.error ? out.error.message : out.result));
}

// ---------------------------------------------------------------- Drive backup

// Run once from the editor: turns on the 5-minute backup and does a first pass.
function startDriveBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupToDrive') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupToDrive').timeBased().everyMinutes(5).create();
  backupToDrive();
  Logger.log('Drive backup is on: new photos are copied every 5 minutes.');
}

// Run from the editor to switch the backup off again.
function stopDriveBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupToDrive') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Drive backup is off.');
}

// Called by the timer. Copies Cloudinary photos that have no Drive copy yet.
function backupToDrive() {
  // A cache flag rather than the script lock, so a long backup never holds up slot bookings
  var cache = CacheService.getScriptCache();
  if (cache.get('backup-running')) return; // a previous run is still going
  cache.put('backup-running', '1', 300);
  try {
    var started = Date.now(), copied = 0;
    var folder = getSubFolder_('Framed');
    var props = PropertiesService.getScriptProperties();
    var todo = allItems_().filter(function (it) { return it.c && !it.d; }).sort(function (a, b) { return a.t - b.t; });
    for (var i = 0; i < todo.length && Date.now() - started < 4 * 60 * 1000; i++) {
      var it = todo[i];
      var url = 'https://res.cloudinary.com/' + CLOUD + '/image/upload/' + (it.v ? 'v' + it.v + '/' : '') + it.id + '.jpg';
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) continue; // deleted meanwhile, or try again next run
      var name = 'Soundcheck ' + Utilities.formatDate(new Date(it.t), 'Asia/Dubai', 'yyyy-MM-dd HH.mm.ss') + ' ' + it.id.slice(-6) + '.jpg';
      var file = folder.createFile(res.getBlob().setName(name));
      // re-read so an approve/hide that happened meanwhile isn't overwritten
      var fresh = props.getProperty(ITEM + it.id);
      if (!fresh) { file.setTrashed(true); continue; } // deleted while copying
      var cur = JSON.parse(fresh);
      cur.d = file.getId();
      saveItem_(it.id, cur);
      copied++;
    }
    if (copied) Logger.log('Backed up ' + copied + ' photo(s) to Drive.');
  } finally {
    cache.remove('backup-running');
  }
}

// Auto-approve switch on the approval page: new uploads go live immediately
function settings_(body) {
  checkPin_(body.pin);
  PropertiesService.getScriptProperties().setProperty('AUTO_APPROVE', body.auto ? '1' : '0');
  CacheService.getScriptCache().remove(LIST_CACHE_KEY);
  return { ok: true, auto: !!body.auto };
}

function isAuto_() {
  return PropertiesService.getScriptProperties().getProperty('AUTO_APPROVE') === '1';
}

// Older page versions sent a single photo; keep accepting them.
function legacyUpload_(body) {
  if (body.mimeType !== 'image/jpeg' || !body.data) throw new Error('Bad request');
  var bytes = jpeg_(body.data);
  var name = 'Guest photo ' + Utilities.formatDate(new Date(), 'Asia/Dubai', 'yyyy-MM-dd HH.mm.ss') + ' ' + Utilities.getUuid().slice(0, 4) + '.jpg';
  getFolder_().createFile(Utilities.newBlob(bytes, 'image/jpeg', name));
  return { ok: true };
}

// ---------------------------------------------------------------- slot booking

// Public: how many seats are left in each slot (no guest details)
function publicSlots_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(SLOTS_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  var out = { ok: true, open: isRegOpen_(), cap: SLOT_CAP, slots: slotState_() };
  cache.put(SLOTS_CACHE_KEY, JSON.stringify(out), 10);
  return out;
}

function slotState_() {
  var taken = [];
  for (var i = 0; i < SLOT_COUNT; i++) taken.push(0);
  allRegs_().forEach(function (r) { if (r.s >= 1 && r.s <= SLOT_COUNT) taken[r.s - 1]++; });
  return taken.map(function (c, i) { return { n: i + 1, taken: c, left: Math.max(0, SLOT_CAP - c) }; });
}

function book_(body) {
  if (body.website) throw new Error('Something went wrong. Please try again.'); // hidden field only bots fill in
  var name = clean_(body.name, 80), company = clean_(body.company, 100);
  var email = String(body.email || '').trim().toLowerCase().slice(0, 120);
  var phone = normPhone_(body.phone);
  var slot = Number(body.slot);
  if (name.length < 2) throw new Error('Enter your full name.');
  if (company.length < 2) throw new Error('Enter your company name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Enter a valid email address.');
  if (!phone) throw new Error('Enter a valid phone number.');
  if (!(slot >= 1 && slot <= SLOT_COUNT && slot % 1 === 0)) throw new Error('Choose a slot.');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('Lots of people are booking right now. Please tap Book again.');
  try {
    var props = PropertiesService.getScriptProperties();
    // The same person can only ever hold one raffle number
    var byEmail = props.getProperty(REG_EMAIL + email), byPhone = props.getProperty(REG_PHONE + phone);
    if (byEmail || byPhone) {
      var mine = byEmail && byPhone && byEmail === byPhone ? getReg_(byEmail) : null;
      if (mine) return { ok: true, existing: true, ticket: ticket_(mine) };
      throw new Error(byEmail
        ? 'This email is already registered. Each guest gets one raffle number.'
        : 'This phone number is already registered. Each guest gets one raffle number.');
    }
    if (!isRegOpen_()) throw new Error('Registration is closed.');
    var state = slotState_();
    if (state[slot - 1].left <= 0) {
      return { ok: false, full: true, error: 'Slot ' + slot + ' just filled up. Please pick another slot.', slots: state };
    }
    var n = Number(props.getProperty('REG_NEXT') || 1);
    var reg = { n: n, s: slot, name: name, co: company, em: email, ph: phone, t: Date.now() };
    var batch = {};
    batch[REG + n] = JSON.stringify(reg);
    batch[REG_EMAIL + email] = String(n);
    batch[REG_PHONE + phone] = String(n);
    batch.REG_NEXT = String(n + 1);
    props.setProperties(batch);
    CacheService.getScriptCache().remove(SLOTS_CACHE_KEY);
    try { sheetAppend_(reg); } catch (e) { console.error('Sheet write failed: ' + e); } // the booking itself is already saved
    return { ok: true, ticket: ticket_(reg) };
  } finally {
    lock.releaseLock();
  }
}

function ticket_(r) {
  return { no: raffleNo_(r.n), slot: r.s, name: r.name, company: r.co };
}

function raffleNo_(n) {
  return RAFFLE_PREFIX + ('00' + n).slice(-3);
}

// Admin: open or close registration
function regSettings_(body) {
  checkPin_(body.pin);
  PropertiesService.getScriptProperties().setProperty('REG_OPEN', body.open ? '1' : '0');
  CacheService.getScriptCache().remove(SLOTS_CACHE_KEY);
  return { ok: true, open: !!body.open };
}

function isRegOpen_() {
  return PropertiesService.getScriptProperties().getProperty('REG_OPEN') !== '0';
}

// Admin: cancel a booking. The seat is freed; the raffle number is never reused.
function regDelete_(body) {
  checkPin_(body.pin);
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var props = PropertiesService.getScriptProperties();
    var r = getReg_(body.n);
    if (!r) throw new Error('Booking not found');
    props.deleteProperty(REG + r.n);
    props.deleteProperty(REG_EMAIL + r.em);
    props.deleteProperty(REG_PHONE + r.ph);
    var w = winners_().filter(function (x) { return x !== r.n; });
    props.setProperty('REG_WINNERS', JSON.stringify(w));
    CacheService.getScriptCache().remove(SLOTS_CACHE_KEY);
    try { sheetMark_(r.n, 'Cancelled'); } catch (e) { console.error('Sheet update failed: ' + e); }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// Raffle draw screen: remember winners so nobody is drawn twice. A winner who
// isn't in the room can be skipped: they leave the winners and stay out of the draw.
function winner_(body) {
  checkPin_(body.pin);
  var props = PropertiesService.getScriptProperties();
  var list = winners_(), skipped = skipped_();
  var n = Number(body.n);
  if (body.reset) { list = []; skipped = []; }
  else if (body.skip) {
    list = list.filter(function (x) { return x !== n; });
    if (skipped.indexOf(n) < 0) skipped.push(n);
  } else {
    if (!getReg_(n)) throw new Error('Booking not found');
    if (list.indexOf(n) < 0) {
      if (list.length >= RAFFLE_WINNERS) throw new Error('Both winners have already been drawn.');
      list.push(n);
    }
  }
  props.setProperty('REG_WINNERS', JSON.stringify(list));
  props.setProperty('REG_SKIPPED', JSON.stringify(skipped));
  return { ok: true, winners: list, skipped: skipped };
}

function winners_() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty('REG_WINNERS') || '[]');
}

function skipped_() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty('REG_SKIPPED') || '[]');
}

function getReg_(n) {
  var raw = PropertiesService.getScriptProperties().getProperty(REG + Number(n));
  return raw ? JSON.parse(raw) : null;
}

function allRegs_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var out = [];
  Object.keys(props).forEach(function (k) {
    if (/^R_\d+$/.test(k)) out.push(JSON.parse(props[k]));
  });
  return out;
}

function clean_(v, max) {
  return String(v || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Digits only with the country code, so "050 123 4567" and "+971 50 123 4567"
// count as the same number. Numbers starting with a single 0 are taken as UAE.
function normPhone_(v) {
  var d = String(v || '').replace(/[^\d+]/g, '');
  if (d.indexOf('+') === 0) d = d.slice(1);
  else if (d.indexOf('00') === 0) d = d.slice(2);
  else if (d.indexOf('0') === 0) d = '971' + d.slice(1);
  d = d.replace(/\D/g, '');
  return d.length >= 9 && d.length <= 15 ? '+' + d : '';
}

// The Google Sheet copy, in the same Drive folder as the photos
function getSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('REG_SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id).getSheets()[0]; } catch (e) { /* deleted; make a new one */ }
  }
  var ss = SpreadsheetApp.create(SHEET_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(getFolder_());
  var sh = ss.getSheets()[0];
  sh.setName('Bookings');
  sh.appendRow(['Raffle no', 'Slot', 'Name', 'Company', 'Email', 'Phone', 'Booked at (Dubai)', 'Status']);
  sh.getRange(1, 1, 1, 8).setFontWeight('bold');
  sh.setFrozenRows(1);
  props.setProperty('REG_SHEET_ID', ss.getId());
  return sh;
}

function sheetAppend_(r) {
  getSheet_().appendRow([raffleNo_(r.n), 'Slot ' + r.s, r.name, r.co, r.em, "'" + r.ph,
    Utilities.formatDate(new Date(r.t), 'Asia/Dubai', 'yyyy-MM-dd HH:mm:ss'), 'Booked']);
}

function sheetMark_(n, status) {
  var sh = getSheet_();
  var hit = sh.getRange('A:A').createTextFinder(raffleNo_(n)).matchEntireCell(true).findNext();
  if (hit) sh.getRange(hit.getRow(), 8).setValue(status);
}

// ---------------------------------------------------------------- album entries

function saveItem_(id, it) {
  PropertiesService.getScriptProperties().setProperty(ITEM + id, JSON.stringify({ s: it.s, w: it.w, h: it.h, t: it.t, at: it.at, v: it.v || 0, c: it.c ? 1 : 0, d: it.d || '' }));
}

function allItems_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var out = [];
  Object.keys(props).forEach(function (k) {
    if (k.indexOf(ITEM) !== 0) return;
    var it = JSON.parse(props[k]);
    it.id = k.slice(ITEM.length);
    out.push(it);
  });
  return out;
}

// What every open guest page and the big screen poll for. Cached, including the
// Auto-approve flag, so busy evenings don't run into the free Script Properties
// read quota (50,000 a day on a free Google account).
function publicList_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(LIST_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  var out = { ok: true, photos: approvedList_(), auto: isAuto_() };
  cache.put(LIST_CACHE_KEY, JSON.stringify(out), 30);
  return out;
}

function approvedList_() {
  var list = allItems_()
    .filter(function (it) { return it.s === 'a'; })
    .sort(function (a, b) { return b.t - a.t; })
    .map(function (it) { return { id: it.id, w: it.w, h: it.h, t: it.t, at: it.at, v: it.v || 0, c: it.c ? 1 : 0 }; });
  return list;
}

// One-off: move entries from the old album-index.json file into Script Properties
function migrateIndexFile_() {
  var files = getFolder_().getFilesByName('album-index.json');
  if (!files.hasNext()) return 0;
  var file = files.next();
  var idx = JSON.parse(file.getBlob().getDataAsString());
  var props = PropertiesService.getScriptProperties();
  var n = 0;
  (idx.items || []).forEach(function (it) {
    if (props.getProperty(ITEM + it.id)) return;
    saveItem_(it.id, it);
    n++;
  });
  file.setName('album-index (moved).json');
  CacheService.getScriptCache().remove(LIST_CACHE_KEY);
  return n;
}

// ---------------------------------------------------------------- helpers

function jpeg_(b64) {
  if (!b64) throw new Error('Missing photo');
  var bytes = Utilities.base64Decode(b64);
  // Only accept real JPEGs (FF D8 header) under the size cap
  if (bytes.length > MAX_BYTES || bytes[0] !== -1 || bytes[1] !== -40) throw new Error('Not a valid photo');
  return bytes;
}

function getPin_() {
  return PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '';
}

function checkPin_(pin) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('pin-fails') || 0);
  if (fails >= MAX_PIN_FAILS) throw new Error('Too many attempts. Try again in a few minutes.');
  var real = getPin_();
  if (!real || String(pin) !== real) {
    cache.put('pin-fails', String(fails + 1), 600);
    throw new Error('Wrong PIN');
  }
}

function getFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* folder deleted; make a new one */ }
  }
  var folder = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

// Framed / Originals folders, remembered in Script Properties
function getSubFolder_(name) {
  var props = PropertiesService.getScriptProperties();
  var key = 'FOLDER_' + name.toUpperCase();
  var id = props.getProperty(key);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* deleted; find or recreate */ }
  }
  var root = getFolder_();
  var it = root.getFoldersByName(name);
  var folder = it.hasNext() ? it.next() : root.createFolder(name);
  props.setProperty(key, folder.getId());
  return folder;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
