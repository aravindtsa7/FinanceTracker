// Firebase uses the JS SDK. The Google plugin is only needed to configure the
// iOS URL scheme; Android Google Sign-In is autolinked and uses package + SHA-1.
module.exports = ({ config }) => {
  const iosId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const configured = iosId && !iosId.startsWith('YOUR_') && iosId.endsWith('.apps.googleusercontent.com');
  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []).filter((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== '@react-native-google-signin/google-signin'),
      ...(configured ? [['@react-native-google-signin/google-signin', {
        iosUrlScheme: `com.googleusercontent.apps.${iosId.replace('.apps.googleusercontent.com', '')}`,
      }]] : []),
    ],
  };
};
