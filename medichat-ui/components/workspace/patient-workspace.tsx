"use client";

import {
  List,
  Microphone,
  MicrophoneSlash,
  StopCircle,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  apiFetch,
  readApiError,
  type AppointmentRecord,
  type AuthUser,
  type ConversationMessage,
  type ConversationMessageResponse,
  type MedicalProfile,
  type MedicationSchedule,
  type ReminderEvent,
  type SidebarSummary,
  type WorkspaceBootstrapResponse,
  type WorkspaceMode,
} from "@/lib/api";
import { buildSidebarSummary, getDueReminderEvents } from "@/lib/reminders";
import { useBrowserSpeechRecognition } from "@/lib/use-browser-speech";
import { cn } from "@/lib/utils";
import {
  AppointmentSummary,
  EmptyState,
  formatDateTime,
  MedicalProfilePanel,
  MedicationSummary,
  MessageList,
  SECTION_CONFIG,
  type WorkspaceSection,
} from "@/components/workspace/workspace-parts";

const REMINDER_STORAGE_KEY = "medichat-seen-reminders";

function createEmptyMessagesByMode() {
  const state: Record<WorkspaceMode, ConversationMessage[]> = {
    chat: [],
    schedule_appointment: [],
    medication_tracking: [],
    symptom_analysis: [],
    preliminary_assessment: [],
  };

  return state;
}

function createEmptyComposerState() {
  const state: Record<WorkspaceMode, string> = {
    chat: "",
    schedule_appointment: "",
    medication_tracking: "",
    symptom_analysis: "",
    preliminary_assessment: "",
  };

  return state;
}

function normalizeMessagesByMode(
  value: WorkspaceBootstrapResponse["messagesByMode"] | undefined
) {
  const emptyState = createEmptyMessagesByMode();

  for (const mode of Object.keys(emptyState) as WorkspaceMode[]) {
    emptyState[mode] = Array.isArray(value?.[mode]) ? value[mode] : [];
  }

  return emptyState;
}

function normalizeAppointments(value: AppointmentRecord[] | undefined) {
  return Array.isArray(value) ? value : [];
}

function normalizeMedications(value: MedicationSchedule[] | undefined) {
  return Array.isArray(value) ? value : [];
}

