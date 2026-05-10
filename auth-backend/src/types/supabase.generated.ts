export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      bot_sessions: {
        Row: {
          created_at: string;
          flow: string;
          payload: Json;
          step: number;
          updated_at: string;
          user_id: number;
        };
        Insert: {
          created_at?: string;
          flow: string;
          payload?: Json;
          step: number;
          updated_at?: string;
          user_id: number;
        };
        Update: {
          created_at?: string;
          flow?: string;
          payload?: Json;
          step?: number;
          updated_at?: string;
          user_id?: number;
        };
        Relationships: [];
      };
      cities: {
        Row: {
          is_demo_city: boolean;
          name_uk: string;
          oblast: string;
          population: number | null;
          slug: string;
        };
        Insert: {
          is_demo_city?: boolean;
          name_uk: string;
          oblast: string;
          population?: number | null;
          slug: string;
        };
        Update: {
          is_demo_city?: boolean;
          name_uk?: string;
          oblast?: string;
          population?: number | null;
          slug?: string;
        };
        Relationships: [];
      };
      discovery_sources: {
        Row: {
          channel: Database['public']['Enums']['discovery_channel'];
          created_at: string;
          details: Json | null;
          id: number;
          veteran_id: string;
        };
        Insert: {
          channel: Database['public']['Enums']['discovery_channel'];
          created_at?: string;
          details?: Json | null;
          id?: number;
          veteran_id: string;
        };
        Update: {
          channel?: Database['public']['Enums']['discovery_channel'];
          created_at?: string;
          details?: Json | null;
          id?: number;
          veteran_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'discovery_sources_veteran_id_fkey';
            columns: ['veteran_id'];
            isOneToOne: false;
            referencedRelation: 'veterans';
            referencedColumns: ['id'];
          },
        ];
      };
      event_attendees: {
        Row: {
          event_id: string;
          invitation_id: string | null;
          joined_at: string;
          show_name_publicly: boolean;
          status: Database['public']['Enums']['attendee_status'];
          user_id: string;
        };
        Insert: {
          event_id: string;
          invitation_id?: string | null;
          joined_at?: string;
          show_name_publicly?: boolean;
          status?: Database['public']['Enums']['attendee_status'];
          user_id: string;
        };
        Update: {
          event_id?: string;
          invitation_id?: string | null;
          joined_at?: string;
          show_name_publicly?: boolean;
          status?: Database['public']['Enums']['attendee_status'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'event_attendees_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'opportunities';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'event_attendees_invitation_id_fkey';
            columns: ['invitation_id'];
            isOneToOne: false;
            referencedRelation: 'event_invitations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'event_attendees_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      event_invitations: {
        Row: {
          channel: string;
          channel_external_id: string | null;
          created_at: string;
          delivery_status: Database['public']['Enums']['invitation_delivery_status'];
          event_id: string;
          failure_reason: string | null;
          id: string;
          responded_at: string | null;
          response: Database['public']['Enums']['invitation_response'] | null;
          retry_count: number;
          scheduled_for: string;
          score_at_invite: number;
          sent_at: string | null;
          user_id: string;
        };
        Insert: {
          channel: string;
          channel_external_id?: string | null;
          created_at?: string;
          delivery_status?: Database['public']['Enums']['invitation_delivery_status'];
          event_id: string;
          failure_reason?: string | null;
          id?: string;
          responded_at?: string | null;
          response?: Database['public']['Enums']['invitation_response'] | null;
          retry_count?: number;
          scheduled_for?: string;
          score_at_invite: number;
          sent_at?: string | null;
          user_id: string;
        };
        Update: {
          channel?: string;
          channel_external_id?: string | null;
          created_at?: string;
          delivery_status?: Database['public']['Enums']['invitation_delivery_status'];
          event_id?: string;
          failure_reason?: string | null;
          id?: string;
          responded_at?: string | null;
          response?: Database['public']['Enums']['invitation_response'] | null;
          retry_count?: number;
          scheduled_for?: string;
          score_at_invite?: number;
          sent_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'event_invitations_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'opportunities';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'event_invitations_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      event_matches: {
        Row: {
          computed_at: string;
          event_id: string;
          score: number;
          user_id: string;
        };
        Insert: {
          computed_at?: string;
          event_id: string;
          score: number;
          user_id: string;
        };
        Update: {
          computed_at?: string;
          event_id?: string;
          score?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'event_matches_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'opportunities';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'event_matches_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      event_rooms: {
        Row: {
          chat_created_at: string | null;
          chat_external_id: string | null;
          chat_invite_url: string | null;
          chat_provider: string | null;
          created_at: string;
          event_id: string;
          updated_at: string;
        };
        Insert: {
          chat_created_at?: string | null;
          chat_external_id?: string | null;
          chat_invite_url?: string | null;
          chat_provider?: string | null;
          created_at?: string;
          event_id: string;
          updated_at?: string;
        };
        Update: {
          chat_created_at?: string | null;
          chat_external_id?: string | null;
          chat_invite_url?: string | null;
          chat_provider?: string | null;
          created_at?: string;
          event_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'event_rooms_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: true;
            referencedRelation: 'opportunities';
            referencedColumns: ['id'];
          },
        ];
      };
      events: {
        Row: {
          accessibility_flags: Database['public']['Enums']['accessibility_flag'][];
          address: string | null;
          ai_screen_notes: Json | null;
          ai_screen_score: number | null;
          categories: Database['public']['Enums']['interest_category'][];
          city: string;
          created_at: string;
          created_by_veteran_id: string | null;
          description: string | null;
          duration_min: number;
          honest_absences: string[] | null;
          id: string;
          identity_tag: Database['public']['Enums']['identity_pref'];
          location_lat: number | null;
          location_lng: number | null;
          moderator_id: string | null;
          moderator_notes: string | null;
          oblast: string | null;
          organizer_contact: string | null;
          organizer_id: string | null;
          photo_url: string | null;
          price_uah: number;
          published_at: string | null;
          recurrence: string | null;
          short_description: string | null;
          slug: string;
          source: Database['public']['Enums']['event_source'];
          start_at: string;
          status: Database['public']['Enums']['event_status'];
          title: string;
          updated_at: string;
        };
        Insert: {
          accessibility_flags?: Database['public']['Enums']['accessibility_flag'][];
          address?: string | null;
          ai_screen_notes?: Json | null;
          ai_screen_score?: number | null;
          categories?: Database['public']['Enums']['interest_category'][];
          city: string;
          created_at?: string;
          created_by_veteran_id?: string | null;
          description?: string | null;
          duration_min?: number;
          honest_absences?: string[] | null;
          id?: string;
          identity_tag?: Database['public']['Enums']['identity_pref'];
          location_lat?: number | null;
          location_lng?: number | null;
          moderator_id?: string | null;
          moderator_notes?: string | null;
          oblast?: string | null;
          organizer_contact?: string | null;
          organizer_id?: string | null;
          photo_url?: string | null;
          price_uah?: number;
          published_at?: string | null;
          recurrence?: string | null;
          short_description?: string | null;
          slug: string;
          source?: Database['public']['Enums']['event_source'];
          start_at: string;
          status?: Database['public']['Enums']['event_status'];
          title: string;
          updated_at?: string;
        };
        Update: {
          accessibility_flags?: Database['public']['Enums']['accessibility_flag'][];
          address?: string | null;
          ai_screen_notes?: Json | null;
          ai_screen_score?: number | null;
          categories?: Database['public']['Enums']['interest_category'][];
          city?: string;
          created_at?: string;
          created_by_veteran_id?: string | null;
          description?: string | null;
          duration_min?: number;
          honest_absences?: string[] | null;
          id?: string;
          identity_tag?: Database['public']['Enums']['identity_pref'];
          location_lat?: number | null;
          location_lng?: number | null;
          moderator_id?: string | null;
          moderator_notes?: string | null;
          oblast?: string | null;
          organizer_contact?: string | null;
          organizer_id?: string | null;
          photo_url?: string | null;
          price_uah?: number;
          published_at?: string | null;
          recurrence?: string | null;
          short_description?: string | null;
          slug?: string;
          source?: Database['public']['Enums']['event_source'];
          start_at?: string;
          status?: Database['public']['Enums']['event_status'];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'events_created_by_veteran_id_fkey';
            columns: ['created_by_veteran_id'];
            isOneToOne: false;
            referencedRelation: 'veterans';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_organizer_id_fkey';
            columns: ['organizer_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      moderation_log: {
        Row: {
          action: string;
          created_at: string;
          diff: Json | null;
          event_id: string;
          id: number;
          moderator_id: string | null;
          notes: string | null;
        };
        Insert: {
          action: string;
          created_at?: string;
          diff?: Json | null;
          event_id: string;
          id?: number;
          moderator_id?: string | null;
          notes?: string | null;
        };
        Update: {
          action?: string;
          created_at?: string;
          diff?: Json | null;
          event_id?: string;
          id?: number;
          moderator_id?: string | null;
          notes?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'moderation_log_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
        ];
      };
      notifications: {
        Row: {
          created_at: string;
          event_id: string | null;
          failure_reason: string | null;
          id: number;
          payload: Json;
          retry_count: number;
          rsvp_id: string | null;
          scheduled_for: string;
          sent_at: string | null;
          status: Database['public']['Enums']['notification_status'];
          type: Database['public']['Enums']['notification_type'];
          veteran_id: string;
        };
        Insert: {
          created_at?: string;
          event_id?: string | null;
          failure_reason?: string | null;
          id?: number;
          payload: Json;
          retry_count?: number;
          rsvp_id?: string | null;
          scheduled_for: string;
          sent_at?: string | null;
          status?: Database['public']['Enums']['notification_status'];
          type: Database['public']['Enums']['notification_type'];
          veteran_id: string;
        };
        Update: {
          created_at?: string;
          event_id?: string | null;
          failure_reason?: string | null;
          id?: number;
          payload?: Json;
          retry_count?: number;
          rsvp_id?: string | null;
          scheduled_for?: string;
          sent_at?: string | null;
          status?: Database['public']['Enums']['notification_status'];
          type?: Database['public']['Enums']['notification_type'];
          veteran_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notifications_rsvp_id_fkey';
            columns: ['rsvp_id'];
            isOneToOne: false;
            referencedRelation: 'rsvps';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notifications_veteran_id_fkey';
            columns: ['veteran_id'];
            isOneToOne: false;
            referencedRelation: 'veterans';
            referencedColumns: ['id'];
          },
        ];
      };
      opportunities: {
        Row: {
          accessibility_flags: Database['public']['Enums']['accessibility_flag'][];
          address: string | null;
          city: string;
          classified_at: string | null;
          classified_interest: Database['public']['Enums']['classified_interest'][];
          classifier_confidence: number | null;
          classifier_version: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          duration_min: number | null;
          ends_at: string | null;
          id: string;
          interests: string[];
          location_lat: number;
          location_lng: number;
          oblast: string | null;
          organizer_contact: string | null;
          photo_url: string | null;
          price_uah: number | null;
          short_description: string | null;
          start_at: string | null;
          target_age_range: Database['public']['Enums']['age_range'][];
          target_identity_pref: Database['public']['Enums']['identity_pref'];
          target_veteran_status: Database['public']['Enums']['veteran_status'][];
          title: string;
          updated_at: string;
        };
        Insert: {
          accessibility_flags?: Database['public']['Enums']['accessibility_flag'][];
          address?: string | null;
          city: string;
          classified_at?: string | null;
          classified_interest?: Database['public']['Enums']['classified_interest'][];
          classifier_confidence?: number | null;
          classifier_version?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          duration_min?: number | null;
          ends_at?: string | null;
          id?: string;
          interests?: string[];
          location_lat: number;
          location_lng: number;
          oblast?: string | null;
          organizer_contact?: string | null;
          photo_url?: string | null;
          price_uah?: number | null;
          short_description?: string | null;
          start_at?: string | null;
          target_age_range?: Database['public']['Enums']['age_range'][];
          target_identity_pref?: Database['public']['Enums']['identity_pref'];
          target_veteran_status?: Database['public']['Enums']['veteran_status'][];
          title: string;
          updated_at?: string;
        };
        Update: {
          accessibility_flags?: Database['public']['Enums']['accessibility_flag'][];
          address?: string | null;
          city?: string;
          classified_at?: string | null;
          classified_interest?: Database['public']['Enums']['classified_interest'][];
          classifier_confidence?: number | null;
          classifier_version?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          duration_min?: number | null;
          ends_at?: string | null;
          id?: string;
          interests?: string[];
          location_lat?: number;
          location_lng?: number;
          oblast?: string | null;
          organizer_contact?: string | null;
          photo_url?: string | null;
          price_uah?: number | null;
          short_description?: string | null;
          start_at?: string | null;
          target_age_range?: Database['public']['Enums']['age_range'][];
          target_identity_pref?: Database['public']['Enums']['identity_pref'];
          target_veteran_status?: Database['public']['Enums']['veteran_status'][];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'opportunities_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      opportunity_health: {
        Row: {
          accessibility_flags: Database['public']['Enums']['accessibility_flag'][];
          address: string | null;
          city: string;
          classified_at: string | null;
          classified_interest: Database['public']['Enums']['classified_interest'][];
          classifier_confidence: number | null;
          classifier_version: string | null;
          created_at: string;
          description: string | null;
          id: string;
          interests: Database['public']['Enums']['health_interest'][];
          location_lat: number;
          location_lng: number;
          oblast: string | null;
          organizer_contact: string | null;
          photo_url: string | null;
          price_uah: number | null;
          short_description: string | null;
          target_age_range: Database['public']['Enums']['age_range'][];
          target_identity_pref: Database['public']['Enums']['identity_pref'];
          target_veteran_status: Database['public']['Enums']['veteran_status'][];
          title: string;
          type: Database['public']['Enums']['health_type'];
          updated_at: string;
          visit_count: number;
        };
        Insert: {
          accessibility_flags?: Database['public']['Enums']['accessibility_flag'][];
          address?: string | null;
          city: string;
          classified_at?: string | null;
          classified_interest?: Database['public']['Enums']['classified_interest'][];
          classifier_confidence?: number | null;
          classifier_version?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          interests?: Database['public']['Enums']['health_interest'][];
          location_lat: number;
          location_lng: number;
          oblast?: string | null;
          organizer_contact?: string | null;
          photo_url?: string | null;
          price_uah?: number | null;
          short_description?: string | null;
          target_age_range?: Database['public']['Enums']['age_range'][];
          target_identity_pref?: Database['public']['Enums']['identity_pref'];
          target_veteran_status?: Database['public']['Enums']['veteran_status'][];
          title: string;
          type?: Database['public']['Enums']['health_type'];
          updated_at?: string;
          visit_count?: number;
        };
        Update: {
          accessibility_flags?: Database['public']['Enums']['accessibility_flag'][];
          address?: string | null;
          city?: string;
          classified_at?: string | null;
          classified_interest?: Database['public']['Enums']['classified_interest'][];
          classifier_confidence?: number | null;
          classifier_version?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          interests?: Database['public']['Enums']['health_interest'][];
          location_lat?: number;
          location_lng?: number;
          oblast?: string | null;
          organizer_contact?: string | null;
          photo_url?: string | null;
          price_uah?: number | null;
          short_description?: string | null;
          target_age_range?: Database['public']['Enums']['age_range'][];
          target_identity_pref?: Database['public']['Enums']['identity_pref'];
          target_veteran_status?: Database['public']['Enums']['veteran_status'][];
          title?: string;
          type?: Database['public']['Enums']['health_type'];
          updated_at?: string;
          visit_count?: number;
        };
        Relationships: [];
      };
      organizations: {
        Row: {
          city: string;
          contact_name: string | null;
          contact_phone: string | null;
          contact_telegram: string | null;
          created_at: string;
          id: string;
          name: string;
          notes: string | null;
          oblast: string | null;
          type: string | null;
          verified: boolean;
        };
        Insert: {
          city: string;
          contact_name?: string | null;
          contact_phone?: string | null;
          contact_telegram?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          notes?: string | null;
          oblast?: string | null;
          type?: string | null;
          verified?: boolean;
        };
        Update: {
          city?: string;
          contact_name?: string | null;
          contact_phone?: string | null;
          contact_telegram?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          notes?: string | null;
          oblast?: string | null;
          type?: string | null;
          verified?: boolean;
        };
        Relationships: [];
      };
      ratings: {
        Row: {
          created_at: string;
          id: string;
          peer_quote: string | null;
          peer_quote_approved: boolean;
          peer_quote_attribution: string | null;
          rsvp_id: string;
          score: Database['public']['Enums']['rating_score'];
        };
        Insert: {
          created_at?: string;
          id?: string;
          peer_quote?: string | null;
          peer_quote_approved?: boolean;
          peer_quote_attribution?: string | null;
          rsvp_id: string;
          score: Database['public']['Enums']['rating_score'];
        };
        Update: {
          created_at?: string;
          id?: string;
          peer_quote?: string | null;
          peer_quote_approved?: boolean;
          peer_quote_attribution?: string | null;
          rsvp_id?: string;
          score?: Database['public']['Enums']['rating_score'];
        };
        Relationships: [
          {
            foreignKeyName: 'ratings_rsvp_id_fkey';
            columns: ['rsvp_id'];
            isOneToOne: true;
            referencedRelation: 'rsvps';
            referencedColumns: ['id'];
          },
        ];
      };
      rsvps: {
        Row: {
          created_at: string;
          defer_until: string | null;
          event_id: string;
          id: string;
          is_ghost: boolean;
          qr_token: string | null;
          reminders_enabled: boolean;
          show_name_publicly: boolean;
          status: Database['public']['Enums']['rsvp_status'];
          veteran_id: string;
        };
        Insert: {
          created_at?: string;
          defer_until?: string | null;
          event_id: string;
          id?: string;
          is_ghost?: boolean;
          qr_token?: string | null;
          reminders_enabled?: boolean;
          show_name_publicly?: boolean;
          status?: Database['public']['Enums']['rsvp_status'];
          veteran_id: string;
        };
        Update: {
          created_at?: string;
          defer_until?: string | null;
          event_id?: string;
          id?: string;
          is_ghost?: boolean;
          qr_token?: string | null;
          reminders_enabled?: boolean;
          show_name_publicly?: boolean;
          status?: Database['public']['Enums']['rsvp_status'];
          veteran_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rsvps_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rsvps_veteran_id_fkey';
            columns: ['veteran_id'];
            isOneToOne: false;
            referencedRelation: 'veterans';
            referencedColumns: ['id'];
          },
        ];
      };
      shares: {
        Row: {
          channel: string;
          created_at: string;
          event_id: string;
          id: number;
          veteran_id: string | null;
        };
        Insert: {
          channel: string;
          created_at?: string;
          event_id: string;
          id?: number;
          veteran_id?: string | null;
        };
        Update: {
          channel?: string;
          created_at?: string;
          event_id?: string;
          id?: number;
          veteran_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'shares_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shares_veteran_id_fkey';
            columns: ['veteran_id'];
            isOneToOne: false;
            referencedRelation: 'veterans';
            referencedColumns: ['id'];
          },
        ];
      };
      users: {
        Row: {
          accessibility_flags: Database['public']['Enums']['accessibility_flag'][];
          age_range: Database['public']['Enums']['age_range'] | null;
          availability: string[];
          bio: string | null;
          city: string | null;
          classified_at: string | null;
          classified_interest: Database['public']['Enums']['classified_interest'][];
          classifier_confidence: number | null;
          classifier_version: string | null;
          company_preference: Database['public']['Enums']['company_preference'];
          created_at: string;
          display_name: string | null;
          email: string;
          id: string;
          interests: string[];
          role_in_group: string | null;
          schedule_constraints: string | null;
          show_name_publicly: boolean;
          telegram_user_id: number | null;
          triggers_to_avoid: string[];
          updated_at: string;
          veteran_status: Database['public']['Enums']['veteran_status'] | null;
        };
        Insert: {
          accessibility_flags?: Database['public']['Enums']['accessibility_flag'][];
          age_range?: Database['public']['Enums']['age_range'] | null;
          availability?: string[];
          bio?: string | null;
          city?: string | null;
          classified_at?: string | null;
          classified_interest?: Database['public']['Enums']['classified_interest'][];
          classifier_confidence?: number | null;
          classifier_version?: string | null;
          company_preference?: Database['public']['Enums']['company_preference'];
          created_at?: string;
          display_name?: string | null;
          email: string;
          id: string;
          interests?: string[];
          role_in_group?: string | null;
          schedule_constraints?: string | null;
          show_name_publicly?: boolean;
          telegram_user_id?: number | null;
          triggers_to_avoid?: string[];
          updated_at?: string;
          veteran_status?: Database['public']['Enums']['veteran_status'] | null;
        };
        Update: {
          accessibility_flags?: Database['public']['Enums']['accessibility_flag'][];
          age_range?: Database['public']['Enums']['age_range'] | null;
          availability?: string[];
          bio?: string | null;
          city?: string | null;
          classified_at?: string | null;
          classified_interest?: Database['public']['Enums']['classified_interest'][];
          classifier_confidence?: number | null;
          classifier_version?: string | null;
          company_preference?: Database['public']['Enums']['company_preference'];
          created_at?: string;
          display_name?: string | null;
          email?: string;
          id?: string;
          interests?: string[];
          role_in_group?: string | null;
          schedule_constraints?: string | null;
          show_name_publicly?: boolean;
          telegram_user_id?: number | null;
          triggers_to_avoid?: string[];
          updated_at?: string;
          veteran_status?: Database['public']['Enums']['veteran_status'] | null;
        };
        Relationships: [];
      };
      veterans: {
        Row: {
          accessibility_flags: Database['public']['Enums']['accessibility_flag'][];
          city: string | null;
          comfort_notes: string | null;
          created_at: string;
          display_name: string | null;
          id: string;
          identity_prefs: Database['public']['Enums']['identity_pref'];
          interests: Database['public']['Enums']['interest_category'][];
          language: string;
          last_active_at: string | null;
          oblast: string | null;
          onboarded_at: string | null;
          reminders_enabled: boolean;
          show_name_publicly: boolean;
          tg_user_id: number | null;
        };
        Insert: {
          accessibility_flags?: Database['public']['Enums']['accessibility_flag'][];
          city?: string | null;
          comfort_notes?: string | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          identity_prefs?: Database['public']['Enums']['identity_pref'];
          interests?: Database['public']['Enums']['interest_category'][];
          language?: string;
          last_active_at?: string | null;
          oblast?: string | null;
          onboarded_at?: string | null;
          reminders_enabled?: boolean;
          show_name_publicly?: boolean;
          tg_user_id?: number | null;
        };
        Update: {
          accessibility_flags?: Database['public']['Enums']['accessibility_flag'][];
          city?: string | null;
          comfort_notes?: string | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          identity_prefs?: Database['public']['Enums']['identity_pref'];
          interests?: Database['public']['Enums']['interest_category'][];
          language?: string;
          last_active_at?: string | null;
          oblast?: string | null;
          onboarded_at?: string | null;
          reminders_enabled?: boolean;
          show_name_publicly?: boolean;
          tg_user_id?: number | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      compute_match_score: {
        Args: { p_opportunity_id: string; p_user_id: string };
        Returns: number;
      };
      public_rsvp_count: {
        Args: { p_event_id: string };
        Returns: {
          going_count: number;
          names_visible: string[];
        }[];
      };
    };
    Enums: {
      accessibility_flag:
        | 'barrier_free'
        | 'no_stairs'
        | 'quiet_room'
        | 'no_alcohol'
        | 'sign_language'
        | 'audio_described'
        | 'sensory_friendly'
        | 'parking_disabled'
        | 'service_animal_ok';
      age_range: '18_24' | '25_34' | '35_44' | '45_54' | '55_64' | '65_plus';
      attendee_status: 'joining' | 'attended' | 'no_show' | 'left';
      classified_interest:
        | 'physical_sport'
        | 'adaptive_sport'
        | 'equine_therapy'
        | 'outdoor_recreation'
        | 'art_therapy'
        | 'music'
        | 'creative_workshop'
        | 'cultural_event'
        | 'rehabilitation'
        | 'recovery'
        | 'psychological_support'
        | 'medical_care'
        | 'legal_aid'
        | 'education'
        | 'career_development'
        | 'employment'
        | 'financial_aid'
        | 'discount_promotions'
        | 'support_group'
        | 'community_meetup'
        | 'family_support'
        | 'women_support';
      company_preference: 'with_partner' | 'women_only' | 'mixed' | 'close_ones' | 'any';
      discovery_channel:
        | 'go_partner'
        | 'peer_share'
        | 'family_share'
        | 'flyer_qr'
        | 'instagram'
        | 'cold_search'
        | 'cross_link'
        | 'unknown';
      document_type: 'passport' | 'id_card' | 'driver_license';
      event_source: 'organizer' | 'veteran_submission' | 'admin_seed';
      event_status: 'draft' | 'pending' | 'approved' | 'rejected' | 'archived';
      health_interest: 'rehabilitation' | 'recovery' | 'healing';
      health_type: 'static';
      identity_pref:
        | 'any'
        | 'women_only'
        | 'men_only'
        | 'mixed_with_women_emphasis'
        | 'family_friendly';
      interest_category:
        | 'movement'
        | 'learning'
        | 'community'
        | 'craft'
        | 'volunteering'
        | 'walks'
        | 'reading'
        | 'family';
      invitation_delivery_status: 'pending' | 'sent' | 'failed' | 'cancelled';
      invitation_response: 'accepted' | 'declined' | 'ignored';
      notification_status: 'pending' | 'sent' | 'failed' | 'cancelled';
      notification_type:
        | 'rsvp_confirm'
        | 'reminder_24h'
        | 'reminder_10m'
        | 'post_event'
        | 'event_published'
        | 'moderation_decision'
        | 'broadcast';
      opportunity_type: 'event' | 'static';
      rating_score: 'up' | 'meh' | 'down';
      rating_value: 'good' | 'neutral' | 'bad';
      rsvp_status: 'going' | 'declined' | 'deferred' | 'attended' | 'no_show';
      submission_status: 'pending' | 'approved' | 'rejected' | 'needs_edit';
      verification_status: 'pending' | 'approved' | 'rejected';
      veteran_status:
        | 'ubd'
        | 'volunteer'
        | 'active_duty'
        | 'veteran'
        | 'war_disabled'
        | 'former_pow'
        | 'family_of_fallen'
        | 'family_of_missing'
        | 'family_of_veteran'
        | 'civilian_affected'
        | 'in_process'
        | 'no_docs';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      accessibility_flag: [
        'barrier_free',
        'no_stairs',
        'quiet_room',
        'no_alcohol',
        'sign_language',
        'audio_described',
        'sensory_friendly',
        'parking_disabled',
        'service_animal_ok',
      ],
      age_range: ['18_24', '25_34', '35_44', '45_54', '55_64', '65_plus'],
      attendee_status: ['joining', 'attended', 'no_show', 'left'],
      classified_interest: [
        'physical_sport',
        'adaptive_sport',
        'equine_therapy',
        'outdoor_recreation',
        'art_therapy',
        'music',
        'creative_workshop',
        'cultural_event',
        'rehabilitation',
        'recovery',
        'psychological_support',
        'medical_care',
        'legal_aid',
        'education',
        'career_development',
        'employment',
        'financial_aid',
        'discount_promotions',
        'support_group',
        'community_meetup',
        'family_support',
        'women_support',
      ],
      company_preference: ['with_partner', 'women_only', 'mixed', 'close_ones', 'any'],
      discovery_channel: [
        'go_partner',
        'peer_share',
        'family_share',
        'flyer_qr',
        'instagram',
        'cold_search',
        'cross_link',
        'unknown',
      ],
      document_type: ['passport', 'id_card', 'driver_license'],
      event_source: ['organizer', 'veteran_submission', 'admin_seed'],
      event_status: ['draft', 'pending', 'approved', 'rejected', 'archived'],
      health_interest: ['rehabilitation', 'recovery', 'healing'],
      health_type: ['static'],
      identity_pref: [
        'any',
        'women_only',
        'men_only',
        'mixed_with_women_emphasis',
        'family_friendly',
      ],
      interest_category: [
        'movement',
        'learning',
        'community',
        'craft',
        'volunteering',
        'walks',
        'reading',
        'family',
      ],
      invitation_delivery_status: ['pending', 'sent', 'failed', 'cancelled'],
      invitation_response: ['accepted', 'declined', 'ignored'],
      notification_status: ['pending', 'sent', 'failed', 'cancelled'],
      notification_type: [
        'rsvp_confirm',
        'reminder_24h',
        'reminder_10m',
        'post_event',
        'event_published',
        'moderation_decision',
        'broadcast',
      ],
      opportunity_type: ['event', 'static'],
      rating_score: ['up', 'meh', 'down'],
      rating_value: ['good', 'neutral', 'bad'],
      rsvp_status: ['going', 'declined', 'deferred', 'attended', 'no_show'],
      submission_status: ['pending', 'approved', 'rejected', 'needs_edit'],
      verification_status: ['pending', 'approved', 'rejected'],
      veteran_status: [
        'ubd',
        'volunteer',
        'active_duty',
        'veteran',
        'war_disabled',
        'former_pow',
        'family_of_fallen',
        'family_of_missing',
        'family_of_veteran',
        'civilian_affected',
        'in_process',
        'no_docs',
      ],
    },
  },
} as const;
