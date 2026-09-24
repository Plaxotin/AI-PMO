-- BL-36 TG-надзор: ingestion-ядро волны 2 (SPEC-BL-36 §7)
-- Один проект на инстанс (вариант А, решение 24.09.2026): project_id — текстовый
-- slug из конфига бота (дефолт 'default'), схема готова к мульти-проекту.

CREATE TABLE bl36_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL UNIQUE,
  title text,
  project_id text NOT NULL DEFAULT 'default',
  is_active boolean NOT NULL DEFAULT true,
  connected_by bigint,               -- tg user_id, кто добавил бота
  connected_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bl36_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL,
  msg_id bigint NOT NULL,
  author_id bigint,
  author_login text,
  author_name text,
  text text,
  reply_to_msg_id bigint,
  sent_at timestamptz NOT NULL,
  link text,                         -- https://t.me/c/<chat>/<msg>
  is_noise boolean NOT NULL DEFAULT false,
  processed_at timestamptz,          -- когда ушло в sense-making
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_id, msg_id)
);

CREATE INDEX bl36_messages_unprocessed_idx
  ON bl36_messages (chat_id, sent_at)
  WHERE processed_at IS NULL AND NOT is_noise;

CREATE TABLE bl36_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES bl36_channels (id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('assignment','decision','risk','news')),
  summary text NOT NULL,
  rationale text,                    -- «Почему предлагает»
  confidence numeric(3,2) NOT NULL DEFAULT 0.5,
  msg_ids bigint[] NOT NULL,         -- источники (обязательно >= 1)
  batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bl36_signals_channel_idx ON bl36_signals (channel_id, created_at);

CREATE TABLE bl36_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES bl36_signals (id) ON DELETE CASCADE,
  target text NOT NULL CHECK (target IN ('assignment','decision','risk')),
  action text NOT NULL DEFAULT 'create' CHECK (action IN ('create','update')),
  payload jsonb NOT NULL,            -- поля будущей записи
  diff jsonb,                        -- для update: {"срок": {"old":…, "new":…}}
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','edited_confirmed','rejected','merged','expired')),
  tg_message_id bigint,              -- карточка предложения в TG
  decided_by bigint,
  decided_at timestamptz,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bl36_proposals_pending_idx
  ON bl36_proposals (status, created_at) WHERE status = 'pending';

-- Подтверждённые записи (решения, риски, поручения) — в Google Sheets BL-6
-- (вкладки «Решения», «Риски», реестр поручений), решение 24.09.2026.
-- В Supabase реестры не дублируются.

CREATE TABLE bl36_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fio text NOT NULL,
  tg_login text,
  company text,
  role text,
  contact_synced boolean NOT NULL DEFAULT false,  -- синхронизирован с «Контактами» BL-6
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tg_login)
);

-- RLS: бот работает через service key (обходит RLS), веб-воркспейс читает
-- очередь предложений под authenticated. Действия из веба — фаза 2.
ALTER TABLE bl36_channels     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bl36_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bl36_signals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bl36_proposals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bl36_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY bl36_channels_read     ON bl36_channels     FOR SELECT TO authenticated USING (true);
CREATE POLICY bl36_signals_read      ON bl36_signals      FOR SELECT TO authenticated USING (true);
CREATE POLICY bl36_proposals_read    ON bl36_proposals    FOR SELECT TO authenticated USING (true);
CREATE POLICY bl36_participants_read ON bl36_participants FOR SELECT TO authenticated USING (true);
-- bl36_messages: сырые сообщения (ПДн) — authenticated НЕ читает, только service role.
