"use strict";

const startSellTicket = async () => {
    if (window.__smartParkingSellTicketBound) {
        return;
    }

    const sellTicketForm = document.getElementById("sellTicketForm");
    const scanVipCardButton = document.getElementById("scanVipCard");

    if (!sellTicketForm || !scanVipCardButton || !window.SmartParkingData) {
        return;
    }

    window.__smartParkingSellTicketBound = true;

    const data = await SmartParkingData.load();
    const page = SmartParkingData.renderPage(data, "sellTicket");
    const vipCustomers = page.vipCards || page.vipCustomers || {};
    const ticketPrices = page.ticketPrices || {};

    SmartParkingData.fillSelect("parkingSlot", page.parkingSlots);
    SmartParkingData.fillSelect("ticketType", page.ticketTypes);
    SmartParkingData.fillSelect("parkingDuration", page.durations);
    SmartParkingData.fillSelect("paymentMethod", page.paymentMethods);

    const fields = {
        vipCardInput: document.getElementById("vipCardInput"),
        plateNumber: document.getElementById("plateNumber"),
        parkingSlot: document.getElementById("parkingSlot"),
        ticketType: document.getElementById("ticketType"),
        parkingDuration: document.getElementById("parkingDuration"),
        customerName: document.getElementById("customerName"),
        customerPhone: document.getElementById("customerPhone"),
        paymentMethod: document.getElementById("paymentMethod"),
        ticketAmount: document.getElementById("ticketAmount"),
        ticketNote: document.getElementById("ticketNote"),
        saleStatus: document.getElementById("saleStatus"),
        scanState: document.getElementById("scanState"),
        vipProfile: document.getElementById("vipProfile"),
        vipStatus: document.getElementById("vipStatus"),
        vipCustomerName: document.getElementById("vipCustomerName"),
        vipPlan: document.getElementById("vipPlan"),
        vipSlot: document.getElementById("vipSlot"),
        vipStoreId: document.getElementById("vipStoreId"),
        vipCardNumber: document.getElementById("vipCardNumber"),
        vipVehicle: document.getElementById("vipVehicle"),
        vipMembership: document.getElementById("vipMembership"),
        vipValidUntil: document.getElementById("vipValidUntil"),
        vipCheckIn: document.getElementById("vipCheckIn"),
        vipCheckOut: document.getElementById("vipCheckOut"),
        vipCancel: document.getElementById("vipCancel")
    };

    const allFieldsReady = Object.values(fields).every(Boolean);

    if (!allFieldsReady) {
        return;
    }

    const setVipProfileState = (state) => {
        fields.vipProfile.classList.remove("found", "not-found");
        if (state) {
            fields.vipProfile.classList.add(state);
        }
    };

    const resetVipProfile = () => {
        setVipProfileState("");
        fields.vipStatus.textContent = "Waiting for card";
        fields.vipCustomerName.textContent = "Walk-in Customer";
        fields.vipPlan.textContent = "No VIP plan applied";
        fields.vipSlot.textContent = "Scan Store ID or Card ID";
        fields.scanState.textContent = "Scanner ready";
        fields.saleStatus.textContent = "Ready";
        if (fields.vipStoreId) fields.vipStoreId.textContent = "-";
        if (fields.vipCardNumber) fields.vipCardNumber.textContent = "-";
        if (fields.vipVehicle) fields.vipVehicle.textContent = "-";
        if (fields.vipMembership) fields.vipMembership.textContent = "-";
        if (fields.vipValidUntil) fields.vipValidUntil.textContent = "-";
    };

    const normalizeCurrencyValue = (value) => {
        const numericValue = Number.parseFloat(String(value ?? "").replace(/[^\d.-]/g, ""));
        if (!Number.isFinite(numericValue)) {
            return 0;
        }

        return Number(numericValue.toFixed(2));
    };

    const formatCurrencyValue = (value) => `$${Number(normalizeCurrencyValue(value)).toFixed(2)}`;

    const formatCurrencyInput = (value) => {
        const numericValue = normalizeCurrencyValue(value);
        return `$${Number(numericValue).toFixed(2)}`;
    };

    const setTicketAmount = (forcedValue = null) => {
        if (fields.ticketAmount.dataset.manual === "true" && forcedValue === null) {
            return;
        }

        const defaultAmount = forcedValue !== null ? forcedValue : ticketPrices[fields.ticketType.value];
        const numericAmount = normalizeCurrencyValue(defaultAmount || 0);
        fields.ticketAmount.value = formatCurrencyInput(numericAmount);
    };

    const updateVipCardDisplay = (card) => {
        fields.vipStoreId.textContent = card.store_id || card.storeId || "-";
        fields.vipCardNumber.textContent = card.card_id || card.cardId || "-";
        fields.vipVehicle.textContent = card.vehicle_info || card.plate || "-";
        fields.vipMembership.textContent = card.status || "Active";
        fields.vipValidUntil.textContent = card.parking_access || "ALLOWED";
    };

    const applyVipCustomer = async () => {
        const lookup = fields.vipCardInput.value.trim();
        if (!lookup) {
            setVipProfileState("not-found");
            fields.vipStatus.textContent = "No card entered";
            fields.vipCustomerName.textContent = "Scan required";
            fields.vipPlan.textContent = "Enter Store ID or Card ID";
            fields.vipSlot.textContent = "Example: VIP-000123 or CARD-10025";
            fields.scanState.textContent = "Waiting for card number";
            fields.saleStatus.textContent = "Card Needed";
            return;
        }

        try {
            fields.scanState.textContent = "Verifying VIP card...";
            const response = await fetch("/api/vip-cards/scan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ store_id: lookup, card_id: lookup })
            });
            const result = await response.json().catch(() => ({}));

            if (!response.ok || result.success === false || result.ok === false) {
                throw new Error(result.message || "VIP Card verification failed.");
            }

            const card = result.data?.card || result.card || result.data || {};
            const customer = result.data?.customer || result.customer || {};
            const activeSession = result.data?.activeSession || result.activeSession || null;

            setVipProfileState("found");
            fields.vipStatus.textContent = card.status === "Active" ? "VIP card verified" : "VIP card inactive";
            fields.vipCustomerName.textContent = customer.full_name || card.guest_name || "VIP Guest";
            fields.vipPlan.textContent = card.parking_access === "ALLOWED" ? "Parking Access: ALLOWED" : "Parking Access: DENIED";
            fields.vipSlot.textContent = activeSession ? `Active session: ${activeSession.slot_number || "N/A"}` : "Ready for parking access";
            fields.scanState.textContent = `Verified: ${card.store_id || lookup}`;
            fields.saleStatus.textContent = "VIP Applied";
            if (typeof updateVipCardDisplay === "function") {
                updateVipCardDisplay(card);
            }

            fields.customerName.value = customer.full_name || card.guest_name || "";
            fields.customerPhone.value = customer.phone || "";
            fields.plateNumber.value = customer.vehicle_info || card.vehicle_info || "";
            fields.ticketType.value = "VIP Guest";
            fields.ticketAmount.value = "$0.00";

            if (activeSession && activeSession.slot_number) {
                fields.parkingSlot.value = activeSession.slot_number;
            }
        } catch (error) {
            setVipProfileState("not-found");
            fields.vipStatus.textContent = "VIP card rejected";
            fields.vipCustomerName.textContent = "Card not accepted";
            fields.vipPlan.textContent = error.message || "Verification failed";
            fields.vipSlot.textContent = "Please check the card or ask staff";
            fields.scanState.textContent = "VIP card rejected";
            fields.saleStatus.textContent = "Not Found";
            if (fields.vipStoreId) fields.vipStoreId.textContent = "-";
            if (fields.vipCardNumber) fields.vipCardNumber.textContent = "-";
            if (fields.vipVehicle) fields.vipVehicle.textContent = "-";
            if (fields.vipMembership) fields.vipMembership.textContent = "-";
            if (fields.vipValidUntil) fields.vipValidUntil.textContent = "-";
        }
    };

    const checkInVipSession = async () => {
        const lookup = fields.vipCardInput.value.trim();
        if (!lookup) {
            window.alert("Please scan or enter a VIP Card ID first.");
            return;
        }

        const plateNumber = fields.plateNumber.value.trim();
        const slotNumber = fields.parkingSlot.value;
        if (!plateNumber || !slotNumber) {
            window.alert("Please enter a plate number and select a parking slot before checking in.");
            return;
        }

        try {
            const verifyResponse = await fetch("/api/vip-cards/scan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ store_id: lookup, card_id: lookup })
            });
            const verifyResult = await verifyResponse.json().catch(() => ({}));

            if (!verifyResponse.ok || verifyResult.success === false || verifyResult.ok === false) {
                throw new Error(verifyResult.message || "VIP Card is not valid for check-in.");
            }

            const activeSession = verifyResult.data?.activeSession || verifyResult.activeSession || null;
            if (activeSession && activeSession.record_id) {
                window.alert("This VIP card already has an active parking session.");
                return;
            }

            const payload = {
                customer_name: fields.customerName.value.trim() || verifyResult.data?.customer?.full_name || verifyResult.data?.card?.guest_name || "VIP Guest",
                customerPhone: fields.customerPhone.value.trim(),
                plateNumber,
                parkingSlot: slotNumber,
                ticketType: fields.ticketType.value,
                paymentMethod: fields.paymentMethod.value,
                amount: formatCurrencyValue(fields.ticketAmount.value),
                note: fields.ticketNote.value.trim(),
                store_id: lookup,
                card_id: lookup,
                status: "Active"
            };

            const response = await fetch("/api/parking_records", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const result = await response.json().catch(() => ({}));

            if (!response.ok || result.success === false || result.ok === false) {
                throw new Error(result.message || "VIP check-in could not be completed.");
            }

            window.alert("VIP check-in completed successfully.");
            fields.saleStatus.textContent = "Checked In";
            fields.scanState.textContent = "VIP check-in complete";
            fields.vipStatus.textContent = "Checked in";
        } catch (error) {
            window.alert(error.message || "VIP check-in failed.");
        }
    };

    const checkoutActiveVipSession = async () => {
        const lookup = fields.vipCardInput.value.trim();
        if (!lookup) {
            window.alert("Please scan or enter a VIP Card ID first.");
            return;
        }

        try {
            const response = await fetch("/api/vip-cards/scan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ store_id: lookup, card_id: lookup })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result.success === false || result.ok === false) {
                throw new Error(result.message || "VIP Card is not valid for checkout.");
            }

            const activeSession = result.data?.activeSession || result.activeSession || null;
            if (!activeSession || !activeSession.record_id) {
                throw new Error("No active parking session found for this VIP card.");
            }

            const confirmed = window.confirm("Confirm VIP checkout for this active parking session?");
            if (!confirmed) {
                return;
            }

            const checkoutResponse = await fetch("/api/parking/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    record_id: activeSession.record_id,
                    store_id: lookup,
                    checkout_time: new Date().toISOString().slice(0, 19).replace("T", " "),
                    amount: 0,
                    payment_method: "Cash"
                })
            });
            const checkoutResult = await checkoutResponse.json().catch(() => ({}));
            if (!checkoutResponse.ok || checkoutResult.success === false || checkoutResult.ok === false) {
                throw new Error(checkoutResult.message || "Checkout could not be completed.");
            }

            window.alert("Checkout completed successfully.");
            fields.saleStatus.textContent = "Checked Out";
            fields.scanState.textContent = "VIP checkout complete";
            fields.vipStatus.textContent = "Checked out";
        } catch (error) {
            window.alert(error.message || "Checkout failed.");
        }
    };

    const readTicketForm = () => ({
        plateNumber: fields.plateNumber.value.trim(),
        parkingSlot: fields.parkingSlot.value,
        ticketType: fields.ticketType.value,
        parkingDuration: fields.parkingDuration.value,
        customerName: fields.customerName.value.trim(),
        customerPhone: fields.customerPhone.value.trim(),
        paymentMethod: fields.paymentMethod.value,
        amount: formatCurrencyValue(fields.ticketAmount.value),
        note: fields.ticketNote.value.trim(),
        store_id: fields.vipCardInput.value.trim(),
        card_id: fields.vipCardInput.value.trim(),
        customer_id: null
    });

    const checkoutInvoiceRecord = async (recordId) => {
        if (!recordId) {
            return;
        }

        const confirmed = window.confirm("Check out this invoice and close the active parking session?");
        if (!confirmed) {
            return;
        }

        try {
            const response = await fetch(`/api/parking_records/${recordId}/checkout`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    check_out: new Date().toISOString().slice(0, 19).replace("T", " "),
                    status: "Completed",
                    amount: 0
                })
            });
            const result = await response.json().catch(() => ({}));

            if (!response.ok || result.success === false || result.ok === false) {
                throw new Error(result.message || "Invoice checkout failed.");
            }

            const invoiceCard = document.querySelector(`[data-checkout-record-id="${recordId}"]`)?.closest(".invoice-card");
            if (invoiceCard) {
                invoiceCard.remove();
            }

            fields.saleStatus.textContent = "Checked Out";
            fields.scanState.textContent = "Invoice checkout complete";
            window.alert("Invoice checked out successfully.");
        } catch (error) {
            window.alert(error.message || "Invoice checkout failed.");
        }
    };

    const checkoutAllInvoices = async () => {
        try {
            const recordsResponse = await fetch("/api/parking_records");
            const recordsResult = await recordsResponse.json().catch(() => ({}));

            if (!recordsResponse.ok || recordsResult.success === false || recordsResult.ok === false) {
                throw new Error(recordsResult.message || "Unable to load active invoices.");
            }

            const activeRecords = (recordsResult.data || []).filter((record) => String(record.status || "").toLowerCase() === "active");
            if (!activeRecords.length) {
                window.alert("There are no active invoices to check out.");
                return;
            }

            const confirmed = window.confirm(`Check out all ${activeRecords.length} active invoice(s)?`);
            if (!confirmed) {
                return;
            }

            let checkedOut = 0;
            for (const record of activeRecords) {
                const response = await fetch(`/api/parking_records/${record.record_id}/checkout`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        check_out: new Date().toISOString().slice(0, 19).replace("T", " "),
                        status: "Completed",
                        amount: Number(record.amount || 0)
                    })
                });
                const result = await response.json().catch(() => ({}));

                if (response.ok && !(result.success === false || result.ok === false)) {
                    checkedOut += 1;
                }
            }

            const invoiceGrid = document.querySelector(".invoice-grid");
            if (invoiceGrid) {
                invoiceGrid.innerHTML = "";
            }

            fields.saleStatus.textContent = "Checked Out";
            fields.scanState.textContent = `${checkedOut} invoice(s) checked out`;
            window.alert(`${checkedOut} invoice(s) checked out successfully.`);
        } catch (error) {
            window.alert(error.message || "Checkout all failed.");
        }
    };

    scanVipCardButton.addEventListener("click", applyVipCustomer);
    fields.vipCheckIn.addEventListener("click", checkInVipSession);
    fields.vipCheckOut.addEventListener("click", checkoutActiveVipSession);
    fields.vipCancel.addEventListener("click", resetVipProfile);
    fields.vipCheckIn.title = "Check in the verified VIP customer";
    fields.vipCheckOut.title = "Check out the active VIP session";

    const checkoutAllButton = document.getElementById("checkoutAllInvoices");
    if (checkoutAllButton) {
        checkoutAllButton.addEventListener("click", checkoutAllInvoices);
    }

    document.querySelector(".invoice-grid")?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-checkout-record-id]");
        if (!button) {
            return;
        }

        const recordId = Number(button.dataset.checkoutRecordId);
        if (Number.isInteger(recordId) && recordId > 0) {
            checkoutInvoiceRecord(recordId);
        }
    });

    fields.vipCardInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            applyVipCustomer();
        }
    });

    fields.ticketType.addEventListener("change", () => {
        delete fields.ticketAmount.dataset.manual;
        setTicketAmount();
    });

    fields.ticketAmount.addEventListener("input", (event) => {
        const rawValue = event.target.value;
        if (rawValue === "") {
            fields.ticketAmount.dataset.manual = "false";
            fields.ticketAmount.value = "$0.00";
            return;
        }

        const numericValue = normalizeCurrencyValue(rawValue);
        fields.ticketAmount.dataset.manual = "true";

        if (Number.isFinite(numericValue) && numericValue >= 0) {
            event.target.value = formatCurrencyInput(numericValue);
        }
    });

    sellTicketForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        fields.saleStatus.textContent = "Saving";
        fields.scanState.textContent = "Saving ticket to database";

        try {
            const result = await SmartParkingData.saveTicket(readTicketForm());
            const savedInvoice = result?.invoice || result?.invoices?.[0] || null;
            const invoiceList = result?.invoices && result.invoices.length
                ? result.invoices
                : savedInvoice
                    ? [savedInvoice]
                    : [];

            SmartParkingData.renderInvoices(invoiceList);
            fields.saleStatus.textContent = "Sold";
            fields.scanState.textContent = "Ticket saved and invoice updated";

            if (savedInvoice) {
                window.print();
            }
        } catch (error) {
            console.error(error);
            fields.saleStatus.textContent = "Error";
            fields.scanState.textContent = "Ticket save failed. Check server logs.";
        }
    });

    sellTicketForm.addEventListener("reset", () => {
        setTimeout(() => {
            fields.ticketAmount.dataset.manual = "false";
            setTicketAmount(0);
            resetVipProfile();
        }, 0);
    });

    setTicketAmount(0);
    resetVipProfile();
};

startSellTicket().catch((error) => {
    console.error(error);
});
