module.exports = {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        glass: "rgba(255,255,255,0.06)",
        glassLight: "rgba(255,255,255,0.4)",
      },
      boxShadow: {
        neon: "0 0 20px rgba(129, 140, 248, 0.8)",
        glow: "0 0 15px rgba(236, 72, 153, 0.6)",
      },
    },
  },
  plugins: [],
};
