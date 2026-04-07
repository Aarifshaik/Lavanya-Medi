const { GoogleGenerativeAI } = require("@google/generative-ai");
const { WEEKDAY_NAMES } = require("./workspace-reminders");

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const NON_DIAGNOSTIC_NOTICE =
  "This is informational only and not a medical diagnosis. If you have chest pain, trouble breathing, stroke symptoms, suicidal thoughts, heavy bleeding, or rapidly worsening symptoms, seek urgent medical care immediately.";
const RETRYABLE_GEMINI_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function cleanString(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeMode(mode, supportedModes) {
  const value = String(mode || "").trim();
  return supportedModes.includes(value) ? value : null;
}

function toIsoString(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatConversationHistory(messages) {
  if (!messages.length) {
    return "No previous messages in this panel.";
  }

  return messages
    .map((message) => {
      const speaker = message.role === "assistant" ? "Assistant" : "User";
      return `${speaker}: ${message.content}`;
    })
    .join("\n\n");
}

function formatProfileContext(profile) {
  const serializedProfile = JSON.stringify(profile.profile || {}, null, 2);
  const summary = profile.summary || "No stored medical profile yet.";

  return `Stored profile summary:\n${summary}\n\nStored structured medical profile:\n${serializedProfile}`;
}

function formatAppointmentsContext(appointments) {
  if (!appointments.length) {
    return "No saved appointments.";
  }

  return appointments
    .slice(0, 12)
    .map(
      (appointment) =>
        `- ${appointment.title} at ${appointment.scheduledFor} (${appointment.timezone}) [${appointment.status}]${appointment.notes ? ` notes: ${appointment.notes}` : ""}`
    )
    .join("\n");
}

function formatMedicationContext(medications) {
  if (!medications.length) {
    return "No saved medication schedules.";
  }

  return medications
    .slice(0, 12)
    .map((schedule) => {
      const timing =
        schedule.scheduleType === "daily"
          ? `times: ${schedule.times.join(", ")}`
          : schedule.scheduleType === "weekly"
            ? `days: ${schedule.daysOfWeek.join(", ")} at ${schedule.times.join(", ")}`
            : `specific times: ${schedule.specificDatetimes.join(", ")}`;

      return `- ${schedule.medicationName}${schedule.dosage ? ` (${schedule.dosage})` : ""} | ${schedule.scheduleType} | ${timing}`;
    })
    .join("\n");
}

function stripMarkdownCodeFence(text) {
  const trimmed = String(text || "").trim();

  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function parseJsonPayload(text) {
  const stripped = stripMarkdownCodeFence(text);

  try {
    return JSON.parse(stripped);
  } catch (error) {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");

    if (start === -1 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(stripped.slice(start, end + 1));
    } catch (secondError) {
      return null;
    }
  }
}

function normalizeTimeValue(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeTimeArray(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeTimeValue).filter(Boolean))].sort();
}

function normalizeWeekday(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  const shortIndex = WEEKDAY_NAMES.findIndex(
    (weekday) => weekday.slice(0, 3) === normalized.slice(0, 3)
  );

  return shortIndex === -1 ? null : WEEKDAY_NAMES[shortIndex];
}

function normalizeWeekdayArray(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeWeekday).filter(Boolean))].sort(
    (left, right) => WEEKDAY_NAMES.indexOf(left) - WEEKDAY_NAMES.indexOf(right)
  );
}

function normalizeSpecificDatetimeArray(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => toIsoString(value))
      .filter(Boolean)
  )].sort();
}

