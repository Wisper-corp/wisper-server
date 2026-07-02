import { Router } from 'express';
import { jobTitleController } from './jobTitle.controller';

const router = Router();

// Public endpoint - no auth required for autocomplete
router.get('/search', jobTitleController.searchJobTitles);

export const jobTitleRoutes = router;
