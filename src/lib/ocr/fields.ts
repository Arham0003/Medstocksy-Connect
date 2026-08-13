/**
 * Field specifications for OCR extraction.
 *
 * The spec's rule (§3): "The OCR system must not rely on a hardcoded list of
 * fields… The application form/workflow defines WHAT DATA IS REQUIRED. The
 * uploaded bill defines WHAT DATA IS AVAILABLE."
 *
 * So the extractor takes a list of FieldSpecs describing the target form and
 * builds the model's response schema from them at call time. Adding a field to
 * a form means adding one FieldSpec — the extractor, the validator and the
 * prompt all adapt automatically, with no second hardcoded list to keep in
 * sync.
 */

export type FieldType = 'string' | 'number' | 'integer' | 'date' | 'phone' | 'stringList' | 'enum';

export interface FieldSpec {
  /** Key in the extraction result. Matches the form field it populates. */
  key: string;
  type: FieldType;
  /** Shown to the model — what this field looks like on a real document. */
  describe: string;
  /** Allowed values for `enum`. */
  values?: readonly string[];
  /** Sanity bounds for `number` / `integer`. Values outside are flagged, not dropped. */
  min?: number;
  max?: number;
}

/* ── Reusable field definitions ─────────────────────────────────────────── */

const PATIENT: FieldSpec[] = [
  { key: 'name',  type: 'string', describe: 'Patient or customer full name' },
  { key: 'phone', type: 'phone',  describe: 'Patient mobile number, digits only, without the +91 country code' },
  { key: 'age',   type: 'integer', describe: 'Patient age in years', min: 0, max: 120 },
  {
    key: 'gender', type: 'enum', values: ['male', 'female', 'other'],
    describe: 'Patient gender, normalised to male, female or other',
  },
];

const MEDICINES: FieldSpec = {
  key: 'medicines',
  type: 'stringList',
  describe:
    'Medicine names only, e.g. "Crocin 500mg". Exclude dose schedules, ' +
    'frequency and duration ("1-0-1", "twice daily", "for 5 days").',
};

/* ── Per-workflow field sets ────────────────────────────────────────────── */

/** Bill / receipt entry — what AddFromBillDialog's bill mode can accept. */
export const BILL_FIELDS: FieldSpec[] = [
  ...PATIENT,
  {
    key: 'billAmount', type: 'number', min: 0, max: 10_000_000,
    describe: 'Final payable amount — grand total, net amount or amount paid. Number only, no currency symbol.',
  },
  { key: 'billDate', type: 'date', describe: 'Date printed on the bill, as YYYY-MM-DD' },
  MEDICINES,
  {
    key: 'lineTotal', type: 'number', min: 0, max: 10_000_000,
    describe: 'Sum of the individual line-item amounts BEFORE tax and discount, if the bill itemises them. Number only.',
  },
  {
    key: 'taxAmount', type: 'number', min: 0, max: 10_000_000,
    describe: 'Total GST or tax amount shown on the bill, if present. Number only.',
  },
];

/** Prescription entry — what AddFromBillDialog's Rx mode can accept. */
export const PRESCRIPTION_FIELDS: FieldSpec[] = [
  ...PATIENT,
  { key: 'doctor',    type: 'string', describe: 'Prescribing doctor name, without the "Dr." prefix' },
  { key: 'diagnosis', type: 'string', describe: 'Diagnosis, condition or complaint written on the prescription' },
  { key: 'billDate',  type: 'date',   describe: 'Date written on the prescription, as YYYY-MM-DD' },
  MEDICINES,
];

/**
 * `lineTotal` and `taxAmount` are extracted but never stored — the app has no
 * column for either. They exist purely so `validateExtraction` can check the
 * arithmetic of the bill against its own stated total, which is the spec's
 * "calculate/verify totals against the extracted line items" requirement.
 */
export const CROSS_CHECK_ONLY = new Set(['lineTotal', 'taxAmount']);
