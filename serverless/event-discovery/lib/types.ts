export type Region = {
  id: string;
  name_uk: string;
  oblast_uk: string;
};

export type Tag = {
  id: string;
  name_uk: string;
  search_keywords: string[];
};

export type Candidate = {
  region_id: string;
  tag_id: string;
  keyword: string;
  query: string;
  search_url: string;
  post_url: string;
  post_text: string | null;
  post_author: string | null;
  post_image_urls: string[];
  time_text: string | null;
  scraped_at: string;
  title: string;
  score: number;
};

export type Temporality = "upcoming" | "recurring" | "ongoing" | "past" | "not_event";
export type Audience =
  | "veteran_only"
  | "veteran_priority"
  | "veteran_benefit"
  | "community_open"
  | "not_relevant";
export type Category =
  | "sport"
  | "adaptive_sport"
  | "recreation"
  | "nature"
  | "creative"
  | "community"
  | "support_group"
  | "family"
  | "education"
  | "benefit";

export type ClassifiedEvent = Candidate & {
  is_event: boolean;
  event_temporality: Temporality;
  audience: Audience;
  category: Category;
  starts_at: string | null;
  ends_at: string | null;
  is_recurring: boolean;
  recurrence_text: string | null;
  venue_text: string | null;
  city: string | null;
  has_benefit: boolean;
  benefit_text: string | null;
  llm_confidence: number;
  llm_relevance_reason: string;
};

export type LlmMappedFields = {
  start_at: string | null;
  duration_min: number | null;
  interests: string[];
  short_description: string;
  description: string;
  price_uah: number | null;
  organizer_contact: string;
};

export type Opportunity = {
  title: string;
  short_description: string | null;
  description: string | null;
  photo_url: string | null;
  city: string;
  oblast: string | null;
  address: string | null;
  location_lat: number;
  location_lng: number;
  start_at: string | null;
  duration_min: number | null;
  interests: string[];
  price_uah: number | null;
  organizer_contact: string | null;
};

export type SyncStats = {
  region_id: string;
  time_range: string;
  candidates_searched: number;
  candidates_unique: number;
  classified: number;
  classified_kept: number;
  in_dnipro: number;
  mapped: number;
  deduplicated: number;
  inserted: number;
  failed: number;
  duration_sec: number;
};
