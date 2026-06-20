import { ElMessage } from 'element-plus'
import request from '../utils/request'
import { downloadBlob } from '../utils/download'

/**
 * 通用导出 Composable
 * @param {string} entityName - 实体名称（如 'courses', 'textbooks'）
 * @param {string} displayName - 显示名称（如 '课程数据', '教材数据'）
 * @param {object} options - 可选配置
 * @param {string} options.exportUrl - 自定义导出 URL（默认 /export/{entityName}）
 * @param {string} options.templateUrl - 自定义模板 URL（默认 /export/template/{entityName}）
 * @returns {object} { exportData, downloadTemplate }
 */
export function useExport(entityName, displayName, options = {}) {
  const exportUrl = options.exportUrl || `/export/${entityName}`
  const templateUrl = options.templateUrl || `/export/template/${entityName}`

  /**
   * 导出数据到 Excel
   */
  async function exportData(customParams = {}) {
    try {
      let url = exportUrl
      
      // 如果有自定义参数，添加到 URL 中
      if (Object.keys(customParams).length > 0) {
        const queryString = new URLSearchParams(customParams).toString()
        url += `?${queryString}`
      }
      
      const response = await request.get(url, {
        responseType: 'blob'
      })
      
      const timestamp = new Date().getTime()
      const filename = `${displayName}_${timestamp}.xlsx`
      downloadBlob(response, filename)
      
      ElMessage.success('导出成功')
    } catch (error) {
      if (import.meta.env.DEV) { console.error('导出失败:', error) }
      ElMessage.error('导出失败')
    }
  }

  /**
   * 下载导入模板
   */
  async function downloadTemplate() {
    try {
      const response = await request.get(templateUrl, {
        responseType: 'blob'
      })
      
      const filename = `${displayName}导入模板.xlsx`
      downloadBlob(response, filename)
      
      ElMessage.success('模板下载成功')
    } catch (error) {
      if (import.meta.env.DEV) { console.error('下载模板失败:', error) }
      ElMessage.error('下载模板失败')
    }
  }

  return { exportData, downloadTemplate }
}
