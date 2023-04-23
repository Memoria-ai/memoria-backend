const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_PUBLIC_KEY_ANON

const supabase = createClient(supabaseUrl, supabaseAnonKey)
module.exports = { supabase };