function normalizeAppointmentRecord(record, clientTimezone) {
  const title =
    cleanString(record?.title) ||
    cleanString(record?.reason) ||
    cleanString(record?.appointmentReason) ||
    "Medical appointment";
  const scheduledForRaw =
    cleanString(record?.scheduledFor) ||
    cleanString(record?.dateTime) ||
    cleanString(record?.datetime);
  const timezone =
    cleanString(record?.timezone) || cleanString(record?.timeZone) || clientTimezone || "UTC";
  const notes = cleanString(record?.notes) || cleanString(record?.reason) || "";
  const missingFields = [];

  if (!scheduledForRaw || !scheduledForRaw.includes("T")) {
    missingFields.push("scheduledFor");
  }

  const scheduledFor = scheduledForRaw ? toIsoString(scheduledForRaw) : null;

  if (!scheduledFor && !missingFields.includes("scheduledFor")) {
    missingFields.push("scheduledFor");
  }

  return {
    missingFields,
    record:
      missingFields.length === 0
        ? {
            title,
            scheduledFor,
            timezone,
            notes,
            status: "scheduled",
          }
        : null,
  };
}

function normalizeMedicationRecord(record, clientTimezone) {
  const medicationName =
    cleanString(record?.medicationName) ||
    cleanString(record?.name) ||
    cleanString(record?.medicineName);
  const dosage = cleanString(record?.dosage) || cleanString(record?.dose) || "";
  const rawScheduleType = cleanString(record?.scheduleType) || cleanString(record?.frequency);
  const scheduleType = rawScheduleType
    ? {
        daily: "daily",
        everyday: "daily",
        weekly: "weekly",
        week: "weekly",
        seldom: "seldom",
        rare: "seldom",
        one_off: "seldom",
        onetime: "seldom",
        once: "seldom",
      }[rawScheduleType.toLowerCase()] || rawScheduleType.toLowerCase()
    : null;
  const times = normalizeTimeArray(record?.times || record?.timesOfDay || record?.timeSlots);
  const daysOfWeek = normalizeWeekdayArray(record?.daysOfWeek || record?.days);
  const specificDatetimes = normalizeSpecificDatetimeArray(
    record?.specificDatetimes || record?.dateTimes || record?.occurrences
  );
  const timezone =
    cleanString(record?.timezone) || cleanString(record?.timeZone) || clientTimezone || "UTC";
  const notes = cleanString(record?.notes) || "";
  const missingFields = [];

  if (!medicationName) {
    missingFields.push("medicationName");
  }

  if (!scheduleType || !["daily", "weekly", "seldom"].includes(scheduleType)) {
    missingFields.push("scheduleType");
  }

  if (scheduleType === "daily" && times.length === 0) {
    missingFields.push("times");
  }

  if (scheduleType === "weekly") {
    if (times.length === 0) {
      missingFields.push("times");
    }

    if (daysOfWeek.length === 0) {
      missingFields.push("daysOfWeek");
    }
  }

  if (scheduleType === "seldom" && specificDatetimes.length === 0) {
    missingFields.push("specificDatetimes");
  }

  return {
    missingFields,
    record:
      missingFields.length === 0
        ? {
            medicationName,
            dosage,
            scheduleType,
            times,
            daysOfWeek,
            specificDatetimes,
            timezone,
            notes,
            active: true,
          }
        : null,
  };
}

function formatDisplayDate(dateTime, timezone) {
  const date = new Date(dateTime);

  if (Number.isNaN(date.getTime())) {
    return String(dateTime);
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone || "UTC",
    }).format(date);
  } catch (error) {
    return date.toLocaleString();
  }
}

function buildAppointmentConfirmation(record) {
  return `I saved your appointment "${record.title}" for ${formatDisplayDate(
    record.scheduledFor,
    record.timezone
  )}. It will now appear in your appointment list and reminders.`;
}

function buildMedicationConfirmation(record) {
  let scheduleLine = "";

  if (record.scheduleType === "daily") {
    scheduleLine = `every day at ${record.times.join(", ")}`;
  } else if (record.scheduleType === "weekly") {
    scheduleLine = `${record.daysOfWeek.join(", ")} at ${record.times.join(", ")}`;
  } else {
    scheduleLine = `at ${record.specificDatetimes
      .map((value) => formatDisplayDate(value, record.timezone))
      .join(", ")}`;
  }

  return `I saved ${record.medicationName}${
    record.dosage ? ` (${record.dosage})` : ""
  } with a ${record.scheduleType} reminder schedule: ${scheduleLine}.`;
}

