const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

const PARSER_SCHEMA = {
  name: "carservice_bot_parser",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      intent: {
        type: "string",
        enum: [
          "create_service_record",
          "report_customer",
          "report_vehicle",
          "report_period",
          "list_customers",
          "list_vehicles",
          "help",
          "unknown",
        ],
      },
      confidence: {
        type: "number",
      },
      customer: {
        type: ["object", "null"],
        additionalProperties: false,
        properties: {
          name: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
          notes: { type: ["string", "null"] },
        },
        required: ["name", "phone", "notes"],
      },
      vehicle: {
        type: ["object", "null"],
        additionalProperties: false,
        properties: {
          make: { type: ["string", "null"] },
          model: { type: ["string", "null"] },
          plate: { type: ["string", "null"] },
          vin: { type: ["string", "null"] },
          year: { type: ["integer", "null"] },
          color: { type: ["string", "null"] },
          nickname: { type: ["string", "null"] },
          notes: { type: ["string", "null"] },
        },
        required: ["make", "model", "plate", "vin", "year", "color", "nickname", "notes"],
      },
      service_record: {
        type: ["object", "null"],
        additionalProperties: false,
        properties: {
          service_date: { type: ["string", "null"] },
          start_time: { type: ["string", "null"] },
          end_time: { type: ["string", "null"] },
          odometer_km: { type: ["integer", "null"] },
          problem_description: { type: ["string", "null"] },
          work_summary: { type: ["string", "null"] },
          notes: { type: ["string", "null"] },
        },
        required: [
          "service_date",
          "start_time",
          "end_time",
          "odometer_km",
          "problem_description",
          "work_summary",
          "notes",
        ],
      },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            category: {
              type: "string",
              enum: ["labor", "part", "consumable"],
            },
            description: { type: "string" },
            quantity: { type: "number" },
            unit_price: { type: "number" },
            total_price: { type: "number" },
          },
          required: ["category", "description", "quantity", "unit_price", "total_price"],
        },
      },
      search: {
        type: ["object", "null"],
        additionalProperties: false,
        properties: {
          query: { type: ["string", "null"] },
          customer_name: { type: ["string", "null"] },
          customer_phone: { type: ["string", "null"] },
          vehicle_plate: { type: ["string", "null"] },
          vehicle_vin: { type: ["string", "null"] },
          from_date: { type: ["string", "null"] },
          to_date: { type: ["string", "null"] },
        },
        required: [
          "query",
          "customer_name",
          "customer_phone",
          "vehicle_plate",
          "vehicle_vin",
          "from_date",
          "to_date",
        ],
      },
      answer_text: {
        type: ["string", "null"],
      },
    },
    required: ["intent", "confidence", "customer", "vehicle", "service_record", "items", "search", "answer_text"],
  },
};

export async function parseUserMessageWithLLM(env, messageText, todayDate) {
  if (!env.OPENROUTER_API_KEY) {
    return null;
  }

  const payload = {
    model: env.OPENROUTER_MODEL || "openrouter/free",
    temperature: 0.1,
    max_tokens: 1200,
    plugins: [{ id: "response-healing" }],
    response_format: {
      type: "json_schema",
      json_schema: PARSER_SCHEMA,
    },
    messages: [
      {
        role: "system",
        content: [
          "Ты помощник автосервиса и должен строго преобразовать сообщение пользователя в JSON по схеме.",
          `Текущая дата: ${todayDate}.`,
          "Если пользователь просит сохранить выполненные работы, используй intent=create_service_record.",
          "Если пользователь просит историю по клиенту, intent=report_customer.",
          "Если пользователь просит историю по машине, intent=report_vehicle.",
          "Если пользователь просит отчет за период, intent=report_period.",
          "Если пользователь просит список клиентов, intent=list_customers.",
          "Если пользователь просит список машин, intent=list_vehicles.",
          "Если пользователь явно не просит действие, intent=unknown.",
          "Для create_service_record заполни customer, vehicle, service_record и items настолько полно, насколько возможно.",
          "Категории: labor = стоимость работ, part = запчасти, consumable = расходники и материалы.",
          "Все даты возвращай в формате YYYY-MM-DD.",
          "Все времена возвращай в формате HH:MM.",
          "Все суммы возвращай числом в рублях, без символа валюты.",
          "Если общая сумма указана без разбивки и нельзя надежно разделить категории, отнеси ее в labor.",
          "Если в сообщении сказано 'апрель', 'вчера', 'сегодня' и так далее, преобразуй это в точные даты относительно текущей даты.",
          "answer_text используй только если нужно коротко пояснить неоднозначность; иначе верни null.",
        ].join(" "),
      },
      {
        role: "user",
        content: messageText,
      },
    ],
  };

  const headers = {
    Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
  };

  if (env.OPENROUTER_HTTP_REFERER) {
    headers["HTTP-Referer"] = env.OPENROUTER_HTTP_REFERER;
  }

  if (env.APP_NAME) {
    headers["X-Title"] = env.APP_NAME;
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${result?.error?.message || response.statusText}`);
  }

  const content = result?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned an empty response.");
  }

  return typeof content === "string" ? JSON.parse(content) : content;
}

