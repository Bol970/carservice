# CarService Telegram Bot

Telegram-бот для очень маленького автосервиса на `Cloudflare Workers + D1 + OpenRouter`.

Что умеет MVP:

- вести учет клиентов и их машин;
- хранить выполненные работы с датой и временем;
- разделять стоимость `работ`, `запчастей` и `расходников`;
- считать полную стоимость ремонта;
- выдавать историю по клиенту;
- выдавать историю по машине;
- собирать отчет за период;
- принимать сообщения в свободной форме через Telegram;
- использовать бесплатный роутер `openrouter/free` для разбора свободного текста.
- редактировать и удалять заказы через Telegram;
- выгружать отчеты в CSV;
- вести пошаговый мастер создания заказа через Telegram.

## Быстрый старт

Минимальный сценарий запуска с нуля:

```bash
cp .env.docker.example .env.docker
# заполните .env.docker своими значениями
docker compose build wrangler
docker compose --env-file .env.docker run --rm wrangler wrangler d1 create carservice-db
# добавьте полученный D1_DATABASE_ID в .env.docker
npm run cf:render
docker compose --env-file .env.docker run --rm wrangler wrangler d1 execute DB --remote --file=./migrations/0001_init.sql
docker compose --env-file .env.docker run --rm wrangler wrangler d1 execute DB --remote --file=./migrations/0002_app_settings.sql
docker compose --env-file .env.docker run --rm wrangler wrangler d1 execute DB --remote --file=./migrations/0003_telegram_sessions.sql
docker compose --env-file .env.docker run --rm wrangler sh -lc 'printf "%s" "$TELEGRAM_BOT_TOKEN" | wrangler secret put TELEGRAM_BOT_TOKEN'
docker compose --env-file .env.docker run --rm wrangler sh -lc 'printf "%s" "$TELEGRAM_WEBHOOK_SECRET" | wrangler secret put TELEGRAM_WEBHOOK_SECRET'
docker compose --env-file .env.docker run --rm wrangler sh -lc 'printf "%s" "$OPENROUTER_API_KEY" | wrangler secret put OPENROUTER_API_KEY'
docker compose --env-file .env.docker run --rm wrangler sh -lc 'printf "%s" "$SETUP_SECRET" | wrangler secret put SETUP_SECRET'
docker compose --env-file .env.docker run --rm wrangler wrangler deploy
```

После деплоя:

```bash
curl -X POST https://YOUR-WORKER-URL/setup-webhook \
  -H "x-setup-secret: YOUR_SETUP_SECRET"
```

## Архитектура

- `Cloudflare Workers` принимает webhook от Telegram.
- `Cloudflare D1` хранит клиентов, машины, заказы и позиции заказа.
- `OpenRouter` разбирает текстовые сообщения и превращает их в структуру.
- Telegram остается единственным пользовательским интерфейсом.

## Структура проекта

- `src/index.js` — основной HTTP-обработчик и маршрутизация.
- `src/db.js` — работа с D1 и бизнес-логика.
- `src/openrouter.js` — вызов OpenRouter через `openrouter/free`.
- `src/telegram.js` — вызовы Telegram Bot API.
- `src/format.js` — форматирование ответов.
- `migrations/0001_init.sql` — схема базы данных.

## Подготовка

Нужны:

- Node.js 18+;
- Cloudflare account;
- Telegram bot token от `@BotFather`;
- OpenRouter API key.

Установка зависимостей:

```bash
npm install
```

Если хотите вообще не ставить Node.js/npm/wrangler локально, можно делать все через Docker. Для этого в проект уже добавлены [Dockerfile.wrangler](/home/lobanov/Projects/carservice/Dockerfile.wrangler) и [docker-compose.yml](/home/lobanov/Projects/carservice/docker-compose.yml).

## Вариант без локального Node: через Docker

Скопируйте [.env.docker.example](/home/lobanov/Projects/carservice/.env.docker.example) в `.env.docker` и заполните его:

```env
cp .env.docker.example .env.docker
```

После этого отредактируйте `.env.docker` и подставьте реальные значения.

В `.env.docker` теперь нужно хранить и `D1_DATABASE_ID`.

Сгенерируйте локальные Cloudflare-конфиги:

```bash
npm run cf:render
```

Соберите контейнер:

```bash
docker compose build wrangler
```

Проверьте, что `wrangler` запускается:

```bash
docker compose run --rm wrangler wrangler --version
```

Или через `npm`-алиасы:

```bash
npm run docker:build
npm run docker:wrangler:version
```

## Создание D1 базы

Создайте базу:

```bash
npx wrangler d1 create carservice-db
```

Cloudflare вернет `database_id`. Сохраните его в локальный `.env.docker` как `D1_DATABASE_ID`.

Публичные шаблоны лежат в:

- [wrangler.toml.template](/home/lobanov/Projects/carservice/wrangler.toml.template)
- [cloudflare-upload-metadata.template.json](/home/lobanov/Projects/carservice/cloudflare-upload-metadata.template.json)

Реальные файлы `wrangler.toml` и `cloudflare-upload-metadata.json` генерируются локально из шаблонов и не коммитятся.

Если делаете это через Docker:

```bash
docker compose --env-file .env.docker run --rm wrangler wrangler d1 create carservice-db
```

Затем примените миграцию:

```bash
npm run d1:migrate:remote
```

