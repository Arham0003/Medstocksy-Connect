import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { LanguageProvider } from './contexts/LanguageContext';
import { ThemeProvider } from './contexts/ThemeContext';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 2 min stale window — mutations call invalidateQueries explicitly,
      // so this only prevents duplicate refetches during navigation.
      staleTime: 2 * 60_000,
      gcTime:    10 * 60_000,
      retry: (failureCount, err: unknown) => {
        // Don't retry auth errors
        const message = err instanceof Error ? err.message : '';
        if (message.includes('JWT') || message.includes('not authenticated')) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      // Always refetch when reconnecting after offline — Realtime may have
      // missed events while the socket was down.
      refetchOnReconnect: 'always',
    },
    mutations: {
      retry: 0,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter
            future={{
              v7_startTransition: true,
              v7_relativeSplatPath: true,
            }}
          >
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </LanguageProvider>
    </ThemeProvider>
  </React.StrictMode>
);
