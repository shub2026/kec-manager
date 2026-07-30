/**
 * 聚合/兼容层 re-export 完整性测试
 *
 * import.controller.js / class.service.js / teaching-arrange.service.js
 * 均为纯 re-export 文件，验证导出与源模块同一引用，防止兼容层漂移。
 */
import { describe, it, expect } from 'vitest';

describe('import.controller.js re-export', () => {
  it('导出与各子模块同一引用', async () => {
    const controller = await import('../import.controller.js');
    const shared = await import('../import-shared.js');
    const classes = await import('../import/classes.js');
    const courses = await import('../import/courses.js');
    const textbooks = await import('../import/textbooks.js');
    const teachers = await import('../import/teachers.js');

    expect(controller.upload).toBe(shared.upload);
    expect(controller.importClasses).toBe(classes.importClasses);
    expect(controller.importCourses).toBe(courses.importCourses);
    expect(controller.importTextbooks).toBe(textbooks.importTextbooks);
    expect(controller.importTeachers).toBe(teachers.importTeachers);
  });
});

describe('class.service.js 向后兼容 re-export', () => {
  it('getActiveClassFilter / invalidateDurationCache 指向 semester.service', async () => {
    const compat = await import('../../services/class.service.js');
    const semester = await import('../../services/semester.service.js');

    expect(compat.getActiveClassFilter).toBe(semester.getActiveClassFilter);
    expect(compat.invalidateDurationCache).toBe(semester.invalidateDurationCache);
  });
});

describe('teaching-arrange.service.js 聚合 re-export', () => {
  it('导出与 arrange 子模块同一引用', async () => {
    const service = await import('../../services/teaching-arrange.service.js');
    const queries = await import('../../services/arrange/queries.js');
    const validate = await import('../../services/arrange/validate.js');
    const autoArrange = await import('../../services/arrange/auto-arrange.js');
    const batch = await import('../../services/arrange/batch.js');

    expect(service.parseSemester).toBe(queries.parseSemester);
    expect(service.getClassesWithCourse).toBe(queries.getClassesWithCourse);
    expect(service.getTeachersForCourse).toBe(queries.getTeachersForCourse);
    expect(service.validateHourSettings).toBe(validate.validateHourSettings);
    expect(service.autoArrange).toBe(autoArrange.autoArrange);
    expect(service.batchAutoArrange).toBe(batch.batchAutoArrange);
  });
});
