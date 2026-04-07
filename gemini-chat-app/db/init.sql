CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx
ON users ((LOWER(username)));

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode VARCHAR(64) NOT NULL,
  role VARCHAR(32) NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_conversation_mode_created_idx
ON messages (conversation_id, mode, created_at);

CREATE INDEX IF NOT EXISTS messages_user_created_idx
ON messages (user_id, created_at);

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  timezone VARCHAR(100) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS appointments_user_scheduled_idx
ON appointments (user_id, scheduled_for);

CREATE TABLE IF NOT EXISTS medication_schedules (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  medication_name TEXT NOT NULL,
  dosage TEXT,
  schedule_type VARCHAR(32) NOT NULL,
  times_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  days_of_week_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  specific_datetimes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS medication_schedules_user_active_idx
ON medication_schedules (user_id, active);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  profile_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  last_profile_refresh_prompt_count INTEGER NOT NULL DEFAULT 0,
  last_regenerated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
