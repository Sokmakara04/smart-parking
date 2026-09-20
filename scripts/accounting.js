"use strict";

const bindAccountingActions = async () => {
    const exportButton = document.querySelector(".action-button.secondary");
    const addButton = document.querySelectorAll(".action-button")[1] || document.querySelectorAll(".action-button")[0];

    if (exportButton && exportButton.dataset.bound !== "true") {
        exportButton.dataset.bound = "true";
        exportButton.addEventListener("click", async () => {
            window.location.href = "/api/accounting/export";
        });
    }

    if (addButton && addButton.dataset.bound !== "true") {
        addButton.dataset.bound = "true";
        addButton.addEventListener("click", async () => {
            const amount = Number.parseFloat(window.prompt("Amount:", "250.00") || "0") || 0;
            const method = window.prompt("Payment method:", "Card");
            const description = window.prompt("Description:", "Extra parking revenue");

            const response = await fetch("/api/payments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    customer_id: null,
                    contract_id: null,
                    amount,
                    payment_method: method || "Card",
                    payment_status: "Paid",
                    payment_date: new Date().toISOString(),
                    reference: `ACC-${Date.now().toString().slice(-6)}`,
                    notes: description || "Extra parking revenue"
                })
            });

            if (!response.ok) {
                const result = await response.json().catch(() => ({}));
                throw new Error(result.message || "Unable to save accounting entry to MySQL.");
            }

            window.location.reload();
        });
    }
};

SmartParkingData.load()
    .then((data) => {
        SmartParkingData.renderPage(data, "accounting");
        return bindAccountingActions();
    })
    .catch((error) => console.error(error));
