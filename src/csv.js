import { formatCategoryLabel, formatVehicleTitle } from "./format.js";

function escapeCsv(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function rowsToCsv(rows) {
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function orderBaseColumns(order) {
  return [
    order.id,
    order.service_date || "",
    order.start_time || "",
    order.end_time || "",
    order.customer_name || "",
    formatVehicleTitle(order),
    order.problem_description || "",
    order.work_summary || "",
    order.notes || "",
    ((order.labor_total_cents || 0) / 100).toString(),
    ((order.parts_total_cents || 0) / 100).toString(),
    ((order.consumables_total_cents || 0) / 100).toString(),
    ((order.grand_total_cents || 0) / 100).toString(),
  ];
}

export function buildOrdersCsv(orders) {
  const header = [
    "order_id",
    "service_date",
    "start_time",
    "end_time",
    "customer_name",
    "vehicle",
    "problem_description",
    "work_summary",
    "notes",
    "labor_rub",
    "parts_rub",
    "consumables_rub",
    "total_rub",
    "item_category",
    "item_description",
    "item_quantity",
    "item_unit_price_rub",
    "item_total_price_rub",
  ];

  const rows = [header];

  for (const order of orders) {
    if (!order.items?.length) {
      rows.push([...orderBaseColumns(order), "", "", "", "", ""]);
      continue;
    }

    for (const item of order.items) {
      rows.push([
        ...orderBaseColumns(order),
        formatCategoryLabel(item.category),
        item.description || "",
        item.quantity ?? "",
        ((item.unit_price_cents || 0) / 100).toString(),
        ((item.total_price_cents || 0) / 100).toString(),
      ]);
    }
  }

  return rowsToCsv(rows);
}

