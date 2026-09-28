/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#FFFEF7',
          100: '#FAF8EE',
          200: '#F7F6E2',
          300: '#EBE7C5',
          400: '#D6D16B',
        },
        bakery: {
          orange: '#FA6713',
          'orange-hover': '#e3590b',
          'orange-light': '#FFF0E6',
        },
        cocoa: {
          dark: '#08091D',
          muted: '#3D3E53',
          soft: '#1E1F35',
        }
      },
      fontFamily: {
        mono: ['Space Mono', 'ui-monospace', 'monospace'],
        display: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
        body: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