function appendMedicalSafetyNotice(mode, text) {
  if (!["preliminary_assessment", "symptom_analysis"].includes(mode)) {
    return text;
  }

  return `${String(text || "").trim()}\n\n${NON_DIAGNOSTIC_NOTICE}`;
}

function buildClinicalFallbackResponse(context) {
  if (!["preliminary_assessment", "symptom_analysis", "chat"].includes(context.mode)) {
    return null;
  }

  const combinedText = [context.history, [{ role: "user", content: context.message }]]
    .flat()
    .map((entry) => String(entry?.content || ""))
    .join(" ")
    .toLowerCase();

  const situationalTrigger = /(anxiety|fear|stress|nervous|panic|intense moment)/.test(
    combinedText
  );
  const sweatyHands = /(sweaty hands|sweaty palms|palms sweat|hands sweat|sweating)/.test(
    combinedText
  );
  const fasterHeartbeat = /(heartbeat|heart rate|racing heart|palpit)/.test(
    combinedText
  );
  const breathingOkay =
    /(no problem in breathing|no breathing problem|no shortness of breath|breathing is fine|breathing is okay)/.test(
      combinedText
    );

  let response;

  if (context.mode === "preliminary_assessment") {
    response = [
      "Based on what you've shared so far, this could fit a stress or anxiety response, especially if it happens during intense moments rather than at rest.",
      fasterHeartbeat
        ? "A faster heartbeat can also happen when adrenaline rises during fear or anxiety."
        : "The pattern and triggers are important for narrowing down what is most likely.",
      "To guide the next step: how long has this been happening, and does it ever occur when you are calm or sleeping?",
    ].join(" ");
  } else if (situationalTrigger && sweatyHands) {
    response = [
      "Because this seems to happen during intense anxious or fearful moments and not when you are calm, it can fit an adrenaline-driven stress response.",
      fasterHeartbeat
        ? breathingOkay
          ? "A faster heartbeat can happen with the same stress response, especially when breathing stays otherwise normal."
          : "A faster heartbeat can happen with stress, but it becomes more important to evaluate if it is accompanied by breathing trouble or dizziness."
        : "Palm sweating alone can also happen with anxiety or palmar hyperhidrosis.",
      "Helpful next steps are to track triggers, limit stimulants like excess caffeine before stressful events, and try slow breathing or grounding techniques when it starts.",
      "If it starts happening at rest, becomes frequent, or comes with chest pain, fainting, severe dizziness, or shortness of breath, please get medical care promptly.",
    ].join(" ");
  } else {
    response = [
      "I can still help think this through even though the live model response did not come back.",
      "Symptoms like this can have several explanations, so the timing, triggers, and any associated symptoms matter a lot.",
      context.mode === "symptom_analysis"
        ? "Please tell me whether this happens only during stress or also at rest, and whether you notice dizziness, chest pain, or breathing trouble with it."
        : "Please tell me whether this happens at rest as well, and whether you have dizziness, chest pain, fever, or breathing trouble with it.",
    ].join(" ");
  }

  return {
    assistantText: appendMedicalSafetyNotice(context.mode, response),
    action: "none",
    missingFields: [],
    structuredCandidate: null,
  };
}

