/**
 * addons.mozilla.org, for the two things a release needs from it.
 *
 * `web-ext sign` does the upload, and does it well. What it cannot answer is
 * "is this version already up there?" - which is the question that makes the
 * release safe to run twice. AMO takes a version number once and refuses it
 * ever after, on either channel, so a run that signed and then fell over on the
 * GitHub half of the release would wedge every run after it. This module asks
 * the API instead, and fetches the signed package back when the answer is yes.
 *
 * All of it is node's own `fetch` and `crypto`: AMO authenticates with a
 * short-lived JWT the caller signs itself, and nothing about that is worth a
 * dependency.
 *
 * The credentials come from the environment, and only from there - an argument
 * list is readable by every other process on the machine:
 *
 *   AMO_JWT_ISSUER   "JWT issuer" from addons.mozilla.org/developers/addon/api/key/
 *   AMO_JWT_SECRET   "JWT secret" from the same page, which shows it once
 *
 * `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` are read as well, since that is
 * what web-ext itself calls them and a machine set up for one should not need
 * setting up again for the other.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

const API = 'https://addons.mozilla.org/api/v5';

/**
 * The id AMO knows the add-on by, read from the manifest rather than written
 * down a second time here.
 *
 * It is the add-on's identity on the store: every version ever published is
 * filed under it, and a listing cannot be moved to another one. Nothing should
 * be able to change it in one place only.
 */
function addonId() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const id = ((manifest.browser_specific_settings || {}).gecko || {}).id;
  if (!id) {
    throw new Error('manifest.json declares no browser_specific_settings.gecko.id, '
      + 'which is what addons.mozilla.org knows the add-on by.');
  }
  return id;
}

/** The API credentials, or null where the environment carries none. */
function credentials() {
  const issuer = process.env.AMO_JWT_ISSUER || process.env.WEB_EXT_API_KEY;
  const secret = process.env.AMO_JWT_SECRET || process.env.WEB_EXT_API_SECRET;
  return issuer && secret ? { issuer, secret } : null;
}

const base64url = value => Buffer.from(value).toString('base64url');

/**
 * One request's worth of authentication.
 *
 * A fresh token per request rather than one for the run: AMO remembers the
 * `jti` of what it has seen and refuses a repeat, and it will not accept a
 * token good for more than five minutes. Both of those make a cached token a
 * puzzling 401 halfway through a release.
 */
function token({ issuer, secret }) {
  const now = Math.floor(Date.now() / 1000);
  const head = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify({
    iss: issuer,
    jti: crypto.randomBytes(8).toString('hex'),
    iat: now,
    exp: now + 300
  }));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(head + '.' + body)
    .digest('base64url');
  return head + '.' + body + '.' + signature;
}

/** A GET against the API, as the add-on's author. */
async function get(url, creds) {
  const response = await fetch(url, { headers: { Authorization: 'JWT ' + token(creds) } });
  if (!response.ok) {
    throw new Error('addons.mozilla.org answered ' + response.status + ' '
      + response.statusText + ' for ' + url
      + (response.status === 401 || response.status === 403
        ? ' - check AMO_JWT_ISSUER and AMO_JWT_SECRET, and that the key belongs to an '
          + 'author of the add-on.'
        : ''));
  }
  return response.json();
}

/**
 * The version AMO holds under this number, or null where it holds none.
 *
 * `all_with_unlisted` so the answer covers both channels: a version signed for
 * self-distribution is just as much a version number spent, and finding it here
 * is what turns a second upload into a clear message rather than a 409 out of
 * web-ext.
 */
async function versionOnAmo(version, creds) {
  let url = API + '/addons/addon/' + encodeURIComponent(addonId())
    + '/versions/?filter=all_with_unlisted';

  while (url) {
    const page = await get(url, creds);
    const found = (page.results || []).find(v => v.version === version);
    if (found) return found;
    url = page.next;
  }
  return null;
}

/**
 * The package attached to a version.
 *
 * v5 of the API carries one `file`; v4 carried a `files` array, and enough
 * still-current documentation shows the older shape that reading both costs
 * less than finding out which one answered.
 */
const fileOf = version => version.file || (version.files || [])[0] || null;

/** Whether AMO has approved a version's package and is handing it out. */
const isPublished = version => (fileOf(version) || {}).status === 'public';

/**
 * Fetches a package AMO has signed, and writes it to `dest`.
 *
 * Asked for plainly first. A published package is served from a download URL
 * rather than from the API, to anyone who asks - and a JWT sent there that is
 * anything short of perfect turns that 200 into a 401, which would be a
 * baffling way for a release to end. The signed request is the fallback, for
 * the package that is not being handed to just anyone.
 */
async function download(url, dest, creds) {
  let response = await fetch(url);
  if (response.status === 401 || response.status === 403) {
    response = await fetch(url, { headers: { Authorization: 'JWT ' + token(creds) } });
  }
  if (!response.ok) {
    throw new Error('addons.mozilla.org answered ' + response.status + ' '
      + response.statusText + ' for the signed package at ' + url);
  }
  fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
}

module.exports = { API, addonId, credentials, versionOnAmo, fileOf, isPublished, download };
