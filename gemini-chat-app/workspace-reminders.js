const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function getReminderEventTime(event) {
  return new Date(event.scheduledFor).getTime();
}

function buildAppointmentReminderEvent(appointment) {
  return {
    id: `appointment:${appointment.id}`,
    type: "appointment",
    recordId: appointment.id,
    title: appointment.title,
    detail: appointment.notes || "Upcoming appointment reminder",
    scheduledFor: appointment.scheduledFor,
  };
}

function setTimeOnReference(reference, timeValue) {
  const [hours, minutes] = String(timeValue).split(":").map(Number);
  const date = new Date(reference);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function addDays(reference, days) {
  const date = new Date(reference);
  date.setDate(date.getDate() + days);
  return date;
}

function buildMedicationReminderEvent(schedule, occurrence) {
  return {
    id: `medication:${schedule.id}:${occurrence.toISOString()}`,
    type: "medication",
    recordId: schedule.id,
    title: schedule.medicationName,
    detail: schedule.dosage || `${schedule.scheduleType} medication reminder`,
    scheduledFor: occurrence.toISOString(),
  };
}

function getWeeklyNextOccurrence(now, weekday, timeValue) {
  const targetIndex = WEEKDAY_NAMES.indexOf(weekday);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  let offset = targetIndex - today.getDay();
  const sameDayTime = setTimeOnReference(today, timeValue);

  if (offset < 0 || (offset === 0 && sameDayTime <= now)) {
    offset += 7;
  }

  return setTimeOnReference(addDays(today, offset), timeValue);
}

function getWeeklyPreviousOccurrence(now, weekday, timeValue) {
  const targetIndex = WEEKDAY_NAMES.indexOf(weekday);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  let offset = targetIndex - today.getDay();
  const sameDayTime = setTimeOnReference(today, timeValue);

  if (offset > 0 || (offset === 0 && sameDayTime > now)) {
    offset -= 7;
  }

  return setTimeOnReference(addDays(today, offset), timeValue);
}

function getMedicationReminderSummary(schedule, now = new Date()) {
  if (!schedule.active) {
    return {
      overdue: [],
      next: null,
    };
  }

  const overdue = [];
  const nextCandidates = [];
  const lookbackDay = 1000 * 60 * 60 * 24;
  const lookbackWeek = lookbackDay * 7;

  if (schedule.scheduleType === "daily") {
    for (const timeValue of schedule.times || []) {
      const todayOccurrence = setTimeOnReference(now, timeValue);

      if (todayOccurrence <= now && now.getTime() - todayOccurrence.getTime() <= lookbackDay) {
        overdue.push(buildMedicationReminderEvent(schedule, todayOccurrence));
      }

      const nextOccurrence =
        todayOccurrence > now ? todayOccurrence : setTimeOnReference(addDays(now, 1), timeValue);
      nextCandidates.push(buildMedicationReminderEvent(schedule, nextOccurrence));
    }
  } else if (schedule.scheduleType === "weekly") {
    for (const weekday of schedule.daysOfWeek || []) {
      for (const timeValue of schedule.times || []) {
        const previousOccurrence = getWeeklyPreviousOccurrence(now, weekday, timeValue);
        const nextOccurrence = getWeeklyNextOccurrence(now, weekday, timeValue);

        if (
          previousOccurrence <= now &&
          now.getTime() - previousOccurrence.getTime() <= lookbackWeek
        ) {
          overdue.push(buildMedicationReminderEvent(schedule, previousOccurrence));
        }

        nextCandidates.push(buildMedicationReminderEvent(schedule, nextOccurrence));
      }
    }
  } else {
    for (const dateTime of schedule.specificDatetimes || []) {
      const occurrence = new Date(dateTime);

      if (Number.isNaN(occurrence.getTime())) {
        continue;
      }

      if (occurrence <= now) {
        overdue.push(buildMedicationReminderEvent(schedule, occurrence));
      } else {
        nextCandidates.push(buildMedicationReminderEvent(schedule, occurrence));
      }
    }
  }

  overdue.sort((left, right) => getReminderEventTime(left) - getReminderEventTime(right));
  nextCandidates.sort(
    (left, right) => getReminderEventTime(left) - getReminderEventTime(right)
  );

  return {
    overdue,
    next: nextCandidates[0] || null,
  };
}

function buildSidebarSummary(appointments, medications) {
  const now = new Date();
  const scheduledAppointments = appointments.filter(
    (appointment) => appointment.status === "scheduled"
  );
  const overdueAppointments = scheduledAppointments
    .filter((appointment) => new Date(appointment.scheduledFor) <= now)
    .map(buildAppointmentReminderEvent)
    .sort((left, right) => getReminderEventTime(left) - getReminderEventTime(right));
  const nextAppointment = scheduledAppointments
    .filter((appointment) => new Date(appointment.scheduledFor) > now)
    .sort(
      (left, right) =>
        new Date(left.scheduledFor).getTime() - new Date(right.scheduledFor).getTime()
    )[0];

  const medicationSummaries = medications
    .filter((schedule) => schedule.active)
    .map((schedule) => getMedicationReminderSummary(schedule, now));
  const overdueMedicationEvents = medicationSummaries
    .flatMap((summary) => summary.overdue)
    .sort((left, right) => getReminderEventTime(left) - getReminderEventTime(right));
  const nextMedicationReminder = medicationSummaries
    .map((summary) => summary.next)
    .filter(Boolean)
    .sort((left, right) => getReminderEventTime(left) - getReminderEventTime(right))[0];

  return {
    appointmentOverdueCount: overdueAppointments.length,
    nextAppointment: nextAppointment ? buildAppointmentReminderEvent(nextAppointment) : null,
    medicationOverdueCount: overdueMedicationEvents.length,
    nextMedicationReminder: nextMedicationReminder || null,
  };
}

module.exports = {
  WEEKDAY_NAMES,
  buildSidebarSummary,
};
