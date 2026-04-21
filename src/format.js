export function formatMoney(cents) {
  const amount = (cents || 0) / 100;

  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "RUB",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(Number.isInteger(amount) ? 0 : 2)} RUB`;
  }
}

export function formatCustomerLine(customer) {
  const phone = customer.phone ? `, ${customer.phone}` : "";
  return `#${customer.id} ${customer.name}${phone}`;
}

export function formatVehicleTitle(vehicle) {
  const bits = [vehicle.make, vehicle.model].filter(Boolean).join(" ").trim();
  const plate = vehicle.plate ? ` [${vehicle.plate}]` : "";
  const vin = vehicle.vin ? ` VIN ${vehicle.vin}` : "";
  const label = bits || vehicle.nickname || "Автомобиль";
  return `${label}${plate}${vin}`;
}

export function formatCategoryLabel(category) {
  if (category === "labor") {
    return "Работы";
  }
  if (category === "part") {
    return "Запчасти";
  }
  return "Расходники";
}

export function buildHelpText() {
  return [
    "Бот ведет учет автосервиса через Telegram.",
    "",
    "Что можно отправлять:",
    '1. Свободный текст для записи работ. Пример: "Иван Петров, +79991234567, Toyota Camry А123ВС77, 2026-04-21 11:00-13:30. Работы: замена масла 2500, диагностика 1500. Запчасти: масляный фильтр 700, масло 2400. Расходники: очиститель 200."',
    '2. Запрос отчета. Пример: "Покажи историю по Ивану Петрову", "Отчет по машине А123ВС77", "Отчет за период 2026-04-01 2026-04-21".',
    "",
    "Команды:",
    "/help",
    "/clients",
    "/cars",
    "/myid",
    "/lockme",
    "/unlock",
    "/wizard",
    "/cancel",
    "/orders",
    "/order 1",
    "/edit_order 1 <новое описание заказа>",
    "/delete_order 1",
    "/csv_customer Иван Петров",
    "/csv_vehicle А123ВС77",
    "/csv_period 2026-04-01 2026-04-21",
    "/report_customer Иван Петров",
    "/report_vehicle А123ВС77",
    "/report_period 2026-04-01 2026-04-21",
    "/record <свободное описание работ>",
  ].join("\n");
}

export function buildCreateConfirmation({ customer, vehicle, order, totals, itemsCount }) {
  return [
    "Запись сохранена.",
    `Клиент: ${customer.name}${customer.phone ? `, ${customer.phone}` : ""}`,
    `Машина: ${formatVehicleTitle(vehicle)}`,
    `Дата: ${order.service_date}${order.start_time ? ` ${order.start_time}` : ""}${order.end_time ? `-${order.end_time}` : ""}`,
    `Позиций: ${itemsCount}`,
    `Работы: ${formatMoney(totals.labor_total_cents)}`,
    `Запчасти: ${formatMoney(totals.parts_total_cents)}`,
    `Расходники: ${formatMoney(totals.consumables_total_cents)}`,
    `Итого: ${formatMoney(totals.grand_total_cents)}`,
    `Заказ: #${order.id}`,
  ].join("\n");
}

export function buildUpdateConfirmation({ customer, vehicle, order, totals, itemsCount }) {
  return [
    `Заказ #${order.id} обновлен.`,
    `Клиент: ${customer.name}${customer.phone ? `, ${customer.phone}` : ""}`,
    `Машина: ${formatVehicleTitle(vehicle)}`,
    `Дата: ${order.service_date}${order.start_time ? ` ${order.start_time}` : ""}${order.end_time ? `-${order.end_time}` : ""}`,
    `Позиций: ${itemsCount}`,
    `Работы: ${formatMoney(totals.labor_total_cents)}`,
    `Запчасти: ${formatMoney(totals.parts_total_cents)}`,
    `Расходники: ${formatMoney(totals.consumables_total_cents)}`,
    `Итого: ${formatMoney(totals.grand_total_cents)}`,
  ].join("\n");
}

export function buildDeleteConfirmation(order) {
  return [
    `Заказ #${order.id} удален.`,
    `Дата: ${order.service_date}${order.start_time ? ` ${order.start_time}` : ""}${order.end_time ? `-${order.end_time}` : ""}`,
    `Клиент: ${order.customer_name}`,
    `Машина: ${formatVehicleTitle(order)}`,
    `Итого удаленного заказа: ${formatMoney(order.grand_total_cents)}`,
  ].join("\n");
}

export function buildCustomersListText(customers) {
  if (!customers.length) {
    return "Клиенты пока не найдены.";
  }

  return [
    "Клиенты:",
    ...customers.map((customer) => {
      const totals = `заказов: ${customer.orders_count}, сумма: ${formatMoney(customer.total_spent_cents)}`;
      return `${formatCustomerLine(customer)}\n${totals}`;
    }),
  ].join("\n\n");
}

