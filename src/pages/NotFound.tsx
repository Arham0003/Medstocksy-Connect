import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useT } from '@/contexts/LanguageContext';

export default function NotFound() {
  const t = useT();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="text-center">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">404</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{t('error.404.title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('error.404.desc')}</p>
        <Button asChild className="mt-6">
          <Link to="/">{t('error.404.cta')}</Link>
        </Button>
      </div>
    </div>
  );
}
