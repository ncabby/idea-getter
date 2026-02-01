import { Router } from 'express';
import { getAllSettings, setSetting } from '../database/index.js';
import {
  asyncHandler,
  updateSettingsBodySchema,
  BadRequestError,
  type SettingsResponse,
} from './types.js';

const router = Router();

/**
 * GET /api/settings
 *
 * Returns all settings as key-value pairs.
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const settingsList = await getAllSettings();

    // Transform to key-value pairs
    const response: SettingsResponse = {};
    for (const setting of settingsList) {
      response[setting.key] = setting.value;
    }

    res.json(response);
  })
);

/**
 * PUT /api/settings
 *
 * Updates settings.
 * Request body: { min_score_threshold?: number, min_complaint_count?: number }
 */
router.put(
  '/',
  asyncHandler(async (req, res) => {
    // Validate request body
    const parseResult = updateSettingsBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMessages = parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`);
      throw new BadRequestError(errorMessages.join('; '));
    }

    const updates = parseResult.data;

    // Update each setting if provided
    if (updates.min_score_threshold !== undefined) {
      await setSetting(
        'min_score_threshold',
        updates.min_score_threshold,
        'Minimum score required for an opportunity to be displayed'
      );
    }

    if (updates.min_complaint_count !== undefined) {
      await setSetting(
        'min_complaint_count',
        updates.min_complaint_count,
        'Minimum number of complaints required to form a valid cluster'
      );
    }

    // Return updated settings
    const settingsList = await getAllSettings();
    const response: SettingsResponse = {};
    for (const setting of settingsList) {
      response[setting.key] = setting.value;
    }

    res.json(response);
  })
);

export default router;
