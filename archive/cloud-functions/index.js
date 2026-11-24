const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString, defineBoolean } = require('firebase-functions/params');
const { randomInt, createHash, timingSafeEqual } = require('node:crypto');

initializeApp();
const db = getFirestore();
const region = 'us-central1';
const emailEnabled = defineBoolean('TRANSFER_EMAIL_ENABLED', { default: false });
const googleClientId = defineString('GOOGLE_WEB_CLIENT_ID', { default: 'YOUR_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com' });
const googleSecret = defineSecret('GOOGLE_WEB_CLIENT_SECRET');
const redirectUri = defineString('GOOGLE_DRIVE_REDIRECT_URI', {
  default: 'https://us-central1-financetracker-3cd32.cloudfunctions.net/driveOAuthCallback',
});
const webRedirectUri = defineString('GOOGLE_DRIVE_WEB_REDIRECT_URI', { default: '' });
const DAY = 86_400_000;
function identity(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  return request.auth.uid;
}
function device(request) {
  const id = request.data?.deviceId;
  if (typeof id !== 'string' || !/^TSA-[A-F0-9]{4}-[A-F0-9]{4}$/.test(id)) throw new HttpsError('invalid-argument', 'Invalid device ID.');
  return id;
}
function profileForClient(profile) {
  // OTP digests, attempts and throttling metadata stay in a separate private collection.
  return profile;
}
async function mirror(tx, profile) {
  tx.set(db.doc(`licenses/${profile.boundDeviceId}`), { ...profile, pendingDeviceTransfer: null });
}
async function syncProfile(uid, deviceId) {
  const ref = db.doc(`users/${uid}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('failed-precondition', 'Account setup is incomplete. Use Finish Account Setup.');
    const profile = snap.data();
    if (profile.boundDeviceId === deviceId) {
      profile.lastSeenAt = new Date().toISOString();
      tx.update(ref, { lastSeenAt: profile.lastSeenAt });
      await mirror(tx, profile);
    }
    return { profile: profileForClient(profile), serverTime: Date.now() };
  });
}
exports.bootstrapAccount = onCall({ region }, async (request) => {
  const uid = identity(request);
  const deviceId = device(request);
  const user = await getAuth().getUser(uid);
  const name = String(request.data?.name ?? user.displayName ?? '').trim();
  const phone = String(request.data?.phone ?? '').trim();
  if (!name || name.length > 100 || !/^\+?[\d ()-]{7,24}$/.test(phone)) {
    throw new HttpsError('invalid-argument', 'Provide your name and a valid phone number to finish setup.');
  }
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`users/${uid}`);
    const deviceRef = db.doc(`licenses/${deviceId}`);
    const [existing, license] = await Promise.all([tx.get(ref), tx.get(deviceRef)]);
    if (existing.exists) return;
    // A second email on the same device cannot restart the free trial.
    const now = Date.now();
    const prior = license.data();
    const start = prior?.trialStartsAt ?? new Date(now).toISOString();
    const end = prior?.trialEndsAt ?? new Date(now + 7 * DAY).toISOString();
    const profile = {
      uid, name, email: user.email, phone, boundDeviceId: deviceId,
      licenseStatus: 'trial', trialStartsAt: start, trialEndsAt: end,
      subscriptionExpiresAt: null, pendingDeviceTransfer: null,
      lastSeenAt: new Date(now).toISOString(), createdAt: new Date(now).toISOString(),
    };
    tx.create(ref, profile);
    await mirror(tx, profile);
  });
  return syncProfile(uid, deviceId);
});
exports.syncAccount = onCall({ region }, (request) => syncProfile(identity(request), device(request)));

function digest(uid, deviceId, code) {
  return createHash('sha256').update(`${uid}:${deviceId}:${code}`).digest('hex');
}
exports.requestDeviceTransfer = onCall({ region }, async (request) => {
  const uid = identity(request);
  const deviceId = device(request);
  const user = await getAuth().getUser(uid);
  if (!user.email) throw new HttpsError('failed-precondition', 'No email is registered for this account.');
  const code = String(randomInt(100000, 1000000));
  const now = Date.now();
  const expiresAt = new Date(now + 10 * 60_000).toISOString();
  const deliverEmail = emailEnabled.value();
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`users/${uid}`);
    const secretRef = db.doc(`deviceTransfers/${uid}`);
    const [snap, prior] = await Promise.all([tx.get(ref), tx.get(secretRef)]);
    if (!snap.exists) throw new HttpsError('not-found', 'Account setup is incomplete.');
    if (snap.data().boundDeviceId === deviceId) throw new HttpsError('failed-precondition', 'This phone is already bound.');
    if (now - (prior.data()?.requestedAt ?? 0) < 60_000) throw new HttpsError('resource-exhausted', 'Wait one minute before requesting another code.');
    tx.update(ref, { pendingDeviceTransfer: { newDeviceId: deviceId, expiresAt } });
    tx.set(secretRef, { newDeviceId: deviceId, codeHash: digest(uid, deviceId, code), expiresAt, requestedAt: now, attempts: 0, delivery: deliverEmail ? 'email' : 'admin' });
    if (deliverEmail) {
      // Firebase Trigger Email extension owns delivery. Client rules deny all mail access.
      tx.create(db.collection('mail').doc(), {
        to: user.email,
        message: { subject: 'TSA Finance Tracker device transfer code', text: `Your transfer code is ${code}. It expires in 10 minutes. New device: ${deviceId}. If you did not request this, ignore this email.` },
      });
    }
  });
  return { delivery: deliverEmail ? 'email' : 'admin' };
});
exports.verifyDeviceTransfer = onCall({ region }, async (request) => {
  const uid = identity(request);
  const deviceId = device(request);
  const code = request.data?.code;
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new HttpsError('invalid-argument', 'Enter the six-digit email code.');
  const failure = await db.runTransaction(async (tx) => {
    const ref = db.doc(`users/${uid}`);
    const secretRef = db.doc(`deviceTransfers/${uid}`);
    const [snap, secret] = await Promise.all([tx.get(ref), tx.get(secretRef)]);
    const pending = secret.data();
    if (!snap.exists || !pending || pending.newDeviceId !== deviceId || pending.delivery !== 'email'
      || Date.parse(pending.expiresAt) <= Date.now() || pending.attempts >= 5
      || snap.data().pendingDeviceTransfer?.newDeviceId !== deviceId) return 'The code has expired or the request is no longer valid. Request a new code.';
    const correct = timingSafeEqual(Buffer.from(pending.codeHash, 'hex'), Buffer.from(digest(uid, deviceId, code), 'hex'));
    if (!correct) {
      tx.update(secretRef, { attempts: pending.attempts + 1 });
      return 'Incorrect code. A maximum of five attempts is allowed.';
    }
    const profile = snap.data();
    const oldDevice = profile.boundDeviceId;
    profile.boundDeviceId = deviceId;
    profile.pendingDeviceTransfer = null;
    profile.lastSeenAt = new Date().toISOString();
    tx.update(ref, { boundDeviceId: deviceId, pendingDeviceTransfer: null, lastSeenAt: profile.lastSeenAt });
    // Preserve the old device's trial history, while recording that it has moved.
    tx.set(db.doc(`licenses/${oldDevice}`), { transferredTo: deviceId, transferredAt: profile.lastSeenAt }, { merge: true });
    await mirror(tx, profile);
    tx.delete(secretRef);
    return null;
  });
  if (failure) throw new HttpsError('permission-denied', failure);
  return syncProfile(uid, deviceId);
});

// Google requires an HTTPS redirect for a Web OAuth client. Never embed its secret in the app.
exports.driveOAuthCallback = onRequest({ region }, (req, res) => {
  const params = new URLSearchParams();
  for (const key of ['code', 'state', 'error', 'error_description']) {
    if (typeof req.query[key] === 'string') params.set(key, req.query[key]);
  }
  res.set('Cache-Control', 'no-store');
  res.redirect(302, `financetracker://google-drive?${params.toString()}`);
});
async function requireBoundAccount(request) {
  const uid = identity(request);
  const deviceId = device(request);
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists || snap.data().boundDeviceId !== deviceId) throw new HttpsError('permission-denied', 'This account is bound to another phone.');
  const p = snap.data();
  const now = Date.now();
  const valid = p.licenseStatus === 'active' ? Date.parse(p.subscriptionExpiresAt) > now
    : p.licenseStatus === 'trial' && Date.parse(p.trialStartsAt) <= now && now < Math.min(Date.parse(p.trialEndsAt), Date.parse(p.trialStartsAt) + 7 * DAY);
  if (!valid) throw new HttpsError('permission-denied', 'Refresh or activate your license before cloud sync.');
}
exports.driveToken = onCall({ region, secrets: [googleSecret] }, async (request) => {
  await requireBoundAccount(request);
  const data = request.data;
  const params = new URLSearchParams({ client_id: googleClientId.value(), client_secret: googleSecret.value() });
  if (data.grantType === 'authorization_code') {
    if (typeof data.code !== 'string' || typeof data.codeVerifier !== 'string' || data.codeVerifier.length < 43) throw new HttpsError('invalid-argument', 'Invalid OAuth code.');
    params.set('grant_type', 'authorization_code');
    params.set('code', data.code);
    params.set('code_verifier', data.codeVerifier);
    const requestedRedirect = data.redirectUri;
    if (requestedRedirect !== redirectUri.value() && (!webRedirectUri.value() || requestedRedirect !== webRedirectUri.value())) {
      throw new HttpsError('invalid-argument', 'OAuth redirect URL is not configured on the server.');
    }
    params.set('redirect_uri', requestedRedirect);
  } else if (data.grantType === 'refresh_token' && typeof data.refreshToken === 'string') {
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', data.refreshToken);
  } else throw new HttpsError('invalid-argument', 'Unsupported OAuth grant.');
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: params, signal: AbortSignal.timeout(10_000) });
  const token = await response.json();
  if (!response.ok || !token.access_token) throw new HttpsError('failed-precondition', 'Google authorization expired or was rejected. Reconnect Google Drive.');
  return { accessToken: token.access_token, refreshToken: token.refresh_token ?? null, expiresIn: token.expires_in, scope: token.scope };
});
