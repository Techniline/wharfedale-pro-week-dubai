/**
 * Wharfedale Pro Week Dubai: guest photo upload.
 *
 * Receives photos from the landing page and saves them into a Drive folder
 * in the account that deploys this script. Guests don't need to sign in.
 *
 * Setup: paste into script.google.com, run setup() once (approves Drive
 * access and creates the folder), then Deploy > New deployment > Web app,
 * Execute as "Me", Who has access "Anyone". Put the web app URL into
 * UPLOAD_URL in index.html.
 */

var FOLDER_NAME = 'Wharfedale Pro Week Dubai - Guest Photos';
var MAX_BYTES = 15 * 1024 * 1024;

function setup() {
  Logger.log('Photos will be saved to: ' + getFolder_().getUrl());
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.mimeType !== 'image/jpeg' || !body.data) throw new Error('Bad request');
    var bytes = Utilities.base64Decode(body.data);
    // Only accept real JPEGs (FF D8 header) under the size cap
    if (bytes.length > MAX_BYTES || bytes[0] !== -1 || bytes[1] !== -40) throw new Error('Not a valid photo');
    var name = 'Guest photo ' + Utilities.formatDate(new Date(), 'Asia/Dubai', 'yyyy-MM-dd HH.mm.ss') +
      ' ' + Utilities.getUuid().slice(0, 4) + '.jpg';
    getFolder_().createFile(Utilities.newBlob(bytes, 'image/jpeg', name));
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doGet() {
  return json_({ ok: true, service: 'wharfedale-photo-upload' });
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

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
