import {
  clearTelegramSession,
  createServiceRecord,
  deleteServiceOrder,
  getAllowedTelegramUserIds,
  getOrderDetails,
  getTelegramSession,
  findCustomerReference,
  findVehicleReference,
  getCustomerReport,
  getPeriodReport,
  getVehicleReport,
  lockBotToTelegramUser,
  listRecentOrders,
  listCustomers,
  listVehicles,
  registerProcessedUpdate,
  setTelegramSession,
  unlockBotTelegramUsers,
  updateServiceRecord,
} from "./db.js";
import {
  buildCreateConfirmation,
  buildCustomerReportText,
  buildCustomersListText,
  buildDeleteConfirmation,
  buildHelpText,
  buildOrderDetailsText,
  buildPeriodReportText,
  buildRecentOrdersListText,
  buildUpdateConfirmation,
  buildVehicleReportText,
  buildVehiclesListText,
} from "./format.js";
import { buildOrdersCsv } from "./csv.js";
import { parseUserMessageWithLLM } from "./openrouter.js";
import { sendTelegramDocumentFromText, sendTelegramText, setupTelegramWebhook } from "./telegram.js";
import {
  applyWizardInput,
  createEmptyWizardSession,
  getWizardStep,
  wizardPrompt,
  wizardToParsedIntent,
} from "./wizard.js";

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    ...init,
  });
}

