"use strict";

const bindReportsActions = async () => {
    const monthButton = document.querySelector(".action-button.secondary");
    const downloadButton = document.querySelectorAll(".action-button")[1] || document.querySelector(".action-button");

    if (monthButton && monthButton.dataset.bound !== "true") {
        monthButton.dataset.bound = "true";
        monthButton.addEventListener("click", async () => {
            const monthLabel = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });
            monthButton.innerHTML = '<i class="fa-solid fa-calendar-days"></i> ' + monthLabel;
            const response = await fetch(`/api/reports?start=${encodeURIComponent(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())}&end=${encodeURIComponent(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999).toISOString())}`);
            if (!response.ok) {
                throw new Error("Unable to load report data from MySQL.");
            }
            const result = await response.json();
            window.alert(`Reports are now filtered for ${monthLabel}. Total payments: $${Number(result.data.total_payments || 0).toLocaleString()}`);
        });
    }

    if (downloadButton && downloadButton.dataset.bound !== "true") {
        downloadButton.dataset.bound = "true";
        downloadButton.addEventListener("click", async () => {
            window.location.href = "/api/reports/export";
        });
    }
};

SmartParkingData.load()
    .then((data) => {
        SmartParkingData.renderPage(data, "reports");
        return bindReportsActions();
    })
    .catch((error) => console.error(error));