Через Docker:

```bash
docker compose --env-file .env.docker run --rm wrangler wrangler d1 execute DB --remote --file=./migrations/0001_init.sql
```

Для локальной разработки можно использовать:

```bash
npm run d1:migrate:local
```

## Секреты и переменные

Задайте секреты:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put SETUP_SECRET
```

Через Docker можно не вводить секреты вручную, а загрузить их из `.env.docker`:

```bash
docker compose --env-file .env.docker run --rm wrangler sh -lc 'printf "%s" "$TELEGRAM_BOT_TOKEN" | wrangler secret put TELEGRAM_BOT_TOKEN'
docker compose --env-file .env.docker run --rm wrangler sh -lc 'printf "%s" "$TELEGRAM_WEBHOOK_SECRET" | wrangler secret put TELEGRAM_WEBHOOK_SECRET'
docker compose --env-file .env.docker run --rm wrangler sh -lc 'printf "%s" "$OPENROUTER_API_KEY" | wrangler secret put OPENROUTER_API_KEY'
docker compose --env-file .env.docker run --rm wrangler sh -lc 'printf "%s" "$SETUP_SECRET" | wrangler secret put SETUP_SECRET'
```

Или короткими алиасами:

```bash
npm run docker:secret:telegram-token
npm run docker:secret:webhook-secret
npm run docker:secret:openrouter-key
npm run docker:secret:setup-secret
```

При необходимости ограничьте доступ к боту только своим Telegram ID через переменную `ALLOWED_TELEGRAM_USER_IDS`.

Пример локального файла есть в [.dev.vars.example](/home/lobanov/Projects/carservice/.dev.vars.example).

Переменные в локально сгенерированном [wrangler.toml](/home/lobanov/Projects/carservice/wrangler.toml):

- `TIMEZONE` — по умолчанию `Europe/Moscow`;
- `APP_NAME` — имя приложения для заголовка `X-Title` в OpenRouter;
- `OPENROUTER_MODEL` — по умолчанию `openrouter/free`.

Важно:

- `wrangler.toml` и `cloudflare-upload-metadata.json` больше не хранятся в git;
- в GitHub лежат только шаблоны с плейсхолдерами;
- ручное подставление `database_id` в tracked-файлы больше не нужно.

## Деплой

```bash
npm run deploy
```

Через Docker:

```bash
docker compose --env-file .env.docker run --rm wrangler wrangler deploy
```

После деплоя у вас будет URL Cloudflare Worker, например:

```text
https://carservice-telegram-bot.<subdomain>.workers.dev
```

## Настройка Telegram webhook

В проекте есть служебный endpoint `POST /setup-webhook`.

После деплоя вызовите:

```bash
curl -X POST https://YOUR-WORKER-URL/setup-webhook \
  -H "x-setup-secret: YOUR_SETUP_SECRET"
```

Он зарегистрирует webhook на адрес:

```text
https://YOUR-WORKER-URL/telegram/webhook
```

и передаст `secret_token`, который Telegram будет присылать в заголовке `X-Telegram-Bot-Api-Secret-Token`.

## Примеры сообщений боту

### Запись выполненных работ

```text
Иван Петров, +79991234567, Toyota Camry А123ВС77, VIN XW7BF4FK1AA123456.
2026-04-21 11:00-13:30.
Работы: замена масла 2500, диагностика 1500.
Запчасти: масляный фильтр 700, масло 2400.
Расходники: очиститель 200.
Комментарий: клиент попросил повторно проверить через 5000 км.
```

### Отчет по клиенту

```text
Покажи историю по Ивану Петрову
```

или:

```text
/report_customer Иван Петров
```

### Отчет по машине

```text
Отчет по машине А123ВС77
```

или:

```text
/report_vehicle А123ВС77
```

### Отчет за период

```text
Отчет за период 2026-04-01 2026-04-21
```

или:

```text
/report_period 2026-04-01 2026-04-21
```

### Списки

```text
/clients
/cars
/orders
```

### Редактирование и удаление

```text
/order 1
/edit_order 1 Иван Петров, +79991234567, Toyota Camry А123ВС77. 2026-04-21 11:00-14:00. Работы: замена масла 3000. Запчасти: фильтр 700, масло 2400. Расходники: очиститель 200.
/delete_order 1
```

### CSV экспорт

```text
/csv_customer Иван Петров
/csv_vehicle А123ВС77
/csv_period 2026-04-01 2026-04-21
```

### Пошаговый мастер

```text
/wizard
```

Бот по очереди спросит:

- имя клиента;
- телефон;
- машину;
- дату;
- время;
- работы;
- запчасти;
- расходники.

Для выхода из мастера:

```text
/cancel
```

## Что важно знать

- Бот рассчитан на один приватный рабочий Telegram-чат и одного владельца сервиса.
- Если OpenRouter не настроен, свободный текст обрабатываться не будет, но команды останутся доступны.
- Для большей точности лучше писать в сообщении имя клиента, телефон и номер машины.
- Если найдено несколько похожих клиентов или машин, бот попросит уточнить запрос.

## Идеи для следующего этапа

- добавить удаление/редактирование записей;
- сохранять фото заказ-нарядов и чеков;
- ввести пробег, VIN и госномер как обязательные поля;
- сделать экспорт в CSV;
- добавить напоминания клиентам о следующем ТО.
