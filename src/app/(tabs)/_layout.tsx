import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import { StyleSheet, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { NavigationTitle } from '@/components/NavigationTitle';
import { Colors } from '@/constants/theme';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';

type IconName = ComponentProps<typeof Ionicons>['name'];

function tabIcon(active: IconName, inactive: IconName) {
  return function TabBarIcon({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
    return <Ionicons name={focused ? active : inactive} size={size} color={color} />;
  };
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { compact } = useResponsiveLayout();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: Colors.navy },
        headerTintColor: Colors.textOnDark,
        headerTitle: NavigationTitle,
        tabBarActiveTintColor: Colors.emerald,
        tabBarInactiveTintColor: Colors.tabInactive,
        tabBarStyle: { backgroundColor: Colors.navy, borderTopColor: Colors.navyLight, height: 64 + insets.bottom, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 8) },
        tabBarItemStyle: { paddingHorizontal: 0, minWidth: 0 },
        tabBarLabelPosition: 'below-icon',
        tabBarAllowFontScaling: false,
        tabBarLabel: ({ children, color }) => (
          <AppText style={[styles.tabLabel, { color, fontSize: compact ? 10 : 11 }]} allowFontScaling={false}
            numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{children}</AppText>
        ),
        sceneStyle: { backgroundColor: Colors.background },
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Dashboard', tabBarIcon: tabIcon('grid', 'grid-outline') }}
      />
      <Tabs.Screen
        name="customers"
        options={{ title: 'Customers', tabBarIcon: tabIcon('people', 'people-outline') }}
      />
      <Tabs.Screen
        name="loans"
        options={{ title: 'Loans', tabBarIcon: tabIcon('cash', 'cash-outline') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Profile', tabBarIcon: tabIcon('person-circle', 'person-circle-outline') }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabLabel: { width: '100%', textAlign: 'center', fontWeight: '700', lineHeight: 16, paddingHorizontal: 2 },
});
