/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './windows/**/*.{html,ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      borderRadius: { dock: '24px', pill: '999px' },
      transitionTimingFunction: { ios: 'cubic-bezier(0.32, 0.72, 0, 1)' },
    },
  },
  plugins: [],
}
