require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");
const { ensureDatabaseReady, query, withTransaction } = require("./db");
const {
  WORKSPACE_MODES,
  buildWorkspaceBootstrap,
  fetchAppointments,
  fetchMedicationSchedules,
  fetchModeMessages,
  fetchRecentUserFacts,
  getOrCreateConversation,
  getUserProfile,
  incrementPromptCount,
  persistMessage,
  serializeAppointment,
  serializeMedicalProfile,
  serializeMedicationSchedule,
  serializeMessage,
  toIsoString,
} = require("./workspace-data");
const { buildSidebarSummary } = require("./workspace-reminders");
const {
  buildAppointmentConfirmation,
  buildClinicalFallbackResponse,
  buildMedicationConfirmation,
  buildProfileRefreshPrompt,
  cleanString,
  generateGeminiText,
  generateModeResponse,
  normalizeMode,
  normalizeAppointmentRecord,
  normalizeMedicationRecord,
  parseJsonPayload,
} = require("./ai");

const app = express();
const PORT = Number(process.env.PORT || 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";
const COOKIE_NAME = process.env.COOKIE_NAME || "medichat_token";
const JWT_SECRET = process.env.JWT_SECRET || "medichat-local-dev-secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const PROFILE_REFRESH_INTERVAL = 5;
const MAX_CONTEXT_MESSAGES = 14;
const isProduction = process.env.NODE_ENV === "production";

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

function normalizeUsername(username) {
  return String(username || "").trim();
}

function createToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
    },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN,
    }
  );
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
  });
}

function serializeUser(user) {
  return {
    id: Number(user.id),
    username: user.username,
    createdAt: toIsoString(user.created_at),
  };
}

function validateCredentials(username, password) {
  if (!username || !password) {
    return "Username and password are required";
  }

  if (username.length < 3 || username.length > 30) {
    return "Username must be between 3 and 30 characters";
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    return "Username can only contain letters, numbers, dots, hyphens, and underscores";
  }

  if (password.length < 8) {
    return "Password must be at least 8 characters long";
  }

  return null;
}

async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const result = await query(
      "SELECT id, username, created_at FROM users WHERE id = $1",
      [payload.sub]
    );

    if (result.rowCount === 0) {
      clearAuthCookie(res);
      return res.status(401).json({ error: "Session is no longer valid" });
    }

    req.user = result.rows[0];
    return next();
  } catch (error) {
    clearAuthCookie(res);
    return res.status(401).json({ error: "Session expired" });
  }
}

function inferStructuredFallback(mode, message, clientTimezone) {
  if (mode === "schedule_appointment") {
    const dateTimeMatch = message.match(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/
    );
    const titledMatch = message.match(/titled\s+(.+?)\s+on/i);
    const normalized = normalizeAppointmentRecord(
      {
        title: titledMatch?.[1] || "Medical appointment",
        scheduledFor: dateTimeMatch?.[0],
        timezone: clientTimezone,
        notes: message,
      },
      clientTimezone
    );

    if (!normalized.record) {
      return null;
    }

    return {
      assistantText: "I captured that appointment request.",
      action: "create_appointment",
      missingFields: [],
      structuredCandidate: {
        type: "appointment",
        record: normalized.record,
      },
    };
  }

  if (mode === "medication_tracking") {
    const scheduleMatch = message.match(
      /\b(daily|everyday|weekly|seldom|once|onetime)\b/i
    );
    const medicationMatch = message.match(
      /(?:track|remind me to take|take)\s+([A-Za-z][A-Za-z0-9\s-]*?)(?:\s+(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|units?)))?\s+(?:daily|everyday|weekly|seldom|once|onetime)\b/i
    );
    const timeMatches = [...message.matchAll(/\b\d{1,2}:\d{2}\b/g)].map(
      (match) => match[0]
    );
    const dayMatches = [
      ...message.matchAll(
        /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi
      ),
    ].map((match) => match[0]);
    const dateTimes = [
      ...message.matchAll(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g
      ),
    ].map((match) => match[0]);
    const normalized = normalizeMedicationRecord(
      {
        medicationName: medicationMatch?.[1],
        dosage: medicationMatch?.[2],
        scheduleType: scheduleMatch?.[1],
        times: timeMatches,
        daysOfWeek: dayMatches,
        specificDatetimes: dateTimes,
        timezone: clientTimezone,
        notes: message,
      },
      clientTimezone
    );

    if (!normalized.record) {
      return null;
    }

    return {
      assistantText: "I captured that medication reminder request.",
      action: "create_medication",
      missingFields: [],
      structuredCandidate: {
        type: "medication",
        record: normalized.record,
      },
    };
  }

  return null;
}

