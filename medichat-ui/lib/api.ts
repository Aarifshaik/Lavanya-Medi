export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export const WORKSPACE_MODES = [
  "chat",
  "schedule_appointment",
  "medication_tracking",
  "symptom_analysis",
  "preliminary_assessment",
] as const;

export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];

export interface AuthUser {
  id: number;
  username: string;
  createdAt: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  userId: number;
  mode: WorkspaceMode;
  role: "user" | "assistant";
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AppointmentRecord {
  id: string;
  userId: number;
  title: string;
  scheduledFor: string;
  timezone: string;
  status: string;
  notes: string;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MedicationSchedule {
  id: string;
  userId: number;
  medicationName: string;
  dosage: string;
  scheduleType: "daily" | "weekly" | "seldom";
  times: string[];
  daysOfWeek: string[];
  specificDatetimes: string[];
  timezone: string;
  notes: string;
  active: boolean;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MedicalProfile {
  summary: string;
  profile: Record<string, unknown>;
  promptCount: number;
  lastProfileRefreshPromptCount: number;
  lastRegeneratedAt: string | null;
  profileRefreshDue: boolean;
}

export interface ReminderEvent {
  id: string;
  type: "appointment" | "medication";
  recordId: string;
  title: string;
  detail: string;
  scheduledFor: string;
}

export interface SidebarSummary {
  appointmentOverdueCount: number;
  nextAppointment: ReminderEvent | null;
  medicationOverdueCount: number;
  nextMedicationReminder: ReminderEvent | null;
}

export interface WorkspaceBootstrapResponse {
  conversationId: string;
  messagesByMode: Record<WorkspaceMode, ConversationMessage[]>;
  appointments: AppointmentRecord[];
  medications: MedicationSchedule[];
  medicalProfile: MedicalProfile;
  sidebarSummary: SidebarSummary;
  generatedAt: string;
}

export interface ConversationMessageResponse {
  conversationId: string;
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  structuredInsert: {
    type: "appointment" | "medication";
    record: AppointmentRecord | MedicationSchedule;
  } | null;
  profileRefresh: {
    triggered: boolean;
    completed: boolean;
  };
  medicalProfile: MedicalProfile;
  appointments: AppointmentRecord[];
  medications: MedicationSchedule[];
  sidebarSummary: SidebarSummary;
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);

  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
}

export async function readApiError(response: Response) {
  try {
    const data = await response.json();
    return data?.error || `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}
