function emptyStringToNull(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed.toLowerCase() === "нет") {
    return null;
  }
  return trimmed;
}

function parseDate(value, fallbackDate) {
  const text = emptyStringToNull(value);
  if (!text) {
    return fallbackDate;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallbackDate;
}

function parseTimeRange(value) {
  const text = emptyStringToNull(value);
  if (!text) {
    return { start_time: null, end_time: null };
  }

  const match = text.match(/^(\d{2}:\d{2})(?:\s*-\s*(\d{2}:\d{2}))?$/);
  if (!match) {
    return null;
  }

  return {
    start_time: match[1],
    end_time: match[2] || null,
  };
}

function parseVehicle(value) {
  const text = emptyStringToNull(value);
  if (!text) {
    return null;
  }

  const match = text.match(/^(.+?)(?:\s+([A-Za-zА-Яа-я0-9]{5,12}))?$/);
  const modelText = match?.[1]?.trim() || text;
  const plate = match?.[2] || null;
  const parts = modelText.split(/\s+/);

  return {
    make: parts[0] || null,
    model: parts.slice(1).join(" ") || null,
    plate,
    vin: null,
    year: null,
    color: null,
    nickname: null,
    notes: null,
  };
}

function parseItemLine(line, category) {
  const text = emptyStringToNull(line);
  if (!text) {
    return null;
  }

  const quantityMatch = text.match(/^(\d+(?:[.,]\d+)?)\s*[xх*]\s+(.+?)\s+(\d+(?:[.,]\d+)?)$/i);
  if (quantityMatch) {
    const quantity = Number(quantityMatch[1].replace(",", "."));
    const description = quantityMatch[2].trim();
    const unitPrice = Number(quantityMatch[3].replace(",", "."));
    return {
      category,
      description,
      quantity,
      unit_price: unitPrice,
      total_price: quantity * unitPrice,
    };
  }

  const simpleMatch = text.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)$/);
  if (!simpleMatch) {
    return null;
  }

  const description = simpleMatch[1].trim();
  const price = Number(simpleMatch[2].replace(",", "."));
  return {
    category,
    description,
    quantity: 1,
    unit_price: price,
    total_price: price,
  };
}

function parseItemsBlock(value, category) {
  const text = emptyStringToNull(value);
  if (!text) {
    return [];
  }

  return text
    .split(/\n|;/)
    .map((part) => parseItemLine(part, category))
    .filter(Boolean);
}

export const WIZARD_STEPS = [
  {
    key: "customer_name",
    prompt: "Шаг 1/8. Введите имя клиента.",
  },
  {
    key: "customer_phone",
    prompt: 'Шаг 2/8. Введите телефон клиента или "-" если без телефона.',
  },
  {
    key: "vehicle",
    prompt: 'Шаг 3/8. Введите машину в виде "Toyota Camry А123ВС77".',
  },
  {
    key: "service_date",
    prompt: 'Шаг 4/8. Введите дату ремонта в формате YYYY-MM-DD или "-" для сегодняшней даты.',
  },
  {
    key: "time_range",
    prompt: 'Шаг 5/8. Введите время в формате "11:00-13:30" или "-" если без времени.',
  },
  {
    key: "labor",
    prompt: 'Шаг 6/8. Введите работы, по одной через ";" или с новой строки. Пример: "замена масла 2500; диагностика 1500".',
  },
  {
    key: "parts",
    prompt: 'Шаг 7/8. Введите запчасти в том же формате или "-" если их не было.',
  },
  {
    key: "consumables",
    prompt: 'Шаг 8/8. Введите расходники в том же формате или "-" если их не было.',
  },
];

export function createEmptyWizardSession(todayDate) {
  return {
    step_index: 0,
    today_date: todayDate,
    draft: {
      customer_name: null,
      customer_phone: null,
      vehicle: null,
      service_date: todayDate,
      time_range: null,
      labor: [],
      parts: [],
      consumables: [],
    },
  };
}

export function getWizardStep(session) {
  return WIZARD_STEPS[session.step_index] || null;
}

export function wizardPrompt(session) {
  const step = getWizardStep(session);
  if (!step) {
    return null;
  }
  return `${step.prompt}\n\nОтправьте /cancel чтобы выйти из мастера.`;
}

export function applyWizardInput(session, text) {
  const step = getWizardStep(session);
  if (!step) {
    return { ok: false, error: "Мастер уже завершен." };
  }

  const value = text.trim();
  const draft = { ...session.draft };

  if (step.key === "customer_name") {
    const parsed = emptyStringToNull(value);
    if (!parsed) {
      return { ok: false, error: "Имя клиента не должно быть пустым." };
    }
    draft.customer_name = parsed;
  } else if (step.key === "customer_phone") {
    draft.customer_phone = emptyStringToNull(value);
  } else if (step.key === "vehicle") {
    const parsed = parseVehicle(value);
    if (!parsed) {
      return { ok: false, error: "Не удалось разобрать машину. Пример: Toyota Camry А123ВС77" };
    }
    draft.vehicle = parsed;
  } else if (step.key === "service_date") {
    draft.service_date = parseDate(value, session.today_date);
  } else if (step.key === "time_range") {
    const parsed = parseTimeRange(value);
    if (parsed === null) {
      return { ok: false, error: 'Время должно быть в формате "11:00-13:30" или "-".' };
    }
    draft.time_range = parsed;
  } else if (step.key === "labor") {
    const items = parseItemsBlock(value, "labor");
    if (!items.length) {
      return { ok: false, error: "Нужно указать хотя бы одну работу." };
    }
    draft.labor = items;
  } else if (step.key === "parts") {
    draft.parts = parseItemsBlock(value, "part");
  } else if (step.key === "consumables") {
    draft.consumables = parseItemsBlock(value, "consumable");
  }

  return {
    ok: true,
    session: {
      ...session,
      step_index: session.step_index + 1,
      draft,
    },
  };
}

export function wizardToParsedIntent(session) {
  const timeRange = session.draft.time_range || { start_time: null, end_time: null };
  const items = [...session.draft.labor, ...session.draft.parts, ...session.draft.consumables];
  const workSummary = session.draft.labor.map((item) => item.description).join(", ") || null;

  return {
    intent: "create_service_record",
    confidence: 1,
    customer: {
      name: session.draft.customer_name,
      phone: session.draft.customer_phone,
      notes: null,
    },
    vehicle: session.draft.vehicle,
    service_record: {
      service_date: session.draft.service_date,
      start_time: timeRange.start_time,
      end_time: timeRange.end_time,
      odometer_km: null,
      problem_description: null,
      work_summary: workSummary,
      notes: "Создано через пошаговый мастер Telegram.",
    },
    items,
    search: null,
    answer_text: null,
  };
}
