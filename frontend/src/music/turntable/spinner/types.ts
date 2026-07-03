export type SlotUser = {
  id: number;
  username?: string | null;
  display_name?: string | null;
};

export type SlotConfig = {
  name: string;
  candidates: SlotUser[];
};

export type SlotMachineSettings = {
  slot_count: number;
  slots: SlotConfig[];
  return_after_drawn: boolean;
  unique_per_round: boolean;
};

export type SlotMachineRoundResult = {
  created_at_ms: number;
  picks: SlotUser[];
};
