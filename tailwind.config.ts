import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        grove: {
          ink: '#1a2e1f',
          moss: '#4e9e6a',
          leaf: '#6cc98a',
          mint: '#9de0b8',
          clay: '#7a8a7d',
          paper: '#f6f4ee',
        },
      },
      fontFamily: {
        display: ['"Clash Display"', 'ui-sans-serif', 'system-ui'],
        sans: ['"General Sans"', 'ui-sans-serif', 'system-ui'],
        mono: ['"DM Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
