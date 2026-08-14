export type Organizer = {
  id: number;
  username?: string;
  display_name?: string;
};

export type EventImageRef = {
  id?: number;
};

export type EventAttachmentRecord = {
  id: number;
  event_id: number;
  file_path: string;
  file_name?: string;
  mime_type?: string | null;
  file_size?: number | null;
  note?: string | null;
  created_at?: string;
  user_name?: string;
};

export type EventUnitRole = "主催单位" | "主办单位" | "承办单位" | "协办单位" | "协调单位";

export type EventOrganizingUnit = {
  id: number;
  event_id: number;
  role: EventUnitRole;
  unit_name: string;
  logo_url?: string | null;
  sort_order?: number;
};

export type EventRecord = {
  id: number;
  event_name?: string;
  datetime?: string;
  end_datetime?: string;
  location_name?: string;
  location?: string;
  place_id?: string | null;
  lat?: number | null;
  lng?: number | null;
  type?: string;
  target?: string;
  purpose?: string;
  brochure_file_id?: number | null;
  brochure_path?: string | null;
  brochure_name?: string | null;
  brochure_mime?: string | null;
  event_files?: EventAttachmentRecord[];
  username?: string;
  display_name?: string;
  organizers?: Organizer[];
  organizers_ids?: number[];
  organizing_units?: EventOrganizingUnit[];
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
  place_id?: string | null;
  lat?: number | null;
  lng?: number | null;
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