function uniqueItems(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()))];
}

function buildFallbackProfile(profile, userFacts, appointments, medications) {
  const existingProfile =
    profile.profile && typeof profile.profile === "object" ? profile.profile : {};
  const factTexts = userFacts.map((fact) => String(fact.content || ""));
  const joinedFacts = factTexts.join(" ").toLowerCase();
  const knownConditions = [
    "diabetes",
    "hypertension",
    "asthma",
    "thyroid",
    "arthritis",
    "anxiety",
    "depression",
    "migraine",
  ].filter((condition) => joinedFacts.includes(condition));
  const medicationsList = medications.map((medication) =>
    `${medication.medicationName}${medication.dosage ? ` (${medication.dosage})` : ""}`
  );
  const appointmentNotes = appointments.map(
    (appointment) => `${appointment.title} on ${appointment.scheduledFor}`
  );
  const symptoms = userFacts
    .filter(
      (fact) =>
        fact.mode === "symptom_analysis" || fact.mode === "preliminary_assessment"
    )
    .map((fact) => fact.content);
  const notes = userFacts.slice(-6).map(
    (fact) => `[${fact.mode}] ${String(fact.content || "")}`
  );

  const fallbackProfile = {
    conditions: uniqueItems([
      ...(Array.isArray(existingProfile.conditions)
        ? existingProfile.conditions
        : []),
      ...knownConditions,
    ]),
    medications: uniqueItems([
      ...(Array.isArray(existingProfile.medications)
        ? existingProfile.medications
        : []),
      ...medicationsList,
    ]),
    allergies: Array.isArray(existingProfile.allergies)
      ? existingProfile.allergies
      : [],
    symptoms: uniqueItems([
      ...(Array.isArray(existingProfile.symptoms) ? existingProfile.symptoms : []),
      ...symptoms,
    ]),
    appointments: uniqueItems([
      ...(Array.isArray(existingProfile.appointments)
        ? existingProfile.appointments
        : []),
      ...appointmentNotes,
    ]),
    lifestyle: Array.isArray(existingProfile.lifestyle)
      ? existingProfile.lifestyle
      : [],
    notes: uniqueItems([
      ...(Array.isArray(existingProfile.notes) ? existingProfile.notes : []),
      ...notes,
    ]),
  };

  const summaryParts = [];

  if (fallbackProfile.conditions.length > 0) {
    summaryParts.push(`Known conditions: ${fallbackProfile.conditions.join(", ")}.`);
  }
  if (fallbackProfile.medications.length > 0) {
    summaryParts.push(
      `Tracked medications: ${fallbackProfile.medications.join(", ")}.`
    );
  }
  if (fallbackProfile.appointments.length > 0) {
    summaryParts.push(
      `Upcoming appointments: ${fallbackProfile.appointments.join("; ")}.`
    );
  }
  if (fallbackProfile.symptoms.length > 0) {
    summaryParts.push(`Recent symptoms discussed: ${fallbackProfile.symptoms.join("; ")}.`);
  }

  return {
    summary:
      summaryParts.join(" ") ||
      "Medical history is still being built from the patient conversation.",
    profile: fallbackProfile,
  };
}