function buildModePrompt({
  mode,
  message,
  clientTimezone,
  history,
  medicalProfile,
  appointments,
  medications,
}) {
  const now = new Date().toISOString();
  const profileContext = formatProfileContext(medicalProfile);
  const historyContext = formatConversationHistory(history);
  const appointmentContext = formatAppointmentsContext(appointments);
  const medicationContext = formatMedicationContext(medications);

  if (mode === "chat") {
    return `
You are MediChat, a helpful and careful medical support assistant.
Current time: ${now}
Client timezone: ${clientTimezone}

${profileContext}

Recent panel history:
${historyContext}

Respond conversationally, be empathetic, and do not claim to diagnose the patient.
If the user mentions urgent red-flag symptoms, tell them to seek urgent care immediately.

User message:
${message}
`.trim();
  }

  if (mode === "preliminary_assessment") {
    return `
You are MediChat conducting a preliminary assessment for a patient.
Current time: ${now}
Client timezone: ${clientTimezone}

${profileContext}

Recent panel history:
${historyContext}

Instructions:
- Ask one focused follow-up question at a time when important details are missing.
- Once you have enough information, provide a brief assessment with likely concerns, next steps, and clear urgent warning signs.
- Do not claim to diagnose the patient.
- Keep the tone calm, supportive, and direct.

User message:
${message}
`.trim();
  }

  if (mode === "symptom_analysis") {
    return `
You are MediChat helping with symptom analysis.
Current time: ${now}
Client timezone: ${clientTimezone}

${profileContext}

Recent panel history:
${historyContext}

Instructions:
- Ask concise clarifying questions when symptoms are incomplete.
- When enough detail is available, offer possible explanations or conditions, but clearly avoid definitive diagnosis.
- Always highlight urgent red flags that need immediate medical attention.
- Keep answers structured and easy to scan.

User message:
${message}
`.trim();
  }

  if (mode === "schedule_appointment") {
    return `
You are MediChat's appointment scheduling assistant.
Current time: ${now}
Client timezone: ${clientTimezone}

${profileContext}

Existing appointments:
${appointmentContext}

Recent panel history:
${historyContext}

Respond with JSON only and no markdown.
Required JSON shape:
{
  "assistantMessage": "string",
  "action": "none" | "create_appointment",
  "missingFields": ["title", "scheduledFor", "timezone"],
  "record": {
    "title": "string",
    "scheduledFor": "ISO 8601 datetime with offset",
    "timezone": "IANA timezone",
    "notes": "string"
  }
}

Rules:
- Use action "create_appointment" only when the user has provided an exact date and time plus the purpose/title.
- If the user asks what appointments exist, use action "none" and answer from Existing appointments.
- If details are missing, ask only for the missing details and list them in missingFields.
- Never invent an appointment or a hospital system confirmation.

User message:
${message}
`.trim();
  }

  return `
You are MediChat's medication tracking assistant.
Current time: ${now}
Client timezone: ${clientTimezone}

${profileContext}

Existing medication schedules:
${medicationContext}

Recent panel history:
${historyContext}

Respond with JSON only and no markdown.
Required JSON shape:
{
  "assistantMessage": "string",
  "action": "none" | "create_medication",
  "missingFields": ["medicationName", "scheduleType", "times", "daysOfWeek", "specificDatetimes"],
  "record": {
    "medicationName": "string",
    "dosage": "string",
    "scheduleType": "daily" | "weekly" | "seldom",
    "times": ["HH:MM"],
    "daysOfWeek": ["monday"],
    "specificDatetimes": ["ISO 8601 datetime with offset"],
    "timezone": "IANA timezone",
    "notes": "string"
  }
}

Rules:
- Use action "create_medication" only when the schedule is specific enough to store.
- daily requires at least one time.
- weekly requires at least one time and at least one day of week.
- seldom requires one or more exact datetimes.
- If the user asks what medications are stored, use action "none" and answer from Existing medication schedules.
- Ask only for the missing details if the schedule is incomplete.

User message:
${message}
`.trim();
}

function buildProfileRefreshPrompt(profile, userFacts, appointments, medications) {
  const factLines =
    userFacts.length > 0
      ? userFacts
          .map(
            (fact) =>
              `- [${fact.mode}] ${toIsoString(fact.created_at)}: ${fact.content}`
          )
          .join("\n")
      : "- No new user facts captured yet.";
  const appointmentContext = formatAppointmentsContext(appointments);
  const medicationContext = formatMedicationContext(medications);

  return `
You are updating a patient's structured medical profile from a conversation history.

Existing summary:
${profile.summary || "No previous summary."}

Existing structured profile:
${JSON.stringify(profile.profile || {}, null, 2)}

Known appointments:
${appointmentContext}

Known medications:
${medicationContext}

Recent patient facts:
${factLines}

Return JSON only and no markdown.
Required JSON shape:
{
  "summary": "short paragraph",
  "profile": {
    "conditions": ["..."],
    "medications": ["..."],
    "allergies": ["..."],
    "symptoms": ["..."],
    "appointments": ["..."],
    "lifestyle": ["..."],
    "notes": ["..."]
  }
}

Rules:
- Merge existing information with new information instead of deleting facts casually.
- Keep items concise and clinically useful.
- Do not invent facts that were not stated or strongly implied.
`.trim();
}

