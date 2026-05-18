import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTemplates() {
  const { data, error } = await supabase
    .from('crm_templates')
    .select('*');
  
  if (error) {
    console.error('Error fetching templates:', error);
    return;
  }

  console.log('Total templates found:', data?.length);
  
  const counts: Record<string, number> = {};
  data?.forEach(t => {
    const key = `${t.pharmacy_id ?? 'SYSTEM'}:${t.name}:${t.language}`;
    counts[key] = (counts[key] || 0) + 1;
  });

  const duplicates = Object.entries(counts).filter(([_, count]) => count > 1);
  if (duplicates.length > 0) {
    console.log('Duplicates found:');
    duplicates.forEach(([key, count]) => {
      console.log(`  ${key}: ${count} times`);
    });
  } else {
    console.log('No duplicates found in raw data.');
  }
}

checkTemplates();
