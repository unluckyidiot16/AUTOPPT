// src/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

// 1) 우선 Vite env에서 읽는다
const envUrl = import.meta.env.VITE_SUPABASE_URL;
const envAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 2) CI나 GitHub Pages에서 env가 비어 있으면 여기 값으로 쓴다
//    ↓↓↓ 여기는 네 실제 프로젝트 URL/anon으로 바꿔도 됨
const fallbackUrl = "https://example.supabase.co";
const fallbackAnon = "eyJhbGciOi...example...";

// 3) 최종으로 쓸 값
const supabaseUrl = envUrl ?? fallbackUrl;
const supabaseAnonKey = envAnon ?? fallbackAnon;

// 4) create 한 번만!
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
