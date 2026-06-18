import request from '../utils/request'

export const getTeachers = () => request.get('/teachers')
export const createTeacher = (data) => request.post('/teachers', data)
export const updateTeacher = (id, data) => request.put(`/teachers/${id}`, data)
export const deleteTeacher = (id) => request.delete(`/teachers/${id}`)
export const batchUpdateDefaultHours = (data) => request.put('/teachers/batch/default-hours', data)
export const toggleTeacherStatus = (id, status) => request.patch(`/teachers/${id}/status`, { status })