function readSeenReminderIds() {
  try {
    const raw = window.sessionStorage.getItem(REMINDER_STORAGE_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
}

function persistSeenReminderIds(ids: Set<string>) {
  window.sessionStorage.setItem(
    REMINDER_STORAGE_KEY,
    JSON.stringify(Array.from(ids))
  );
}

function mergeVoiceDraft(
  baseValue: string,
  finalTranscript: string,
  interimTranscript = ""
) {
  const spokenText = [finalTranscript, interimTranscript]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();

  if (!spokenText) {
    return baseValue;
  }

  const needsSeparator = Boolean(baseValue) && !/\s$/.test(baseValue);
  return `${baseValue}${needsSeparator ? " " : ""}${spokenText}`.trim();
}

function WorkspaceNavigation({
  currentUser,
  selectedSection,
  liveSidebarSummary,
  onClose,
  onHide,
  onLogout,
  onSectionSelect,
  mobile = false,
}: {
  currentUser: AuthUser;
  selectedSection: WorkspaceSection;
  liveSidebarSummary: SidebarSummary;
  onClose?: () => void;
  onHide?: () => void;
  onLogout: () => void;
  onSectionSelect: (section: WorkspaceSection) => void;
  mobile?: boolean;
}) {
  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex min-h-16 items-center justify-between border-b border-border px-4 sm:px-5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            Patient Workspace
          </p>
          <p className="truncate text-xs text-muted-foreground">
            @{currentUser.username}
          </p>
        </div>
        {mobile ? (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close sections menu"
          >
            <X weight="bold" />
          </Button>
        ) : onHide ? (
          <Button type="button" variant="outline" size="sm" onClick={onHide}>
            Hide
          </Button>
        ) : null}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3 sm:p-4">
        {SECTION_CONFIG.map((item) => (
          <button
            key={item.section}
            type="button"
            onClick={() => onSectionSelect(item.section)}
            className={cn(
              "w-full rounded-3xl border px-3 py-3 text-left transition-colors sm:px-4",
              selectedSection === item.section
                ? "border-primary/30 bg-primary/10"
                : "border-transparent bg-background hover:border-border hover:bg-accent/60"
            )}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {item.short}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium leading-tight text-foreground">
                  {item.label}
                </p>
                {item.section === "schedule_appointment" &&
                liveSidebarSummary.nextAppointment ? (
                  <p className="truncate pt-1 text-xs text-muted-foreground">
                    Next:{" "}
                    {formatDateTime(
                      liveSidebarSummary.nextAppointment.scheduledFor
                    )}
                  </p>
                ) : null}
                {item.section === "medication_tracking" &&
                liveSidebarSummary.nextMedicationReminder ? (
                  <p className="truncate pt-1 text-xs text-muted-foreground">
                    Next:{" "}
                    {formatDateTime(
                      liveSidebarSummary.nextMedicationReminder.scheduledFor
                    )}
                  </p>
                ) : null}
              </div>
              {item.section === "schedule_appointment" &&
              liveSidebarSummary.appointmentOverdueCount > 0 ? (
                <span className="rounded-full bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
                  {liveSidebarSummary.appointmentOverdueCount}
                </span>
              ) : null}
              {item.section === "medication_tracking" &&
              liveSidebarSummary.medicationOverdueCount > 0 ? (
                <span className="rounded-full bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
                  {liveSidebarSummary.medicationOverdueCount}
                </span>
              ) : null}
            </div>
          </button>
        ))}
      </div>

      {mobile ? (
        <div className="border-t border-border p-3 sm:p-4">
          <Button
            type="button"
            variant="outline"
            onClick={onLogout}
            className="w-full justify-center"
          >
            Logout
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ReminderToastStack({
  reminders,
  onOpen,
  onDismiss,
}: {
  reminders: ReminderEvent[];
  onOpen: (event: ReminderEvent) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+10rem)] z-50 mx-auto flex max-w-md flex-col gap-3 sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-auto sm:mx-0 sm:max-w-sm">
      {reminders.map((reminder) => (
        <div
          key={reminder.id}
          className="pointer-events-auto rounded-3xl border border-border bg-card p-4 shadow-lg"
        >
          <p className="font-medium text-foreground">{reminder.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDateTime(reminder.scheduledFor)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{reminder.detail}</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button size="sm" onClick={() => onOpen(reminder)}>
              View details
            </Button>
            <Button size="sm" variant="outline" onClick={() => onDismiss(reminder.id)}>
              Dismiss
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReminderModal({
  reminder,
  appointment,
  medication,
  onClose,
}: {
  reminder: ReminderEvent | null;
  appointment: AppointmentRecord | null;
  medication: MedicationSchedule | null;
  onClose: () => void;
}) {
  if (!reminder) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:px-4">
      <Card className="max-h-[85svh] w-full rounded-t-[1.75rem] border border-border/60 bg-card shadow-xl sm:max-w-lg sm:rounded-4xl">
        <CardHeader className="flex flex-col items-start justify-between gap-3 border-b border-border/60 px-4 pb-4 sm:flex-row sm:gap-4 sm:px-6">
          <div>
            <CardTitle>{reminder.title}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatDateTime(
                reminder.scheduledFor,
                appointment?.timezone || medication?.timezone
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="self-start"
          >
            Close
          </Button>
        </CardHeader>
        <CardContent className="max-h-[60svh] space-y-3 overflow-y-auto px-4 pb-5 text-sm text-muted-foreground sm:px-6">
          {appointment ? (
            <>
              <p>Status: {appointment.status}</p>
              {appointment.notes ? <p>Notes: {appointment.notes}</p> : null}
            </>
          ) : null}
          {medication ? (
            <>
              <p>Dosage: {medication.dosage || "Not provided"}</p>
              <p>Schedule: {medication.scheduleType}</p>
              {medication.scheduleType === "daily" ? (
                <p>Times: {medication.times.join(", ")}</p>
              ) : null}
              {medication.scheduleType === "weekly" ? (
                <p>
                  {medication.daysOfWeek.join(", ")} at{" "}
                  {medication.times.join(", ")}
                </p>
              ) : null}
              {medication.scheduleType === "seldom"
                ? medication.specificDatetimes.map((dateTime) => (
                    <p key={dateTime}>
                      {formatDateTime(dateTime, medication.timezone)}
                    </p>
                  ))
                : null}
              {medication.notes ? <p>Notes: {medication.notes}</p> : null}
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function PatientWorkspace() {
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voiceSessionRef = useRef<{
    mode: WorkspaceMode | null;
    baseValue: string;
  }>({
    mode: null,
    baseValue: "",
  });
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [selectedSection, setSelectedSection] = useState<WorkspaceSection>("chat");
  const [messagesByMode, setMessagesByMode] = useState(createEmptyMessagesByMode);
  const [composerValues, setComposerValues] = useState(createEmptyComposerState);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [medications, setMedications] = useState<MedicationSchedule[]>([]);
  const [medicalProfile, setMedicalProfile] = useState<MedicalProfile | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [sendingMode, setSendingMode] = useState<WorkspaceMode | null>(null);
  const [profileRefreshing, setProfileRefreshing] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [reminderClock, setReminderClock] = useState(() => new Date());
  const [reminders, setReminders] = useState<ReminderEvent[]>([]);
  const [activeReminder, setActiveReminder] = useState<ReminderEvent | null>(null);
  const [voiceSessionMode, setVoiceSessionMode] = useState<WorkspaceMode | null>(null);
  const {
    error: voiceError,
    finalTranscript: voiceFinalTranscript,
    interimTranscript: voiceInterimTranscript,
    isListening: isVoiceListening,
    isSupported: isVoiceSupported,
    startListening,
    stopListening,
  } = useBrowserSpeechRecognition("en-IN");

  const activeMode = selectedSection === "medical_profile" ? null : selectedSection;
  const activeMessages = activeMode ? messagesByMode[activeMode] : [];
  const activeConfig = SECTION_CONFIG.find((item) => item.section === selectedSection);
  const liveSidebarSummary = buildSidebarSummary(appointments, medications, reminderClock);
  const isVoiceListeningForActiveMode =
    Boolean(activeMode) &&
    voiceSessionMode === activeMode &&
    isVoiceListening;
  const voiceDraftReady =
    Boolean(activeMode) &&
    voiceSessionMode === activeMode &&
    !isVoiceListening &&
    Boolean(voiceFinalTranscript);
  const voiceButtonDisabled = Boolean(sendingMode) || !isVoiceSupported;
  const voiceHelperText = voiceError
    ? voiceError
    : !isVoiceSupported
      ? "Voice input is available in supported browsers such as Chrome or Edge."
      : isVoiceListeningForActiveMode
        ? "Listening in English (India). Speak now, then tap the mic again or pause to stop."
        : voiceDraftReady
          ? "Voice prompt captured. Review it here before sending."
          : "Use voice input to dictate your prompt before sending.";

  useEffect(() => {
    let ignore = false;

    async function loadWorkspace() {
      try {
        const [authResponse, workspaceResponse] = await Promise.all([
          apiFetch("/auth/me"),
          apiFetch("/workspace/bootstrap"),
        ]);
        if (!authResponse.ok || !workspaceResponse.ok) {
          router.replace("/login");
          return;
        }

        const authData = (await authResponse.json()) as { user: AuthUser };
        const workspaceData = (await workspaceResponse.json()) as WorkspaceBootstrapResponse;

        if (!ignore) {
          setCurrentUser(authData.user);
          setMessagesByMode(normalizeMessagesByMode(workspaceData.messagesByMode));
          setAppointments(normalizeAppointments(workspaceData.appointments));
          setMedications(normalizeMedications(workspaceData.medications));
          setMedicalProfile(workspaceData.medicalProfile ?? null);
          setLoadingWorkspace(false);
        }
      } catch {
        if (!ignore) {
          router.replace("/login");
        }
      }
    }

    loadWorkspace();

    return () => {
      ignore = true;
    };
  }, [router]);

  useEffect(() => {
    const timer = window.setInterval(() => setReminderClock(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (loadingWorkspace) {
      return;
    }

    const seen = readSeenReminderIds();
    const unseen = getDueReminderEvents(appointments, medications, reminderClock).filter(
      (event) => !seen.has(event.id)
    );
    if (unseen.length === 0) {
      return;
    }

    unseen.forEach((event) => seen.add(event.id));
    persistSeenReminderIds(seen);
    setReminders((current) => [
      ...current,
      ...unseen.filter((event) => !current.some((item) => item.id === event.id)),
    ]);
  }, [appointments, loadingWorkspace, medications, reminderClock]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesByMode, selectedSection, sendingMode]);

  useEffect(() => {
    if (!textareaRef.current || !activeMode) {
      return;
    }

    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(
      textareaRef.current.scrollHeight,
      200
    )}px`;
  }, [activeMode, composerValues]);

  useEffect(() => {
    if (!voiceSessionMode) {
      return;
    }

    const nextValue = mergeVoiceDraft(
      voiceSessionRef.current.baseValue,
      voiceFinalTranscript,
      voiceInterimTranscript
    );

    setComposerValues((current) => {
      if (current[voiceSessionMode] === nextValue) {
        return current;
      }

      return {
        ...current,
        [voiceSessionMode]: nextValue,
      };
    });
  }, [voiceFinalTranscript, voiceInterimTranscript, voiceSessionMode]);

  useEffect(() => {
    if (!isVoiceListening || !voiceSessionMode || activeMode === voiceSessionMode) {
      return;
    }

    stopListening();
  }, [activeMode, isVoiceListening, stopListening, voiceSessionMode]);

  async function handleLogout() {
    try {
      stopListening();
      setMobileNavOpen(false);
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
    }
  }

  async function handleSend() {
    if (!activeMode) {
      return;
    }

    const message = composerValues[activeMode].trim();
    if (!message || sendingMode || isVoiceListening) {
      return;
    }

    const nextPromptCount = (medicalProfile?.promptCount || 0) + 1;
    const refreshOffset =
      nextPromptCount - (medicalProfile?.lastProfileRefreshPromptCount || 0);

    setPanelError(null);
    setSendingMode(activeMode);
    setProfileRefreshing(refreshOffset >= 5);

    try {
      const response = await apiFetch("/conversation/message", {
        method: "POST",
        body: JSON.stringify({
          mode: activeMode,
          message,
          clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as ConversationMessageResponse;
      setMessagesByMode((current) => ({
        ...current,
        [activeMode]: [
          ...(current[activeMode] || []),
          payload.userMessage,
          payload.assistantMessage,
        ],
      }));
      setComposerValues((current) => ({ ...current, [activeMode]: "" }));
      setAppointments(normalizeAppointments(payload.appointments));
      setMedications(normalizeMedications(payload.medications));
      setMedicalProfile(payload.medicalProfile ?? null);
      if (voiceSessionMode === activeMode) {
        setVoiceSessionMode(null);
      }
    } catch (error) {
      setPanelError(
        error instanceof Error ? error.message : "Unable to send the message"
      );
    } finally {
      setSendingMode(null);
      setProfileRefreshing(false);
    }
  }

  function handleSectionSelect(section: WorkspaceSection) {
    setSelectedSection(section);
    setMobileNavOpen(false);
  }

  function handleVoiceToggle() {
    if (!activeMode || voiceButtonDisabled) {
      return;
    }

    if (isVoiceListeningForActiveMode) {
      stopListening();
      return;
    }

    setPanelError(null);
    voiceSessionRef.current = {
      mode: activeMode,
      baseValue: composerValues[activeMode],
    };
    setVoiceSessionMode(activeMode);
    startListening();
  }

  if (loadingWorkspace) {
    return (
      <div className="flex min-h-[100dvh] w-full items-center justify-center bg-background px-6 text-center text-sm text-muted-foreground">
        Loading the patient workspace...
      </div>
    );
  }

  if (!currentUser) {
    return null;
  }

  const reminderAppointment =
    activeReminder?.type === "appointment"
      ? appointments.find((item) => item.id === activeReminder.recordId) || null
      : null;
  const reminderMedication =
    activeReminder?.type === "medication"
      ? medications.find((item) => item.id === activeReminder.recordId) || null
      : null;

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] w-full overflow-hidden bg-background text-foreground">
      <div
        className={cn(
          "fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
          mobileNavOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setMobileNavOpen(false)}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-[min(21rem,calc(100vw-1rem))] max-w-full border-r border-border shadow-xl transition-transform duration-300 lg:hidden",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <WorkspaceNavigation
          currentUser={currentUser}
          selectedSection={selectedSection}
          liveSidebarSummary={liveSidebarSummary}
          onClose={() => setMobileNavOpen(false)}
          onLogout={handleLogout}
          onSectionSelect={handleSectionSelect}
          mobile
        />
      </aside>

      <aside
        className={cn(
          "hidden border-r border-border bg-sidebar transition-all duration-300 lg:flex lg:flex-col",
          sidebarCollapsed ? "lg:w-0 lg:overflow-hidden lg:border-r-0" : "lg:w-72 xl:w-80"
        )}
      >
        <WorkspaceNavigation
          currentUser={currentUser}
          selectedSection={selectedSection}
          liveSidebarSummary={liveSidebarSummary}
          onHide={() => setSidebarCollapsed(true)}
          onLogout={handleLogout}
          onSectionSelect={handleSectionSelect}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex min-h-16 shrink-0 flex-wrap items-start gap-3 border-b border-border px-3 py-3 sm:px-4 lg:min-h-16 lg:flex-nowrap lg:items-center lg:py-0">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden"
            >
              <List weight="bold" />
              Sections
            </Button>
            {sidebarCollapsed ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSidebarCollapsed(false)}
                className="hidden lg:inline-flex"
              >
                Menu
              </Button>
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                {activeConfig?.label}
              </p>
              <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
                {activeConfig?.description}
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 lg:ml-auto lg:flex">
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              @{currentUser.username}
            </span>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </header>

        {profileRefreshing ? (
          <div className="border-b border-border bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Medical profile is regenerating. Please wait...
          </div>
        ) : null}

        <main className="flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 sm:gap-4">
            {selectedSection === "schedule_appointment" ? (
              <AppointmentSummary appointments={appointments} />
            ) : null}
            {selectedSection === "medication_tracking" ? (
              <MedicationSummary medications={medications} />
            ) : null}
            {selectedSection === "medical_profile" ? (
              <MedicalProfilePanel profile={medicalProfile} />
            ) : (
              <Card className="border border-border/60 bg-card/95 shadow-sm">
                <CardHeader className="px-4 sm:px-6">
                  <CardTitle>{activeConfig?.label}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 px-4 sm:px-6">
                  {activeMessages.length === 0 ? (
                    <EmptyState
                      title={`Start ${activeConfig?.label}`}
                      description={activeConfig?.placeholder || "Begin typing to interact with this panel."}
                    />
                  ) : (
                    <MessageList messages={activeMessages} />
                  )}
                  <div ref={bottomRef} />
                </CardContent>
              </Card>
            )}
          </div>
        </main>

        {activeMode ? (
          <footer
            className="shrink-0 border-t border-border bg-background px-3 pt-3 sm:px-4 sm:pt-4"
            style={{
              paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)",
            }}
          >
            <div className="mx-auto w-full max-w-5xl">
              {panelError ? (
                <div className="mb-3 rounded-3xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {panelError}
                </div>
              ) : null}
              <div className="rounded-3xl border border-border bg-card px-3 py-3 shadow-sm sm:px-4">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={composerValues[activeMode]}
                  onChange={(event) => setComposerValues((current) => ({ ...current, [activeMode]: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={activeConfig?.placeholder}
                  disabled={Boolean(sendingMode) || isVoiceListeningForActiveMode}
                  className="min-h-[84px] max-h-[200px] w-full resize-none overflow-y-auto bg-transparent text-base leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50 sm:min-h-0 sm:text-sm"
                />
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p
                      aria-live="polite"
                      className={cn(
                        "text-[11px]",
                        voiceError
                          ? "text-destructive"
                          : isVoiceListeningForActiveMode
                            ? "text-primary"
                            : "text-muted-foreground"
                      )}
                    >
                      {voiceHelperText}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Press Enter to send and Shift+Enter for a new line.
                    </p>
                  </div>
                  <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-none">
                    <Button
                      type="button"
                      variant={isVoiceListeningForActiveMode ? "destructive" : "outline"}
                      onClick={handleVoiceToggle}
                      disabled={voiceButtonDisabled}
                      aria-pressed={isVoiceListeningForActiveMode}
                      aria-label={
                        isVoiceListeningForActiveMode
                          ? "Stop voice input"
                          : "Start voice input"
                      }
                      className="w-full justify-center sm:w-auto"
                    >
                      {!isVoiceSupported ? (
                        <MicrophoneSlash weight="fill" />
                      ) : isVoiceListeningForActiveMode ? (
                        <StopCircle weight="fill" />
                      ) : (
                        <Microphone weight="fill" />
                      )}
                      <span className="sm:hidden">
                        {isVoiceListeningForActiveMode ? "Stop" : "Voice"}
                      </span>
                      <span className="hidden sm:inline">
                        {isVoiceListeningForActiveMode ? "Stop voice" : "Voice input"}
                      </span>
                    </Button>
                    <Button
                      onClick={() => void handleSend()}
                      disabled={
                        !composerValues[activeMode].trim() ||
                        Boolean(sendingMode) ||
                        isVoiceListeningForActiveMode
                      }
                      className="w-full justify-center sm:w-auto"
                    >
                      {sendingMode ? "Working..." : "Send"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </footer>
        ) : null}
      </div>

      <ReminderToastStack
        reminders={reminders}
        onOpen={(event) => {
          setActiveReminder(event);
          setReminders((current) => current.filter((item) => item.id !== event.id));
        }}
        onDismiss={(id) => setReminders((current) => current.filter((item) => item.id !== id))}
      />
      <ReminderModal
        reminder={activeReminder}
        appointment={reminderAppointment}
        medication={reminderMedication}
        onClose={() => setActiveReminder(null)}
      />
    </div>
  );
}
