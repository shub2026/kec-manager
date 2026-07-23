/**
 * 分页参数验证中间件
 * 统一使用 express-validator 验证规则，与 validation.js 保持一致
 */
import { query, validationResult } from 'express-validator';
import { fail } from '../utils/response.js';

/**
 * @param {number} [maxPageSize=100] - 每页最大数量上限
 */
export function validatePagination(maxPageSize = 100) {
  const paginationRules = [
    query('page').optional().isInt({ min: 1 }).withMessage('页码必须为正整数'),
    query('page_size')
      .optional()
      .isInt({ min: 1, max: maxPageSize })
      .withMessage(`每页数量必须在1-${maxPageSize}之间`),
  ];

  return [
    ...paginationRules,
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({
          success: false,
          message: '请求参数验证失败',
          errors: errors.array().map(err => ({
            field: err.path,
            message: err.msg,
            location: err.location
          }))
        });
      }
      next();
    },
  ];
}
