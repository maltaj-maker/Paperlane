import type { Config } from 'tailwindcss';

/**
 * Design system tokens.
 *
 * Every colour, radius and shadow lives here so branding can be re-themed
 * without touching component code (spec: "configurable design/theme system").
 * The palette is deliberately bookish: warm paper, deep ink, and a mustard
 * accent that reads as "independent bookshop", not "SaaS template".
 */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces resolve from CSS variables so runtime theming works.
        paper: {
          DEFAULT: 'rgb(var(--paper) / <alpha-value>)',
          soft: 'rgb(var(--paper-soft) / <alpha-value>)',
          sunken: 'rgb(var(--paper-sunken) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          soft: 'rgb(var(--ink-soft) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        },
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
        },
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
      },
      fontFamily: {
        // Self-hosted / system fallbacks only — no render-blocking webfonts.
        display: ['var(--font-display)', 'Iowan Old Style', 'Palatino', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      spacing: {
        // Half-steps that the design system actually uses (icon buttons and
        // compact controls). Tailwind ships 0.5–3.5 but stops there; these keep
        // component code readable instead of littered with arbitrary values.
        4.5: '1.125rem',
        5.5: '1.375rem',
        18: '4.5rem',
        22: '5.5rem',
        safe: 'env(safe-area-inset-bottom, 0px)',
      },
      minHeight: {
        // Guarantees a 44px touch target everywhere without repeating it.
        touch: '44px',
      },
      maxWidth: {
        measure: '68ch',
      },
      borderRadius: {
        xs: '0.25rem',
        card: '0.875rem',
      },
      boxShadow: {
        book: '0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px -12px rgb(0 0 0 / 0.18)',
        'book-lg': '0 2px 4px rgb(0 0 0 / 0.05), 0 24px 48px -20px rgb(0 0 0 / 0.28)',
        focus: '0 0 0 2px rgb(var(--paper)), 0 0 0 4px rgb(var(--brand-500))',
      },
      transitionTimingFunction: {
        'out-soft': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 0.3s ease-out both',
        shimmer: 'shimmer 1.6s infinite',
        'slide-in-right': 'slide-in-right 0.28s cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in': 'scale-in 0.18s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
      screens: {
        xs: '420px',
      },
    },
  },
  plugins: [],
};

export default config;
