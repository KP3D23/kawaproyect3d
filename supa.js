import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://inhldccvcdrieqhcmypz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_cTB0IgHuNzLD3dGL6FzJDQ_HBo1DAx5';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
