/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        neonBlue: '#00c2ff',
        neonAqua: '#1fe6b7',
        neonPink: '#ff57a8',
        glass: 'rgba(255,255,255,0.06)'
      },
      boxShadow: {
        neon: '0 6px 30px rgba(0,178,255,0.10), inset 0 1px 0 rgba(255,255,255,0.02)'
      }
    }
  },
  plugins: []
}
