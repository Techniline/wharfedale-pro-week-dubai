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

function setup() {
  var root = getFolder_();
  getSubFolder_('Framed');
  getSubFolder_('Originals');
  var moved = migrateIndexFile_();
  Logger.log('Photos will be saved to: ' + root.getUrl());
  Logger.log('Album entries: ' + allItems_().length + (moved ? ' (moved ' + moved + ' from album-index.json)' : ''));
  Logger.log(getPin_() ? 'ADMIN_PIN is set.' : 'ADMIN_PIN is NOT set yet: add it under Project Settings > Script Properties.');
}

// ---------------------------------------------------------------- GET

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'list') return json_(publicList_());
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
  if (JSON.parse(raw).c) cloudinaryDestroy_(body.id);
  else {
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

// ---------------------------------------------------------------- album entries

function saveItem_(id, it) {
  PropertiesService.getScriptProperties().setProperty(ITEM + id, JSON.stringify({ s: it.s, w: it.w, h: it.h, t: it.t, at: it.at, v: it.v || 0, c: it.c ? 1 : 0 }));
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
