const TELEGRAM_API_URL = "https://api.telegram.org";

export async function callTelegramApi(env, method, payload) {
  const response = await fetch(`${TELEGRAM_API_URL}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram API error: ${result.description || response.statusText}`);
  }

  return result.result;
}

export async function callTelegramMultipartApi(env, method, formData) {
  const response = await fetch(`${TELEGRAM_API_URL}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    body: formData,
  });

  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram API error: ${result.description || response.statusText}`);
  }

  return result.result;
}

export function splitTelegramMessage(text, maxLength = 3500) {
  if (text.length <= maxLength) {
    return [text];
  }

  const lines = text.split("\n");
  const chunks = [];
  let current = "";

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length <= maxLength) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = line;
      continue;
    }

    chunks.push(line.slice(0, maxLength));
    current = line.slice(maxLength);
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

export async function sendTelegramText(env, chatId, text) {
  const chunks = splitTelegramMessage(text);
  for (const chunk of chunks) {
    await callTelegramApi(env, "sendMessage", {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
    });
  }
}

export async function sendTelegramDocumentFromText(env, chatId, filename, content, caption = "") {
  const formData = new FormData();
  formData.set("chat_id", String(chatId));
  if (caption) {
    formData.set("caption", caption);
  }
  formData.set("document", new Blob([content], { type: "text/csv;charset=utf-8" }), filename);

  return callTelegramMultipartApi(env, "sendDocument", formData);
}

export async function setupTelegramWebhook(env, requestUrl) {
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET is not set.");
  }

  const webhookUrl = new URL("/telegram/webhook", requestUrl).toString();
  return callTelegramApi(env, "setWebhook", {
    url: webhookUrl,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
}
