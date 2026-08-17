/**
 * 从源版本号递增主版本号（与后端 incrementVersion 同规则）：
 * 首个数字段 +1，存在次版本号（.x）则归零，如 "V1.0" → "V2.0"、"V1.2" → "V2.0"。
 * 无版本号返回空串；无数字段原样返回。
 */
export function incrementVersion(version) {
  if (version == null || String(version).trim() === '') return '';
  const v = String(version);
  const m = v.match(/^(.*?)(\d+)(\.\d+)?(.*)$/);
  if (!m) return v;
  const [, prefix, major, minor, suffix] = m;
  const nextMajor = Number(major) + 1;
  const majorStr =
    major.length > 1 && major.startsWith('0')
      ? String(nextMajor).padStart(major.length, '0')
      : String(nextMajor);
  return `${prefix}${majorStr}${minor ? '.0' : ''}${suffix}`;
}
