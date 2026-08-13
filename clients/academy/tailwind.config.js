// tailwind.config.js
module.exports = {
    content: [
        "./app/**/*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    safelist: [
        // Explicitly safelist only the exact classes needed for the CEO Skills card
        // to avoid accidentally pulling in conflicting styles.
        'bg-gradient-to-br',
        'from-indigo-500',
        'to-blue-500',
        'border-indigo-300',
        // We also need to ensure the standard colors for other cards are available if they aren't being picked up,
        // but usually Tailwind picks them up from content scanning.
        // If other cards break, we can add them here explicitly.
    ],
    theme: {
        extend: {
            colors: {
                indigo: {
                    50: "#eef2ff",
                    100: "#e0e7ff",
                    200: "#c7d2fe",
                    300: "#a5b4fc",
                    400: "#818cf8",
                    500: "#6366f1",
                    600: "#4f46e5",
                    700: "#4338ca",
                    800: "#3730a3",
                    900: "#312e81",
                },
            },
            gradientColorStops: {
                // Ensure indigo gradients work in all contexts
                indigo: {
                    50: "#eef2ff",
                    100: "#e0e7ff",
                    200: "#c7d2fe",
                    300: "#a5b4fc",
                    400: "#818cf8",
                    500: "#6366f1",
                    600: "#4f46e5",
                    700: "#4338ca",
                    800: "#3730a3",
                    900: "#312e81",
                },
            },
        },
    },
    plugins: [require("tailwindcss-rtl")],
};
