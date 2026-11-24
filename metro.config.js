const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// expo-sqlite's web worker loads its SQLite engine as a WASM asset.
config.resolver.assetExts.push('wasm');
module.exports = config;
