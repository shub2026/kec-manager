/**
 * 审计日志清空验证规则（简化版，只需要确认）
 */
import { body } from 'express-validator';
import { handleValidationErrors } from './validation.js';

export const validateAuditLogReset = [
  body('confirm')
    .optional()
    .equals('DELETE')
    .withMessage('必须输入DELETE确认操作'),
  handleValidationErrors
];
