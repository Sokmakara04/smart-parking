"use strict";

const renderDashboardCharts = (dashboard) => {
    if (typeof Chart === "undefined") {
        return;
    }

    const revenueChart = document.getElementById("revenueChart");
    const revenueData = dashboard.charts.revenue;

    if (revenueChart && revenueData) {
        new Chart(revenueChart, {
            type: "line",
            data: {
                labels: revenueData.labels,
                datasets: [{
                    label: revenueData.label,
                    data: revenueData.data,
                    borderWidth: 3,
                    tension: 0.4
                }]
            }
        });
    }

    const slotChart = document.getElementById("slotChart");
    const parkingStatusData = dashboard.charts.parkingStatus;

    if (slotChart && parkingStatusData) {
        new Chart(slotChart, {
            type: "doughnut",
            data: {
                labels: parkingStatusData.labels,
                datasets: [{
                    data: parkingStatusData.data
                }]
            }
        });
    }
};

const startDashboard = async () => {
    if (!window.SmartParkingData) {
        return;
    }

    const data = await SmartParkingData.load();
    const dashboard = SmartParkingData.renderPage(data, "dashboard");

    renderDashboardCharts(dashboard);
};

startDashboard().catch((error) => {
    console.error(error);
});
