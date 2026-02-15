import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          void: '#F5F3EE',
          alt: '#EDEBE5',
          card: '#FFFFFF',
          elevated: '#F9F8F5',
          hover: '#E8E6E0',
          deep: '#131517',
          'deep-alt': '#1A1C1F',
          'card-dark': '#1E2023',
        },
        eigen: {
          violet: '#7B3FE4',
          'violet-deep': '#5B21B6',
          'violet-light': '#A78BFA',
          'violet-wash': '#EDE9FE',
        },
        accent: {
          flame: '#7B3FE4',
          rose: '#A78BFA',
          gold: '#C4B5FD',
        },
        status: {
          success: '#4A9D7E',
          'success-text': '#3B7D65',
          danger: '#DC2626',
          warning: '#D97706',
          'warning-text': '#B45309',
        },
        txt: {
          primary: '#1A1A2E',
          secondary: '#55546B',
          muted: '#706F84',
          disabled: '#B8B7C8',
          'on-dark': '#FFFFFF',
          'on-dark-muted': '#878285',
          'on-dark-subtle': '#505659',
        },
        border: {
          subtle: '#E0DED8',
          hover: '#CCC9C0',
          'dark-subtle': 'rgba(255,255,255,0.08)',
        },
        code: { bg: '#F9F8F5' },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      fontSize: {
        'display-hero': ['4.5rem', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '400' }],
        'display-lg': ['3rem', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '400' }],
        'display': ['2.25rem', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '400' }],
        'heading': ['1.25rem', { lineHeight: '1.4', letterSpacing: '-0.01em', fontWeight: '500' }],
        'body-lg': ['1.0625rem', { lineHeight: '1.7', fontWeight: '400' }],
        'body': ['0.9375rem', { lineHeight: '1.7', fontWeight: '400' }],
        'label': ['0.6875rem', { lineHeight: '1.4', letterSpacing: '0.08em', fontWeight: '500' }],
        'caption': ['0.625rem', { lineHeight: '1.4', fontWeight: '500' }],
      },
      borderRadius: {
        'xl': '20px',
        '2xl': '30px',
        '3xl': '40px',
        '4xl': '48px',
        'section': '60px',
      },
      boxShadow: {
        'card': '0 1px 3px rgba(0,0,0,0.06)',
        'card-hover': '0 8px 24px rgba(0,0,0,0.08)',
        'card-float': '0 8px 35px rgba(0,0,0,0.36)',
      },
      transitionTimingFunction: {
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      transitionDuration: {
        'smooth': '500ms',
      },
      animation: {
        'fade-in': 'fadeIn 0.6s ease-out forwards',
        'marquee': 'marquee 50s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
