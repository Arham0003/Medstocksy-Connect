import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const SUPABASE_SERVICE_ROLE_KEY =
    env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    '';
  const RESEND_API_KEY = (
    env.RESEND_API_KEY ||
    process.env.RESEND_API_KEY ||
    ''
  ).trim();
  const EMAIL_FROM =
    env.EMAIL_FROM ||
    process.env.EMAIL_FROM ||
    'Medstocksy Connect <team@no-reply.medstocksy.in>';
  const SUPABASE_URL =
    env.VITE_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    '';

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'favicon.svg', 'favicon.png', 'apple-touch-icon.png', 'apple-touch-icon.svg'],
        manifest: {
          name: 'Medstocksy Connect',
          short_name: 'Medstocksy',
          description: 'WhatsApp-driven customer relations for pharmacies',
          theme_color: '#3B82F6',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'portrait',
          scope: '/',
          start_url: '/',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        devOptions: { enabled: true },
      }),
      {
        name: 'dev-email-middleware',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const readBody = (r: typeof req): Promise<string> =>
              new Promise((resolve) => {
                let buf = '';
                r.on('data', (c) => { buf += c; });
                r.on('end', () => resolve(buf));
              });

            if (req.url === '/api/email/welcome' && req.method === 'POST') {
              try {
                const body = await readBody(req);
                const { email, fullName, pharmacyName } = JSON.parse(body || '{}');
                const cleanEmail = email?.trim().toLowerCase();
                const { Resend } = await import('resend');
                const resend = new Resend(RESEND_API_KEY);
                const { getWelcomeEmailHtml } = await import('./api/email/_template');
                const html = getWelcomeEmailHtml({ fullName, pharmacyName });

                const result = await resend.emails.send({
                  from: EMAIL_FROM,
                  to: [cleanEmail],
                  subject: 'Welcome to Medstocksy Connect — Your Pharmacy CRM is Ready',
                  html,
                });
                console.log('[dev-email] ✅ Welcome email sent to:', cleanEmail);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(result));
              } catch (err: any) {
                console.error('[dev-email] Error sending welcome email:', err);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
              return;
            }

            if (req.url === '/api/email/reset-password' && req.method === 'POST') {
              try {
                const body = await readBody(req);
                const { email, redirectTo } = JSON.parse(body || '{}');
                if (!email || !email.includes('@')) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: 'Valid email required' }));
                  return;
                }
                const cleanEmail = email.trim().toLowerCase();
                const targetOrigin = redirectTo || 'http://localhost:5180';
                const resetRedirect = `${targetOrigin.replace(/\/$/, '')}/reset-password`;

                const { Resend } = await import('resend');
                const resend = new Resend(RESEND_API_KEY);

                const { createClient } = await import('@supabase/supabase-js');
                const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
                  auth: { persistSession: false, autoRefreshToken: false },
                });
                const { data, error } = await supabaseAdmin.auth.admin.generateLink({
                  type: 'recovery',
                  email: cleanEmail,
                  options: { redirectTo: resetRedirect },
                });

                if (!error && data?.properties?.action_link) {
                  const { getResetPasswordEmailHtml } = await import('./api/email/_template');
                  const html = getResetPasswordEmailHtml({ resetUrl: data.properties.action_link });
                  const result = await resend.emails.send({
                    from: EMAIL_FROM,
                    to: [cleanEmail],
                    subject: 'Reset your Medstocksy Connect password',
                    html,
                  });
                  console.log('[dev-email] ✅ Password reset email sent via Resend to:', cleanEmail);
                  console.log('[dev-email] 🔗 Action Link:', data.properties.action_link);
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ success: true, method: 'direct_resend', result }));
                  return;
                } else if (error) {
                  console.warn('[dev-email] ⚠️ Supabase generateLink failed (user might not exist):', error.message);
                }

                // Anti-enumeration: still return 200
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, method: 'noop_anti_enumeration' }));
              } catch (err: any) {
                console.error('[dev-email] Error in reset password:', err);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
              return;
            }

            next();
          });
        },
      },
    ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__:  JSON.stringify(new Date().toISOString()),
  },
  // Port 5180 (not 5174) — dodges any cached service worker from previous
  // Vite apps that registered on the default ports. strictPort fails fast
  // if 5180 is also taken instead of silently picking another.
  server: { port: 5180, host: true, strictPort: true },
  preview: { port: 4180 },
  build: {
    target: 'es2022',
    // Source maps are ~3x the JS payload on disk and slow the build. Vercel
    // serves them only when devtools requests them, but they still bloat the
    // deploy; 'hidden' keeps them generated for error reporting without the
    // //# sourceMappingURL comment that makes browsers fetch them.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          ui: ['@radix-ui/react-dialog', '@radix-ui/react-slot'],
        },
      },
    },
  },
};
});