async function insertStructuredRecord(payload, executor) {
  if (!payload) {
    return null;
  }

  if (payload.type === "appointment") {
    const result = await query(
      `
        INSERT INTO appointments (
          id,
          user_id,
          title,
          scheduled_for,
          timezone,
          status,
          notes,
          source_message_id,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, 'scheduled', $6, $7, NOW(), NOW())
        RETURNING *
      `,
      [
        randomUUID(),
        payload.userId,
        payload.record.title,
        payload.record.scheduledFor,
        payload.record.timezone,
        payload.record.notes,
        payload.sourceMessageId,
      ],
      executor
    );

    return {
      type: "appointment",
      row: result.rows[0],
      assistantText: buildAppointmentConfirmation(payload.record),
    };
  }

  const result = await query(
    `
      INSERT INTO medication_schedules (
        id,
        user_id,
        medication_name,
        dosage,
        schedule_type,
        times_json,
        days_of_week_json,
        specific_datetimes_json,
        timezone,
        notes,
        active,
        source_message_id,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11, NOW(), NOW())
      RETURNING *
    `,
    [
      randomUUID(),
      payload.userId,
      payload.record.medicationName,
      payload.record.dosage,
      payload.record.scheduleType,
      JSON.stringify(payload.record.times),
      JSON.stringify(payload.record.daysOfWeek),
      JSON.stringify(payload.record.specificDatetimes),
      payload.record.timezone,
      payload.record.notes,
      payload.sourceMessageId,
    ],
    executor
  );

  return {
    type: "medication",
    row: result.rows[0],
    assistantText: buildMedicationConfirmation(payload.record),
  };
}

async function regenerateMedicalProfile(userId) {
  const [profile, userFacts, appointmentRows, medicationRows] = await Promise.all([
    getUserProfile(userId),
    fetchRecentUserFacts(userId),
    fetchAppointments(userId),
    fetchMedicationSchedules(userId),
  ]);
  const serializedProfile = serializeMedicalProfile(profile);
  const serializedAppointments = appointmentRows.map(serializeAppointment);
  const serializedMedications = medicationRows.map(serializeMedicationSchedule);
  let summary;
  let structuredProfile;

  try {
    const prompt = buildProfileRefreshPrompt(
      serializedProfile,
      userFacts,
      serializedAppointments,
      serializedMedications
    );
    const rawText = await generateGeminiText(prompt);
    const parsed = parseJsonPayload(rawText);

    summary = cleanString(parsed?.summary);
    structuredProfile =
      parsed?.profile && typeof parsed.profile === "object" ? parsed.profile : null;
  } catch (error) {
    summary = null;
    structuredProfile = null;
  }

  if (!summary || !structuredProfile) {
    const fallback = buildFallbackProfile(
      serializedProfile,
      userFacts,
      serializedAppointments,
      serializedMedications
    );
    summary = fallback.summary;
    structuredProfile = fallback.profile;
  }

  const result = await query(
    `
      UPDATE user_profiles
      SET summary = $2,
          profile_json = $3,
          last_regenerated_at = NOW(),
          last_profile_refresh_prompt_count = prompt_count,
          updated_at = NOW()
      WHERE user_id = $1
      RETURNING *
    `,
    [userId, summary, structuredProfile]
  );

  return result.rows[0];
}

