import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

console.log("Supabase URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log("Supabase key present:", !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
console.log("Supabase key length:", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.length);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);