PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  phone_normalized TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_normalized
  ON customers(phone_normalized)
  WHERE phone_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_name
  ON customers(name);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  make TEXT,
  model TEXT,
  plate TEXT,
  plate_normalized TEXT,
  vin TEXT,
  year INTEGER,
  color TEXT,
  nickname TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_plate_normalized
  ON vehicles(plate_normalized)
  WHERE plate_normalized IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_vin
  ON vehicles(vin)
  WHERE vin IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicles_customer_id
  ON vehicles(customer_id);

CREATE TABLE IF NOT EXISTS service_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  vehicle_id INTEGER NOT NULL,
  service_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  odometer_km INTEGER,
  problem_description TEXT,
  work_summary TEXT,
  notes TEXT,
  source_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_service_orders_customer_id
  ON service_orders(customer_id);

CREATE INDEX IF NOT EXISTS idx_service_orders_vehicle_id
  ON service_orders(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_service_orders_service_date
  ON service_orders(service_date);

CREATE TABLE IF NOT EXISTS service_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('labor', 'part', 'consumable')),
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  total_price_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES service_orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_service_items_order_id
  ON service_items(order_id);

CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

