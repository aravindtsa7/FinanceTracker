import * as WebBrowser from 'expo-web-browser';
import { Redirect } from 'expo-router';
WebBrowser.maybeCompleteAuthSession();
export default function GoogleDriveCallback() { return <Redirect href="/(tabs)/settings" />; }
