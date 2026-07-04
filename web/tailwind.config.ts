import type { Config } from 'tailwindcss';

// 森林绿工作台 tokens（来自 design/PetScape-工作台原型.html :root）
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: '#1E4634',
        'forest-deep': '#143426',
        'forest-soft': '#2C5C46',
        paper: '#F5F2EA',
        card: '#FFFFFF',
        ink: '#24322B',
        'ink-soft': '#5C6B60',
        line: '#E2DCCD',
        wood: '#B98A5E',
        'wood-soft': '#F3E8DA',
        moss: '#7A9B6D',
        anno: '#D64533',
        amber: '#B97F24',
        'amber-soft': '#FBF3E2',
      },
      fontFamily: {
        display: ['"Songti SC"', '"STSong"', '"Noto Serif SC"', 'serif'],
        body: ['-apple-system', '"PingFang SC"', '"Helvetica Neue"', 'sans-serif'],
      },
      borderRadius: { workbench: '12px' },
      boxShadow: {
        workbench: '0 1px 2px rgba(30,50,40,.06), 0 4px 16px rgba(30,50,40,.07)',
      },
    },
  },
  plugins: [],
};
export default config;
