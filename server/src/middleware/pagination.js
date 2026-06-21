/**
 * 分页参数验证中间件
 * 限制 pageSize 的最大值，防止数据库性能问题
 */

const DEFAULT_MAX_PAGE_SIZE = 100;

export function validatePagination(maxPageSize = DEFAULT_MAX_PAGE_SIZE) {
  return (req, res, next) => {
    const { page, pageSize } = req.query;

    if (page !== undefined) {
      const pageNum = parseInt(page);
      if (isNaN(pageNum) || pageNum < 1) {
        return res.status(400).json({
          success: false,
          message: '页码必须为正整数',
        });
      }
    }

    if (pageSize !== undefined) {
      const pageSizeNum = parseInt(pageSize);
      if (isNaN(pageSizeNum) || pageSizeNum < 1) {
        return res.status(400).json({
          success: false,
          message: '每页数量必须为正整数',
        });
      }
      if (pageSizeNum > maxPageSize) {
        return res.status(400).json({
          success: false,
          message: `每页数量不能超过 ${maxPageSize}`,
        });
      }
    }

    next();
  };
}
