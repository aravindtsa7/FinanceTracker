# Firebase Spark setup: Auth, licensing and Google Drive

This implementation uses Firebase Email/Password Authentication, Cloud Firestore and strict Security Rules. **No Cloud Functions, billing account, email extension, SMTP service, OAuth client secret or token relay is required.** The superseded functions source is kept only in `archive/cloud-functions/`; it is not referenced by `firebase.json` or the app.

## 1. Publish Firestore rules

In the existing `financetracker-3cd32` project:

1. Keep Email/Password enabled under Authentication → Sign-in method.
2. Open Firestore Database → Rules.
3. Paste the complete contents of the root `firestore.rules` file and click **Publish**. Do this before registering in the new build. Do not use test-mode rules.

Alternatively, from this project directory:

```powershell
npx.cmd firebase-tools@latest login
npx.cmd firebase-tools@latest deploy --only firestore:rules --project financetracker-3cd32
```

Use `npx` instead of `npx.cmd` outside Windows. No functions deployment or `npm install --prefix functions` step is needed.

The app reads the existing `google-services.json` and uses the `com.tsa.financetracker` configuration with the Firebase JS SDK. The SQLite database file and its schema are unchanged.

## 2. Accounts, trial history and trusted time

On first signup, the app obtains Firestore server time using an owner-only `sessionChecks/{uid}.checkedAt` server timestamp. A transaction creates the private `users/{uid}` record and, if absent, `licenses/{deviceId}`. A repeat signup on the same phone reuses its original ledger dates, even with a different email. Existing ledgers cannot be updated or deleted by clients. Concurrent signups cannot create different trials for one device ID.

New Firestore dates use native **Timestamp** values so rules can enforce an exact seven-day trial and reject a future start time. The UI and SecureStore cache use normalized ISO dates. Existing admin-created ISO-string records remain readable; copying their immutable trial dates during an approved transfer is supported.

`users/{uid}` contains the name, email, phone, binding and authoritative license state. `licenses/{deviceId}` is a minimal immutable trial ledger with `deviceId`, `trialStartsAt`, `trialEndsAt`, and `createdAt`. Authenticated clients can look up a specific device ledger, including from a new account, but cannot list ledgers. Keeping contact details out of this ledger avoids exposing another account's name, email or phone during a trial lookup.

If a legacy device mirror already contains name/email/phone, rules allow only its original owner to read it. Before a different email can reuse that device, an admin should replace the mirror with only the four ledger fields above, preserving the original trial dates and creation date and using the document ID as `deviceId`. This is a Firestore metadata cleanup; SQLite is not involved. Device IDs are application-provided identifiers, not hardware attestation; factory resets, signing-key changes or a lost fallback UUID can change them.

Normal online sync writes `lastSeenAt: serverTimestamp()` and reads the committed user document from the server. That timestamp anchors license evaluation without a function or trusting the phone clock. A valid cached session opens offline without waiting for Firebase's startup network timeout. Cached access ends at the actual trial/subscription expiry or after three days without a successful server check. A backwards clock jump of more than one minute latches a lock until a successful online check. Failed/offline reads never renew the grace period.

Clients cannot change `licenseStatus`, `trialStartsAt`, `trialEndsAt`, `subscriptionExpiresAt`, identity fields or their own approval flag. Permitted updates are limited to profile contact fields, genuine server `lastSeenAt`, a transfer request, or consumption of an existing admin approval. The Firebase Console is trusted admin access and bypasses client rules.

## 3. Activate or remotely lock an account

In Firestore → `users` → the user's UID:

- To activate: set `licenseStatus` (string) to `active` and `subscriptionExpiresAt` (timestamp) to a future date/time. Both are required. A valid existing ISO string for the expiry is also supported.
- To lock: set `licenseStatus` (string) to `expired`. A future subscription date does not override this explicit lock.
- Keep trial dates and the device ledger unchanged. Editing a device ledger is not the way to activate an account.

The user taps **Check Activation Status** / **Refresh License Status**. A connected signed-in phone also observes admin license changes through its Firestore listener. An offline phone can only observe changes when it reconnects; its remaining cached access is bounded by the three-day grace period and the license expiry. Backup export remains available on the lock screen.

## 4. Approve a device transfer

The app uses **admin approval (Option B)**, with no custom OTP sender or verification secret in the client. Firebase registration email verification and password reset remain available for their usual purposes.

1. On the new phone, sign in with the existing email/password. It opens the transfer screen rather than the dashboard.
2. Tap **Save Transfer Request** or **Request Transfer via WhatsApp**. The app writes `pendingDeviceTransfer: { newDeviceId, requestedAt }`, with a Firestore server timestamp. The WhatsApp message includes the email, old device ID and new device ID.
3. Independently verify the account owner. In `users/{uid}`, leave the requested target unchanged and set **`approveTransfer` (boolean) to `true`**.
4. The user taps **Check Transfer Status**. A transaction checks that this phone is the approved target, updates `boundDeviceId`, clears `pendingDeviceTransfer`, and resets `approveTransfer` to `false`. It cannot change license or trial dates. The approval cannot be substituted or replayed.

