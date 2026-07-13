/**
 * excel.js 单元测试
 *
 * 覆盖：
 * - createWorkbook：工作簿创建、表头样式、数据行、公式注入防护
 * - workbookToBuffer：缓冲区转换
 * - createTemplateWorkbook：模板工作簿、必填标记、样式
 * - sanitizeCellFormula（通过 createWorkbook 间接测试）：CSV 注入防护
 * - normalizeCellValue（通过 readWorkbook 间接测试）：单元格值归一化
 * - readWorkbook：文件读取、表头解析、行数限制
 * - 边界情况：空数据、特殊字符、空字符串
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const { createWorkbook, workbookToBuffer, readWorkbook, createTemplateWorkbook } =
  await import('../excel.js');

// ──────────────────────────────────────────────
// createWorkbook
// ──────────────────────────────────────────────
describe('createWorkbook', () => {
  const headers = [
    { label: '姓名', key: 'name', width: 20 },
    { label: '年龄', key: 'age', width: 10 },
    { label: '邮箱', key: 'email', width: 30 },
  ];

  it('应创建包含正确表头的工作簿', async () => {
    const rows = [{ name: '张三', age: 25, email: 'test@example.com' }];
    const workbook = await createWorkbook(headers, rows);

    expect(workbook).toBeInstanceOf(ExcelJS.Workbook);
    const sheet = workbook.getWorksheet('数据');
    expect(sheet).toBeDefined();

    const headerRow = sheet.getRow(1);
    expect(headerRow.getCell(1).value).toBe('姓名');
    expect(headerRow.getCell(2).value).toBe('年龄');
    expect(headerRow.getCell(3).value).toBe('邮箱');
  });

  it('应设置表头字体为粗体', async () => {
    const workbook = await createWorkbook(headers, []);
    const sheet = workbook.getWorksheet('数据');
    const headerRow = sheet.getRow(1);

    expect(headerRow.font).toEqual({ bold: true });
  });

  it('应设置表头背景填充色', async () => {
    const workbook = await createWorkbook(headers, []);
    const sheet = workbook.getWorksheet('数据');
    const headerRow = sheet.getRow(1);

    expect(headerRow.fill).toEqual({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    });
  });

  it('应正确写入数据行', async () => {
    const rows = [
      { name: '张三', age: 25, email: 'a@b.com' },
      { name: '李四', age: 30, email: 'c@d.com' },
    ];
    const workbook = await createWorkbook(headers, rows);
    const sheet = workbook.getWorksheet('数据');

    expect(sheet.getRow(2).getCell(1).value).toBe('张三');
    expect(sheet.getRow(2).getCell(2).value).toBe(25);
    expect(sheet.getRow(3).getCell(1).value).toBe('李四');
    expect(sheet.getRow(3).getCell(2).value).toBe(30);
  });

  it('空数据时应只有表头行', async () => {
    const workbook = await createWorkbook(headers, []);
    const sheet = workbook.getWorksheet('数据');

    // 只有表头，第 2 行应为空
    expect(sheet.getRow(2).getCell(1).value).toBeNull();
  });

  it('未指定 width 时应使用默认值 20', async () => {
    const headersNoWidth = [{ label: '名称', key: 'name' }];
    const workbook = await createWorkbook(headersNoWidth, []);
    const sheet = workbook.getWorksheet('数据');

    expect(sheet.getColumn(1).width).toBe(20);
  });

  describe('CSV 公式注入防护（sanitizeCellFormula）', () => {
    it('以 = 开头的字符串应加单引号前缀', async () => {
      const rows = [{ name: '=SUM(A1)', age: 1, email: '' }];
      const workbook = await createWorkbook(headers, rows);
      const sheet = workbook.getWorksheet('数据');

      expect(sheet.getRow(2).getCell(1).value).toBe("'=SUM(A1)");
    });

    it('以 + 开头的字符串应加单引号前缀', async () => {
      const rows = [{ name: '+cmd', age: 1, email: '' }];
      const workbook = await createWorkbook(headers, rows);
      const sheet = workbook.getWorksheet('数据');

      expect(sheet.getRow(2).getCell(1).value).toBe("'+cmd");
    });

    it('以 - 开头的字符串应加单引号前缀', async () => {
      const rows = [{ name: '-formula', age: 1, email: '' }];
      const workbook = await createWorkbook(headers, rows);
      const sheet = workbook.getWorksheet('数据');

      expect(sheet.getRow(2).getCell(1).value).toBe("'-formula");
    });

    it('以 @ 开头的字符串应加单引号前缀', async () => {
      const rows = [{ name: '@inject', age: 1, email: '' }];
      const workbook = await createWorkbook(headers, rows);
      const sheet = workbook.getWorksheet('数据');

      expect(sheet.getRow(2).getCell(1).value).toBe("'@inject");
    });

    it('前导空格后以 = 开头的也应被防护', async () => {
      const rows = [{ name: '  =SUM(A1)', age: 1, email: '' }];
      const workbook = await createWorkbook(headers, rows);
      const sheet = workbook.getWorksheet('数据');

      expect(sheet.getRow(2).getCell(1).value).toBe("'  =SUM(A1)");
    });

    it('普通字符串不应被修改', async () => {
      const rows = [{ name: '正常文本', age: 1, email: 'hello@world.com' }];
      const workbook = await createWorkbook(headers, rows);
      const sheet = workbook.getWorksheet('数据');

      expect(sheet.getRow(2).getCell(1).value).toBe('正常文本');
      expect(sheet.getRow(2).getCell(3).value).toBe('hello@world.com');
    });

    it('非字符串值不应被修改', async () => {
      const rows = [{ name: 'A', age: 42, email: null }];
      const workbook = await createWorkbook(headers, rows);
      const sheet = workbook.getWorksheet('数据');

      expect(sheet.getRow(2).getCell(2).value).toBe(42);
    });
  });
});

// ──────────────────────────────────────────────
// workbookToBuffer
// ──────────────────────────────────────────────
describe('workbookToBuffer', () => {
  it('应将工作簿转换为 Buffer', async () => {
    const headers = [{ label: '名称', key: 'name', width: 20 }];
    const workbook = await createWorkbook(headers, [{ name: '测试' }]);
    const buffer = await workbookToBuffer(workbook);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('空工作簿也应能转换为 Buffer', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('空');
    const buffer = await workbookToBuffer(workbook);

    expect(Buffer.isBuffer(buffer)).toBe(true);
  });
});

// ──────────────────────────────────────────────
// createTemplateWorkbook
// ──────────────────────────────────────────────
describe('createTemplateWorkbook', () => {
  const templateHeaders = [
    { label: '姓名', key: 'name', width: 15, required: true },
    { label: '邮箱', key: 'email', width: 25 },
    { label: '年龄', key: 'age', width: 10, required: true },
  ];

  it('应创建名为"模板"的工作表', () => {
    const workbook = createTemplateWorkbook(templateHeaders);
    const sheet = workbook.getWorksheet('模板');
    expect(sheet).toBeDefined();
  });

  it('必填字段表头应带 * 前缀', () => {
    const workbook = createTemplateWorkbook(templateHeaders);
    const sheet = workbook.getWorksheet('模板');
    const headerRow = sheet.getRow(1);

    expect(headerRow.getCell(1).value).toBe('*姓名');
    expect(headerRow.getCell(2).value).toBe('邮箱');
    expect(headerRow.getCell(3).value).toBe('*年龄');
  });

  it('应写入示例数据行', () => {
    const sampleData = [{ name: '张三', email: 'test@test.com', age: 20 }];
    const workbook = createTemplateWorkbook(templateHeaders, sampleData);
    const sheet = workbook.getWorksheet('模板');

    expect(sheet.getRow(2).getCell(1).value).toBe('张三');
    expect(sheet.getRow(2).getCell(2).value).toBe('test@test.com');
    expect(sheet.getRow(2).getCell(3).value).toBe(20);
  });

  it('无示例数据时应只有表头', () => {
    const workbook = createTemplateWorkbook(templateHeaders);
    const sheet = workbook.getWorksheet('模板');

    expect(sheet.getRow(2).getCell(1).value).toBeNull();
  });

  it('必填字段应使用浅红色背景', () => {
    const workbook = createTemplateWorkbook(templateHeaders);
    const sheet = workbook.getWorksheet('模板');
    const headerRow = sheet.getRow(1);

    const requiredCell = headerRow.getCell(1);
    expect(requiredCell.fill.fgColor.argb).toBe('FFFFCCCC');
  });

  it('可选字段应使用浅灰色背景', () => {
    const workbook = createTemplateWorkbook(templateHeaders);
    const sheet = workbook.getWorksheet('模板');
    const headerRow = sheet.getRow(1);

    const optionalCell = headerRow.getCell(2);
    expect(optionalCell.fill.fgColor.argb).toBe('FFE0E0E0');
  });

  it('必填字段字体应为粗体深红色', () => {
    const workbook = createTemplateWorkbook(templateHeaders);
    const sheet = workbook.getWorksheet('模板');
    const headerRow = sheet.getRow(1);

    const requiredCell = headerRow.getCell(1);
    expect(requiredCell.font.bold).toBe(true);
    expect(requiredCell.font.color.argb).toBe('FFCC0000');
  });

  it('未指定 width 时应使用默认值 20', () => {
    const headersNoWidth = [{ label: '名称', key: 'name', required: true }];
    const workbook = createTemplateWorkbook(headersNoWidth);
    const sheet = workbook.getWorksheet('模板');

    expect(sheet.getColumn(1).width).toBe(20);
  });
});

// ──────────────────────────────────────────────
// readWorkbook（通过实际文件间接测试 normalizeCellValue）
// ──────────────────────────────────────────────
describe('readWorkbook', () => {
  const tmpDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '__tmp_excel_test__'
  );

  // 辅助函数：创建临时 Excel 文件并返回路径
  async function createTempExcel(headers, rows) {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(
      tmpDir,
      `test_${Date.now()}_${Math.random().toString(36).slice(2)}.xlsx`
    );
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');

    sheet.columns = headers.map((h) => ({ header: h, key: h, width: 20 }));
    rows.forEach((row) => {
      const obj = {};
      headers.forEach((h, i) => (obj[h] = row[i]));
      sheet.addRow(obj);
    });

    await workbook.xlsx.writeFile(filePath);
    return filePath;
  }

  // 清理临时文件
  function cleanup() {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.readdirSync(tmpDir).forEach((f) => fs.unlinkSync(path.join(tmpDir, f)));
        fs.rmdirSync(tmpDir);
      }
    } catch (_) {
      // ignore cleanup errors
    }
  }

  beforeEach(() => {
    cleanup();
  });

  it('应正确读取 Excel 文件中的行数据', async () => {
    const filePath = await createTempExcel(
      ['姓名', '年龄'],
      [
        ['张三', 25],
        ['李四', 30],
      ]
    );

    const rows = await readWorkbook(filePath);
    expect(rows).toHaveLength(2);
    expect(rows[0]['姓名']).toBe('张三');
    expect(rows[0]['年龄']).toBe(25);
    expect(rows[1]['姓名']).toBe('李四');
  });

  it('应去除表头中的 * 前缀', async () => {
    const filePath = await createTempExcel(['*姓名', '年龄'], [['张三', 25]]);

    const rows = await readWorkbook(filePath);
    expect(rows[0]).toHaveProperty('姓名');
    expect(rows[0]).not.toHaveProperty('*姓名');
  });

  it('应跳过全空行', async () => {
    const filePath = await createTempExcel(
      ['名称', '值'],
      [
        ['有效', 1],
        [null, null],
        ['也有效', 2],
      ]
    );

    const rows = await readWorkbook(filePath);
    expect(rows).toHaveLength(2);
    expect(rows[0]['名称']).toBe('有效');
    expect(rows[1]['名称']).toBe('也有效');
  });

  it('空白字符串应被归一化为 null', async () => {
    const filePath = await createTempExcel(['名称', '备注'], [['测试', '   ']]);

    const rows = await readWorkbook(filePath);
    expect(rows[0]['名称']).toBe('测试');
    expect(rows[0]['备注']).toBeNull();
  });

  it('应正确读取日期类型的单元格', async () => {
    const filePath = await createTempExcel(['日期'], [[new Date('2025-03-15')]]);

    const rows = await readWorkbook(filePath);
    expect(rows[0]['日期']).toBe('2025-03-15');
  });

  it('应处理部分字段为空的行（只要有一个非空就保留）', async () => {
    const filePath = await createTempExcel(['名称', '编码', '描述'], [['测试', null, null]]);

    const rows = await readWorkbook(filePath);
    expect(rows).toHaveLength(1);
    expect(rows[0]['名称']).toBe('测试');
    expect(rows[0]['编码']).toBeNull();
  });

  it('应去除字符串首尾空格', async () => {
    const filePath = await createTempExcel(['名称'], [['  hello  ']]);

    const rows = await readWorkbook(filePath);
    expect(rows[0]['名称']).toBe('hello');
  });

  it('空字符串应被归一化为 null', async () => {
    const filePath = await createTempExcel(['名称'], [['']]);

    const rows = await readWorkbook(filePath);
    // 全空行被跳过
    expect(rows).toHaveLength(0);
  });
});
