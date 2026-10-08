require('../config/env');
const { createClient } = require('@supabase/supabase-js');

// Verifiera Supabase environment variabler
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.warn('⚠️  VARNING: SUPABASE_URL eller SUPABASE_ANON_KEY saknas. Filuppladdning kommer inte att fungera.');
}

// Initiera Supabase-klienten
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

module.exports = supabase;
