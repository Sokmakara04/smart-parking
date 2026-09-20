"use strict";

window.SmartParkingTheme = (() => {
    const THEME_KEY = "smartParkingTheme";
    let initialized = false;

    const normalizeButtons = () => {
        document.querySelectorAll("button:not([type])").forEach((button) => {
            button.type = "button";
        });
    };

    const applyTheme = (theme) => {
        const selectedTheme = theme === "dark" ? "dark" : "light";

        document.documentElement.setAttribute("data-theme", selectedTheme);
        if (document.body) {
            document.body.setAttribute("data-theme", selectedTheme);
        }

        document.querySelectorAll(".theme-option").forEach((button) => {
            const isActive = button.dataset.theme === selectedTheme;
            button.classList.toggle("is-active", isActive);
            button.setAttribute("aria-pressed", String(isActive));
        });

        const globalToggle = document.querySelector("[data-theme-toggle]");
        if (globalToggle) {
            const isDark = selectedTheme === "dark";
            globalToggle.classList.toggle("is-on", isDark);
            globalToggle.setAttribute("aria-pressed", String(isDark));
            const stateText = globalToggle.querySelector(".toggle-state");
            if (stateText) {
                stateText.textContent = isDark ? "On" : "Off";
            }
        }

        localStorage.setItem(THEME_KEY, selectedTheme);
        return selectedTheme;
    };

    const bindThemeToggle = () => {
        const themeButtons = document.querySelectorAll(".theme-option, [data-theme-toggle]");
        if (!themeButtons.length) {
            return;
        }

        themeButtons.forEach((button) => {
            button.addEventListener("click", () => {
                if (button.matches("[data-theme-toggle]")) {
                    const currentTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
                    applyTheme(currentTheme === "dark" ? "light" : "dark");
                    return;
                }

                applyTheme(button.dataset.theme);
            });
        });
    };

    const initialize = () => {
        if (initialized) {
            return;
        }

        initialized = true;
        normalizeButtons();
        const savedTheme = localStorage.getItem(THEME_KEY) || "light";
        applyTheme(savedTheme);
        bindThemeToggle();
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }

    return {
        applyTheme,
        bindThemeToggle
    };
})();
