/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            colors: {
                // 色板走 CSS 变量，主题切换只改 index.css 里的变量值
                // 950 是页面底色，100 是最深的正文色（换主题时整体反转）
                ink: {
                    950: 'rgb(var(--ink-950) / <alpha-value>)',
                    900: 'rgb(var(--ink-900) / <alpha-value>)',
                    850: 'rgb(var(--ink-850) / <alpha-value>)',
                    800: 'rgb(var(--ink-800) / <alpha-value>)',
                    750: 'rgb(var(--ink-750) / <alpha-value>)',
                    700: 'rgb(var(--ink-700) / <alpha-value>)',
                    600: 'rgb(var(--ink-600) / <alpha-value>)',
                    500: 'rgb(var(--ink-500) / <alpha-value>)',
                    400: 'rgb(var(--ink-400) / <alpha-value>)',
                    300: 'rgb(var(--ink-300) / <alpha-value>)',
                    200: 'rgb(var(--ink-200) / <alpha-value>)',
                    100: 'rgb(var(--ink-100) / <alpha-value>)',
                },
                jade: {
                    500: 'rgb(var(--jade-500) / <alpha-value>)',
                    400: 'rgb(var(--jade-400) / <alpha-value>)',
                    600: 'rgb(var(--jade-600) / <alpha-value>)',
                },
                amber: {
                    500: 'rgb(var(--amber-500) / <alpha-value>)',
                },
            },
            fontFamily: {
                mono: ['Cascadia Code', 'Consolas', 'monospace'],
            },
            maxWidth: {
                prose: '42rem',
            },
        },
    },
    plugins: [],
};
