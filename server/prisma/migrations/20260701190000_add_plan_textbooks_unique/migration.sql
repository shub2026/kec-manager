-- AddUniqueConstraint: plan_textbooks (semester_id, textbook_id)
-- 防止同一教材被重复关联到同一学期

CREATE UNIQUE INDEX IF NOT EXISTS "plan_textbooks_semester_id_textbook_id_key"
  ON "plan_textbooks"("semester_id", "textbook_id");
