/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        wide: '1280px',
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        chinese: 'hsl(var(--chinese))',
        math: 'hsl(var(--math))',
        english: 'hsl(var(--english))',
        // 客户端专属暖色：只在 .client-shell 作用域下定义，后台保持中性
        ink: 'hsl(var(--ink))',
        'ink-soft': 'hsl(var(--ink-soft))',
        paper: {
          DEFAULT: 'hsl(var(--paper))',
          deep: 'hsl(var(--paper-deep))',
          card: 'hsl(var(--paper-card))',
        },
        line: 'hsl(var(--line))',
        persimmon: {
          DEFAULT: 'hsl(var(--persimmon))',
          deep: 'hsl(var(--persimmon-deep))',
          soft: 'hsl(var(--persimmon-soft))',
        },
        honey: 'hsl(var(--honey))',
        grass: 'hsl(var(--grass))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        blob: '42% 58% 46% 54% / 52% 44% 56% 48%',
      },
      fontFamily: {
        sans: [
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'system-ui',
          'sans-serif',
        ],
        round: [
          'ui-rounded',
          '"Hiragino Maru Gothic ProN"',
          '"Yuanti SC"',
          'Quicksand',
          'Nunito',
          'PingFang SC',
          'system-ui',
          'sans-serif',
        ],
        num: ['"DIN Alternate"', 'ui-rounded', 'Quicksand', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        warm: '0 10px 30px -14px hsl(22 40% 26% / 0.20)',
        'warm-lg': '0 26px 50px -28px hsl(22 40% 26% / 0.32)',
        sticker: '0 6px 0 -2px hsl(17 82% 44% / 0.16), 0 14px 26px -14px hsl(22 40% 26% / 0.30)',
        inset: 'inset 0 1px 0 hsl(0 0% 100% / 0.6)',
      },
      keyframes: {
        pop: {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '60%': { transform: 'scale(1.03)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        fall: {
          '0%': { transform: 'translateY(-10vh) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translateY(85vh) rotate(360deg)', opacity: '0' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(16px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-in-left': {
          '0%': { transform: 'translateX(-12px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'bounce-in': {
          '0%': { transform: 'scale(0.55)', opacity: '0' },
          '62%': { transform: 'scale(1.09)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'bounce-gentle': {
          '0%,100%': { transform: 'translateY(0) rotate(-1deg)' },
          '50%': { transform: 'translateY(-9px) rotate(1deg)' },
        },
        tilt: {
          '0%,100%': { transform: 'rotate(-1.4deg)' },
          '50%': { transform: 'rotate(1.4deg)' },
        },
        wiggle: {
          '0%,100%': { transform: 'rotate(-11deg)' },
          '50%': { transform: 'rotate(11deg)' },
        },
        'draw-stroke': {
          '0%': { strokeDashoffset: '300' },
          '100%': { strokeDashoffset: '0' },
        },
        'sweep-x': {
          '0%': { transform: 'translateX(-120%)' },
          '100%': { transform: 'translateX(320%)' },
        },
        'grow-y': {
          '0%': { transform: 'scaleY(0)' },
          '100%': { transform: 'scaleY(1)' },
        },
      },
      animation: {
        pop: 'pop 0.28s cubic-bezier(.22,1,.36,1)',
        float: 'float 2.4s ease-in-out infinite',
        fall: 'fall 2.6s linear forwards',
        'slide-up': 'slide-up 0.44s cubic-bezier(.22,1,.36,1) both',
        'slide-in-left': 'slide-in-left 0.36s cubic-bezier(.22,1,.36,1) both',
        'bounce-in': 'bounce-in 0.52s cubic-bezier(.22,1,.36,1) both',
        'bounce-gentle': 'bounce-gentle 3.2s ease-in-out infinite',
        tilt: 'tilt 3.6s ease-in-out infinite',
        wiggle: 'wiggle 0.9s ease-in-out infinite',
        draw: 'draw-stroke 0.7s cubic-bezier(.22,1,.36,1) both',
        sweep: 'sweep-x 1.4s ease-in-out infinite',
        'grow-y': 'grow-y 0.5s cubic-bezier(.22,1,.36,1) both',
      },
    },
  },
  plugins: [],
}
