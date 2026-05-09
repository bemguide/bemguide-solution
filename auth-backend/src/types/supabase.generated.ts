export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          created_at: string;
          document_image_path: string;
          document_type: Database['public']['Enums']['document_type'];
          email: string;
          full_name: string;
          id: string;
          rejection_reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          selfie_image_path: string;
          updated_at: string;
          verification_status: Database['public']['Enums']['verification_status'];
        };
        Insert: {
          created_at?: string;
          document_image_path: string;
          document_type: Database['public']['Enums']['document_type'];
          email: string;
          full_name: string;
          id: string;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          selfie_image_path: string;
          updated_at?: string;
          verification_status?: Database['public']['Enums']['verification_status'];
        };
        Update: {
          created_at?: string;
          document_image_path?: string;
          document_type?: Database['public']['Enums']['document_type'];
          email?: string;
          full_name?: string;
          id?: string;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          selfie_image_path?: string;
          updated_at?: string;
          verification_status?: Database['public']['Enums']['verification_status'];
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      document_type: 'passport' | 'id_card' | 'driver_license';
      verification_status: 'pending' | 'approved' | 'rejected';
    };
    CompositeTypes: { [_ in never]: never };
  };
};