function getModel() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing from the backend environment");
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI.getGenerativeModel({
    model: GEMINI_MODEL,
  });
}

async function generateGeminiText(prompt) {
  let attempt = 0;
  let lastError = null;

  while (attempt < 3) {
    try {
      const model = getModel();
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = cleanString(response.text());

      if (text) {
        return text;
      }

      const blockReason =
        response?.promptFeedback?.blockReason ||
        response?.candidates?.[0]?.finishReason ||
        "empty_response";
      const error = new Error(`Gemini returned no text (${blockReason})`);
      error.statusCode = response?.status;
      throw error;
    } catch (error) {
      lastError = error;
      attempt += 1;

      const statusCode = Number(error?.status || error?.statusCode || error?.code);
      const message = String(error?.message || "").toLowerCase();
      const retryable =
        RETRYABLE_GEMINI_STATUS_CODES.has(statusCode) ||
        /timeout|timed out|temporar|unavailable|overloaded|rate limit|quota|network|econnreset|socket hang up|deadline/i.test(
          message
        );

      if (!retryable || attempt >= 3) {
        break;
      }

      await delay(300 * attempt);
    }
  }

  throw lastError || new Error("Gemini text generation failed");
}

async function generateModeResponse(context) {
  const prompt = buildModePrompt(context);
  const rawText = await generateGeminiText(prompt);

  if (context.mode === "schedule_appointment") {
    const parsed = parseJsonPayload(rawText);
    const assistantMessage =
      cleanString(parsed?.assistantMessage) ||
      "I need a little more detail before I can save that appointment.";
    const action = parsed?.action === "create_appointment" ? parsed.action : "none";
    const normalized = normalizeAppointmentRecord(parsed?.record || {}, context.clientTimezone);

    return {
      assistantText: assistantMessage,
      action,
      missingFields: normalized.missingFields,
      structuredCandidate:
        action === "create_appointment" && normalized.missingFields.length === 0
          ? {
              type: "appointment",
              record: normalized.record,
            }
          : null,
    };
  }

  if (context.mode === "medication_tracking") {
    const parsed = parseJsonPayload(rawText);
    const assistantMessage =
      cleanString(parsed?.assistantMessage) ||
      "I need a little more detail before I can save that medication schedule.";
    const action = parsed?.action === "create_medication" ? parsed.action : "none";
    const normalized = normalizeMedicationRecord(parsed?.record || {}, context.clientTimezone);

    return {
      assistantText: assistantMessage,
      action,
      missingFields: normalized.missingFields,
      structuredCandidate:
        action === "create_medication" && normalized.missingFields.length === 0
          ? {
              type: "medication",
              record: normalized.record,
            }
          : null,
    };
  }

  return {
    assistantText: appendMedicalSafetyNotice(context.mode, rawText),
    action: "none",
    missingFields: [],
    structuredCandidate: null,
  };
}

module.exports = {
  NON_DIAGNOSTIC_NOTICE,
  appendMedicalSafetyNotice,
  buildClinicalFallbackResponse,
  buildAppointmentConfirmation,
  buildMedicationConfirmation,
  buildProfileRefreshPrompt,
  cleanString,
  formatDisplayDate,
  generateGeminiText,
  generateModeResponse,
  normalizeMode,
  normalizeAppointmentRecord,
  normalizeMedicationRecord,
  parseJsonPayload,
};
