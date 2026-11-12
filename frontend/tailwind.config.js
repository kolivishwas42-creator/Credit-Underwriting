/** @type {import('tailwindcss').Config} */
// Colours resolve to the Ink & Ember tokens in src/index.css, so every existing class (bg-white, text-slate-500,
// bg-brand-600, bg-red-50 ...) follows the system light / dark setting with no per-component change.
export default {
  content: [
    "./src/agents/itr_verification/**/*.{js,ts,jsx,tsx}",
    
  ],
  theme: {
    extend: {
      colors: {
        white: 'rgb(var(--c-surface) / <alpha-value>)',
        'on-ink': 'rgb(var(--c-on-ink) / <alpha-value>)',
        ember: 'rgb(var(--c-accent) / <alpha-value>)',
        slate: { 50: 'rgb(var(--c-canvas) / <alpha-value>)', 100: 'rgb(var(--c-raised) / <alpha-value>)', 200: 'rgb(var(--c-border) / <alpha-value>)', 300: 'rgb(var(--c-border-strong) / <alpha-value>)', 400: 'rgb(var(--c-text-3) / <alpha-value>)', 500: 'rgb(var(--c-text-2) / <alpha-value>)', 600: 'rgb(var(--c-text-2) / <alpha-value>)', 700: 'rgb(var(--c-icon) / <alpha-value>)', 800: 'rgb(var(--c-text) / <alpha-value>)', 900: 'rgb(var(--c-text) / <alpha-value>)' },
        // brand = ink (creates); its focus ring / border use ember (marks)
        brand: { 50: 'rgb(var(--c-raised) / <alpha-value>)', 100: 'rgb(var(--c-accent-subtle) / <alpha-value>)', 500: 'rgb(var(--c-accent) / <alpha-value>)', 600: 'rgb(var(--c-ink) / <alpha-value>)', 700: 'rgb(var(--c-ink-hover) / <alpha-value>)' },
        red: { 50: 'rgb(var(--c-error-subtle) / <alpha-value>)', 100: 'rgb(var(--c-error-subtle) / <alpha-value>)', 200: 'rgb(var(--c-error-border) / <alpha-value>)', 500: 'rgb(var(--c-error) / <alpha-value>)', 600: 'rgb(var(--c-error) / <alpha-value>)', 700: 'rgb(var(--c-error-hover) / <alpha-value>)', 800: 'rgb(var(--c-error-text) / <alpha-value>)' },
        emerald: { 50: 'rgb(var(--c-success-subtle) / <alpha-value>)', 100: 'rgb(var(--c-success-subtle) / <alpha-value>)', 200: 'rgb(var(--c-success-border) / <alpha-value>)', 500: 'rgb(var(--c-success) / <alpha-value>)', 600: 'rgb(var(--c-success) / <alpha-value>)', 800: 'rgb(var(--c-success-text) / <alpha-value>)' },
        amber: { 50: 'rgb(var(--c-warning-subtle) / <alpha-value>)', 100: 'rgb(var(--c-warning-subtle) / <alpha-value>)', 200: 'rgb(var(--c-warning-border) / <alpha-value>)', 500: 'rgb(var(--c-warning) / <alpha-value>)', 600: 'rgb(var(--c-warning) / <alpha-value>)', 800: 'rgb(var(--c-warning-text) / <alpha-value>)' },
        orange: { 100: 'rgb(var(--c-accent-subtle) / <alpha-value>)', 200: 'rgb(var(--c-accent-border) / <alpha-value>)', 800: 'rgb(var(--c-accent-text) / <alpha-value>)' },
        indigo: { 50: 'rgb(var(--c-info-subtle) / <alpha-value>)', 100: 'rgb(var(--c-info-subtle) / <alpha-value>)', 200: 'rgb(var(--c-info-border) / <alpha-value>)', 500: 'rgb(var(--c-link) / <alpha-value>)', 600: 'rgb(var(--c-link) / <alpha-value>)', 900: 'rgb(var(--c-info-text) / <alpha-value>)' },
      },
      fontFamily: {
        sans: ['Lexend', 'Inter', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        sm: '0 1px 3px rgb(0 0 0 / 0.06)',
        md: '0 4px 12px rgb(0 0 0 / 0.10)',
        lg: '0 12px 32px rgb(0 0 0 / 0.16)',
        xl: '0 12px 32px rgb(0 0 0 / 0.16)',
      },
    },
  },
  plugins: [],
}
