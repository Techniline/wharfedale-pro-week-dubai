/**
 * Soundcheck · Wharfedale Pro Week Dubai: Live Album backend.
 *
 * - Guests upload photos from the landing page (no sign-in). Each upload is
 *   the branded framed photo plus the original.
 * - New photos are "waiting" until approved on admin.html (PIN protected),
 *   unless the team turns on Auto-approve there.
 * - The website album (index.html) and the big screen (live.html) only ever
 *   receive approved photos.
 *
 * Setup / update:
 *   1. Paste this file into script.google.com and save.
 *   2. Project Settings (gear icon) > Script Properties > add
 *      ADMIN_PIN = <your PIN>. The PIN is never stored in this file because
 *      the repository is public.
 *   3. Run setup() once, then Deploy > Manage deployments > Edit (pencil) >
 *      Version: New version > Deploy. The web app URL stays the same.
 */

var FOLDER_NAME = 'Wharfedale Pro Week Dubai - Guest Photos';
var MAX_BYTES = 15 * 1024 * 1024;
var INDEX_NAME = 'album-index.json';
var LIST_CACHE_KEY = 'approved-list';
var MAX_PIN_FAILS = 30; // per 10 minutes, then the admin page locks briefly

function setup() {
  var root = getFolder_();
  getSubFolder_('Framed');
  getSubFolder_('Originals');
  readIndex_();
  Logger.log('Photos will be saved to: ' + root.getUrl());
  Logger.log(getPin_() ? 'ADMIN_PIN is set.' : 'ADMIN_PIN is NOT set yet: add it under Project Settings > Script Properties.');
}

// ---------------------------------------------------------------- GET

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'list') return json_({ ok: true, photos: approvedList_() });
    if (p.action === 'admin') {
      checkPin_(p.pin);
      var items = readIndex_().items;
      return json_({ ok: true, photos: items.slice().reverse(), auto: isAuto_() });
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
    if (body.action === 'upload') return json_(upload_(body));
    if (body.action === 'review') return json_(review_(body));
    if (body.action === 'settings') return json_(settings_(body));
    return json_(legacyUpload_(body));
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function upload_(body) {
  var framed = jpeg_(body.framed);
  var original = body.original ? jpeg_(body.original) : null;
  var stamp = Utilities.formatDate(new Date(), 'Asia/Dubai', 'yyyy-MM-dd HH.mm.ss') + ' ' + Utilities.getUuid().slice(0, 4);

  var framedFile = getSubFolder_('Framed').createFile(Utilities.newBlob(framed, 'image/jpeg', 'Soundcheck ' + stamp + '.jpg'));
  // Unlisted link so the approval page can preview it; it is only ever
  // listed publicly once approved, and hiding a photo makes it private again.
  framedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var originalId = '';
  if (original) {
    originalId = getSubFolder_('Originals').createFile(Utilities.newBlob(original, 'image/jpeg', 'Original ' + stamp + '.jpg')).getId();
  }

  var auto = isAuto_();
  withLock_(function () {
    var idx = readIndex_();
    idx.items.push({
      id: framedFile.getId(), o: originalId, s: auto ? 'a' : 'p',
      w: Number(body.w) || 0, h: Number(body.h) || 0,
      t: Date.now(), at: auto ? Date.now() : 0
    });
    writeIndex_(idx);
  });
  if (auto) CacheService.getScriptCache().remove(LIST_CACHE_KEY);
  return { ok: true, approved: auto };
}

function review_(body) {
  checkPin_(body.pin);
  var status = body.status;
  if (['a', 'h', 'p'].indexOf(status) < 0) throw new Error('Bad status');
  var found = false;
  withLock_(function () {
    var idx = readIndex_();
    idx.items.forEach(function (it) {
      if (it.id !== body.id) return;
      found = true;
      it.s = status;
      if (status === 'a' && !it.at) it.at = Date.now();
    });
    if (found) writeIndex_(idx);
  });
  if (!found) throw new Error('Photo not found');
  var file = DriveApp.getFileById(body.id);
  if (status === 'h') file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  else file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  CacheService.getScriptCache().remove(LIST_CACHE_KEY);
  return { ok: true };
}

// Auto-approve switch on the approval page: new uploads go live immediately
function settings_(body) {
  checkPin_(body.pin);
  PropertiesService.getScriptProperties().setProperty('AUTO_APPROVE', body.auto ? '1' : '0');
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

// ---------------------------------------------------------------- helpers

function approvedList_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(LIST_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  var list = readIndex_().items
    .filter(function (it) { return it.s === 'a'; })
    .sort(function (a, b) { return b.t - a.t; })
    .map(function (it) { return { id: it.id, w: it.w, h: it.h, t: it.t, at: it.at }; });
  cache.put(LIST_CACHE_KEY, JSON.stringify(list), 10);
  return list;
}

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

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { fn(); } finally { lock.releaseLock(); }
}

function readIndex_() {
  var files = getFolder_().getFilesByName(INDEX_NAME);
  if (!files.hasNext()) {
    getFolder_().createFile(INDEX_NAME, JSON.stringify({ items: [] }), 'application/json');
    return { items: [] };
  }
  return JSON.parse(files.next().getBlob().getDataAsString());
}

function writeIndex_(idx) {
  var files = getFolder_().getFilesByName(INDEX_NAME);
  if (files.hasNext()) files.next().setContent(JSON.stringify(idx));
  else getFolder_().createFile(INDEX_NAME, JSON.stringify(idx), 'application/json');
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

function getSubFolder_(name) {
  var root = getFolder_();
  var it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
