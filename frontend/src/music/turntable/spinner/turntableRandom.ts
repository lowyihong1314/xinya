import type { SlotConfig, SlotMachineRoundResult, SlotMachineSettings, SlotUser } from "./types";

const DEFAULT_SLOT_NAMES = ["吉他手", "钢琴手", "歌手", "贝斯手", "鼓手", "小提琴手"];

export function clampSlotCount(value: number) {
  return Math.max(3, Math.min(6, Math.round(value || 3)));
}

export function defaultSlotName(index: number) {
  return DEFAULT_SLOT_NAMES[index] || `角色 ${index + 1}`;
}

export function buildDefaultSlots(count: number): SlotConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    name: defaultSlotName(i),
    candidates: [],
  }));
}

export function availableUsersForSlot(slot: SlotConfig, usedIds: number[], returnAfterDrawn: boolean): SlotUser[] {
  if (returnAfterDrawn) return slot.candidates;
  const used = new Set(usedIds);
  return slot.candidates.filter((u) => !used.has(u.id));
}

export function checkCanStart(
  settings: SlotMachineSettings,
  usedIdsPerSlot: number[][],
): { ok: boolean; reason: string } {
  const count = clampSlotCount(settings.slot_count);
  for (let i = 0; i < count; i++) {
    const slot = settings.slots[i];
    if (!slot || !slot.candidates.length) {
      return { ok: false, reason: `「${slot?.name || defaultSlotName(i)}」没有候选人` };
    }
    const available = availableUsersForSlot(slot, usedIdsPerSlot[i] || [], settings.return_after_drawn);
    if (!available.length) {
      return { ok: false, reason: `「${slot.name}」剩余候选人不足` };
    }
  }
  if (settings.unique_per_round) {
    const slotCandidates = settings.slots.slice(0, count).map((slot, i) =>
      availableUsersForSlot(slot, usedIdsPerSlot[i] || [], settings.return_after_drawn),
    );
    if (!canAssignUnique(slotCandidates, 0, new Set())) {
      return { ok: false, reason: "各角色候选人重叠过多，无法组成不重复的乐团" };
    }
  }
  return { ok: true, reason: "" };
}

/** Backtracking check: can each slot get a unique person? (3-6 slots, trivially fast) */
function canAssignUnique(slotCandidates: SlotUser[][], index: number, usedIds: Set<number>): boolean {
  if (index >= slotCandidates.length) return true;
  for (const user of slotCandidates[index]) {
    if (usedIds.has(user.id)) continue;
    usedIds.add(user.id);
    if (canAssignUnique(slotCandidates, index + 1, usedIds)) return true;
    usedIds.delete(user.id);
  }
  return false;
}

export function buildRoundResult(settings: SlotMachineSettings, usedIdsPerSlot: number[][]): SlotMachineRoundResult {
  const count = clampSlotCount(settings.slot_count);

  if (settings.unique_per_round) {
    const picks = pickUnique(settings.slots.slice(0, count), usedIdsPerSlot, settings.return_after_drawn);
    if (!picks) throw new Error("各角色候选人重叠过多，无法组成不重复的乐团");
    return { created_at_ms: Date.now(), picks };
  }

  const picks: SlotUser[] = [];
  for (let i = 0; i < count; i++) {
    const slot = settings.slots[i];
    if (!slot) throw new Error(`槽位 ${i + 1} 未配置`);
    const available = availableUsersForSlot(slot, usedIdsPerSlot[i] || [], settings.return_after_drawn);
    if (!available.length) throw new Error(`「${slot.name}」剩余候选人不足`);
    picks.push(shuffleUsers(available)[0]);
  }
  return { created_at_ms: Date.now(), picks };
}

/** Backtracking pick: each slot gets a random unique person. */
function pickUnique(
  slots: SlotConfig[],
  usedIdsPerSlot: number[][],
  returnAfterDrawn: boolean,
): SlotUser[] | null {
  const picks: SlotUser[] = [];
  const pickedIds = new Set<number>();

  function backtrack(i: number): boolean {
    if (i >= slots.length) return true;
    const available = shuffleUsers(
      availableUsersForSlot(slots[i], usedIdsPerSlot[i] || [], returnAfterDrawn).filter(
        (u) => !pickedIds.has(u.id),
      ),
    );
    for (const user of available) {
      picks.push(user);
      pickedIds.add(user.id);
      if (backtrack(i + 1)) return true;
      picks.pop();
      pickedIds.delete(user.id);
    }
    return false;
  }

  return backtrack(0) ? picks : null;
}

export function buildRollingPicks(settings: SlotMachineSettings): (SlotUser | null)[] {
  const count = clampSlotCount(settings.slot_count);
  return Array.from({ length: count }, (_, i) => {
    const slot = settings.slots[i];
    if (!slot || !slot.candidates.length) return null;
    return slot.candidates[Math.floor(Math.random() * slot.candidates.length)];
  });
}

export function shuffleUsers(users: SlotUser[]) {
  const next = [...users];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function displayUserName(user: SlotUser) {
  return user.display_name || user.username || `用户 ${user.id}`;
}
