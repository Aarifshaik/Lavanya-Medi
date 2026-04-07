const { randomUUID } = require("crypto");
const { query } = require("./db");
const { buildSidebarSummary } = require("./workspace-reminders");

const WORKSPACE_MODES = [
  "chat",
  "schedule_appointment",
  "medication_tracking",
  "symptom_analysis",
  "preliminary_assessment",
];

const PROFILE_REFRESH_INTERVAL = 5;
const MAX_PROFILE_MESSAGES = 40;

function toIsoString(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function serializeMessage(message) {
  return {
    id: message.id,
    conversationId: message.conversation_id,
    userId: Number(message.user_id),
    mode: message.mode,
    role: message.role,
    content: message.content,
    metadata: message.metadata || null,
    createdAt: toIsoString(message.created_at),
  };
}

function serializeAppointment(appointment) {
  return {
    id: appointment.id,
    userId: Number(appointment.user_id),
    title: appointment.title,
    scheduledFor: toIsoString(appointment.scheduled_for),
    timezone: appointment.timezone,
    status: appointment.status,
    notes: appointment.notes || "",
    sourceMessageId: appointment.source_message_id || null,
    createdAt: toIsoString(appointment.created_at),
    updatedAt: toIsoString(appointment.updated_at),
  };
}

function serializeMedicationSchedule(schedule) {
  return {
    id: schedule.id,
    userId: Number(schedule.user_id),
    medicationName: schedule.medication_name,
    dosage: schedule.dosage || "",
    scheduleType: schedule.schedule_type,
    times: Array.isArray(schedule.times_json) ? schedule.times_json : [],
    daysOfWeek: Array.isArray(schedule.days_of_week_json)
      ? schedule.days_of_week_json
      : [],
    specificDatetimes: Array.isArray(schedule.specific_datetimes_json)
      ? schedule.specific_datetimes_json
      : [],
    timezone: schedule.timezone || "UTC",
    notes: schedule.notes || "",
    active: Boolean(schedule.active),
    sourceMessageId: schedule.source_message_id || null,
    createdAt: toIsoString(schedule.created_at),
    updatedAt: toIsoString(schedule.updated_at),
  };
}

function serializeMedicalProfile(profile) {
  const profileJson =
    profile && profile.profile_json && typeof profile.profile_json === "object"
      ? profile.profile_json
      : {};

  return {
    summary: profile?.summary || "",
    profile: profileJson,
    promptCount: Number(profile?.prompt_count || 0),
    lastProfileRefreshPromptCount: Number(
      profile?.last_profile_refresh_prompt_count || 0
    ),
    lastRegeneratedAt: toIsoString(profile?.last_regenerated_at),
    profileRefreshDue:
      Number(profile?.prompt_count || 0) -
        Number(profile?.last_profile_refresh_prompt_count || 0) >=
      PROFILE_REFRESH_INTERVAL,
  };
}

async function getOrCreateConversation(userId, executor) {
  const existing = await query(
    "SELECT * FROM conversations WHERE user_id = $1 LIMIT 1",
    [userId],
    executor
  );

  if (existing.rowCount > 0) {
    return existing.rows[0];
  }

  try {
    const inserted = await query(
      `
        INSERT INTO conversations (id, user_id)
        VALUES ($1, $2)
        RETURNING *
      `,
      [randomUUID(), userId],
      executor
    );

    return inserted.rows[0];
  } catch (error) {
    if (error.code !== "23505") {
      throw error;
    }

    const retry = await query(
      "SELECT * FROM conversations WHERE user_id = $1 LIMIT 1",
      [userId],
      executor
    );

    return retry.rows[0];
  }
}

async function ensureUserProfile(userId, executor) {
  await query(
    `
      INSERT INTO user_profiles (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [userId],
    executor
  );
}

async function getUserProfile(userId, executor) {
  await ensureUserProfile(userId, executor);
  const result = await query(
    "SELECT * FROM user_profiles WHERE user_id = $1",
    [userId],
    executor
  );
  return result.rows[0];
}

async function incrementPromptCount(userId, executor) {
  await ensureUserProfile(userId, executor);
  const result = await query(
    `
      UPDATE user_profiles
      SET prompt_count = prompt_count + 1,
          updated_at = NOW()
      WHERE user_id = $1
      RETURNING *
    `,
    [userId],
    executor
  );

  return result.rows[0];
}

async function persistMessage(payload, executor) {
  const result = await query(
    `
      INSERT INTO messages (id, conversation_id, user_id, mode, role, content, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
    [
      randomUUID(),
      payload.conversationId,
      payload.userId,
      payload.mode,
      payload.role,
      payload.content,
      payload.metadata || null,
    ],
    executor
  );

  return result.rows[0];
}

async function fetchConversationMessages(conversationId) {
  const result = await query(
    `
      SELECT *
      FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC
    `,
    [conversationId]
  );

  return result.rows;
}

async function fetchModeMessages(conversationId, mode, limit) {
  const result = await query(
    `
      SELECT *
      FROM messages
      WHERE conversation_id = $1
        AND mode = $2
      ORDER BY created_at DESC
      LIMIT $3
    `,
    [conversationId, mode, limit]
  );

  return result.rows.reverse();
}

async function fetchRecentUserFacts(userId) {
  const result = await query(
    `
      SELECT mode, content, created_at
      FROM messages
      WHERE user_id = $1
        AND role = 'user'
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [userId, MAX_PROFILE_MESSAGES]
  );

  return result.rows.reverse();
}

async function fetchAppointments(userId) {
  const result = await query(
    `
      SELECT *
      FROM appointments
      WHERE user_id = $1
      ORDER BY scheduled_for ASC
    `,
    [userId]
  );

  return result.rows;
}

async function fetchMedicationSchedules(userId) {
  const result = await query(
    `
      SELECT *
      FROM medication_schedules
      WHERE user_id = $1
      ORDER BY active DESC, created_at ASC
    `,
    [userId]
  );

  return result.rows;
}

function groupMessagesByMode(messages) {
  const grouped = WORKSPACE_MODES.reduce((accumulator, mode) => {
    accumulator[mode] = [];
    return accumulator;
  }, {});

  for (const message of messages) {
    if (!grouped[message.mode]) {
      grouped[message.mode] = [];
    }

    grouped[message.mode].push(message);
  }

  return grouped;
}

async function buildWorkspaceBootstrap(userId) {
  const conversation = await getOrCreateConversation(userId);
  const [profile, messageRows, appointmentRows, medicationRows] = await Promise.all([
    getUserProfile(userId),
    fetchConversationMessages(conversation.id),
    fetchAppointments(userId),
    fetchMedicationSchedules(userId),
  ]);

  const serializedMessages = messageRows.map(serializeMessage);
  const serializedAppointments = appointmentRows.map(serializeAppointment);
  const serializedMedications = medicationRows.map(serializeMedicationSchedule);

  return {
    conversationId: conversation.id,
    messagesByMode: groupMessagesByMode(serializedMessages),
    appointments: serializedAppointments,
    medications: serializedMedications,
    medicalProfile: serializeMedicalProfile(profile),
    sidebarSummary: buildSidebarSummary(
      serializedAppointments,
      serializedMedications
    ),
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  WORKSPACE_MODES,
  buildWorkspaceBootstrap,
  fetchAppointments,
  fetchConversationMessages,
  fetchMedicationSchedules,
  fetchModeMessages,
  fetchRecentUserFacts,
  getOrCreateConversation,
  getUserProfile,
  groupMessagesByMode,
  incrementPromptCount,
  persistMessage,
  serializeAppointment,
  serializeMedicalProfile,
  serializeMedicationSchedule,
  serializeMessage,
  toIsoString,
};
