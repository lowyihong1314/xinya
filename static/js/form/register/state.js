export let available_time_slot_json = [];
export let lastEvent = null;

export function setAvailableTimeSlotJson(value) {
  available_time_slot_json = Array.isArray(value) ? value : [];
}

export function setLastEvent(value) {
  lastEvent = value || null;
}