function todayInTimezone(timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat("sv-SE", {
      timeZone: timeZone || "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function isAuthorizedUser(env, telegramUserId) {
  const allowed = await getAllowedTelegramUserIds(env);
  if (!allowed.length) {
    return true;
  }

  return allowed.includes(String(telegramUserId));
}

function parseCommand(text) {
  const trimmed = text.trim();
  const [commandPart, ...restParts] = trimmed.split(" ");
  const command = commandPart.split("@")[0].toLowerCase();
  const rest = restParts.join(" ").trim();

  if (command === "/start" || command === "/help") {
    return { intent: "help" };
  }

  if (command === "/clients") {
    return { intent: "list_customers" };
  }

  if (command === "/myid") {
    return { intent: "my_id" };
  }

  if (command === "/wizard") {
    return { intent: "wizard_start" };
  }

  if (command === "/cancel") {
    return { intent: "cancel" };
  }

  if (command === "/lockme") {
    return { intent: "lock_me" };
  }

  if (command === "/unlock") {
    return { intent: "unlock_bot" };
  }

  if (command === "/cars") {
    return { intent: "list_vehicles" };
  }

  if (command === "/orders") {
    return { intent: "list_orders" };
  }

  if (command === "/order") {
    return { intent: "order_details", order_id: Number(rest) || null };
  }

  if (command === "/delete_order") {
    return { intent: "delete_order", order_id: Number(rest) || null };
  }

  if (command === "/edit_order") {
    const match = rest.match(/^(\d+)\s+([\s\S]+)$/);
    return {
      intent: "edit_order",
      order_id: match ? Number(match[1]) : null,
      text: match ? match[2].trim() : "",
    };
  }

  if (command === "/report_customer") {
    return {
      intent: "report_customer",
      search: {
        query: rest || null,
        customer_name: rest || null,
        customer_phone: null,
        vehicle_plate: null,
        vehicle_vin: null,
        from_date: null,
        to_date: null,
      },
    };
  }

  if (command === "/report_vehicle") {
    return {
      intent: "report_vehicle",
      search: {
        query: rest || null,
        customer_name: null,
        customer_phone: null,
        vehicle_plate: rest || null,
        vehicle_vin: null,
        from_date: null,
        to_date: null,
      },
    };
  }

  if (command === "/report_period") {
    const [fromDate, toDate] = rest.split(/\s+/).filter(Boolean);
    return {
      intent: "report_period",
      search: {
        query: rest || null,
        customer_name: null,
        customer_phone: null,
        vehicle_plate: null,
        vehicle_vin: null,
        from_date: fromDate || null,
        to_date: toDate || null,
      },
    };
  }

  if (command === "/csv_customer") {
    return {
      intent: "csv_customer",
      search: {
        query: rest || null,
        customer_name: rest || null,
        customer_phone: null,
        vehicle_plate: null,
        vehicle_vin: null,
        from_date: null,
        to_date: null,
      },
    };
  }

  if (command === "/csv_vehicle") {
    return {
      intent: "csv_vehicle",
      search: {
        query: rest || null,
        customer_name: null,
        customer_phone: null,
        vehicle_plate: rest || null,
        vehicle_vin: null,
        from_date: null,
        to_date: null,
      },
    };
  }

  if (command === "/csv_period") {
    const [fromDate, toDate] = rest.split(/\s+/).filter(Boolean);
    return {
      intent: "csv_period",
      search: {
        query: rest || null,
        customer_name: null,
        customer_phone: null,
        vehicle_plate: null,
        vehicle_vin: null,
        from_date: fromDate || null,
        to_date: toDate || null,
      },
    };
  }

  if (command === "/record") {
    return {
      intent: "llm_record",
      text: rest,
    };
  }

  return null;
}

function textReply(text) {
  return { type: "text", text };
}

function csvReply(filename, content, caption) {
  return { type: "document", filename, content, caption };
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}

function buildAmbiguousCustomerText(candidates) {
  return [
    "Нашлось несколько клиентов. Уточните запрос именем или телефоном.",
    ...candidates.map((customer) => `- ${customer.name}${customer.phone ? `, ${customer.phone}` : ""}`),
  ].join("\n");
}

function buildAmbiguousVehicleText(candidates) {
  return [
    "Нашлось несколько машин. Уточните номер, VIN или клиента.",
    ...candidates.map((vehicle) => {
      const title = [vehicle.make, vehicle.model, vehicle.plate].filter(Boolean).join(" ");
      return `- ${title || vehicle.vin || "Машина"} | клиент: ${vehicle.customer_name}`;
    }),
  ].join("\n");
}

async function resolveIntent(env, text, todayDate) {
  const command = parseCommand(text);
  if (!command) {
    return parseUserMessageWithLLM(env, text, todayDate);
  }

  if (command.intent === "edit_order") {
    if (!command.order_id || !command.text) {
      return {
        intent: "unknown",
        confidence: 1,
        customer: null,
        vehicle: null,
        service_record: null,
        items: [],
        search: null,
        answer_text: "Используйте /edit_order <номер> <новое описание заказа>.",
      };
    }

    const parsed = await parseUserMessageWithLLM(env, command.text, todayDate);
    return parsed
      ? {
          ...parsed,
          intent: parsed.intent === "create_service_record" ? "edit_order" : parsed.intent,
          order_id: command.order_id,
          raw_edit_text: command.text,
        }
      : parsed;
  }

  if (command.intent === "llm_record") {
    if (!command.text) {
      return {
        intent: "unknown",
        confidence: 1,
        customer: null,
        vehicle: null,
        service_record: null,
        items: [],
        search: null,
        answer_text: "После /record добавьте описание работ свободным текстом.",
      };
    }
    return parseUserMessageWithLLM(env, command.text, todayDate);
  }

  return {
    confidence: 1,
    customer: null,
    vehicle: null,
    service_record: null,
    items: [],
    search: null,
    answer_text: null,
    ...command,
  };
}

async function handleIntent(env, intent, rawText, todayDate, context = {}) {
  if (!intent) {
    return textReply("Чтобы понимать свободный текст, задайте OPENROUTER_API_KEY. Пока доступны только команды /help, /clients, /cars, /report_customer, /report_vehicle, /report_period.");
  }

  if (intent.confidence !== undefined && intent.confidence < 0.45) {
    return textReply(intent.answer_text || `Не удалось надежно понять запрос.\n\n${buildHelpText()}`);
  }

  if (intent.intent === "help" || intent.intent === "unknown") {
    return textReply(intent.answer_text ? `${intent.answer_text}\n\n${buildHelpText()}` : buildHelpText());
  }

  if (intent.intent === "list_customers") {
    const customers = await listCustomers(env);
    return textReply(buildCustomersListText(customers));
  }

  if (intent.intent === "wizard_start") {
    const session = createEmptyWizardSession(todayDate);
    await setTelegramSession(env, context.telegramUserId, "wizard", session);
    return textReply([
      "Запущен пошаговый мастер создания заказа.",
      wizardPrompt(session),
    ].join("\n\n"));
  }

  if (intent.intent === "my_id") {
    const allowedIds = await getAllowedTelegramUserIds(env);
    const isEnvLocked = Boolean(env.ALLOWED_TELEGRAM_USER_IDS?.trim());
    const lockText = allowedIds.length
      ? `Сейчас доступ разрешен для: ${allowedIds.join(", ")}`
      : "Сейчас бот открыт для всех Telegram ID.";

    return textReply([
      `Ваш Telegram ID: ${context.telegramUserId}`,
      lockText,
      isEnvLocked
        ? "Ограничение задано через переменную ALLOWED_TELEGRAM_USER_IDS в Cloudflare."
        : "Чтобы закрыть доступ только на себя, отправьте /lockme",
    ].join("\n"));
  }

  if (intent.intent === "lock_me") {
    if (env.ALLOWED_TELEGRAM_USER_IDS?.trim()) {
      return textReply("ALLOWED_TELEGRAM_USER_IDS задан в Cloudflare, поэтому /lockme не может изменить список доступа. Если хотите, я помогу потом перенести ограничение в D1 и убрать env-переменную.");
    }

    const allowedIds = await lockBotToTelegramUser(env, context.telegramUserId);
    return textReply([
      "Доступ к боту закрыт.",
      `Разрешен только Telegram ID: ${allowedIds.join(", ")}`,
      "Теперь посторонние пользователи не смогут пользоваться ботом.",
    ].join("\n"));
  }

  if (intent.intent === "unlock_bot") {
    if (env.ALLOWED_TELEGRAM_USER_IDS?.trim()) {
      return textReply("ALLOWED_TELEGRAM_USER_IDS задан в Cloudflare, поэтому /unlock не может снять ограничение. Нужно менять переменную в конфиге Cloudflare.");
    }

    await unlockBotTelegramUsers(env);
    return textReply("Ограничение доступа снято. Бот снова открыт для всех Telegram ID.");
  }

  if (intent.intent === "list_orders") {
    const orders = await listRecentOrders(env);
    return textReply(buildRecentOrdersListText(orders));
  }

  if (intent.intent === "order_details") {
    if (!intent.order_id) {
      return textReply("Используйте /order <номер>, например /order 1");
    }

    const details = await getOrderDetails(env, intent.order_id);
    return textReply(buildOrderDetailsText(details?.order));
  }

  if (intent.intent === "list_vehicles") {
    const vehicles = await listVehicles(env);
    return textReply(buildVehiclesListText(vehicles));
  }

  if (intent.intent === "create_service_record") {
    const created = await createServiceRecord(env, intent, rawText, todayDate);
    return textReply(buildCreateConfirmation({
      customer: created.customer,
      vehicle: created.vehicle,
      order: created.order,
      totals: created.totals,
      itemsCount: created.items.length,
    }));
  }

  if (intent.intent === "edit_order") {
    if (!intent.order_id) {
      return textReply("Используйте /edit_order <номер> <новое описание заказа>.");
    }

    const updated = await updateServiceRecord(
      env,
      intent.order_id,
      intent,
      intent.raw_edit_text || rawText,
      todayDate,
    );

    return textReply(buildUpdateConfirmation({
      customer: updated.customer,
      vehicle: updated.vehicle,
      order: updated.order,
      totals: updated.totals,
      itemsCount: updated.items.length,
    }));
  }

  if (intent.intent === "delete_order") {
    if (!intent.order_id) {
      return textReply("Используйте /delete_order <номер>, например /delete_order 1");
    }

    const deleted = await deleteServiceOrder(env, intent.order_id);
    if (!deleted) {
      return textReply("Заказ не найден.");
    }

    return textReply(buildDeleteConfirmation(deleted.order));
  }

  if (intent.intent === "report_customer") {
    const reference = await findCustomerReference(env, intent.search || {});
    if (reference.customer) {
      const report = await getCustomerReport(env, reference.customer.id);
      return textReply(buildCustomerReportText(report.customer, report.orders, report.totals));
    }

    if (reference.ambiguous.length) {
      return textReply(buildAmbiguousCustomerText(reference.ambiguous));
    }

    return textReply("Клиент не найден.");
  }

  if (intent.intent === "report_vehicle") {
    const reference = await findVehicleReference(env, intent.search || {});
    if (reference.vehicle) {
      const report = await getVehicleReport(env, reference.vehicle.id);
      return textReply(buildVehicleReportText(report.vehicle, report.orders, report.totals));
    }

    if (reference.ambiguous.length) {
      return textReply(buildAmbiguousVehicleText(reference.ambiguous));
    }

    return textReply("Машина не найдена.");
  }

  if (intent.intent === "report_period") {
    let fromDate = intent.search?.from_date;
    let toDate = intent.search?.to_date;

    if (!fromDate || !toDate || !isIsoDate(fromDate) || !isIsoDate(toDate)) {
      return textReply("Для отчета за период укажите даты в формате YYYY-MM-DD YYYY-MM-DD, например: /report_period 2026-04-01 2026-04-21");
    }

    if (fromDate > toDate) {
      [fromDate, toDate] = [toDate, fromDate];
    }

    const report = await getPeriodReport(env, fromDate, toDate);
    return textReply(buildPeriodReportText(report.period, report.orders, report.totals));
  }

  if (intent.intent === "csv_customer") {
    const reference = await findCustomerReference(env, intent.search || {});
    if (!reference.customer) {
      return textReply(reference.ambiguous.length ? buildAmbiguousCustomerText(reference.ambiguous) : "Клиент не найден.");
    }
    const report = await getCustomerReport(env, reference.customer.id);
    return csvReply(
      `customer-${reference.customer.id}.csv`,
      buildOrdersCsv(report.orders),
      `CSV по клиенту ${reference.customer.name}`,
    );
  }

  if (intent.intent === "csv_vehicle") {
    const reference = await findVehicleReference(env, intent.search || {});
    if (!reference.vehicle) {
      return textReply(reference.ambiguous.length ? buildAmbiguousVehicleText(reference.ambiguous) : "Машина не найдена.");
    }
    const report = await getVehicleReport(env, reference.vehicle.id);
    return csvReply(
      `vehicle-${reference.vehicle.id}.csv`,
      buildOrdersCsv(report.orders),
      `CSV по машине ${reference.vehicle.plate || reference.vehicle.vin || reference.vehicle.id}`,
    );
  }

  if (intent.intent === "csv_period") {
    let fromDate = intent.search?.from_date;
    let toDate = intent.search?.to_date;

    if (!fromDate || !toDate || !isIsoDate(fromDate) || !isIsoDate(toDate)) {
      return textReply("Для CSV-отчета за период укажите даты в формате YYYY-MM-DD YYYY-MM-DD, например: /csv_period 2026-04-01 2026-04-21");
    }

    if (fromDate > toDate) {
      [fromDate, toDate] = [toDate, fromDate];
    }

    const report = await getPeriodReport(env, fromDate, toDate);
    return csvReply(
      `period-${fromDate}-${toDate}.csv`,
      buildOrdersCsv(report.orders),
      `CSV за период ${fromDate} - ${toDate}`,
    );
  }

  return textReply(buildHelpText());
}

async function handleWizardMessage(env, sessionRow, text, todayDate, context) {
  const session = sessionRow.payload;
  const applied = applyWizardInput(session, text);

  if (!applied.ok) {
    return textReply(applied.error);
  }

  const nextStep = getWizardStep(applied.session);
  if (nextStep) {
    await setTelegramSession(env, context.telegramUserId, "wizard", applied.session);
    return textReply(wizardPrompt(applied.session));
  }

  await clearTelegramSession(env, context.telegramUserId);
  const parsedIntent = wizardToParsedIntent(applied.session);
  const created = await createServiceRecord(env, parsedIntent, "Создано через пошаговый мастер Telegram.", todayDate);
  return textReply(buildCreateConfirmation({
    customer: created.customer,
    vehicle: created.vehicle,
    order: created.order,
    totals: created.totals,
    itemsCount: created.items.length,
  }));
}

async function sendReply(env, chatId, reply) {
  if (typeof reply === "string") {
    await sendTelegramText(env, chatId, reply);
    return;
  }

  if (reply?.type === "document") {
    await sendTelegramDocumentFromText(env, chatId, reply.filename, reply.content, reply.caption);
    return;
  }

  await sendTelegramText(env, chatId, reply?.text || "Пустой ответ.");
}

async function handleTelegramUpdate(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return new Response("Missing TELEGRAM_BOT_TOKEN", { status: 500 });
  }

  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Missing TELEGRAM_WEBHOOK_SECRET", { status: 500 });
  }

  const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  const update = await request.json();
  if (typeof update.update_id === "number") {
    const isNewUpdate = await registerProcessedUpdate(env, update.update_id);
    if (!isNewUpdate) {
      return new Response("ok");
    }
  }

  const message = update.message;
  if (!message?.text || !message.chat?.id || !message.from?.id) {
    return new Response("ok");
  }

  if (!(await isAuthorizedUser(env, message.from.id))) {
    await sendTelegramText(env, message.chat.id, "У вас нет доступа к этому боту.");
    return new Response("ok");
  }

  const todayDate = todayInTimezone(env.TIMEZONE);

  try {
    const activeSession = await getTelegramSession(env, message.from.id);
    const parsedCommand = parseCommand(message.text);

    if (parsedCommand?.intent === "cancel") {
      await clearTelegramSession(env, message.from.id);
      await sendReply(env, message.chat.id, textReply("Текущий мастер отменен."));
      return new Response("ok");
    }

    if (activeSession?.mode === "wizard" && !parsedCommand) {
      const reply = await handleWizardMessage(env, activeSession, message.text, todayDate, {
        telegramUserId: message.from.id,
      });
      await sendReply(env, message.chat.id, reply);
      return new Response("ok");
    }

    const intent = await resolveIntent(env, message.text, todayDate);
    const answer = await handleIntent(env, intent, message.text, todayDate, {
      telegramUserId: message.from.id,
    });
    await sendReply(env, message.chat.id, answer);
  } catch (error) {
    await sendReply(
      env,
      message.chat.id,
      textReply(`Не удалось обработать сообщение.\n${error instanceof Error ? error.message : "Неизвестная ошибка."}`),
    );
  }

  return new Response("ok");
}

async function handleSetupWebhook(request, env) {
  if (!env.SETUP_SECRET) {
    return new Response("Missing SETUP_SECRET", { status: 500 });
  }

  const setupSecret = request.headers.get("x-setup-secret");
  if (setupSecret !== env.SETUP_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  const result = await setupTelegramWebhook(env, request.url);
  return jsonResponse({
    ok: true,
    result,
  });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    return jsonResponse({
      ok: true,
      service: "carservice-telegram-bot",
      date: todayInTimezone(env.TIMEZONE),
    });
  }

  if (request.method === "POST" && url.pathname === "/telegram/webhook") {
    return handleTelegramUpdate(request, env);
  }

  if (request.method === "POST" && url.pathname === "/setup-webhook") {
    return handleSetupWebhook(request, env);
  }

  return new Response("Not found", { status: 404 });
}

export default {
  fetch(request, env, ctx) {
    void ctx;
    return Promise.resolve(handleRequest(request, env));
  },
};
