import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'overview',
    'installation',
    {
      type: 'category',
      label: 'Use cases',
      collapsed: false,
      items: ['hotspot-devices', 'same-network', 'current-network', 'android'],
    },
    'permissions',
    'troubleshooting',
    'api',
    'migrating',
  ],
};

export default sidebars;
