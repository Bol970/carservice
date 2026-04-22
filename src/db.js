function compactText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function parseAllowedIds(raw) {
  return (raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function safeJsonParse(raw, fallback = null) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function normalizePhone(phone) {
  const cleaned = compactText(phone)?.replace(/[^\d+]/g, "") || null;
  if (!cleaned) {
    return null;
  }

  const digits = cleaned.replace(/[^\d]/g, "");
  if (!digits) {
    return null;
  }

  return digits.length === 11 && digits.startsWith("8") ? `7${digits.slice(1)}` : digits;
}

export function normalizePlate(plate) {
  const cleaned = compactText(plate)?.toUpperCase().replace(/[\s-]/g, "") || null;
  return cleaned || null;
}

export function rublesToCents(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(numeric * 100);
}

function sanitizeMoneyItems(items) {
  return (items || [])
    .map((item) => {
      const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
      const totalPrice = Number(item.total_price);
      const unitPrice = Number(item.unit_price);
      const total = Number.isFinite(totalPrice)
        ? totalPrice
        : Number.isFinite(unitPrice)
          ? unitPrice * quantity
          : 0;
      const unit = Number.isFinite(unitPrice) ? unitPrice : quantity ? total / quantity : total;

      return {
        category: item.category,
        description: compactText(item.description) || "Без названия",
        quantity,
        unit_price_cents: rublesToCents(unit),
        total_price_cents: rublesToCents(total),
      };
    })
    .filter((item) => item.description);
}

function centsToRubles(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return numeric / 100;
}

function normalizeItemDescription(value) {
  return (compactText(value) || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function itemMatchesDescription(item, targetDescription) {
  const normalizedTarget = normalizeItemDescription(targetDescription);
  if (!normalizedTarget) {
    return false;
  }

  const normalizedItem = normalizeItemDescription(item.description);
  if (!normalizedItem) {
    return false;
  }

  return (
    normalizedItem === normalizedTarget
    || normalizedItem.includes(normalizedTarget)
    || normalizedTarget.includes(normalizedItem)
  );
}

function formatItemForError(item, index) {
  return `${index + 1}. ${item.category}: ${item.description}`;
}

function findOrderItemIndex(items, operation) {
  if (Number.isInteger(operation.match_item_index)) {
    const zeroBased = operation.match_item_index - 1;
    if (zeroBased < 0 || zeroBased >= items.length) {
      throw new Error(`Позиция #${operation.match_item_index} не найдена в заказе.`);
    }

    return zeroBased;
  }

  const categoryMatches = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !operation.match_category || item.category === operation.match_category);

  const byExactDescription = categoryMatches.filter(({ item }) => {
    const target = normalizeItemDescription(operation.match_description);
    return target && normalizeItemDescription(item.description) === target;
  });

  if (byExactDescription.length === 1) {
    return byExactDescription[0].index;
  }

  if (byExactDescription.length > 1) {
    throw new Error([
      `Нашлось несколько совпадений для позиции "${operation.match_description}".`,
      "Уточните номер позиции через /order <номер заказа> и затем укажите 'позицию N'.",
      ...byExactDescription.map(({ item, index }) => `- ${formatItemForError(item, index)}`),
    ].join("\n"));
  }

  const bySoftDescription = categoryMatches.filter(({ item }) => itemMatchesDescription(item, operation.match_description));
  if (bySoftDescription.length === 1) {
    return bySoftDescription[0].index;
  }

  if (bySoftDescription.length > 1) {
    throw new Error([
      `Нашлось несколько похожих позиций для "${operation.match_description}".`,
      "Уточните номер позиции через /order <номер заказа> и затем укажите 'позицию N'.",
      ...bySoftDescription.map(({ item, index }) => `- ${formatItemForError(item, index)}`),
    ].join("\n"));
  }

  if (!operation.match_description && operation.match_category) {
    if (categoryMatches.length === 1) {
      return categoryMatches[0].index;
    }

    if (categoryMatches.length > 1) {
      throw new Error([
        `В категории ${operation.match_category} найдено несколько позиций.`,
        "Уточните название или номер позиции через /order <номер заказа>.",
        ...categoryMatches.map(({ item, index }) => `- ${formatItemForError(item, index)}`),
      ].join("\n"));
    }
  }

  throw new Error(`Не удалось найти позицию "${operation.match_description || "без названия"}" в заказе.`);
}

function hasPatchContent(parsed) {
  const hasCustomer = Object.values(parsed.customer || {}).some((value) => value !== null && value !== undefined && value !== "");
  const hasVehicle = Object.values(parsed.vehicle || {}).some((value) => value !== null && value !== undefined && value !== "");
  const hasServiceRecord = Object.values(parsed.service_record || {}).some((value) => value !== null && value !== undefined && value !== "");
  const hasItemOperations = Array.isArray(parsed.item_operations) && parsed.item_operations.length > 0;

  return hasCustomer || hasVehicle || hasServiceRecord || hasItemOperations;
}

function buildPatchItems(existingItems, operations) {
  const working = (existingItems || []).map((item) => ({
    category: item.category,
    description: item.description,
    quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
    unit_price: centsToRubles(item.unit_price_cents),
    total_price: centsToRubles(item.total_price_cents),
  }));

  for (const operation of operations || []) {
    if (operation.action === "add") {
      working.push({
        category: operation.category || operation.match_category || "labor",
        description: compactText(operation.description || operation.match_description) || "Без названия",
        quantity: Number(operation.quantity) > 0 ? Number(operation.quantity) : 1,
        unit_price: Number.isFinite(Number(operation.unit_price)) ? Number(operation.unit_price) : null,
        total_price: Number.isFinite(Number(operation.total_price)) ? Number(operation.total_price) : null,
      });
      continue;
    }

    const itemIndex = findOrderItemIndex(working, operation);
    if (operation.action === "remove") {
      working.splice(itemIndex, 1);
      continue;
    }

    const current = working[itemIndex];
    const nextQuantity = Number(operation.quantity) > 0 ? Number(operation.quantity) : current.quantity;
    const hasUnitPrice = Number.isFinite(Number(operation.unit_price));
    const hasTotalPrice = Number.isFinite(Number(operation.total_price));
    const nextTotal = hasTotalPrice
      ? Number(operation.total_price)
      : hasUnitPrice
        ? Number(operation.unit_price) * nextQuantity
        : current.total_price;
    const nextUnit = hasUnitPrice
      ? Number(operation.unit_price)
      : hasTotalPrice
        ? (nextQuantity ? Number(operation.total_price) / nextQuantity : Number(operation.total_price))
        : current.unit_price;

    working[itemIndex] = {
      category: operation.category || current.category,
      description: compactText(operation.description) || current.description,
      quantity: nextQuantity,
      unit_price: nextUnit,
      total_price: nextTotal,
    };
  }

  return sanitizeMoneyItems(working);
}

function computeTotals(items) {
  const totals = {
    labor_total_cents: 0,
    parts_total_cents: 0,
    consumables_total_cents: 0,
    grand_total_cents: 0,
  };

  for (const item of items) {
    if (item.category === "labor") {
      totals.labor_total_cents += item.total_price_cents;
    } else if (item.category === "part") {
      totals.parts_total_cents += item.total_price_cents;
    } else {
      totals.consumables_total_cents += item.total_price_cents;
    }
  }

  totals.grand_total_cents =
    totals.labor_total_cents + totals.parts_total_cents + totals.consumables_total_cents;
  return totals;
}

async function updateCustomer(env, customerId, data) {
  await env.DB.prepare(
    `
      UPDATE customers
      SET
        name = COALESCE(?, name),
        phone = COALESCE(?, phone),
        phone_normalized = COALESCE(?, phone_normalized),
        notes = COALESCE(?, notes)
      WHERE id = ?
    `,
  )
    .bind(data.name, data.phone, data.phone_normalized, data.notes, customerId)
    .run();
}

async function updateVehicle(env, vehicleId, data) {
  await env.DB.prepare(
    `
      UPDATE vehicles
      SET
        customer_id = COALESCE(?, customer_id),
        make = COALESCE(?, make),
        model = COALESCE(?, model),
        plate = COALESCE(?, plate),
        plate_normalized = COALESCE(?, plate_normalized),
        vin = COALESCE(?, vin),
        year = COALESCE(?, year),
        color = COALESCE(?, color),
        nickname = COALESCE(?, nickname),
        notes = COALESCE(?, notes)
      WHERE id = ?
    `,
  )
    .bind(
      data.customer_id,
      data.make,
      data.model,
      data.plate,
      data.plate_normalized,
      data.vin,
      data.year,
      data.color,
      data.nickname,
      data.notes,
      vehicleId,
    )
    .run();
}

export async function registerProcessedUpdate(env, updateId) {
  const result = await env.DB.prepare(
    "INSERT OR IGNORE INTO processed_updates (update_id) VALUES (?)",
  )
    .bind(updateId)
    .run();

  return result.meta.changes === 1;
}

export async function getSetting(env, key) {
  return env.DB.prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(key)
    .first();
}

export async function setSetting(env, key, value) {
  await env.DB.prepare(
    `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `,
  )
    .bind(key, value)
    .run();
}

export async function deleteSetting(env, key) {
  await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(key).run();
}

export async function getAllowedTelegramUserIds(env) {
  const envValue = compactText(env.ALLOWED_TELEGRAM_USER_IDS);
  if (envValue) {
    return parseAllowedIds(envValue);
  }

  const setting = await getSetting(env, "allowed_telegram_user_ids");
  return parseAllowedIds(setting?.value);
}

export async function lockBotToTelegramUser(env, telegramUserId) {
  await setSetting(env, "allowed_telegram_user_ids", String(telegramUserId));
  return [String(telegramUserId)];
}

export async function unlockBotTelegramUsers(env) {
  await deleteSetting(env, "allowed_telegram_user_ids");
}

export async function getTelegramSession(env, telegramUserId) {
  const row = await env.DB.prepare(
    "SELECT telegram_user_id, mode, payload_json, updated_at FROM telegram_sessions WHERE telegram_user_id = ?",
  )
    .bind(telegramUserId)
    .first();

  if (!row) {
    return null;
  }

  return {
    telegram_user_id: row.telegram_user_id,
    mode: row.mode,
    payload: safeJsonParse(row.payload_json, {}),
    updated_at: row.updated_at,
  };
}

export async function setTelegramSession(env, telegramUserId, mode, payload) {
  await env.DB.prepare(
    `
      INSERT INTO telegram_sessions (telegram_user_id, mode, payload_json, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(telegram_user_id) DO UPDATE SET
        mode = excluded.mode,
        payload_json = excluded.payload_json,
        updated_at = CURRENT_TIMESTAMP
    `,
  )
    .bind(telegramUserId, mode, JSON.stringify(payload))
    .run();
}

export async function clearTelegramSession(env, telegramUserId) {
  await env.DB.prepare("DELETE FROM telegram_sessions WHERE telegram_user_id = ?")
    .bind(telegramUserId)
    .run();
}

export async function listCustomers(env, limit = 20) {
  const result = await env.DB.prepare(
    `
      SELECT
        c.id,
        c.name,
        c.phone,
        COUNT(DISTINCT so.id) AS orders_count,
        COALESCE(SUM(si.total_price_cents), 0) AS total_spent_cents
      FROM customers c
      LEFT JOIN service_orders so ON so.customer_id = c.id
      LEFT JOIN service_items si ON si.order_id = so.id
      GROUP BY c.id
      ORDER BY c.name COLLATE NOCASE ASC
      LIMIT ?
    `,
  )
    .bind(limit)
    .all();

  return result.results || [];
}

export async function listVehicles(env, limit = 20) {
  const result = await env.DB.prepare(
    `
      SELECT
        v.id,
        v.make,
        v.model,
        v.plate,
        v.vin,
        v.nickname,
        c.name AS customer_name,
        COUNT(DISTINCT so.id) AS orders_count,
        COALESCE(SUM(si.total_price_cents), 0) AS total_spent_cents
      FROM vehicles v
      JOIN customers c ON c.id = v.customer_id
      LEFT JOIN service_orders so ON so.vehicle_id = v.id
      LEFT JOIN service_items si ON si.order_id = so.id
      GROUP BY v.id
      ORDER BY c.name COLLATE NOCASE ASC, v.make COLLATE NOCASE ASC, v.model COLLATE NOCASE ASC
      LIMIT ?
    `,
  )
    .bind(limit)
    .all();

  return result.results || [];
}

export async function findCustomerReference(env, search = {}) {
  const phoneNormalized = normalizePhone(search.customer_phone || search.query);
  if (phoneNormalized) {
    const exactPhone = await env.DB.prepare(
      "SELECT * FROM customers WHERE phone_normalized = ? LIMIT 2",
    )
      .bind(phoneNormalized)
      .all();

    if ((exactPhone.results || []).length === 1) {
      return { customer: exactPhone.results[0], ambiguous: [] };
    }

    if ((exactPhone.results || []).length > 1) {
      return { customer: null, ambiguous: exactPhone.results };
    }
  }

  const query = compactText(search.customer_name || search.query);
  if (!query) {
    return { customer: null, ambiguous: [] };
  }

  const exactName = await env.DB.prepare(
    "SELECT * FROM customers WHERE lower(name) = lower(?) LIMIT 2",
  )
    .bind(query)
    .all();

  if ((exactName.results || []).length === 1) {
    return { customer: exactName.results[0], ambiguous: [] };
  }

  const fuzzy = await env.DB.prepare(
    `
      SELECT *
      FROM customers
      WHERE name LIKE ? OR phone LIKE ?
      ORDER BY name COLLATE NOCASE ASC
      LIMIT 5
    `,
  )
    .bind(`%${query}%`, `%${query}%`)
    .all();

  const matches = fuzzy.results || [];
  if (matches.length === 1) {
    return { customer: matches[0], ambiguous: [] };
  }

  return { customer: null, ambiguous: matches };
}

export async function findVehicleReference(env, search = {}) {
  const vin = compactText(search.vehicle_vin);
  if (vin) {
    const exactVin = await env.DB.prepare(
      `
        SELECT v.*, c.name AS customer_name
        FROM vehicles v
        JOIN customers c ON c.id = v.customer_id
        WHERE upper(v.vin) = upper(?)
        LIMIT 2
      `,
    )
      .bind(vin)
      .all();

    if ((exactVin.results || []).length === 1) {
      return { vehicle: exactVin.results[0], ambiguous: [] };
    }

    if ((exactVin.results || []).length > 1) {
      return { vehicle: null, ambiguous: exactVin.results };
    }
  }

  const plateNormalized = normalizePlate(search.vehicle_plate || search.query);
  if (plateNormalized) {
    const exactPlate = await env.DB.prepare(
      `
        SELECT v.*, c.name AS customer_name
        FROM vehicles v
        JOIN customers c ON c.id = v.customer_id
        WHERE v.plate_normalized = ?
        LIMIT 2
      `,
    )
      .bind(plateNormalized)
      .all();

    if ((exactPlate.results || []).length === 1) {
      return { vehicle: exactPlate.results[0], ambiguous: [] };
    }

    if ((exactPlate.results || []).length > 1) {
      return { vehicle: null, ambiguous: exactPlate.results };
    }
  }

  const query = compactText(search.query);
  if (!query) {
    return { vehicle: null, ambiguous: [] };
  }

  const fuzzy = await env.DB.prepare(
    `
      SELECT
        v.*,
        c.name AS customer_name
      FROM vehicles v
      JOIN customers c ON c.id = v.customer_id
      WHERE
        v.plate LIKE ?
        OR v.vin LIKE ?
        OR v.make LIKE ?
        OR v.model LIKE ?
        OR c.name LIKE ?
      ORDER BY c.name COLLATE NOCASE ASC, v.make COLLATE NOCASE ASC, v.model COLLATE NOCASE ASC
      LIMIT 5
    `,
  )
    .bind(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`)
    .all();

  const matches = fuzzy.results || [];
  if (matches.length === 1) {
    return { vehicle: matches[0], ambiguous: [] };
  }

  return { vehicle: null, ambiguous: matches };
}

async function upsertCustomer(env, customer) {
  const data = {
    name: compactText(customer?.name),
    phone: compactText(customer?.phone),
    phone_normalized: normalizePhone(customer?.phone),
    notes: compactText(customer?.notes),
  };

  if (!data.name && !data.phone_normalized) {
    throw new Error("Не удалось определить клиента. Добавьте имя или телефон.");
  }

  if (data.phone_normalized) {
    const existingByPhone = await env.DB.prepare(
      "SELECT * FROM customers WHERE phone_normalized = ? LIMIT 1",
    )
      .bind(data.phone_normalized)
      .first();

    if (existingByPhone) {
      await updateCustomer(env, existingByPhone.id, data);
      return {
        ...existingByPhone,
        ...data,
      };
    }
  }

  if (data.name) {
    const existingByName = await env.DB.prepare(
      "SELECT * FROM customers WHERE lower(name) = lower(?) LIMIT 1",
    )
      .bind(data.name)
      .first();

    if (existingByName) {
      await updateCustomer(env, existingByName.id, data);
      return {
        ...existingByName,
        ...data,
      };
    }
  }

  const inserted = await env.DB.prepare(
    `
      INSERT INTO customers (name, phone, phone_normalized, notes)
      VALUES (?, ?, ?, ?)
    `,
  )
    .bind(data.name || "Клиент без имени", data.phone, data.phone_normalized, data.notes)
    .run();

  return env.DB.prepare("SELECT * FROM customers WHERE id = ?")
    .bind(inserted.meta.last_row_id)
    .first();
}

async function upsertVehicle(env, customerId, vehicle) {
  const data = {
    customer_id: customerId,
    make: compactText(vehicle?.make),
    model: compactText(vehicle?.model),
    plate: compactText(vehicle?.plate),
    plate_normalized: normalizePlate(vehicle?.plate),
    vin: compactText(vehicle?.vin)?.toUpperCase() || null,
    year: Number.isInteger(vehicle?.year) ? vehicle.year : null,
    color: compactText(vehicle?.color),
    nickname: compactText(vehicle?.nickname),
    notes: compactText(vehicle?.notes),
  };

  if (!data.plate_normalized && !data.vin && !data.make && !data.model) {
    throw new Error("Не удалось определить автомобиль. Добавьте номер, VIN или марку/модель.");
  }

  if (data.vin) {
    const existingByVin = await env.DB.prepare("SELECT * FROM vehicles WHERE vin = ? LIMIT 1")
      .bind(data.vin)
      .first();

    if (existingByVin) {
      await updateVehicle(env, existingByVin.id, data);
      return env.DB.prepare(
        `
          SELECT v.*, c.name AS customer_name
          FROM vehicles v
          JOIN customers c ON c.id = v.customer_id
          WHERE v.id = ?
        `,
      )
        .bind(existingByVin.id)
        .first();
    }
  }

  if (data.plate_normalized) {
    const existingByPlate = await env.DB.prepare(
      "SELECT * FROM vehicles WHERE plate_normalized = ? LIMIT 1",
    )
      .bind(data.plate_normalized)
      .first();

    if (existingByPlate) {
      await updateVehicle(env, existingByPlate.id, data);
      return env.DB.prepare(
        `
          SELECT v.*, c.name AS customer_name
          FROM vehicles v
          JOIN customers c ON c.id = v.customer_id
          WHERE v.id = ?
        `,
      )
        .bind(existingByPlate.id)
        .first();
    }
  }

  if (customerId && data.make && data.model) {
    const exactByOwnerAndModel = await env.DB.prepare(
      `
        SELECT *
        FROM vehicles
        WHERE customer_id = ? AND lower(make) = lower(?) AND lower(model) = lower(?)
        LIMIT 1
      `,
    )
      .bind(customerId, data.make, data.model)
      .first();

    if (exactByOwnerAndModel) {
      await updateVehicle(env, exactByOwnerAndModel.id, data);
      return env.DB.prepare(
        `
          SELECT v.*, c.name AS customer_name
          FROM vehicles v
          JOIN customers c ON c.id = v.customer_id
          WHERE v.id = ?
        `,
      )
        .bind(exactByOwnerAndModel.id)
        .first();
    }
  }

  const inserted = await env.DB.prepare(
    `
      INSERT INTO vehicles (
        customer_id,
        make,
        model,
        plate,
        plate_normalized,
        vin,
        year,
        color,
        nickname,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )
    .bind(
      data.customer_id,
      data.make,
      data.model,
      data.plate,
      data.plate_normalized,
      data.vin,
      data.year,
      data.color,
      data.nickname,
      data.notes,
    )
    .run();

  return env.DB.prepare(
    `
      SELECT v.*, c.name AS customer_name
      FROM vehicles v
      JOIN customers c ON c.id = v.customer_id
      WHERE v.id = ?
    `,
  )
    .bind(inserted.meta.last_row_id)
    .first();
}

async function replaceOrderItems(env, orderId, items) {
  await env.DB.prepare("DELETE FROM service_items WHERE order_id = ?").bind(orderId).run();

  for (const item of items) {
    await env.DB.prepare(
      `
        INSERT INTO service_items (
          order_id,
          category,
          description,
          quantity,
          unit_price_cents,
          total_price_cents
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    )
      .bind(
        orderId,
        item.category,
        item.description,
        item.quantity,
        item.unit_price_cents,
        item.total_price_cents,
      )
      .run();
  }
}

async function getOrderEditContext(env, orderId) {
  const details = await getOrderDetails(env, orderId);
  if (!details?.order) {
    return null;
  }

  const customer = await env.DB.prepare("SELECT * FROM customers WHERE id = ?")
    .bind(details.order.customer_id)
    .first();
  const vehicle = await env.DB.prepare("SELECT * FROM vehicles WHERE id = ?")
    .bind(details.order.vehicle_id)
    .first();

  return {
    order: details.order,
    customer,
    vehicle,
  };
}

export async function createServiceRecord(env, parsed, rawText, todayDate) {
  const customer = await upsertCustomer(env, parsed.customer);
  const vehicle = await upsertVehicle(env, customer.id, parsed.vehicle);

  const serviceDate = compactText(parsed.service_record?.service_date) || todayDate;
  const startTime = compactText(parsed.service_record?.start_time);
  const endTime = compactText(parsed.service_record?.end_time);
  const odometerKm = Number.isInteger(parsed.service_record?.odometer_km)
    ? parsed.service_record.odometer_km
    : null;

  const orderInsert = await env.DB.prepare(
    `
      INSERT INTO service_orders (
        customer_id,
        vehicle_id,
        service_date,
        start_time,
        end_time,
        odometer_km,
        problem_description,
        work_summary,
        notes,
        source_text
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )
    .bind(
      customer.id,
      vehicle.id,
      serviceDate,
      startTime,
      endTime,
      odometerKm,
      compactText(parsed.service_record?.problem_description),
      compactText(parsed.service_record?.work_summary),
      compactText(parsed.service_record?.notes),
      compactText(rawText),
    )
    .run();

  const orderId = orderInsert.meta.last_row_id;
  const items = sanitizeMoneyItems(parsed.items);
  await replaceOrderItems(env, orderId, items);

  const order = await env.DB.prepare("SELECT * FROM service_orders WHERE id = ?").bind(orderId).first();
  const totals = computeTotals(items);

  return {
    customer,
    vehicle,
    order,
    items,
    totals,
  };
}

export async function updateServiceRecord(env, orderId, parsed, rawText, todayDate) {
  const existingOrder = await env.DB.prepare("SELECT * FROM service_orders WHERE id = ?")
    .bind(orderId)
    .first();

  if (!existingOrder) {
    throw new Error(`Заказ #${orderId} не найден.`);
  }

  const customer = await upsertCustomer(env, parsed.customer);
  const vehicle = await upsertVehicle(env, customer.id, parsed.vehicle);
  const items = sanitizeMoneyItems(parsed.items);

  const serviceDate = compactText(parsed.service_record?.service_date) || todayDate;
  const startTime = compactText(parsed.service_record?.start_time);
  const endTime = compactText(parsed.service_record?.end_time);
  const odometerKm = Number.isInteger(parsed.service_record?.odometer_km)
    ? parsed.service_record.odometer_km
    : null;

  await env.DB.prepare(
    `
      UPDATE service_orders
      SET
        customer_id = ?,
        vehicle_id = ?,
        service_date = ?,
        start_time = ?,
        end_time = ?,
        odometer_km = ?,
        problem_description = ?,
        work_summary = ?,
        notes = ?,
        source_text = ?
      WHERE id = ?
    `,
  )
    .bind(
      customer.id,
      vehicle.id,
      serviceDate,
      startTime,
      endTime,
      odometerKm,
      compactText(parsed.service_record?.problem_description),
      compactText(parsed.service_record?.work_summary),
      compactText(parsed.service_record?.notes),
      compactText(rawText),
      orderId,
    )
    .run();

  await replaceOrderItems(env, orderId, items);

  const order = await env.DB.prepare("SELECT * FROM service_orders WHERE id = ?").bind(orderId).first();
  const totals = computeTotals(items);

  return {
    customer,
    vehicle,
    order,
    items,
    totals,
  };
}

export async function patchServiceRecord(env, orderId, parsed, rawText, todayDate) {
  const existing = await getOrderEditContext(env, orderId);
  if (!existing) {
    throw new Error(`Заказ #${orderId} не найден.`);
  }

  if (!hasPatchContent(parsed)) {
    throw new Error("Не понял, что именно нужно поменять в заказе. Укажите номер позиции или название и действие: добавить, изменить или удалить.");
  }

  const customer = await upsertCustomer(env, {
    name: compactText(parsed.customer?.name) || existing.customer?.name,
    phone: compactText(parsed.customer?.phone) || existing.customer?.phone,
    notes: compactText(parsed.customer?.notes) || existing.customer?.notes,
  });

  const vehicle = await upsertVehicle(env, customer.id, {
    make: compactText(parsed.vehicle?.make) || existing.vehicle?.make,
    model: compactText(parsed.vehicle?.model) || existing.vehicle?.model,
    plate: compactText(parsed.vehicle?.plate) || existing.vehicle?.plate,
    vin: compactText(parsed.vehicle?.vin) || existing.vehicle?.vin,
    year: Number.isInteger(parsed.vehicle?.year) ? parsed.vehicle.year : existing.vehicle?.year,
    color: compactText(parsed.vehicle?.color) || existing.vehicle?.color,
    nickname: compactText(parsed.vehicle?.nickname) || existing.vehicle?.nickname,
    notes: compactText(parsed.vehicle?.notes) || existing.vehicle?.notes,
  });

  const items = buildPatchItems(existing.order.items, parsed.item_operations || []);
  const serviceDate = compactText(parsed.service_record?.service_date) || existing.order.service_date || todayDate;
  const startTime = compactText(parsed.service_record?.start_time) || existing.order.start_time;
  const endTime = compactText(parsed.service_record?.end_time) || existing.order.end_time;
  const odometerKm = Number.isInteger(parsed.service_record?.odometer_km)
    ? parsed.service_record.odometer_km
    : existing.order.odometer_km;
  const problemDescription = compactText(parsed.service_record?.problem_description) || existing.order.problem_description;
  const workSummary = compactText(parsed.service_record?.work_summary) || existing.order.work_summary;
  const notes = compactText(parsed.service_record?.notes) || existing.order.notes;

  await env.DB.prepare(
    `
      UPDATE service_orders
      SET
        customer_id = ?,
        vehicle_id = ?,
        service_date = ?,
        start_time = ?,
        end_time = ?,
        odometer_km = ?,
        problem_description = ?,
        work_summary = ?,
        notes = ?,
        source_text = ?
      WHERE id = ?
    `,
  )
    .bind(
      customer.id,
      vehicle.id,
      serviceDate,
      startTime,
      endTime,
      odometerKm,
      problemDescription,
      workSummary,
      notes,
      compactText(rawText),
      orderId,
    )
    .run();

  await replaceOrderItems(env, orderId, items);

  const order = await env.DB.prepare("SELECT * FROM service_orders WHERE id = ?").bind(orderId).first();
  const totals = computeTotals(items);

  return {
    customer,
    vehicle,
    order,
    items,
    totals,
  };
}

async function getOrdersWithItems(env, whereSql, bindValues) {
  const ordersResult = await env.DB.prepare(
    `
      SELECT
        so.id,
        so.customer_id,
        so.vehicle_id,
        so.service_date,
        so.start_time,
        so.end_time,
        so.odometer_km,
        so.problem_description,
        so.work_summary,
        so.notes,
        v.make,
        v.model,
        v.plate,
        v.vin,
        v.nickname,
        c.name AS customer_name,
        COALESCE(SUM(CASE WHEN si.category = 'labor' THEN si.total_price_cents END), 0) AS labor_total_cents,
        COALESCE(SUM(CASE WHEN si.category = 'part' THEN si.total_price_cents END), 0) AS parts_total_cents,
        COALESCE(SUM(CASE WHEN si.category = 'consumable' THEN si.total_price_cents END), 0) AS consumables_total_cents,
        COALESCE(SUM(si.total_price_cents), 0) AS grand_total_cents
      FROM service_orders so
      JOIN vehicles v ON v.id = so.vehicle_id
      JOIN customers c ON c.id = so.customer_id
      LEFT JOIN service_items si ON si.order_id = so.id
      WHERE ${whereSql}
      GROUP BY so.id
      ORDER BY so.service_date DESC, so.start_time DESC, so.id DESC
    `,
  )
    .bind(...bindValues)
    .all();

  const orders = ordersResult.results || [];
  if (!orders.length) {
    return orders;
  }

  const placeholders = orders.map(() => "?").join(", ");
  const itemsResult = await env.DB.prepare(
    `
      SELECT *
      FROM service_items
      WHERE order_id IN (${placeholders})
      ORDER BY order_id ASC, id ASC
    `,
  )
    .bind(...orders.map((order) => order.id))
    .all();

  const itemsByOrderId = new Map();
  for (const item of itemsResult.results || []) {
    const list = itemsByOrderId.get(item.order_id) || [];
    list.push(item);
    itemsByOrderId.set(item.order_id, list);
  }

  return orders.map((order) => ({
    ...order,
    items: itemsByOrderId.get(order.id) || [],
  }));
}

export async function getOrderDetails(env, orderId) {
  const orders = await getOrdersWithItems(env, "so.id = ?", [orderId]);
  if (!orders.length) {
    return null;
  }

  const order = orders[0];
  return {
    order,
    totals: summarizeOrders([order]),
  };
}

export async function deleteServiceOrder(env, orderId) {
  const existing = await getOrderDetails(env, orderId);
  if (!existing) {
    return null;
  }

  await env.DB.prepare("DELETE FROM service_orders WHERE id = ?").bind(orderId).run();
  return existing;
}

function summarizeOrders(orders) {
  return orders.reduce(
    (acc, order) => {
      acc.labor_total_cents += order.labor_total_cents || 0;
      acc.parts_total_cents += order.parts_total_cents || 0;
      acc.consumables_total_cents += order.consumables_total_cents || 0;
      acc.grand_total_cents += order.grand_total_cents || 0;
      return acc;
    },
    {
      labor_total_cents: 0,
      parts_total_cents: 0,
      consumables_total_cents: 0,
      grand_total_cents: 0,
    },
  );
}

export async function getCustomerReport(env, customerId) {
  const customer = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(customerId).first();
  const orders = await getOrdersWithItems(env, "so.customer_id = ?", [customerId]);
  return {
    customer,
    orders,
    totals: summarizeOrders(orders),
  };
}

export async function getVehicleReport(env, vehicleId) {
  const vehicle = await env.DB.prepare(
    `
      SELECT v.*, c.name AS customer_name
      FROM vehicles v
      JOIN customers c ON c.id = v.customer_id
      WHERE v.id = ?
    `,
  )
    .bind(vehicleId)
    .first();

  const orders = await getOrdersWithItems(env, "so.vehicle_id = ?", [vehicleId]);
  return {
    vehicle,
    orders,
    totals: summarizeOrders(orders),
  };
}

export async function getPeriodReport(env, fromDate, toDate) {
  const orders = await getOrdersWithItems(
    env,
    "so.service_date >= ? AND so.service_date <= ?",
    [fromDate, toDate],
  );

  return {
    period: {
      from_date: fromDate,
      to_date: toDate,
    },
    orders,
    totals: summarizeOrders(orders),
  };
}

export async function listRecentOrders(env, limit = 10) {
  return getOrdersWithItems(env, "1 = 1", []).then((orders) => orders.slice(0, limit));
}