Alternatively, an admin can directly change `boundDeviceId` to the new ID and set `pendingDeviceTransfer` to null and `approveTransfer` to false. The user then checks transfer status. The old phone logs out when it receives the new binding online. Its local finance records are retained.

If an approval was made for the wrong target, the admin must clear `approveTransfer` before the user can submit a different request. A requesting client cannot change an already-approved target.

Replace the placeholder `SUPPORT_WHATSAPP_NUMBER` in `src/constants/config.ts` before release.

## 5. Configure Google Drive without a server

Google Drive authorization is separate from Firebase Email/Password login. Enabling Firebase's Google sign-in provider is not required for this backup flow.

In the same Google Cloud project, enable the **Google Drive API**, configure the OAuth consent screen and add test users while the app is in testing. Create the following OAuth clients:

- **Web application** client: put its public ID in `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
- **Android** client: package `com.tsa.financetracker`, plus the signing certificate's SHA-1 for each development, EAS release, or Play-signed build you use. Put its ID in `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`. The native SDK selects the Android client by package + signing certificate; the Android ID is not passed as a Web client ID.
- Optional **iOS** client: use the actual app bundle identifier and set `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. `app.config.js` derives its reversed URL scheme and enables the Google config plugin when this variable is configured. Rebuild after changing it. No `GoogleService-Info.plist` is needed for this JS Firebase / explicitly configured native Google sign-in combination.

Copy `.env.example` to `.env.local` and replace the placeholder IDs. The public IDs may also be configured in `src/constants/config.ts`; for iOS use the environment variable so the build-time URL scheme matches. Never put a Google client secret or service-account key in the app.

### Android/iOS

As selected for this project, mobile uses the free native `@react-native-google-signin/google-signin` package to obtain `drive.file` access directly. It restores the approved Google account and renews access tokens through the SDK, checking that the Google account matches the saved connection before uploading. Google/OS credentials stay with the SDK; the app caches access tokens in SecureStore. It does not request server auth codes or exchange a Web client secret.

Create a **new development or release build**, for example using the existing EAS build profile. Expo Go does not contain this native module. Google Play Services must be available on Android. If access is revoked or the native SDK cannot restore authorization, reconnect in Settings. Physical-device consent and renewal must be checked with your real OAuth IDs and signing certificates.

[Expo's Google authentication guide](https://docs.expo.dev/guides/google-authentication/) recommends native Google authorization for mobile. Google's direct custom-scheme Android browser OAuth flow is unsupported, so the app does not depend on that flow or a Cloud Functions redirect relay. The free Original Google Sign-In API used by this package remains functional; its underlying legacy Android SDK is deprecated.

### Web

Web keeps `expo-auth-session/providers/google` with a standard implicit access-token request and state validation. Register the web origin and the exact `https://your-host/google-drive` redirect URI on the Web OAuth client (including the development origin/port when testing). No token exchange server is used. Web implicit tokens do not include refresh tokens: when one expires, Settings asks the user to reconnect; auto-sync never opens a consent popup on its own.

Serve web SQLite with the cross-origin isolation headers required by [Expo SQLite web setup](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/#web-setup), and verify the hosting provider's OAuth popup behavior. Mobile uses native authorization and has no redirect-hosting requirement.

### Backup behavior

Connect from Settings, then use **Sync Backup to Drive Now**. Backups are uploaded directly to Drive REST v3 as `FinanceTracker_AutoBackup.json`, with a private file property selecting the Finance Tracker UID. A saved Google connection for another UID or another Google account is never silently reused. Connections from the superseded function-based implementation require reconnection after this update.

Auto-sync is opt-in and runs while the app is open after collections, on Settings visits and foreground checks. It does not promise OS background execution after closing the app. Local collections do not wait for uploads. Failed checks/uploads leave the last successful backup intact, and later triggers retry. An empty local database cannot overwrite an existing cloud backup.

Restore downloads and validates a backup, previews customers/loans/payments/expenses, and requires explicit confirmation before the existing transactional SQLite importer replaces records. Auth, logout, licensing, transfer and upload never delete local finance records. Existing offline export/share/folder-save/import controls are preserved. All Firebase accounts using one installation still share its existing SQLite database; account changes do not silently create, clear or migrate finance tables.

## 6. Verify locally

```powershell
npx.cmd tsc --noEmit
npx.cmd expo lint
node --test tests/*.test.cjs
npx.cmd expo export --platform all
```

The Firestore emulator suite tests the actual app account transactions against the actual `firestore.rules`, including hostile writes, concurrent registrations, device-trial reuse, admin activation/lock, approved transfers and replay rejection. It requires Java 21+ and uses a **demo** project so it never touches production:

```powershell
npx.cmd firebase-tools@latest emulators:exec --only firestore --project demo-financetracker "node --test tests/firestore-rules.emulator.cjs"
```

Local tests do not publish rules or create Google credentials. Before rollout, publish the rules and test signup, airplane-mode restart, admin lock/activation, transfer between two phones, Google consent/token renewal and a confirmed restore using test data. Spark Firestore quotas still apply; monitor the Firebase usage tab as the user count grows.
