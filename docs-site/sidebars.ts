import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    {
      type: 'category',
      label: 'Getting started',
      collapsed: false,
      items: ['getting-started/install', 'getting-started/first-run'],
    },
    {
      type: 'category',
      label: 'Administration',
      items: ['admin/security', 'admin/configuration'],
    },
    {
      type: 'category',
      label: 'Technical',
      link: {
        type: 'generated-index',
        description: 'How the parts of Argus connect and how each one works.',
      },
      items: [
        'technical/overview',
        'technical/request-flow',
        'technical/auth',
        'technical/backend',
        'technical/frontend',
        'technical/database',
        'technical/data-flow',
        'technical/deployment',
      ],
    },
    {
      type: 'category',
      label: 'Developers',
      items: ['dev/architecture', 'dev/local-development'],
    },
  ],
};

export default sidebars;
