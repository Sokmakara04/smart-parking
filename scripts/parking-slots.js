"use strict";

let slots = [];

const requestJson = async (url, options = {}) => {
    const response = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false || result.ok === false) {
        throw new Error(result.message || "Request failed.");
    }
    return result.data ?? result;
};

const renderParkingSlots = (rows = []) => {
    slots = rows;
    const tbody = document.querySelector(".table-section tbody");
    const thead = document.querySelector(".table-section thead");

    if (thead) {
        thead.innerHTML = `
            <tr>
                <th>Slot Number</th>
                <th>Floor</th>
                <th>Vehicle Type</th>
                <th>Price</th>
                <th>Status</th>
                <th style="width: 180px;">Action</th>
            </tr>
        `;
    }

    if (!tbody) {
        return;
    }

    tbody.innerHTML = rows.map((slot) => {
        const isOccupied = String(slot.status || "").toLowerCase() === "occupied";
        const actionHtml = isOccupied
            ? `
                <div class="action-buttons" data-row-id="${slot.slot_number || slot.slot_id || "slot"}">
                    <button class="action-btn delete-btn" type="button" data-action="checkout" data-id="${slot.slot_id || slot.slot_number || ""}" data-slot="${slot.slot_number || ""}" title="Check out ticket for ${slot.slot_number || "this slot"}" aria-label="Check out ticket for ${slot.slot_number || "this slot"}">
                        <i class="fa-solid fa-right-from-bracket"></i>
                    </button>
                </div>
            `
            : "";

        return `
            <tr>
                <td>${slot.slot_number || "N/A"}</td>
                <td>${slot.floor || "Ground Floor"}</td>
                <td>${slot.vehicle_type || "Car"}</td>
                <td>${slot.price !== undefined && slot.price !== null ? `$${Number(slot.price).toFixed(2)}` : "$0.00"}</td>
                <td><span class="status ${slot.status === "Available" ? "active" : slot.status === "Maintenance" ? "info" : "pending"}">${slot.status || "Available"}</span></td>
                <td>${actionHtml}</td>
            </tr>
        `;
    }).join("");
};

const refreshParkingSlots = async () => {
    renderParkingSlots(await requestJson("/api/parking_slots"));
};

const submitParkingSlotForm = async (payload, slot = null) => {
    const body = {
        slot_number: (payload.slot_number || "").trim(),
        floor: (payload.floor || "").trim() || "Ground Floor",
        vehicle_type: (payload.vehicle_type || "").trim() || "Car",
        status: payload.status || "Available",
        price: Number(payload.price || 0)
    };

    if (!body.slot_number) {
        throw new Error("Slot number is required.");
    }

    const url = slot ? `/api/parking_slots/${slot.slot_id}` : "/api/parking_slots";
    const method = slot ? "PUT" : "POST";
    await requestJson(url, {
        method,
        body: JSON.stringify(body)
    });
    await refreshParkingSlots();
    window.alert(slot ? "Parking slot updated successfully." : "Parking slot created successfully.");
};

const openParkingSlotEditor = (slot = null) => {
    const values = slot ? {
        slot_number: slot.slot_number || "",
        floor: slot.floor || "Ground Floor",
        vehicle_type: slot.vehicle_type || "Car",
        status: slot.status || "Available",
        price: slot.price ?? "2.00"
    } : {
        slot_number: "A-15",
        floor: "Ground Floor",
        vehicle_type: "Car",
        status: "Available",
        price: "2.00"
    };

    window.SmartParkingActions.openModal({
        title: slot ? "Edit Parking Slot" : "Add Parking Slot",
        submitLabel: slot ? "Save Changes" : "Create Slot",
        values,
        fields: [
            { name: "slot_number", label: "Slot number", value: values.slot_number },
            { name: "floor", label: "Floor", value: values.floor },
            { name: "vehicle_type", label: "Vehicle type", value: values.vehicle_type },
            { name: "price", label: "Price", value: values.price, type: "number", step: "0.01", min: 0 },
            {
                name: "status",
                label: "Status",
                type: "select",
                value: values.status,
                options: [
                    { label: "Available", value: "Available" },
                    { label: "Occupied", value: "Occupied" },
                    { label: "Reserved", value: "Reserved" },
                    { label: "Maintenance", value: "Maintenance" }
                ]
            }
        ],
        onSubmit: async (payload) => {
            await submitParkingSlotForm(payload, slot);
        }
    });
};

const bindParkingSlotActions = () => {
    const addButton = document.querySelector(".action-button");
    if (!addButton || addButton.dataset.bound === "true") {
        return;
    }
    addButton.dataset.bound = "true";
    addButton.addEventListener("click", () => openParkingSlotEditor());

    const table = document.querySelector(".table-section table");
    if (!table || table.dataset.bound === "true") {
        return;
    }
    table.dataset.bound = "true";
    table.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) {
            return;
        }

        const slotId = button.dataset.id;
        const slotNumber = button.dataset.slot || "";
        const slot = slots.find((item) => String(item.slot_id) === String(slotId) || String(item.slot_number) === String(slotNumber));

        if (!slot) {
            return;
        }

        if (button.dataset.action === "edit") {
            openParkingSlotEditor(slot);
            return;
        }

        if (button.dataset.action === "checkout") {
            try {
                const records = await requestJson("/api/parking_records");
                const activeRecord = records.find((record) => String(record.slot_number) === String(slotNumber || slot.slot_number) && String(record.status || "").toLowerCase() === "active");

                if (!activeRecord) {
                    throw new Error("No active ticket record found for this slot.");
                }

                await requestJson(`/api/parking_records/${activeRecord.record_id}/checkout`, {
                    method: "POST",
                    body: JSON.stringify({
                        check_out: new Date().toISOString().slice(0, 19).replace("T", " "),
                        status: "Completed",
                        amount: Number(activeRecord.amount || 0)
                    })
                });

                await refreshParkingSlots();
                window.alert(`Customer checked out successfully from ${slotNumber || slot.slot_number}.`);
            } catch (error) {
                window.alert(error.message || "Checkout failed.");
            }
            return;
        }

        if (button.dataset.action === "delete") {
            if (!window.SmartParkingActions.confirmDelete("Are you sure you want to delete this record?")) {
                return;
            }
            requestJson(`/api/parking_slots/${slot.slot_id}`, { method: "DELETE" })
                .then(async () => {
                    await refreshParkingSlots();
                    window.alert("Parking slot deleted successfully.");
                })
                .catch((error) => window.alert(error.message));
        }
    });
};

SmartParkingData.load()
    .then(async (data) => {
        SmartParkingData.renderPage(data, "parkingSlots");
        bindParkingSlotActions();
        await refreshParkingSlots();
    })
    .catch((error) => console.error(error));
