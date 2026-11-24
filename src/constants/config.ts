export const SUPPORT_WHATSAPP_NUMBER = "919489932240";
export const TRIAL_DAYS = 7;
export const OFFLINE_GRACE_DAYS = 3;
export const GOOGLE_WEB_CLIENT_ID =
  "689553390042-098885lnuko9eai7as99e10n0hu8dfom.apps.googleusercontent.com";
// On Android with @react-native-google-signin/google-signin, only GOOGLE_WEB_CLIENT_ID and google-services.json are required.
// Android identifies its OAuth client through the package + signing certificate via google-services.json.
export const GOOGLE_ANDROID_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ??
  "YOUR_GOOGLE_ANDROID_CLIENT_ID.apps.googleusercontent.com";
export const GOOGLE_IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ??
  "YOUR_GOOGLE_IOS_CLIENT_ID.apps.googleusercontent.com";