export function buildRecentOrdersListText(orders) {
  if (!orders.length) {
    return "Заказов пока нет.";
  }

  return [
    "Последние заказы:",
    ...orders.map((order) =>
      [
        `#${order.id} | ${order.service_date}${order.start_time ? ` ${order.start_time}` : ""}${order.end_time ? `-${order.end_time}` : ""}`,
        `Клиент: ${order.customer_name}`,
        `Машина: ${formatVehicleTitle(order)}`,
        `Итого: ${formatMoney(order.grand_total_cents)}`,
      ].join("\n"),
    ),
  ].join("\n\n");
}

export function buildVehiclesListText(vehicles) {
  if (!vehicles.length) {
    return "Машины пока не найдены.";
  }

  return [
    "Машины:",
    ...vehicles.map((vehicle) => {
      return [
        `#${vehicle.id} ${formatVehicleTitle(vehicle)}`,
        `Клиент: ${vehicle.customer_name}`,
        `Заказов: ${vehicle.orders_count}, сумма: ${formatMoney(vehicle.total_spent_cents)}`,
      ].join("\n");
    }),
  ].join("\n\n");
}

function buildOrderBlock(order) {
  const lines = [
    `Заказ #${order.id} | ${order.service_date}${order.start_time ? ` ${order.start_time}` : ""}${order.end_time ? `-${order.end_time}` : ""}`,
    `Машина: ${formatVehicleTitle(order)}`,
    `Работы: ${formatMoney(order.labor_total_cents)}`,
    `Запчасти: ${formatMoney(order.parts_total_cents)}`,
    `Расходники: ${formatMoney(order.consumables_total_cents)}`,
    `Итого: ${formatMoney(order.grand_total_cents)}`,
  ];

  if (order.problem_description) {
    lines.push(`Описание: ${order.problem_description}`);
  }

  if (order.work_summary) {
    lines.push(`Итог: ${order.work_summary}`);
  }

  if (order.items?.length) {
    lines.push("Позиции:");
    for (const item of order.items) {
      lines.push(
        `- ${formatCategoryLabel(item.category)}: ${item.description} (${item.quantity} x ${formatMoney(item.unit_price_cents)} = ${formatMoney(item.total_price_cents)})`,
      );
    }
  }

  return lines.join("\n");
}

export function buildOrderDetailsText(order) {
  if (!order) {
    return "Заказ не найден.";
  }

  return buildOrderBlock(order);
}

export function buildCustomerReportText(customer, orders, totals) {
  if (!customer) {
    return "Клиент не найден.";
  }

  const header = [
    `История по клиенту: ${customer.name}`,
    customer.phone ? `Телефон: ${customer.phone}` : null,
    `Заказов: ${orders.length}`,
    `Работы: ${formatMoney(totals.labor_total_cents)}`,
    `Запчасти: ${formatMoney(totals.parts_total_cents)}`,
    `Расходники: ${formatMoney(totals.consumables_total_cents)}`,
    `Итого: ${formatMoney(totals.grand_total_cents)}`,
  ]
    .filter(Boolean)
    .join("\n");

  if (!orders.length) {
    return `${header}\n\nИстория заказов пока пуста.`;
  }

  return [header, ...orders.map(buildOrderBlock)].join("\n\n");
}

export function buildVehicleReportText(vehicle, orders, totals) {
  if (!vehicle) {
    return "Машина не найдена.";
  }

  const header = [
    `История по машине: ${formatVehicleTitle(vehicle)}`,
    `Клиент: ${vehicle.customer_name}`,
    `Заказов: ${orders.length}`,
    `Работы: ${formatMoney(totals.labor_total_cents)}`,
    `Запчасти: ${formatMoney(totals.parts_total_cents)}`,
    `Расходники: ${formatMoney(totals.consumables_total_cents)}`,
    `Итого: ${formatMoney(totals.grand_total_cents)}`,
  ].join("\n");

  if (!orders.length) {
    return `${header}\n\nИстория заказов пока пуста.`;
  }

  return [header, ...orders.map(buildOrderBlock)].join("\n\n");
}

export function buildPeriodReportText(period, orders, totals) {
  const header = [
    `Отчет за период: ${period.from_date} - ${period.to_date}`,
    `Заказов: ${orders.length}`,
    `Работы: ${formatMoney(totals.labor_total_cents)}`,
    `Запчасти: ${formatMoney(totals.parts_total_cents)}`,
    `Расходники: ${formatMoney(totals.consumables_total_cents)}`,
    `Итого: ${formatMoney(totals.grand_total_cents)}`,
  ].join("\n");

  if (!orders.length) {
    return `${header}\n\nЗа выбранный период записей нет.`;
  }

  return [header, ...orders.map(buildOrderBlock)].join("\n\n");
}
