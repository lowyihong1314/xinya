export type EventOrganizer = {
  id: number;
  username?: string;
  display_name?: string;
};

export type EventCheckInRecord = {
  id: number;
  event_id: number;
  user_id: number;
  check_in_date?: string;
  check_in_time?: string;
  valid_user_id?: number | null;
  user_name?: string;
  valid_user_name?: string;
};

export type EventImageRef = {
  id?: number;
  file_type?: string;
  file_name?: string;
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

export type SharedEventRecord = {
  id: number;
  event_code?: string;
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
  event_files?: EventAttachmentRecord[];
  username?: string;
  display_name?: string;
  organizers?: EventOrganizer[];
  event_image?: EventImageRef | null;
};

export type AlbumFile = {
  id: number;
  event_id?: number;
  file_name?: string;
  file_type?: string;
  created_at?: string;
  user_display_name?: string;
  [key: string]: unknown;
};

export type EventDetailRecord = SharedEventRecord & {
  prev_event_id?: number | null;
  next_event_id?: number | null;
  login?: boolean;
  album_files?: AlbumFile[];
  check_ins?: EventCheckInRecord[];
};

export type EventFlowRecord = {
  id: number;
  event_id: number;
  no?: number;
  minutes?: number | null;
  title?: string | null;
  detail?: string | null;
  note?: string | null;
  notice?: string | null;
  creator_id?: number | null;
  creator_name?: string | null;
  handler_id?: number | null;
  handler_name?: string | null;
};

export type EventSortResponse = {
  status?: string;
  data?: SharedEventRecord[];
  message?: string;
};

export type EventListMutationResponse = {
  status?: string;
  data?: SharedEventRecord;
  message?: string;
};

export type EventDetailResponse = {
  status?: string;
  data?: EventDetailRecord;
  message?: string;
};

export type EventFlowListResponse = {
  status?: string;
  data?: EventFlowRecord[];
  message?: string;
};

export type EventFlowMutationResponse = {
  status?: string;
  data?: EventFlowRecord[] | EventDetailRecord | EventFlowRecord;
  message?: string;
};

export type EventMediaUploadRecord = {
  file_id?: number;
  file_type?: string;
  message?: string;
};

export type EventMediaUploadResponse = {
  status?: string;
  data?: EventMediaUploadRecord;
  file_id?: number;
  file_type?: string;
  message?: string;
};

export type EventCheckInMutationResponse = {
  status?: string;
  message?: string;
  data?: EventCheckInRecord;
  id?: number;
};