async function processConversationMessage({ user, mode, message, clientTimezone }) {
  const normalizedMode = normalizeMode(mode, WORKSPACE_MODES);
  const trimmedMessage = cleanString(message);
  const safeTimezone = cleanString(clientTimezone) || "UTC";

  if (!normalizedMode) {
    const error = new Error("A valid workspace mode is required");
    error.statusCode = 400;
    throw error;
  }

  if (!trimmedMessage) {
    const error = new Error("A message is required");
    error.statusCode = 400;
    throw error;
  }

  const initialWrite = await withTransaction(async (client) => {
    const conversation = await getOrCreateConversation(user.id, client);
    const userMessage = await persistMessage(
      {
        conversationId: conversation.id,
        userId: user.id,
        mode: normalizedMode,
        role: "user",
        content: trimmedMessage,
      },
      client
    );
    const profileState = await incrementPromptCount(user.id, client);

    return {
      conversation,
      userMessage,
      profileState,
    };
  });

  const [historyRows, profileRow, appointmentRows, medicationRows] = await Promise.all([
    fetchModeMessages(initialWrite.conversation.id, normalizedMode, MAX_CONTEXT_MESSAGES),
    getUserProfile(user.id),
    normalizedMode === "schedule_appointment" ? fetchAppointments(user.id) : [],
    normalizedMode === "medication_tracking" ? fetchMedicationSchedules(user.id) : [],
  ]);

  let generated;

  try {
    generated = await generateModeResponse({
      mode: normalizedMode,
      message: trimmedMessage,
      clientTimezone: safeTimezone,
      history: historyRows.map(serializeMessage),
      medicalProfile: serializeMedicalProfile(profileRow),
      appointments: appointmentRows.map(serializeAppointment),
      medications: medicationRows.map(serializeMedicationSchedule),
    });
  } catch (error) {
    console.error(`Gemini generation error for ${normalizedMode}:`, error);
    generated =
      buildClinicalFallbackResponse({
        mode: normalizedMode,
        message: trimmedMessage,
        history: historyRows.map(serializeMessage),
      }) || inferStructuredFallback(normalizedMode, trimmedMessage, safeTimezone);
  }

  if (
    !generated &&
    (normalizedMode === "schedule_appointment" ||
      normalizedMode === "medication_tracking")
  ) {
    generated = inferStructuredFallback(normalizedMode, trimmedMessage, safeTimezone);
  }

  if (!generated) {
    const fallbackText =
      "I ran into a problem while generating a response. Please try again in a moment.";
    const assistantRow = await withTransaction(async (client) =>
      persistMessage(
        {
          conversationId: initialWrite.conversation.id,
          userId: user.id,
          mode: normalizedMode,
          role: "assistant",
          content: fallbackText,
          metadata: {
            error: true,
          },
        },
        client
      )
    );
    const [updatedProfile, appointments, medications] = await Promise.all([
      getUserProfile(user.id),
      fetchAppointments(user.id),
      fetchMedicationSchedules(user.id),
    ]);

    return {
      conversationId: initialWrite.conversation.id,
      userMessage: serializeMessage(initialWrite.userMessage),
      assistantMessage: serializeMessage(assistantRow),
      structuredInsert: null,
      profileRefresh: {
        triggered: false,
        completed: false,
      },
      medicalProfile: serializeMedicalProfile(updatedProfile),
      sidebarSummary: buildSidebarSummary(
        appointments.map(serializeAppointment),
        medications.map(serializeMedicationSchedule)
      ),
    };
  }

  if (
    !generated.structuredCandidate &&
    (normalizedMode === "schedule_appointment" ||
      normalizedMode === "medication_tracking")
  ) {
    const inferred = inferStructuredFallback(
      normalizedMode,
      trimmedMessage,
      safeTimezone
    );

    if (inferred?.structuredCandidate) {
      generated = inferred;
    }
  }

  const writeResult = await withTransaction(async (client) => {
    const structuredInsert = await insertStructuredRecord(
      generated.structuredCandidate
        ? {
            type: generated.structuredCandidate.type,
            userId: user.id,
            sourceMessageId: initialWrite.userMessage.id,
            record: generated.structuredCandidate.record,
          }
        : null,
      client
    );
    const assistantMessage = await persistMessage(
      {
        conversationId: initialWrite.conversation.id,
        userId: user.id,
        mode: normalizedMode,
        role: "assistant",
        content: structuredInsert
          ? structuredInsert.assistantText
          : generated.assistantText,
        metadata: {
          action: generated.action,
          missingFields: generated.missingFields,
          structuredInsert: structuredInsert
            ? {
                type: structuredInsert.type,
                record:
                  structuredInsert.type === "appointment"
                    ? serializeAppointment(structuredInsert.row)
                    : serializeMedicationSchedule(structuredInsert.row),
              }
            : null,
        },
      },
      client
    );

    return {
      assistantMessage,
      structuredInsert,
    };
  });

  let latestProfile = await getUserProfile(user.id);
  const profileRefreshDue =
    Number(latestProfile.prompt_count) -
      Number(latestProfile.last_profile_refresh_prompt_count) >=
    PROFILE_REFRESH_INTERVAL;
  const profileRefresh = {
    triggered: profileRefreshDue,
    completed: false,
  };

  if (profileRefreshDue) {
    try {
      latestProfile = await regenerateMedicalProfile(user.id);
      profileRefresh.completed = true;
    } catch (error) {
      console.error("Profile regeneration error:", error);
    }
  }

  const [latestAppointments, latestMedications] = await Promise.all([
    fetchAppointments(user.id),
    fetchMedicationSchedules(user.id),
  ]);
  const serializedAppointments = latestAppointments.map(serializeAppointment);
  const serializedMedications = latestMedications.map(serializeMedicationSchedule);

  return {
    conversationId: initialWrite.conversation.id,
    userMessage: serializeMessage(initialWrite.userMessage),
    assistantMessage: serializeMessage(writeResult.assistantMessage),
    structuredInsert: writeResult.structuredInsert
      ? {
          type: writeResult.structuredInsert.type,
          record:
            writeResult.structuredInsert.type === "appointment"
              ? serializeAppointment(writeResult.structuredInsert.row)
              : serializeMedicationSchedule(writeResult.structuredInsert.row),
        }
      : null,
    profileRefresh,
    medicalProfile: serializeMedicalProfile(latestProfile),
    appointments: serializedAppointments,
    medications: serializedMedications,
    sidebarSummary: buildSidebarSummary(
      serializedAppointments,
      serializedMedications
    ),
  };
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/auth/register", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || "");
  const validationError = validateCredentials(username, password);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await query(
      `
        INSERT INTO users (username, password_hash)
        VALUES ($1, $2)
        RETURNING id, username, created_at
      `,
      [username, passwordHash]
    );

    const user = result.rows[0];
    setAuthCookie(res, createToken(user));

    return res.status(201).json({ user: serializeUser(user) });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "That username is already taken" });
    }

    console.error("Register error:", error);
    return res.status(500).json({ error: "Unable to create account" });
  }
});

