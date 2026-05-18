import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/contexts/LanguageContext';

export default function AuthCallback() {
  const t = useT();
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (user) navigate('/', { replace: true });
    else navigate('/login', { replace: true });
  }, [user, loading, navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{t('auth.callback')}</p>
    </div>
  );
}
