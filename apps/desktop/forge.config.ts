import { resolve } from 'node:path';

import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion, type FuseConfig } from '@electron/fuses';
import type { ForgeConfig } from '@electron-forge/shared-types';

const config = {
  makers: [
    {
      config: {
        name: 'waterlily',
      },
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
    },
    {
      config: {},
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      config: {},
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
    },
    {
      config: {
        options: {
          bin: 'waterlily',
          categories: ['Utility'],
          description:
            'A local-first, provider-neutral conversation graph editor',
          genericName: 'Conversation Graph Editor',
          homepage: 'https://github.com/ValerioBelcamino/WaterLily',
          icon: resolve(import.meta.dirname, 'assets/icon.png'),
          maintainer: 'WaterLily contributors',
          name: 'waterlily',
          priority: 'optional',
          productName: 'WaterLily',
          section: 'education',
        },
      },
      name: '@electron-forge/maker-deb',
      platforms: ['linux'],
    },
  ],
  packagerConfig: {
    appBundleId: 'io.github.valeriobelcamino.waterlily',
    appCategoryType: 'public.app-category.productivity',
    asar: {
      unpack: '**/*.node',
    },
    executableName: 'waterlily',
    icon: resolve(import.meta.dirname, 'assets/icon'),
    name: 'WaterLily',
  },
  plugins: [
    new FusesPlugin({
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.WasmTrapHandlers]: true,
      strictlyRequireAllFuses: true,
      version: FuseVersion.V1,
    } satisfies FuseConfig),
  ],
} satisfies ForgeConfig;

export default config;
