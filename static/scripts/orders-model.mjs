export function normalizeOrders(orders) {
    return orders.map(order => {
        const items = order.items.map(item => ({ quantity: 1, ...item }));
        return { ...order, items, itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
            total: Math.round(items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100 };
    });
}

export function selectOrders(orders, { filter = "all", query = "", sort = "newest" } = {}) {
    const needle = query.trim().toLowerCase();
    return orders.filter(order => (filter === "all" || order.status === filter) &&
        `${order.id} ${order.statusLabel} ${order.items.map(item => item.name).join(" ")}`.toLowerCase().includes(needle))
        .sort((a, b) => sort === "oldest" ? a.timestamp - b.timestamp : sort === "highest" ? b.total - a.total : b.timestamp - a.timestamp);
}

export function summarizeOrders(orders) {
    return { spend: Math.round(orders.reduce((sum, order) => sum + order.total, 0) * 100) / 100,
        active: orders.filter(order => order.status !== "delivered").length,
        completed: orders.filter(order => order.status === "delivered").length };
}

export function receiptText(order, money) {
    return ["ProjectV sample receipt", `Order ${order.id}`, `Ordered ${order.date}`, `Status: ${order.statusLabel}`, "",
        ...order.items.map(item => `${item.name} (${item.detail}) — ${item.quantity} × ${money(item.price)} = ${money(item.price * item.quantity)}`),
        "", `Total paid: ${money(order.total)}`, "", "Preview only. Not a tax invoice."].join("\n");
}