app.post("/auth/login", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || "");

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  try {
    const result = await query(
      `
        SELECT id, username, password_hash, created_at
        FROM users
        WHERE LOWER(username) = LOWER($1)
        LIMIT 1
      `,
      [username]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const user = result.rows[0];
    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    setAuthCookie(res, createToken(user));

    return res.json({ user: serializeUser(user) });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Unable to log in right now" });
  }
});

app.get("/auth/me", requireAuth, (req, res) => {
  res.json({ user: serializeUser(req.user) });
});

app.post("/auth/logout", (_req, res) => {
  clearAuthCookie(res);
  res.status(204).send();
});

app.get("/workspace/bootstrap", requireAuth, async (req, res) => {
  try {
    const payload = await buildWorkspaceBootstrap(req.user.id);
    return res.json(payload);
  } catch (error) {
    console.error("Workspace bootstrap error:", error);
    return res.status(500).json({ error: "Unable to load the patient workspace" });
  }
});

app.get("/medical-profile", requireAuth, async (req, res) => {
  try {
    const profile = await getUserProfile(req.user.id);
    return res.json({
      medicalProfile: serializeMedicalProfile(profile),
    });
  } catch (error) {
    console.error("Medical profile error:", error);
    return res.status(500).json({ error: "Unable to load the medical profile" });
  }
});

app.post("/conversation/message", requireAuth, async (req, res) => {
  try {
    const payload = await processConversationMessage({
      user: req.user,
      mode: req.body?.mode,
      message: req.body?.message,
      clientTimezone: req.body?.clientTimezone,
    });

    return res.json(payload);
  } catch (error) {
    console.error("Conversation message error:", error);
    return res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Unable to process the message" });
  }
});

app.post("/chat", requireAuth, async (req, res) => {
  try {
    const fallbackMessage =
      cleanString(req.body?.message) ||
      (Array.isArray(req.body?.messages)
        ? cleanString(
            [...req.body.messages]
              .reverse()
              .find((message) => message?.role === "user")?.content
          )
        : null);

    const payload = await processConversationMessage({
      user: req.user,
      mode: "chat",
      message: fallbackMessage,
      clientTimezone: req.body?.clientTimezone,
    });

    return res.json({
      reply: payload.assistantMessage.content,
      profileRefresh: payload.profileRefresh,
    });
  } catch (error) {
    console.error("Legacy chat error:", error);
    return res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Unable to process the chat message" });
  }
});

async function startServer() {
  await ensureDatabaseReady();

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
