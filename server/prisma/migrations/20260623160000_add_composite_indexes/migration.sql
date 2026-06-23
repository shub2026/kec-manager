-- M-17: Add composite indexes for teaching_assignments
CREATE INDEX IF NOT EXISTS "teaching_assignments_class_id_semester_idx" ON "teaching_assignments"("class_id", "semester");
CREATE INDEX IF NOT EXISTS "teaching_assignments_teacher_id_semester_idx" ON "teaching_assignments"("teacher_id", "semester");
