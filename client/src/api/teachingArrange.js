import request from '../utils/request'

// 教学安排 - 班级课程数据
export const getCourseClasses = (params) => request.get('/teaching-arrange/classes', { params })
// 教学安排 - 教师列表
export const getCourseTeachers = (params) => request.get('/teaching-arrange/teachers', { params })
// 手动安排教师
export const assignTeacher = (data) => request.post('/teaching-arrange/assign', data)
// 删除教学安排
export const deleteAssignment = (id) => request.delete(`/teaching-arrange/assignments/${id}`)
// 自动排课
export const runAutoArrange = (data) => request.post('/teaching-arrange/auto-arrange', data)
// 重置自动安排
export const resetAutoAssignments = (data) => request.post('/teaching-arrange/reset', data)
// 课时统计
export const getTeachingStatistics = (params) => request.get('/teaching-arrange/statistics', { params })
// 课时要求设置
export const getHourSettings = (params) => request.get('/teaching-arrange/hour-settings', { params })
export const saveHourSettings = (data) => request.put('/teaching-arrange/hour-settings', data)
