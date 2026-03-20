export type Organizer = {
  id: number;
  username?: string;
  display_name?: string;
};

export type EventImageRef = {
  id?: number;
};

export type EventRecord = {
  id: number;
  event_name?: string;
  datetime?: string;
  end_datetime?: string;
  location?: string;
  type?: string;
  target?: string;
  purpose?: string;
  brochure_path?: string | null;
  brochure_name?: string | null;
  brochure_mime?: string | null;
  username?: string;
  display_name?: string;
  organizers?: Organizer[];
  organizers_ids?: number[];
  event_image?: EventImageRef | null;
};

export type EventMutationPayload = Partial<EventRecord> & {
  datetime?: string | null;
  end_datetime?: string | null;
  organizers_ids?: number[];
};

export type EventCreatePayload = {
  event_name: string;
  datetime: string;
  end_datetime?: string;
  location?: string;
  type?: string;
  target?: string;
  purpose?: string;
  organizers_ids?: number[];
};

export type EventListResponse = {
  status?: string;
  data?: EventRecord[];
  message?: string;
};
