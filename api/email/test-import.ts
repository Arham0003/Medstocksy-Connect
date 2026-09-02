import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getWelcomeEmailHtml } from './_template';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).send(getWelcomeEmailHtml({ fullName: 'test' }));
}
