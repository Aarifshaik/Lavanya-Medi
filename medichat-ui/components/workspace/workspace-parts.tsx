"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  AppointmentRecord,
  ConversationMessage,
  MedicalProfile,
  MedicationSchedule,
  WorkspaceMode,
} from "@/lib/api";

export type WorkspaceSection = WorkspaceMode | "medical_profile";

export const SECTION_CONFIG: Array<{
  section: WorkspaceSection;
  label: string;
  short: string;
  description: string;
  placeholder?: string;
}> = [
  {
    section: "chat",
    label: "Chat",
    short: "C",
    description: "General medical support with your saved profile as context.",
    placeholder: "Ask MediChat anything about your care or health concerns...",
  },
  {
    section: "schedule_appointment",
    label: "Schedule Appointment",
    short: "A",
    description:
      "Describe the appointment you need and MediChat will save it as a reminder.",
    placeholder: "Example: Schedule a cardiology follow-up next Tuesday at 4:30 PM.",
  },
  {
    section: "medication_tracking",
    label: "Medication Tracking",
    short: "M",
    description:
      "Add medicines and reminder schedules using daily, weekly, or seldom timings.",
    placeholder: "Example: Remind me to take Metformin 500mg every day at 8:00 AM.",
  },
  {
    section: "symptom_analysis",
    label: "Symptom Analysis",
    short: "S",
    description:
      "Discuss symptoms, answer follow-up questions, and review possible explanations.",
    placeholder: "Describe your symptoms and when they started...",
  },
  {
    section: "preliminary_assessment",
    label: "Preliminary Assessment",
    short: "P",
    description:
      "A guided assessment where the AI asks questions and builds an initial picture.",
    placeholder: "Tell MediChat what is going on and it will guide the assessment...",
  },
  {
    section: "medical_profile",
    label: "Medical Profile",
    short: "R",
    description:
      "Review the generated medical summary and structured patient history.",
  },
];

export function formatDateTime(value: string, timezone?: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone || "UTC",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export function MessageList({ messages }: { messages: ConversationMessage[] }) {
  return (
    <div className="flex flex-col gap-3">
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn(
            "flex",
            message.role === "user" ? "justify-end" : "justify-start"
          )}
        >
          <div
            className={cn(
              "max-w-[92%] rounded-3xl px-4 py-3 text-sm leading-relaxed shadow-sm sm:max-w-[86%] lg:max-w-[78%]",
              message.role === "user"
                ? "rounded-br-md bg-primary text-primary-foreground"
                : "rounded-bl-md border border-border bg-card text-card-foreground"
            )}
          >
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
            <p
              className={cn(
                "mt-2 text-[10px] sm:text-[11px]",
                message.role === "user"
                  ? "text-primary-foreground/70"
                  : "text-muted-foreground"
              )}
            >
              {formatDateTime(message.createdAt)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="border-dashed border-border/70 bg-muted/20 shadow-none">
      <CardHeader className="px-4 sm:px-6">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

export function AppointmentSummary({
  appointments,
}: {
  appointments: AppointmentRecord[];
}) {
  const scheduled = appointments.filter(
    (appointment) => appointment.status === "scheduled"
  );

  return (
    <Card className="border border-border/60 bg-card/95 shadow-sm">
      <CardHeader className="px-4 sm:px-6">
        <CardTitle>Upcoming Appointments</CardTitle>
        <CardDescription>
          Stored appointments appear here and feed the in-page reminders.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-4 sm:px-6">
        {scheduled.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No appointments have been scheduled yet.
          </p>
        ) : (
          scheduled.slice(0, 4).map((appointment) => (
            <div
              key={appointment.id}
              className="rounded-3xl border border-border bg-background px-3 py-3 sm:px-4"
            >
              <p className="break-words font-medium text-foreground">
                {appointment.title}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {formatDateTime(appointment.scheduledFor, appointment.timezone)}
              </p>
              {appointment.notes ? (
                <p className="mt-2 break-words text-sm text-muted-foreground">
                  {appointment.notes}
                </p>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function MedicationSummary({
  medications,
}: {
  medications: MedicationSchedule[];
}) {
  const activeSchedules = medications.filter((schedule) => schedule.active);

  return (
    <Card className="border border-border/60 bg-card/95 shadow-sm">
      <CardHeader className="px-4 sm:px-6">
        <CardTitle>Medication Schedules</CardTitle>
        <CardDescription>
          Daily, weekly, and seldom reminder schedules are shown here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-4 sm:px-6">
        {activeSchedules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No medication reminders have been saved yet.
          </p>
        ) : (
          activeSchedules.slice(0, 5).map((schedule) => (
            <div
              key={schedule.id}
              className="rounded-3xl border border-border bg-background px-3 py-3 sm:px-4"
            >
              <p className="break-words font-medium text-foreground">
                {schedule.medicationName}
                {schedule.dosage ? ` · ${schedule.dosage}` : ""}
              </p>
              <p className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">
                {schedule.scheduleType === "daily"
                  ? `Every day at ${schedule.times.join(", ")}`
                  : schedule.scheduleType === "weekly"
                    ? `${schedule.daysOfWeek.join(", ")} at ${schedule.times.join(", ")}`
                    : schedule.specificDatetimes
                        .map((value) => formatDateTime(value, schedule.timezone))
                        .join(", ")}
              </p>
              {schedule.notes ? (
                <p className="mt-2 break-words text-sm text-muted-foreground">
                  {schedule.notes}
                </p>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function MedicalProfilePanel({ profile }: { profile: MedicalProfile | null }) {
  const entries = profile ? Object.entries(profile.profile || {}) : [];

  return (
    <div className="space-y-3 sm:space-y-4">
      <Card className="border border-border/60 bg-card/95 shadow-sm">
        <CardHeader className="px-4 sm:px-6">
          <CardTitle>Patient Summary</CardTitle>
          <CardDescription>
            This profile is regenerated every five patient prompts.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {profile?.summary || "No medical profile has been generated yet."}
          </p>
          {profile?.lastRegeneratedAt ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Last regenerated: {formatDateTime(profile.lastRegeneratedAt)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {entries.length === 0 ? null : entries.map(([section, value]) => (
        <Card key={section} className="border border-border/60 bg-card/95 shadow-sm">
          <CardHeader className="px-4 sm:px-6">
            <CardTitle className="capitalize">
              {section.replace(/_/g, " ")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 sm:px-6">
            {Array.isArray(value) ? (
              <div className="flex flex-wrap gap-2">
                {value.length > 0 ? value.map((item, index) => (
                  <span
                    key={`${section}-${index}`}
                    className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground"
                  >
                    {String(item)}
                  </span>
                )) : (
                  <p className="text-sm text-muted-foreground">No entries saved.</p>
                )}
              </div>
            ) : (
              <pre className="overflow-x-auto rounded-3xl bg-muted/35 p-3 text-xs text-muted-foreground sm:text-sm">
                {JSON.stringify(value, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
