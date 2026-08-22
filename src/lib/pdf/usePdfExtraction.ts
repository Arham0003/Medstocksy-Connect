/**
 * React hook wrapping PDF extraction.
 *
 * Lazy-imports extractFromPdf so pdf.js is never in the initial bundle.
 * Used by both PrescriptionWorkflow (Step 2) and AddFromBillDialog.
 */
import { useState, useCallback } from 'react';
import type { ParsedBill } from '@/lib/pdf/extract';

interface UsePdfExtractionReturn {
  /** Call after a PDF file is ready. Returns null on failure. */
  extract: (file: File) => Promise<ParsedBill | null>;
  extracting: boolean;
  /** User-visible error string, or null when clean. */
  error: string | null;
  /** Last successful result (null until first run). */
  result: ParsedBill | null;
  /** Reset state back to initial. */
  reset: () => void;
}

export function usePdfExtraction(): UsePdfExtractionReturn {
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParsedBill | null>(null);

  const extract = async (file: File): Promise<ParsedBill | null> => {
    setExtracting(true);
    setError(null);
    setResult(null);
    try {
      const { extractFromPdf } = await import('@/lib/pdf/extract');
      const parsed = await extractFromPdf(file);
      setResult(parsed);
      return parsed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not read that PDF.';
      // Surface friendly messages for common failure modes.
      if (/password/i.test(msg)) {
        setError('PDF is password-protected. Please remove the password and try again.');
      } else if (/invalid|corrupt/i.test(msg)) {
        setError('PDF appears to be corrupted and could not be opened.');
      } else {
        setError(msg);
      }
      return null;
    } finally {
      setExtracting(false);
    }
  };

  const reset = useCallback(() => { setError(null); setResult(null); }, []);

  return { extract, extracting, error, result, reset };
}
