"use strict";

const bindSettingsActions = async () => {
    const saveButton = document.querySelector(".action-button");
    if (!saveButton || saveButton.dataset.bound === "true") {
        return;
    }

    saveButton.dataset.bound = "true";
    saveButton.addEventListener("click", async () => {
        const settings = [
            { setting_group: "Parking Rates", setting_key: "Hourly Rate", setting_value: window.prompt("Hourly rate:", "$2.00") || "$2.00" },
            { setting_group: "Parking Rates", setting_key: "Daily Max", setting_value: window.prompt("Daily max:", "$12.00") || "$12.00" },
            { setting_group: "Parking Rates", setting_key: "Monthly Pass", setting_value: window.prompt("Monthly pass:", "$85.00") || "$85.00" },
            { setting_group: "System", setting_key: "Currency", setting_value: window.prompt("Currency:", "USD") || "USD" },
            { setting_group: "System", setting_key: "Time Zone", setting_value: window.prompt("Time Zone:", "GMT+7") || "GMT+7" }
        ];

        for (const setting of settings) {
            const response = await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(setting)
            });
            if (!response.ok) {
                const result = await response.json().catch(() => ({}));
                throw new Error(result.message || "Unable to save settings to MySQL.");
            }
        }

        window.alert("Settings saved to MySQL.");
        window.location.reload();
    });
};

SmartParkingData.load()
    .then((data) => {
        SmartParkingData.renderPage(data, "settings");
        return bindSettingsActions();
    })
    .catch((error) => console.error(error));
