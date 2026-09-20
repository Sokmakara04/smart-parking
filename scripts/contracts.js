"use strict";

let contracts = [];

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

const renderContracts = (rows = []) => {
    contracts = rows;
    const tbody = document.querySelector(".table-section tbody");
    const thead = document.querySelector(".table-section thead");

    if (thead) {
        thead.innerHTML = `
            <tr>
                <th>Contract ID</th>
                <th>Customer</th>
                <th>Slot</th>
                <th>End Date</th>
                <th>Status</th>
                <th style="width: 120px;">Action</th>
            </tr>
        `;
    }

    if (!tbody) {
        return;
    }

    tbody.innerHTML = rows.map((contract) => `
        <tr>
            <td>${contract.contract_id || "N/A"}</td>
            <td>${contract.customer_name || contract.customer_id || "N/A"}</td>
            <td>${contract.slot_number || contract.slot_id || "N/A"}</td>
            <td>${contract.end_date || "N/A"}</td>
            <td><span class="status ${contract.status === "Active" ? "active" : contract.status === "Expired" ? "danger" : "pending"}">${contract.status || "Active"}</span></td>
            <td>${window.SmartParkingActions.buildActionCell(contract.contract_id, contract.contract_id || "contract")}</td>
        </tr>
    `).join("");
};

const refreshContracts = async () => {
    renderContracts(await requestJson("/api/contracts"));
};

const submitContractForm = async (payload, contract = null) => {
    const body = {
        contract_id: payload.contract_id || contract?.contract_id || `CTR-${Date.now().toString().slice(-6)}`,
        customer_id: Number(payload.customer_id),
        slot_id: Number(payload.slot_id),
        start_date: payload.start_date,
        end_date: payload.end_date,
        monthly_price: Number(payload.monthly_price),
        status: payload.status || "Active",
        notes: payload.notes || ""
    };

    if (!body.contract_id || !body.customer_id || !body.slot_id || !body.start_date || !body.end_date) {
        throw new Error("Contract details are incomplete.");
    }

    const url = contract ? `/api/contracts/${contract.contract_id}` : "/api/contracts";
    const method = contract ? "PUT" : "POST";
    await requestJson(url, {
        method,
        body: JSON.stringify(body)
    });
    await refreshContracts();
    window.alert(contract ? "Contract updated successfully." : "Contract created successfully.");
};

const openContractEditor = (contract = null) => {
    const values = contract ? {
        contract_id: contract.contract_id || "",
        customer_id: contract.customer_id || "",
        slot_id: contract.slot_id || "",
        start_date: contract.start_date || "",
        end_date: contract.end_date || "",
        monthly_price: contract.monthly_price || "",
        status: contract.status || "Active",
        notes: contract.notes || ""
    } : {
        contract_id: `CTR-${Date.now().toString().slice(-6)}`,
        customer_id: "1",
        slot_id: "1",
        start_date: new Date().toISOString().slice(0, 10),
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        monthly_price: "85",
        status: "Active",
        notes: ""
    };

    window.SmartParkingActions.openModal({
        title: contract ? "Edit Contract" : "Add Contract",
        submitLabel: contract ? "Save Changes" : "Create Contract",
        values,
        fields: [
            { name: "contract_id", label: "Contract ID", value: values.contract_id, type: "text" },
            { name: "customer_id", label: "Customer ID", value: values.customer_id, type: "number", min: 1 },
            { name: "slot_id", label: "Slot ID", value: values.slot_id, type: "number", min: 1 },
            { name: "start_date", label: "Start date", value: values.start_date, type: "date" },
            { name: "end_date", label: "End date", value: values.end_date, type: "date" },
            { name: "monthly_price", label: "Monthly price", value: values.monthly_price, type: "number", step: "0.01", min: 0 },
            {
                name: "status",
                label: "Status",
                type: "select",
                value: values.status,
                options: [
                    { label: "Active", value: "Active" },
                    { label: "Pending", value: "Pending" },
                    { label: "Expiring", value: "Expiring" },
                    { label: "Expired", value: "Expired" }
                ]
            },
            { name: "notes", label: "Notes", value: values.notes, type: "textarea", fullWidth: true }
        ],
        onSubmit: async (payload) => {
            await submitContractForm(payload, contract);
        }
    });
};

const bindContractActions = () => {
    const addButton = document.querySelector(".action-button");
    if (!addButton || addButton.dataset.bound === "true") {
        return;
    }
    addButton.dataset.bound = "true";
    addButton.addEventListener("click", () => openContractEditor());

    const table = document.querySelector(".table-section table");
    if (!table || table.dataset.bound === "true") {
        return;
    }
    table.dataset.bound = "true";
    table.addEventListener("click", (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) {
            return;
        }
        const contract = contracts.find((item) => String(item.contract_id) === String(button.dataset.id));
        if (!contract) {
            return;
        }

        if (button.dataset.action === "edit") {
            openContractEditor(contract);
            return;
        }

        if (button.dataset.action === "delete") {
            if (!window.SmartParkingActions.confirmDelete("Are you sure you want to delete this record?")) {
                return;
            }
            requestJson(`/api/contracts/${contract.contract_id}`, { method: "DELETE" })
                .then(async () => {
                    await refreshContracts();
                    window.alert("Contract deleted successfully.");
                })
                .catch((error) => window.alert(error.message));
        }
    });
};

SmartParkingData.load()
    .then(async (data) => {
        SmartParkingData.renderPage(data, "contracts");
        bindContractActions();
        await refreshContracts();
    })
    .catch((error) => console.error(error));
