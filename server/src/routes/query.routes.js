import { Router } from 'express';
import { validateIdParam } from '../middleware/validation.js';
import {
  querySemester,
  queryTextbookUsage,
  queryAllTextbooksUsage,
} from '../controllers/query.controller.js';

const router = Router();

/**
 * GET /api/query/semester - 当前学期开课查询
 */
router.get('/semester', querySemester);

/**
 * GET /api/query/textbook/:id - 教材使用情况查询
 */
router.get('/textbook/:id', validateIdParam, queryTextbookUsage);

/**
 * GET /api/query/textbooks - 所有教材使用情况概览
 */
router.get('/textbooks', queryAllTextbooksUsage);

export default router;
