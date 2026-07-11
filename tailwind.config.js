/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Backgrounds (dark theme from the Taa mockup)
        base: '#14161c',
        surface: '#0d1119',
        'surface-2': '#0b0e16',
        raised: '#1b1f2a',
        border: '#2a3040',
        // Accents
        cyan: '#22d3ee',
        pink: '#ec4899',
        purple: '#a855f7',
        indigo: '#6366f1',
        'accent-green': '#34d399',
        amber: '#f59e0b',
        // Text
        ink: '#f2f4f8',
        'ink-soft': '#cdd3e0',
        muted: '#8b93a7',
        'muted-2': '#6b7488',
      },
      fontFamily: {
        sans: ['"Golos Text"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      keyframes: {
        eq: {
          '0%, 100%': { height: '30%' },
          '50%': { height: '100%' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s ease both',
      },
    },
  },
  plugins: [],
}
